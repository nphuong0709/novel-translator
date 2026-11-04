# Architecture Review: đơn giản hóa framework (2026-11-04)

Đầu vào đã đọc: `docs/blueprint-v4.md` (D-01…D-15), `docs/capability-verification.md` (B1), code Slice 1 (`src/ingest/**`, `src/snapshot.ts`), các prompt V1 (`translation_skills/novel-translation-system.md` 466 dòng, `eastern_ancient.md`, `novel-translation-core.md`), `qa.py` của V1, context mẫu của V1 (`books/hywyw/{characters.json, glossary.json, style.md, *-glossary.md}`).

Kết quả được dùng để viết `docs/novel_translation_framework_blueprint_simplified.md`.

---

## 1. Vấn đề của thiết kế hiện tại

| # | Vấn đề | Biểu hiện trong blueprint-v4 |
|---|---|---|
| P1 | **Giải sai bài toán.** Quy trình thủ công đã cho ra bản dịch tốt; cái thiếu là **tự động chuyển giao** giữa các bước, không phải thêm đảm bảo kỹ thuật | Rất nhiều cơ chế (commit mỗi vòng, frontmatter hash ở mọi artifact, apply-fixes, logger, runtime validator) phải viết xong trước khi dịch được chương đầu |
| P2 | **Quá nhiều lượt critic** cho mỗi nhóm chương | R1 → sửa → R2 → sửa → R1-delta: 5–6 lần gọi subagent mỗi nhóm, chạy tuần tự. Tốn usage của gói Pro và chậm |
| P3 | **Git len vào mọi tầng** | Trạng thái (D-07), kiểm vết (D-06, D-12), commit chỉ qua `validate --commit`, backup bằng `git bundle` (D-11) |
| P4 | **Quan sát runtime vượt nhu cầu cá nhân** | Hook ghi log, đối chiếu model/effort, kiểm thứ tự thời gian (D-15 mục 4–5) |
| P5 | **Thiếu đúng thứ quyết định chất lượng** | Không có `critic-master.md`; prompt Critic thủ công của người dùng chưa vào repo. Blueprint mô tả quy trình review rất kỹ nhưng **không có nội dung review** |
| P6 | **Xung đột định dạng đầu ra** | Master prompt §10.1 ghi chú hậu kỳ ở cuối bản dịch sau `---`; nếu không tách ra thì ghi chú lẫn vào EPUB. `---` cũng là cú pháp đường kẻ ngang của Markdown và Pandoc |
| P7 | **Hai nơi chứa dữ liệu** | `../novel-books/<id>/` (repo git riêng) trong blueprint-v4, còn yêu cầu mới là `books/<id>/` trong repo framework (đã có trong `.gitignore`) |

## 2. Trả lời 10 câu hỏi phản biện

**1. Còn thành phần nào quá phức tạp?**
Có. Đó là toàn bộ nhóm P2–P4, cộng với:
- `apply-fixes` khớp chính xác excerpt và chuyển xung đột cho editor;
- context-delta phải được code kiểm trích dẫn;
- 2 profile model đo song song;
- 3 agent.

Mỗi thứ đều có lý do riêng, nhưng gộp lại thì chi phí xây dựng vượt xa lợi ích cho một người dùng.

**2. Hai subagent có đủ cho chất lượng không?**
Đủ, với điều kiện chất lượng đến từ **prompt, context và Critic độc lập**, không đến từ số agent.

Rủi ro: Translator kiêm luôn việc sửa có thể "bảo vệ" cách dịch của mình hoặc sửa lan ra ngoài issue. Giảm rủi ro bằng hai cách:
- Translator chỉ nhận danh sách issue cùng các đoạn liên quan.
- `novel check` so số đoạn trước và sau khi sửa, rồi liệt kê những đoạn **thay đổi mà không có issue nào trỏ tới**.

Cách này cần rất ít code.

**3. Một Critic dùng 3 mode có rủi ro gì?**
- **Lẫn phạm vi.** Batch Mode quay lại soi câu chữ từng chương; Final Mode viết lại văn. Cả hai đều tốn usage và trùng việc với Chapter Mode.
- **Loãng sự chú ý.** Ở Chapter Mode, một lượt phải soát cả nghĩa lẫn văn phong. Blueprint-v4 tách thành R1 và R2 chính vì lý do này.
- **Tự xác nhận một phần.** Ở bước kiểm tra lại, Critic soát đoạn Translator đã sửa, nhưng đoạn đó thường chép từ `proposed_fix` của chính Critic.

