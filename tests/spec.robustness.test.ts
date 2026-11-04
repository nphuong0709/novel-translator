import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cachedFetcher, type CacheStats, HtmlCache } from "../src/ingest/core/html-cache.js";
import { writeFileAtomic } from "../src/ingest/core/fs-atomic.js";
import { decodeBody, httpFetcher } from "../src/ingest/core/http.js";
import { acquireLock, LockHeldError, withLock } from "../src/ingest/core/lock.js";
import { politeFetcher, withRetries } from "../src/ingest/core/retry.js";
import { CrawlBlockedError, CrawlError } from "../src/ingest/types.js";

const tmp = () => mkdtemp(join(tmpdir(), "nt-"));

function fakeClock() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms), random: () => 0, log: () => {} };
}

describe("CORE-05 withRetries", () => {
  it("phục hồi sau lỗi tạm thời; backoff 10s rồi 20s; nghỉ sau MỖI lần thử", async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withRetries(
      "x",
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("tạm thời");
        return "ok";
      },
      { delayMs: 1000, maxRetries: 2, backoffMs: 10_000, ...clock },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    // lần 1: backoff 10s + delay; lần 2: backoff 20s + delay; lần 3: delay
    expect(clock.sleeps).toEqual([10_000, 1000, 20_000, 1000, 1000]);
  });

  it("hết lượt thì ném lỗi cuối cùng", async () => {
    const clock = fakeClock();
    await expect(
      withRetries("x", async () => Promise.reject(new CrawlError("hỏng")), { delayMs: 0, maxRetries: 1, backoffMs: 1, ...clock }),
    ).rejects.toThrow("hỏng");
  });

  it("BLOCKED không retry nhưng vẫn nghỉ", async () => {
    const clock = fakeClock();
    let calls = 0;
    await expect(
      withRetries(
        "x",
        async () => {
          calls += 1;
          throw new CrawlBlockedError("cf");
        },
        { delayMs: 500, maxRetries: 3, backoffMs: 10_000, ...clock },
      ),
    ).rejects.toBeInstanceOf(CrawlBlockedError);
    expect(calls).toBe(1);
    expect(clock.sleeps).toEqual([500]);
  });

  it("jitter tối đa 30% delay", async () => {
    const sleeps: number[] = [];
    await withRetries("x", async () => 1, {
      delayMs: 1000, maxRetries: 0, backoffMs: 0, sleep: async (ms) => void sleeps.push(ms), random: () => 0.999,
    });
    expect(sleeps[0]).toBeGreaterThan(1000);
    expect(sleeps[0]).toBeLessThan(1300);
  });
});

describe("CORE-11 writeFileAtomic", () => {
  it("ghi đè trọn vẹn, không để lại file tạm", async () => {
    const dir = await tmp();
    const file = join(dir, "a", "b.txt");
    await writeFileAtomic(file, "một");
    await writeFileAtomic(file, "hai");
    expect(await readFile(file, "utf8")).toBe("hai");
    expect(await readdir(join(dir, "a"))).toEqual(["b.txt"]);
  });
});

