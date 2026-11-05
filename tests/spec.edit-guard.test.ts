import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import {
  changedParagraphs,
  checkEdit,
  EditGuardError,
  paragraphCount,
  parseAgentInfo,
  parseChangeLog,
  prepareEdit,
  redraftChapters,
  splitBlocks,
} from "../src/edit-guard.js";

// Câu văn tự viết cho test, không lấy từ truyện.
const RAW = "---\ncontent_hash: abc\n---\n# 第一章\n\n他走进院子。\n\n天下雨了。\n\n她笑着点头。\n";
const V1 = "# Chương 1\n\nAnh ta đi vào sân.\n\nTrời đổ mưa rồi.\n\nCô ấy cười gật đầu.\n";
const V2_OK = "# Chương 1\n\nAnh bước vào sân.\n\nTrời đổ mưa rồi.\n\nCô ấy cười gật đầu.\n";

const report = (body: string, head = "Chương: 1 PASS (sửa 1)") =>
  `Đã áp dụng: literary-editor-master.md, translation-master.md, vietnamese-style.md, modules: modern, context v1, mode REVIEW_EDIT
VERDICT: PASS
${head}

## Thay đổi quan trọng (cho người duyệt)
- không có

## Change log
${body}

## Post-edit Source Fidelity Check
- E-ch0001-01: PASS

## Phạm vi đã soát / chưa soát
- ch1 toàn văn
`;
const ENTRY = `- id: E-ch0001-01
  chapter: 1 · paragraph: 1 · step: 4 (Anti-Translationese) · rule: R6 · severity: MINOR
  basis: "vietnamese-style §3"
  before: "Anh ta đi vào sân."
  after:  "Anh bước vào sân."`;

describe("đoạn và diff", () => {
  it("tách block theo dòng trống, block 0 là tiêu đề", () => {
    expect(splitBlocks(V1)).toHaveLength(4);
    expect(paragraphCount(V1)).toBe(3);
    expect(paragraphCount(RAW)).toBe(3); // frontmatter + tiêu đề là block 0
    expect(splitBlocks("a\n\n\n\nb")).toEqual(["a", "b"]);
  });
  it("liệt kê đúng đoạn đổi", () => {
    expect(changedParagraphs(V1, V2_OK)).toEqual([1]);
    expect(changedParagraphs(V1, V1.replace("Chương 1", "Chương Một"))).toEqual([0]);
  });
});

describe("parseChangeLog / redraftChapters", () => {
  it("đọc id, chương, đoạn trong mục Change log", () => {
    const { entries, problems } = parseChangeLog(report(ENTRY));
    expect(problems).toEqual([]);
    expect(entries).toEqual([{ id: "E-ch0001-01", chapter: 1, paragraph: 1 }]);
  });
  it("báo lỗi khi một change ID trỏ nhiều đoạn", () => {
    const { problems } = parseChangeLog(report(ENTRY.replace("paragraph: 1 ·", "paragraph: 1-3 ·")));
    expect(problems[0]).toMatch(/paragraph phải là một số/);
  });
  it("nhận chương REDRAFT ở dòng Chương", () => {
    expect(redraftChapters("Chương: 6 PASS (sửa 7) · 7 REDRAFT (quá nhiều lỗi) · 8 REDRAFT")).toEqual([7, 8]);
  });
});

