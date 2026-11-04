import type { JunkPatternSpec } from "../core/junk.js";
import type { Fetcher, RawChapter } from "../types.js";

/** SHUKU-04: mẫu rác mặc định của 52shuku. */
export const SHUKU52_JUNK: readonly JunkPatternSpec[] = [];

/** SHUKU-01 */
export function normalizeIndexUrl(bookUrl: string): string {
  throw new Error("TODO(SHUKU-01): normalizeIndexUrl");
}

/** SHUKU-02: [số trang, URL], tăng dần. */
export function parsePageList(html: string, opts: { indexUrl: string }): Array<[number, string]> {
  throw new Error("TODO(SHUKU-02): parsePageList");
}

/** SHUKU-03, -04: đoạn văn đã lọc của một trang. Mỗi <p> chỉ lấy text của chính nó. */
export function parsePageHtml(html: string, opts: { junk?: readonly RegExp[] } = {}): string[] {
  throw new Error("TODO(SHUKU-03/04): parsePageHtml");
}

/** SHUKU-05: số chương nếu đoạn là dòng tiêu đề, ngược lại null. */
export function headingNumber(paragraph: string): number | null {
  throw new Error("TODO(SHUKU-05): headingNumber");
}

/**
 * SHUKU-06..11: ghép các trang thành chương N bằng tìm kiếm nhị phân.
 * `fetcher` được tiêm vào để test bằng fixture; metadata.pages = số trang đã ghép.
 */
export class Shuku52Adapter {
  constructor(private readonly fetcher: Fetcher) {}

  async fetchChapter(bookUrl: string, chapterNumber: number): Promise<RawChapter> {
    throw new Error(`TODO(SHUKU-06..11): fetchChapter(${bookUrl}, ${chapterNumber})`);
  }
}