Cách giảm rủi ro:
- Mỗi mode có **bộ input riêng, checklist riêng và mẫu output riêng** trong `critic-master.md`. Skill chỉ truyền đúng input của mode đó.
- Chapter Mode trả về **2 phần bắt buộc**: A (nghĩa, nhân vật, xưng hô) và B (tiếng Việt, dấu vết dịch máy, văn phong).
- Kiểm tra lại chỉ đối chiếu **đoạn đã sửa với nguyên tác**, theo tiêu chí nghĩa.
- Người dùng duyệt cuối mỗi batch, nên lỗi tự xác nhận còn lọt vẫn có một lớp bắt.
- Nếu đo bằng lỗi cài sẵn mà thấy Chapter Mode bỏ sót, **khi đó** mới tách thành 2 lượt (DEFER).

**4. Tự động chuyển giao giữa các bước có đáng tin không?**
Chỉ tin được ở mức trung bình. Skill là chỉ dẫn cho LLM, nên LLM có thể bỏ bước, nhất là khi gần chạm hạn mức hoặc context đã dài. Cách làm đủ dùng:
- Mỗi bước **ghi ra một file có tên cố định**.
- Trạng thái chỉ được đổi qua một CLI nhỏ (`novel mark`). CLI này **từ chối** chuyển bước khi thiếu file của bước trước, ví dụ không có review thì không cho đánh dấu đã sửa.
- Không cần hook hay log.

**5. Kiểm tra tối thiểu nào để không bỏ sót review?**
1. Có `reviews/<batch>/chNNN.md` với dòng kết luận hợp lệ, thì mới được qua bước review.
2. Có issue thì phải có file kiểm tra lại, thì mới được qua bước sửa.
3. Có `batch-review.md`, thì batch mới sang được `PENDING_USER_APPROVAL`.
4. Chỉ lệnh do **người dùng gõ** mới đặt được `APPROVED`. Trạng thái ghi `approvedBy: user` kèm thời gian.
5. Export chỉ lấy chương thuộc batch đã `APPROVED`.

Tất cả nằm trong `novel mark` / `novel approve`, khoảng vài chục dòng code.

**6. Resume ổn định được không, khi không có database và Git?**
Được, với các điều kiện:
- `status.json` được ghi atomic (đã có `writeFileAtomic`).
- Mỗi bước idempotent: output đã có và hash input không đổi thì bỏ qua.
- Đơn vị việc là **một chương**, nên nếu chạm hạn mức giữa chừng thì tối đa mất một chương đang làm dở.

Lock file đã có từ Slice 1 và vẫn hữu ích để chặn hai phiên cùng ghi.

**7. Giữ glossary và xưng hô nhất quán cho truyện 200+ chương thế nào?**
- **Context có cấu trúc:**
  - `characters.md` (Character Bible);
  - `relationships.md` (ma trận xưng hô **theo phạm vi chương**, vì xưng hô đổi theo diễn biến);
  - `glossary.md` (mỗi thuật ngữ có cột *nguồn: chương N*);
  - `style.md`.
- **Tóm tắt 1–3 dòng mỗi chương** (`summaries.md`) thay cho việc nạp lại các chương trước.
- Translator **đề xuất** cập nhật context vào file riêng của batch; Critic soát ở Batch Mode; người dùng duyệt cùng batch rồi mới gộp vào context. Không có trích dẫn chương thì không nhận.
- Kiểm tra tất định trên **toàn bộ bản dịch**: thuật ngữ có biến thể bị cấm, và xưng hô vi phạm ma trận. Phần này port từ `qa.py` của V1.

**8. Ranh giới Skill / Agent Prompt / Context đã rõ chưa?**
Trong blueprint-v4 thì chưa: rules, rubric và luồng xử lý bị trộn vào nhau. Blueprint mới tách ra:

