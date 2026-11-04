/**
 * Số chữ Hán và số chương trong tiêu đề.
 * Port từ V1 `crawler.py` (`chinese_numeral_to_int`, `chapter_number_from_title`).
 */

const CHINESE_DIGITS: ReadonlyMap<string, number> = new Map([
  ["零", 0], ["〇", 0], ["一", 1], ["二", 2], ["两", 2], ["三", 3], ["四", 4],
  ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9],
]);

const CHINESE_UNITS: ReadonlyMap<string, number> = new Map([
  ["十", 10], ["百", 100], ["千", 1000],
]);

/**
 * `第 N 章`: N là số Ả Rập (ASCII hoặc full-width) hoặc chữ Hán.
 * Không có cờ `g`, nên `exec` không giữ `lastIndex` giữa các lần gọi.
 * `\s` của JS khớp cả khoảng trắng Unicode (U+3000), giống `re` của Python 3.
 */
export const CHAPTER_NUMBER_RE = /第\s*([0-9０-９]+|[零〇一二两三四五六七八九十百千万]+)\s*章/u;

/**
 * CORE-01: số chữ Hán → number. Ví dụ "一百零五" → 105, "四一二" → 412.
 * Ném lỗi nếu có ký tự không phải số chữ Hán.
 *
 * Hai dạng:
 *  - Viết từng chữ số (chỉ gồm chữ số, dài > 1): "四一二" → 412.
 *  - Có đơn vị 十/百/千/万: "两千零五" → 2005, "十二" → 12 (十 đứng đầu ngầm hiểu là 一十).
 *
 * Giống V1: chuỗi rỗng trả 0.
 */
export function chineseNumeralToInt(text: string): number {
  // Duyệt theo code point (`for…of` / spread), không theo `text[i]`. Các ký tự ở đây
  // đều thuộc BMP nên kết quả như nhau, nhưng đây là thói quen đúng khi xử lý chữ Hán.
  const chars = [...text];

  if (chars.length > 1 && chars.every((c) => CHINESE_DIGITS.has(c))) {
    return Number(chars.map((c) => CHINESE_DIGITS.get(c)).join(""));
  }

  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of chars) {
    const digit = CHINESE_DIGITS.get(char);
    const unit = CHINESE_UNITS.get(char);
    if (digit !== undefined) {
      number = digit;
    } else if (unit !== undefined) {
      // `||` (không phải `??`): number = 0 cũng phải coi là 1, giống `number or 1` của Python.
      section += (number || 1) * unit;
      number = 0;
    } else if (char === "万") {
      total += (section + number) * 10_000;
      section = 0;
      number = 0;
    } else {
      throw new RangeError(`Không phải số chữ Hán: ${text}`);
    }
  }
  return total + section + number;
}

/**
 * CORE-02: số chương trong tiêu đề `第N章`, N là số Ả Rập (kể cả full-width) hoặc chữ Hán.
 * Không có thì trả null.
 *
 * Bẫy TS: `parseInt("４１２")` ra NaN (Python `int()` thì nhận được), nên phải
 * `normalize("NFKC")` để đổi full-width về ASCII trước.
 */
export function chapterNumberFromTitle(title: string): number | null {
  const value = CHAPTER_NUMBER_RE.exec(title)?.[1];
  if (value === undefined) return null;

  const ascii = value.normalize("NFKC");
  if (/^[0-9]+$/.test(ascii)) return Number.parseInt(ascii, 10);

  try {
    return chineseNumeralToInt(value);
  } catch {
    // Regex chỉ cho qua ký tự số chữ Hán nên nhánh này thực tế không xảy ra;
    // giữ lại cho khớp V1 (ValueError → None).
    return null;
  }
}
