import { describe, expect, it } from "vitest";
import {
  isChallengeHtml,
  normalizeBookUrl,
  parseCatalogHtml,
  parseChapterHtml,
} from "../src/ingest/adapters/shuba69.js";
import { chapterNumberFromTitle } from "../src/ingest/core/numerals.js";
import { CrawlError } from "../src/ingest/types.js";
import { fixture, golden } from "./helpers.js";

const BOOK = "https://www.69shuba.com/book/9001/";

describe("SHUBA-01 normalizeBookUrl", () => {
  for (const [input, expected] of Object.entries(golden<Record<string, string>>("shuba69/normalize-book-url.json"))) {
    it(input, () => expect(normalizeBookUrl(input)).toBe(expected));
  }
});

describe("SHUBA-02/03 parseCatalogHtml", () => {
  for (const name of ["catalog-title", "catalog-order"]) {
    it(name, () => {
      const g = golden<{ numbering: "title" | "order"; chapters: Record<string, string>; warning_count: number }>(
        `shuba69/${name}.json`,
      );
      const result = parseCatalogHtml(fixture(`shuba69/${name}.html`), { bookUrl: BOOK, numbering: g.numbering });
      expect(Object.fromEntries([...result.chapters].map(([n, u]) => [String(n), u]))).toEqual(g.chapters);
      expect(result.warnings).toHaveLength(g.warning_count);
    });
  }
});

interface ChapterGolden {
  requested: number;
  title?: string;
  paragraphs?: string[];
  title_number?: number | null;
  expected_status: "VALID" | "FAILED";
  error?: string;
}

describe("SHUBA-04..07 parseChapterHtml", () => {
  for (const name of [
    "chapter-basic",
    "chapter-promo",
    "chapter-repeated-heading",
    "chapter-mismatch",
    "chapter-too-short",
  ]) {
    it(name, () => {
      const g = golden<ChapterGolden>(`shuba69/${name}.json`);
      const opts = { chapterNumber: g.requested, url: `https://www.69shuba.com/txt/9001/${g.requested}` };
      if (g.error) {
        expect(() => parseChapterHtml(fixture(`shuba69/${name}.html`), opts)).toThrow(CrawlError);
        return;
      }
      const chapter = parseChapterHtml(fixture(`shuba69/${name}.html`), opts);
      expect(chapter.title).toBe(g.title);
      expect(chapter.paragraphs).toEqual(g.paragraphs);
      // SHUBA-07: trong fetchChapter, số tiêu đề lệch số yêu cầu → FAILED
      const titleNumber = chapterNumberFromTitle(chapter.title);
      expect(titleNumber).toBe(g.title_number);
      const status = titleNumber !== null && titleNumber !== g.requested ? "FAILED" : "VALID";
      expect(status).toBe(g.expected_status);
    });
  }
});

describe("SHUBA-08 isChallengeHtml", () => {
  it("trang Cloudflare", () => {
    expect(isChallengeHtml(fixture("shuba69/challenge.html"))).toBe(golden<{ is_challenge: boolean }>("shuba69/challenge.json").is_challenge);
  });
  it("trang chương bình thường", () => {
    expect(isChallengeHtml(fixture("shuba69/chapter-basic.html"))).toBe(false);
  });
});
