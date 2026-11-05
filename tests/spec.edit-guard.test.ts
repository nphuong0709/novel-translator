import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import {
  changedParagraphs,
  checkEdit,
  currentRound,
  EditGuardError,
  nextVersion,
  parseForbiddenTerms,
  scanTerms,
  tidyVersions,
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
      finished: null,
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
  it("finished: lấy từ meta.json, không có thì từ lượt cuối (SubagentHandback / end_turn)", () => {
    const handback = line({ type: "assistant", message: { id: "m3", model: "claude-opus-5-5", usage, content: [{ type: "tool_use", name: "SubagentHandback" }] } });
    const endTurn = line({ type: "assistant", message: { id: "m3", model: "claude-opus-5-5", usage, stop_reason: "end_turn", content: [] } });
    expect(parseAgentInfo(`${jsonl}\n${handback}`, null).finished).toBe(true);
    expect(parseAgentInfo(`${jsonl}\n${endTurn}`, null).finished).toBe(true);
    // Lượt cuối chưa kết thúc dù trước đó có handback.
    expect(parseAgentInfo(`${handback}\n${jsonl}`, null).finished).toBe(null);
    expect(parseAgentInfo(`${jsonl}\n${handback}`, '{"finished":false}').finished).toBe(false);
    expect(parseAgentInfo(jsonl, '{"finished":true}').finished).toBe(true);
  });

  it("mã 0 khi đúng model và foreground; 2 khi sai model hoặc chạy nền chưa xong", async () => {
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await writeFile(join(root, "proj/sess/subagents/agent-abc123.meta.json"), '{"agentType":"translator","requestShape":"foreground"}');
      expect(await main(["agent-check", ".", "--agent", "abc123", "--model", "opus"])).toBe(0);
      expect(await main(["agent-check", ".", "--agent", "abc123", "--model", "sonnet"])).toBe(2);
      await writeFile(join(root, "proj/sess/subagents/agent-abc123.meta.json"), '{"agentType":"translator","requestShape":"background"}');
      expect(await main(["agent-check", ".", "--agent", "abc123"])).toBe(2);
      await writeFile(join(root, "proj/sess/subagents/agent-abc123.meta.json"), '{"agentType":"translator","requestShape":"background","finished":false}');
      expect(await main(["agent-check", ".", "--agent", "abc123"])).toBe(2);
      // Chạy nền nhưng đã xong: chỉ cảnh báo; sai model vẫn chặn.
      await writeFile(join(root, "proj/sess/subagents/agent-abc123.meta.json"), '{"agentType":"translator","requestShape":"background","finished":true}');
      expect(await main(["agent-check", ".", "--agent", "abc123", "--model", "opus"])).toBe(0);
      expect(await main(["agent-check", ".", "--agent", "abc123", "--model", "sonnet"])).toBe(2);
    } finally {
      log.mockRestore();
    }
  });
});

describe("version theo từng chương (--next), sync, report nhiều vòng", () => {
  let book: string;
  const status = (chs: Record<string, { current_version: string; approved_version?: string | null }>) =>
    writeFile(join(book, "status.json"), JSON.stringify({ chapters: chs }));
  beforeEach(async () => {
    book = await mkdtemp(join(tmpdir(), "edit-guard-next-"));
    for (const d of ["raw", "translated/.history", "context", "reviews/b0001", "reviews/b0002", "reviews/sync"]) await mkdir(join(book, d), { recursive: true });
    for (const n of ["0001", "0002"]) await writeFile(join(book, `raw/chapter-${n}.md`), RAW);
    await writeFile(join(book, "translated/chapter-0001.v1.md"), V1);
    await writeFile(join(book, "translated/chapter-0001.v2.md"), V1);
    await writeFile(join(book, "translated/chapter-0002.v1.md"), V1);
    await writeFile(join(book, "translated/.history/chapter-0002.v3.md.partial"), V1);
    await writeFile(join(book, "reviews/b0001/summaries.md"), "## Chương 1\n");
    await writeFile(join(book, "reviews/b0002/summaries.md"), "## Chương 2\n");
    await status({ "0001": { current_version: "v2" }, "0002": { current_version: "v1" } });
  });

  it("nextVersion tính cả file trong .history", async () => {
    expect(await nextVersion(book, 1)).toBe("v3");
    expect(await nextVersion(book, 2)).toBe("v4");
  });

  it("--next: mỗi chương từ current_version tới version trống kế tiếp; guard sync bảo vệ summaries mọi batch", async () => {
    const g = await prepareEdit(book, { batch: "sync", chapters: [2, 1], next: true });
    expect(g.items).toEqual([
      { chapter: 1, from: "v2", to: "v3" },
      { chapter: 2, from: "v1", to: "v4" },
    ]);
    expect(g.from).toBe("mixed");
    expect(Object.keys(g.hashes)).toEqual(expect.arrayContaining(["reviews/b0001/summaries.md", "reviews/b0002/summaries.md"]));
    await writeFile(join(book, "translated/chapter-0001.v3.md"), V2_OK);
    await writeFile(join(book, "reviews/sync/editor-sync.md"), report(ENTRY));
    const r = await checkEdit(book, "sync", "reviews/sync/editor-sync.md");
    expect(r.fails).toEqual([]);
    expect(r.chapters.map((c) => c.changed)).toEqual([[1], []]);
  });

  it("từ chối --next cùng --from/--to", async () => {
    await expect(prepareEdit(book, { batch: "b0001", chapters: [1], next: true, from: "v1", to: "v2" })).rejects.toBeInstanceOf(EditGuardError);
  });

  it("report nhiều vòng: chỉ xét vòng cuối", async () => {
    const r1 = report(ENTRY);
    const r2 = report("", "Chương: 1 PASS (sửa 0)");
    expect(currentRound(`${r1}\n# Vòng 2\n${r2}`)).toBe(`\n${r2}`);
    expect(currentRound(r1)).toBe(r1);
    await prepareEdit(book, { batch: "b0001", chapters: [1], next: true });
    await writeFile(join(book, "translated/chapter-0001.v3.md"), V2_OK);
    // vòng 1 (cũ) có change ID, vòng 2 (cuối) thì không → FAIL
    await writeFile(join(book, "reviews/b0001/editor-rework.md"), `# Vòng 1\n${r1}\n# Vòng 2\n${r2}`);
    expect((await checkEdit(book, "b0001", "reviews/b0001/editor-rework.md")).ok).toBe(false);
    await writeFile(join(book, "reviews/b0001/editor-rework.md"), `# Vòng 1\n${r2}\n# Vòng 2\n${r1}`);
    expect((await checkEdit(book, "b0001", "reviews/b0001/editor-rework.md")).ok).toBe(true);
  });
});

