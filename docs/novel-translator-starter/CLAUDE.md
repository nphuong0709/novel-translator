# Personal Novel Translator — Claude Code project instructions

This repo automates an existing *personal* novel translation workflow, not a general multi-agent platform.

## Scope / control
- Three user-invoked primary Skills only: `/novel-crawl`, `/novel-translate`, `/novel-finalize`. Never chain them implicitly.
- Initial source language: English or Chinese (simplified/traditional); target: Vietnamese.
- Two subagents: `translator`, `critic`. Main Claude orchestrates; critic is read-only and independent of translator.
- Crawl is **code-driven**, via a site adapter or local import. No LLM-based manual page scraping. Never bypass captcha, paywall, credentials, rate-limit enforcement, or access controls. Only process material the user is authorized to store and translate.
- No Git operations in the workflow: do not commit, stage, push, or alter `.gitignore` as a stage action.
- Local files only, no UI, DB, API key spending, cloud upload, or hidden background continuation.
- Preserve source exactly. Translation, review, context, and publication artifacts must be separate.
- A Critic recommendation is not user approval. Stop after each translation batch for user decision by default.
- Never include commentary, notes, QA tables, or review output in story Markdown/EPUB.

## Source of truth
- Workflow: `.claude/skills/{novel-crawl,novel-translate,novel-finalize}/SKILL.md`
- Translator requirements: `prompts/translation-master.md`, `prompts/vietnamese-style.md`
- Critic requirements: `prompts/critic-master.md`, `prompts/vietnamese-style.md`
- Status schema: `templates/status.example.json` and `rules/artifact-contract.md`
- Do not silently shorten/replace those prompt documents when invoking agents.

## Execution
- Only run named agents as **foreground** invocations; await results before the next stage.
- Do not let subagents delegate other subagents.
- Check for existing artifacts and the exact requested range before starting or retrying.
- Stage-local checkpoints must be durable. If a stage fails, report it, keep old artifacts, do not mark PASS.
- Before writing/saving corrected story, compare with source and preserve paragraph/dialogue completeness.
- Use compact summaries when speaking to the user; link paths of saved outputs.
- If required crawler/export scripts are not implemented, report `NOT_IMPLEMENTED` and do not pretend workflow completed.