describe("prepareEdit + checkEdit", () => {
  let book: string;
  beforeEach(async () => {
    book = await mkdtemp(join(tmpdir(), "edit-guard-"));
    for (const d of ["raw", "translated", "context/proposals", "reviews/b0001"]) await mkdir(join(book, d), { recursive: true });
    await writeFile(join(book, "raw/chapter-0001.md"), RAW);
    await writeFile(join(book, "translated/chapter-0001.v1.md"), V1);
    await writeFile(join(book, "context/glossary.md"), "| Gốc | Dịch |\n");
    await writeFile(join(book, "context/proposals/b0001.md"), "- đề xuất\n");
    await writeFile(join(book, "reviews/b0001/summaries.md"), "## Chương 1\n");
  });
  const prep = () => prepareEdit(book, { batch: "b0001", chapters: [1], from: "v1", to: "v2", now: new Date("2026-11-05T00:00:00Z") });
  const writeReport = (r: string) => writeFile(join(book, "reviews/b0001/editor-batch.md"), r);
  const check = () => checkEdit(book, "b0001", "reviews/b0001/editor-batch.md");

  it("sao chép v1 → v2 và chụp hash file được bảo vệ", async () => {
    const g = await prep();
    expect(await readFile(join(book, "translated/chapter-0001.v2.md"), "utf8")).toBe(V1);
    expect(Object.keys(g.hashes)).toEqual([
      "context/glossary.md",
      "context/proposals/b0001.md",
      "raw/chapter-0001.md",
      "reviews/b0001/summaries.md",
      "translated/chapter-0001.v1.md",
    ]);
  });
  it("từ chối khi version đích đã tồn tại", async () => {
    await writeFile(join(book, "translated/chapter-0001.v2.md"), V1);
    await expect(prep()).rejects.toBeInstanceOf(EditGuardError);
  });
  it("PASS khi mọi đoạn đổi đều có change ID", async () => {
    await prep();
    await writeFile(join(book, "translated/chapter-0001.v2.md"), V2_OK);
    await writeReport(report(ENTRY));
    const r = await check();
    expect(r.fails).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.chapters[0]?.changed).toEqual([1]);
  });
  it("FAIL khi đoạn đổi không có change ID", async () => {
    await prep();
    await writeFile(join(book, "translated/chapter-0001.v2.md"), V2_OK.replace("Trời đổ mưa rồi.", "Trời mưa."));
    await writeReport(report(ENTRY));
    const r = await check();
    expect(r.ok).toBe(false);
    expect(r.fails.join("\n")).toMatch(/không có change ID: 2/);
  });
  it("FAIL khi Editor sửa bản nháp v1 hoặc context", async () => {
    await prep();
    await writeFile(join(book, "translated/chapter-0001.v1.md"), V2_OK);
    await writeFile(join(book, "context/glossary.md"), "đổi\n");
    await writeReport(report(""));
    const r = await check();
    expect(r.fails).toEqual(expect.arrayContaining(["file được bảo vệ bị đổi: translated/chapter-0001.v1.md", "file được bảo vệ bị đổi: context/glossary.md"]));
  });
  it("FAIL khi lệch số đoạn, sót chữ Hán, lọt ghi chú hoặc report thiếu mục", async () => {
    await prep();
    await writeFile(join(book, "translated/chapter-0001.v2.md"), "# Chương 1\n\nAnh bước vào 院子.\n\n[Chú thích: thử]\n");
    await writeReport("Đã áp dụng: x\nVERDICT: PASS\n");
    const f = (await check()).fails.join("\n");
    expect(f).toMatch(/số đoạn raw 3 ≠ bản biên tập 2/);
    expect(f).toMatch(/còn chữ Hán/);
    expect(f).toMatch(/ghi chú lọt vào truyện/);
    expect(f).toMatch(/report thiếu mục `## Change log`/);
  });
  it("REDRAFT: bỏ qua kiểm diff, chỉ cảnh báo", async () => {
    await prep();
    await writeReport(report("", "Chương: 1 REDRAFT (trên 30% đoạn sai nghĩa)"));
    const r = await check();
    expect(r.ok).toBe(true);
    expect(r.warns.join("\n")).toMatch(/REDRAFT/);
  });
  it("CLI edit-prep / edit-check trả mã 0 và 2", async () => {
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await main(["edit-prep", book, "--batch", "b0001", "--chapters", "1", "--from", "v1", "--to", "v2"])).toBe(0);
      await writeFile(join(book, "translated/chapter-0001.v2.md"), V2_OK);
      await writeReport(report(ENTRY));
      expect(await main(["edit-check", book, "--batch", "b0001", "--report", "reviews/b0001/editor-batch.md"])).toBe(0);
      await writeReport(report(""));
      expect(await main(["edit-check", book, "--batch", "b0001", "--report", "reviews/b0001/editor-batch.md"])).toBe(2);
    } finally {
      log.mockRestore();
    }
  });
});

describe("agent-check", () => {
  const line = (o: unknown) => JSON.stringify(o);
  const usage = { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 30, output_tokens_details: { thinking_tokens: 10 } };
  const jsonl = [
    line({ type: "user", message: { content: "MODE: CONTEXT_INIT" } }),
    line({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage, content: [{ type: "thinking" }] } }),
    line({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage, content: [{ type: "tool_use" }] } }),
    line({ type: "assistant", message: { id: "m2", model: "claude-opus-5-5", usage, content: [] } }),
  ].join("\n");

  it("parseAgentInfo lấy model và requestShape", () => {
    expect(parseAgentInfo(jsonl, '{"agentType":"translator","requestShape":"background"}')).toEqual({
      agentType: "translator",
      requestShape: "background",
      models: ["claude-opus-5-5"],
      usage: { calls: 2, input: 4, cacheRead: 200, cacheWrite: 100, output: 60, thinking: 20 },
    });
  });

  let root: string;
  let saved: string | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agent-check-"));
    await mkdir(join(root, "proj", "sess", "subagents"), { recursive: true });
    await writeFile(join(root, "proj/sess/subagents/agent-abc123.jsonl"), jsonl);
    saved = process.env["CLAUDE_PROJECTS_DIR"];
    process.env["CLAUDE_PROJECTS_DIR"] = root;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env["CLAUDE_PROJECTS_DIR"];
    else process.env["CLAUDE_PROJECTS_DIR"] = saved;
  });
  it("mã 0 khi đúng model và foreground; 2 khi sai model hoặc chạy nền", async () => {
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await writeFile(join(root, "proj/sess/subagents/agent-abc123.meta.json"), '{"agentType":"translator","requestShape":"foreground"}');
      expect(await main(["agent-check", ".", "--agent", "abc123", "--model", "opus"])).toBe(0);
      expect(await main(["agent-check", ".", "--agent", "abc123", "--model", "sonnet"])).toBe(2);
      await writeFile(join(root, "proj/sess/subagents/agent-abc123.meta.json"), '{"agentType":"translator","requestShape":"background"}');
      expect(await main(["agent-check", ".", "--agent", "abc123"])).toBe(2);
    } finally {
      log.mockRestore();
    }
  });
});
