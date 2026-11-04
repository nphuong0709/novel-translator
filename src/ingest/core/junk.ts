/**
 * Lọc rác theo từng đoạn. Port từ V1 `compile_junk_patterns` / `is_junk`.
 */
import { createHash } from "node:crypto";

/** CORE-04: regex trong config phải ở dạng {pattern, flags} vì JS không hỗ trợ cờ inline (?i). */
export interface JunkPatternSpec {
  pattern: string;
  flags?: string;
}

/**
 * Cờ `g`/`y` làm `RegExp.test` có trạng thái (`lastIndex`): cùng một đoạn có thể
 * lúc khớp lúc không. Mẫu rác dùng lại cho hàng nghìn đoạn nên chặn hẳn hai cờ này.
 */
const STATEFUL_FLAGS = /[gy]/;

/**
 * CORE-03: ghép mặc định của adapter với mẫu bổ sung; regex sai thì ném lỗi rõ ràng.
 *
 * Luôn bật cờ `u`, cho gần với `re` của Python (str pattern mặc định là Unicode) và để
 * `.`, `[^…]` xử lý theo code point. Lưu ý: `\w`, `\b` của JS vẫn chỉ là ASCII kể cả có `u`,
 * khác Python. Mẫu nào cần khớp chữ Hán thì ghi rõ ký tự hoặc dùng `\p{Script=Han}`.
 */
export function compileJunkPatterns(
  defaults: readonly JunkPatternSpec[],
  extra: readonly JunkPatternSpec[] = [],
): RegExp[] {
  return [...defaults, ...extra].map(({ pattern, flags = "" }) => {
    if (STATEFUL_FLAGS.test(flags)) {
      throw new Error(`junkPatterns: không dùng cờ g/y cho '${pattern}' (flags: '${flags}')`);
    }
    const finalFlags = flags.includes("u") ? flags : `${flags}u`;
    try {
      return new RegExp(pattern, finalFlags);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`junkPatterns có regex lỗi '${pattern}' (flags: '${flags}'): ${reason}`, {
        cause: err,
      });
    }
  });
}

/**
 * Fingerprint parser: `<adapter>@<parserVersion>+junk:<8 hex>`. Đổi parser **hoặc**
 * mẫu rác (kể cả `junkPatterns` trong book.yaml) thì fingerprint đổi, raw cũ được
 * parse lại từ HTML cache (CORE-12, CORE-13).
 */
export function parserFingerprint(adapterId: string, parserVersion: number, junk: readonly RegExp[]): string {
  const spec = junk.map((re) => `${re.flags}/${re.source}`).join("\n");
  const digest = createHash("sha256").update(spec, "utf8").digest("hex").slice(0, 8);
  return `${adapterId}@${parserVersion}+junk:${digest}`;
}

/**
 * CORE-03: đoạn (đã trim) khớp bất kỳ mẫu nào thì là rác.
 * `trim()` của JS bỏ cả khoảng trắng Unicode (U+3000), giống `str.strip()` của Python.
 */
export function isJunk(paragraph: string, patterns: readonly RegExp[]): boolean {
  const value = paragraph.trim();
  return patterns.some((re) => re.test(value));
}