| Lớp | Nơi đặt | Nội dung |
|---|---|---|
| Skill | `.claude/skills/*` | Thứ tự bước, gọi agent nào, chuyển file nào, khi nào dừng |
| Agent prompt | `.claude/agents/*` (ngắn) + `prompts/*` (master) | Vai trò, phương pháp, tiêu chuẩn chất lượng |
| Context | `books/<id>/context/*` | Dữ liệu riêng của từng bộ truyện |
| Quality gate | `novel check`, `novel mark` | Tiêu chí tất định phải đạt trước khi sang bước sau |

**9. Có cách ít code hơn mà vẫn đủ chất lượng không?**
Có:
- Skill và agent là Markdown.
- Code mới chỉ gồm `status/mark/approve`, `check` (port `qa.py`), `export` (gọi Pandoc và epubcheck) và đổi layout cho raw.
- Bỏ apply-fixes, logger, validator runtime và Git.

Có thể bỏ luôn `novel mark` và để LLM tự sửa `status.json`, nhưng cách đó mất lớp chặn bỏ bước ở câu 4–5. Vì vậy **không khuyến nghị**.

**10. Giữ gì từ PoC?**
Chỉ giữ những thứ **không cần thêm code**:
- `tools:` allowlist để Critic chỉ đọc (Q3);
- gọi tuần tự ở foreground (Q7);
- skill nhận `$ARGUMENTS` (Q6);
- có thể ghi đè `model` theo từng lần gọi, nếu cần (Q1);
- hướng dẫn `/usage` và tắt MCP.

Hook, logger, validator runtime và biến `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` đều không giữ. Chặn lồng nhau bằng cách không cấp tool `Agent` cho agent là đủ.

## 3. Phân loại quyết định

| Thành phần | Quyết định | Ghi chú |
|---|---|---|
| Crawler TS (`src/ingest/**`): adapter, checks VALID/SUSPECT/FAILED/BLOCKED, cache HTML, retry, lock, ghi atomic, bỏ qua chương đã có | **KEEP** | Đã kiểm chứng trên KZGD 201/201. Chỉ đổi nơi ghi raw sang `raw/` và thêm `manifest.json` |
| Golden test và spec test của crawler | **KEEP** | Là test khi phát triển, không nằm trong workflow |
| Nguyên tắc truy cập nguồn (không vượt CAPTCHA/Cloudflare) | **KEEP** | |
| Master prompt V1 (`novel-translation-system.md`, `eastern_ancient.md`) | **KEEP** (nguyên văn) | Chuyển vào `prompts/`. Chỉ sửa §10.1 để ghi chú hậu kỳ nằm ở file riêng (P6) |
| Kiểm tra tất định của `qa.py` V1 | **KEEP**, port sang `novel check` | Số đoạn, sót chữ Hán/tiếng Anh, xưng hô vi phạm quan hệ, biến thể thuật ngữ |
| Translator ≠ Critic; Critic chỉ đọc bằng `tools:` | **KEEP** | B1 Q3 |
| Gọi subagent tuần tự, foreground | **KEEP** | B1 Q7, chỉ là một dòng chỉ dẫn trong skill |
| Người dùng duyệt mỗi batch | **KEEP** | |
| `book.yaml` (cấu hình truyện), `init`, `status`, `import` | **KEEP** | `import` dùng khi đã có raw sẵn |
| 3 agent → **2 agent** (Translator, Critic 3 mode) | **SIMPLIFY** | |
| R1 / R2 / R1-delta → **1 lượt Chapter Review (2 phần A/B) + kiểm tra lại các đoạn đã sửa** | **SIMPLIFY** | Mỗi chương có 2–3 lần gọi subagent thay vì 5–6 mỗi nhóm |
| `apply-fixes` khớp chính xác + editor | **SIMPLIFY** → Translator sửa theo issue; `check` báo đoạn đổi mà không có issue | |
| Frontmatter hash ở mọi artifact (D-07) | **SIMPLIFY** → `status.json` ghi `rawHash` và `contextVersion` cho mỗi chương | Phát hiện bản dịch cũ (stale) bằng so sánh đơn giản |
| Context-delta có code kiểm trích dẫn | **SIMPLIFY** → cột *nguồn chương* bắt buộc; Critic soát ở Batch Mode; người dùng duyệt | |
| Profile model `epic/standard` (D-14) | **SIMPLIFY** → model và effort mặc định trong frontmatter agent; `book.yaml` có thể ghi đè | Việc đo `standard`: DEFER |
| Backup lên Drive (D-11) | **SIMPLIFY** → zip `books/<id>` (bỏ `.cache`), không cần Git | Chạy sau khi crawl xong, sau batch được duyệt, và lúc finalize |
| Git cho dữ liệu: commit mỗi vòng, `validate --commit`, D-06, D-12, `git bundle` | **REMOVE** | Theo yêu cầu. Repo framework vẫn dùng Git như repo code bình thường |
| Hook logger, `SubagentStop`, đối chiếu model/effort, kiểm thứ tự thời gian (D-15 mục 4–5) | **REMOVE** | Theo dõi usage bằng `/usage` |
| Agent `consistency-critic` riêng | **REMOVE** | Gộp vào Critic (Batch Mode, Final Mode) |
| Mã hóa, tag `raw-done`/`final` trong Git | **REMOVE** | |
| `crosscheck` với V1 | **DEFER** (giữ code, ngoài workflow) | Công cụ phát triển |
| Đo profile `standard`, đo khi tắt MCP | **DEFER** | Làm khi có số liệu thật |
| Chế độ tự chạy nhiều batch liên tiếp | **DEFER** | Mặc định dừng sau mỗi batch |
| Tách Chapter Review thành 2 lượt | **DEFER** | Chỉ làm nếu đo thấy bỏ sót |
| Nạp context có chọn lọc (chỉ nhân vật xuất hiện) | **DEFER** | Khi context quá lớn |
| Tiếng Hàn và tiếng Nhật | **DEFER** | |
| Nạp prompt bằng `skills:` preload trong frontmatter agent | **DEFER** (thử ở Slice T1) | Có trong tài liệu, chưa thử ở B1 |

