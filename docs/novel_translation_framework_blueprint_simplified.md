# Novel Translation Framework: Blueprint (Simplified)

> **Trạng thái:** đề xuất 2026-11-04, chờ người dùng duyệt. Thay phần **dịch, review, lưu trữ, backup** của `blueprint-v4.md`. Phần ingest của v4 (mục 2, 6, 8) và code Slice 1 vẫn giữ nguyên giá trị.
> **Lý do thay:** `docs/architecture-review-simplification.md`.
> **Bằng chứng năng lực Claude Code:** `docs/capability-verification.md`.
> **Sửa đổi 2026-11-05 (D-16, chờ người dùng duyệt):** đổi mô hình review từ *Translator ↔ Critic chỉ đọc (Review → Fix → Revalidate)* sang **Translator (Sonnet) → Literary Editor (Opus, review và sửa cục bộ) → Human Approval**. Đánh giá tác động ở mục 6.0. Các mục đã đổi: 2, 3, 4, 5.2, 5.3, 6, 7, 9.2–9.4, 10, 12, 13, 14. Prompt, agent, skill và contract **chưa** được sửa (Slice T5).
> **Người dùng chốt 2026-11-05:**
> 1. Ngưỡng `REDRAFT` như mục 6.4.
> 2. `CONTEXT_INIT` chạy bằng **Opus**; Sonnet chỉ dịch bản nháp (`TRANSLATE`, `REDRAFT`).
> 3. Pilot giữ tạm `critic.md` làm reviewer chuẩn chỉ đọc, xóa sau pilot.
> 4. `approve-context` tự chạy tiếp phạm vi đã yêu cầu.
>
> **Đã cài T5 (2026-11-05):** prompt, agent, skill, contract, cùng `novel edit-prep | edit-check | agent-check` (`src/edit-guard.ts`, có test).
>
> **Sửa đổi sau pilot (người dùng chốt 2026-11-05):** pilot chạy một phần (Translator Sonnet + Editor Opus trên ch6–8, Editor PASS, edit-check PASS) rồi **bỏ, không đo tiếp**. Token thô của nhánh Sonnet không thấp hơn mô hình cũ. Quyết định: **Translator dùng Opus** ở mọi mode; giữ Literary Editor (Opus). Xóa `critic.md`, `docs/pilot-t5.md` và dữ liệu `books/kzgd-pilot/`; `critic-master.md` chuyển sang `docs/archive/`. Tiêu chí 11–13 ở mục 14 không còn áp dụng. Các chỗ ghi "Sonnet" cho Translator trong tài liệu này là thiết kế cũ.

---

## 1. Mục tiêu

Biến quy trình dịch thủ công **đã chạy được** (khoảng 57 chương) thành workflow Claude Code dùng lại được cho nhiều bộ truyện. Framework tự động hóa **việc chuyển giao dữ liệu và prompt giữa các bước**, còn người dùng kiểm soát các điểm dừng quan trọng.

Quy trình thủ công cũ và lệnh thay thế:

```
crawl → đưa raw + prompt → Claude dựng context, glossary, dịch batch → EPUB đọc thử
      → thấy lỗi xưng hô, văn dịch máy → đưa prompt Critic → Claude review + sửa → duyệt → EPUB lại
```

| Bước thủ công | Lệnh thay thế |
|---|---|
| Crawl + kiểm dữ liệu | `/novel-crawl` |
| Context + dịch + review + sửa + dừng để duyệt | `/novel-translate` |
| Review toàn bộ + xuất EPUB | `/novel-finalize` |

**Ngoài phạm vi:** Web UI, database, Git workflow, hook không cần thiết, framework multi-agent, API trả phí.

**Giả định:** người dùng có quyền sử dụng phù hợp với nguồn đầu vào; crawler không vượt CAPTCHA, paywall hay cơ chế kiểm soát truy cập (blueprint-v4 mục 2).

## 2. Nguyên tắc thiết kế

1. **Simplicity First:** ít code, ít dependency, ít thành phần.
2. **Skills điều phối, code làm việc tất định:** crawl, kiểm tra, trạng thái và export là code. Dịch và review là agent.
3. **Chất lượng đến từ prompt:** prompt dịch chia ba tầng (luật chung → module thể loại → context của truyện); orchestrator không rút gọn prompt khi gọi agent.
4. **Reviewer độc lập với Translator:** Translator (Sonnet) và Literary Editor (Opus) là hai subagent tách biệt. Editor không thấy suy nghĩ hay notes của Translator, chỉ đánh giá dựa trên nguồn và artifact. Editor được sửa bản dịch theo chính sách ở mục 6.4, nhưng **không bao giờ** sửa raw, bản nháp, context đã duyệt hay trạng thái phê duyệt. Code kiểm lại những gì Editor đã đổi (mục 9.2).
5. **Human-in-the-loop:** dừng sau mỗi batch; chỉ người dùng đặt được `APPROVED`.
6. **Local-first, resumable, subscription-aware:** dữ liệu là file local; tiếp tục được sau khi hết hạn mức; không tự chuyển sang API.

## 3. Kiến trúc

```
                ┌──────────────────── Claude Code (phiên main, gói Pro) ─────────────────────┐
 người dùng ──▶ │ /novel-crawl        /novel-translate                    /novel-finalize    │
                │      │                │                  │                    │            │
                │      ▼                ▼                  ▼                    ▼            │
                │  [CLI code]     Translator  ──v1──▶  Literary Editor     Literary Editor   │
                │  crawl/check    (Sonnet ·          (Opus · medium,      (FINAL: review    │
                │  status         medium: nháp,      review + sửa cục     + sửa cục bộ)     │
                │                 context đề xuất)   bộ → v2 + report)          │            │
                │                                          │                    │            │
                │              [kiểm tra tất định: hash, số đoạn, diff đoạn ↔ change log]   │
                │                                          ▼                    ▼            │
                │                              HUMAN APPROVAL CHECKPOINT (mỗi batch / final) │
                └────────────────────────────────────────────────────────────────────────────┘
                     books/<id>/  raw/  context/  translated/  reviews/  status.json  output/
```

- **Phiên main** (do skill điều khiển): gọi CLI và shell, gọi subagent, chụp hash trước và kiểm tra sau biên tập, ghi status, báo cáo rồi dừng ở checkpoint.
- **Model theo mode:**
  - Translator chạy **Opus** ở `CONTEXT_INIT` (Bước 0, dựng context ban đầu) và **Sonnet** ở `TRANSLATE`/`REDRAFT`.
  - Editor luôn chạy Opus.
  - Cả hai ở effort `medium`.
- **CLI `novel`** (TypeScript, có sẵn từ Slice 1, mở rộng thêm):
  - đã có: `ingest`, `status`, `import`, `init`;
  - thêm mới: `check`, `mark`, `approve`, `export`, `backup`.
- **Không dùng hook. Không dùng Git cho dữ liệu.** Repo framework vẫn dùng Git như mọi repo code.

## 4. Cấu trúc project tối thiểu

