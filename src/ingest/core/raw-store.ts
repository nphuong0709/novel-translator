/**
 * Lưu raw chương: `books/<id>/raw/chapter-NNNN.md` có frontmatter, cùng `manifest.json`
 * (theo `rules/artifact-contract.md` của workflow skill).
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

/** Đường dẫn chuẩn trong một thư mục truyện `books/<book-id>/`. */
export class BookPaths {
  constructor(readonly root: string) {}
  get bookFile(): string { return join(this.root, "book.yaml"); }
  get rawDir(): string { return join(this.root, "raw"); }
  get manifestFile(): string { return join(this.root, "manifest.json"); }
  get reportFile(): string { return join(this.root, "reviews", "ingestion.md"); }
  /** Không backup, không commit: HTML cache (gồm cả mục lục), browser profile, lock. */
  get cacheDir(): string { return join(this.root, ".cache"); }
  get htmlCacheDir(): string { return join(this.cacheDir, "html"); }
  get browserProfileDir(): string { return join(this.cacheDir, "browser-profile"); }
  get lockFile(): string { return join(this.cacheDir, "ingest.lock"); }

  sourceFile(n: number): string { return join(this.rawDir, `chapter-${chapterId(n)}.md`); }
}

/** Mã chương 4 chữ số (`0001`), dùng chung cho raw, bản dịch và status. */
export const chapterId = (n: number): string => String(n).padStart(4, "0");
const RAW_FILE_RE = /^chapter-(\d{4,})\.md$/;

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

export interface ManifestMeta {
  bookId: string;
  title?: string;
  sourceLanguage: string;
  sourceUrl: string;
  adapter: string;
}

export interface ManifestChapter {
  id: string;
  number: number;
  title: string;
  url: string;
  status: CheckResult["status"] | "MODIFIED";
  issues: string[];
  content_hash: string;
  source_chars: number;
  parser: string;
  fetched_at: string;
  file: string;
}

export interface Manifest {
  book_id: string;
  title?: string;
  source_language: string;
  target_language: "vi";
  source_url: string;
  adapter: string;
  rights_confirmation: string;
  chapter_count: number;
  counts: Record<string, number>;
  chapters: ManifestChapter[];
  generated_at: string;
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

  /** Số chương đang có `raw/chapter-NNNN.md` (theo tên file). */
  async listChapters(): Promise<number[]> {
    let names: string[];
    try {
      names = await readdir(this.paths.rawDir);
    } catch {
      return [];
    }
    return names
      .map((f) => RAW_FILE_RE.exec(f)?.[1])
      .filter((x): x is string => x !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
  }

  /**
   * Ghi `manifest.json` từ các file raw đang có (nguồn sự thật là raw, manifest chỉ là
   * bản tổng hợp để skill đọc nhanh). Chương có file nhưng bị sửa tay: `status: MODIFIED`.
   */
  async writeManifest(meta: ManifestMeta): Promise<Manifest> {
    const chapters: ManifestChapter[] = [];
    for (const n of await this.listChapters()) {
      const s = await this.load(n);
      if (!s) continue;
      const f = s.frontmatter;
      chapters.push({
        id: chapterId(n),
        number: n,
        title: f.title,
        url: f.url,
        status: s.intact ? f.ingest_status : "MODIFIED",
        issues: f.issues,
        content_hash: f.content_hash,
        source_chars: f.source_chars,
        parser: f.parser,
        fetched_at: f.fetched_at,
        file: `raw/chapter-${chapterId(n)}.md`,
      });
    }
    const counts: Record<string, number> = {};
    for (const c of chapters) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const manifest: Manifest = {
      book_id: meta.bookId,
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      source_language: meta.sourceLanguage,
      target_language: "vi",
      source_url: meta.sourceUrl,
      adapter: meta.adapter,
      rights_confirmation: "user-confirmed authorized input; not verified by framework",
      chapter_count: chapters.length,
      counts,
      chapters,
      generated_at: new Date().toISOString(),
    };
    await writeFileAtomic(this.paths.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
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
