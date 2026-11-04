import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { createSnapshot, findGoogleDriveRoot, SnapshotError } from "../src/snapshot.js";

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec("git", args, { cwd })).stdout.trim();

beforeAll(() => {
  // Repo tạm cần danh tính cho commit/tag; không đụng tới git config của người dùng.
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid",
  });
});

async function dataRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nt-snap-book-"));
  await git(dir, "init", "-q", "-b", "main");
  await mkdir(join(dir, "chapters", "001"), { recursive: true });
  await writeFile(join(dir, "book.yaml"), "id: demo\n");
  await writeFile(join(dir, "chapters", "001", "source.md"), "# 第1章\n\n甲。\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "raw(ch001)");
  return dir;
}
const dest = async () => join(await mkdtemp(join(tmpdir(), "nt-snap-dest-")), "demo");

describe("createSnapshot", () => {
  it("raw: bundle khôi phục được toàn bộ lịch sử; zip chứa chapters đã commit; gắn tag raw-done", async () => {
    const book = await dataRepo();
    const d = await dest();
    const r = await createSnapshot({ bookDir: book, bookId: "demo", stage: "raw", destDir: d, now: new Date("2026-11-04T08:30:12Z") });

    const names = (await readdir(d)).sort();
    const short = r.commit.slice(0, 7);
    expect(names).toEqual([`demo-raw-20261104-083012-${short}.bundle`, `demo-raw-chapters-${short}.zip`].sort());
    expect(await git(book, "rev-parse", "raw-done^{commit}")).toBe(r.commit);

    const restored = join(await mkdtemp(join(tmpdir(), "nt-restore-")), "r");
    await exec("git", ["clone", "-q", join(d, names.find((n) => n.endsWith(".bundle"))!), restored]);
    expect(await readFile(join(restored, "chapters", "001", "source.md"), "utf8")).toBe("# 第1章\n\n甲。\n");
    expect(await git(restored, "tag")).toContain("raw-done");

    const { stdout } = await exec("unzip", ["-l", join(d, `demo-raw-chapters-${short}.zip`)]);
    expect(stdout).toContain("chapters/001/source.md");
    expect(stdout).toContain("book.yaml");
    expect(names.some((n) => n.includes(".partial"))).toBe(false);
  });

  it("repo còn thay đổi chưa commit → từ chối (snapshot phải ứng với một commit)", async () => {
    const book = await dataRepo();
    await writeFile(join(book, "chapters", "001", "source.md"), "sửa dở\n");
    await expect(createSnapshot({ bookDir: book, bookId: "demo", stage: "raw", destDir: await dest() })).rejects.toThrow(/chưa commit/);
  });

  it("không phải git repo → lỗi rõ ràng", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nt-snap-nogit-"));
    await expect(createSnapshot({ bookDir: dir, bookId: "demo", stage: "batch", destDir: await dest() })).rejects.toThrow(SnapshotError);
  });

  it("tag mốc không bị tự dời: chạy lại cùng commit thì được, commit khác thì dừng", async () => {
    const book = await dataRepo();
    await createSnapshot({ bookDir: book, bookId: "demo", stage: "raw", destDir: await dest() });
    await createSnapshot({ bookDir: book, bookId: "demo", stage: "raw", destDir: await dest() });
    await writeFile(join(book, "x.md"), "x\n");
    await git(book, "add", "-A");
    await git(book, "commit", "-q", "-m", "more");
    await expect(createSnapshot({ bookDir: book, bookId: "demo", stage: "raw", destDir: await dest() })).rejects.toThrow(/raw-done.*khác HEAD/);
  });

  it("batch: chỉ giữ N bundle batch mới nhất; không đụng tới bản raw", async () => {
    const book = await dataRepo();
    const d = await dest();
    await createSnapshot({ bookDir: book, bookId: "demo", stage: "raw", destDir: d });
    for (let i = 0; i < 4; i += 1) {
      await createSnapshot({ bookDir: book, bookId: "demo", stage: "batch", destDir: d, keepBatches: 2, now: new Date(Date.UTC(2026, 10, 4, 9, i)) });
    }
    const files = await readdir(d);
    const batches = files.filter((f) => f.startsWith("demo-batch-")).sort();
    expect(batches).toHaveLength(2);
    expect(batches[0]).toContain("20261104-090200");
    expect(files.filter((f) => f.startsWith("demo-raw-"))).toHaveLength(2);
    expect(await git(book, "tag")).not.toContain("batch");
  });

  it("final cần --epub; có epub thì chép kèm và gắn tag final", async () => {
    const book = await dataRepo();
    await expect(createSnapshot({ bookDir: book, bookId: "demo", stage: "final", destDir: await dest() })).rejects.toThrow(/--epub/);
    const epub = join(await mkdtemp(join(tmpdir(), "nt-epub-")), "book.epub");
    await writeFile(epub, "PK fake epub");
    const d = await dest();
    const r = await createSnapshot({ bookDir: book, bookId: "demo", stage: "final", destDir: d, epubPath: epub });
    expect(await readdir(d)).toContain(`demo-${r.commit.slice(0, 7)}.epub`);
    expect(r.tag).toBe("final");
  });
});

describe("findGoogleDriveRoot", () => {
  const fakeHome = async (accounts: string[]) => {
    const home = await mkdtemp(join(tmpdir(), "nt-home-"));
    for (const a of accounts) await mkdir(join(home, "Library", "CloudStorage", a, "My Drive"), { recursive: true });
    return home;
  };
  it("một tài khoản → My Drive của tài khoản đó", async () => {
    const home = await fakeHome(["GoogleDrive-a@example.invalid", "OneDrive-x"]);
    expect(await findGoogleDriveRoot(home)).toBe(join(home, "Library", "CloudStorage", "GoogleDrive-a@example.invalid", "My Drive"));
  });
  it("không có / nhiều tài khoản → yêu cầu ghi backup.dir", async () => {
    await expect(findGoogleDriveRoot(await fakeHome([]))).rejects.toThrow(/backup.dir/);
    await expect(findGoogleDriveRoot(await fakeHome(["GoogleDrive-a@x", "GoogleDrive-b@x"]))).rejects.toThrow(/backup.dir/);
  });
});