```text
novel-translator/
├── CLAUDE.md
├── .claude/
│   ├── skills/
│   │   ├── novel-crawl/SKILL.md
│   │   ├── novel-translate/SKILL.md
│   │   └── novel-finalize/SKILL.md
│   └── agents/
│       ├── translator.md          # mặc định Sonnet · medium (TRANSLATE, REDRAFT); CONTEXT_INIT được gọi với model Opus; tools: Read, Grep, Glob, Write, Edit
│       ├── literary-editor.md     # Opus · medium; REVIEW_EDIT, REWORK, FINAL; tools: Read, Grep, Glob, Write, Edit (không Agent, không Bash)
├── prompts/
│   ├── translation-master.md      # tầng 1: luật dịch chung mọi thể loại (tái cấu trúc từ V1, 2026-11-04)
│   ├── modules/*.md               # tầng 2: eastern-ancient, modern, system-game, western-fantasy (nạp theo genre)
│   ├── literary-editor-master.md  # đổi tên từ critic-master.md: giữ 10 quy tắc đánh giá, thêm 8 bước và chính sách sửa (mục 6.3–6.5)
│   └── vietnamese-style.md        # chuẩn tiếng Việt, anti-translationese, ví dụ theo ngữ cảnh
├── src/                           # code có sẵn: ingest (crawler), cli; thêm: check, status, export
├── tests/
└── books/                         # gitignored (đã có trong .gitignore). KHÔNG commit
    └── {book-id}/
        ├── book.yaml              # cấu hình (người dùng sửa): url, adapter, ngôn ngữ, thể loại, model
        ├── manifest.json          # do crawler sinh: danh sách chương, tiêu đề, hash, trạng thái nguồn
        ├── status.json            # tiến độ dịch/review/duyệt (chỉ CLI ghi)
        ├── raw/chapter-NNNN.md    # nguyên tác, không bao giờ bị sửa
        ├── context/
        │   ├── characters.md      # Character Bible (đã duyệt)
        │   ├── relationships.md   # ma trận xưng hô theo phạm vi chương (đã duyệt)
        │   ├── glossary.md        # thuật ngữ | bản dịch | biến thể cấm | nguồn (chương)
        │   ├── style-notes.md     # giọng văn riêng của truyện
        │   ├── continuity.md      # 1–3 dòng mỗi chương (gộp từ summaries khi duyệt)
        │   └── proposals/bNNNN.md # đề xuất context chưa duyệt (Translator viết; Editor kết luận trong report)
        ├── translated/
        │   ├── chapter-NNNN.v1.md # NHÁP của Translator. Bất biến kể từ khi Editor bắt đầu (kiểm bằng hash)
        │   ├── chapter-NNNN.v2.md # bản SAU BIÊN TẬP: main sao chép v1, Editor chỉ sửa cục bộ trên bản sao
        │   ├── chapter-NNNN.v3.md # (nếu có) rework theo ghi chú người dùng, hoặc sửa ở FINAL; luôn sinh từ version hiện hành
        │   └── .history/          # version không được duyệt, chuyển vào khi approve (không xóa)
        ├── reviews/
        │   ├── bNNNN/summaries.md      # Translator viết
        │   ├── bNNNN/notes.md          # ghi chú của Translator cho người dùng (không làm input cho agent, không vào EPUB)
        │   ├── bNNNN/editor-batch.md   # review + change log + post-edit check + VERDICT (Editor viết)
        │   ├── bNNNN/editor-rework.md  # (nếu có) rework theo ghi chú người dùng; vòng sau: editor-rework-2.md
        │   ├── bNNNN/user-decision.md
        │   └── final/editor-final.md
        ├── output/{book-id}.epub
        └── .cache/                # HTML cache, browser profile, lock (không backup)
```

**Chuyển dữ liệu hiện có:** `../novel-books/kzgd/chapters/NNN/source.md` chuyển thành `books/kzgd/raw/NNNN.md` (giữ frontmatter hash), cộng thêm `manifest.json`. Thư mục `.git` cũ không cần nữa; bạn giữ hay xóa tùy ý.

## 5. Command contracts

### 5.1 `/novel-crawl <book-id> [--url URL] [--from N --to M] [--recrawl]`

| | |
|---|---|
| **Làm** | (1) chưa có `book.yaml` thì chạy `novel init`; (2) `novel ingest`, tức crawler bằng code (HTTP; hoặc Playwright với Chrome thật khi site cần); (3) lấy danh sách chương, trích xuất, normalize, validate; (4) ghi `raw/` + `manifest.json`; (5) báo cáo |
| **Kiểm tra nguồn** | Chương thiếu, trùng hash với chương liền kề, sai số thứ tự, nội dung < 200 ký tự, độ dài bất thường, tỷ lệ trích xuất < 0,9, còn rác: VALID / SUSPECT / FAILED / BLOCKED (code Slice 1) |
| **Báo cáo** | Số chương ở mỗi trạng thái; danh sách SUSPECT/FAILED kèm lý do; khoảng chương còn thiếu |
| **Không làm** | Không dịch; không tự vượt challenge (gặp BLOCKED thì dừng và nhờ người dùng tự xác minh trong Chrome) |
| **Resume** | Chạy lại thì bỏ qua chương đã có raw hợp lệ (CORE-13) |

### 5.2 `/novel-translate <book-id> --range a-b [--batch-size 1-3] [--auto]` và `approve | rework | approve-context`

Mọi lần gọi agent đều **foreground** (`run_in_background: false`), chờ xong mới sang bước sau. Batch tối đa 3 chương: **1 lần gọi Translator và 1 lần gọi Editor cho cả batch**.

| | |
|---|---|
| **Điều kiện vào** | Mọi chương trong phạm vi có raw VALID (SUSPECT phải được người dùng chấp nhận); không có batch nào trước đó đang `NEEDS_REWORK`; không có `--auto` thì cũng không có batch `PENDING_USER_APPROVAL` (trừ khi đang sửa đúng batch đó) |
| **Bước 0, context** | Chưa có context đã duyệt: Translator `CONTEXT_INIT` **chạy bằng Opus** (skill truyền `model: opus`, `effort: medium`), đọc 3–5 chương đầu, viết `context/proposals/initial/`. Main kiểm model thật bằng `novel agent-check --model opus`; không phải Opus thì báo người dùng và gọi lại. Ghi `context.pending_run` (phạm vi và cờ người dùng vừa gõ). **Dừng** chờ `approve-context`. Lệnh `approve-context <id>` duyệt context rồi **tự chạy tiếp** batch đầu của `pending_run` (bước 1–6, dừng ở checkpoint của batch), nên không phải gõ lại lệnh ban đầu. `--no-run` để chỉ duyệt (người dùng chốt 2026-11-05) |
| **Bước 1, nháp** | Translator (Sonnet) `TRANSLATE`: mỗi chương ghi `chapter-NNNN.v1.md`, nối `summaries.md`, ghi `notes.md` và `proposals/bNNNN.md` |
| **Bước 2, kiểm tra cấu trúc** (shell, tất định) | Số đoạn raw và v1, chữ Hán sót, ghi chú lọt vào truyện, tiêu đề. Lỗi **cục bộ** (vài đoạn lệch hoặc sót): chuyển kết quả cho Editor sửa ở bước 4. Lỗi **toàn chương** (sai chương, thiếu trên 20% số đoạn, file rỗng hoặc hỏng): Translator `REDRAFT` một lần |
| **Bước 3, chuẩn bị biên tập** (main) | `novel edit-prep`: sao chép `v1 → v2` (bản làm việc của Editor) và chụp hash của raw, mọi version cũ, `context/**`, summaries, notes vào `reviews/bNNNN/edit-guard.json`; ghi status |
| **Bước 4, review và biên tập** | Literary Editor (Opus) `REVIEW_EDIT` cho cả batch: chạy đủ 8 bước (mục 6.3), sửa cục bộ trực tiếp trên v2, viết `reviews/bNNNN/editor-batch.md` |
| **Bước 5, kiểm tra sau biên tập** (main, `novel edit-check`, mục 9.2) | Hash của raw, v1 và context không đổi; v2 qua kiểm tra cấu trúc; tập đoạn khác nhau giữa v1 và v2 **trùng đúng** tập đoạn có trong change log; report có `Đã áp dụng:` và `VERDICT:`. Không đạt: `current_version` giữ ở v1, chuyển v2 sang `.history/` với hậu tố `.invalid`, gọi lại Editor **một lần** kèm lỗi cụ thể; vẫn không đạt thì chương `BLOCKED` |
| **Bước 6, báo cáo và dừng** | `current_version = v2` (hoặc v1 nếu Editor không sửa gì), `user_decision = PENDING_USER_APPROVAL`, báo cáo (mục 9.4). **Human Approval Checkpoint: DỪNG.** `--auto` chỉ chạy tiếp khi không có điều kiện dừng (issue `scope: context` còn mở, `NEEDS_USER` ảnh hưởng chương sau, chương `REDRAFT` hoặc `BLOCKED`) |
| **Duyệt** | Người dùng gõ `approve`: `approved_version = current_version`, gộp quyết định và mục ACCEPT vào `context/`, tăng `context.version`, chuyển version không duyệt vào `.history/`. Gõ `rework "<ghi chú>"`: Editor `REWORK` sinh version mới từ version hiện hành; **không gọi Translator**. Ghi chú có thể là `revert E-ch0007-03` (lấy lại đoạn từ v1) |
| **Không làm** | Không crawl; không xuất EPUB cuối; không dịch ngoài phạm vi; không tự đặt `APPROVED`; không gọi Translator để sửa lỗi mà Editor sửa được |

