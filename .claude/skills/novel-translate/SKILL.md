---
name: novel-translate
description: Dịch một phạm vi chương sang tiếng Việt theo batch tối đa 3 chương. Translator (Opus) dịch bản nháp; Literary Editor (Opus) độc lập review và sửa cục bộ; dừng để người dùng duyệt. Có chế độ --auto chạy liền nhiều batch. Có lệnh con approve, rework, approve-context. Chỉ chạy khi người dùng gõ /novel-translate.
disable-model-invocation: true
argument-hint: "<book-id> --range 1-10 [--batch-size 1-3] [--auto] [--draft-epub]  |  approve-context <book-id> [--no-run]  |  approve <book-id> <bNNNN>[-bMMMM]  |  rework <book-id> <bNNNN> \"ghi chú\""
allowed-tools: Read, Write, Grep, Glob, Agent, Bash(awk:*), Bash(perl:*), Bash(grep:*), Bash(shasum:*), Bash(ls:*), Bash(mkdir:*), Bash(mv:*), Bash(npm run -s novel -- save-report:*), Bash(npm run -s novel -- edit-prep:*), Bash(npm run -s novel -- edit-check:*), Bash(npm run -s novel -- agent-check:*), Bash(pandoc:*), Bash(epubcheck:*), Bash(unzip:*)
---

# /novel-translate: Translator (Opus) → Literary Editor (Opus) → người dùng duyệt

Tham số người dùng: `$ARGUMENTS`

**Không bao giờ** crawl, không xuất EPUB cuối, không chạy Git. Main chỉ **điều phối**:
- đọc contract và status, chuyển đường dẫn cho agent;
- chạy kiểm tra tất định;
- ghi status, báo cáo, rồi dừng.

**Không** tự đọc các master prompt (agent tự đọc), để giữ context của main nhỏ.

Đọc trước: `rules/artifact-contract.md`, `books/<id>/book.yaml`, `manifest.json`, `status.json`.

**Gọi agent (bắt buộc, mọi lần):**
- Tham số `run_in_background: false` nếu Agent tool có tham số này. Nếu agent vẫn bị chạy nền: **chờ thông báo hoàn tất** (báo cáo của agent và task-notification `completed`) rồi mới chạy `agent-check`. Trong lúc chờ không làm bước nào trên file của agent; không đọc file transcript hay output của nó.
- Sau mỗi lần gọi, chạy `npm run -s novel -- agent-check books/<id> --agent <agentId> --model <opus|sonnet>` (agentId lấy từ kết quả gọi Agent; `--model` là model mong đợi ở mục 1.5).
- Mã 0 có `WARN: chạy nền nhưng đã xong`: hợp lệ, đi tiếp. Ghi cảnh báo vào báo cáo cuối (dòng `Agent:`).
- Mã 2: báo người dùng chính xác lỗi, rồi:
  - sai model: **gọi lại một lần** với đúng tham số `model`; vẫn sai thì dừng;
  - `SAI: chạy nền, chưa xác nhận đã xong`: dừng, không làm tiếp trên kết quả chưa chắc đã xong. Chạy lại cùng lệnh sau khi agent xong (mục 3, Resume).

## 0. Chọn lệnh

| Lệnh | Đi tới |
|---|---|
| `<book-id> --range a-b …` | mục 1 |
| `approve-context <book-id> [--no-run]` | mục 6.1 |
| `approve <book-id> <bNNNN>` hoặc `<bNNNN-bMMMM>` | mục 6.2 |
| `rework <book-id> <bNNNN> "ghi chú"` | mục 6.3 |
| `answer <book-id>` | mục 6.4 (hỏi các câu đang mở) |
| `sync <book-id> [--range a-b] ["ghi chú"]` | mục 6.5 |

