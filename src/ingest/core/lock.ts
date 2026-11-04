/**
 * CORE-10: lock file theo từng truyện; chặn lệnh thứ hai chạy song song.
 *
 * Tạo file bằng cờ `wx` (O_CREAT | O_EXCL): atomic, chỉ một tiến trình thắng.
 * Lock "mồ côi" (tiến trình giữ lock đã chết, ví dụ bị kill -9) được nhận ra
 * bằng `process.kill(pid, 0)` và tự gỡ, để không phải xóa tay.
 */
import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";

export class LockHeldError extends Error {
  override name = "LockHeldError";
}

interface LockInfo {
  pid: number;
  host: string;
  command: string;
  startedAt: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // tín hiệu 0: chỉ kiểm tra tồn tại, không gửi gì
    return true;
  } catch (err) {
    // EPERM: tiến trình tồn tại nhưng thuộc user khác → vẫn coi là còn sống.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface BookLock {
  readonly path: string;
  release(): Promise<void>;
}

export async function acquireLock(path: string, command: string): Promise<BookLock> {
  await mkdir(dirname(path), { recursive: true });
  const info: LockInfo = { pid: process.pid, host: hostname(), command, startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, `${JSON.stringify(info)}\n`, { flag: "wx" });
      return makeLock(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const held = await readLock(path);
    // Chỉ tự gỡ khi chắc chắn mồ côi: cùng máy và PID không còn sống.
    if (held && held.host === info.host && !isAlive(held.pid)) {
      await rm(path, { force: true });
      continue;
    }
    const who = held ? `PID ${held.pid} (${held.command}, từ ${held.startedAt})` : "một tiến trình khác";
    throw new LockHeldError(`Truyện này đang được ${who} xử lý. Lock: ${path}`);
  }
  throw new LockHeldError(`Không lấy được lock ${path}`);
}

async function readLock(path: string): Promise<LockInfo | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as LockInfo;
  } catch {
    return null;
  }
}

/** Mã thoát chuẩn của shell khi bị tín hiệu: 128 + số hiệu tín hiệu. */
const SIGNAL_EXIT: Record<"SIGINT" | "SIGTERM" | "SIGHUP", number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

function makeLock(path: string): BookLock {
  let released = false;
  const removeSync = (): void => {
    if (released) return;
    released = true;
    try {
      rmSync(path, { force: true });
    } catch {
      /* bỏ qua */
    }
  };
  // Thoát bình thường mà quên release thì vẫn gỡ (đồng bộ, vì 'exit' không chờ Promise).
  const onExit = (): void => removeSync();
  // Ctrl+C / kill: Node mặc định chết ngay mà KHÔNG phát 'exit', nên lock bị bỏ lại
  // (đã tái hiện với `node` thuần; `tsx` tình cờ che lỗi này). Gỡ lock rồi thoát đúng mã.
  // File đang ghi dở không hỏng: ghi atomic, tệ nhất còn một file `.<pid>.tmp`.
  const onSignal = (signal: NodeJS.Signals): void => {
    removeSync();
    process.exit(SIGNAL_EXIT[signal as keyof typeof SIGNAL_EXIT] ?? 1);
  };
  process.once("exit", onExit);
  for (const s of Object.keys(SIGNAL_EXIT)) process.once(s, onSignal);
  return {
    path,
    async release() {
      if (released) return;
      released = true;
      process.off("exit", onExit);
      for (const s of Object.keys(SIGNAL_EXIT)) process.off(s, onSignal);
      await rm(path, { force: true });
    },
  };
}

/** Chạy `fn` trong lock; luôn release kể cả khi lỗi. */
export async function withLock<T>(path: string, command: string, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireLock(path, command);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