### 5.3 `/novel-finalize <book-id> [<from>-<to>]`

| | |
|---|---|
| **Điều kiện vào** | Mọi batch trong phạm vi đều `APPROVED`; không chương nào bị stale (mục 10) hoặc đã được người dùng xác nhận |
| **Làm** | (1) Literary Editor `FINAL` soát xuyên batch: tình tiết, nhân vật, danh xưng, thuật ngữ, phong cách, dựa trên continuity, context, mọi `editor-batch.md`, issue còn mở và đoạn mẫu; (2) vấn đề sửa được thì Editor sửa cục bộ ngay, ghi version mới cho chương bị ảnh hưởng (cùng chính sách mục 6.4, kiểm tra tất định như bước 5 của mục 5.2); (3) Editor kết luận `READY` hoặc `NEEDS_REWORK` trong `reviews/final/editor-final.md`; (4) **Human Approval Checkpoint:** Editor có sửa thì **dừng**, người dùng duyệt các thay đổi rồi mới export; không sửa thì báo cáo và export; (5) `novel export` (Pandoc), `epubcheck`, kiểm mục lục; ghi `output/` và chạy `novel backup` |
| **Không làm** | Không crawl hay dịch chương mới; không xuất khi Editor chưa `READY` hoặc thay đổi ở FINAL chưa được duyệt, trừ khi người dùng truyền `--force` (ghi rõ vào `editor-final.md`) |

### 5.4 Lệnh hỗ trợ

Không thêm skill. Xem tiến độ bằng `npm run novel -- status <book-id>` (mở rộng lệnh có sẵn). Resume được tích hợp sẵn: gọi lại `/novel-translate` với cùng phạm vi.

## 6. Subagent và trách nhiệm

### 6.0 Quyết định D-16: gộp Review và Edit vào Literary Editor (đánh giá tác động)

**Bối cảnh (đo từ 19 transcript, 2026-11-04, batch b0001–b0003 cùng rework):**
- Cả hai agent đều chạy Opus 5.5 · medium.
- Tính theo đơn vị quy đổi giá API (W), các bước Translator chiếm khoảng 67% (CONTEXT_INIT, TRANSLATE, FIX) và Critic khoảng 33%.
- Riêng vòng **FIX → REVALIDATE** đã chiếm khoảng **33%** (2.15M / 6.6M W): mỗi vòng phải nạp lại toàn bộ prompt và context cho hai agent mới, chỉ để sửa vài đoạn.

| Khía cạnh | Được | Mất / rủi ro | Giảm thiểu (bắt buộc trong thiết kế) |
|---|---|---|---|
| **Chất lượng dịch** | Lỗi được model mạnh hơn sửa trực tiếp, không mất thông tin khi chuyển giao (trước đây Translator có thể hiểu sai hoặc bỏ gợi ý). Bản cuối do Opus định hình câu chữ. Không còn trường hợp Sonnet sửa lỗi mà Opus đã chỉ ra. | Bản nháp Sonnet có thể yếu hơn (nghĩa, xưng hô, văn dịch máy), làm Editor phải sửa nhiều và dễ trượt sang **dịch lại**. Editor có thể sửa theo **khẩu vị**, làm phẳng giọng văn. Đề xuất context ở các batch sau (nhân vật mới, đổi xưng hô) do Sonnet viết. | Chính sách sửa ở mục 6.4: chỉ sửa khi có căn cứ; không sửa `SUGGESTION`; có ngưỡng `REDRAFT`. Context ban đầu (ma trận xưng hô, đại từ ngôi ba, glossary) do **Opus** dựng ở `CONTEXT_INIT`, rồi qua `approve-context` của người dùng. Đề xuất context của từng batch được Editor (Opus) kết luận ACCEPT / REJECT / NEEDS_USER trước khi người dùng duyệt. Pilot so sánh trước khi đổi hẳn (Slice T5). |
| **Tính độc lập** | Editor vẫn tách khỏi Translator: khác subagent, không thấy thinking hay notes, đánh giá từ nguồn. | **Mất kiểm tra độc lập đối với chính các thay đổi của Editor**: người review cũng là người sửa và tự kiểm bản sửa (post-edit check là tự kiểm). Editor có quyền ghi, nên tính chỉ đọc không còn được tool bảo đảm. | (1) Kiểm tra tất định sau biên tập (mục 9.2): hash raw, v1, context; diff đoạn phải khớp change log. (2) Change log trước/sau kèm căn cứ cho người duyệt; mục "Thay đổi quan trọng" bắt buộc. (3) FINAL chạy ở một instance mới, không mang theo lập luận của batch. (4) Human Approval sau mỗi batch. Rủi ro còn lại được chấp nhận có ý thức: lỗi do Editor tạo ra mà đúng ngữ pháp, khớp diff, chỉ người đọc hoặc FINAL mới bắt được. |
| **Usage Claude Pro** | Bỏ hẳn vòng Translator FIX và Critic REVALIDATE (khoảng 33% W trong log). Phần dịch (khoảng 2/3 token) chuyển sang Sonnet, vốn tiêu hạn mức chậm hơn Opus (tỉ lệ chính xác của gói không công bố; kiểm bằng `/usage`). Rework theo ghi chú người dùng chỉ cần 1 lần gọi Editor thay vì 2 lần gọi. | Editor tốn thêm cho thao tác sửa: mỗi lượt gọi tool đọc lại context khoảng 100–170K token (cache read). Editor phải đọc thêm `translation-master.md` (khoảng 15K token), vì giờ nó viết văn bản dịch. Nháp kém thì số sửa tăng. | Gửi mọi Edit của một chương **trong cùng một lượt** (gọi song song); không Write lại cả chương. Main tự sao chép v1 → v2, nên Editor chỉ đọc một bản. Các biện pháp tối ưu context loading (đánh giá 2026-11-05) vẫn áp dụng. |
| **Kiểm tra và khôi phục** | v1 (nháp) **bất biến**, v2 (sau biên tập) tách riêng; mỗi thay đổi có ID, đoạn, trước/sau, căn cứ; hoàn tác được từng thay đổi (`revert <id>`) hoặc cả chương (duyệt v1). | Editor bị ngắt giữa chừng thì v2 chỉ sửa được một phần. | v2 không có report hợp lệ thì bị loại và chạy lại từ bản sao mới của v1 (mục 10). Hash v1 được kiểm sau mỗi lần gọi Editor. |