Lệnh `approve*` **chỉ** chạy khi chính người dùng gõ trong tin nhắn hiện tại. Không bao giờ tự gọi, kể cả khi Editor `PASS`, kể cả ở chế độ `--auto`. Một câu tự do ("ổn rồi", "ok") **không** phải lệnh duyệt; nhắc người dùng gõ đúng lệnh.

## 1. Chuẩn bị

1. In lại cách hiểu: book, phạm vi, batch-size (mặc định **3**, tối đa 3), có `--auto` không, có phải đang resume không.
2. **Raw:** mọi chương trong phạm vi phải có `raw = DONE`.
   - Chương `raw_status = SUSPECT` phải có `suspect_accepted` (contract mục 4). Chưa có thì hỏi người dùng một lần, kèm lý do SUSPECT trong manifest và `reviews/ingest-review.md` nếu có; đồng ý thì ghi lại.
   - `FAILED`, `BLOCKED` hay thiếu thì **dừng** và liệt kê. Không bịa nội dung thiếu.
3. **Không dồn việc:**
   - Batch `PENDING_USER_APPROVAL` (Editor PASS, edit-check PASS) **không** chặn dịch tiếp. Người dùng duyệt gộp theo chặng (mục 6.2). Nếu có từ 4 batch trở lên đang chờ, nhắc một dòng: nên `approve` gộp.
   - Có batch `NEEDS_REWORK` thì dừng và nhắc xử lý trước (trừ khi phạm vi trùng đúng batch đó, tức đang làm lại).
   - Có chương cần sync (mục 6.5: `context_version` nhỏ hơn hiện tại) **trong 3 chương liền trước** phạm vi: chạy `sync` cho chúng trước, để bản dịch mới đọc đúng giọng đã chốt.
4. **Thể loại (`book.yaml → genre`):** mỗi giá trị (chuỗi hoặc danh sách) phải có `prompts/modules/<giá trị>.md` (`ls`); riêng `none` nghĩa là không nạp module. Thiếu file thì **dừng** và liệt kê các module hiện có.
   - Không có `genre` và context chưa duyệt: hợp lệ, CONTEXT_INIT sẽ đề xuất (mục 2).
   - Không có `genre` mà context đã duyệt: hỏi người dùng một lần, đưa danh sách module; ghi lựa chọn vào `book.yaml` như mục 6.1.
5. **Model và effort** (truyền tham số `model`, `effort` khi gọi Agent):

   | Lần gọi | Mặc định | Ghi đè trong `book.yaml` |
   |---|---|---|
   | translator `CONTEXT_INIT` | **`opus` · `medium`** (luôn truyền rõ) | `models.translator.context_init` |
   | translator `TRANSLATE`, `REDRAFT` | `opus` · `medium` (frontmatter) | `models.translator.translate` |
   | literary-editor (mọi mode) | `opus` · `medium` (frontmatter) | `models.editor.review` |

6. **Chia batch** theo contract mục 1 (mỗi batch ≤ 3 chương). Batch đã ghi trong `status.json` giữ nguyên phạm vi cũ.
   - Không có `--auto`: chỉ xử lý **batch đầu tiên chưa `APPROVED`** trong phạm vi, rồi dừng (mục 5).
   - Có `--auto`: xử lý lần lượt mọi batch chưa xong trong phạm vi (mục 4).
7. **Context sạch trước khi dịch:** nếu `reviews/questions.md` còn câu `OPEN` có `ảnh hưởng: mọi chương`, hoặc `context/*.md` còn mục `## Cần xác nhận` chưa chốt, hỏi người dùng **một lần** trước batch đầu tiên theo mục 6.4 (trả lời gộp). Với `--auto`, hỏi ngay lúc bắt đầu, khi người dùng còn ngồi máy.
8. Với `--auto`: nhắc người dùng nên chạy trong một phiên mới (`/clear` trước) và không để phiên chờ quá 1 giờ giữa chừng (mất cache, tốn usage).

## 2. Context

