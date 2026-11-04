/** Kết quả ingest một chương. Xem docs/blueprint-v4.md mục 6. */
export type IngestStatus = "VALID" | "SUSPECT" | "BLOCKED" | "FAILED";

/**
 * CORE-09: số ký tự (không tính khoảng trắng) parser đã "giải trình" được so với
 * toàn bộ text của container. "Giải trình" = giữ lại + bỏ có chủ đích (rác, tiêu đề).
 * Tỷ lệ thấp nghĩa là có text bị mất mà parser không biết (ví dụ lỗi `<p>` không đóng).
 */
export interface ExtractionStats {
  accountedChars: number;
  containerChars: number;
}

export interface RawChapter {
  number: number;
  url: string;
  title: string;
  /** Đoạn văn đã lọc rác, theo thứ tự. */
  paragraphs: string[];
  /** Tùy adapter: `pages` (52shuku), `extraction` (ExtractionStats)… */
  metadata: Record<string, unknown>;
}

export class CrawlError extends Error {
  override name = "CrawlError";
}

/** Site chặn (challenge/bot-check). Không retry, dừng batch. Xem SHUBA-08. */
export class CrawlBlockedError extends CrawlError {
  override name = "CrawlBlockedError";
}

export interface FetchOptions {
  /** Bỏ qua cache, tải lại từ mạng (mục lục cần làm mới, `--recrawl`). */
  fresh?: boolean;
  /** Selector phải xuất hiện thì trang mới coi là tải xong (dùng cho trình duyệt). */
  waitFor?: string;
}

/** Hàm tải trang, tiêm vào adapter để test bằng fixture mà không cần mạng. */
export type Fetcher = (url: string, opts?: FetchOptions) => Promise<string>;

export interface SourceAdapter {
  readonly id: string;
  /**
   * Phiên bản parser + hash cấu hình lọc rác. Raw có fingerprint khác thì được
   * parse lại (từ HTML đã cache nếu có), không bị bỏ qua. Xem CORE-12, CORE-13.
   */
  readonly parserFingerprint: string;
  matches(url: string): boolean;
  fetchChapter(bookUrl: string, chapterNumber: number): Promise<RawChapter>;
  discover?(bookUrl: string): Promise<number[]>;
  cleanContent(paragraphs: string[]): string[];
  /** Giải phóng tài nguyên (đóng trình duyệt…). */
  close?(): Promise<void>;
}
