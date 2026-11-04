/**
 * 52shuku: nội dung chia theo **trang** (`<id>_N.html`), không theo chương.
 * Một chương có thể trải qua nhiều trang và một trang có thể chứa đầu chương mới.
 * Adapter tìm trang chứa tiêu đề `第N章` bằng tìm kiếm nhị phân rồi ghép tới tiêu đề kế.
 *
 * Phần này: parse thuần + thuật toán ghép, với `Fetcher` tiêm vào (test bằng fixture).
 * Cache trang ra đĩa kèm parserVersion (SHUKU-10), HTTP/retry/challenge làm ở bước sau.
 *
 * Port từ V1 `Shuku52Crawler` (crawler.py).
 */
import * as cheerio from "cheerio";
import { MIN_CONTENT_CHARS } from "../core/checks.js";
import { charLength, escapeRegExp, ownText } from "../core/html.js";
import { compileJunkPatterns, isJunk, type JunkPatternSpec } from "../core/junk.js";
import { CHAPTER_NUMBER_RE, chapterNumberFromTitle } from "../core/numerals.js";
import { CrawlError, type Fetcher, type RawChapter, type SourceAdapter } from "../types.js";

export const CONTENT_SELECTOR = "article.article-content";
/** Tăng khi đổi cách parse để cache trang cũ (parse sai) tự bị tải lại. Giữ số của V1. */
export const PARSER_VERSION = 2;

/** SHUKU-04: mẫu rác mặc định của 52shuku. */
export const SHUKU52_JUNK: readonly JunkPatternSpec[] = [
  { pattern: String.raw`52\s*书库` },
  // V1: r"(?i)52\s*shuku", CORE-04: cờ inline chuyển sang `flags`.
  { pattern: String.raw`52\s*shuku`, flags: "i" },
  { pattern: String.raw`^(?:上一页|下一页|目录|返回目录)$` },
  { pattern: String.raw`^传送门[：:]` },
];

const DEFAULT_JUNK = compileJunkPatterns(SHUKU52_JUNK);

/** SHUKU-01: `<id>_7.html` → `<id>.html`; bỏ query và fragment. */
export function normalizeIndexUrl(bookUrl: string): string {
  const url = new URL(bookUrl.trim());
  url.pathname = url.pathname.replace(/_[0-9]+\.html$/, ".html");
  url.search = "";
  url.hash = "";
  return url.href;
}

/**
 * SHUKU-02: [số trang, URL], tăng dần, bỏ trùng (giữ link đầu tiên);
 * bỏ link của truyện khác (stem khác). Không có trang nào thì ném CrawlError.
 */
export function parsePageList(html: string, opts: { indexUrl: string }): Array<[number, string]> {
  const { indexUrl } = opts;
  const stem = (new URL(indexUrl).pathname.split("/").pop() ?? "").replace(/\.html$/, "");
  const pattern = new RegExp(`/${escapeRegExp(stem)}_([0-9]+)\\.html$`, "u");

  const $ = cheerio.load(html);
  const pages = new Map<number, string>();
  for (const el of $("a[href]").toArray()) {
    const href = $(el).attr("href");
    if (!href) continue;
    const url = new URL(href, indexUrl).href;
    const m = pattern.exec(new URL(url).pathname);
    if (m?.[1] === undefined) continue;
    const n = Number(m[1]);
    if (!pages.has(n)) pages.set(n, url);
  }
  if (pages.size === 0) {
    throw new CrawlError(`Không tìm thấy danh sách trang nội dung tại ${indexUrl}`);
  }
  return [...pages].sort(([a], [b]) => a - b);
}

/**
 * SHUKU-03, -04: đoạn văn đã lọc của một trang. Mỗi <p> chỉ lấy text của chính nó
 * (xem `ownText`), nên đoạn cuối nằm trong `<p>` không đóng vẫn còn.
 */
