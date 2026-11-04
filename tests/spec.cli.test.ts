import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { compactRanges, main } from "../src/cli.js";
import { ConfigError, loadBookConfig, parseBookConfig } from "../src/config.js";
import { parseLocalText } from "../src/ingest/adapters/local-file.js";
import { contentHash } from "../src/ingest/core/checks.js";
import { BookPaths, RawStore } from "../src/ingest/core/raw-store.js";
import { buildAdapter } from "../src/ingest/factory.js";
import { runIngest } from "../src/ingest/run.js";
import { fixture } from "./helpers.js";

const SHUKU = "https://www.52shuku.net/demo/1_b/demo01.html";
const LINE = "清晨的雾气还没散去，码头上已经挤满了等船的人。";

let stdout: string[];
beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => (stdout.push(String(s)), true));
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

const newBook = async (book: Record<string, unknown>) => {
  const dir = await mkdtemp(join(tmpdir(), "nt-cli-"));
  await writeFile(join(dir, "book.yaml"), stringifyYaml(book));
  return dir;
};

describe("book.yaml", () => {
  it("tự nhận adapter theo URL và điền mặc định V1", () => {
    const c = parseBookConfig({ id: "kzgd", url: SHUKU });
    expect(c.adapter).toBe("shuku52");
    expect(c.crawler.delaySeconds).toBe(2);
    expect(parseBookConfig({ id: "h", url: "https://www.69shuba.com/book/1/" }).crawler.delaySeconds).toBe(5);
  });

  it("CORE-04: cờ inline (?i) bị từ chối, kèm gợi ý dùng flags", () => {
    expect(() => parseBookConfig({ id: "x", url: SHUKU, crawler: { junkPatterns: ["(?i)abc"] } })).toThrow(/flags: "i"/);
  });

  it("sai kiểu thì báo tên trường", () => {
    expect(() => parseBookConfig({ id: "x", url: SHUKU, crawler: { delaySeconds: "2" } })).toThrow(/delaySeconds/);
    expect(() => parseBookConfig({ id: "X Y", url: SHUKU })).toThrow(ConfigError);
    expect(() => parseBookConfig({ id: "x", url: "https://unknown.example/" })).toThrow(/adapter/);
  });
});

describe("local-file", () => {
  it("định dạng raw V1: tiêu đề + các khối cách dòng trống", () => {
    const ch = parseLocalText(`第3章 夜行\n\n${LINE}\n\n${LINE}\n`, { chapterNumber: 3 });
    expect(ch.title).toBe("第3章 夜行");
    expect(ch.paragraphs).toEqual([LINE, LINE]);
  });
  it("không có dòng trống: mỗi dòng một đoạn; bỏ BOM và CRLF", () => {
    const ch = parseLocalText(`﻿第3章\r\n　　${LINE}\r\n${LINE}`, { chapterNumber: 3 });
    expect(ch.paragraphs).toEqual([LINE, LINE]);
  });
  it("tiếng Anh ngắt dòng cứng: nối lại bằng dấu cách", () => {
    const ch = parseLocalText("Chapter 1\n\nThe fog had not\nlifted yet.\n\nShe walked on.", { chapterNumber: 1 });
    expect(ch.paragraphs).toEqual(["The fog had not lifted yet.", "She walked on."]);
  });
});