- `status.json → context.decision != "APPROVED"`:
  - Chưa có `context/proposals/initial/`: gọi **translator** với `model: opus`, `effort: medium`, `MODE: CONTEXT_INIT`. Đưa đường dẫn 3–5 chương đầu của phạm vi (lấy thêm chương liền sau nếu phạm vi ngắn hơn), `book.yaml`, và thư mục đích `context/proposals/initial/`. Chạy `agent-check … --model opus`.
  - Ghi `context.decision = "PENDING_USER_APPROVAL"` và `context.pending_run = { "range": "<a-b>", "batch_size": <n>, "auto": <true|false>, "draft_epub": <true|false> }` (tham số người dùng vừa gõ). Ghi status.
  - Báo cáo:
    - **thể loại** (lấy từ `book.yaml` hay đề xuất mới trong `style-notes.md`, kèm độ chắc);
    - số nhân vật; đại từ ngôi ba của nhân vật chính; cặp xưng hô;
    - thuật ngữ; **địa điểm và bối cảnh lặp lại**;
    - các mục `Cần xác nhận`, nhất là lựa chọn ảnh hưởng mọi chương (vùng từ, giọng kể);
    - đường dẫn file để người dùng sửa tay nếu muốn.
  - Lệnh tiếp: `/novel-translate approve-context <id>`. Lệnh này duyệt rồi **tự dịch tiếp** batch đầu của phạm vi trên; thêm `--no-run` nếu chỉ muốn duyệt.
  - **DỪNG.** Không dịch khi context chưa được duyệt, kể cả với `--auto`.
- Context đã duyệt: dùng `context/*.md` và `context.version` hiện tại.

**Context tạm (provisional):** các file `context/proposals/<bXXXX>.md` của mọi batch **trước** batch hiện tại đang `PENDING_USER_APPROVAL` được truyền cho cả translator lẫn literary-editor như "đề xuất chưa duyệt, dùng tạm để nhất quán". Thứ tự ưu tiên: context (gồm `context/decisions.md`) > đề xuất chưa duyệt.

**Quyết định của người dùng có hiệu lực ngay** (mục 6.4): ghi thẳng vào `context/*.md` và `context/decisions.md`, tăng `context.version`. Không nằm chờ trong proposals.

## 3. Một batch (≤ 3 chương)

Ghi status sau mỗi bước.

**Resume:**
- Bỏ qua chương có `review = DONE` và `raw_hash` lẫn `context_version` khớp hiện tại.
- Chương có v1 hợp lệ (qua mục 3.b) mà chưa `review = DONE`: không dịch lại, đi tiếp từ 3.c.
- Có version đích của Editor nhưng chưa qua 3.e (lượt biên tập bị ngắt): chuyển file đó sang `translated/.history/<tên>.partial`, rồi làm lại 3.c.

**a. Dịch nháp (1 lần gọi cho cả batch):** gọi **translator** (Opus), `MODE: TRANSLATE`, liệt kê các chương cần dịch. Truyền **đúng** danh sách sau:
- mỗi chương: `raw/chapter-NNNN.md` → đích `translated/chapter-NNNN.v1.md`;
- `context/characters.md`, `relationships.md`, `glossary.md`, `style-notes.md`, `decisions.md`, `continuity.md` (nếu có);
- context tạm (mục 2) và `context/proposals/<batch>.md` nếu đã có;
- tóm tắt: 3 mục `## Chương` gần nhất trong `reviews/<batch trước>/summaries.md` (nếu batch trước chưa gộp vào continuity);
- đích tóm tắt `reviews/<batch>/summaries.md`, đích ghi chú `reviews/<batch>/notes.md`, đích đề xuất `context/proposals/<batch>.md`;
- `context_version`.

**Không** truyền thêm cho translator: report của Editor hay Critic, bản dịch đầy đủ của chương khác ("tham khảo giọng văn"), `notes.md`. Kết luận của Editor về đề xuất context đã có trong report thì tóm thành vài dòng ngay trong prompt, không đưa cả file.

