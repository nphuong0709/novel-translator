/**
 * `book.yaml` của một repo dữ liệu truyện. Kiểm tra bằng tay (không thêm thư viện
 * schema): sai kiểu thì báo lỗi kèm tên trường, không âm thầm dùng mặc định.
 *
 * Ví dụ:
 *   id: kzgd
 *   title: 示例书名
 *   url: https://www.52shuku.net/xxx/yyy.html
 *   adapter: shuku52            # bỏ trống thì tự nhận theo URL
 *   language: zh
 *   chapters: { from: 1, to: 201 }
 *   crawler:
 *     delaySeconds: 2
 *     junkPatterns:
 *       - { pattern: "某某书院", flags: "i" }
 */
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { JunkPatternSpec } from "./ingest/core/junk.js";

export const ADAPTER_IDS = ["shuba69", "shuku52"] as const;
export type AdapterId = (typeof ADAPTER_IDS)[number];

export interface CrawlerConfig {
  delaySeconds: number;
  maxRetries: number;
  retryBackoffSeconds: number;
  timeoutSeconds: number;
  maxConsecutiveFailures: number;
  junkPatterns: JunkPatternSpec[];
  /** 69shuba */
  numbering: "title" | "order";
  verifyTitleNumber: boolean;
  headless: boolean;
  manualVerificationSeconds: number;
}

export interface BookConfig {
  id: string;
  title?: string;
  url: string;
  adapter?: AdapterId;
  language: "zh" | "en";
  chapters?: { from: number; to: number };
  crawler: CrawlerConfig;
  /** `novel snapshot`. `dir` là thư mục gốc (tool thêm `/<id>`); bỏ trống = Google Drive for desktop `My Drive/novel-backups`. */
  backup: { dir?: string; keepBatches: number };
}

/** Mặc định theo V1: 69shuba chậm hơn (Cloudflare), 52shuku là HTTP thường. */
export function defaultCrawler(adapter: AdapterId): CrawlerConfig {
  const slow = adapter === "shuba69";
  return {
    delaySeconds: slow ? 5 : 2,
    maxRetries: 2,
    retryBackoffSeconds: 10,
    timeoutSeconds: slow ? 90 : 60,
    maxConsecutiveFailures: 3,
    junkPatterns: [],
    numbering: "title",
    verifyTitleNumber: true,
    headless: false,
    manualVerificationSeconds: 300,
  };
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function str(o: Obj, key: string, required: true): string;
function str(o: Obj, key: string, required?: false): string | undefined;
function str(o: Obj, key: string, required = false): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) throw new ConfigError(`book.yaml: thiếu '${key}'`);
    return undefined;
  }
  if (typeof v !== "string" || !v.trim()) throw new ConfigError(`book.yaml: '${key}' phải là chuỗi khác rỗng`);
  return v.trim();
}

function num(o: Obj, key: string, fallback: number, { min = 0, int = false } = {}): number {
  const v = o[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || (int && !Number.isInteger(v))) {
    throw new ConfigError(`book.yaml: '${key}' phải là số${int ? " nguyên" : ""} ≥ ${min}`);
  }
  return v;
}

function bool(o: Obj, key: string, fallback: boolean): boolean {
  const v = o[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "boolean") throw new ConfigError(`book.yaml: '${key}' phải là true/false`);
  return v;
}

/** Nhận adapter theo hostname; dùng khi book.yaml không ghi `adapter`. */
export function detectAdapter(url: string): AdapterId | undefined {
  const host = new URL(url).hostname;
  if (/(^|\.)69shu(ba)?\./.test(host)) return "shuba69";
  if (/(^|\.)52shuku\./.test(host)) return "shuku52";
  return undefined;
}