describe("factory + runIngest (52shuku, mạng giả = fixture)", () => {
  it("lần 1 tải mạng; xóa raw rồi chạy lại: parse lại hoàn toàn từ cache, 0 request mạng", async () => {
    const dir = await newBook({ id: "demo", url: SHUKU, crawler: { delaySeconds: 0 } });
    const paths = new BookPaths(dir);
    const config = await loadBookConfig(paths.bookFile);
    let network = 0;
    const fake = async (url: string) => {
      network += 1;
      return fixture(`shuku52/book/${url.split("/").pop()}`);
    };

    const r1 = buildAdapter(config, paths, { network: fake, log: () => {} });
    const s1 = await runIngest({ adapter: r1.adapter, store: new RawStore(paths), bookUrl: config.url, from: 1, to: 4, log: () => {} });
    expect(s1.results.map((r) => r.outcome)).toEqual(["VALID", "VALID", "VALID", "VALID"]);
    const firstNetwork = network;
    expect(firstNetwork).toBe(6); // index + 5 trang

    await rm(paths.chaptersDir, { recursive: true });
    const r2 = buildAdapter(config, paths, { network: fake, log: () => {} });
    await runIngest({ adapter: r2.adapter, store: new RawStore(paths), bookUrl: config.url, from: 1, to: 4, log: () => {} });
    expect(network).toBe(firstNetwork);
    expect(r2.stats.misses).toBe(0);

    const src = await readFile(paths.sourceFile(2), "utf8");
    expect(src).toContain("# 第2章 旧图");
    expect(src).toMatch(/parser: shuku52@2\+junk:[0-9a-f]{8}/);
  });

  it("thêm junkPatterns vào book.yaml → fingerprint đổi → chương được parse lại (từ cache)", async () => {
    const dir = await newBook({ id: "demo", url: SHUKU, crawler: { delaySeconds: 0 } });
    const paths = new BookPaths(dir);
    const fake = async (url: string) => fixture(`shuku52/book/${url.split("/").pop()}`);
    const c1 = await loadBookConfig(paths.bookFile);
    const a1 = buildAdapter(c1, paths, { network: fake, log: () => {} });
    await runIngest({ adapter: a1.adapter, store: new RawStore(paths), bookUrl: c1.url, from: 2, to: 2, log: () => {} });

    await writeFile(paths.bookFile, stringifyYaml({ id: "demo", url: SHUKU, crawler: { delaySeconds: 0, junkPatterns: [{ pattern: "^灯芯" }] } }));
    const c2 = await loadBookConfig(paths.bookFile);
    const a2 = buildAdapter(c2, paths, { network: fake, log: () => {} });
    expect(a2.adapter.parserFingerprint).not.toBe(a1.adapter.parserFingerprint);
    const s2 = await runIngest({ adapter: a2.adapter, store: new RawStore(paths), bookUrl: c2.url, from: 2, to: 2, log: () => {} });
    expect(s2.results[0]?.outcome).toBe("VALID");
    expect(a2.stats.misses).toBe(0);
    expect(await readFile(paths.sourceFile(2), "utf8")).not.toContain("灯芯");
  });
});

describe("CLI", () => {
  it("init tạo book.yaml + .gitignore chặn .cache và browser-profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nt-init-"));
    expect(await main(["init", dir, "--url", SHUKU, "--id", "kzgd", "--from", "1", "--to", "201"])).toBe(0);
    const c = await loadBookConfig(join(dir, "book.yaml"));
    expect(c).toMatchObject({ id: "kzgd", adapter: "shuku52", chapters: { from: 1, to: 201 } });
    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gi).toContain(".cache/");
    expect(gi).toContain("browser-profile/");
    await expect(main(["init", dir, "--url", SHUKU])).rejects.toThrow(/đã tồn tại/);
  });

  it("import --dir (raw V1) → status → crosscheck khớp hash", async () => {
    const dir = await newBook({ id: "demo", url: SHUKU });
    const v1 = join(dir, "..", `${Date.now()}-v1raw`);
    await mkdir(v1, { recursive: true });
    for (const n of [1, 2, 3]) {
      const content = Array.from({ length: 10 }, (_, i) => `${n}-${i}${LINE}`).join("\n\n");
      await writeFile(join(v1, `${n}.txt`), `第${n}章 标题\n\n${content}\n`);
      await writeFile(join(v1, `${n}.meta.json`), JSON.stringify({ url: `https://x/${n}`, content_hash: contentHash(content) }));
    }
    expect(await main(["import", dir, "--dir", v1])).toBe(0);
    const s = await new RawStore(new BookPaths(dir)).load(2);
    expect(s?.frontmatter).toMatchObject({ adapter: "local-file", url: "https://x/2", title: "第2章 标题" });

    stdout = [];
    await main(["status", dir, "--from", "1", "--to", "5"]);
    expect(stdout.join("")).toMatch(/VALID\s+3/);
    expect(stdout.join("")).toMatch(/thiếu\s+2\s+4–5/);

    stdout = [];
    expect(await main(["crosscheck", dir, "--v1-raw", v1])).toBe(0);
    expect(stdout.join("")).toMatch(/Khớp hash:\s+3/);

    // Lệch một chương → crosscheck báo và trả mã 2.
    await writeFile(join(v1, "3.txt"), `第3章 标题\n\n${LINE}khác\n`);
    stdout = [];
    expect(await main(["crosscheck", dir, "--v1-raw", v1])).toBe(2);
    expect(stdout.join("")).toMatch(/Lệch hash:\s+1\s+3/);
  });

  it("lệnh sai / thiếu tham số → lỗi rõ ràng", async () => {
    await expect(main(["frobnicate", "/tmp/x"])).rejects.toThrow(/Lệnh không rõ/);
    await expect(main(["ingest"])).rejects.toThrow(/book-dir/);
    await expect(main(["status", "/nonexistent/dir"])).rejects.toThrow(/novel init/);
  });

  it("compactRanges", () => {
    expect(compactRanges([1, 2, 3, 7, 9, 10])).toBe("1–3, 7, 9–10");
    expect(compactRanges([])).toBe("");
  });
});