Ghi status từng chương: `translation = DONE`, `versions.v1 = { role: "draft", by: "translator" }`, `current_version = v1`, `context_version`, `batch`.

**b. Kiểm tra cấu trúc bằng shell** (contract mục 6) cho từng v1: số đoạn raw so với bản dịch; chữ Hán sót; ghi chú lọt vào truyện; tiêu đề.
- Lỗi **cục bộ** (lệch hoặc sót vài đoạn, vài chữ Hán, một dòng ghi chú): ghi lại, chuyển cho Editor ở bước c.
- Lỗi **toàn chương** (sai chương, thiếu trên 20% số đoạn, file rỗng hoặc hỏng): gọi translator `MODE: REDRAFT` **một lần cho mọi chương lỗi**, đích `v1` mới (chuyển file hỏng sang `.history/<tên>.broken` trước), kèm chính lỗi đó. Vẫn hỏng thì `review = FAILED`, ghi lý do; các chương còn lại vẫn đi tiếp.

**c. Chuẩn bị biên tập:** `npm run -s novel -- edit-prep books/<id> --batch <batch> --chapters <a,b,c> --from v1 --to v2`.
- Lệnh này sao chép v1 → v2 (bản làm việc của Editor) và chụp hash của raw, mọi version cũ, `context/**`, summaries, notes vào `reviews/<batch>/edit-guard.json`.
- Lệnh báo v2 đã tồn tại: xử lý như Resume ở trên rồi chạy lại.

**d. Review và biên tập (1 lần gọi):** gọi **literary-editor** (Opus) `MODE: REVIEW_EDIT`. Truyền:
- mỗi chương: raw và **bản làm việc** `translated/chapter-NNNN.v2.md` (không truyền v1);
- kết quả kiểm tra cấu trúc ở bước b (nếu có lỗi cục bộ);
- context đã duyệt, context tạm, `context/proposals/<batch>.md`, tóm tắt 3 chương trước, `context_version`;
- đích report `reviews/<batch>/editor-batch.md`.

Chạy `agent-check … --model opus`.

**e. Kiểm tra sau biên tập:** `npm run -s novel -- edit-check books/<id> --batch <batch> --report reviews/<batch>/editor-batch.md`.
- Mã 0 (`EDIT-CHECK: PASS`): sang bước f. In các dòng `WARN` vào báo cáo cuối.
- Mã 2 (`FAIL`) chỉ vì **số đoạn ghi sai trong change log** (cặp `change ID trỏ tới đoạn không đổi: X→đk` và `đoạn đổi không có change ID: j`, nội dung sửa đúng chỗ theo raw): gửi `SendMessage` cho chính Editor đó, yêu cầu **chỉ** sửa số đoạn trong report, rồi chạy lại `edit-check`. Không bỏ bản làm việc.
- Mã 2 (`FAIL`) khác:
  - **File được bảo vệ bị đổi** (raw, v1, context…): **dừng**, báo người dùng đúng file bị đổi; không tự khôi phục, không gọi lại.
  - **Lỗi khác** (đoạn đổi không có change ID, lệch số đoạn, report thiếu mục): chuyển v2 sang `translated/.history/<tên>.invalid`, chuyển report sang `<tên>.invalid.md`, chạy lại bước c và gọi lại Editor **một lần**, kèm nguyên văn các dòng `FAIL`. Vẫn FAIL thì các chương đó `review = BLOCKED`, `current_version = v1`, ghi lý do.

**f. Chương REDRAFT** (Editor ghi ở dòng `Chương:`):
- Chuyển v2 của chương đó sang `.history/<tên>.redraft-source`.
- Gọi translator `MODE: REDRAFT` **một lần**: raw, report `editor-batch.md` làm chỉ dẫn, đích `v3`.
- Kiểm tra cấu trúc v3 (bước b). Rồi `edit-prep --from v3 --to v4`, gọi Editor `REVIEW_EDIT` cho riêng chương đó với report đích `reviews/<batch>/editor-redraft.md`, rồi `edit-check` với report đó.
- Vẫn REDRAFT hoặc FAIL thì chương đó `editor_verdict = REWORK`, `current_version` giữ bản hợp lệ gần nhất, đưa vào `open_issues`.

