/**
 * Helper cheerio thay cho các hàm BeautifulSoup mà V1 dùng.
 *
 * Cheerio không export lại kiểu `AnyNode` (của `domhandler`, chỉ là dependency bắc cầu),
 * nên ở đây nhận `Cheerio<any>` và phân biệt node bằng `type` / `data` lúc chạy.
 */
import type { Cheerio } from "cheerio";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySelection = Cheerio<any>;

interface TextLike {
  type: "text";
  data: string;
}

const SKIP_TAGS = new Set(["script", "style", "template"]);

export function isTextNode(node: unknown): node is TextLike {
  const n = node as { type?: unknown; data?: unknown };
  return n.type === "text" && typeof n.data === "string";
}

/** Gom text node con cháu theo thứ tự tài liệu; bỏ comment và nội dung script/style. */
function collectStrings(node: unknown, out: string[]): void {
  if (isTextNode(node)) {
    out.push(node.data);
    return;
  }
  const n = node as { name?: string; children?: unknown[] };
  if (n.name !== undefined && SKIP_TAGS.has(n.name)) return;
  for (const child of n.children ?? []) collectStrings(child, out);
}

/**
 * Tương đương `tag.get_text(sep, strip=True)` của BeautifulSoup: trim từng text node,
 * bỏ node rỗng, nối bằng `sep`. Khác `.text()` của cheerio (nối thô, không trim).
 */
export function getTextStrip(sel: AnySelection, sep = " "): string {
  const parts: string[] = [];
  for (const el of sel.toArray()) collectStrings(el, parts);
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(sep);
}

/**
 * Chỉ các text node là con trực tiếp, tương đương `find_all(string=True, recursive=False)`.
 * Khác V1 một chút: bs4 coi comment là string nên V1 có thể lấy cả `<!-- -->`; ở đây bỏ.
 */
export function directTextNodes(sel: AnySelection): string[] {
  return sel
    .contents()
    .toArray()
    // `filter(isTextNode)` không thu hẹp được: TextLike không phải kiểu con của AnyNode.
    .flatMap((n: unknown) => (isTextNode(n) ? [n.data] : []));
}

/** Số ký tự theo code point (giống `len()` của Python), không theo UTF-16. */
export const charLength = (s: string): number => [...s].length;