export function parsePageHtml(html: string, opts: { junk?: readonly RegExp[] } = {}): string[] {
  const { junk = DEFAULT_JUNK } = opts;
  const $ = cheerio.load(html);
  const container = $(CONTENT_SELECTOR).first();
  if (container.length === 0) {
    throw new CrawlError(`Không tìm thấy ${CONTENT_SELECTOR} chứa nội dung`);
  }
  const paragraphs: string[] = [];
  for (const el of container.find("p").toArray()) {
    const value = ownText($(el)).replace(/\s+/gu, " ").trim();
    if (value && !isJunk(value, junk)) paragraphs.push(value);
  }
  return paragraphs;
}

/** `CHAPTER_NUMBER_RE` neo ở đầu chuỗi, tương đương `re.match` của Python. */
const HEADING_PREFIX_RE = new RegExp(`^(?:${CHAPTER_NUMBER_RE.source})`, CHAPTER_NUMBER_RE.flags);
const HEADING_MAX_CHARS = 40;
const SENTENCE_END = ["。", "”", "？", "！"] as const;
/** Ký tự được phép đứng ngay sau `第N章` (ngoài khoảng trắng). */
const HEADING_SEPARATORS = new Set([..."：:、.．-—（("]);

/**
 * SHUKU-05: số chương nếu đoạn là dòng tiêu đề, ngược lại null.
 * Bắt đầu bằng `第N章`, ≤ 40 ký tự, không kết thúc như câu văn, và ngay sau `第N章` là
 * hết dòng / khoảng trắng / dấu phân cách. Nhờ vậy `第1章里那句话…` không bị nhận nhầm.
 */
export function headingNumber(paragraph: string): number | null {
  const value = paragraph.trim();
  if (!value.startsWith("第") || charLength(value) > HEADING_MAX_CHARS) return null;
  if (SENTENCE_END.some((end) => value.endsWith(end))) return null;

  const m = HEADING_PREFIX_RE.exec(value);
  if (!m) return null;
  const next = [...value.slice(m[0].length)][0];
  if (next !== undefined && !/\s/u.test(next) && !HEADING_SEPARATORS.has(next)) return null;
  return chapterNumberFromTitle(value);
}

export interface Shuku52Options {
  junk?: readonly RegExp[];
}

/**
 * SHUKU-06..11: ghép các trang thành chương N bằng tìm kiếm nhị phân.
 * `fetcher` được tiêm vào để test bằng fixture; metadata.pages = số trang đã ghép.
 *
 * Trạng thái trong bộ nhớ (danh sách trang, đoạn đã parse, vị trí tiêu đề) được giữ
 * giữa các lần gọi cùng một truyện, nên cào nhiều chương liên tiếp không tải lại trang.
 */
export class Shuku52Adapter implements SourceAdapter {
  readonly id = "shuku52";
  private readonly junk: readonly RegExp[];

  private indexUrl: string | null = null;
  /** [số trang, URL] theo thứ tự đọc. */
  private pages: Array<[number, string]> = [];
  /** index trang → đoạn văn đã lọc. */
  private readonly pageCache = new Map<number, string[]>();
  /** index trang → số chương đang diễn ra ở cuối trang. */
  private readonly chapterAtCache = new Map<number, number>();
  /** số chương → index trang chứa tiêu đề (lần xuất hiện đầu tiên). */
  private readonly headingPage = new Map<number, number>();

  constructor(
    private readonly fetcher: Fetcher,
    opts: Shuku52Options = {},
  ) {
    this.junk = opts.junk ?? DEFAULT_JUNK;
  }

  matches(url: string): boolean {
    return /(^|\.)52shuku\./.test(new URL(url).hostname);
  }

  cleanContent(paragraphs: string[]): string[] {
    return paragraphs.map((p) => p.trim()).filter((p) => p && !isJunk(p, this.junk));
  }