**g. Chốt batch:** sau khi ghi status, chạy `npm run -s novel -- tidy books/<id> --chapters <a,b,c>` (chuyển version trung gian khác v1, `current_version`, `approved_version` sang `translated/.history/`). Rồi chép mục `## Câu hỏi cho người dùng` của report vào `reviews/questions.md` (mục 6.4). Mỗi chương:
- `review = DONE`;
- `versions.v2 = { role: "edited", by: "literary-editor", from: "v1", changes: <số change ID> }`;
- `current_version` = version sau biên tập đã qua edit-check (giữ v1 nếu Editor không sửa gì);
- `editor_verdict`, `open_issues` (các mục "Phát hiện không sửa", giữ `scope`).

**Không** đặt `approved_version`. `batches.<batch>`: `editor_verdict` = kết luận Editor, `user_decision = "PENDING_USER_APPROVAL"`. Ghi status.

## 4. Chế độ `--auto`: chạy liền nhiều batch

Sau mục 3.g của một batch, nếu còn batch trong phạm vi thì sang batch kế (mục 3), **không** hỏi người dùng. Dừng khi:
- hết phạm vi;
- còn phát hiện `CRITICAL`/`MAJOR` chưa sửa có `scope: context` (xưng hô, thuật ngữ, quan hệ, bối cảnh chưa chốt): lỗi loại này sẽ lan sang các chương sau;
- Editor nêu đề xuất context `NEEDS_USER` có ảnh hưởng tới các chương sắp dịch (ví dụ đổi xưng hô, đổi tên gọi đã dùng);
- chương `REDRAFT` không đạt, `BLOCKED`, hoặc `edit-check` FAIL do file được bảo vệ bị đổi;
- agent lỗi, sai model, chạy nền chưa xác nhận đã xong (`agent-check` mã 2), hết usage, hoặc chương thiếu raw (mục 7).

Không tự duyệt, không gộp context vào `context/*.md`, không tăng `context.version` trong lúc chạy. Mọi batch dừng ở `PENDING_USER_APPROVAL`.

## 5. Báo cáo và DỪNG (Human Approval Checkpoint)

Tùy chọn `--draft-epub`: xuất `output/<id>.draft.epub` theo `rules/epub-export.md` (bản đọc thử, `current_version` của các chương đã dịch).

Một batch (không `--auto`). Lấy số liệu từ dòng đầu và mục "Thay đổi quan trọng" của report; không đọc lại cả report nếu không cần:
```
Batch <bNNNN> (ch a–b) · Editor: PASS | REWORK | LIMITED_PASS · edit-check: PASS
- Bản nháp (Translator · Opus): translated/chapter-NNNN.v1.md …
- Sau biên tập (Editor · Opus): translated/chapter-NNNN.v2.md … · đoạn đã sửa: chN x/y …
- Thay đổi quan trọng: 3–5 dòng (ID · chương/đoạn · trước → sau ngắn · căn cứ)
- Không sửa: … (ID, scope)
- Câu hỏi đang mở: n (mới n) · `reviews/questions.md` · trả lời: `/novel-translate answer <id>`
- Đề xuất context: n mục · ACCEPT n · REJECT n · NEEDS_USER n
- Cảnh báo edit-check: … (nếu có)
- Nên đọc thử: ch … (lý do: đổi xưng hô, nhiều sửa, cảnh khó, REDRAFT)
- [EPUB đọc thử: output/<id>.draft.epub]
- Agent: translator <agentId> (<model>) · literary-editor <agentId> (<model>) · usage theo `agent-check` (cache read · cache write · output)
Report: reviews/<bNNNN>/editor-batch.md
Duyệt:  /novel-translate approve <id> <bNNNN>   (hoặc duyệt gộp theo chặng: <bđầu>-<bcuối>)
Sửa:    /novel-translate rework <id> <bNNNN> "<ghi chú | revert E-ch0007-03 | dùng bản nháp ch7>"
Tiếp:   /novel-translate <id> --range <a-b>   (batch đang chờ duyệt không chặn)
```

