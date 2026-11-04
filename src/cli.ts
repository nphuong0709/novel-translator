#!/usr/bin/env node
/**
 * CLI Slice 1. Mọi lệnh nhận thư mục repo dữ liệu truyện (`../novel-books/<book-id>`).
 *
 *   novel init       <book-dir> --url <url> [--id <id>] [--adapter shuba69|shuku52] [--from N --to M]
 *   novel ingest     <book-dir> [--from N] [--to M] [--recrawl] [--headless]
 *   novel import     <book-dir> --chapter N --file <path> [--title <t>]
 *   novel import     <book-dir> --dir <v1-raw-dir> [--from N] [--to M]
 *   novel status     <book-dir> [--from N] [--to M]
 *   novel crosscheck <book-dir> --v1-raw <dir> [--from N] [--to M]
 *   novel snapshot   <book-dir> --stage raw|batch|final [--epub <file>] [--dest <dir>]
 *
 * Không lệnh nào commit nội dung truyện: bạn tự xem ingest-report.md rồi commit.
 * `snapshot` chỉ gắn tag mốc (raw-done / final) lên commit hiện có và chép backup ra Drive.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { stringify as stringifyYaml } from "yaml";
import { ADAPTER_IDS, type AdapterId, type BookConfig, ConfigError, detectAdapter, loadBookConfig } from "./config.js";
import { normalizeBookUrl, SHUBA69_JUNK } from "./ingest/adapters/shuba69.js";
import { normalizeIndexUrl, SHUKU52_JUNK } from "./ingest/adapters/shuku52.js";
import { compileLocalJunk, localFileFingerprint, parseLocalText } from "./ingest/adapters/local-file.js";
import { checkChapter, contentHash } from "./ingest/core/checks.js";
import { readJsonOrNull, writeFileAtomic } from "./ingest/core/fs-atomic.js";
import { LockHeldError, withLock } from "./ingest/core/lock.js";
import { BookPaths, neighborsOf, RawStore } from "./ingest/core/raw-store.js";
import { buildAdapter } from "./ingest/factory.js";
import { countOutcomes, runIngest } from "./ingest/run.js";
import { createSnapshot, describeFile, findGoogleDriveRoot, SnapshotError } from "./snapshot.js";

const out = (msg = "") => process.stdout.write(`${msg}\n`);
const err = (msg: string) => process.stderr.write(`${msg}\n`);

class UsageError extends Error {
  override name = "UsageError";
}

const USAGE = `Cách dùng:
  novel init       <book-dir> --url <url> [--id <id>] [--adapter ${ADAPTER_IDS.join("|")}] [--from N --to M]
  novel ingest     <book-dir> [--from N] [--to M] [--recrawl] [--headless]
  novel import     <book-dir> --chapter N --file <path> [--title <t>]
  novel import     <book-dir> --dir <v1-raw-dir> [--from N] [--to M]
  novel status     <book-dir> [--from N] [--to M]
  novel crosscheck <book-dir> --v1-raw <dir> [--from N] [--to M]
  novel snapshot   <book-dir> --stage raw|batch|final [--epub <file>] [--dest <dir>]`;

function intOpt(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < 1) throw new UsageError(`--${name} phải là số nguyên dương`);
  return Number(v);
}

/** Phạm vi chương: cờ CLI > book.yaml > (với status/crosscheck) các chương đang có. */
function resolveRange(config: BookConfig, from?: number, to?: number): { from: number; to: number } | null {
  const f = from ?? config.chapters?.from;
  const t = to ?? config.chapters?.to ?? f;
  if (f === undefined || t === undefined) return null;
  if (t < f) throw new UsageError("--to phải ≥ --from");
  return { from: f, to: t };
}

const DATA_REPO_GITIGNORE = `# Không bao giờ commit: cache HTML, browser profile (cookie), lock, file tạm, EPUB
.cache/
browser-profile/
*.tmp
*.epub
.env
.env.*
`;