  async fetchChapter(bookUrl: string, chapterNumber: number): Promise<RawChapter> {
    await this.loadPages(bookUrl);
    const start = await this.locate(chapterNumber);

    let title = "";
    const body: string[] = [];
    let collecting = false;
    let finished = false;
    let index = start;
    while (index < this.pages.length && !finished) {
      for (const paragraph of await this.paragraphs(index)) {
        const n = headingNumber(paragraph);
        if (!collecting) {
          if (n === chapterNumber) {
            collecting = true;
            title = paragraph;
          }
          continue;
        }
        // SHUKU-07: chỉ tiêu đề chương *sau* mới kết thúc chương; số nhỏ hơn là
        // câu văn nhắc lại chương cũ.
        if (n !== null && n > chapterNumber) {
          finished = true;
          break;
        }
        body.push(paragraph);
      }
      index += 1;
    }

    const contentLength = charLength(body.join("\n\n").trim());
    if (contentLength < MIN_CONTENT_CHARS) {
      throw new CrawlError(`Nội dung chapter ${chapterNumber} quá ngắn (${contentLength} ký tự).`);
    }
    return {
      number: chapterNumber,
      url: this.pageAt(start)[1],
      title: title || `第${chapterNumber}章`,
      paragraphs: body,
      // SHUKU-11: `index` đã vượt qua trang cuối được đọc, giống slice `[start:index]` của V1.
      metadata: { pages: this.pages.slice(start, index).map(([n]) => n) },
    };
  }

  // ------------------------------------------------------------------

  private pageAt(index: number): [number, string] {
    const page = this.pages[index];
    if (page === undefined) throw new RangeError(`Trang index ${index} ngoài phạm vi`);
    return page;
  }

  private async loadPages(bookUrl: string): Promise<void> {
    const indexUrl = normalizeIndexUrl(bookUrl);
    if (this.indexUrl === indexUrl && this.pages.length > 0) return;
    const pages = parsePageList(await this.fetcher(indexUrl), { indexUrl });
    this.indexUrl = indexUrl;
    this.pages = pages;
    this.pageCache.clear();
    this.chapterAtCache.clear();
    this.headingPage.clear();
  }

  private async paragraphs(index: number): Promise<string[]> {
    const cached = this.pageCache.get(index);
    if (cached) return cached;
    const [, url] = this.pageAt(index);
    const paragraphs = parsePageHtml(await this.fetcher(url), { junk: this.junk });
    this.pageCache.set(index, paragraphs);
    for (const p of paragraphs) {
      const n = headingNumber(p);
      if (n !== null && !this.headingPage.has(n)) this.headingPage.set(n, index);
    }
    return paragraphs;
  }

  /**
   * Số chương đang diễn ra ở cuối trang `index` (0 = phần giới thiệu).
   * Trang không có tiêu đề thì lùi dần về trang trước (hoặc dùng kết quả đã nhớ).
   */
  private async chapterAt(index: number): Promise<number> {
    const memo = this.chapterAtCache.get(index);
    if (memo !== undefined) return memo;
    let result = 0;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const headings = (await this.paragraphs(cursor))
        .map(headingNumber)
        .filter((n): n is number => n !== null);
      const last = headings.at(-1);
      if (last !== undefined) {
        result = last;
        break;
      }
      const prev = this.chapterAtCache.get(cursor - 1);
      if (prev !== undefined) {
        result = prev;
        break;
      }
    }
    this.chapterAtCache.set(index, result);
    return result;
  }

  /** SHUKU-08, -09: index trang chứa tiêu đề `第N章`, bằng tìm kiếm nhị phân. */
  private async locate(chapterNumber: number): Promise<number> {
    const known = this.headingPage.get(chapterNumber);
    if (known !== undefined) return known;

    let low = 0;
    let high = this.pages.length - 1;
    const last = await this.chapterAt(high);
    if (last < chapterNumber) {
      throw new CrawlError(`Không có chapter ${chapterNumber}; chương cuối là ${last}.`);
    }
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((await this.chapterAt(middle)) >= chapterNumber) high = middle;
      else low = middle + 1;
    }
    await this.paragraphs(low);
    const found = this.headingPage.get(chapterNumber);
    if (found === undefined) {
      throw new CrawlError(`Không tìm thấy tiêu đề 第${chapterNumber}章 (site có thể nhảy số chương).`);
    }
    return found;
  }
}
