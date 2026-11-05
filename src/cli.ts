#!/usr/bin/env node
/**
 * CLI. Mọi lệnh nhận thư mục truyện (`books/<book-id>`). Layout: `rules/artifact-contract.md`
 * (raw/chapter-NNNN.md, manifest.json, reviews/ingestion.md). Được gọi bởi skill /novel-crawl.
 *
 *   novel init       <book-dir> --url <url> [--id <id>] [--adapter shuba69|shuku52] [--from N --to M]
 *   novel ingest     <book-dir> [--from N] [--to M] [--recrawl] [--headless]
 *   novel import     <book-dir> --chapter N --file <path> [--title <t>]
 *   novel import     <book-dir> --dir <v1-raw-dir> [--from N] [--to M]
 *   novel status     <book-dir> [--from N] [--to M]
 *   novel crosscheck <book-dir> --v1-raw <dir> [--from N] [--to M]
 *   novel snapshot   <book-dir> --stage raw|batch|final [--epub <file>] [--dest <dir>]
 *   novel save-report <book-dir> --agent <agentId> --out <reviews/...md>
 *   novel edit-prep  <book-dir> --batch bNNNN|sync --chapters 6,7,8 (--from v1 --to v2 | --next)
 *   novel edit-check <book-dir> --batch bNNNN|sync --report <reviews/...md>
 *   novel tidy       <book-dir> [--chapters 1,2,3]
 *   novel term-scan  <book-dir> [--from N] [--to M]
 *   novel agent-check <book-dir> --agent <agentId> [--model opus|sonnet]
 *
 * Không lệnh nào chạy Git trên dữ liệu truyện. `snapshot` (git bundle) là phần cũ, sẽ được
 * thay bằng backup zip ở slice T4.
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
import { AgentReportError, checkReport, findAgentTranscript, loadAgentReport } from "./agent-report.js";
import { checkEdit, EditGuardError, guardItems, parseAgentInfo, prepareEdit, scanTerms, tidyVersions } from "./edit-guard.js";

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
  novel snapshot   <book-dir> --stage raw|batch|final [--epub <file>] [--dest <dir>]
  novel save-report <book-dir> --agent <agentId> --out <reviews/...md>
  novel edit-prep  <book-dir> --batch bNNNN|sync --chapters 6,7,8 (--from v1 --to v2 | --next)
  novel edit-check <book-dir> --batch bNNNN|sync --report <reviews/...md>
  novel tidy       <book-dir> [--chapters 1,2,3]
  novel term-scan  <book-dir> [--from N] [--to M]
  novel agent-check <book-dir> --agent <agentId> [--model opus|sonnet]`;

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
  out(`Đã tạo ${paths.bookFile}.`);
  out("Kiểm tra adapter và phạm vi chương trong book.yaml; có thể thêm genre, title_vi, author. Bước tiếp: novel ingest.");
}

const manifestMeta = (config: BookConfig) => ({
  bookId: config.id,
  ...(config.title !== undefined ? { title: config.title } : {}),
  sourceLanguage: config.language,
  sourceUrl: config.url,
  adapter: config.adapter ?? "unknown",
});

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
      const store = new RawStore(paths);
      const summary = await runIngest({
        adapter: built.adapter,
        store,
        bookUrl: config.url,
        ...range,
        recrawl,
        maxConsecutiveFailures: config.crawler.maxConsecutiveFailures,
        log: err,
      });
      const manifest = await store.writeManifest(manifestMeta(config));
      const c = countOutcomes(summary.results);
      out(`Kết quả: ${c.VALID} VALID, ${c.SUSPECT} SUSPECT, ${c.FAILED} FAILED, ${c.BLOCKED} BLOCKED, ${c.SKIPPED} bỏ qua.`);
      out(`Cache HTML: ${built.stats.hits} hit, ${built.stats.misses} tải mạng.`);
      if (summary.stopped) out(`Dừng sớm: ${summary.stopped}`);
      out(summary.reportWritten ? `Báo cáo: ${paths.reportFile}` : `Không có chương mới; báo cáo cũ giữ nguyên: ${paths.reportFile}`);
      out(`Manifest: ${paths.manifestFile} (${manifest.chapter_count} chương raw)`);
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
    const manifest = await store.writeManifest(manifestMeta(config));
    out(`Đã nhập ${jobs.length - failed}/${jobs.length} chương.`);
    out(`Manifest: ${paths.manifestFile} (${manifest.chapter_count} chương raw)`);
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

// ---------------------------------------------------------------- save-report
/** Lưu nguyên văn report của subagent vào `<book-dir>/reviews/...`. In VERDICT để orchestrator kiểm. */
async function cmdSaveReport(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const agent = typeof v["agent"] === "string" ? v["agent"] : undefined;
  const rel = typeof v["out"] === "string" ? v["out"] : undefined;
  if (!agent || !rel) throw new UsageError(`save-report cần --agent và --out.\n${USAGE}`);
  if (!/^reviews\/[\w./-]+\.md$/.test(rel) || rel.split("/").includes("..")) {
    throw new UsageError("--out phải là đường dẫn .md bên trong reviews/ của truyện");
  }
  const root = process.env["CLAUDE_PROJECTS_DIR"] ?? join(homedir(), ".claude", "projects");
  const report = await loadAgentReport(agent, root);
  const target = join(resolve(dir), rel);
  await writeFileAtomic(target, report);
  const c = checkReport(report);
  out(`Đã lưu ${rel} (${report.length} ký tự) · Đã áp dụng: ${c.hasApplied ? "có" : "THIẾU"} · VERDICT: ${c.verdict ?? "THIẾU"}`);
  return c.hasApplied && c.verdict ? 0 : 2;
}