**Kết luận:** chấp nhận gộp. Chất lượng và usage có lợi rõ. Phần độc lập bị mất được bù bằng kiểm tra tất định, change log và Human Approval. **Điều kiện:** pilot ở Slice T5 phải đạt tiêu chí ở mục 14, nếu không thì giữ mô hình cũ.

### 6.1 Hai subagent

| | **Translator** | **Literary Editor** |
|---|---|---|
| File | `.claude/agents/translator.md` | `.claude/agents/literary-editor.md` (thay `critic.md`) |
| `tools:` | `Read, Grep, Glob, Write, Edit` | `Read, Grep, Glob, Write, Edit` (không có `Agent`, không có `Bash`) |
| Model mặc định | `TRANSLATE`, `REDRAFT`: **Sonnet 5.5 · `medium`** (frontmatter). `CONTEXT_INIT`: **Opus 5.5 · `medium`** (skill truyền `model`/`effort` khi gọi) | **Opus 5.5 · effort `medium`** |
| Ghi đè | `book.yaml: models.translator.{context_init,translate}` | `book.yaml: models.editor.{review,final}` (skill truyền `model`/`effort` khi gọi) |
| Mode | `CONTEXT_INIT`, `TRANSLATE`, `REDRAFT` | `REVIEW_EDIT` (Batch Review), `REWORK`, `FINAL` (Final Review) |
| Trách nhiệm | Phân tích nguyên tác; dịch EN/ZH → VI thành **bản nháp hoàn chỉnh** (không phải nháp thô) theo master, module, context; giữ đoạn 1:1; viết summaries, notes và đề xuất context có nguồn chương (đây là cách Translator "cập nhật context", vì context đã duyệt chỉ đổi khi người dùng duyệt) | Review đủ 8 bước (mục 6.3); sửa cục bộ trên bản sao có căn cứ (mục 6.4); viết report kèm change log và post-edit check (mục 6.5); kết luận đề xuất context của Translator (ACCEPT / REJECT / NEEDS_USER) và có thể nêu đề xuất mới |
| Ghi được | `translated/chapter-NNNN.v1.md` (hoặc version REDRAFT được giao), `reviews/bNNNN/{summaries,notes}.md`, `context/proposals/` | **Chỉ** file version đích được giao (v2, v3…) và file report được giao |
| Không được | Tự review hoặc tự nhận PASS; sửa theo report của Editor (trừ `REDRAFT`); thêm context không có nguồn; gọi agent khác | Sửa raw, v1 hay bất kỳ version cũ nào, context đã duyệt, proposals, `status.json`; viết lại cả chương; sửa không có căn cứ; đổi quy ước cấp context (tên, thuật ngữ, cặp xưng hô đã duyệt) theo ý mình; gọi agent khác; đặt `APPROVED` |

- **Độc lập:** Editor không nhận `notes.md` hay thinking của Translator. Nó chỉ nhận raw, bản dịch, context, context tạm, proposals và summaries.
- **Chặn subagent lồng nhau:** không cấp tool `Agent` (B1 Q4).
- **Giới hạn ghi của Editor:** tool `Write`/`Edit` không giới hạn được theo đường dẫn. Vì vậy giới hạn được kiểm bằng **hash và diff do main chạy** (mục 9.2), không dựa vào lời tự khai.

### 6.2 Mode của Literary Editor

| Mode | Dùng khi | Input (skill truyền đúng bộ này) | Output |
|---|---|---|---|
| **REVIEW_EDIT** (Batch Review) | Bước 4 của `/novel-translate`, một batch ≤ 3 chương | raw và v2 (bản sao của v1) của mọi chương; kết quả kiểm tra cấu trúc (bước 2); context đã duyệt; context tạm; `proposals/bNNNN.md`; tóm tắt 3 chương trước; `context_version` | v2 đã sửa cục bộ; `reviews/bNNNN/editor-batch.md` |
| **REWORK** | Người dùng gõ `rework "<ghi chú>"` | ghi chú (là issue có bằng chứng); version hiện hành và đích version mới (main sao chép sẵn); raw; report trước của batch; context | version mới; `editor-rework.md` (vòng sau: `-2`) |
| **FINAL** (Final Review) | `/novel-finalize` | continuity toàn phạm vi, context, mọi `editor-batch.md`, issue còn mở, đoạn mẫu; chương cần đọc toàn văn do skill chọn | `reviews/final/editor-final.md`; version mới cho chương có sửa; `VERDICT: READY \| NEEDS_REWORK` |

Cả 3 mode đều chịu cùng chính sách sửa (mục 6.4), cùng định dạng change log (mục 6.5) và cùng kiểm tra sau biên tập (mục 9.2). Ở FINAL, Editor ghi rõ phần đã soát toàn văn và phần chỉ soát mẫu.

### 6.3 Tám bước bắt buộc (REVIEW_EDIT; REWORK và FINAL áp dụng trong phạm vi được giao)

Bước 1–6 là **review**, làm trước khi sửa bất kỳ chữ nào và ghi phát hiện kèm bằng chứng. Bước 7 là **sửa**. Bước 8 là **tự kiểm** sau khi sửa. Ánh xạ sang 10 quy tắc ở mục 7:

| # | Bước | Quy tắc | Nội dung chính |
|---|---|---|---|
| 1 | **Semantic Accuracy Review** | R1, R2 | Đối chiếu từng đoạn với nguồn: thêm, bớt, sai nghĩa, sai phủ định, chủ thể, thời gian, nhân quả, mức độ cảm xúc; nghĩa hợp cảnh |
| 2 | **Character & Addressing Review** | R3 | Xưng hô, đại từ ngôi ba, vai vế, giai đoạn quan hệ theo `relationships.md` và `characters.md`; giọng từng nhân vật |
| 3 | **Vietnamese Native Grammar Review** | R4, R5 | Cấu trúc mượn nguồn (对…很…, 被…), trật tự từ, danh xưng |
| 4 | **Anti-Translationese Review** | R6 | Lặp chủ ngữ, "một cách", danh từ hóa, ngữ khí từ dịch từng chữ (theo `vietnamese-style.md`) |
| 5 | **Literary Style Review** | R7, R8 | Nhịp câu, hình ảnh, giọng theo cảnh, đúng thời đại và thể loại (module), `style-notes.md` |
| 6 | **Cross-Chapter Consistency Review** | R9 | Tên, thuật ngữ, xưng hô, địa điểm, giọng giữa các chương trong batch và với 3 chương trước; kết luận đề xuất context |
| 7 | **Targeted Corrections** | — | Sửa theo mục 6.4 các phát hiện của bước 1–6 |
| 8 | **Post-edit Source Fidelity Check** | R10 | Với **mỗi** đoạn đã sửa: đọc lại câu nguồn; bản sửa giữ đúng nghĩa, không thêm bớt; vẫn 1:1; không phát sinh lỗi xưng hô hay thuật ngữ; câu nối với đoạn trước và sau. Kết quả `PASS \| FAIL` theo từng change ID. Change ID `FAIL` thì sửa lại hoặc hoàn tác về v1 trong cùng lần gọi |

