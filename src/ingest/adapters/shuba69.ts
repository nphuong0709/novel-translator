/**
 * 69shuba: mỗi URL là một chương, mục lục ở /book/<id>/.
 * Phần này chỉ gồm parse thuần (HTML → dữ liệu), test bằng fixture, không cần mạng.
 * Vòng đời trình duyệt, cache mục lục (SHUBA-09..11) làm ở bước retry/lock/cache.
 *
 * Port từ V1 `Shuba69Crawler` (crawler.py).
 */
import * as cheerio from "cheerio";
import { charLength, directTextNodes, getTextStrip } from "../core/html.js";
import { compileJunkPatterns, isJunk, type JunkPatternSpec } from "../core/junk.js";
import { chapterNumberFromTitle } from "../core/numerals.js";
import { CrawlError, type RawChapter } from "../types.js";

export const CONTENT_SELECTOR = ".txtnav";
export const CATALOG_SELECTOR = ".catalog a[href*='/txt/']";
/** CORE-14 */
export const MIN_CONTENT_CHARS = 200;

/** SHUBA-06: mẫu rác mặc định của 69shuba (port từ Shuba69Crawler.DEFAULT_JUNK_PATTERNS). */
export const SHUBA69_JUNK: readonly JunkPatternSpec[] = [
  { pattern: String.raw`^[（(]?\s*本章完\s*[)）]?$` },
  { pattern: String.raw`^[（(][^（）()]{0,15}看更新[)）]$` },
  { pattern: String.raw`^[（(][^（）()]{0,15}(?:首发|更新最快)[^（）()]{0,10}[)）]$` },
  // V1: r"(?i)69\s*(?:shu(?:ba)?|书吧)…", CORE-04: cờ inline chuyển sang `flags`.
  { pattern: String.raw`69\s*(?:shu(?:ba)?|书吧)\s*(?:\.|。)?\s*(?:com|net|org)?`, flags: "i" },
];

/** Compile một lần, dùng lại khi caller không truyền `junk`. */
const DEFAULT_JUNK = compileJunkPatterns(SHUBA69_JUNK);

/**
 * SHUBA-01: `/book/9001.htm` → `/book/9001/`; bỏ query và fragment.
 * Khác V1 không đáng kể: `URL` của WHATWG viết thường host và thêm `/` khi path rỗng.
 */
export function normalizeBookUrl(bookUrl: string): string {
  const url = new URL(bookUrl.trim());
  url.pathname = url.pathname.replace(/(\/book\/[0-9]+)\.htm\/?$/, "$1/");
  url.search = "";
  url.hash = "";
  return url.href;
}

export interface CatalogResult {
  chapters: Map<number, string>;
  warnings: string[];
}

/** ID cuối URL `/txt/<book>/<id>`; không có thì 0 (giống V1). */
function urlId(url: string): number {
  const m = /\/([0-9]+)\/?$/.exec(new URL(url).pathname);
  return m?.[1] !== undefined ? Number(m[1]) : 0;
}

/**
 * SHUBA-02 (numbering "title") và SHUBA-03 (numbering "order").
 * Mục lục rỗng thì ném CrawlError.
 */
export function parseCatalogHtml(
  html: string,
  opts: { bookUrl: string; numbering?: "title" | "order" },
): CatalogResult {
  const { bookUrl, numbering = "title" } = opts;
  const $ = cheerio.load(html);

  // Bỏ trùng URL, giữ thứ tự xuất hiện. `Map` trong JS giữ thứ tự chèn.
  const links = new Map<string, string>(); // url → title
  for (const el of $(CATALOG_SELECTOR).toArray()) {
    const href = $(el).attr("href");
    if (!href) continue;
    const url = new URL(href, bookUrl).href;
    if (!links.has(url)) links.set(url, getTextStrip($(el)));
  }

  const chapters = new Map<number, string>();
  const warnings: string[] = [];

  if (numbering === "order") {
    // `Array.prototype.sort` ổn định từ ES2019, giống `sorted` của Python.
    const ordered = [...links.keys()].sort((a, b) => urlId(a) - urlId(b));
    ordered.forEach((url, i) => chapters.set(i + 1, url));
  } else {
    for (const [url, title] of links) {
      const n = chapterNumberFromTitle(title);
      if (n === null) continue;
      const kept = chapters.get(n);
      if (kept !== undefined) {
        warnings.push(
          `Mục lục có hai chương số ${n}; giữ ${kept}, bỏ '${title}' (${url}). ` +
            `Cân nhắc numbering: order.`,
        );
        continue;
      }
      chapters.set(n, url);
    }
  }

  if (chapters.size === 0) {
    throw new CrawlError(`Không tìm thấy danh sách chương 69shuba tại ${bookUrl}`);
  }
  return { chapters, warnings };
}