// ---------------------------------------------------------------- edit-prep / edit-check / agent-check
function chaptersOpt(v: string | boolean | undefined): number[] {
  if (typeof v !== "string" || !/^\d+(,\d+)*$/.test(v)) throw new UsageError("--chapters phải dạng 6,7,8");
  return [...new Set(v.split(",").map(Number))];
}

/** Sao chép version nguồn → đích cho Editor và chụp hash các file được bảo vệ (blueprint 6.6). */
async function cmdEditPrep(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  const g = await prepareEdit(resolve(dir), {
    batch: str("batch"),
    chapters: chaptersOpt(v["chapters"]),
    from: str("from") || undefined,
    to: str("to") || undefined,
    next: v["next"] === true,
  });
  const items = guardItems(g);
  const pairs = g.from !== "mixed" && g.to !== "mixed" ? `${g.from} → ${g.to}` : items.map((i) => `ch${i.chapter} ${i.from}→${i.to}`).join(", ");
  out(`Đã sao chép ${g.chapters.length} chương ${pairs} · bảo vệ ${Object.keys(g.hashes).length} file · reviews/${g.batch}/edit-guard.json`);
  for (const i of items) out(`  ch${String(i.chapter).padStart(4, "0")}: ${i.from} → ${i.to}`);
  return 0;
}

/** Chuyển version trung gian (khác v1, current, approved) vào translated/.history/. */
async function cmdTidy(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const moves = await tidyVersions(resolve(dir), v["chapters"] === undefined ? undefined : chaptersOpt(v["chapters"]));
  for (const m of moves) out(`${m.from} → ${m.to}`);
  out(`TIDY: chuyển ${moves.length} file`);
  return 0;
}

/** Tìm từ cấm (cột `Cấm (scan)` trong context/*.md) trong bản hiện hành. Mã 0 = sạch, 2 = có ứng viên. */
async function cmdTermScan(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const from = intOpt(typeof v["from"] === "string" ? v["from"] : undefined, "--from");
  const to = intOpt(typeof v["to"] === "string" ? v["to"] : undefined, "--to");
  const range = from !== undefined || to !== undefined ? { from: from ?? 1, to: to ?? Number.MAX_SAFE_INTEGER } : undefined;
  const { terms, hits } = await scanTerms(resolve(dir), range);
  for (const h of hits) out(`ch${String(h.chapter).padStart(4, "0")}.${h.version}:${h.line} · "${h.term}" → "${h.canonical}" (${h.source})`);
  const chapters = [...new Set(hits.map((h) => h.chapter))];
  out(`TERM-SCAN: ${terms.length} biến thể cấm · ${hits.length} chỗ · chương: ${chapters.join(",") || "—"}`);
  return hits.length ? 2 : 0;
}