### 6.4 Chính sách sửa

- **Sửa gì** (theo severity của phát hiện, giữ thang ở `rules/artifact-contract.md` mục 7):
  - `CRITICAL`, `MAJOR`: bắt buộc sửa.
  - `MINOR`: sửa khi chắc chắn và có căn cứ.
  - `SUGGESTION` (khẩu vị: câu đúng, tự nhiên, hợp giọng): **không sửa**, chỉ ghi nhận nếu đáng nêu.
- **Căn cứ hợp lệ** (mỗi thay đổi phải có ít nhất một):
  - (a) trích nguyên tác kèm số đoạn;
  - (b) mục context đã duyệt hoặc quyết định của người dùng (ví dụ `relationships.md › Chu Vân ↔ Quan`, `U4`);
  - (c) quy tắc có định danh: `translation-master §…`, `modules/<genre> §…`, `vietnamese-style §…`, `R1–R10`.
  - Không có căn cứ thì không sửa.
- **Phạm vi sửa:**
  - Chỉ câu hoặc cụm có lỗi; được chỉnh câu liền kề khi cần để câu nối tự nhiên.
  - Không tách hay gộp đoạn, giữ 1:1.
  - **Không viết lại cả chương.**
  - Đổi một tên, thuật ngữ hay xưng hô thì rà mọi chỗ cùng loại trong batch, mỗi chỗ là một change ID.
- **Ngưỡng `REDRAFT`** (người dùng duyệt 2026-11-05)**:** chương có trên 30% số đoạn cần sửa, hoặc có từ 5 lỗi `CRITICAL` về nghĩa trở lên, hoặc lỗi cấu trúc toàn chương.
  - Editor **dừng sửa chương đó**, ghi `REDRAFT` kèm lý do và danh sách lỗi.
  - Main gọi Translator `REDRAFT` **một lần**, dùng report làm chỉ dẫn; sau đó Editor `REVIEW_EDIT` lại chương đó.
  - Vẫn không đạt thì chuyển cho người dùng.
  - Đây là trường hợp **duy nhất** Translator được gọi lại sau review.
- **Cấp context:** bản dịch đã theo đúng context đã duyệt thì không "sửa" theo ý Editor. Nghi context sai thì ghi `Đề xuất context` với `NEEDS_USER` (`scope: context`), giữ nguyên bản dịch.
- **Kỹ thuật** (vì usage):
  - Dùng `Edit` với đoạn trích đủ dài để là duy nhất.
  - Mọi Edit của một chương gửi **song song trong cùng một lượt**.
  - Không dùng `Write` để ghi lại cả chương.

### 6.5 Report của Editor (`editor-batch.md`, `editor-rework.md`, `editor-final.md`)

```
Đã áp dụng: literary-editor-master.md, translation-master.md, vietnamese-style.md, modules: <…>, context v<N>, mode <MODE>
VERDICT: PASS | REWORK | LIMITED_PASS | BLOCKED          (FINAL: READY | NEEDS_REWORK)
Chương: 6 PASS (sửa 7) · 7 PASS (sửa 3) · 8 REDRAFT (lý do)

## Thay đổi quan trọng (cho người duyệt)      ← mọi CRITICAL/MAJOR và mọi đổi xưng hô, tên, thuật ngữ
## Change log
- id: E-ch0007-03
  chapter: 7 · paragraph: 12 · step: 2 (Character & Addressing) · rule: R3 · severity: MAJOR
  basis: "nguồn đ12: «…»" | "relationships.md › Chu Vân ↔ Quan" | "vietnamese-style §…"
  before: "<nguyên văn v1>"
  after:  "<nguyên văn v2>"
## Phát hiện không sửa                           ← scope: context, NEEDS_USER, SUGGESTION đáng nêu
## Đề xuất context                               ← kết luận ACCEPT / REJECT / NEEDS_USER cho proposals của Translator, cùng đề xuất mới
## Post-edit Source Fidelity Check               ← mỗi change ID: PASS | FAIL→đã xử lý
## Phạm vi đã soát / chưa soát
```

Change log là **nguồn sự thật để kiểm**: main so tập `(chapter, paragraph)` trong change log với diff thật giữa v1 và v2 (mục 9.2). Report chỉ nằm trong `reviews/`, không bao giờ đi vào file truyện hay EPUB.

### 6.6 Bảo toàn và khôi phục

| Tình huống | Cách khôi phục |
|---|---|
| Không đồng ý một thay đổi | `rework <id> <b> "revert E-ch0007-03"`: Editor `REWORK` lấy lại đoạn từ v1, sinh version mới, ghi change log |
| Không đồng ý toàn bộ biên tập một chương | `rework … "dùng bản nháp ch7"`: main đặt `current_version = v1` (không gọi agent) |
| Editor ghi ngoài phạm vi | Hash raw, v1 hoặc context đổi thì FAIL; báo người dùng, không tự sửa đè. Raw và context khôi phục từ backup zip hoặc `.history/` |
| Bị ngắt khi đang sửa | Xem mục 10 |

## 7. Prompt architecture và cách nạp

| Lớp | File | Ai dùng | Nội dung |
|---|---|---|---|
| **Skill** | `.claude/skills/novel-*/SKILL.md` | phiên main | Thứ tự bước, gọi agent nào và truyền file nào, khi nào gọi CLI, khi nào dừng. **Không chứa quy tắc dịch** |
| **Agent prompt** | `.claude/agents/{translator,literary-editor}.md` | subagent | Vai trò, mode, danh sách file **bắt buộc đọc** trước khi làm, giới hạn ghi, mẫu output |
| **Master prompt** | `prompts/translation-master.md`, `prompts/modules/*.md` | Translator **và** Editor | Luật dịch chung (master) và luật theo thể loại (module), xem master §12. Editor đọc đủ vì giờ nó **viết** văn bản dịch: bản sửa phải tuân cùng luật với bản nháp |
| | `prompts/translation-workflow.md` | Translator | Cách làm việc theo file, đoạn 1:1, notes, proposals. Mode `FIX` đổi thành `REDRAFT` (dịch lại cả chương theo report, chỉ khi vượt ngưỡng ở mục 6.4) |
| | `prompts/literary-editor-master.md` | Editor | Đổi tên từ `critic-master.md`. **Giữ nguyên** 10 quy tắc, severity, luật kết luận, nguyên tắc "không bắt lỗi khẩu vị". **Thay** §1 ("không sửa chương") bằng vai trò review và sửa. **Thêm** 8 bước (mục 6.3), chính sách sửa (6.4), report (6.5). Bỏ mode cũ CHAPTER, BATCH, REVALIDATE |
| | `prompts/vietnamese-style.md` | Translator **và** Editor | Chuẩn tiếng Việt chung để hai bên dùng cùng thước đo |
| **Context** | `books/<id>/context/*` | cả hai | Dữ liệu riêng của bộ truyện |
| **Quality gate** | shell (`awk`, `perl`, `shasum`, `cp`) theo `rules/artifact-contract.md` mục 6; sau này `novel check` | phiên main | Tiêu chí tất định, mục 9 |