describe("tidy", () => {
  it("giữ v1, current, approved; chuyển phần còn lại vào .history (không ghi đè)", async () => {
    const book = await mkdtemp(join(tmpdir(), "tidy-"));
    await mkdir(join(book, "translated/.history"), { recursive: true });
    for (const v of ["v1", "v2", "v3", "v4"]) await writeFile(join(book, `translated/chapter-0001.${v}.md`), v);
    await writeFile(join(book, "translated/chapter-0002.v1.md"), "x");
    await writeFile(join(book, "translated/chapter-0002.v2.md"), "x");
    await writeFile(join(book, "translated/.history/chapter-0001.v2.md"), "cũ");
    await writeFile(
      join(book, "status.json"),
      JSON.stringify({ chapters: { "0001": { current_version: "v4", approved_version: "v3" }, "0002": { current_version: null } } }),
    );
    const moves = await tidyVersions(book);
    expect(moves).toEqual([{ from: "translated/chapter-0001.v2.md", to: "translated/.history/chapter-0001.v2.md.2" }]);
    expect(await readFile(join(book, "translated/.history/chapter-0001.v2.md"), "utf8")).toBe("cũ");
  });
});

describe("term-scan", () => {
  const GLOSSARY = `# Glossary

| Gốc | Bản dịch | Biến thể cấm | Ghi chú |
|---|---|---|---|
| 块 | tệ | đồng | phụ thuộc ngữ cảnh: không quét |

| Gốc | Đúng | Cấm (scan) | Quyết định |
|---|---|---|---|
| 父母 | **ba mẹ** | bố mẹ | U6 |
| 切片 | xắt lát | "thái lát", "thái sợi" | U18 |
| 院子 | sân | — | |

Đoạn văn không phải bảng.

| Gốc | Bản dịch |
|---|---|
| 雨 | mưa |
`;
  it("chỉ đọc cột Cấm (scan), bỏ ô trống", () => {
    expect(parseForbiddenTerms(GLOSSARY, "context/glossary.md")).toEqual([
      { term: "bố mẹ", canonical: "ba mẹ", source: "context/glossary.md" },
      { term: "thái lát", canonical: "xắt lát", source: "context/glossary.md" },
      { term: "thái sợi", canonical: "xắt lát", source: "context/glossary.md" },
    ]);
  });
  it("tìm trong current_version, khớp nguyên từ, không đọc proposals", async () => {
    const book = await mkdtemp(join(tmpdir(), "term-scan-"));
    for (const d of ["translated", "context/proposals"]) await mkdir(join(book, d), { recursive: true });
    await writeFile(join(book, "context/glossary.md"), GLOSSARY);
    await writeFile(join(book, "context/proposals/b0001.md"), "| A | B | Cấm (scan) |\n|---|---|---|\n| x | y | trời |\n");
    await writeFile(join(book, "translated/chapter-0001.v1.md"), "# Chương 1\n\nBố mẹ cậu thái lát thịt.\n");
    await writeFile(join(book, "translated/chapter-0001.v2.md"), "# Chương 1\n\nBa mẹ cậu xắt lát thịt. Bố mẹđẻ.\n");
    await writeFile(join(book, "status.json"), JSON.stringify({ chapters: { "0001": { current_version: "v2" } } }));
    const { hits } = await scanTerms(book);
    expect(hits).toEqual([]);
    await writeFile(join(book, "status.json"), JSON.stringify({ chapters: { "0001": { current_version: "v1" } } }));
    const r = await scanTerms(book);
    expect(r.hits.map((h) => [h.term, h.line])).toEqual([
      ["bố mẹ", 3],
      ["thái lát", 3],
    ]);
  });
});
