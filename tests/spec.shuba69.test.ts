import { describe, expect, it } from "vitest";
import {
  assertTitleNumber,
  cleanContent,
  isChallengeHtml,
  parseCatalogHtml,
  parseChapterHtml,
} from "../src/ingest/adapters/shuba69.js";
import { CrawlError } from "../src/ingest/types.js";
import { fixture, golden } from "./helpers.js";

const BOOK = "https://www.69shuba.com/book/9001/";

describe("CORE-14 chương quá ngắn", () => {
  it("thông báo lỗi khớp golden message_contains", () => {
    const g = golden<{ requested: number; message_contains: string }>("shuba69/chapter-too-short.json");
    expect(() =>
      parseChapterHtml(fixture("shuba69/chapter-too-short.html"), { chapterNumber: g.requested, url: "u" }),
    ).toThrow(g.message_contains);
  });
});

describe("SHUBA-07 assertTitleNumber", () => {
  const base = { url: "u", paragraphs: [], metadata: {} };
  it("lệch số thì ném CrawlError", () => {
    expect(() => assertTitleNumber({ ...base, number: 8, title: "第7章 错页" })).toThrow(CrawlError);
  });
  it("khớp số thì cho qua", () => {
    expect(() => assertTitleNumber({ ...base, number: 7, title: "第七章" })).not.toThrow();
  });
  it("tiêu đề không có số thì cho qua", () => {
    expect(() => assertTitleNumber({ ...base, number: 1, title: "楔子" })).not.toThrow();
  });
});

describe("SHUBA-02 mục lục", () => {
  it("không có link /txt/ trong .catalog thì ném CrawlError", () => {
    const html = `<div class="catalog"><a href="/book/9001/">x</a></div><a href="/txt/9001/1">第1章</a>`;
    expect(() => parseCatalogHtml(html, { bookUrl: BOOK })).toThrow(CrawlError);
  });
});

describe("SHUBA-04 cấu trúc", () => {
  it("không có .txtnav thì ném CrawlError", () => {
    expect(() => parseChapterHtml("<html><body><p>x</p></body></html>", { chapterNumber: 1, url: "u" })).toThrow(
      /txtnav/,
    );
  });
});

describe("SHUBA-08 isChallengeHtml", () => {
  it("title 'Security Verification' (không phân biệt hoa thường)", () => {
    expect(isChallengeHtml("<html><head><title>Security Verification</title></head></html>")).toBe(true);
  });
  it("chỉ có text 'verify you are human' trong body", () => {
    expect(isChallengeHtml("<html><body><div>Please VERIFY you are human</div></body></html>")).toBe(true);
  });
});

describe("cleanContent", () => {
  it("lọc rác và đoạn rỗng của raw cũ, giữ ————", () => {
    expect(cleanContent(["  他笑了。 ", "", "(本章完)", "————"])).toEqual(["他笑了。", "————"]);
  });
});
