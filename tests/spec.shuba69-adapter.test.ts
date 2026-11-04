import { describe, expect, it } from "vitest";
import { parseChapterHtml, Shuba69Adapter } from "../src/ingest/adapters/shuba69.js";
import { type PageLike, waitForContent } from "../src/ingest/core/browser.js";
import { checkChapter } from "../src/ingest/core/checks.js";
import { CrawlBlockedError, CrawlError, type FetchOptions } from "../src/ingest/types.js";
import { fixture } from "./helpers.js";

const BOOK = "https://www.69shuba.com/book/9001.htm";
const CHALLENGE = fixture("shuba69/challenge.html");

function siteFetcher(routes: Record<string, string>) {
  const calls: Array<{ url: string; opts: FetchOptions | undefined }> = [];
  const fetcher = async (url: string, opts?: FetchOptions) => {
    calls.push({ url, opts });
    const path = new URL(url).pathname;
    const html = routes[path];
    if (html === undefined) throw new CrawlError(`404 ${path}`);
    return html;
  };
  return { fetcher, calls };
}

const catalog = (items: Array<[string, string]>) =>
  `<div class="catalog"><ul>${items.map(([id, t]) => `<li><a href="/txt/9001/${id}">${t}</a></li>`).join("")}</ul></div>`;

describe("Shuba69Adapter", () => {
  it("chuẩn hóa URL sách, tải mục lục rồi chương; truyền waitFor đúng selector", async () => {
    const { fetcher, calls } = siteFetcher({
      "/book/9001/": catalog([["112", "第12章 雾港"]]),
      "/txt/9001/112": fixture("shuba69/chapter-basic.html"),
    });
    const ch = await new Shuba69Adapter(fetcher, { log: () => {} }).fetchChapter(BOOK, 12);
    expect(ch.title).toBe("第12章 雾港");
    expect(ch.url).toBe("https://www.69shuba.com/txt/9001/112");
    expect(calls.map((c) => c.opts?.waitFor)).toEqual([".catalog a[href*='/txt/']", ".txtnav"]);
  });

  it("SHUBA-09: chương chưa có trong mục lục → tải lại mục lục MỘT lần (fresh)", async () => {
    const routes: Record<string, string> = {
      "/book/9001/": catalog([["112", "第12章 雾港"]]),
      "/txt/9001/112": fixture("shuba69/chapter-basic.html"),
    };
    const { fetcher, calls } = siteFetcher(routes);
    const adapter = new Shuba69Adapter(fetcher, { log: () => {} });
    await adapter.fetchChapter(BOOK, 12);

    routes["/book/9001/"] = catalog([["112", "第12章 雾港"], ["113", "第13章 旧图"]]);
    routes["/txt/9001/113"] = fixture("shuba69/chapter-promo.html");
    expect((await adapter.fetchChapter(BOOK, 13)).title).toBe("第13章 旧图");

    await expect(adapter.fetchChapter(BOOK, 99)).rejects.toThrow(/mục lục hiện có 12–13/);
    const freshCatalog = calls.filter((c) => c.url.endsWith("/book/9001/") && c.opts?.fresh);
    expect(freshCatalog).toHaveLength(1);
  });

  it("SHUBA-07: số tiêu đề lệch → CrawlError; numbering order thì không kiểm", async () => {
    const routes = { "/book/9001/": catalog([["108", "第8章 错页"]]), "/txt/9001/108": fixture("shuba69/chapter-mismatch.html") };
    await expect(new Shuba69Adapter(siteFetcher(routes).fetcher, { log: () => {} }).fetchChapter(BOOK, 8)).rejects.toThrow(
      /chương 7 thay vì 8/,
    );
    const ordered = new Shuba69Adapter(siteFetcher(routes).fetcher, { numbering: "order", log: () => {} });
    expect((await ordered.fetchChapter(BOOK, 1)).title).toBe("第7章 错页");
  });

  it("SHUBA-08: HTML trả về là challenge (vd. cache cũ/fetcher HTTP) → BLOCKED", async () => {
    const { fetcher } = siteFetcher({ "/book/9001/": CHALLENGE });
    await expect(new Shuba69Adapter(fetcher, { log: () => {} }).fetchChapter(BOOK, 1)).rejects.toBeInstanceOf(CrawlBlockedError);
  });

  it("numbering nằm trong parser fingerprint", () => {
    const f = async () => "";
    expect(new Shuba69Adapter(f).parserFingerprint).not.toBe(new Shuba69Adapter(f, { numbering: "order" }).parserFingerprint);
  });

  it("matches", () => {
    const a = new Shuba69Adapter(async () => "");
    expect(a.matches("https://www.69shuba.com/book/1/")).toBe(true);
    expect(a.matches("https://www.69shu.pro/book/1/")).toBe(true);
    expect(a.matches("https://www.52shuku.net/x.html")).toBe(false);
  });
});

