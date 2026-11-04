# Novel Translator — Minimal Claude Code Starter (Design + Prompts + Skills)

**Purpose:** One-person local translation of authorized English/Chinese source chapters into natural Vietnamese, independently reviewed and packaged as EPUB. **No Git workflow.**

## What is actually included
- Three ready-to-place Claude Code Skills: `/novel-crawl`, `/novel-translate`, `/novel-finalize`.
- Two independent subagent configs: `translator` and read-only `critic`.
- Detailed translator, critic and Vietnamese-native-style Master Prompts.
- Local artifact contract, example `status.json`, example manifest, and sample validation checklist.

## What is NOT implemented
**This bundle does not contain an executable crawler, EPUB exporter, or deterministic status validation script.** Skills are orchestration instructions, not a guarantee of automation. Connect your **existing crawler's real CLI**; use an installed EPUB utility or create a very small exporter separately. Do not assume commands/flags shown in a design are implemented.

## Minimal installation
1. Unzip the bundle into a new project directory (or merge the named Markdown files into your existing project). Avoid overwriting your existing `books/` data.
2. Keep all book data local under `books/<book-id>/`; migrate any previous novel files by **copy + verify**, not blind move.
3. Place/retain your crawler under `crawler/`, inspect its command syntax, configure site adapters only where authorized.
4. In Claude Code opened at project root, run `/novel-crawl ...` (check the actual crawler first), review the resulting raw files, then invoke `/novel-translate ...`. Translation pauses by batch for user decision. `/novel-finalize ...` is a separate explicit step.
5. For resumed work: run the same `/novel-translate` command and let it inspect local status + inputs; any changed source must be re-verified.

## Example intended use (project-defined, **not automatically functional** without crawler/export adapter)
```
/novel-crawl /path/to/authorized/raw-files --book-id mybook --range 1-10
/novel-translate mybook --range 1-10 --batch-size 5
# Review / approve batch at prompt
/novel-finalize mybook --range 1-10
```

## Why the boundaries matter
- **Skills** coordinate stage sequence and artifacts. **Agents** perform translation/review. **Prompts** define quality. **Context** remembers relations/terms. **Status files** store checkpoint/user approval. **EPUB utility** packages story content.
- Critic is independent, read-only, and invoked in CHAPTER, BATCH, FINAL, REVALIDATE modes. It cannot directly approve for the user.
- Stop after crawl. Stop after each translated batch. Finalize only when user explicitly requests it.
- The master prompts are long on purpose: do not reduce them to one-line instructions in Skills.

## Claude Code Pro / efficiency
- Claude Code subscription allowance is shared across main and subagents. No API credits are provisioned by this starter.
- Start with 1–2 short chapters and inspect quality/usage before a 200-chapter project.
- Keep main orchestration thin and pass each subagent only the chapter source, target, and relevant context. Use source-grounded delta fixes, not full rewrites.
- Disable unrelated MCP connectors if they substantially inflate session context; don't change machine-wide settings without user approval.
- If quota interrupts execution, status + local artifacts enable *manual resumption*. There is no background service.

## Privacy, copyright & file safety
- Only ingest, translate and store material for which you have appropriate rights/permission. Publicly visible doesn't necessarily mean licensed to make full translated copies. Never bypass technical access controls.
- Book data is not uploaded by this starter. Claude Code sends provided content to the model when invoked; consider this before adding private/copyrighted material.
- No Git operations. If your repo already tracks books, `.gitignore` does **not** untrack previously tracked files. This starter doesn't modify the repository's history.
- Back up `books/` separately if you need preservation; checkpoint files aren't backup.

## Current capabilities / known limitations
- Skills/subagents conform to current Claude Code Markdown patterns (frontmatter, local `.claude/skills`, `.claude/agents`). Validate on your installed Claude Code version; CLI and VS Code extension can differ.
- Your previous capability PoC verified read-only agent allowlists and foreground execution when explicitly requested. Those tests did **not** prove every real workflow run will obey every instruction, so always inspect early batches.
- More robust deterministic enforcement, tooling scripts and monitoring can be added only after the first full chapter succeeds.
