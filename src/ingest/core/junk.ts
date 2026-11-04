/** CORE-04: regex trong config phải ở dạng {pattern, flags} vì JS không hỗ trợ cờ inline (?i). */
export interface JunkPatternSpec {
  pattern: string;
  flags?: string;
}

/** CORE-03: ghép mặc định của adapter với mẫu bổ sung; regex sai thì ném lỗi rõ ràng. */
export function compileJunkPatterns(
  defaults: readonly JunkPatternSpec[],
  extra: readonly JunkPatternSpec[] = [],
): RegExp[] {
  throw new Error("TODO(CORE-03/04): compileJunkPatterns");
}

/** CORE-03: đoạn (đã trim) khớp bất kỳ mẫu nào thì là rác. */
export function isJunk(paragraph: string, patterns: readonly RegExp[]): boolean {
  throw new Error("TODO(CORE-03): isJunk");
}
