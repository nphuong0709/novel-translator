/**
 * Fetcher bằng trình duyệt thật (Google Chrome đã cài, qua playwright-core), cho site
 * có Cloudflare như 69shuba.
 *
 * Nguyên tắc truy cập (blueprint mục 2), thể hiện trong code:
 * - Profile **bền vững** (`.cache/browser-profile/`, gitignored): bạn tự xác minh một lần
 *   trong cửa sổ Chrome, các lần sau tool dùng lại cookie đó (SHUBA-11).
 * - Gặp challenge: có cửa sổ thì **chờ bạn tự xác minh** (mặc định tối đa 300s);
 *   headless thì BLOCKED ngay. Không có code tự giải challenge hay CAPTCHA.
 * - Không stealth, không giả fingerprint, không sửa navigator/UA, không proxy.
 *   Chỉ dùng Chrome chuẩn với cấu hình mặc định (bật sandbox).
 * - Mở Chrome **lười** (SHUBA-10): chỉ khi thật sự cần tải trang qua mạng.
 */
import { setTimeout as sleepMs } from "node:timers/promises";
import { CrawlBlockedError, CrawlError, type Fetcher } from "../types.js";
import { isChallengeHtml } from "./challenge.js";

/** Phần tối thiểu của Playwright `Page` mà vòng chờ cần. Tách ra để test bằng page giả. */
export interface PageLike {
  url(): string;
  content(): Promise<string>;
  /** Selector có phần tử đang hiển thị chưa. */
  hasVisible(selector: string): Promise<boolean>;
}

export interface WaitOptions {
  timeoutMs: number;
  headless: boolean;
  manualVerificationMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Thông báo cho người dùng (chỉ khi cần họ làm gì đó). */
  notify?: (msg: string) => void;
}

/**
 * Chờ `selector` xuất hiện. Port từ V1 `_wait_for`.
 * Challenge + headless → BLOCKED. Challenge + có cửa sổ → chờ người dùng, quá hạn → BLOCKED.
 * Không challenge mà quá `timeoutMs` → CrawlError (được retry).
 */
export async function waitForContent(page: PageLike, selector: string, opts: WaitOptions): Promise<void> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => sleepMs(ms).then(() => undefined));
  const notify = opts.notify ?? ((m: string) => console.error(m));
  const pollMs = opts.pollMs ?? 1000;

  const normalDeadline = now() + opts.timeoutMs;
  let verificationDeadline: number | null = null;

  for (;;) {
    if (await page.hasVisible(selector).catch(() => false)) return;

    if (verificationDeadline === null && isChallengeHtml(await page.content().catch(() => ""))) {
      if (opts.headless) {
        throw new CrawlBlockedError(
          `Site yêu cầu xác minh (${page.url()}). Chạy lại không có --headless và tự hoàn tất xác minh trong cửa sổ Chrome.`,
        );
      }
      verificationDeadline = now() + opts.manualVerificationMs;
      notify(
        `Site yêu cầu xác minh. Hãy tự hoàn tất trong cửa sổ Chrome; tool chờ tối đa ${Math.round(opts.manualVerificationMs / 1000)} giây.`,
      );
    }

    const deadline = verificationDeadline ?? normalDeadline;
    if (now() >= deadline) {
      if (verificationDeadline !== null) {
        throw new CrawlBlockedError(`Chưa hoàn tất xác minh trong thời gian chờ (${page.url()}).`);
      }
      throw new CrawlError(`Không thấy ${selector} trên trang ${page.url()}`);
    }
    await sleep(pollMs);
  }
}

export interface BrowserOptions {
  profileDir: string;
  headless?: boolean;
  /** "chrome" = Google Chrome đã cài trên máy (không tải Chromium riêng). */
  channel?: string;
  timeoutMs?: number;
  manualVerificationMs?: number;
  notify?: (msg: string) => void;
}

type Context = import("playwright-core").BrowserContext;
type Page = import("playwright-core").Page;

/** Fetcher dùng một cửa sổ Chrome với profile bền vững. Gọi `close()` khi xong. */
export class BrowserFetcher {
  private context: Context | null = null;
  launches = 0;

  constructor(private readonly opts: BrowserOptions) {}

  private async page(): Promise<Page> {
    if (!this.context) {
      // Import động: chạy với chương đã có raw/cache thì không phải nạp Playwright.
      const { chromium } = await import("playwright-core");
      this.context = await chromium.launchPersistentContext(this.opts.profileDir, {
        channel: this.opts.channel ?? "chrome",
        headless: this.opts.headless ?? false,
        viewport: { width: 1360, height: 900 },
        chromiumSandbox: true,
      });
      this.context.setDefaultTimeout(this.opts.timeoutMs ?? 90_000);
      this.launches += 1;
    }
    return this.context.pages()[0] ?? (await this.context.newPage());
  }

  readonly fetch: Fetcher = async (url, fetchOpts) => {
    const page = await this.page();
    const timeoutMs = this.opts.timeoutMs ?? 90_000;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const pageLike: PageLike = {
      url: () => page.url(),
      content: () => page.content(),
      hasVisible: async (sel) => {
        const loc = page.locator(sel).first();
        return (await loc.count()) > 0 && (await loc.isVisible());
      },
    };
    await waitForContent(pageLike, fetchOpts?.waitFor ?? "body", {
      timeoutMs,
      headless: this.opts.headless ?? false,
      manualVerificationMs: this.opts.manualVerificationMs ?? 300_000,
      sleep: (ms) => page.waitForTimeout(ms),
      ...(this.opts.notify ? { notify: this.opts.notify } : {}),
    });
    return page.content();
  };

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
  }
}
