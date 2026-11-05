/**
 * Kiểm soát lượt biên tập của Literary Editor (blueprint D-16, mục 6.4–6.6 và 9.2).
 *
 * - `prepareEdit`: sao chép version nguồn → version đích (bản làm việc của Editor) và chụp
 *   sha256 các file Editor KHÔNG được đổi (raw, mọi version đã có, context, summaries/notes).
 * - `checkEdit`: sau khi Editor chạy, kiểm hash không đổi, cấu trúc bản đích, và tập đoạn đổi
 *   giữa nguồn và đích phải trùng tập đoạn trong change log của report.
 *
 * Quy ước đoạn (khớp `rules/artifact-contract.md` mục 6): tách theo dòng trống; block 0 là
 * tiêu đề (bản dịch) hoặc frontmatter + tiêu đề (raw); đoạn k = block k. Đoạn 0 = tiêu đề.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { writeFileAtomic } from "./ingest/core/fs-atomic.js";

export class EditGuardError extends Error {
  override name = "EditGuardError";
}

export const GUARD_FILE = "edit-guard.json";
const VERSION = /^v\d+$/;
const BATCH = /^b\d{4}$|^final$/;

export interface EditGuard {
  batch: string;
  from: string;
  to: string;
  chapters: number[];
  created_at: string;
  /** đường dẫn tương đối trong book-dir → sha256 */
  hashes: Record<string, string>;
}

export const pad4 = (n: number) => String(n).padStart(4, "0");
export const chapterFile = (n: number, v: string) => `translated/chapter-${pad4(n)}.${v}.md`;
const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

/** Tách khối theo dòng trống (một hoặc nhiều). */
export function splitBlocks(text: string): string[] {
  const t = text.replace(/\r\n/g, "\n").replace(/^\s+|\s+$/g, "");
  return t === "" ? [] : t.split(/\n[ \t]*\n(?:[ \t]*\n)*/);
}

/** Số đoạn (không tính block 0), giống `awk 'BEGIN{RS=""} NR>1{n++}'`. */
export const paragraphCount = (text: string) => Math.max(0, splitBlocks(text).length - 1);

