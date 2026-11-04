import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Shuku52Adapter } from "../src/ingest/adapters/shuku52.js";
import { checkChapter, contentHash, type NeighborInfo } from "../src/ingest/core/checks.js";
import { BookPaths, RawStore } from "../src/ingest/core/raw-store.js";
import { runIngest } from "../src/ingest/run.js";
import { CrawlBlockedError, CrawlError, type RawChapter, type SourceAdapter } from "../src/ingest/types.js";
import { fixture } from "./helpers.js";

const LINE = "清晨的雾气还没散去，码头上已经挤满了等船的人。"; // 24 ký tự
const para = (n: number, tag = "") => Array.from({ length: n }, (_, i) => `${tag}${i}${LINE}`);
const chapter = (n: number, paragraphs = para(10, `c${n}-`), extra: Partial<RawChapter> = {}): RawChapter => ({
  number: n, url: `https://x/${n}`, title: `第${n}章 标题`, paragraphs, metadata: {}, ...extra,
});
const info = (sourceChars: number, hash = Math.random().toString()): NeighborInfo => ({ contentHash: hash, sourceChars });

describe("checkChapter", () => {
  it("hash tương thích V1: bỏ mọi khoảng trắng trước khi băm", () => {
    expect(contentHash("甲 乙\n\n丙")).toBe(contentHash("甲乙丙"));
  });

  it("VALID khi không có gì bất thường", () => {
    expect(checkChapter(chapter(5), new Map()).status).toBe("VALID");
  });

  it("CORE-07: trùng hash với chương liền kề → FAILED", () => {
    const c = chapter(5);
    const digest = contentHash(c.paragraphs.join("\n\n"));
    const r = checkChapter(c, new Map([[4, info(250, digest)]]));
    expect(r.status).toBe("FAILED");
    expect(r.issues.join()).toMatch(/trùng với chương 4/);
  });

  it("CORE-07: trùng với chương cách 2 thì không tính", () => {
    const c = chapter(5);
    expect(checkChapter(c, new Map([[3, info(250, contentHash(c.paragraphs.join("\n\n")))]])).status).toBe("VALID");
  });

  it("CORE-08: > 2× trung vị ±20 → SUSPECT (chương bị gộp)", () => {
    const n = new Map([[1, info(100)], [2, info(110)], [3, info(120)]]);
    const r = checkChapter(chapter(4, para(10)), n); // ~250 ký tự
    expect(r.status).toBe("SUSPECT");
    expect(r.issues.join()).toMatch(/dài bất thường/);
  });

  it("CORE-08: < 0,5× trung vị → SUSPECT", () => {
    const n = new Map([[1, info(1000)], [2, info(1000)], [3, info(1000)]]);
    expect(checkChapter(chapter(4, para(10)), n).issues.join()).toMatch(/ngắn bất thường/);
  });

  it("CORE-08: chương ngoài phạm vi ±20 không được tính vào trung vị", () => {
    const n = new Map([[30, info(100)], [31, info(100)], [32, info(100)]]);
    expect(checkChapter(chapter(4, para(10)), n).status).toBe("VALID");
  });

  it("CORE-08: ít hơn 3 mẫu thì không so", () => {
    expect(checkChapter(chapter(4, para(10)), new Map([[1, info(10)], [2, info(10)]])).status).toBe("VALID");
  });

  it("CORE-09: tỷ lệ trích xuất < 0,9 → SUSPECT", () => {
    const c = chapter(4, para(10), { metadata: { extraction: { accountedChars: 80, containerChars: 100 } } });
    expect(checkChapter(c, new Map()).issues.join()).toMatch(/Tỷ lệ trích xuất 0.80/);
  });

  it("CORE-14: < 200 ký tự → FAILED", () => {
    expect(checkChapter(chapter(4, [LINE]), new Map()).status).toBe("FAILED");
  });

  it("còn URL/tên miền sau khi lọc → SUSPECT", () => {
    const r = checkChapter(chapter(4, [...para(10), "请访问 www.example.com 阅读"]), new Map());
    expect(r.status).toBe("SUSPECT");
  });
});