// ---------------------------------------------------------------- init
async function cmdInit(dir: string, v: Record<string, string | boolean | undefined>): Promise<void> {
  const url = v["url"];
  if (typeof url !== "string") throw new UsageError("init cần --url");
  const paths = new BookPaths(dir);
  if (existsSync(paths.bookFile)) throw new UsageError(`${paths.bookFile} đã tồn tại; sửa trực tiếp file đó.`);
  const adapter = (v["adapter"] as AdapterId | undefined) ?? detectAdapter(url);
  if (!adapter || !(ADAPTER_IDS as readonly string[]).includes(adapter)) {
    throw new UsageError(`Không nhận ra site; truyền --adapter ${ADAPTER_IDS.join("|")}`);
  }
  const id = (v["id"] as string | undefined) ?? basename(resolve(dir));
  const from = intOpt(v["from"] as string | undefined, "from");
  const to = intOpt(v["to"] as string | undefined, "to");
  // Lưu URL đã chuẩn hóa (SHUBA-01 / SHUKU-01) cho book.yaml dễ đọc.
  const canonical = adapter === "shuba69" ? normalizeBookUrl(url) : normalizeIndexUrl(url);
  const book: Record<string, unknown> = { id, url: canonical, adapter, language: "zh" };
  if (from !== undefined) book["chapters"] = { from, to: to ?? from };
  book["crawler"] = { junkPatterns: [] };
  await writeFileAtomic(paths.bookFile, stringifyYaml(book));
  const gi = join(dir, ".gitignore");
  if (!existsSync(gi)) await writeFile(gi, DATA_REPO_GITIGNORE);
  await loadBookConfig(paths.bookFile); // tự kiểm tra file vừa ghi
  out(`Đã tạo ${paths.bookFile} và .gitignore.`);
  out("Repo dữ liệu chưa được git init: chạy `git init` và commit sau khi ingest; backup bằng `novel snapshot` (blueprint D-11).");
}

// ---------------------------------------------------------------- ingest
async function cmdIngest(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const paths = new BookPaths(dir);
  const config = await loadBookConfig(paths.bookFile);
  const range = resolveRange(config, intOpt(v["from"] as string | undefined, "from"), intOpt(v["to"] as string | undefined, "to"));
  if (!range) throw new UsageError("Chưa có phạm vi chương: truyền --from/--to hoặc ghi chapters trong book.yaml");
  const recrawl = v["recrawl"] === true;

  return withLock(paths.lockFile, `ingest ${range.from}-${range.to}`, async () => {
    const built = buildAdapter(config, paths, {
      refresh: recrawl,
      ...(v["headless"] === true ? { headless: true } : {}),
      log: err,
    });
    try {
      const summary = await runIngest({
        adapter: built.adapter,
        store: new RawStore(paths),
        bookUrl: config.url,
        ...range,
        recrawl,
        maxConsecutiveFailures: config.crawler.maxConsecutiveFailures,
        log: err,
      });
      const c = countOutcomes(summary.results);
      out(`Kết quả: ${c.VALID} VALID, ${c.SUSPECT} SUSPECT, ${c.FAILED} FAILED, ${c.BLOCKED} BLOCKED, ${c.SKIPPED} bỏ qua.`);
      out(`Cache HTML: ${built.stats.hits} hit, ${built.stats.misses} tải mạng.`);
      if (summary.stopped) out(`Dừng sớm: ${summary.stopped}`);
      out(summary.reportWritten ? `Báo cáo: ${paths.reportFile}` : `Không có chương mới; báo cáo cũ giữ nguyên: ${paths.reportFile}`);
      if (c.VALID + c.SUSPECT > 0) {
        out(`Xem lại rồi tự commit, ví dụ: git -C ${dir} add chapters ingest-report.md && git -C ${dir} commit -m "raw(ch${range.from}-${range.to})"`);
      }
      return c.BLOCKED > 0 ? 3 : c.FAILED > 0 ? 2 : 0;
    } finally {
      await built.close();
    }
  });
}

// ---------------------------------------------------------------- import
async function cmdImport(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const paths = new BookPaths(dir);
  const config = await loadBookConfig(paths.bookFile);
  const defaults = config.adapter === "shuba69" ? SHUBA69_JUNK : SHUKU52_JUNK;
  const junk = compileLocalJunk(defaults, config.crawler.junkPatterns);
  const parser = localFileFingerprint(junk);
  const store = new RawStore(paths);

  let jobs: Array<{ n: number; file: string; title?: string }>;
  if (typeof v["file"] === "string") {
    const n = intOpt(v["chapter"] as string | undefined, "chapter");
    if (n === undefined) throw new UsageError("import --file cần --chapter N");
    jobs = [{ n, file: v["file"], ...(typeof v["title"] === "string" ? { title: v["title"] } : {}) }];
  } else if (typeof v["dir"] === "string") {
    const src = v["dir"];
    const from = intOpt(v["from"] as string | undefined, "from") ?? 1;
    const to = intOpt(v["to"] as string | undefined, "to") ?? Number.MAX_SAFE_INTEGER;
    jobs = (await readdir(src))
      .map((f) => /^(\d+)\.txt$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ n: Number(m[1]), file: join(src, m[0]) }))
      .filter((j) => j.n >= from && j.n <= to)
      .sort((a, b) => a.n - b.n);
    if (!jobs.length) throw new UsageError(`Không có file <n>.txt nào trong ${src} thuộc phạm vi`);
  } else {
    throw new UsageError("import cần --file (kèm --chapter) hoặc --dir");
  }

  return withLock(paths.lockFile, `import ${jobs.length} chương`, async () => {
    const index = await store.loadIndex();
    let failed = 0;
    for (const job of jobs) {
      // V1 lưu URL trong <n>.meta.json; có thì giữ lại.
      const meta = await readJsonOrNull<{ url?: string }>(job.file.replace(/\.txt$/, ".meta.json"));
      const chapter = parseLocalText(await readFile(job.file, "utf8"), {
        chapterNumber: job.n,
        junk,
        ...(meta?.url ? { url: meta.url } : {}),
        ...(job.title ? { title: job.title } : {}),
      });
      chapter.metadata = { importedFrom: resolve(job.file) };
      const check = checkChapter(chapter, neighborsOf(index, job.n));
      if (check.status === "FAILED") {
        failed += 1;
        err(`[${job.n}] FAILED, không ghi: ${check.issues.join(" ")}`);
        continue;
      }
      await store.save(chapter, { adapter: "local-file", parser, check });
      index.set(job.n, { contentHash: check.contentHash, sourceChars: check.sourceChars });
      err(`[${job.n}] ${check.status}: ${chapter.title} (${check.sourceChars} ký tự)${check.issues.length ? ` ${check.issues.join(" ")}` : ""}`);
    }
    out(`Đã nhập ${jobs.length - failed}/${jobs.length} chương.`);
    return failed ? 2 : 0;
  });
}