/** Chỉ số các block khác nhau giữa hai bản (0 = tiêu đề). */
export function changedParagraphs(before: string, after: string): number[] {
  const a = splitBlocks(before);
  const b = splitBlocks(after);
  const n = Math.max(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if ((a[i] ?? "") !== (b[i] ?? "")) out.push(i);
  return out;
}

export interface ChangeEntry {
  id: string;
  chapter: number;
  paragraph: number;
}

/** Đọc mục `## Change log` của report Editor (blueprint 6.5). Mỗi change ID trỏ đúng một đoạn. */
export function parseChangeLog(report: string): { entries: ChangeEntry[]; problems: string[] } {
  const entries: ChangeEntry[] = [];
  const problems: string[] = [];
  const m = /^## Change log[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(report);
  if (!m) return { entries, problems };
  let current: string | null = null;
  for (const line of (m[1] ?? "").split("\n")) {
    const id = /^\s*-\s*id:\s*(\S+)/.exec(line);
    if (id) {
      current = id[1] ?? null;
      continue;
    }
    const loc = /chapter:\s*(\d+)\s*[·,;|]\s*paragraph:\s*([^\s·,;|]+)/.exec(line);
    if (loc && current) {
      const p = loc[2] ?? "";
      if (!/^\d+$/.test(p)) problems.push(`${current}: paragraph phải là một số (${p})`);
      else entries.push({ id: current, chapter: Number(loc[1]), paragraph: Number(p) });
      current = null;
    }
  }
  return { entries, problems };
}

/** Chương được Editor ghi REDRAFT ở dòng `Chương: …` (blueprint 6.5). */
export function redraftChapters(report: string): number[] {
  const line = /^Chương:[^\n]*$/m.exec(report)?.[0] ?? "";
  return [...line.matchAll(/(\d+)\s+REDRAFT/g)].map((x) => Number(x[1]));
}

const REQUIRED_SECTIONS: Array<[RegExp, string]> = [
  [/^Đã áp dụng:/m, "dòng `Đã áp dụng:`"],
  [/^VERDICT:\s*[A-Z_]+/m, "dòng `VERDICT:`"],
  [/^## Change log/m, "mục `## Change log`"],
  [/^## Post-edit Source Fidelity Check/m, "mục `## Post-edit Source Fidelity Check`"],
];

async function listMd(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listMd(p)));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Các file Editor không được đổi, tương đối với book-dir. */
async function protectedFiles(bookDir: string, batch: string, chapters: number[], to: string): Promise<string[]> {
  const files = new Set<string>();
  const tdir = join(bookDir, "translated");
  const translated = existsSync(tdir) ? await readdir(tdir) : [];
  for (const n of chapters) {
    files.add(`raw/chapter-${pad4(n)}.md`);
    for (const f of translated) {
      if (f.startsWith(`chapter-${pad4(n)}.`) && f.endsWith(".md") && f !== `chapter-${pad4(n)}.${to}.md`) files.add(`translated/${f}`);
    }
  }
  for (const p of await listMd(join(bookDir, "context"))) files.add(relative(bookDir, p));
  for (const f of ["summaries.md", "notes.md"]) files.add(`reviews/${batch}/${f}`);
  return [...files].filter((f) => existsSync(join(bookDir, f))).sort();
}

export interface PrepareOptions {
  batch: string;
  chapters: number[];
  from: string;
  to: string;
  now?: Date;
}

export async function prepareEdit(bookDir: string, o: PrepareOptions): Promise<EditGuard> {
  if (!BATCH.test(o.batch)) throw new EditGuardError(`--batch không hợp lệ: ${o.batch}`);
  if (!VERSION.test(o.from) || !VERSION.test(o.to) || o.from === o.to) throw new EditGuardError("--from/--to phải dạng vN và khác nhau");
  if (o.chapters.length === 0) throw new EditGuardError("Thiếu --chapters");
  for (const n of o.chapters) {
    const src = join(bookDir, chapterFile(n, o.from));
    const dst = join(bookDir, chapterFile(n, o.to));
    if (!existsSync(src)) throw new EditGuardError(`Không có ${chapterFile(n, o.from)}`);
    if (existsSync(dst)) {
      throw new EditGuardError(`${chapterFile(n, o.to)} đã tồn tại. Nếu là bản sửa dở, chuyển nó vào translated/.history/ (hậu tố .partial) rồi chạy lại.`);
    }
  }
  for (const n of o.chapters) await copyFile(join(bookDir, chapterFile(n, o.from)), join(bookDir, chapterFile(n, o.to)));
  const hashes: Record<string, string> = {};
  for (const f of await protectedFiles(bookDir, o.batch, o.chapters, o.to)) hashes[f] = sha256(await readFile(join(bookDir, f)));
  const guard: EditGuard = {
    batch: o.batch,
    from: o.from,
    to: o.to,
    chapters: [...o.chapters].sort((a, b) => a - b),
    created_at: (o.now ?? new Date()).toISOString(),
    hashes,
  };
  await writeFileAtomic(join(bookDir, "reviews", o.batch, GUARD_FILE), `${JSON.stringify(guard, null, 2)}\n`);
  return guard;
}

export interface ChapterResult {
  chapter: number;
  redraft: boolean;
  paragraphs: { raw: number; target: number };
  changed: number[];
  logged: number[];
  unlogged: number[];
  /** change ID trỏ tới đoạn không đổi */
  staleLog: string[];
  changedRatio: number;
}

export interface CheckResult {
  ok: boolean;
  fails: string[];
  warns: string[];
  chapters: ChapterResult[];
}

const NOTE_MARKER = /\[(Chú thích|Thuật ngữ mới|Cần xác nhận)/;
const RULE_LINE = /^(---|\*\*\*)$/;
const HAN = /\p{Script=Han}/u;

export async function checkEdit(bookDir: string, batch: string, reportRel: string): Promise<CheckResult> {
  const guardPath = join(bookDir, "reviews", batch, GUARD_FILE);
  if (!existsSync(guardPath)) throw new EditGuardError(`Không có ${relative(bookDir, guardPath)}; chạy edit-prep trước`);
  const guard = JSON.parse(await readFile(guardPath, "utf8")) as EditGuard;
  const fails: string[] = [];
  const warns: string[] = [];

  for (const [f, h] of Object.entries(guard.hashes)) {
    const p = join(bookDir, f);
    if (!existsSync(p)) fails.push(`file được bảo vệ đã mất: ${f}`);
    else if (sha256(await readFile(p)) !== h) fails.push(`file được bảo vệ bị đổi: ${f}`);
  }

  const reportPath = join(bookDir, reportRel);
  const report = existsSync(reportPath) ? await readFile(reportPath, "utf8") : null;
  if (report === null) fails.push(`thiếu report ${reportRel}`);
  else for (const [re, name] of REQUIRED_SECTIONS) if (!re.test(report)) fails.push(`report thiếu ${name}`);
  const { entries, problems } = report ? parseChangeLog(report) : { entries: [], problems: [] };
  fails.push(...problems.map((p) => `change log: ${p}`));
  const redraft = new Set(report ? redraftChapters(report) : []);
  for (const e of entries) if (!guard.chapters.includes(e.chapter)) fails.push(`change log trỏ tới chương ngoài phạm vi: ${e.id} (ch${e.chapter})`);

  const chapters: ChapterResult[] = [];
  for (const n of guard.chapters) {
    const tag = `ch${pad4(n)}`;
    const target = join(bookDir, chapterFile(n, guard.to));
    if (!existsSync(target)) {
      fails.push(`${tag}: thiếu ${chapterFile(n, guard.to)}`);
      continue;
    }
    const raw = await readFile(join(bookDir, `raw/chapter-${pad4(n)}.md`), "utf8");
    const before = await readFile(join(bookDir, chapterFile(n, guard.from)), "utf8");
    const after = await readFile(target, "utf8");
    const changed = changedParagraphs(before, after);
    const mine = entries.filter((e) => e.chapter === n);
    const logged = [...new Set(mine.map((e) => e.paragraph))].sort((a, b) => a - b);
    const unlogged = changed.filter((p) => !logged.includes(p));
    const staleLog = mine.filter((e) => !changed.includes(e.paragraph)).map((e) => `${e.id}→đ${e.paragraph}`);
    const rawCount = paragraphCount(raw);
    const targetCount = paragraphCount(after);
    const ratio = targetCount ? changed.filter((p) => p > 0).length / targetCount : 0;
    chapters.push({ chapter: n, redraft: redraft.has(n), paragraphs: { raw: rawCount, target: targetCount }, changed, logged, unlogged, staleLog, changedRatio: ratio });

    if (redraft.has(n)) {
      warns.push(`${tag}: Editor ghi REDRAFT; ${chapterFile(n, guard.to)} không được dùng làm version hiện hành`);
      continue;
    }
    if (!after.startsWith("# ")) fails.push(`${tag}: dòng 1 không phải tiêu đề "# …"`);
    if (rawCount !== targetCount) fails.push(`${tag}: số đoạn raw ${rawCount} ≠ bản biên tập ${targetCount}`);
    const lines = after.split("\n");
    const han = lines.flatMap((l, i) => (HAN.test(l) ? [i + 1] : []));
    if (han.length) fails.push(`${tag}: còn chữ Hán ở dòng ${han.slice(0, 10).join(", ")}${han.length > 10 ? "…" : ""}`);
    const notes = lines.flatMap((l, i) => (NOTE_MARKER.test(l) ? [i + 1] : []));
    if (notes.length) fails.push(`${tag}: ghi chú lọt vào truyện ở dòng ${notes.join(", ")}`);
    const rawRules = raw.split("\n").filter((l) => RULE_LINE.test(l.trim())).length - (raw.startsWith("---") ? 2 : 0);
    const outRules = lines.filter((l) => RULE_LINE.test(l.trim())).length;
    if (outRules > Math.max(0, rawRules)) fails.push(`${tag}: có dòng "---"/"***" không có trong nguyên tác`);
    if (unlogged.length) fails.push(`${tag}: đoạn đổi không có change ID: ${unlogged.join(", ")}`);
    if (staleLog.length) warns.push(`${tag}: change ID trỏ tới đoạn không đổi: ${staleLog.join(", ")}`);
    if (ratio > 0.3) warns.push(`${tag}: sửa ${(ratio * 100).toFixed(0)}% số đoạn (> 30%) mà không ghi REDRAFT`);
  }
  return { ok: fails.length === 0, fails, warns, chapters };
}

/** Tóm tắt một agent từ transcript + meta.json: model thật và cách chạy (foreground/background). */
export interface AgentUsage {
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  thinking: number;
}

export interface AgentInfo {
  agentType: string | null;
  requestShape: string | null;
  models: string[];
  /** cộng theo message.id (một message có thể ghi nhiều dòng trong transcript) */
  usage: AgentUsage;
}

export function parseAgentInfo(jsonl: string, metaJson: string | null): AgentInfo {
  const models = new Set<string>();
  const seen = new Set<string>();
  const usage: AgentUsage = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0 };
  const num = (x: unknown) => (typeof x === "number" ? x : 0);
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as { type?: string; message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> } };
      if (d.type !== "assistant" || !d.message) continue;
      if (typeof d.message.model === "string") models.add(d.message.model);
      const id = typeof d.message.id === "string" ? d.message.id : null;
      const u = d.message.usage;
      if (!u || (id !== null && seen.has(id))) continue;
      if (id !== null) seen.add(id);
      usage.calls++;
      usage.input += num(u["input_tokens"]);
      usage.cacheRead += num(u["cache_read_input_tokens"]);
      usage.cacheWrite += num(u["cache_creation_input_tokens"]);
      usage.output += num(u["output_tokens"]);
      usage.thinking += num((u["output_tokens_details"] as Record<string, unknown> | undefined)?.["thinking_tokens"]);
    } catch {
      /* bỏ qua dòng hỏng */
    }
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = metaJson ? (JSON.parse(metaJson) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  const s = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : null);
  return { agentType: s("agentType"), requestShape: s("requestShape"), models: [...models].sort(), usage };
}
