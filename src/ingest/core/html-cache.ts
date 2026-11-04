/**
 * CORE-12: cache HTML **gốc** theo URL. Đổi parser hay mẫu rác thì parse lại từ
 * cache, không gọi mạng (V1 chỉ cache đoạn đã parse, nên sửa SHUKU-03 phải tải lại 521 trang).
 *
 * Chỉ HTML tải thành công mới vào cache: fetcher mạng ném lỗi khi gặp challenge,
 * nên trang Cloudflare không bao giờ bị lưu nhầm thành nội dung.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Fetcher } from "../types.js";
import { readJsonOrNull, writeJsonAtomic } from "./fs-atomic.js";

interface CacheEntry {
  url: string;
  fetchedAt: string;
  html: string;
}

export class HtmlCache {
  constructor(readonly dir: string) {}

  private pathFor(url: string): string {
    const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
    return join(this.dir, key.slice(0, 2), `${key}.json`);
  }

  async get(url: string): Promise<string | null> {
    const entry = await readJsonOrNull<CacheEntry>(this.pathFor(url));
    // So URL đầy đủ: phòng (cực hiếm) trùng prefix hash.
    return entry && entry.url === url && typeof entry.html === "string" ? entry.html : null;
  }

  async put(url: string, html: string): Promise<void> {
    await writeJsonAtomic(this.pathFor(url), { url, fetchedAt: new Date().toISOString(), html } satisfies CacheEntry);
  }
}

export interface CacheStats {
  hits: number;
  misses: number;
}

/**
 * Bọc fetcher mạng bằng cache. `refresh: true` (ứng với `--recrawl`) luôn tải lại
 * và ghi đè; `opts.fresh` làm điều đó cho một request (mục lục cần làm mới).
 *
 * Thứ tự đúng: `cachedFetcher(politeFetcher(network))`, để cache hit không phải chờ delay.
 */
export function cachedFetcher(
  inner: Fetcher,
  cache: HtmlCache,
  opts: { refresh?: boolean; stats?: CacheStats } = {},
): Fetcher {
  // `refresh` chỉ tải lại mỗi URL **một lần** mỗi lần chạy; lần sau dùng bản vừa tải.
  const refreshed = new Set<string>();
  return async (url, fetchOpts) => {
    const mustFetch = fetchOpts?.fresh === true || (opts.refresh === true && !refreshed.has(url));
    if (!mustFetch) {
      const hit = await cache.get(url);
      if (hit !== null) {
        if (opts.stats) opts.stats.hits += 1;
        return hit;
      }
    }
    if (opts.stats) opts.stats.misses += 1;
    const html = await inner(url, fetchOpts);
    await cache.put(url, html);
    refreshed.add(url);
    return html;
  };
}