`--auto`: một bảng `| Batch | Chương | Editor | Số sửa | Issue mở | NEEDS_USER |`, rồi lý do dừng (hết phạm vi hoặc điều kiện dừng nào, ở batch nào), danh sách "Nên đọc thử", và lệnh duyệt gộp `/novel-translate approve <id> <bđầu>-<bcuối>`.

**DỪNG.** Không tự duyệt, không tự finalize.

## 6. Lệnh con của người dùng

### 6.1 `approve-context <book-id> [--no-run]`

- Chỉ chạy khi `context.decision = PENDING_USER_APPROVAL`.
- Chép `context/proposals/initial/*.md` sang `context/` (giữ các phần người dùng đã sửa tay).
- `book.yaml` chưa có `genre` và `style-notes.md` có mục `## Thể loại`:
  - in giá trị đề xuất; người dùng đã gõ `approve-context` nghĩa là đồng ý;
  - thêm **một dòng** `genre: <giá trị>` vào cuối `book.yaml`, giữ nguyên mọi dòng khác (đọc lại file để xác nhận);
  - với `genre: none`, báo thêm rằng truyện sẽ được dịch chỉ với master và context.
- Đặt `context.version = 1` (hoặc +1), `decision = APPROVED`, `decided_by = "user"`, `decided_at`. Ghi status.
- **Chạy tiếp:**
  - có `context.pending_run` và **không** có `--no-run`: in lại phạm vi sẽ dịch, xóa `pending_run`, ghi status, rồi làm như người dùng vừa gõ `/novel-translate <id> --range <range> [--batch-size n] [--auto] [--draft-epub]` (mục 1 → 3 → 5, dừng ở checkpoint của batch);
  - có `--no-run` hoặc không có `pending_run`: báo `gõ /novel-translate <id> --range … để dịch` rồi dừng.

### 6.2 `approve <book-id> <bNNNN>` hoặc `<bNNNN-bMMMM>`

- Xử lý các batch theo thứ tự tăng dần. Chỉ batch đang `PENDING_USER_APPROVAL`; batch khác trạng thái thì bỏ qua và báo. Nếu có `open_issues` CRITICAL/MAJOR: in danh sách (theo batch) và hỏi xác nhận rõ ràng **một lần** cho cả phạm vi.
- Mỗi chương: `approved_version = current_version`.
- Lưu trữ version cũ (contract mục 3.8): mỗi chương, chuyển mọi `translated/chapter-NNNN.v*.md` **khác** `approved_version` sang `translated/.history/` (`mkdir -p`, `mv`; không xóa). Trong `translated/` chỉ còn bản đã duyệt. Giữ nguyên `versions` trong status. Báo số file đã chuyển.
- Gộp context đã duyệt (theo thứ tự batch):
  - quyết định của người dùng đã nằm trong `context/` từ lúc trả lời (mục 6.4). Batch cũ còn mục `## Quyết định của người dùng` trong proposals mà `context/decisions.md` chưa có thì gộp nốt;
  - mục ACCEPT (theo kết luận của Editor trong `editor-batch.md`/`editor-rework.md`, hoặc `critic-batch.md` với batch cũ) trong `context/proposals/<batch>.md` vào `context/*.md`; mục `NEEDS_USER` chưa trả lời thì chuyển vào `reviews/questions.md`, không chặn duyệt;
  - nối `reviews/<batch>/summaries.md` vào `context/continuity.md`;
  - nếu context đổi thì `context.version += 1` **một lần** cho cả lệnh.