**Cách nạp prompt:**
- Thân file agent liệt kê các file phải `Read` ở đầu mỗi lần gọi, chọn module theo `book.yaml: genre`.
- Output **bắt buộc** mở đầu bằng dòng `Đã áp dụng: …`. Translator ghi: `translation-master.md, translation-workflow.md, vietnamese-style.md, modules: <…>, context v<N>, mode <MODE>`. Editor ghi theo mẫu ở mục 6.5. Skill kiểm dòng này và gọi lại nếu thiếu.
- Phương án nạp sẵn qua `skills:` trong frontmatter của agent có trong tài liệu nhưng chưa được kiểm chứng; sẽ thử ở Slice T1.

**Mười quy tắc bắt buộc** (có trong cả `translation-master.md` lẫn `literary-editor-master.md`; R10 nay là post-edit check của Editor, mục 6.3 bước 8):
1. Semantic Fidelity
2. Contextual Accuracy
3. Character & Addressing Consistency
4. Vietnamese Native Grammar
5. Natural Word Order
6. Anti-Translationese
7. Literary Fluency
8. Historical/Cultural Authenticity
9. Cross-Chapter Consistency
10. Review → Fix → Revalidate

**Ví dụ minh họa** (trong `vietnamese-style.md`; đây **không phải bảng thay thế cứng**, mỗi quyết định phải dựa vào ngữ cảnh):

| Câu dịch máy | Gợi ý | Điều kiện |
|---|---|---|
| "Hay lắm thật!" | "Hay thật đấy!" | Tùy giọng nhân vật và cảm xúc |
| "Cung thân vương thế tử" | "Thế tử Cung Thân vương" | Chỉ khi đúng quan hệ danh xưng |
| "Ta đối với nàng rất thất vọng" | "Ta rất thất vọng về nàng" | Cấu trúc 对…很… |

**Đã sửa trong master (từ V1):** tách phần riêng cổ trang sang `modules/eastern-ancient.md`, master chỉ còn luật chung (quyết định 2026-11-04, không cần so sánh một-một với V1). Ngoài ra §10.1 (ghi chú hậu kỳ ở cuối bản dịch) đổi thành ghi chú vào `reviews/bNNN/notes.md`. File `translated/NNNN.md` **chỉ chứa** dòng tiêu đề `# …` và các đoạn văn, đúng 1:1 với số đoạn của raw.

**Phụ thuộc:** đổi `critic-master.md` thành `literary-editor-master.md` là thay đổi prompt của người dùng. Chỉ thực hiện ở Slice T5 sau khi người dùng duyệt bản sửa (phần giữ nguyên, phần thay, phần thêm như bảng trên). Không rút gọn các quy tắc đánh giá hiện có.

## 8. Crawler workflow (giữ code Slice 1)

```
book.yaml (url, adapter) → adapter.matches → (52shuku: HTTP | 69shuba: Playwright + Chrome thật, profile riêng)
  → cache HTML → parse → lọc rác → kiểm tra (mục 5.1) → raw/NNNN.md (+ frontmatter hash) → manifest.json
```

- Đã có: retry/backoff, nghỉ giữa các request, dừng khi gặp BLOCKED hoặc sau 3 lỗi liên tiếp, lock, ghi atomic, bỏ qua chương đã có, parse lại offline khi đổi parser.
- Thêm adapter cho site mới: một file trong `src/ingest/adapters/`, kèm fixture và golden.
- Hỗ trợ trong MVP: EN → VI và ZH → VI. Tiếng Hàn và tiếng Nhật: DEFER.

## 9. Translation workflow, quality gate và duyệt batch

### 9.1 Trạng thái (`status.json`, chỉ CLI ghi, ghi atomic)

```json
{
  "contextVersion": 3,
  "chapters": {
    "12": { "stage": "reviewed", "batch": "b0004", "rawHash": "…", "contextVersion": 3,
            "versions": { "v1": { "role": "draft", "by": "translator", "sha": "…" },
                          "v2": { "role": "edited", "by": "literary-editor", "from": "v1", "changes": 6 } },
            "current_version": "v2", "approved_version": null,
            "editor": "PASS", "issues": { "found": 7, "edited": 6, "open": 1 } }
  },
  "batches": {
    "b0004": { "range": [10, 12], "status": "PENDING_USER_APPROVAL", "editor": "PASS",
               "approvedBy": null, "approvedAt": null, "reworkNotes": null }
  },
  "final": { "editor": null, "edited": false, "exportedAt": null }
}
```

- `stage` của chương: `translated` (có v1) → `reviewed` (Editor xong và qua kiểm tra sau biên tập).
- `versions.*.role`: `draft` (Translator), `edited` (Editor REVIEW_EDIT), `rework`, `final-edit`, `redraft`. Lưu `from` để biết version nào sinh từ version nào.
- Batch chỉ dùng 4 trạng thái: `NEEDS_REWORK`, `BLOCKED`, `PENDING_USER_APPROVAL`, `APPROVED`.
- **Kết luận của Editor** (`editor: PASS | REWORK | LIMITED_PASS | BLOCKED`, `final.editor: READY | NEEDS_REWORK`) tách khỏi **phê duyệt của người dùng** (`status: APPROVED`, `approvedBy: "user"`). Editor đã sửa bản dịch **không** có nghĩa là bản đó được duyệt. Editor không bao giờ đặt được `APPROVED`.

### 9.2 Quality gate tất định

**`novel check <book> <chapters>`** (port từ `qa.py` V1, không gọi model):

| Kiểm tra | Kết quả |
|---|---|
| Số đoạn bản dịch ≠ số đoạn raw | FAIL |
| Còn chữ Hán / tiếng Anh chưa dịch (trừ tên trong glossary) | FAIL |
| Dùng biến thể thuật ngữ bị cấm trong `glossary.md` | FAIL |
| Xưng hô trái `relationships.md` trong phạm vi chương | WARN, chuyển cho Editor |
| Có dòng `---`, `Ghi chú`, hay dấu vết của review hoặc prompt trong `translated/` | FAIL |

**Kiểm tra sau biên tập** (main chạy `novel edit-check` sau **mỗi** lần gọi Editor; hash được chụp bởi `novel edit-prep` trước khi gọi):

| Kiểm tra | Kết quả |
|---|---|
| `shasum` của raw, v1 (và mọi version cũ), `context/*.md` khác với lúc chụp ở bước 3 | FAIL: Editor ghi ngoài phạm vi |
| Version mới không qua các kiểm tra cấu trúc ở bảng trên | FAIL |
| Đoạn khác nhau giữa version trước và sau **không có** change ID trỏ tới | FAIL: sửa không ghi log |
| Change ID trỏ tới đoạn **không** thay đổi | WARN: log sai, báo trong report |
| Report thiếu `Đã áp dụng:`, `VERDICT:`, mục Change log hoặc mục Post-edit check | FAIL |
| Tỉ lệ đoạn đã sửa trên 30% mà chương không ghi `REDRAFT` | WARN: nêu trong báo cáo, gợi ý người dùng đọc thử |

**Main** từ chối chuyển bước khi:
- thiếu v1 hoặc kiểm tra cấu trúc FAIL ở mức toàn chương (trước Editor);
- kiểm tra sau biên tập FAIL (trước `PENDING_USER_APPROVAL`);
- thiếu report Editor hợp lệ.

**`novel approve`** chỉ chạy được khi batch đang `PENDING_USER_APPROVAL`, và chỉ được gọi từ lệnh `/novel-translate approve …` **do người dùng gõ**. Skill ghi rõ: không bao giờ tự gọi lệnh này.

### 9.3 Vòng sửa

