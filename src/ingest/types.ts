/** Kết quả ingest một chương. Xem docs/blueprint-v4.md mục 6. */
export type IngestStatus = "VALID" | "SUSPECT" | "BLOCKED" | "FAILED";

export interface RawChapter {
  number: number;
  url: string;
  title: string;
  /** Đoạn văn đã lọc rác, theo thứ tự. */
  paragraphs: string[];
  metadata: Record<string, unknown>;
}

export class CrawlError extends Error {
  override name = "CrawlError";
}

/** Site chặn (challenge/bot-check). Không retry, dừng batch. Xem SHUBA-08. */
export class CrawlBlockedError extends CrawlError {
  override name = "CrawlBlockedError";
}

/** Hàm tải trang, tiêm vào adapter để test bằng fixture mà không cần mạng. */
export type Fetcher = (url: string) => Promise<string>;

export interface SourceAdapter {
  readonly id: string;
  matches(url: string): boolean;
  fetchChapter(bookUrl: string, chapterNumber: number): Promise<RawChapter>;
  discover?(bookUrl: string): Promise<number[]>;
  cleanContent(paragraphs: string[]): string[];
}