describe("RawStore", () => {
  const setup = async () => {
    const paths = new BookPaths(await mkdtemp(join(tmpdir(), "nt-book-")));
    return { paths, store: new RawStore(paths) };
  };

  it("ghi raw/chapter-NNNN.md, đọc lại đúng tiêu đề + đoạn + frontmatter", async () => {
    const { paths, store } = await setup();
    const c = chapter(7, ["甲。", "乙。"], { metadata: { pages: [3, 4] } });
    const check = checkChapter(c, new Map());
    await store.save(c, { adapter: "t", parser: "t@1+junk:0", check });
    expect(paths.sourceFile(7)).toMatch(/raw\/chapter-0007\.md$/);
    expect(paths.reportFile).toMatch(/reviews\/ingestion\.md$/);
    const text = await readFile(paths.sourceFile(7), "utf8");
    expect(text).toMatch(/^---\nstage: source\nchapter: 7\n/);
    expect(text.endsWith("---\n# 第7章 标题\n\n甲。\n\n乙。\n")).toBe(true);

    const back = await store.load(7);
    expect(back?.title).toBe("第7章 标题");
    expect(back?.paragraphs).toEqual(["甲。", "乙。"]);
    expect(back?.frontmatter.metadata).toEqual({ pages: [3, 4] });
    expect(back?.intact).toBe(true);
  });

  it("CORE-13: isUpToDate cần cùng parser fingerprint và thân bài nguyên vẹn", async () => {
    const { paths, store } = await setup();
    const c = chapter(1);
    await store.save(c, { adapter: "t", parser: "t@1+junk:aa", check: checkChapter(c, new Map()) });
    expect(await store.isUpToDate(1, "t@1+junk:aa")).toBe(true);
    expect(await store.isUpToDate(1, "t@2+junk:aa")).toBe(false);
    expect(await store.isUpToDate(2, "t@1+junk:aa")).toBe(false);

    const file = paths.sourceFile(1);
    await writeFile(file, `${await readFile(file, "utf8")}sửa tay\n`);
    expect(await store.isUpToDate(1, "t@1+junk:aa")).toBe(false);
  });

  it("listChapters chỉ nhận chapter-NNNN.md; manifest tổng hợp từ raw, chương sửa tay là MODIFIED", async () => {
    const { paths, store } = await setup();
    for (const n of [2, 10, 1]) {
      const c = chapter(n);
      await store.save(c, { adapter: "t", parser: "t@1+junk:0", check: checkChapter(c, new Map()) });
    }
    await writeFile(join(paths.rawDir, "notes.md"), "không phải chương\n");
    expect(await store.listChapters()).toEqual([1, 2, 10]);

    await writeFile(paths.sourceFile(2), `${await readFile(paths.sourceFile(2), "utf8")}sửa tay\n`);
    const m = await store.writeManifest({ bookId: "demo", sourceLanguage: "zh", sourceUrl: "https://x/", adapter: "t" });
    expect(m.chapter_count).toBe(3);
    expect(m.chapters.map((c) => [c.id, c.status, c.file])).toEqual([
      ["0001", "VALID", "raw/chapter-0001.md"],
      ["0002", "MODIFIED", "raw/chapter-0002.md"],
      ["0010", "VALID", "raw/chapter-0010.md"],
    ]);
    expect(m.counts).toEqual({ VALID: 2, MODIFIED: 1 });
    const onDisk = JSON.parse(await readFile(paths.manifestFile, "utf8"));
    expect(onDisk.book_id).toBe("demo");
    expect(onDisk.chapters[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

/** Adapter giả: kịch bản theo số chương. */
function fakeAdapter(script: Record<number, RawChapter | Error>, fingerprint = "fake@1+junk:0"): SourceAdapter & { calls: number[] } {
  const calls: number[] = [];
  return {
    id: "fake",
    parserFingerprint: fingerprint,
    calls,
    matches: () => true,
    cleanContent: (p) => p,
    async fetchChapter(_url, n) {
      calls.push(n);
      const s = script[n] ?? chapter(n);
      if (s instanceof Error) throw s;
      return s;
    },
  };
}

describe("runIngest", () => {
  const setup = async () => {
    const paths = new BookPaths(await mkdtemp(join(tmpdir(), "nt-run-")));
    return { paths, store: new RawStore(paths) };
  };
  const base = { bookUrl: "https://x/book", log: () => {} };

  it("lưu raw, rồi lần chạy sau bỏ qua (CORE-13); --recrawl thì cào lại", async () => {
    const { store } = await setup();
    const a1 = fakeAdapter({});
    const s1 = await runIngest({ ...base, adapter: a1, store, from: 1, to: 3 });
    expect(s1.results.map((r) => r.outcome)).toEqual(["VALID", "VALID", "VALID"]);

    const a2 = fakeAdapter({});
    const s2 = await runIngest({ ...base, adapter: a2, store, from: 1, to: 3 });
    expect(s2.results.map((r) => r.outcome)).toEqual(["SKIPPED", "SKIPPED", "SKIPPED"]);
    expect(a2.calls).toEqual([]);

    const a3 = fakeAdapter({});
    await runIngest({ ...base, adapter: a3, store, from: 1, to: 3, recrawl: true });
    expect(a3.calls).toEqual([1, 2, 3]);
  });

  it("đổi parser fingerprint → chương được parse lại (không bị bỏ qua)", async () => {
    const { store } = await setup();
    await runIngest({ ...base, adapter: fakeAdapter({}, "fake@1+junk:0"), store, from: 1, to: 2 });
    const a = fakeAdapter({}, "fake@2+junk:0");
    await runIngest({ ...base, adapter: a, store, from: 1, to: 2 });
    expect(a.calls).toEqual([1, 2]);
  });

  it("CORE-06: BLOCKED dừng ngay", async () => {
    const { store } = await setup();
    const a = fakeAdapter({ 2: new CrawlBlockedError("cf") });
    const s = await runIngest({ ...base, adapter: a, store, from: 1, to: 5 });
    expect(a.calls).toEqual([1, 2]);
    expect(s.results.at(-1)?.outcome).toBe("BLOCKED");
    expect(s.stopped).toMatch(/Bị chặn ở chương 2/);
  });

  it("CORE-06: dừng sau 3 lỗi liên tiếp; lỗi xen kẽ thì không dừng", async () => {
    const { store } = await setup();
    const err = () => new CrawlError("hỏng");
    const a = fakeAdapter({ 2: err(), 4: err(), 5: err(), 6: err() });
    const s = await runIngest({ ...base, adapter: a, store, from: 1, to: 10 });
    expect(a.calls).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.stopped).toMatch(/3 chương lỗi liên tiếp/);
  });

  it("CORE-07 trong luồng thật: chương 2 trùng nội dung chương 1 → FAILED, không ghi file", async () => {
    const { paths, store } = await setup();
    const same = para(10, "same-");
    const a = fakeAdapter({ 1: chapter(1, same), 2: chapter(2, same) });
    const s = await runIngest({ ...base, adapter: a, store, from: 1, to: 2 });
    expect(s.results.map((r) => r.outcome)).toEqual(["VALID", "FAILED"]);
    await expect(readFile(paths.sourceFile(2), "utf8")).rejects.toThrow();
  });

  it("FAILED khi --recrawl không ghi đè raw tốt đã có", async () => {
    const { paths, store } = await setup();
    await runIngest({ ...base, adapter: fakeAdapter({}), store, from: 1, to: 1 });
    const before = await readFile(paths.sourceFile(1), "utf8");
    await runIngest({ ...base, adapter: fakeAdapter({ 1: chapter(1, [LINE]) }), store, from: 1, to: 1, recrawl: true });
    expect(await readFile(paths.sourceFile(1), "utf8")).toBe(before);
  });

  it("lần chạy toàn SKIPPED không ghi đè report của lần chạy trước", async () => {
    const { paths, store } = await setup();
    const s1 = await runIngest({ ...base, adapter: fakeAdapter({}), store, from: 1, to: 2 });
    expect(s1.reportWritten).toBe(true);
    const before = await readFile(paths.reportFile, "utf8");
    expect(before).toMatch(/2 VALID/);

    const s2 = await runIngest({ ...base, adapter: fakeAdapter({}), store, from: 1, to: 2 });
    expect(s2.results.every((r) => r.outcome === "SKIPPED")).toBe(true);
    expect(s2.reportWritten).toBe(false);
    expect(await readFile(paths.reportFile, "utf8")).toBe(before);

    // Có ít nhất một chương được tải (kể cả FAILED) thì report được ghi lại.
    const s3 = await runIngest({ ...base, adapter: fakeAdapter({ 3: new CrawlError("x") }), store, from: 1, to: 3 });
    expect(s3.reportWritten).toBe(true);
    expect(await readFile(paths.reportFile, "utf8")).toMatch(/0 VALID, 0 SUSPECT, 1 FAILED, 0 BLOCKED, 2 bỏ qua/);
  });

  it("ghi ingest-report.md có bảng kết quả", async () => {
    const { paths, store } = await setup();
    await runIngest({ ...base, adapter: fakeAdapter({ 2: new CrawlError("a|b") }), store, from: 1, to: 2 });
    const report = await readFile(paths.reportFile, "utf8");
    expect(report).toMatch(/1 VALID, 0 SUSPECT, 1 FAILED/);
    expect(report).toMatch(/\| 2 \| FAILED \|/);
    expect(report).toContain("a\\|b");
  });
});

describe("shuku52 + ingest", () => {
  const BASE = "https://www.52shuku.net/demo/1_b/demo01";

  it("CORE-09: metadata.extraction có số liệu, tỷ lệ ≥ 0,9 trên fixture", async () => {
    const adapter = new Shuku52Adapter(async (url) => fixture(`shuku52/book/${url.split("/").pop()}`));
    const ch = await adapter.fetchChapter(`${BASE}.html`, 1);
    const ex = ch.metadata["extraction"] as { accountedChars: number; containerChars: number };
    expect(ex.containerChars).toBeGreaterThan(0);
    expect(ex.accountedChars / ex.containerChars).toBeGreaterThanOrEqual(0.9);
    expect(checkChapter(ch, new Map()).status).toBe("VALID");
  });

  it("truyện đang ra: chương chưa có trong mục lục cache → làm mới mục lục MỘT lần", async () => {
    const page = (ps: string[]) => `<article class="article-content">${ps.map((p) => `<p>${p}</p>`).join("")}</article>`;
    const index = (n: number) => Array.from({ length: n }, (_, i) => `<a href="demo01_${i + 2}.html">x</a>`).join("");
    let pagesOnSite = 1;
    const requests: Array<[string, boolean]> = [];
    const fetcher = async (url: string, opts?: { fresh?: boolean }) => {
      requests.push([url.split("/").pop()!, opts?.fresh === true]);
      if (url.endsWith("demo01.html")) return index(pagesOnSite);
      if (url.endsWith("_2.html")) return page(["第1章 一", ...para(10)]);
      return page(["第2章 二", ...para(10)]);
    };
    const adapter = new Shuku52Adapter(fetcher);
    await adapter.fetchChapter(`${BASE}.html`, 1);

    pagesOnSite = 2; // site ra trang mới
    const ch2 = await adapter.fetchChapter(`${BASE}.html`, 2);
    expect(ch2.title).toBe("第2章 二");
    // Mục lục tải lại với fresh; trang cuối cũ (_2) cũng tải lại với fresh.
    expect(requests.filter(([u, f]) => u === "demo01.html" && f)).toHaveLength(1);
    expect(requests).toContainEqual(["demo01_2.html", true]);

    // Đã làm mới một lần trong lần chạy này: chương không tồn tại không làm mới nữa.
    await expect(adapter.fetchChapter(`${BASE}.html`, 9)).rejects.toThrow(/chương cuối là 2/);
    expect(requests.filter(([u, f]) => u === "demo01.html" && f)).toHaveLength(1);
  });
});