- **Không còn vòng Translator FIX → Critic REVALIDATE.** Sửa diễn ra **trong cùng lần gọi** Editor (bước 7), tự kiểm ở bước 8, rồi code kiểm (mục 9.2).
- Kiểm tra sau biên tập FAIL: gọi lại Editor **một lần** từ bản sao mới, kèm lỗi cụ thể. Vẫn FAIL thì chương `BLOCKED`, chuyển cho người dùng.
- Chương `REDRAFT`: Translator dịch lại **một lần**, rồi Editor review lại (mục 6.4). Vẫn không đạt thì `open_issues` và người dùng quyết định.
- Issue `scope: context` hoặc `NEEDS_USER` không sửa được bằng biên tập: để mở, kèm vào báo cáo, là điều kiện dừng của `--auto`.
- Rework theo ghi chú người dùng: Editor `REWORK`, tối đa 2 vòng cho mỗi ghi chú. Sau đó dừng và đưa report; **không** hạ tiêu chuẩn để cho qua.

### 9.4 Báo cáo cuối batch (phiên main viết, rồi dừng ở Human Approval Checkpoint)

```
Batch b0003 (ch 6–8) · Editor: PASS
- Bản nháp: translated/chapter-000{6,7,8}.v1.md (Translator · Sonnet)
- Sau biên tập: translated/chapter-000{6,7,8}.v2.md (Editor · Opus) · kiểm tra sau biên tập: PASS
- Đã sửa: 14 thay đổi (CRITICAL 1 · MAJOR 5 · MINOR 8) · đoạn đã sửa: ch6 7/63 · ch7 3/58 · ch8 4/60
- Thay đổi quan trọng (3–5 dòng, mỗi dòng: ID, chương/đoạn, trước → sau ngắn, căn cứ): …
- Không sửa / cần quyết định: … (ID, scope, NEEDS_USER)
- Đề xuất context: n mục · ACCEPT n · REJECT n · NEEDS_USER n
- Nên đọc thử: ch … (lý do: đổi xưng hô, nhiều sửa, cảnh khó)
Report: reviews/b0003/editor-batch.md
Duyệt:   /novel-translate approve <id> b0003
Sửa:     /novel-translate rework <id> b0003 "<ghi chú | revert E-ch0007-03 | dùng bản nháp ch7>"
```

Mặc định không tự chạy batch kế tiếp. `--auto` chạy liền nhiều batch nhưng **mỗi batch vẫn dừng ở `PENDING_USER_APPROVAL`**, và không bao giờ tự duyệt.

## 10. Recovery và checkpoint

| Yêu cầu | Cách làm |
|---|---|
| Không dịch lại chương đã xong | Chương có `stage ≥ translated`, `rawHash` khớp và `contextVersion` khớp thì bỏ qua |
| Không review lại batch đã duyệt khi dữ liệu không đổi | `APPROVED`, đồng thời mọi chương không stale, thì bỏ qua |
| Không mất bản dịch khi hết usage | Translator ghi từng chương xong mới sang chương sau; main ghi status sau mỗi bước. Chạy lại cùng lệnh thì làm tiếp từ bước dang dở; v1 hợp lệ thì không dịch lại |
| Editor bị ngắt giữa chừng | v2 không có report hợp lệ thì coi là **dở dang**: chuyển v2 sang `.history/` với hậu tố `.partial`, sao chép lại v1 → v2, gọi lại Editor. Không bao giờ tiếp tục trên một v2 sửa dở mà không có change log |
| Khôi phục bản nháp hoặc hoàn tác một thay đổi | Mục 6.6. v1 bất biến nên luôn có điểm quay về |
| Sửa một chương riêng | `/novel-translate <book> 14-14` (chỉ chương 14, giữ nguyên batch); batch của chương đó quay về `PENDING_USER_APPROVAL` |
| Raw hoặc context đổi thì bản dịch cũ cần xem lại | `novel status` so `rawHash` và `contextVersion` của từng chương với hiện tại rồi in **STALE** (tính ra, không lưu). Không tự dịch lại; người dùng quyết định |
| Không tự đánh dấu `APPROVED` | Mục 9.2 |
| Hai phiên chạy song song | Lock file theo truyện (có sẵn) |
| Backup | `novel backup <book>`: zip `books/<id>` (bỏ `.cache`) vào Google Drive for desktop (`My Drive/novel-backups/<id>/`). Chạy sau khi crawl xong, sau mỗi batch được duyệt, và lúc finalize. Không dùng Git |

## 11. EPUB export

- `novel export <book> [range]` dùng **Pandoc** (đã có trên máy) rồi **epubcheck** (đã cài).
- Input: chỉ các chương thuộc batch `APPROVED`, theo thứ tự số chương, lấy từ `translated/NNNN.md`.
- Metadata (tiêu đề, tác giả, ngôn ngữ `vi`, nguồn) lấy từ `book.yaml` và `manifest.json`.
- Yêu cầu và cách kiểm:

| Yêu cầu | Kiểm tra |
|---|---|
| Đúng thứ tự, tiêu đề chương chuẩn | Mỗi file bắt đầu bằng `# <tiêu đề>`; export sắp xếp theo số chương |
| Mục lục điều hướng | Pandoc `--toc --split-level=1`; đối chiếu số mục trong mục lục với số chương |
| Unicode tiếng Việt, xuống dòng, hội thoại | UTF-8; mỗi đoạn là một paragraph; dấu ngắt cảnh (`————`, `===`) được giữ dưới dạng text, không biến thành `<hr>` ngoài ý muốn |
| Không lẫn review, prompt hay ghi chú | `check` FAIL nếu có; export chỉ đọc `translated/*.md` |
| Xuất lại sau khi sửa | Idempotent: ghi đè `output/<id>.epub` |
| File hợp lệ | `epubcheck` pass mới bàn giao |

## 12. Tối ưu usage cho Claude Pro

- Chạy tuần tự, foreground. Mỗi batch (≤ 3 chương): **1 lần gọi Translator (Sonnet) và 1 lần gọi Editor (Opus)**. Không còn lượt FIX hay REVALIDATE riêng; trong log 2026-11-04 hai lượt này chiếm khoảng 33% W.
- Model theo vai trò:
  - phần sinh nhiều token, lặp mỗi batch (dịch nháp): Sonnet;
  - phần cần phán đoán: Opus. Gồm review và biên tập (mỗi batch), và `CONTEXT_INIT` (một lần mỗi bộ truyện, nên chi phí nhỏ nhưng quyết định xưng hô cho mọi chương sau);
  - cả hai ở effort `medium`; muốn đổi effort thì phải qua A/B.
- Translator: dịch xong chương nào thì `Write` ngay chương đó rồi mới sang chương sau. Một lượt sinh output không nên vượt khoảng 5 phút, nếu không cache 5 phút của subagent hết hạn và cả context phải ghi lại.
- Editor: đọc v2 (bản sao), không đọc thêm v1. Mọi Edit của một chương gửi trong một lượt. Không Write lại cả chương.
- Chỉ nạp context, context tạm ở dạng gọn, tóm tắt 3 chương trước, cùng raw và bản dịch của batch. Không nạp cả truyện, không nạp report cũ hay chương dịch đầy đủ làm "tham khảo".
- Final Mode đọc **continuity cùng các đoạn bị gắn cờ hoặc đoạn mẫu**, không đọc lại toàn văn.
- Rework theo ghi chú: 1 lần gọi Editor, tận dụng report cũ.
- Hết hạn mức thì dừng; chạy lại cùng lệnh để tiếp tục (mục 10). Lệnh `/usage` cho thấy mức tiêu hao của gói và tỷ trọng theo subagent.
- Trước khi dịch, tắt MCP connector không dùng (`/mcp`) và xem `/context`. Ở B1, phần cố định của phiên main khoảng 30k token mỗi lượt.
- Không có token accounting, hook hay observability.

