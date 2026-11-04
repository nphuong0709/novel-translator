/**
 * Fetcher HTTP thường (dùng cho 52shuku), dựa trên `fetch` có sẵn của Node 24.
 *
 * - Challenge (403/429/503 kèm trang bot-check, hoặc bất kỳ trang challenge nào) → CrawlBlockedError.
 *   Không retry, không tự vượt.
 * - Mã khác 200 → CrawlError (được retry bởi `politeFetcher`).
 * - Giải mã theo charset trong header hoặc `<meta charset>` (một số site Trung dùng GBK).
 * - User-Agent **trung thực**, không giả trình duyệt (khác V1, theo quy tắc không giả fingerprint).
 */
import { CrawlBlockedError, CrawlError, type Fetcher } from "../types.js";
import { isChallengeHtml } from "./challenge.js";

export const DEFAULT_USER_AGENT = "novel-translator/0.1 (personal, non-commercial; low-rate)";

export interface HttpOptions {
  timeoutMs?: number;
  userAgent?: string;
  /** Tiêm vào để test. */
  fetchImpl?: typeof fetch;
}

const BLOCK_STATUSES = new Set([403, 429, 503]);

function charsetOf(contentType: string | null, head: Uint8Array): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  // Đọc 2 KB đầu như latin1 chỉ để tìm thẻ meta (ASCII), không phải để giải mã nội dung.
  const sniff = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1]?.toLowerCase() ?? "utf-8";
}

export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const charset = charsetOf(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // Nhãn charset lạ: TextDecoder ném RangeError → quay về UTF-8.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function httpFetcher(opts: HttpOptions = {}): Fetcher {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  return async (url) => {
    let response: Response;
    try {
      response = await doFetch(url, {
        headers: { "User-Agent": userAgent, "Accept-Language": "zh-CN,zh;q=0.9" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
    } catch (err) {
      throw new CrawlError(`Lỗi mạng khi tải ${url}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    const body = decodeBody(new Uint8Array(await response.arrayBuffer()), response.headers.get("content-type"));

    if (isChallengeHtml(body) || (BLOCK_STATUSES.has(response.status) && /just a moment|cf-chl|captcha/i.test(body.slice(0, 5000)))) {
      throw new CrawlBlockedError(
        `Site trả trang xác minh (HTTP ${response.status}) tại ${url}. Tool không tự vượt; hãy thử lại sau hoặc kiểm tra trong trình duyệt.`,
      );
    }
    if (response.status !== 200) throw new CrawlError(`HTTP ${response.status}: ${url}`);
    return body;
  };
}