- Mỗi batch: ghi `reviews/<batch>/user-decision.md` (ngày, quyết định, mục context được nhận). `user_decision = APPROVED`, `decided_by = "user"`, `decided_at`. Ghi status.
- Nếu `context.version` tăng: chạy `term-scan`; chương có ứng viên hoặc nằm trong phạm vi quyết định mới thì báo "cần sync" (mục 6.5). Không dịch lại.

### 6.3 `rework <book-id> <bNNNN> "ghi chú"`

- `user_decision = NEEDS_REWORK`, `rework_notes = ghi chú`. Ghi status và `user-decision.md`.
- **Không gọi Translator** (trừ khi ghi chú yêu cầu dịch lại cả chương: khi đó dùng mục 3.f).
- `"dùng bản nháp chN"`: đặt `current_version` của chương đó về version `role: draft` gần nhất (không gọi agent); ghi status; báo cáo như mục 5.
- Các ghi chú khác (sửa nội dung, đồng bộ giọng hay từ vựng, `revert E-…`), cho đúng các chương ghi chú nêu (hoặc cả batch nếu ghi chú áp cho cả batch):
  0. Ghi chú là **quyết định từ vựng/xưng hô** áp được cho nhiều chương (ví dụ "đổi X thành Y"): ghi như một câu trả lời (mục 6.4) rồi chạy `sync` (mục 6.5) thay vì rework từng batch.
  1. `edit-prep --batch <batch> --chapters <…> --next` (mỗi chương từ `current_version` sang version trống kế tiếp; các chương có thể khác version);
  2. gọi **literary-editor** `MODE: REWORK`. Truyền: ghi chú (là issue có bằng chứng), raw, bản làm việc, report trước của batch, context, và bản nháp v1 nếu ghi chú có `revert`. Đích report **luôn** `reviews/<batch>/editor-rework.md` (Editor nối `# Vòng N` nếu đã có);
  3. `edit-check` với report đó; xử lý FAIL như mục 3.e;
  4. `versions.<vN> = { role: "rework", by: "literary-editor", from: <current>, changes: n }`; chốt như mục 3.g (gồm `tidy` và chép câu hỏi) và báo cáo như mục 5.
- Tối đa 2 vòng cho mỗi ghi chú; sau đó dừng và đưa report cho người dùng.

### 6.4 Câu hỏi và quyết định (`answer <book-id>`, hoặc ở checkpoint)

**Hàng đợi:** `books/<id>/reviews/questions.md`, một file cho cả truyện. Main chép vào đó:
- mục `## Câu hỏi cho người dùng` của mọi report Editor (sau 3.g, 6.3, 6.5);
- mục `[Cần xác nhận]` mới trong `context/proposals/<batch>.md` của Translator;
- mục NEEDS_USER chưa trả lời khi `approve`.

Định dạng mỗi câu (giữ id của Editor; trùng nội dung thì gộp vị trí):
```
## Q-0007-01 · OPEN · ảnh hưởng: mọi chương | ch7
- câu hỏi: … · vị trí: ch7 đ58 · nguồn: «…»
- lựa chọn: A | B · đề xuất: A · đang dùng tạm: A
```

**Hỏi:** ở checkpoint (mục 5) hoặc khi người dùng gõ `answer`, hỏi **mọi** câu `OPEN` bằng `AskUserQuestion` (tối đa 4 câu mỗi lần gọi, gọi liên tiếp nếu nhiều hơn; mỗi câu tự đủ nghĩa, lựa chọn đề xuất đặt đầu). Người dùng trả lời tự do trong chat cũng được.