## 4. Rủi ro còn lại

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| **Chưa có `critic-master.md`.** Chất lượng review phụ thuộc vào prompt Critic thủ công của người dùng | **Cao** | Người dùng cung cấp prompt Critic đã dùng. Nếu chưa có, dựng tạm từ §15 của master prompt, 10 quy tắc và các ví dụ trong yêu cầu, rồi người dùng duyệt trước Slice T1 |
| LLM điều phối bỏ bước hoặc làm sai thứ tự | Trung bình | `novel mark` từ chối chuyển bước khi thiếu file; người dùng duyệt batch |
| Agent không đọc đủ prompt hoặc context | Trung bình | Agent bắt buộc mở đầu output bằng dòng `Đã áp dụng: …` (tên file và version context); skill kiểm tra dòng này. Thử phương án preload ở T1 |
| Gói Pro có thể không cho dùng Opus hoặc nhanh chạm hạn mức | Trung bình | Kiểm tra bằng `/model` và `/usage` trong T1; `book.yaml` cho phép đổi sang Sonnet |
| Context lớn dần theo số chương | Trung bình | Tóm tắt từng chương thay cho chương đầy đủ; nạp context có chọn lọc (DEFER) |
| Mất dữ liệu (không còn Git) | Trung bình | Ghi atomic, không ghi đè raw, giữ bản nháp đầu, zip lên Drive ở các mốc |
| Ghi chú hậu kỳ hoặc review lọt vào EPUB | Thấp (khi đã sửa §10.1) | `export` chỉ đọc `translated/*.md`; `check` báo dòng `---` hoặc ghi chú |
| Lỡ tay commit dữ liệu truyện vào repo framework | Thấp | `books/` đã có trong `.gitignore`; thêm cảnh báo trong CLAUDE.md |

## 5. Giải pháp tối giản (tóm tắt)

```
/novel-crawl     → code crawler (có sẵn) → raw/ + manifest.json → báo cáo → DỪNG
/novel-translate → [context chưa có: Translator dựng context → DỪNG để duyệt]
                   mỗi chương: Translator dịch → check → Critic (Chapter) → Translator sửa → Critic kiểm lại → mark
                   cuối batch: Critic (Batch) → sửa nếu cần → báo cáo → PENDING_USER_APPROVAL → DỪNG
                   /novel-translate approve <batch> (người dùng gõ) → APPROVED
/novel-finalize  → kiểm batch đã APPROVED → Critic (Final) → sửa và kiểm lại → pandoc → epubcheck → output/
```

Gồm 2 subagent, 3 command, 1 file trạng thái. Không Git, không hook, không database.
