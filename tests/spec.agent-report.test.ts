import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkReport, extractHandback, findAgentTranscript } from "../src/agent-report.js";
import { main } from "../src/cli.js";

const REPORT = "Đã áp dụng: critic-master.md, mode CHAPTER\nPhạm vi: demo · chương 1\nVERDICT: PASS\n\n## A\nKhông có issue.";

const line = (o: unknown) => JSON.stringify(o);
const transcript = (report: string) =>
  [
    line({ type: "user", message: { role: "user", content: "MODE: CHAPTER" } }),
    line({ type: "assistant", message: { content: [{ type: "text", text: "Đang đọc file." }] } }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", name: "SubagentHandback", input: { message: report } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
  ].join("\n");

describe("extractHandback", () => {
  it("lấy nguyên văn message của SubagentHandback cuối", () => {
    expect(extractHandback(transcript(REPORT))).toBe(REPORT);
  });
  it("không có handback thì lấy text assistant cuối", () => {
    const t = [line({ type: "assistant", message: { content: [{ type: "text", text: "báo cáo cũ" }] } }), line({ type: "assistant", message: { content: [{ type: "text", text: "báo cáo cuối" }] } })].join("\n");
    expect(extractHandback(t)).toBe("báo cáo cuối");
  });
  it("bỏ qua dòng hỏng, trả null khi trống", () => {
    expect(extractHandback("{hỏng\n\n")).toBeNull();
  });
});

describe("checkReport", () => {
  it("nhận ra hai dòng bắt buộc", () => {
    expect(checkReport(REPORT)).toEqual({ hasApplied: true, verdict: "PASS" });
    expect(checkReport("không có gì")).toEqual({ hasApplied: false, verdict: null });
  });
});

describe("save-report CLI", () => {
  let root: string;
  let book: string;
  beforeEach(async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    root = await mkdtemp(join(tmpdir(), "nt-proj-"));
    book = await mkdtemp(join(tmpdir(), "nt-book-"));
    await mkdir(join(root, "proj-a", "sess-1", "subagents"), { recursive: true });
    await writeFile(join(root, "proj-a", "sess-1", "subagents", "agent-abc123def.jsonl"), transcript(REPORT));
    process.env["CLAUDE_PROJECTS_DIR"] = root;
  });
  afterEach(() => {
    delete process.env["CLAUDE_PROJECTS_DIR"];
    vi.restoreAllMocks();
  });

  it("tìm transcript theo agent id", async () => {
    expect(await findAgentTranscript("abc123def", root)).toContain("agent-abc123def.jsonl");
    await expect(findAgentTranscript("zzz999zzz", root)).rejects.toThrow(/Không tìm thấy/);
    await expect(findAgentTranscript("../etc", root)).rejects.toThrow(/không hợp lệ/);
  });

  it("ghi report nguyên văn vào reviews/ và trả 0", async () => {
    const code = await main(["save-report", book, "--agent", "abc123def", "--out", "reviews/b0001/critic-chapter-0001.md"]);
    expect(code).toBe(0);
    expect(await readFile(join(book, "reviews/b0001/critic-chapter-0001.md"), "utf8")).toBe(`${REPORT}\n`);
  });

  it("từ chối đích ngoài reviews/", async () => {
    await expect(main(["save-report", book, "--agent", "abc123def", "--out", "translated/x.md"])).rejects.toThrow(/reviews\//);
    await expect(main(["save-report", book, "--agent", "abc123def", "--out", "reviews/../x.md"])).rejects.toThrow(/reviews\//);
  });

  it("report thiếu VERDICT thì trả 2", async () => {
    await writeFile(join(root, "proj-a", "sess-1", "subagents", "agent-bad000bad.jsonl"), transcript("không đúng định dạng"));
    expect(await main(["save-report", book, "--agent", "bad000bad", "--out", "reviews/b0001/x.md"])).toBe(2);
  });
});
