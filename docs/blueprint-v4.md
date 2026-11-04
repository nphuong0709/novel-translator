# Novel Translator — Blueprint V4

> **Trạng thái:** Slice 1 xong (tag `slice-1`). B1 xong (`docs/capability-verification.md`). Đang chuẩn bị Slice 2 với kiến trúc 3 subagent (D-04, D-05, D-12, D-13, D-14, D-15 sửa/thêm ngày 2026-11-04).
> **Thay cho:** Blueprint V3 (bản review). Các mục không nhắc lại ở đây giữ nguyên tinh thần V3.
> **Phạm vi:** công cụ cá nhân, chạy local bằng Claude Code; nguồn EN/ZH → tiếng Việt → EPUB.

---

## 1. Các quyết định đã chốt

| ID | Quyết định | Lý do |
|---|---|---|
| D-01 | Chạy local bằng Claude Code; không UI, không DB, không backend | Công cụ một người dùng |
| D-02 | **TypeScript (Node 24)** cho mọi phần code: ingest, validate, export | Mục tiêu học TS; Python ngoài phạm vi. Kiến thức từ bản Python được giữ lại qua golden test (mục 8) |
| D-03 | Skill chỉ để điều phối; luật cứng nằm trong code (`validate`) | Lời dặn trong prompt không phải transaction boundary |
| D-04 | *(sửa 2026-11-04)* **3 subagent**: `translator` (dịch + sửa theo issue), `chapter-critic` (R1 nghĩa / R2 tiếng Việt / R1-delta hồi quy), `consistency-critic` (Batch / Final). Critic chỉ đọc, không ghi file | Ít agent cần bảo trì; người viết và người đánh giá vẫn tách nhau. *Bản cũ: 6 agent (translator, 2 critic, editor, batch, final).* |
| D-05 | *(sửa 2026-11-04)* **Phương án D**: nhóm 2–3 chương; R1 → sửa → R2 → sửa → **R1-delta bắt buộc**; `apply-fixes` (code) chạy trước, translator chỉ nhận issue còn lại; mỗi lượt critic là một lần gọi subagent độc lập với input liệt kê và hash rõ ràng (mục 7) | R2 duyệt bản đã sửa nghĩa; không còn xung đột 2 critic sửa cùng chỗ. Đánh đổi: tuần tự (chậm hơn C), token ngang hoặc hơn C một chút, phải đo ở PoC. *Bản cũ: phương án C, 2 critic song song + editor.* |
| D-06 | Commit review **trước** commit sửa | Lịch sử cho thấy ai phát hiện gì, ai sửa gì |
| D-07 | **Trạng thái được tính lại từ artifact và hash**, không lưu state file riêng | Không thể lệch giữa trạng thái và file thật |
| D-08 | EPUB bằng Pandoc, kiểm tra bằng epubcheck | Không tự viết bộ đóng gói EPUB |
| D-09 | Nguồn EN/ZH (Giản thể và Phồn thể), đích là tiếng Việt | Nhật/Hàn để V2 |
| D-10 | Tách 2 repo: framework và dữ liệu truyện | Text truyện không nằm chung repo với code |
| D-11 | *(sửa 2026-11-04)* Repo dữ liệu **chỉ ở local**; backup bằng `novel snapshot` ra **Google Drive** (qua Google Drive for desktop): `git bundle` đủ lịch sử ở mốc `raw` và `final`, và sau mỗi batch dịch (giữ N bản mới nhất); kèm zip raw và `.epub`. **Không mã hóa.** | Không phải quản lý khóa GPG; EPUB đọc được ngay trên Drive. Đánh đổi chấp nhận: Google đọc được nội dung. *Bản cũ: remote GitHub qua `git-remote-gcrypt`.* |
| D-12 | *(sửa 2026-11-04)* **Commit mỗi vòng**, theo nhóm 2–3 chương: `raw` → `translate` → `review(r1)` → `fix(r1)` → `review(r2)` → `fix(r2)` → `approve` (kèm kết quả R1-delta). Review luôn được commit trước bản sửa (D-06) | Kiểm vết từng vòng của phương án D; commit theo nhóm để số commit không nhân theo chương. *Bản cũ: 4 commit mỗi chương.* |
| D-13 | *(sửa 2026-11-04)* `consistency-critic` **Batch Mode** ở ranh giới nhóm đầu tiên khi đã duyệt ≥ 10 chương kể từ batch trước; **Final Mode** chỉ kiểm tra xuyên batch | Chapter-critic đã đọc từng chương; hai mode chỉ khác phạm vi dữ liệu. *Bản cũ: batch-critic và final-critic là 2 agent.* |
| D-14 | *(mới 2026-11-04)* **Model theo profile của truyện** (`book.yaml` → `translation.profile: epic \| standard`, có thể ghi đè từng lượt). Code điều phối truyền `model` + `effort` cho từng lần gọi; không để LLM tự chọn. Chỉ dùng Opus 5.5 / Sonnet 5.5 (không Fable, không Haiku) | Truyện cổ đại/huyền huyễn/bối cảnh lớn cần Opus effort cao; truyện hiện đại có thể hạ effort. Chốt bằng số liệu golden set (mục 7.3) |
| D-15 | *(mới 2026-11-04, từ B1)* **Ràng buộc runtime đã kiểm chứng**: chặn subagent lồng nhau; mọi agent có `tools:` allowlist; bước phụ thuộc chạy foreground; logger hook ghi model/effort/usage thật; `validate` kiểm cấu hình thực tế trước khi duyệt (mục 7.5). Không thêm subagent, database hay framework | B1 (`docs/capability-verification.md`): subagent lồng nhau mặc định **được phép**; subagent mặc định **chạy nền**; `--allowedTools` không giới hạn tool; `SubagentStop` không có model |