## 13. Implementation slices

Thứ tự ưu tiên: dùng lại code crawler và prompt có sẵn; mỗi slice chạy được từ đầu tới cuối. Các slice T0–T4 mô tả theo mô hình Critic cũ (lịch sử triển khai). Từ T5, "Critic" được hiểu là Literary Editor theo D-16.

| Slice | Nội dung | Code mới | Xong khi |
|---|---|---|---|
| **T0. Chuẩn bị** | Chuyển prompt V1 vào `prompts/` (nguyên văn; sửa §10.1); nhận prompt Critic của người dùng thành `critic-master.md` (3 mode); viết `vietnamese-style.md`; cập nhật CLAUDE.md (bỏ quy tắc Git và `validate --commit`, thêm `books/` không được commit) | Không | Người dùng duyệt 3 file prompt |
| **T1. Crawl skill + layout** | Đổi raw-store sang `books/<id>/raw/` + `manifest.json`; chuyển dữ liệu KZGD; `/novel-crawl` gọi CLI có sẵn | Nhỏ (đổi đường dẫn, sinh manifest) | `/novel-crawl kzgd` chạy lại thì báo đủ 201 chương, 0 request mạng; golden test vẫn xanh |
| **T2. Dịch và review 1 chương** | Agent `translator` và `critic` (Chapter, verify); `novel check` (port `qa.py`); `status.json` + `novel mark`; `/novel-translate kzgd 1-2` chỉ có vòng chương. Thử preload prompt bằng `skills:` | Vừa (`check`, `status`, `mark`) | Lỗi cài sẵn trong 1–2 chương: Critic bắt được ≥ 8/10; `check` chặn được lệch số đoạn và chữ Hán sót; ngắt giữa chừng rồi chạy lại thì không dịch lại chương đã `mark`; Critic không ghi được file |
| **T3. Context + batch + duyệt** | Bước 0 dựng context và dừng; Critic Batch Mode; `context-updates`; `approve`/`rework`; phát hiện STALE; báo cáo batch | Nhỏ (`approve`, stale) | Batch 10 chương dừng ở `PENDING_USER_APPROVAL`; `approve` gộp context và tăng version; sửa raw hoặc context thì `status` báo STALE; xưng hô cài sai giữa các chương bị Batch Mode bắt |
| **T4. Finalize + EPUB + backup** | Critic Final Mode; `novel export` (Pandoc + epubcheck); `novel backup` (zip lên Drive; thay `snapshot` dùng `git bundle`) | Nhỏ | Bị chặn khi còn batch chưa `APPROVED`; EPUB qua epubcheck; mục lục đúng số chương; không lẫn ghi chú; zip lên Drive giải nén ra đọc được |

| **T5. Translator (Sonnet) → Literary Editor (Opus)** (D-16) | Chỉ prompt, agent, skill, contract: `.claude/agents/translator.md` (`model: sonnet`, bỏ FIX, thêm REDRAFT; skill truyền `model: opus` cho CONTEXT_INIT); tạo `literary-editor.md`; **giữ `critic.md` làm reviewer chuẩn chỉ đọc trong pilot, xóa sau pilot**; `critic-master.md` thành `literary-editor-master.md` (mục 7); `translation-workflow.md` §5; `novel-translate` và `novel-finalize` SKILL (bước 3–6, `rework`, thêm `Bash(cp:*)`); `rules/artifact-contract.md` mục 1, 3.2, 7, 8; `templates/status.example.json`; CLAUDE.md (mục "Hai subagent") | Nhỏ: `novel edit-prep` (sao chép và chụp hash), `novel edit-check` (hash, cấu trúc, diff đoạn so với change log), `novel agent-check` (model thật, foreground) trong `src/edit-guard.ts` | **Pilot** trên cùng 3 chương (ví dụ ch 9–11), ở thư mục sao chép `books/kzgd-ab*`, so với mô hình cũ. Đạt tiêu chí 11–13 ở mục 14 thì mới chuyển hẳn |

**Code bỏ hoặc đổi:**
- `src/snapshot.ts` (`git bundle`, tag) chuyển thành `novel backup` (zip).
- Khi đổi layout, `crosscheck` đọc theo đường dẫn mới; lệnh này vẫn là công cụ phát triển.
- Không viết: apply-fixes, logger, validator runtime, profile đo song song.

## 14. Acceptance criteria (MVP)

1. Ba command chạy được trên KZGD: crawl (dữ liệu đã có), dịch 1 batch, finalize ra EPUB.
2. Chỉ có 2 subagent trong workflow (Translator, Literary Editor); không agent nào gọi được agent khác. Kiểm tra sau biên tập bắt được mọi trường hợp Editor đổi raw, v1 hay context, và mọi đoạn bị sửa mà không có change ID.
3. Không có thao tác Git nào trong workflow dữ liệu; không có hook.
4. Batch dừng ở `PENDING_USER_APPROVAL`; chỉ lệnh do người dùng gõ mới đặt `APPROVED`; trạng thái tách kết luận của Editor khỏi phê duyệt của người dùng.
5. Chạy lại sau khi bị ngắt hoặc hết usage thì không dịch lại và không review lại phần đã xong; phát hiện được STALE.
6. `check` chặn được: lệch số đoạn, chữ Hán sót, biến thể thuật ngữ bị cấm, ghi chú lọt vào bản dịch.
7. Editor bắt **và sửa đúng** ≥ 8/10 lỗi cài sẵn (nghĩa, xưng hô, văn dịch máy) trên dữ liệu thử, không tạo lỗi nghĩa mới (post-edit check và người dùng đọc đối chiếu).
8. EPUB qua epubcheck, mục lục đúng, Unicode tiếng Việt đúng, không lẫn review hay prompt.
9. Agent đọc đủ master, module theo genre và context; khai báo đúng các file đã áp dụng.
10. Không dùng API key trả phí; chạy được trên gói Claude Pro (kiểm `/model` và `/usage` ở T2).
11. *(Bỏ 2026-11-05, pilot không chạy hết.)* **(Pilot T5, chất lượng)** Trên cùng 3 chương, bản sau biên tập của mô hình mới được chấm bởi **cùng một reviewer chuẩn** (`critic.md` hiện tại: Opus, chỉ đọc, chạy riêng cho pilot; không sửa file, không tham gia workflow): số `CRITICAL` không tăng, `MAJOR` ≤ mô hình cũ + 1; kiểm tra tự động (biến thể cấm, cặp xưng hô chính, từ vùng miền theo quyết định người dùng, chữ Hán sót) không có lỗi mới; người dùng đọc mù 2–3 cảnh không chọn bản cũ ở ≥ 2/3 mẫu.
12. *(Bỏ 2026-11-05.)* **(Pilot T5, biên tập có kiểm soát)** Không chương nào bị viết lại trên 30% số đoạn mà không ghi `REDRAFT`. 100% thay đổi có căn cứ hợp lệ (mục 6.4). Kiểm tra sau biên tập PASS.
13. *(Bỏ 2026-11-05.)* **(Pilot T5, usage)** % `/usage` cho mỗi chương (Translator cộng Editor) thấp hơn mô hình cũ (Translator, Critic, FIX, REVALIDATE). Ghi kèm token theo transcript (cache read, cache write, output, thinking) để đối chiếu.