/** Gộp khoảng trắng (kể cả NBSP, U+3000) thành một dấu cách rồi trim. */
const squash = (s: string): string => s.replace(/\s+/gu, " ").trim();

/**
 * SHUBA-04, -05, -06, CORE-14. Nội dung < 200 ký tự thì ném CrawlError.
 *
 * Nội dung là các text node **trực tiếp** của `.txtnav` (ngăn bởi `<br>`), nên
 * `<h1>` và `<div class="contentadv">` tự bị loại vì là element con.
 */
export function parseChapterHtml(
  html: string,
  opts: { chapterNumber: number; url: string; junk?: readonly RegExp[] },
): RawChapter {
  const { chapterNumber, url, junk = DEFAULT_JUNK } = opts;
  const $ = cheerio.load(html);
  const container = $(CONTENT_SELECTOR).first();
  if (container.length === 0) {
    throw new CrawlError(`Không tìm thấy ${CONTENT_SELECTOR} chứa chương tại ${url}`);
  }

  let heading = container.find("h1").first();
  if (heading.length === 0) heading = $("h1").first();
  const title = heading.length > 0 ? getTextStrip(heading) : `第${chapterNumber}章`;

  const paragraphs: string[] = [];
  for (const raw of directTextNodes(container)) {
    const value = squash(raw);
    if (!value || value === title) continue;
    // SHUBA-05: tiêu đề lặp ở đầu thân bài, đôi khi khác <h1> một chút (thêm "……").
    if (
      paragraphs.length === 0 &&
      value.startsWith("第") &&
      chapterNumberFromTitle(value) === chapterNumber &&
      charLength(value) <= charLength(title) + 10
    ) {
      continue;
    }
    if (isJunk(value, junk)) continue;
    paragraphs.push(value);
  }

  const contentLength = charLength(paragraphs.join("\n\n").trim());
  if (contentLength < MIN_CONTENT_CHARS) {
    throw new CrawlError(`Nội dung chương quá ngắn (${contentLength} ký tự): ${url}`);
  }
  return { number: chapterNumber, url, title, paragraphs, metadata: {} };
}

/**
 * SHUBA-07: số trong tiêu đề ≠ số yêu cầu thì ném CrawlError (→ FAILED).
 * Tiêu đề không có số (楔子…) thì cho qua. Chỉ áp dụng khi `numbering: title`.
 */
export function assertTitleNumber(chapter: RawChapter): void {
  const n = chapterNumberFromTitle(chapter.title);
  if (n !== null && n !== chapter.number) {
    throw new CrawlError(`Trang trả về chương ${n} thay vì ${chapter.number}: ${chapter.url}`);
  }
}

/** Lọc rác lại cho raw cũ (khi bổ sung mẫu rác mới). */
export function cleanContent(paragraphs: readonly string[], junk: readonly RegExp[] = DEFAULT_JUNK): string[] {
  return paragraphs.map((p) => p.trim()).filter((p) => p && !isJunk(p, junk));
}

/**
 * SHUBA-08: phát hiện trang challenge từ HTML.
 * Title chứa "just a moment" / "security verification", hoặc text "Verify you are human"
 * (không phân biệt hoa thường, như `get_by_text(exact=False)` của Playwright).
 *
 * Chỉ để **phát hiện** và trả BLOCKED/chờ người dùng tự xác minh. Không tự vượt.
 */
export function isChallengeHtml(html: string): boolean {
  const $ = cheerio.load(html);
  const title = $("title").first().text().toLowerCase();
  if (title.includes("just a moment") || title.includes("security verification")) return true;
  return $("body").text().toLowerCase().includes("verify you are human");
}