## 2. Nguyên tắc truy cập nguồn (thay nguyên tắc 11 của V3)

- Dùng cho mục đích cá nhân, không kinh doanh; người dùng tự chịu trách nhiệm về quyền với nội dung.
- **Cho phép xác minh bằng tay** (ví dụ Cloudflare) trong trình duyệt thật; tool chỉ tái sử dụng profile đã được xác minh.
- **Không** tự động giải CAPTCHA hay challenge, không dùng stealth hay giả fingerprint, không xoay proxy, không gọi dịch vụ giải CAPTCHA.
- Khi gặp challenge mà không có người xác minh: trạng thái `BLOCKED`, dừng batch sạch sẽ, gửi thông báo cho người dùng.
- Request ít và chậm: có delay và jitter, cache mục lục và HTML, không tải lại thứ đã có.

## 3. Layout hai repo

```text
~/Documents/2.phuong-nguyen/
├── novel-translator/            ← repo FRAMEWORK (GitHub private, không mã hóa)
│   ├── CLAUDE.md  README.md  package.json  tsconfig.json
│   ├── docs/                    blueprint, source-quirks, test-mapping
│   ├── src/ingest/core/         numerals, junk, retry, lock, raw-store, checks
│   ├── src/ingest/adapters/     shuba69.ts, shuku52.ts, local-file.ts
│   ├── src/validate/            gate tất định (Slice 2)
│   ├── src/cli.ts               ingest | import | validate | status | export
│   ├── .claude/agents/          (Slice 2) translator, chapter-critic; (Slice 4) consistency-critic — mỗi agent có `tools:` allowlist, không agent nào có `Agent`
│   ├── .claude/settings.json    (Slice 2) env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`; hook SubagentStop + PostToolUse(Agent) → logger
│   ├── .claude/hooks/agent-log.mjs  (Slice 2) logger nhỏ: chỉ metadata, không chép nội dung truyện
│   ├── .claude/skills/          (Slice 2+) ingest, translate-batch, review-batch, finalize, status
│   ├── rules/                   (Slice 2) port từ translation_skills/*.md của bản V1
│   └── tests/fixtures + golden  HTML tổng hợp, KHÔNG chứa text truyện thật
└── novel-books/
    └── <book-id>/               ← mỗi truyện 1 repo DỮ LIỆU (chỉ local; backup: Drive `My Drive/novel-backups/<book-id>/`)
        ├── book.yaml            url, adapter, ngôn ngữ, phạm vi chương, translation.profile
        ├── context/             characters.md, relationships.md, glossary.md, style-guide.md, continuity.md (có version, mục 7.4)
        ├── chapters/NNN/        source.md, draft_v1.md, summary.md, review_r1.md, draft_v2.md, review_r2.md, draft_v3.md, regression.md
        ├── consistency/         batch-NNN-MMM.md, final.md
        ├── export-manifest.json
        ├── ingest-report.md
        └── .cache/              (gitignored) html/, catalog.json, browser-profile/
```

Không bao giờ commit: `.env`, `browser-profile/`, `token.json`, `credentials.json`, `.cache/`, file `*.epub` (chỉ commit `export-manifest.json`).

## 4. Luồng end-to-end

```text
/ingest   → code: tìm chương → tải (có cache HTML) → parse → kiểm tra → source.md
          → trạng thái mỗi chương VALID | SUSPECT | BLOCKED | FAILED → ingest-report.md → commit raw(...)
          → đủ raw: `novel snapshot --stage raw` (tag raw-done, bundle + zip lên Drive)

/translate-batch <range> <profile?> (theo nhóm 2–3 chương; mỗi dòng "agent" là MỘT lần gọi subagent độc lập,
                  luôn FOREGROUND `run_in_background: false`, truyền `model` + `effort` theo profile):
  translator (dịch)                 → draft_v1.md + summary.md (+ context-delta đề xuất) → commit translate(chNNN-MMM)
  chapter-critic R1 (trọn chương)   → review_r1.md: nghĩa, nhân vật, context, xưng hô     → commit review(r1)
    validate: kiểm runtime (7.5) + bằng chứng (excerpt nguyên văn có thật) → apply-fixes (code, khớp chính xác)
    translator (sửa: chỉ issue còn lại, chỉ đoạn liên quan ±1)                            → draft_v2.md
    validate: chỉ đoạn có issue được đổi; giới hạn mức thay đổi                             → commit fix(r1)
  chapter-critic R2 (trọn chương + các thay đổi sau R1) → review_r2.md: tự nhiên, dịch máy, chất văn → commit review(r2)
    apply-fixes → translator (phần còn lại) → draft_v3.md → validate (như trên)            → commit fix(r2)
  chapter-critic R1-delta (chỉ đoạn đã đổi sau R2)       → regression.md: hồi quy nghĩa
  validate cuối: kiểm runtime (7.5), độ phủ đoạn, chữ Hán sót, glossary, hash
                       → approve | rework (≤2 lần) | NEEDS_HUMAN_REVIEW   → commit approve(...)
  ranh giới nhóm, đã duyệt ≥ 10 chương: consistency-critic Batch → sửa → R1-delta → commit
  sau mỗi batch: `novel snapshot --stage batch` (bundle lên Drive, giữ N bản mới nhất)

/finalize → consistency-critic Final (xuyên batch) → sửa → R1-delta → pandoc → epubcheck → export-manifest.json → commit
          → `novel snapshot --stage final --epub <file>` (tag final, bundle + epub lên Drive)
/status   → tính trạng thái từ artifact + git log; không ghi gì
```

Chỉ có `validate --commit` được phép commit. LLM không tự commit.

## 5. Trạng thái tính lại từ artifact (D-07)

Mỗi artifact có frontmatter ghi hash của input:

```yaml
---
stage: review_r1
chapter: 12
agent: chapter-critic
model: opus-5.5 · high          # profile epic (D-14)
input: { source: sha256:…, draft_v1: sha256:…, context: v3@sha256:… }
output_sha256: sha256:…
---
```

`status` suy ra trạng thái theo quy tắc: artifact của stage S hợp lệ ⇔ file tồn tại, `output_sha256` khớp nội dung, và mọi `input.*` khớp hash hiện tại của file input. Source đổi → mọi stage phía sau tự trở nên không hợp lệ, không cần invalidation thủ công. Rollback bằng `git revert`, xong là `status` tự đúng.

## 6. Yêu cầu ingest (Slice 1)

### 6.1 Interface adapter

```ts
interface SourceAdapter {
  id: string;                                   // "shuba69" | "shuku52" | "local-file"
  matches(url: string): boolean;
  fetchChapter(bookUrl: string, n: number): Promise<RawChapter>;   // bắt buộc
  discover?(bookUrl: string): Promise<number[]>;                    // tùy chọn: site chia theo trang không biết trước danh sách chương
  cleanContent(text: string): string;                               // lọc rác, dùng lại cho raw cũ
}
```

### 6.2 Kiểm tra sau khi ingest

| Kiểm tra | Kết quả |
|---|---|
| Challenge hoặc 403 có dấu hiệu bot-check | `BLOCKED`, dừng batch |
| Trùng hash với chương liền kề | `FAILED` |
| Số trong tiêu đề ≠ số chương yêu cầu | `FAILED` |
| Nội dung < 200 ký tự | `FAILED` |
| **Tỷ lệ ký tự trích ra / text của container < 0,9** | `SUSPECT` (bắt lỗi HTML hỏng làm mất đoạn) |
| Độ dài < 0,5× hoặc **> 2×** trung vị của các chương trong phạm vi ±20 | `SUSPECT` (chương bị cắt cụt hoặc bị gộp) |
| Còn khớp mẫu rác sau khi lọc | `SUSPECT` |

### 6.3 Độ bền

- Retry có backoff; luôn nghỉ giữa các request, kể cả khi lỗi; không retry `BLOCKED`.
- Dừng batch sau N chương lỗi liên tiếp (mặc định 3).
- **Lock file** cho từng truyện: không cho hai lệnh chạy song song.
- Ghi file theo kiểu atomic: viết vào file tạm có PID riêng, rồi đổi tên.
- **Cache HTML gốc** kèm `parserVersion`; sửa parser thì parse lại offline, không gọi mạng.

## 7. Phương án D — chi tiết

### 7.1 Ràng buộc (code ép, không chỉ dặn trong prompt)

| Yêu cầu | Cơ chế |
|---|---|
| Critic không tự đánh giá bản do mình tạo | Critic chỉ đọc (agent không có tool ghi). Hồi quy cho fix của lượt X dùng **rubric khác X** (fix R2 → R1-delta; fix consistency → R1-delta). Phần kiểm được bằng code (glossary, xưng hô đã chốt) do `validate` kiểm |
| Mỗi lượt critic độc lập, phạm vi xác định | Mỗi lượt một lần gọi subagent; input liệt kê tường minh và ghi hash vào frontmatter review (D-07) |
| Issue phải có bằng chứng | Issue gồm `source_excerpt`, `translation_excerpt` (nguyên văn), rubric, severity, `proposed_fix`. `validate` loại issue có excerpt không tồn tại trong `source.md` / bản nháp trước khi tới translator |
| Translator chỉ sửa lỗi có bằng chứng | `apply-fixes` (code) áp trước các fix khớp chính xác. Translator chỉ nhận issue còn lại + đoạn liên quan ±1. Hash từng đoạn: đoạn không có issue phải giữ nguyên từng byte; đổi > 30% câu của đoạn hoặc thay đổi không gắn issue ID → từ chối |
| Hồi quy sau sửa | `validate` (độ phủ, chữ Hán sót, glossary, phạm vi sửa) + R1-delta bắt buộc sau khi sửa theo R2 / consistency. Tối đa 2 vòng rework, sau đó `NEEDS_HUMAN_REVIEW` |
| Delta-based | Sửa: chỉ đoạn có issue. Duyệt lại: R1-delta chỉ đọc đoạn đã đổi + đoạn gốc + issue. R1 và R2 vẫn đọc trọn chương (R2 không đánh giá độ tự nhiên qua delta được) |

### 7.2 Profile model (D-14)

| Lượt | `epic` (cổ đại, huyền huyễn, bối cảnh lớn) | `standard` (hiện đại) |
|---|---|---|
| translator: dịch | Opus 5.5 · high | Opus 5.5 · medium |
| translator: sửa | Opus 5.5 · medium | Opus 5.5 · medium |
| chapter-critic R1 | Opus 5.5 · high | Opus 5.5 · medium |
| chapter-critic R2 | Opus 5.5 · medium | Sonnet 5.5 · medium |
| chapter-critic R1-delta | Sonnet 5.5 · medium | Sonnet 5.5 · medium |
| consistency-critic Batch | Sonnet 5.5 · high | Sonnet 5.5 · medium |
| consistency-critic Final | Opus 5.5 · high | Opus 5.5 · medium |

- `standard` giữ nguyên model và **hạ effort trước**; chỉ hạ R2 xuống Sonnet. R1 luôn là Opus: người soát nghĩa không yếu hơn người dịch.
- Bỏ Fable/Haiku: Fable vượt nhu cầu và budget; Haiku không hợp với lượt cần phán đoán, còn kiểm tra rẻ đã do code làm.
- Rủi ro lỗi trùng điểm mù (translator và R1 cùng model): bù bằng rubric riêng, context mới mỗi lượt, bằng chứng bắt buộc, và đo bằng golden set.

### 7.3 Chốt bằng số liệu (PoC Slice 2)

- KZGD 2–3 chương, cài sẵn 10 lỗi. Chạy `epic` trước; chạy thêm `standard` trên cùng chương để đo mức chênh.
- Đo: lỗi cài sẵn bắt được (≥ 8/10), issue báo sai, usage mỗi chương, thời gian mỗi nhóm; so nhóm 2 và nhóm 3 chương.
- Usage lấy từ logger (7.5) và `modelUsage` của phiên: đây là **ước tính theo giá niêm yết**; mức tiêu hao gói thật xem `/usage`. Đo thêm chi phí cố định của phiên điều phối khi **tắt MCP connector không dùng** (B1: ~30k token mỗi lượt main, 97% chi phí PoC).
- `standard` chỉ dùng cho truyện hiện đại khi không tụt quá ngưỡng trên. Kiểm lại `epic` trên một truyện cổ đại/huyền huyễn khi có.

### 7.4 Context có version

- Translator chỉ **đề xuất** context-delta; mỗi mục kèm trích dẫn nguyên văn (chương + câu) và chương bắt đầu hiệu lực. Không suy diễn: mục không có trích dẫn bị loại.
- Code kiểm trích dẫn có thật trong `source.md` rồi mới tăng version. Consistency-critic duyệt các context-delta ở Batch Mode.
- Frontmatter mỗi bản nháp/review ghi hash version context đã dùng; context đổi thì artifact phía sau tự không hợp lệ (D-07). Chi tiết ở Slice 3.

### 7.5 Ràng buộc runtime (D-15, kiểm chứng ở B1)

Bằng chứng: `docs/capability-verification.md` (Claude Code 2.1.317).

| # | Ràng buộc | Cách làm | Căn cứ B1 |
|---|---|---|---|
| 1 | **Chặn subagent lồng nhau** | Hai lớp: không agent nào có `Agent` trong `tools:`; `.claude/settings.json` của repo đặt `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"`. Điều phối chỉ ở skill / phiên main | Q4: mặc định cho phép tới 3 tầng (đã quan sát `spawnDepth: 2`) |
| 2 | **Giới hạn tool** | Mọi agent có `tools:` allowlist. `chapter-critic`, `consistency-critic`: `Read, Grep, Glob`. `translator`: `Read, Grep, Glob, Write` (chỉ ghi file nháp/summary/context-delta; `validate` kiểm path). `advisor` do harness tự thêm, chấp nhận vì không ghi được file | Q3: allowlist có hiệu lực ở request; `--allowedTools` **không** giới hạn tool, main có Bash + MCP |
| 3 | **Foreground cho bước phụ thuộc** | Skill bắt buộc truyền `run_in_background: false` cho mọi lượt trong một nhóm (dịch → R1 → sửa → R2 → sửa → R1-delta). Thứ tự được kiểm lại bằng log (mục 4) | Q7: subagent mặc định chạy nền; foreground đã quan sát được khi truyền rõ |
| 4 | **Logger nhỏ** | Hook `SubagentStop` + `PostToolUse(matcher: Agent)` → `.claude/hooks/agent-log.mjs` ghi JSONL: `agent_id, agent_type, resolvedModel, effort, usage, totalTokens, durationMs, start/stop time`. **Chỉ metadata**, không ghi `last_assistant_message` hay prompt. Ghép 2 event theo `agent_id`; usage nhiều lượt cộng từ `agent_transcript_path`. Frontmatter review lấy model/effort/usage **từ log**, không từ lời tự khai của agent | Q5: `SubagentStop` có `effort` nhưng không có model/usage; `PostToolUse(Agent)` có `resolvedModel`, `usage` (request cuối) |
| 5 | **Validator kiểm cấu hình thực tế trước khi duyệt** | `validate` từ chối khi: (a) model/effort trong log ≠ profile của lượt đó; (b) file agent có tool ngoài allowlist hoặc có `Agent`; (c) thiếu env chặn lồng; (d) các lượt trong nhóm chồng thời gian (không tuần tự); (e) review không có bản ghi log tương ứng | Q1, Q2: ghi đè model/effort chỉ được LLM điều phối truyền, nên phải kiểm lại bằng code |

Ngoài phạm vi: không thêm subagent, database, framework hay dependency mới. Logger dùng Node có sẵn; validator nằm trong `src/validate/`.

## 8. Chuyển kiến thức từ bản Python sang TS

1. `docs/source-quirks.md`: mỗi lỗi hoặc đặc điểm đã gặp có một ID (CORE-xx, SHUBA-xx, SHUKU-xx).
2. `tests/fixtures/**`: HTML tổng hợp mô phỏng đúng cấu trúc từng quirk.
3. `tests/golden/**`: output chuẩn, sinh **một lần** bằng code Python V1 (dùng làm oracle).
4. `docs/test-mapping.md`: test Python → quirk ID → test TS.
5. So sánh chéo trên dữ liệu thật (chỉ local): hash từng chương của TS so với raw do Python tạo.

Golden mô tả **hành vi mong muốn**, không phải chi tiết hiện thực. Ví dụ cheerio (parse5) tự đóng `<p>` khác `html.parser`, nhưng kết quả vẫn phải khớp golden.

## 9. Vertical slices

| Slice | Nội dung | Xong khi |
|---|---|---|
| **1** | Ingest TS: core + shuku52 + shuba69 + local-file, CLI `ingest`/`import`, repo dữ liệu đầu tiên | Golden test xanh; cào lại KZGD 1–201 khớp hash với bản Python đã sửa (hoặc lệch có giải thích); lock, cache, resume chạy đúng |
| 2 | 1 nhóm chương: `translator` + `chapter-critic` (R1, R2, R1-delta) theo phương án D + `validate` + golden set lỗi cài sẵn; profile `epic` và `standard` | Bắt được ≥ 8/10 lỗi cài sẵn; `validate` chặn issue không có bằng chứng và sửa ngoài phạm vi; `validate` chặn được review có model/effort sai profile, agent có tool ngoài allowlist, lượt chạy chồng thời gian (7.5); commit đúng từng vòng (D-12); gate chặn được review cũ (stale); có số liệu usage cho 2 profile |
| 3 | Context có version (mục 7.4), 5–10 chương, resume giữa chừng | Xưng hô và tiêu đề đổi theo phạm vi chương mà không sửa lan sang chương cũ; context-delta không có trích dẫn bị loại |
| 4 | `consistency-critic` Batch Mode | Phát hiện tên hoặc tiêu đề không nhất quán đã cài sẵn; sửa xong thì R1-delta duyệt lại |
| 5 | `consistency-critic` Final Mode + EPUB | Bị chặn khi còn chương chưa duyệt; epubcheck pass; manifest trỏ đúng commit |

## 10. Việc mở và rủi ro còn lại

- **B1 đã xong** (`docs/capability-verification.md`): model/effort theo lần gọi, critic chỉ đọc, subagent lồng nhau, `SubagentStop`, tham số skill, usage đều VERIFIED trong `-p`; kết luận đưa vào D-15 / mục 7.5. **Còn chưa thử:** hành vi trong phiên tương tác VS Code (subagent mặc định chạy nền), biến `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, trường hợp không truyền `run_in_background`, tắt MCP connector. Kiểm ở đầu Slice 2 khi dựng skill thật.
- **Phụ thuộc vào trường không có trong tài liệu:** `SubagentStop.effort`, `subagents/*.meta.json` có thể đổi giữa các phiên bản Claude Code. Logger phải chịu được trường thiếu (ghi `null`), và `validate` báo rõ thay vì duyệt im lặng.
- **Công cụ cần cài:** Google Drive for desktop (backup), `pandoc` + `epubcheck` (Slice 5). `gpg`/`git-remote-gcrypt` không còn cần sau khi sửa D-11.
- **Backup chỉ tốt bằng lần snapshot gần nhất:** quên chạy `snapshot --stage batch` thì công dịch từ lần trước chỉ có ở local. Nội dung trên Drive không mã hóa.
- Truyện dài 200+ chương có thể chạm usage limit; đo ở Slice 2 trước khi chạy cả bộ.
