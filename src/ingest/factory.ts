/**
 * Ráp adapter từ book.yaml. Chuỗi fetcher:
 *
 *   cachedFetcher( politeFetcher( network ) )
 *        │               │            └─ http (52shuku) | BrowserFetcher (69shuba, mở lười)
 *        │               └─ retry + backoff + luôn nghỉ giữa request (CORE-05)
 *        └─ HTML cache (CORE-12): hit thì không chờ, không mở trình duyệt
 */
import type { AdapterId, BookConfig } from "../config.js";
import { Shuba69Adapter, SHUBA69_JUNK } from "./adapters/shuba69.js";
import { Shuku52Adapter, SHUKU52_JUNK } from "./adapters/shuku52.js";
import { BrowserFetcher } from "./core/browser.js";
import { cachedFetcher, type CacheStats, HtmlCache } from "./core/html-cache.js";
import { httpFetcher } from "./core/http.js";
import { compileJunkPatterns, type JunkPatternSpec } from "./core/junk.js";
import type { BookPaths } from "./core/raw-store.js";
import { politeFetcher } from "./core/retry.js";
import type { Fetcher, SourceAdapter } from "./types.js";

export interface BuildOptions {
  /** `--recrawl`: tải lại từ mạng thay vì dùng HTML cache. */
  refresh?: boolean;
  /** Ghi đè `crawler.headless`. */
  headless?: boolean;
  log?: (msg: string) => void;
  /** Tiêm fetcher mạng (test). Mặc định: HTTP hoặc trình duyệt theo adapter. */
  network?: Fetcher;
}

export interface BuiltAdapter {
  adapter: SourceAdapter;
  stats: CacheStats;
  close(): Promise<void>;
}

const DEFAULT_JUNK: Record<AdapterId, readonly JunkPatternSpec[]> = { shuba69: SHUBA69_JUNK, shuku52: SHUKU52_JUNK };

export function buildAdapter(config: BookConfig, paths: BookPaths, opts: BuildOptions = {}): BuiltAdapter {
  const adapterId = config.adapter;
  if (!adapterId) throw new Error("book.yaml chưa có adapter");
  const c = config.crawler;
  const log = opts.log ?? ((m: string) => console.error(m));
  const junk = compileJunkPatterns(DEFAULT_JUNK[adapterId], c.junkPatterns);

  let browser: BrowserFetcher | null = null;
  let network = opts.network;
  if (!network) {
    if (adapterId === "shuba69") {
      browser = new BrowserFetcher({
        profileDir: paths.browserProfileDir,
        headless: opts.headless ?? c.headless,
        timeoutMs: c.timeoutSeconds * 1000,
        manualVerificationMs: c.manualVerificationSeconds * 1000,
        notify: log,
      });
      network = browser.fetch;
    } else {
      network = httpFetcher({ timeoutMs: c.timeoutSeconds * 1000 });
    }
  }

  const stats: CacheStats = { hits: 0, misses: 0 };
  const fetcher = cachedFetcher(
    politeFetcher(network, {
      delayMs: c.delaySeconds * 1000,
      maxRetries: c.maxRetries,
      backoffMs: c.retryBackoffSeconds * 1000,
      log,
    }),
    new HtmlCache(paths.htmlCacheDir),
    { refresh: opts.refresh ?? false, stats },
  );

  const adapter: SourceAdapter =
    adapterId === "shuba69"
      ? new Shuba69Adapter(fetcher, { junk, numbering: c.numbering, verifyTitleNumber: c.verifyTitleNumber, log })
      : new Shuku52Adapter(fetcher, { junk });

  return { adapter, stats, close: async () => browser?.close() };
}
