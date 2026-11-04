/**
 * CORE-01: số chữ Hán → number. Ví dụ "一百零五" → 105, "四一二" → 412.
 * Ném lỗi nếu có ký tự không phải số chữ Hán.
 */
export function chineseNumeralToInt(text: string): number {
  throw new Error(`TODO(CORE-01): chineseNumeralToInt(${text})`);
}

/**
 * CORE-02: số chương trong tiêu đề `第N章`, N là số Ả Rập (kể cả full-width) hoặc chữ Hán.
 * Không có thì trả null. Gợi ý: normalize("NFKC") trước khi parseInt.
 */
export function chapterNumberFromTitle(title: string): number | null {
  throw new Error(`TODO(CORE-02): chapterNumberFromTitle(${title})`);
}