export function parseBookConfig(raw: unknown): BookConfig {
  if (!isObj(raw)) throw new ConfigError("book.yaml: phải là một object");
  const id = str(raw, "id", true);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new ConfigError("book.yaml: 'id' chỉ gồm a-z, 0-9, '-'");
  const url = str(raw, "url", true);
  try {
    new URL(url);
  } catch {
    throw new ConfigError(`book.yaml: 'url' không hợp lệ: ${url}`);
  }

  const adapterRaw = str(raw, "adapter");
  if (adapterRaw !== undefined && !(ADAPTER_IDS as readonly string[]).includes(adapterRaw)) {
    throw new ConfigError(`book.yaml: 'adapter' phải là một trong ${ADAPTER_IDS.join(", ")}`);
  }
  const adapter = (adapterRaw as AdapterId | undefined) ?? detectAdapter(url);
  if (!adapter) throw new ConfigError(`book.yaml: không nhận ra site của ${url}; hãy ghi rõ 'adapter'`);

  const language = str(raw, "language") ?? "zh";
  if (language !== "zh" && language !== "en") throw new ConfigError("book.yaml: 'language' phải là zh hoặc en");

  let chapters: BookConfig["chapters"];
  if (raw["chapters"] !== undefined) {
    if (!isObj(raw["chapters"])) throw new ConfigError("book.yaml: 'chapters' phải là { from, to }");
    const from = num(raw["chapters"], "from", 1, { min: 1, int: true });
    const to = num(raw["chapters"], "to", from, { min: 1, int: true });
    if (to < from) throw new ConfigError("book.yaml: chapters.to phải ≥ chapters.from");
    chapters = { from, to };
  }

  const c = raw["crawler"] ?? {};
  if (!isObj(c)) throw new ConfigError("book.yaml: 'crawler' phải là object");
  const d = defaultCrawler(adapter);
  const junkRaw = c["junkPatterns"] ?? [];
  if (!Array.isArray(junkRaw)) throw new ConfigError("book.yaml: crawler.junkPatterns phải là danh sách");
  const junkPatterns = junkRaw.map((j, i): JunkPatternSpec => {
    // CORE-04: chấp nhận chuỗi trần cho tiện, nhưng cấm cú pháp inline (?i) kiểu Python.
    const spec = typeof j === "string" ? { pattern: j } : j;
    if (!isObj(spec) || typeof spec["pattern"] !== "string") {
      throw new ConfigError(`book.yaml: crawler.junkPatterns[${i}] phải là { pattern, flags? }`);
    }
    if (spec["pattern"].startsWith("(?")) {
      const inline = /^\(\?([a-z]+)\)/.exec(spec["pattern"]);
      if (inline) {
        throw new ConfigError(
          `book.yaml: crawler.junkPatterns[${i}] dùng cờ inline '(?${inline[1]})' (Python). JS không hỗ trợ; dùng { pattern: "…", flags: "${inline[1]}" }.`,
        );
      }
    }
    const flags = spec["flags"];
    if (flags !== undefined && typeof flags !== "string") throw new ConfigError(`book.yaml: crawler.junkPatterns[${i}].flags phải là chuỗi`);
    return flags === undefined ? { pattern: spec["pattern"] } : { pattern: spec["pattern"], flags };
  });
  const numbering = str(c, "numbering") ?? d.numbering;
  if (numbering !== "title" && numbering !== "order") throw new ConfigError("book.yaml: crawler.numbering phải là title hoặc order");

  const b = raw["backup"] ?? {};
  if (!isObj(b)) throw new ConfigError("book.yaml: 'backup' phải là object");
  const backupDir = str(b, "dir");
  const backup = { ...(backupDir !== undefined ? { dir: backupDir } : {}), keepBatches: num(b, "keepBatches", 5, { min: 1, int: true }) };

  const title = str(raw, "title");
  return {
    backup,
    id,
    ...(title !== undefined ? { title } : {}),
    url,
    adapter,
    language,
    ...(chapters ? { chapters } : {}),
    crawler: {
      delaySeconds: num(c, "delaySeconds", d.delaySeconds),
      maxRetries: num(c, "maxRetries", d.maxRetries, { int: true }),
      retryBackoffSeconds: num(c, "retryBackoffSeconds", d.retryBackoffSeconds),
      timeoutSeconds: num(c, "timeoutSeconds", d.timeoutSeconds, { min: 1 }),
      maxConsecutiveFailures: num(c, "maxConsecutiveFailures", d.maxConsecutiveFailures, { min: 1, int: true }),
      junkPatterns,
      numbering,
      verifyTitleNumber: bool(c, "verifyTitleNumber", d.verifyTitleNumber),
      headless: bool(c, "headless", d.headless),
      manualVerificationSeconds: num(c, "manualVerificationSeconds", d.manualVerificationSeconds, { min: 1 }),
    },
  };
}

export async function loadBookConfig(path: string): Promise<BookConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new ConfigError(`Không đọc được ${path}. Chạy 'novel init' trước?`);
  }
  return parseBookConfig(parseYaml(text));
}
