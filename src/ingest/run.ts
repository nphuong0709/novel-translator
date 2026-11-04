/**
 * Orchestrator ingest một phạm vi chương: bỏ qua raw hợp lệ (CORE-13), tải + kiểm tra
 * + lưu, dừng batch khi BLOCKED hoặc sau N lỗi liên tiếp (CORE-06), ghi ingest-report.md.
 *
 * Không tự lấy lock: CLI bọc hàm này trong `withLock` (CORE-10).
 * Không commit: commit repo dữ liệu là việc của người dùng (Slice 1) / `validate --commit` (Slice 2+).
 */
import { checkChapter } from "./core/checks.js";
import { writeFileAtomic } from "./core/fs-atomic.js";
import { neighborsOf, type RawStore } from "./core/raw-store.js";
import { CrawlBlockedError, type IngestStatus, type SourceAdapter } from "./types.js";

export type ChapterOutcome = IngestStatus | "SKIPPED";

export interface ChapterResult {
  chapter: number;
  outcome: ChapterOutcome;
  title?: string;
  sourceChars?: number;
  issues: string[];
}

export interface IngestSummary {
  adapter: string;
  parser: string;
  bookUrl: string;
  from: number;
  to: number;
  recrawl: boolean;
  startedAt: string;
  finishedAt: string;
  results: ChapterResult[];
  /** Lý do dừng sớm, nếu có. */
  stopped?: string;
  /** false khi lần chạy không tải chương nào (toàn SKIPPED): report cũ được giữ nguyên. */
  reportWritten: boolean;
}

export interface IngestOptions {
  adapter: SourceAdapter;
  store: RawStore;
  bookUrl: string;
  from: number;
  to: number;
  recrawl?: boolean;
  /** CORE-06, mặc định 3. */
  maxConsecutiveFailures?: number;
  log?: (msg: string) => void;
  now?: () => Date;
}

const errText = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

export async function runIngest(opts: IngestOptions): Promise<IngestSummary> {
  const { adapter, store, bookUrl, from, to } = opts;
  const recrawl = opts.recrawl ?? false;
  const maxFailures = opts.maxConsecutiveFailures ?? 3;
  const log = opts.log ?? ((m: string) => console.error(m));
  const now = opts.now ?? (() => new Date());

  const summary: IngestSummary = {
    adapter: adapter.id,
    parser: adapter.parserFingerprint,
    bookUrl,
    from,
    to,
    recrawl,
    startedAt: now().toISOString(),
    finishedAt: "",
    results: [],
    reportWritten: false,
  };
  const index = await store.loadIndex();
  let consecutiveFailures = 0;

  for (let n = from; n <= to; n += 1) {
    if (!recrawl && (await store.isUpToDate(n, adapter.parserFingerprint))) {
      log(`[${n}] Đã có raw hợp lệ, bỏ qua. Dùng --recrawl để cào lại.`);
      summary.results.push({ chapter: n, outcome: "SKIPPED", issues: [] });
      continue;
    }

    log(`[${n}] Đang tải...`);
    try {
      const chapter = await adapter.fetchChapter(bookUrl, n);
      const check = checkChapter(chapter, neighborsOf(index, n));
      const result: ChapterResult = {
        chapter: n,
        outcome: check.status,
        title: chapter.title,
        sourceChars: check.sourceChars,
        issues: check.issues,
      };
      summary.results.push(result);

      if (check.status === "FAILED") {
        // Không ghi đè raw cũ (nếu có) bằng dữ liệu hỏng.
        log(`[${n}] FAILED: ${check.issues.join(" ")}`);
        consecutiveFailures += 1;
      } else {
        await store.save(chapter, { adapter: adapter.id, parser: adapter.parserFingerprint, check, fetchedAt: now().toISOString() });
        index.set(n, { contentHash: check.contentHash, sourceChars: check.sourceChars });
        consecutiveFailures = 0;
        const note = check.status === "SUSPECT" ? ` SUSPECT: ${check.issues.join(" ")}` : "";
        log(`[${n}] Đã lưu: ${chapter.title} (${check.sourceChars} ký tự).${note}`);
      }
    } catch (err) {
      if (err instanceof CrawlBlockedError) {
        summary.results.push({ chapter: n, outcome: "BLOCKED", issues: [err.message] });
        summary.stopped = `Bị chặn ở chương ${n}: ${err.message}`;
        log(`[${n}] BLOCKED, dừng batch: ${err.message}`);
        break;
      }
      summary.results.push({ chapter: n, outcome: "FAILED", issues: [errText(err)] });
      consecutiveFailures += 1;
      log(`[${n}] FAILED: ${errText(err)}`);
    }

    if (consecutiveFailures >= maxFailures) {
      summary.stopped = `Dừng sau ${consecutiveFailures} chương lỗi liên tiếp (tới chương ${n}).`;
      log(summary.stopped);
      break;
    }
  }

  summary.finishedAt = now().toISOString();
  // Lần chạy toàn SKIPPED không có thông tin mới: không ghi đè report của lần chạy
  // có tải chương gần nhất (lịch sử các lần trước nằm trong git của repo dữ liệu).
  if (summary.results.some((r) => r.outcome !== "SKIPPED")) {
    await writeFileAtomic(store.paths.reportFile, renderReport(summary));
    summary.reportWritten = true;
  } else {
    log("Không có chương nào cần tải; giữ nguyên ingest-report.md.");
  }
  return summary;
}

export function countOutcomes(results: readonly ChapterResult[]): Record<ChapterOutcome, number> {
  const counts: Record<ChapterOutcome, number> = { VALID: 0, SUSPECT: 0, FAILED: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}

/** Thoát `|` và xuống dòng để không vỡ bảng Markdown. */
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

export function renderReport(s: IngestSummary): string {
  const c = countOutcomes(s.results);
  const lines = [
    "# Ingest report",
    "",
    `- Nguồn: ${s.bookUrl}`,
    `- Adapter: \`${s.adapter}\`, parser \`${s.parser}\``,
    `- Phạm vi: ${s.from}–${s.to}${s.recrawl ? " (--recrawl)" : ""}`,
    `- Thời gian: ${s.startedAt} → ${s.finishedAt}`,
    `- Kết quả: ${c.VALID} VALID, ${c.SUSPECT} SUSPECT, ${c.FAILED} FAILED, ${c.BLOCKED} BLOCKED, ${c.SKIPPED} bỏ qua`,
    ...(s.stopped ? [`- **Dừng sớm:** ${s.stopped}`] : []),
    "",
  ];
  const notable = s.results.filter((r) => r.outcome !== "SKIPPED");
  if (notable.length) {
    lines.push("| Chương | Trạng thái | Tiêu đề | Ký tự | Ghi chú |", "|---:|---|---|---:|---|");
    for (const r of notable) {
      lines.push(
        `| ${r.chapter} | ${r.outcome} | ${cell(r.title ?? "")} | ${r.sourceChars ?? ""} | ${cell(r.issues.join(" "))} |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
