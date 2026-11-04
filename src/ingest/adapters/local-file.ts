/**
 * local-file: nhập chương từ file text có sẵn (bản tự chép, raw của V1…).
 *
 * Quy tắc tách đoạn:
 * - Có dòng trống → mỗi khối là một đoạn (định dạng raw V1: `tiêu đề\n\nđoạn\n\nđoạn`).
 *   Xuống dòng bên trong khối được nối lại (văn bản tiếng Anh hay bị ngắt dòng cứng).
 * - Không có dòng trống → mỗi dòng là một đoạn (kiểu text Trung thường gặp).
 * Dòng/khối đầu tiên là tiêu đề, trừ khi truyền `title`.
 */
import { compileJunkPatterns, isJunk, type JunkPatternSpec, parserFingerprint } from "../core/junk.js";
import type { RawChapter } from "../types.js";

export const LOCAL_FILE_PARSER_VERSION = 1;

/** Nối các dòng trong một khối: giữa hai chữ Latin thì thêm dấu cách, chữ Hán thì nối liền. */
function joinLines(lines: string[]): string {
  return lines.reduce((acc, line) => {
    if (!acc) return line;
    const needsSpace = /[A-Za-z0-9,.;:!?'")\]]$/.test(acc) && /^[A-Za-z0-9"'(\[]/.test(line);
    return acc + (needsSpace ? " " : "") + line;
  }, "");
}

export function parseLocalText(
  text: string,
  opts: { chapterNumber: number; url?: string; title?: string; junk?: readonly RegExp[] },
): RawChapter {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const clean = (s: string) => s.replace(/\s+/gu, " ").trim();
  const blocks = /\n[ \t　]*\n/.test(normalized)
    ? normalized.split(/\n[ \t　]*\n/).map((b) => clean(joinLines(b.split("\n").map((l) => l.trim()).filter(Boolean))))
    : normalized.split("\n").map(clean);
  let items = blocks.filter(Boolean);

  let title = opts.title?.trim();
  if (!title) {
    title = items[0] ?? `第${opts.chapterNumber}章`;
    items = items.slice(1);
  }
  const junk = opts.junk ?? [];
  return {
    number: opts.chapterNumber,
    url: opts.url ?? "",
    title,
    paragraphs: items.filter((p) => !isJunk(p, junk)),
    metadata: {},
  };
}

export function localFileFingerprint(junk: readonly RegExp[]): string {
  return parserFingerprint("local-file", LOCAL_FILE_PARSER_VERSION, junk);
}

export const compileLocalJunk = (defaults: readonly JunkPatternSpec[], extra: readonly JunkPatternSpec[]) =>
  compileJunkPatterns(defaults, extra);
