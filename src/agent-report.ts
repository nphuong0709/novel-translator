/**
 * Lưu nguyên văn report của một subagent (critic) từ transcript của Claude Code, để orchestrator
 * không phải chép lại report bằng Write (tốn output token và phình context của main).
 *
 * Transcript subagent: ~/.claude/projects/<project>/<session>/subagents/agent-<agentId>.jsonl.
 * Report là `input.message` của tool_use `SubagentHandback` cuối cùng; nếu không có thì lấy
 * text của message assistant cuối cùng.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export class AgentReportError extends Error {
  override name = "AgentReportError";
}

const AGENT_ID = /^[a-z0-9]{6,64}$/i;

/** Lấy report từ nội dung JSONL. Trả null nếu không tìm thấy. */
export function extractHandback(jsonl: string): string | null {
  let handback: string | null = null;
  let lastText: string | null = null;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let d: unknown;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = (d as { type?: string; message?: { content?: unknown } }).message;
    if ((d as { type?: string }).type !== "assistant" || !msg || !Array.isArray(msg.content)) continue;
    const texts: string[] = [];
    for (const c of msg.content as Array<Record<string, unknown>>) {
      if (c["type"] === "tool_use" && c["name"] === "SubagentHandback") {
        const m = (c["input"] as { message?: unknown } | undefined)?.message;
        if (typeof m === "string") handback = m;
      } else if (c["type"] === "text" && typeof c["text"] === "string" && c["text"].trim()) {
        texts.push(c["text"]);
      }
    }
    if (texts.length) lastText = texts.join("\n");
  }
  return handback ?? lastText;
}

/** Tìm transcript của agent trong mọi project/session dưới `projectsRoot`. */
export async function findAgentTranscript(agentId: string, projectsRoot: string): Promise<string> {
  if (!AGENT_ID.test(agentId)) throw new AgentReportError(`agent id không hợp lệ: ${agentId}`);
  if (!existsSync(projectsRoot)) throw new AgentReportError(`Không thấy thư mục transcript: ${projectsRoot}`);
  const file = `agent-${agentId}.jsonl`;
  for (const project of await readdir(projectsRoot)) {
    const pdir = join(projectsRoot, project);
    let sessions: string[];
    try {
      sessions = await readdir(pdir);
    } catch {
      continue;
    }
    for (const s of sessions) {
      const p = join(pdir, s, "subagents", file);
      if (existsSync(p)) return p;
    }
  }
  throw new AgentReportError(`Không tìm thấy transcript của agent ${agentId}`);
}

export interface ReportCheck {
  hasApplied: boolean;
  verdict: string | null;
}

/** Kiểm hai dòng bắt buộc của report Critic (critic-master §5). */
export function checkReport(report: string): ReportCheck {
  const hasApplied = /^Đã áp dụng:/m.test(report);
  const v = /^VERDICT:\s*([A-Z_]+)/m.exec(report);
  return { hasApplied, verdict: v?.[1] ?? null };
}

export async function loadAgentReport(agentId: string, projectsRoot: string): Promise<string> {
  const path = await findAgentTranscript(agentId, projectsRoot);
  const report = extractHandback(await readFile(path, "utf8"));
  if (!report) throw new AgentReportError(`Transcript của agent ${agentId} không có report`);
  return report.endsWith("\n") ? report : `${report}\n`;
}
