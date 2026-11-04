/**
 * CORE-11: ghi file atomic. Viết vào file tạm có PID riêng, fsync, rồi rename.
 * Rename trong cùng thư mục là atomic trên POSIX: người đọc chỉ thấy file cũ
 * hoặc file mới hoàn chỉnh, không bao giờ thấy file ghi dở.
 */
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // PID riêng: hai tiến trình (dù đã có lock) không giẫm lên file tạm của nhau (KZGD 191).
  const tmp = `${path}.${process.pid}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Đọc JSON; thiếu file hoặc JSON hỏng thì trả null (cache hỏng = cache trống). */
export async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export const writeJsonAtomic = (path: string, value: unknown): Promise<void> =>
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
