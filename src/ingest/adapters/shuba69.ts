/**
 * 69shuba: mỗi URL là một chương, mục lục ở /book/<id>/.
 *
 * - Parse thuần (HTML → dữ liệu): test bằng fixture.
 * - `Shuba69Adapter`: mục lục + chương qua `Fetcher` tiêm vào. Khi chạy thật, fetcher là
 *   `cachedFetcher(politeFetcher(BrowserFetcher))`: cache hit thì không mở Chrome (SHUBA-10).
 *
 * Port từ V1 `Shuba69Crawler` (crawler.py).
 */
import * as cheerio from "cheerio";
import { isChallengeHtml } from "../core/challenge.js";
import { MIN_CONTENT_CHARS } from "../core/checks.js";
import { charLength, directTextNodes, getTextStrip } from "../core/html.js";
import { compileJunkPatterns, isJunk, type JunkPatternSpec, parserFingerprint } from "../core/junk.js";
import { chapterNumberFromTitle } from "../core/numerals.js";
import { CrawlBlockedError, CrawlError, type Fetcher, type RawChapter, type SourceAdapter } from "../types.js";

export { isChallengeHtml };

export const CONTENT_SELECTOR = ".txtnav";
export const CATALOG_SELECTOR = ".catalog a[href*='/txt/']";
/** Tăng khi đổi cách parse để raw cũ được parse lại từ cache HTML. */
export const PARSER_VERSION = 1;

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

  // CORE-09: "giải trình" = text trực tiếp (giữ hoặc bỏ) + <h1> + khối quảng cáo đã biết.
  // Text nằm trong thẻ con lạ (site đổi cấu trúc, bọc nội dung trong <p>/<span>) sẽ
  // không được giải trình → tỷ lệ thấp → SUSPECT.
  const nonSpace = (s: string): number => charLength(s.replace(/\s+/gu, ""));
  const accountedChars =
    directTextNodes(container).reduce((sum, t) => sum + nonSpace(t), 0) +
    nonSpace(getTextStrip(container.find("h1"), "")) +
    nonSpace(getTextStrip(container.find(".contentadv"), ""));
  const containerChars = nonSpace(getTextStrip(container, ""));
  return { number: chapterNumber, url, title, paragraphs, metadata: { extraction: { accountedChars, containerChars } } };
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

export interface Shuba69Options {
  /** Mẫu rác **đã compile** (mặc định + bổ sung từ book.yaml). */
  junk?: readonly RegExp[];
  numbering?: "title" | "order";
  /** SHUBA-07, mặc định true. Chỉ có tác dụng khi `numbering: title`. */
  verifyTitleNumber?: boolean;
  log?: (msg: string) => void;
}

/**
 * SHUBA-02..10 trên một `Fetcher`. Mục lục đi qua cache HTML như mọi trang khác;
 * chương chưa có trong mục lục thì tải lại mục lục **một lần** mỗi lần chạy (SHUBA-09).
 */
export class Shuba69Adapter implements SourceAdapter {
  readonly id = "shuba69";
  readonly parserFingerprint: string;
  private readonly junk: readonly RegExp[];
  private readonly numbering: "title" | "order";
  private readonly verifyTitleNumber: boolean;
  private readonly log: (msg: string) => void;

  private catalogUrl: string | null = null;
  private chapters = new Map<number, string>();
  private catalogFresh = false;

  constructor(
    private readonly fetcher: Fetcher,
    opts: Shuba69Options = {},
  ) {
    this.junk = opts.junk ?? DEFAULT_JUNK;
    this.numbering = opts.numbering ?? "title";
    this.verifyTitleNumber = opts.verifyTitleNumber ?? true;
    this.log = opts.log ?? ((m) => console.error(m));
    // numbering đổi cách đánh số chương → đưa vào fingerprint để raw cũ không bị dùng nhầm.
    this.parserFingerprint = parserFingerprint(`${this.id}:${this.numbering}`, PARSER_VERSION, this.junk);
  }

  matches(url: string): boolean {
    return /(^|\.)69shu(ba)?\./.test(new URL(url).hostname);
  }

  cleanContent(paragraphs: string[]): string[] {
    return cleanContent(paragraphs, this.junk);
  }

  /** Tải trang và chặn trường hợp HTML là trang challenge (kể cả từ fetcher không phải trình duyệt). */
  private async load(url: string, waitFor: string, fresh: boolean): Promise<string> {
    const html = await this.fetcher(url, fresh ? { waitFor, fresh } : { waitFor });
    if (isChallengeHtml(html)) throw new CrawlBlockedError(`69shuba trả trang xác minh tại ${url}`);
    return html;
  }

  private async loadCatalog(catalogUrl: string, fresh: boolean): Promise<void> {
    const html = await this.load(catalogUrl, CATALOG_SELECTOR, fresh);
    const { chapters, warnings } = parseCatalogHtml(html, { bookUrl: catalogUrl, numbering: this.numbering });
    for (const w of warnings) this.log(`Cảnh báo mục lục: ${w}`);
    this.catalogUrl = catalogUrl;
    this.chapters = chapters;
    if (fresh) this.catalogFresh = true;
  }

  private async chapterUrl(bookUrl: string, n: number): Promise<string> {
    const catalogUrl = normalizeBookUrl(bookUrl);
    if (this.catalogUrl !== catalogUrl) {
      this.catalogFresh = false;
      await this.loadCatalog(catalogUrl, false);
    }
    if (!this.chapters.has(n) && !this.catalogFresh) {
      this.log(`Mục lục chưa có chương ${n}; tải lại mục lục.`);
      await this.loadCatalog(catalogUrl, true);
    }
    const url = this.chapters.get(n);
    if (url === undefined) {
      const known = [...this.chapters.keys()].sort((a, b) => a - b);
      throw new CrawlError(`Không có chương ${n}; mục lục hiện có ${known[0]}–${known.at(-1)}.`);
    }
    return url;
  }

  async fetchChapter(bookUrl: string, chapterNumber: number): Promise<RawChapter> {
    const url = await this.chapterUrl(bookUrl, chapterNumber);
    const html = await this.load(url, CONTENT_SELECTOR, false);
    const chapter = parseChapterHtml(html, { chapterNumber, url, junk: this.junk });
    if (this.numbering === "title" && this.verifyTitleNumber) assertTitleNumber(chapter);
    return chapter;
  }
}