// ---------------------------------------------------------------- status
async function cmdStatus(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const paths = new BookPaths(dir);
  const config = await loadBookConfig(paths.bookFile);
  const store = new RawStore(paths);
  const existing = await store.listChapters();
  const range =
    resolveRange(config, intOpt(v["from"] as string | undefined, "from"), intOpt(v["to"] as string | undefined, "to")) ??
    (existing.length ? { from: existing[0]!, to: existing.at(-1)! } : null);
  if (!range) {
    out("Chưa có chương nào.");
    return 0;
  }
  // Fingerprint hiện tại: dựng adapter chỉ để đọc fingerprint (không mạng, không mở trình duyệt).
  const { adapter } = buildAdapter(config, paths, { network: async () => "", log: () => {} });

  const groups: Record<string, number[]> = { VALID: [], SUSPECT: [], "thiếu": [], "parser cũ": [], "bị sửa tay": [] };
  for (let n = range.from; n <= range.to; n += 1) {
    const s = await store.load(n);
    if (!s) groups["thiếu"]!.push(n);
    else if (!s.intact) groups["bị sửa tay"]!.push(n);
    else if (s.frontmatter.parser !== adapter.parserFingerprint && s.frontmatter.adapter !== "local-file") groups["parser cũ"]!.push(n);
    else groups[s.frontmatter.ingest_status]!.push(n);
  }
  out(`${config.id}: chương ${range.from}–${range.to} (parser hiện tại ${adapter.parserFingerprint})`);
  for (const [k, list] of Object.entries(groups)) out(`  ${k.padEnd(11)} ${String(list.length).padStart(4)}${list.length && k !== "VALID" ? `  ${compactRanges(list)}` : ""}`);
  return 0;
}