/** Kiểm tra sau biên tập (blueprint 9.2). Mã 0 = PASS, 2 = FAIL. */
async function cmdEditCheck(dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const batch = typeof v["batch"] === "string" ? v["batch"] : "";
  const rel = typeof v["report"] === "string" ? v["report"] : "";
  if (!batch || !/^reviews\/[\w./-]+\.md$/.test(rel) || rel.split("/").includes("..")) {
    throw new UsageError(`edit-check cần --batch và --report reviews/....md\n${USAGE}`);
  }
  const r = await checkEdit(resolve(dir), batch, rel);
  for (const c of r.chapters) {
    const p = c.changed.filter((x) => x > 0).length;
    out(`ch${String(c.chapter).padStart(4, "0")}: ${c.redraft ? "REDRAFT · " : ""}đoạn ${c.paragraphs.target}/${c.paragraphs.raw} · đổi ${p} (${(c.changedRatio * 100).toFixed(0)}%)${c.changed.includes(0) ? " + tiêu đề" : ""} · change ID ${c.logged.length}`);
  }
  for (const w of r.warns) out(`WARN ${w}`);
  for (const f of r.fails) out(`FAIL ${f}`);
  out(r.ok ? "EDIT-CHECK: PASS" : "EDIT-CHECK: FAIL");
  return r.ok ? 0 : 2;
}

/**
 * Model thật và cách chạy của một lần gọi subagent.
 * Mã 2 khi sai model, hoặc chạy nền mà chưa xong (hay không xác định được đã xong).
 * Chạy nền nhưng đã xong: chỉ cảnh báo (WARN), mã 0.
 */
async function cmdAgentCheck(_dir: string, v: Record<string, string | boolean | undefined>): Promise<number> {
  const agent = typeof v["agent"] === "string" ? v["agent"] : "";
  const want = typeof v["model"] === "string" ? v["model"] : undefined;
  if (!agent) throw new UsageError(`agent-check cần --agent.\n${USAGE}`);
  if (want !== undefined && !/^(opus|sonnet|haiku)$/.test(want)) throw new UsageError("--model phải là opus, sonnet hoặc haiku");
  const root = process.env["CLAUDE_PROJECTS_DIR"] ?? join(homedir(), ".claude", "projects");
  const path = await findAgentTranscript(agent, root);
  const metaPath = path.replace(/\.jsonl$/, ".meta.json");
  const info = parseAgentInfo(await readFile(path, "utf8"), existsSync(metaPath) ? await readFile(metaPath, "utf8") : null);
  const modelOk = want === undefined || (info.models.length > 0 && info.models.every((m) => m.includes(want)));
  const foreground = info.requestShape === null || info.requestShape === "foreground";
  const shapeOk = foreground || info.finished === true;
  const shapeNote = foreground ? "" : info.finished === true ? " (WARN: chạy nền nhưng đã xong)" : " (SAI: chạy nền, chưa xác nhận đã xong)";
  out(`agent ${agent} · ${info.agentType ?? "?"} · model: ${info.models.join(", ") || "?"}${want ? (modelOk ? " (đúng)" : ` (SAI, cần ${want})`) : ""} · chạy: ${info.requestShape ?? "?"}${shapeNote}`);
  const u = info.usage;
  out(`usage: ${u.calls} lượt · cache read ${u.cacheRead} · cache write ${u.cacheWrite} · output ${u.output} (thinking ${u.thinking}) · input ${u.input}`);
  return modelOk && shapeOk ? 0 : 2;
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
      agent: { type: "string" },
      out: { type: "string" },
      batch: { type: "string" },
      chapters: { type: "string" },
      report: { type: "string" },
      model: { type: "string" },
      next: { type: "boolean" },
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
    case "save-report":
      return cmdSaveReport(dir, values);
    case "edit-prep":
      return cmdEditPrep(dir, values);
    case "edit-check":
      return cmdEditCheck(dir, values);
    case "agent-check":
      return cmdAgentCheck(dir, values);
    case "tidy":
      return cmdTidy(dir, values);
    case "term-scan":
      return cmdTermScan(dir, values);
    default:
      throw new UsageError(`Lệnh không rõ: ${command}\n${USAGE}`);
  }
}

const isEntry = process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1]);
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      if (e instanceof UsageError || e instanceof ConfigError || e instanceof LockHeldError || e instanceof SnapshotError || e instanceof AgentReportError || e instanceof EditGuardError) {
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
