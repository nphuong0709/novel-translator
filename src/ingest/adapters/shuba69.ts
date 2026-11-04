import type { JunkPatternSpec } from "../core/junk.js";
import type { RawChapter } from "../types.js";

/** SHUBA-06: mẫu rác mặc định của 69shuba (port từ Shuba69Crawler.DEFAULT_JUNK_PATTERNS). */
export const SHUBA69_JUNK: readonly JunkPatternSpec[] = [];

/** SHUBA-01 */
export function normalizeBookUrl(bookUrl: string): string {
  throw new Error("TODO(SHUBA-01): normalizeBookUrl");
}

export interface CatalogResult {
  chapters: Map<number, string>;
  warnings: string[];
}

/** SHUBA-02 (numbering "title") và SHUBA-03 (numbering "order"). */
export function parseCatalogHtml(
  html: string,
  opts: { bookUrl: string; numbering?: "title" | "order" },
): CatalogResult {
  throw new Error("TODO(SHUBA-02/03): parseCatalogHtml");
}

/** SHUBA-04, -05, -06, CORE-14. Nội dung < 200 ký tự thì ném CrawlError. */
export function parseChapterHtml(
  html: string,
  opts: { chapterNumber: number; url: string; junk?: readonly RegExp[] },
): RawChapter {
  throw new Error("TODO(SHUBA-04/05/06): parseChapterHtml");
}

/** SHUBA-08: phát hiện trang challenge từ HTML (title hoặc text). */
export function isChallengeHtml(html: string): boolean {
  throw new Error("TODO(SHUBA-08): isChallengeHtml");
}