describe("CORE-09 với 69shuba", () => {
  it("fixture thường: tỷ lệ trích xuất ≥ 0,9 → VALID", () => {
    for (const name of ["chapter-basic", "chapter-promo", "chapter-repeated-heading"]) {
      const ch = parseChapterHtml(fixture(`shuba69/${name}.html`), { chapterNumber: Number(/\d+/.exec(name) ?? 0) || 12, url: "u" });
      const ex = ch.metadata["extraction"] as { accountedChars: number; containerChars: number };
      expect(ex.accountedChars / ex.containerChars, name).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("site đổi cấu trúc, bọc phần lớn nội dung trong <p> → SUSPECT thay vì im lặng mất đoạn", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `清晨的雾气还没散去，码头上已经挤满了等船的人。${i}`);
    const html = `<div class="txtnav"><h1>第3章 夜</h1>${lines.slice(0, 9).join("<br>")}<br><p>${lines.join("</p><p>")}</p></div>`;
    const ch = parseChapterHtml(html, { chapterNumber: 3, url: "u" });
    expect(checkChapter(ch, new Map()).status).toBe("SUSPECT");
  });
});

describe("waitForContent (vòng chờ của trình duyệt, không cần Chrome)", () => {
  function fakePage(states: Array<"challenge" | "loading" | "ready">) {
    let i = 0;
    const page: PageLike = {
      url: () => "https://www.69shuba.com/txt/9001/1",
      content: async () => (states[Math.min(i, states.length - 1)] === "challenge" ? CHALLENGE : "<html><body>loading</body></html>"),
      hasVisible: async () => states[Math.min(i, states.length - 1)] === "ready",
    };
    let t = 0;
    const clock = {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
        i += 1;
      },
    };
    return { page, clock, notes: [] as string[] };
  }

  it("selector có ngay → trả về", async () => {
    const { page, clock } = fakePage(["ready"]);
    await waitForContent(page, ".txtnav", { timeoutMs: 5000, headless: false, manualVerificationMs: 1000, ...clock });
  });

  it("challenge + headless → BLOCKED ngay, không chờ", async () => {
    const { page, clock } = fakePage(["challenge"]);
    await expect(
      waitForContent(page, ".txtnav", { timeoutMs: 5000, headless: true, manualVerificationMs: 300_000, ...clock }),
    ).rejects.toBeInstanceOf(CrawlBlockedError);
    expect(clock.now()).toBe(0);
  });

  it("challenge + có cửa sổ → thông báo, chờ người dùng tự xác minh, rồi tiếp tục", async () => {
    const { page, clock, notes } = fakePage(["challenge", "challenge", "challenge", "ready"]);
    await waitForContent(page, ".txtnav", {
      timeoutMs: 1000, headless: false, manualVerificationMs: 300_000, pollMs: 1000, notify: (m) => notes.push(m), ...clock,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/tự hoàn tất/);
  });

  it("người dùng không xác minh kịp → BLOCKED sau manualVerificationMs", async () => {
    const { page, clock } = fakePage(["challenge"]);
    await expect(
      waitForContent(page, ".txtnav", { timeoutMs: 1000, headless: false, manualVerificationMs: 5000, pollMs: 1000, notify: () => {}, ...clock }),
    ).rejects.toThrow(/Chưa hoàn tất xác minh/);
    expect(clock.now()).toBeGreaterThanOrEqual(5000);
  });

  it("không challenge mà không thấy selector → CrawlError thường (được retry), không phải BLOCKED", async () => {
    const { page, clock } = fakePage(["loading"]);
    const err = await waitForContent(page, ".txtnav", { timeoutMs: 3000, headless: false, manualVerificationMs: 1, ...clock }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CrawlError);
    expect(err).not.toBeInstanceOf(CrawlBlockedError);
  });
});
