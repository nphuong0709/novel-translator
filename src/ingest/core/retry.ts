/**
 * CORE-05: retry có backoff; luôn nghỉ giữa các request kể cả khi lỗi; không retry BLOCKED.
 * Port từ V1 `_RetryMixin`.
 */
import { setTimeout as sleepMs } from "node:timers/promises";
import { CrawlBlockedError, type Fetcher } from "../types.js";

export interface PolitenessOptions {
  /** Nghỉ sau **mỗi** lần gọi mạng (thành công hay lỗi), cộng jitter 0–30%. */
  delayMs: number;
  /** Số lần thử lại sau lần đầu. */
  maxRetries: number;
  /** Backoff lần thử lại thứ k (k từ 1): backoffMs × 2^(k-1). Mặc định V1: 10s, 20s… */
  backoffMs: number;
  /** Tiêm vào để test không phải chờ thật. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (msg: string) => void;
}

export const DEFAULT_POLITENESS = { delayMs: 2_000, maxRetries: 2, backoffMs: 10_000 } as const;

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function withRetries<T>(label: string, action: () => Promise<T>, opts: PolitenessOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => sleepMs(ms).then(() => undefined));
  const random = opts.random ?? Math.random;
  const log = opts.log ?? ((msg: string) => console.error(msg));
  const attempts = Math.max(0, opts.maxRetries) + 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (err) {
      if (err instanceof CrawlBlockedError) throw err;
      lastError = err;
      if (attempt < attempts) {
        const wait = opts.backoffMs * 2 ** (attempt - 1);
        log(`${label}: lỗi lần ${attempt}/${attempts} (${errorMessage(err)}); thử lại sau ${Math.round(wait / 1000)} giây.`);
        await sleep(wait);
      }
    } finally {
      // Luôn nghỉ, kể cả khi lỗi hay bị chặn, để không dồn tải lên site.
      if (opts.delayMs > 0) await sleep(opts.delayMs + random() * opts.delayMs * 0.3);
    }
  }
  throw lastError;
}

/** Bọc một Fetcher mạng bằng retry + nghỉ lịch sự. Đặt **bên trong** cache. */
export function politeFetcher(inner: Fetcher, opts: PolitenessOptions): Fetcher {
  return (url, fetchOpts) => withRetries(url, () => inner(url, fetchOpts), opts);
}