/** [1,2,3,7,9,10] → "1–3, 7, 9–10" */
export function compactRanges(ns: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j += 1;
    parts.push(i === j ? `${ns[i]}` : `${ns[i]}–${ns[j]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------- crosscheck
/** Blueprint 8.5: so `content_hash` của raw TS với raw V1 (cùng công thức hash). */
async function cmdCrosscheck(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const v1 = v["v1-raw"];
  if (typeof v1 !== "string") throw new UsageError("crosscheck cần --v1-raw <dir>");
  const store = new RawStore(new BookPaths(dir));
  const from = intOpt(v["from"] as string | undefined, "from") ?? 1;
  const to = intOpt(v["to"] as string | undefined, "to") ?? Number.MAX_SAFE_INTEGER;

  const v1Numbers = (await readdir(v1)).map((f) => /^(\d+)\.txt$/.exec(f)?.[1]).filter((x): x is string => !!x).map(Number);
  const numbers = [...new Set([...v1Numbers, ...(await store.listChapters())])].filter((n) => n >= from && n <= to).sort((a, b) => a - b);

  const same: number[] = [];
  const diff: number[] = [];
  const onlyTs: number[] = [];
  const onlyV1: number[] = [];
  for (const n of numbers) {
    const ts = await store.load(n);
    const txtPath = join(v1, `${n}.txt`);
    let v1Hash: string | null = null;
    if (existsSync(txtPath)) {
      // V1 RawStore: "<title>\n\n<content>\n". Hash nội dung như V1 (không qua cleaner).
      const saved = (await readFile(txtPath, "utf8")).trim();
      const sep = saved.indexOf("\n\n");
      v1Hash = contentHash((sep >= 0 ? saved.slice(sep + 2) : saved).trim());
    }
    if (ts && v1Hash) (ts.frontmatter.content_hash === v1Hash ? same : diff).push(n);
    else if (ts) onlyTs.push(n);
    else if (v1Hash) onlyV1.push(n);
  }
  out(`Khớp hash:   ${same.length}`);
  out(`Lệch hash:   ${diff.length}${diff.length ? `  ${compactRanges(diff)}` : ""}`);
  out(`Chỉ có TS:   ${onlyTs.length}${onlyTs.length ? `  ${compactRanges(onlyTs)}` : ""}`);
  out(`Chỉ có V1:   ${onlyV1.length}${onlyV1.length ? `  ${compactRanges(onlyV1)}` : ""}`);
  if (diff.length) out("Lệch cần giải thích (vd. raw V1 cào trước bản sửa SHUKU-05, hoặc V1 lấy cả comment HTML).");
  return diff.length ? 2 : 0;
}

// ---------------------------------------------------------------- snapshot
async function cmdSnapshot(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const stage = v["stage"];
  if (stage !== "raw" && stage !== "batch" && stage !== "final") throw new UsageError("snapshot cần --stage raw|batch|final");
  const paths = new BookPaths(dir);
  const config = await loadBookConfig(paths.bookFile);
  const expand = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

  let base: string;
  if (typeof v["dest"] === "string") base = expand(v["dest"]);
  else if (config.backup.dir) base = expand(config.backup.dir);
  else base = join(await findGoogleDriveRoot(), "novel-backups");
  const destDir = join(base, config.id);

  // raw: chặn khi phạm vi chương chưa đủ / còn chương chưa VALID-SUSPECT.
  if (stage === "raw" && config.chapters) {
    const store = new RawStore(paths);
    const missing: number[] = [];
    for (let n = config.chapters.from; n <= config.chapters.to; n += 1) {
      const s = await store.load(n);
      if (!s?.intact) missing.push(n);
    }
    if (missing.length) throw new UsageError(`Chưa đủ raw hợp lệ cho chương ${compactRanges(missing)}; chưa thể đánh dấu raw-done.`);
  }

  return withLock(paths.lockFile, `snapshot ${stage}`, async () => {
    const r = await createSnapshot({
      bookDir: dir,
      bookId: config.id,
      stage,
      destDir,
      keepBatches: config.backup.keepBatches,
      ...(typeof v["epub"] === "string" ? { epubPath: v["epub"] } : {}),
    });
    out(`Snapshot ${stage} của commit ${r.commit.slice(0, 7)}${r.tag ? ` (tag ${r.tag})` : ""} → ${destDir}`);
    for (const f of r.files) out(`  + ${describeFile(f)}`);
    for (const p of r.pruned) out(`  - xóa bản batch cũ: ${p}`);
    out("Google Drive for desktop sẽ tự đồng bộ lên drive.google.com (My Drive/novel-backups).");
    return 0;
  });
}

// ---------------------------------------------------------------- main
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    out(USAGE);
    return command ? 0 : 1;
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      url: { type: "string" },
      id: { type: "string" },
      adapter: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      recrawl: { type: "boolean" },
      headless: { type: "boolean" },
      chapter: { type: "string" },
      file: { type: "string" },
      dir: { type: "string" },
      title: { type: "string" },
      "v1-raw": { type: "string" },
      stage: { type: "string" },
      dest: { type: "string" },
      epub: { type: "string" },
    },
  });
  const dir = positionals[0];
  if (!dir) throw new UsageError(`Thiếu <book-dir>.\n${USAGE}`);

  switch (command) {
    case "init":
      await cmdInit(dir, values);
      return 0;
    case "ingest":
      return cmdIngest(dir, values);
    case "import":
      return cmdImport(dir, values);
    case "status":
      return cmdStatus(dir, values);
    case "crosscheck":
      return cmdCrosscheck(dir, values);
    case "snapshot":
      return cmdSnapshot(dir, values);
    default:
      throw new UsageError(`Lệnh không rõ: ${command}\n${USAGE}`);
  }
}

const isEntry = process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1]);
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      if (e instanceof UsageError || e instanceof ConfigError || e instanceof LockHeldError || e instanceof SnapshotError) {
        err(e.message);
        process.exit(1);
      }
      if (e instanceof Error && e.name === "TypeError" && /parseArgs|Unknown option/i.test(e.message)) {
        err(`${e.message}\n${USAGE}`);
        process.exit(1);
      }
      err(e instanceof Error ? (e.stack ?? e.message) : String(e));
      process.exit(1);
    },
  );
}