describe("CORE-10 lock", () => {
  it("lệnh thứ hai bị chặn, release xong thì lấy lại được", async () => {
    const path = join(await tmp(), ".cache", "ingest.lock");
    const first = await acquireLock(path, "ingest 1-10");
    await expect(acquireLock(path, "ingest 11-20")).rejects.toThrow(LockHeldError);
    await expect(acquireLock(path, "ingest 11-20")).rejects.toThrow(/ingest 1-10/);
    await first.release();
    const again = await acquireLock(path, "ingest 11-20");
    await again.release();
  });

  it("withLock release cả khi hàm ném lỗi", async () => {
    const path = join(await tmp(), "l.lock");
    await expect(withLock(path, "x", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await (await acquireLock(path, "y")).release();
  });

  it("lock mồ côi (PID đã chết) tự được gỡ", async () => {
    const path = join(await tmp(), "l.lock");
    // Lấy một PID chắc chắn đã chết: chạy tiến trình con và chờ nó thoát.
    const child = spawn(process.execPath, ["-e", ""]);
    await new Promise((r) => child.on("exit", r));
    const { hostname } = await import("node:os");
    await writeFile(path, JSON.stringify({ pid: child.pid, host: hostname(), command: "cũ", startedAt: "x" }));
    const lock = await acquireLock(path, "mới");
    expect(JSON.parse(await readFile(path, "utf8")).command).toBe("mới");
    await lock.release();
  });

  it.each([["SIGINT", 130], ["SIGTERM", 143]] as const)(
    "%s (Ctrl+C / kill) dưới node thuần: lock được gỡ, mã thoát %i",
    async (signal, code) => {
      const dir = await tmp();
      const lockPath = join(dir, "l.lock");
      const script = join(dir, "hold.mts");
      const lockModule = new URL("../src/ingest/core/lock.ts", import.meta.url).pathname;
      await writeFile(script, `import { acquireLock } from ${JSON.stringify(lockModule)};\nawait acquireLock(process.argv[2], "t");\nconsole.log("locked");\nsetInterval(() => {}, 1000);\n`);
      // `node --import tsx` (không qua CLI tsx): đúng ngữ nghĩa tín hiệu của Node, như `node dist/cli.js`.
      const child = spawn(process.execPath, ["--import", "tsx", script, lockPath], { cwd: process.cwd() });
      await new Promise<void>((ok, fail) => {
        child.stdout.on("data", (d: Buffer) => d.toString().includes("locked") && ok());
        child.on("exit", () => fail(new Error("child thoát trước khi lấy lock")));
      });
      const exited = new Promise<number | null>((r) => child.on("exit", (c) => r(c)));
      child.kill(signal);
      expect(await exited).toBe(code);
      await expect(readFile(lockPath, "utf8")).rejects.toThrow();
    },
    20_000,
  );

  it("lock của tiến trình còn sống thì KHÔNG gỡ", async () => {
    const path = join(await tmp(), "l.lock");
    const { hostname } = await import("node:os");
    await writeFile(path, JSON.stringify({ pid: process.pid, host: hostname(), command: "đang chạy", startedAt: "x" }));
    await expect(acquireLock(path, "mới")).rejects.toThrow(LockHeldError);
  });
});

describe("CORE-12 cache HTML", () => {
  it("lần 2 đọc từ cache; refresh tải lại đúng một lần mỗi URL; fresh luôn tải", async () => {
    const cache = new HtmlCache(await tmp());
    let network = 0;
    const inner = async (url: string) => `<p>${url}#${(network += 1)}</p>`;
    const stats: CacheStats = { hits: 0, misses: 0 };

    const normal = cachedFetcher(inner, cache, { stats });
    expect(await normal("u1")).toBe("<p>u1#1</p>");
    expect(await normal("u1")).toBe("<p>u1#1</p>");
    expect(stats).toEqual({ hits: 1, misses: 1 });

    const refresh = cachedFetcher(inner, cache, { refresh: true });
    expect(await refresh("u1")).toBe("<p>u1#2</p>");
    expect(await refresh("u1")).toBe("<p>u1#2</p>");

    expect(await normal("u1", { fresh: true })).toBe("<p>u1#3</p>");
    expect(network).toBe(3);
  });

  it("lỗi (ví dụ BLOCKED) không được ghi vào cache", async () => {
    const cache = new HtmlCache(await tmp());
    const f = cachedFetcher(async () => Promise.reject(new CrawlBlockedError("cf")), cache);
    await expect(f("u")).rejects.toBeInstanceOf(CrawlBlockedError);
    expect(await cache.get("u")).toBeNull();
  });

  it("thứ tự cache(polite(network)): cache hit không phải chờ delay", async () => {
    const cache = new HtmlCache(await tmp());
    const clock = fakeClock();
    const f = cachedFetcher(politeFetcher(async () => "<p>x</p>", { delayMs: 1000, maxRetries: 0, backoffMs: 0, ...clock }), cache);
    await f("u");
    await f("u");
    expect(clock.sleeps).toHaveLength(1);
  });
});

describe("HTTP fetcher", () => {
  const respond = (body: string, init: ResponseInit = {}) => async () => new Response(body, init);

  it("200 → body", async () => {
    expect(await httpFetcher({ fetchImpl: respond("<p>ok</p>") })("https://x/")).toBe("<p>ok</p>");
  });
  it("403 + 'Just a moment' → BLOCKED", async () => {
    const f = httpFetcher({ fetchImpl: respond("<title>Just a moment...</title>", { status: 403 }) });
    await expect(f("https://x/")).rejects.toBeInstanceOf(CrawlBlockedError);
  });
  it("200 nhưng là trang challenge → BLOCKED (không cache nhầm)", async () => {
    const f = httpFetcher({ fetchImpl: respond("<body>Verify you are human</body>") });
    await expect(f("https://x/")).rejects.toBeInstanceOf(CrawlBlockedError);
  });
  it("404 → CrawlError thường (được retry)", async () => {
    const f = httpFetcher({ fetchImpl: respond("nope", { status: 404 }) });
    const err = await f("https://x/").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrawlError);
    expect(err).not.toBeInstanceOf(CrawlBlockedError);
  });
  it("User-Agent trung thực, không giả trình duyệt", async () => {
    let ua = "";
    await httpFetcher({
      fetchImpl: async (_u, init) => {
        ua = new Headers(init?.headers).get("user-agent") ?? "";
        return new Response("ok");
      },
    })("https://x/");
    expect(ua).toMatch(/^novel-translator\//);
    expect(ua).not.toMatch(/Mozilla|Chrome|Safari/);
  });
  it("giải mã GBK theo header và theo <meta charset>", () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // "你好" trong GBK
    expect(decodeBody(gbk, "text/html; charset=gbk")).toBe("你好");
    const withMeta = new Uint8Array([...new TextEncoder().encode('<meta charset="gbk">'), ...gbk]);
    expect(decodeBody(withMeta, "text/html")).toContain("你好");
    expect(decodeBody(new TextEncoder().encode("你好"), "text/html; charset=bogus")).toBe("你好");
  });
});
