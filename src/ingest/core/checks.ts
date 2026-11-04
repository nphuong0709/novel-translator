/**
 * Kiểm tra sau ingest (blueprint mục 6.2). Hàm thuần: nhận chương + số liệu
 * các chương lân cận, trả trạng thái và lý do. Việc đọc số liệu lân cận do raw-store làm.
 *
 * Các kiểm tra do adapter làm (ném lỗi → FAILED/BLOCKED): challenge (SHUBA-08),
 * số tiêu đề lệch (SHUBA-07), không tìm thấy tiêu đề (SHUKU-09).
 */
import { createHash } from "node:crypto";
import type { ExtractionStats, IngestStatus, RawChapter } from "../types.js";
import { charLength } from "./html.js";

/** CORE-14: nội dung ngắn hơn ngưỡng này (đếm theo code point) thì FAILED. */
export const MIN_CONTENT_CHARS = 200;
/** CORE-09 */
export const MIN_EXTRACTION_RATIO = 0.9;
/** CORE-08 */
export const LENGTH_WINDOW = 20;
export const LENGTH_MIN_RATIO = 0.5;
export const LENGTH_MAX_RATIO = 2;
/** V1: cần ít nhất 3 chương lân cận mới so trung vị. */
export const LENGTH_MIN_SAMPLES = 3;

/**
 * Dấu hiệu rác **chưa** có trong mẫu lọc (URL, tên miền, lời mời theo dõi…).
 * Không xóa (dễ xóa nhầm câu truyện), chỉ gắn SUSPECT để người xem.
 */
export const LEFTOVER_JUNK_HINTS: readonly RegExp[] = [
  /https?:\/\//iu,
  /www\.[a-z0-9-]+\./iu,
  /[a-z0-9-]+\.(?:com|net|org|cc|vip)\b/iu,
  /请收藏|手机阅读|最新章节|求月票|求推荐票/u,
];

/** Nội dung như V1 lưu: các đoạn nối bằng dòng trống. */
export const chapterContent = (paragraphs: readonly string[]): string => paragraphs.join("\n\n").trim();

/**
 * Hash giống hệt V1 `content_hash`: sha256 của nội dung đã **bỏ mọi khoảng trắng**.
 * Dùng cho CORE-07 và so chéo với raw V1 (blueprint mục 8.5).
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content.replace(/\s+/gu, ""), "utf8").digest("hex");
}

export const sha256 = (text: string): string => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

export interface NeighborInfo {
  contentHash: string;
  sourceChars: number;
}

export interface CheckResult {
  status: Exclude<IngestStatus, "BLOCKED">;
  issues: string[];
  contentHash: string;
  sourceChars: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function isExtractionStats(v: unknown): v is ExtractionStats {
  const o = v as Partial<ExtractionStats> | null;
  return typeof o?.accountedChars === "number" && typeof o.containerChars === "number";
}

export function checkChapter(chapter: RawChapter, neighbors: ReadonlyMap<number, NeighborInfo>): CheckResult {
  const content = chapterContent(chapter.paragraphs);
  const digest = contentHash(content);
  const sourceChars = charLength(content);
  const failed: string[] = [];
  const suspect: string[] = [];

  if (sourceChars < MIN_CONTENT_CHARS) failed.push(`Nội dung quá ngắn (${sourceChars} ký tự).`);

  // CORE-07
  for (const n of [chapter.number - 1, chapter.number + 1]) {
    if (neighbors.get(n)?.contentHash === digest) {
      failed.push(`Nội dung trùng với chương ${n}; site có thể đã trả nhầm trang.`);
    }
  }

  // CORE-09
  const ex = chapter.metadata["extraction"];
  if (isExtractionStats(ex) && ex.containerChars > 0) {
    const ratio = ex.accountedChars / ex.containerChars;
    if (ratio < MIN_EXTRACTION_RATIO) {
      suspect.push(
        `Tỷ lệ trích xuất ${ratio.toFixed(2)} < ${MIN_EXTRACTION_RATIO} (${ex.accountedChars}/${ex.containerChars} ký tự); HTML có thể hỏng làm mất đoạn.`,
      );
    }
  }

  // CORE-08: chỉ so với chương trong phạm vi ±20.
  const lengths = [...neighbors]
    .filter(([n]) => n !== chapter.number && Math.abs(n - chapter.number) <= LENGTH_WINDOW)
    .map(([, info]) => info.sourceChars)
    .filter((c) => c > 0);
  if (lengths.length >= LENGTH_MIN_SAMPLES) {
    const m = median(lengths);
    if (sourceChars < m * LENGTH_MIN_RATIO) {
      suspect.push(`Chương ngắn bất thường: ${sourceChars} ký tự so với trung vị ${Math.round(m)} (±${LENGTH_WINDOW} chương); có thể bị cắt cụt.`);
    } else if (sourceChars > m * LENGTH_MAX_RATIO) {
      suspect.push(`Chương dài bất thường: ${sourceChars} ký tự so với trung vị ${Math.round(m)} (±${LENGTH_WINDOW} chương); có thể bị gộp chương.`);
    }
  }

  // Còn dấu hiệu rác sau khi lọc.
  for (const p of chapter.paragraphs) {
    const hint = LEFTOVER_JUNK_HINTS.find((re) => re.test(p));
    if (hint) suspect.push(`Đoạn nghi là rác còn sót: "${[...p].slice(0, 40).join("")}"`);
  }

  const status = failed.length ? "FAILED" : suspect.length ? "SUSPECT" : "VALID";
  return { status, issues: [...failed, ...suspect], contentHash: digest, sourceChars };
}
