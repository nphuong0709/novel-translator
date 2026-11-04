# Architecture / Prompt Review — before Claude implementation

## Decisions retained from the user's simplified design
- Crawler is code-only and a separate user-triggered command.
- Translation is a separate command and handles glossary, per-chapter independent critic, correction, batch critic, and human checkpoint.
- Final critique and EPUB are a third explicit command.
- Exactly two custom subagents. One critic definition reused across scopes; all critic invocations remain independent of translator.
- Git automation removed entirely, all state in local book folders.
- No database, web UI, agent SDK or paid API integration.
- Full master prompts kept separate from Skill files, with an explicit anti-translationese guide.

## Risks / deliberate trade-offs
1. **Not zero code:** crawler and EPUB assembler are external work. Do not call the starter turnkey before integrating them.
2. **LLM orchestration is probabilistic:** prompts alone cannot prove a stage ran. A tiny validator can be added later if missed stages occur.
3. **Approval:** if translator modifies a user-approved chapter in final correction, user must re-approve affected batch.
4. **Context:** long works require grounded character/relationship events and chapter-scoped retrieval; no perfect infinite memory.
5. **Pro quota:** multiple critic invocations consume allowance; begin with 1–2 chapter benchmark; adapt after observing results.
6. **Prompt drift:** store exact prompt version used with each batch if repeatability becomes important; no need for complex model/effort hooks in MVP.
7. **Source access and rights:** crawler must refuse blocked/inaccessible chapters rather than circumvent access controls.

## Acceptance checks for first vertical slice
- [ ] Existing crawler successfully imports an authorized single chapter with correct paragraphs.
- [ ] `/novel-crawl` finishes without triggering translation.
- [ ] Translator reads full master prompt and Vietnamese guide; saves story-only draft.
- [ ] Independent read-only Critic reports at least a seeded known error (e.g., reversed title or literal word order) with evidence.
- [ ] Translator fixes targeted passage, saves separate version, and critic revalidates.
- [ ] A batch critic review runs even for 1–2 chapter smoke test, reports its limited coverage honestly.
- [ ] A human checkpoint is actually respected; no automatic next batch/finalize.
- [ ] Local status allows retry/resume without silently discarding prior artifacts.
- [ ] EPUB is produced only by explicit finalize, with correct order and no QA notes.
- [ ] EPUB actually opens in an EPUB reader.

## Prompt for Claude to review/integrate
Read `README.md`, `CLAUDE.md`, `rules/artifact-contract.md`, all 3 Skills, 2 agents and 3 prompts. Compare them with the existing repository's crawler, project conventions and source data, WITHOUT editing/overwriting book data. Report conflicts, missing actual CLI scripts, duplicated guidance, relative path risk and likely agent-invocation failures. Propose the minimum adjustments to make Slice T1 (one authorized chapter) run. Do not add Git hooks, a database, a dashboard, 3rd-party API credentials or more agents. Ask before moving/copying existing book data or implementing code. Distinguish already-working pieces from this starter's instructions.
