/**
 * Lưu raw chương vào repo dữ liệu: `chapters/NNN/source.md` có frontmatter (D-07).
 *
 *   ---
 *   stage: source
 *   chapter: 12
 *   parser: shuku52@2+junk:1a2b3c4d
 *   content_hash: <hex, cùng công thức V1>
 *   output_sha256: sha256:<hash của phần thân bên dưới>
 *   ...
 *   ---
 *   # 第12章 雾港
 *
 *   đoạn 1
 *
 *   đoạn 2
 *
 * `output_sha256` cho phép phát hiện file bị sửa tay. Raw hợp lệ (CORE-13) khi file
 * tồn tại, hash thân khớp, và `parser` trùng fingerprint hiện tại.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { RawChapter } from "../types.js";
import { type CheckResult, LENGTH_WINDOW, MIN_CONTENT_CHARS, type NeighborInfo, sha256 } from "./checks.js";
import { writeFileAtomic } from "./fs-atomic.js";

/** Đường dẫn chuẩn trong một repo dữ liệu `novel-books/<book-id>/`. */
export class BookPaths {
  constructor(readonly root: string) {}
  get bookFile(): string { return join(this.root, "book.yaml"); }
  get chaptersDir(): string { return join(this.root, "chapters"); }
  get reportFile(): string { return join(this.root, "ingest-report.md"); }
  /** Gitignored: HTML cache (gồm cả mục lục), browser profile, lock. */
  get cacheDir(): string { return join(this.root, ".cache"); }
  get htmlCacheDir(): string { return join(this.cacheDir, "html"); }
  get browserProfileDir(): string { return join(this.cacheDir, "browser-profile"); }
  get lockFile(): string { return join(this.cacheDir, "ingest.lock"); }

  chapterDir(n: number): string { return join(this.chaptersDir, chapterDirName(n)); }
  sourceFile(n: number): string { return join(this.chapterDir(n), "source.md"); }
}

/** `chapters/NNN`: tối thiểu 3 chữ số để sắp xếp đúng theo tên. */
export const chapterDirName = (n: number): string => String(n).padStart(3, "0");

export interface SourceFrontmatter {
  stage: "source";
  chapter: number;
  adapter: string;
  parser: string;
  url: string;
  title: string;
  ingest_status: CheckResult["status"];
  issues: string[];
  content_hash: string;
  source_chars: number;
  metadata: Record<string, unknown>;
  fetched_at: string;
  output_sha256: string;
}

export interface StoredSource {
  frontmatter: SourceFrontmatter;
  title: string;
  paragraphs: string[];
  /** false nếu thân bài bị sửa sau khi ghi (hash không khớp). */
  intact: boolean;
}

function renderBody(title: string, paragraphs: readonly string[]): string {
  return `# ${title}\n\n${paragraphs.join("\n\n")}\n`;
}

/**
 * Đọc lại thân bài. Đoạn văn đã được gộp khoảng trắng khi parse nên không chứa
 * dòng trống; tách theo dòng trống là khôi phục đúng danh sách đoạn.
 */
function parseBody(body: string): { title: string; paragraphs: string[] } {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const first = blocks[0] ?? "";
  const title = first.startsWith("# ") ? first.slice(2).trim() : "";
  return { title, paragraphs: title ? blocks.slice(1) : blocks };
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

export class RawStore {
  constructor(readonly paths: BookPaths) {}

  async save(
    chapter: RawChapter,
    info: { adapter: string; parser: string; check: CheckResult; fetchedAt?: string },
  ): Promise<SourceFrontmatter> {
    const body = renderBody(chapter.title, chapter.paragraphs);
    const frontmatter: SourceFrontmatter = {
      stage: "source",
      chapter: chapter.number,
      adapter: info.adapter,
      parser: info.parser,
      url: chapter.url,
      title: chapter.title,
      ingest_status: info.check.status,
      issues: info.check.issues,
      content_hash: info.check.contentHash,
      source_chars: info.check.sourceChars,
      metadata: chapter.metadata,
      fetched_at: info.fetchedAt ?? new Date().toISOString(),
      output_sha256: sha256(body),
    };
    const yaml = stringifyYaml(frontmatter, { lineWidth: 0 });
    await writeFileAtomic(this.paths.sourceFile(chapter.number), `---\n${yaml}---\n${body}`);
    return frontmatter;
  }

  async load(n: number): Promise<StoredSource | null> {
    let text: string;
    try {
      text = await readFile(this.paths.sourceFile(n), "utf8");
    } catch {
      return null;
    }
    const m = FRONTMATTER_RE.exec(text);
    if (!m?.[1]) return null;
    let frontmatter: SourceFrontmatter;
    try {
      frontmatter = parseYaml(m[1]) as SourceFrontmatter;
    } catch {
      return null;
    }
    const body = text.slice(m[0].length);
    return { frontmatter, ...parseBody(body), intact: sha256(body) === frontmatter.output_sha256 };
  }

  /** CORE-13: có raw hợp lệ, nguyên vẹn, cùng parser fingerprint thì bỏ qua. */
  async isUpToDate(n: number, parserFingerprint: string): Promise<boolean> {
    const s = await this.load(n);
    return (
      s !== null &&
      s.intact &&
      s.frontmatter.parser === parserFingerprint &&
      s.frontmatter.source_chars >= MIN_CONTENT_CHARS
    );
  }

  /** Số chương đang có source.md (theo tên thư mục). */
  async listChapters(): Promise<number[]> {
    let names: string[];
    try {
      names = await readdir(this.paths.chaptersDir);
    } catch {
      return [];
    }
    return names.filter((d) => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b);
  }

  /**
   * Số liệu (hash, độ dài) của mọi chương đã có, nạp **một lần** mỗi lần chạy.
   * Orchestrator cập nhật map này trong bộ nhớ sau mỗi chương mới ghi.
   */
  async loadIndex(): Promise<Map<number, NeighborInfo>> {
    const index = new Map<number, NeighborInfo>();
    for (const k of await this.listChapters()) {
      const s = await this.load(k);
      if (s?.intact) index.set(k, { contentHash: s.frontmatter.content_hash, sourceChars: s.frontmatter.source_chars });
    }
    return index;
  }
}

/** Lọc index về các chương trong phạm vi ±LENGTH_WINDOW quanh `n` (cho CORE-07, CORE-08). */
export function neighborsOf(index: ReadonlyMap<number, NeighborInfo>, n: number): Map<number, NeighborInfo> {
  return new Map([...index].filter(([k]) => k !== n && Math.abs(k - n) <= LENGTH_WINDOW));
}