**Ghi quyết định (hiệu lực ngay, không chờ approve):**
1. `context/decisions.md`: nối `## U<n>. <tóm tắt> (người dùng, <ngày>, context v<mới>)` kèm câu trả lời nguyên văn và phạm vi (mọi chương | chương nào). Số `U` tiếp số lớn nhất đã có (kể cả trong proposals cũ).
2. Cập nhật file context liên quan: thuật ngữ, từ vựng vùng miền → `glossary.md` (từ cấm ở **mọi** ngữ cảnh ghi vào bảng của mục `## Từ vựng đã chốt (term-scan)` trong glossary: `| Gốc | Đúng | Cấm (scan) | Quyết định |`, để `term-scan` bắt được; chỉ ghi cụm đủ dài để không bắt nhầm, ví dụ "thái lát", không ghi "thái". Biến thể chỉ sai theo ngữ cảnh thì để ở cột "Biến thể cấm" thường, không quét); xưng hô → `relationships.md`; giọng văn → `style-notes.md`.
3. Câu hỏi: `OPEN` → `ANSWERED (U<n>)`.
4. `context.version += 1` **một lần** cho cả lượt trả lời; `context.decided_by = "user"`, `decided_at`. Ghi status.
5. Chạy `npm run -s novel -- term-scan books/<id>`; nếu có chương đã dịch bị ảnh hưởng (ứng viên, hoặc phạm vi quyết định nêu rõ), chạy ngay `sync` (mục 6.5) cho các chương đó. Câu trả lời của người dùng chính là chỉ thị sửa.

### 6.5 `sync <book-id> [--range a-b] ["ghi chú"]`: áp quyết định lên chương đã dịch

Thay cho rework từng batch khi một quyết định chạm nhiều chương.

1. **Phạm vi:** chương đã dịch (có `current_version`) trong `--range` (mặc định: tất cả) có `context_version` < `context.version` hiện tại, cộng chương có ứng viên `term-scan`, cộng chương ghi chú nêu. Quyết định cần áp cho mỗi chương = các mục `U` trong `context/decisions.md` có version lớn hơn `context_version` của chương (cộng ghi chú).
2. Chia nhóm ≤ 6 chương (theo thứ tự). Mỗi nhóm:
   - `npm run -s novel -- edit-prep books/<id> --batch sync --chapters <…> --next`;
   - gọi **literary-editor** `MODE: SYNC`: các mục `U` cần áp (trích nguyên văn), dòng `term-scan` của các chương đó, mỗi chương raw + bản làm việc, context; đích report `reviews/sync/editor-sync.md`;
   - `agent-check`, rồi `edit-check books/<id> --batch sync --report reviews/sync/editor-sync.md`; FAIL xử lý như 3.e;
   - mỗi chương: `versions.<vN> = { role: "sync", by: "literary-editor", from: <cũ>, changes: n }`, `current_version`, `context_version = context.version`; batch của chương đó đã `APPROVED` mà chương có đổi thì đặt lại `user_decision = PENDING_USER_APPROVAL` (ghi lý do "sync U…"). Ghi status; `tidy`; chép câu hỏi mới.
   - Chương không cần sửa (Editor không đổi đoạn nào): chỉ cập nhật `context_version`.
3. Báo cáo: bảng `| Chương | Version | Số sửa | Quyết định áp |`, câu hỏi mới, cảnh báo edit-check.

## 7. Lỗi, gián đoạn, hạn mức

- Agent lỗi, hết usage hoặc bị ngắt: status đã ghi tới bước gần nhất; giữ mọi file; báo người dùng **chính xác** đang dừng ở batch nào, bước nào. Chạy lại cùng lệnh để tiếp tục (mục 3, Resume). Không có retry chạy ngầm.
- Rework tốn nhiều lượt: dừng và đưa report cho người dùng; **không** hạ tiêu chuẩn để cho qua.
- Batch cũ (trước D-16) có `critic-batch.md`, `revalidate-*.md` và `critic_verdict`: vẫn hợp lệ; đọc như kết luận của reviewer khi `approve`.
- Không có Git, không gọi API trả phí, không chạy nền.
