import { describe, expect, it } from "vitest";
import {
  Shuku52Adapter,
  headingNumber,
  normalizeIndexUrl,
  parsePageHtml,
  parsePageList,
} from "../src/ingest/adapters/shuku52.js";
import { CrawlError } from "../src/ingest/types.js";
import { fixture, golden } from "./helpers.js";

const BASE = "https://www.52shuku.net/demo/1_b/demo01";

describe("SHUKU-01 normalizeIndexUrl", () => {
  for (const [input, expected] of Object.entries(golden<Record<string, string>>("shuku52/normalize-index-url.json"))) {
    it(input, () => expect(normalizeIndexUrl(input)).toBe(expected));
  }
});

describe("SHUKU-02 parsePageList", () => {
  it("demo01.html", () => {
    expect(parsePageList(fixture("shuku52/book/demo01.html"), { indexUrl: `${BASE}.html` })).toEqual(
      golden("shuku52/page-list.json"),
    );
  });
});

describe("SHUKU-03/04 parsePageHtml (đoạn cuối trang nằm trong <p> không đóng)", () => {
  for (const [page, expected] of Object.entries(golden<Record<string, string[]>>("shuku52/pages.json"))) {
    it(page, () => expect(parsePageHtml(fixture(`shuku52/book/${page}.html`))).toEqual(expected));
  }
});

describe("SHUKU-05 headingNumber", () => {
  for (const [input, expected] of Object.entries(golden<Record<string, number | null>>("shuku52/headings.json"))) {
    it(`${input} → ${expected}`, () => expect(headingNumber(input)).toBe(expected));
  }
});

interface ChapterGolden {
  title?: string;
  paragraphs?: string[];
  pages?: number[];
  url?: string;
  error?: string;
}

function fixtureFetcher(requested: string[]) {
  return async (url: string): Promise<string> => {
    requested.push(url);
    const name = url.split("/").pop() ?? "";
    return fixture(`shuku52/book/${name}`);
  };
}

describe("SHUKU-06..11 fetchChapter", () => {
  const chapters = golden<Record<string, ChapterGolden>>("shuku52/chapters.json");
  for (const [number, g] of Object.entries(chapters)) {
    it(`chương ${number}`, async () => {
      const requested: string[] = [];
      const adapter = new Shuku52Adapter(fixtureFetcher(requested));
      if (g.error) {
        await expect(adapter.fetchChapter(`${BASE}.html`, Number(number))).rejects.toBeInstanceOf(CrawlError);
        return;
      }
      const chapter = await adapter.fetchChapter(`${BASE}.html`, Number(number));
      expect(chapter.title).toBe(g.title);
      expect(chapter.paragraphs).toEqual(g.paragraphs);
      expect(chapter.metadata["pages"]).toEqual(g.pages);
      expect(chapter.url).toBe(g.url);
    });
  }

  it("SHUKU-08: tìm kiếm nhị phân không tải hết mọi trang", async () => {
    const requested: string[] = [];
    await new Shuku52Adapter(fixtureFetcher(requested)).fetchChapter(`${BASE}.html`, 4);
    const pageRequests = new Set(requested.filter((u) => /_\d+\.html$/.test(u)));
    expect(pageRequests.size).toBeLessThan(5);
  });
});
