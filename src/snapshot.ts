/**
 * Snapshot repo dữ liệu truyện ra thư mục backup (mặc định: Google Drive for desktop,
 * `My Drive/novel-backups/<book-id>/`). Thay cho gcrypt (D-11 sửa ngày 2026-11-04).
 *
 * Mỗi snapshot ứng với **một commit** của repo dữ liệu (yêu cầu working tree sạch):
 *   - `<id>-<stage>-<ngày>-<sha>.bundle`: `git bundle --all`, toàn bộ lịch sử
 *     (khôi phục: `git clone <file>.bundle <thư-mục>`).
 *   - stage raw:   + `<id>-raw-chapters-<sha>.zip` (chapters/ đã commit, đọc cho tiện), tag `raw-done`.
 *   - stage batch: chỉ bundle; giữ `keepBatches` bản mới nhất, xóa bản batch cũ hơn.
 *   - stage final: + file .epub, tag `final`.
 *
 * File được ghi vào tên tạm rồi rename, để app Drive không đồng bộ file ghi dở.
 * Không mã hóa (theo quyết định của người dùng): Google đọc được nội dung.
 */
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type SnapshotStage = "raw" | "batch" | "final";
export const STAGE_TAG: Partial<Record<SnapshotStage, string>> = { raw: "raw-done", final: "final" };
export const DEFAULT_KEEP_BATCHES = 5;

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new SnapshotError(`git ${args.join(" ")}: ${(e.stderr ?? e.message).trim()}`);
  }
}

/**
 * Tìm `My Drive` của Google Drive for desktop. Nhiều tài khoản thì không đoán:
 * yêu cầu ghi `backup.dir` trong book.yaml.
 */
export async function findGoogleDriveRoot(home = homedir()): Promise<string> {
  const base = join(home, "Library", "CloudStorage");
  let accounts: string[] = [];
  try {
    accounts = (await readdir(base)).filter((d) => d.startsWith("GoogleDrive-"));
  } catch {
    /* không có CloudStorage */
  }
  if (accounts.length === 0) {
    throw new SnapshotError("Không thấy Google Drive for desktop (~/Library/CloudStorage/GoogleDrive-*). Cài app hoặc ghi backup.dir trong book.yaml.");
  }
  if (accounts.length > 1) {
    throw new SnapshotError(`Có ${accounts.length} tài khoản Google Drive; ghi rõ backup.dir trong book.yaml.`);
  }
  return join(base, accounts[0]!, "My Drive");
}

/** Chép atomic: chép vào `.<tên>.partial` cùng thư mục rồi rename. */
async function copyAtomic(src: string, destDir: string, name: string): Promise<string> {
  const final = join(destDir, name);
  const partial = join(destDir, `.${name}.partial`);
  await copyFile(src, partial);
  await rename(partial, final);
  return final;
}

export interface SnapshotOptions {
  bookDir: string;
  bookId: string;
  stage: SnapshotStage;
  /** Thư mục đích đã gồm `<book-id>`. */
  destDir: string;
  epubPath?: string;
  keepBatches?: number;
  now?: Date;
}

export interface SnapshotResult {
  commit: string;
  tag?: string;
  files: Array<{ path: string; bytes: number }>;
  pruned: string[];
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-"); // 20261104-083012

export async function createSnapshot(opts: SnapshotOptions): Promise<SnapshotResult> {
  const { bookDir, bookId, stage, destDir } = opts;
  const now = opts.now ?? new Date();

  // 1) Repo dữ liệu phải là git repo, sạch, có ít nhất một commit.
  if ((await git(bookDir, "rev-parse", "--is-inside-work-tree").catch(() => "")) !== "true") {
    throw new SnapshotError(`${bookDir} chưa phải git repo. Chạy 'git init' và commit trước.`);
  }
  const dirty = await git(bookDir, "status", "--porcelain");
  if (dirty) {
    throw new SnapshotError(`Repo dữ liệu còn thay đổi chưa commit; snapshot phải ứng với một commit:\n${dirty}`);
  }
  const commit = await git(bookDir, "rev-parse", "HEAD");
  const short = commit.slice(0, 7);

  if (stage === "final" && !opts.epubPath) throw new SnapshotError("stage final cần --epub <file>");
  if (opts.epubPath) await stat(opts.epubPath).catch(() => Promise.reject(new SnapshotError(`Không thấy ${opts.epubPath}`)));

  // 2) Tag mốc (raw-done / final). Đã có mà trỏ commit khác thì dừng, không tự dời tag.
  const tagName = STAGE_TAG[stage];
  if (tagName) {
    const existing = await git(bookDir, "rev-parse", "--verify", "--quiet", `refs/tags/${tagName}^{commit}`).catch(() => "");
    if (existing && existing !== commit) {
      throw new SnapshotError(`Tag '${tagName}' đã trỏ tới ${existing.slice(0, 7)}, khác HEAD ${short}. Xóa tag bằng tay nếu thật sự muốn dời mốc.`);
    }
    if (!existing) await git(bookDir, "tag", "-a", tagName, "-m", `${stage} snapshot ${now.toISOString()}`);
  }

  // 3) Tạo file trong thư mục tạm (ngoài Drive), kiểm tra, rồi mới chép sang.
  const work = await mkdtemp(join(tmpdir(), "nt-snapshot-"));
  try {
    const made: Array<{ src: string; name: string }> = [];
    const bundleName = `${bookId}-${stage}-${stamp(now)}-${short}.bundle`;
    const bundle = join(work, bundleName);
    await git(bookDir, "bundle", "create", bundle, "--all");
    await git(bookDir, "bundle", "verify", bundle);
    made.push({ src: bundle, name: bundleName });

    if (stage === "raw") {
      const zipName = `${bookId}-raw-chapters-${short}.zip`;
      const zip = join(work, zipName);
      // Từ nội dung đã commit, không phải file trên đĩa.
      await git(bookDir, "archive", "--format=zip", `--output=${zip}`, "HEAD", "chapters", "book.yaml");
      made.push({ src: zip, name: zipName });
    }
    if (opts.epubPath) made.push({ src: opts.epubPath, name: `${bookId}-${short}.epub` });

    await mkdir(destDir, { recursive: true });
    const files: SnapshotResult["files"] = [];
    for (const m of made) {
      const path = await copyAtomic(m.src, destDir, m.name);
      files.push({ path, bytes: (await stat(path)).size });
    }

    // 4) Chỉ dọn bundle **batch** cũ; raw/final không bao giờ bị xóa.
    const pruned: string[] = [];
    if (stage === "batch") {
      const keep = Math.max(1, opts.keepBatches ?? DEFAULT_KEEP_BATCHES);
      const batches = (await readdir(destDir)).filter((f) => f.startsWith(`${bookId}-batch-`) && f.endsWith(".bundle")).sort(); // tên có timestamp → sort = thứ tự thời gian
      for (const old of batches.slice(0, Math.max(0, batches.length - keep))) {
        await rm(join(destDir, old));
        pruned.push(old);
      }
    }
    return { commit, ...(tagName ? { tag: tagName } : {}), files, pruned };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export const describeFile = (f: { path: string; bytes: number }): string =>
  `${basename(f.path)} (${(f.bytes / 1024 / 1024).toFixed(2)} MB)`;
