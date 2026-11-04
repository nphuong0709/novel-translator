---
name: novel-translate
description: Dịch một phạm vi chương sang tiếng Việt với Translator, Critic độc lập, sửa theo issue, review batch và điểm dừng để người dùng duyệt. Có lệnh con approve, rework, approve-context. Chỉ chạy khi người dùng gõ /novel-translate.
disable-model-invocation: true
argument-hint: "<book-id> --range 1-10 [--batch-size 10] [--draft-epub]  |  approve <book-id> <bNNNN>  |  rework <book-id> <bNNNN> \"ghi chú\"  |  approve-context <book-id>"
allowed-tools: Read, Write, Grep, Glob, Agent, Bash(awk:*), Bash(perl:*), Bash(grep:*), Bash(shasum:*), Bash(ls:*), Bash(mkdir:*), Bash(pandoc:*), Bash(epubcheck:*), Bash(unzip:*)
---

# /novel-translate: dịch, review, dừng để người dùng duyệt

Tham số người dùng: `$ARGUMENTS`

**Không bao giờ** crawl, không xuất EPUB cuối, không chạy Git. Main chỉ **điều phối**: đọc contract và status, chuyển đường dẫn cho agent, lưu report, ghi status. **Không** tự đọc các master prompt (agent tự đọc), để giữ context của main nhỏ.

Đọc trước: `rules/artifact-contract.md`, `books/<id>/book.yaml`, `manifest.json`, `status.json`.

## 0. Chọn lệnh

| Lệnh | Đi tới |
|---|---|
| `<book-id> --range a-b …` | mục 1 |
| `approve-context <book-id>` | mục 6.1 |
| `approve <book-id> <bNNNN>` | mục 6.2 |
| `rework <book-id> <bNNNN> "ghi chú"` | mục 6.3 |

Lệnh `approve*` **chỉ** chạy khi chính người dùng gõ trong tin nhắn hiện tại. Không bao giờ tự gọi, kể cả khi Critic `PASS`.

## 1. Chuẩn bị

1. In lại cách hiểu: book, phạm vi, batch-size (mặc định 10), có phải đang resume không.
2. **Raw:** mọi chương trong phạm vi phải có `raw = DONE`. Chương `raw_status = SUSPECT` phải có `suspect_accepted` (contract mục 4). Chưa có thì hỏi người dùng một lần, kèm lý do SUSPECT trong manifest và `reviews/ingest-review.md` nếu có; đồng ý thì ghi lại. `FAILED`, `BLOCKED` hay thiếu thì **dừng** và liệt kê. Không bịa nội dung thiếu.
3. **Không dồn việc:** có batch khác đang `PENDING_USER_APPROVAL` hoặc `NEEDS_REWORK` thì dừng và nhắc người dùng xử lý batch đó trước (trừ khi phạm vi trùng đúng batch đó, tức đang làm lại).
4. **Model:** mặc định theo frontmatter agent (Opus · medium). `book.yaml` có `models.translator` / `models.critic` thì truyền `model` và `effort` khi gọi agent.
5. **Chia batch** theo contract mục 1. Chỉ xử lý **batch đầu tiên chưa `APPROVED`** trong phạm vi. Sau batch đó thì dừng (mục 5), kể cả khi phạm vi còn chương.

## 2. Context

- `status.json → context.decision != "APPROVED"`:
  - Chưa có `context/proposals/initial/`: gọi **translator**, `MODE: CONTEXT_INIT`, đưa đường dẫn 3–5 chương đầu của phạm vi, `book.yaml`, và thư mục đích `context/proposals/initial/`.
  - Đặt `context.decision = "PENDING_USER_APPROVAL"`, ghi status.
  - Báo cáo: số nhân vật, cặp xưng hô, thuật ngữ, các mục `Cần xác nhận`; đường dẫn file để người dùng sửa tay nếu muốn. Lệnh tiếp: `/novel-translate approve-context <id>`.
  - **DỪNG.** Không dịch khi context chưa được duyệt.
- Context đã duyệt: dùng `context/*.md` và `context.version` hiện tại.

## 3. Mỗi chương (tuần tự; mọi lần gọi agent đều **foreground**, `run_in_background: false`, chờ xong mới sang bước sau)

**Resume:** bỏ qua chương có `review = DONE` và `raw_hash` lẫn `context_version` khớp hiện tại. Chương có file mà status chưa `DONE`: kiểm file (mục 3.b) rồi làm tiếp từ bước dang dở, không dịch lại nếu v1 hợp lệ.

**a. Dịch:** gọi **translator**, `MODE: TRANSLATE`. Truyền:
- `raw/chapter-NNNN.md`;
- đích `translated/chapter-NNNN.v1.md`;
- `context/characters.md`, `relationships.md`, `glossary.md`, `continuity.md`, `reviews/<batch>/summaries.md`;
- đích tóm tắt: `reviews/<batch>/summaries.md` (nối thêm mục `## Chương N`);
- đích ghi chú: `reviews/<batch>/notes.md`;
- đích đề xuất context: `context/proposals/<batch>.md`;
- `context_version`.

Ghi status: `translation = DONE`, `versions += v1`, `current_version = v1`, `context_version`, `batch`.

**b. Kiểm tra nhanh** (contract mục 6): số đoạn raw so với bản dịch; chữ Hán sót; ghi chú lọt vào truyện; tiêu đề.
- Không đạt: gọi lại translator `MODE: FIX` với chính lỗi đó (không có issue của Critic); tối đa 1 lần.
- Vẫn không đạt: `review = FAILED`, ghi lý do, sang chương kế.

**c. Review:** gọi **critic**, `MODE: CHAPTER`. Truyền: raw, bản dịch hiện hành, context, 3 mục tóm tắt trước, `context_version`.
- Lưu nguyên văn report vào `reviews/<batch>/critic-chapter-NNNN.md`.
- Report thiếu dòng `Đã áp dụng:` hoặc thiếu `VERDICT`: gọi lại một lần; vẫn thiếu thì `review = FAILED`.

**d. Sửa (contract mục 7):** có issue `CRITICAL`/`MAJOR` (và `MINOR` theo chính sách):
- gọi **translator** `MODE: FIX` với danh sách issue ID, report, version hiện hành, đích `chapter-NNNN.v<n+1>.md`;
- chạy lại kiểm tra nhanh (mục b);
- gọi **critic** `MODE: REVALIDATE` (issue gốc, đoạn trước và sau khi sửa, đoạn nguyên tác), lưu `revalidate-chapter-NNNN.md`;
- tối đa 2 vòng; vẫn còn `CRITICAL`/`MAJOR` thì `critic_verdict = REWORK` và đưa vào `open_issues`.

**e. Chốt chương:** `review = DONE`, `critic_verdict`, `open_issues`, `current_version`. **Không** đặt `approved_version`. Ghi status rồi mới sang chương kế.

## 4. Review batch (bắt buộc, kể cả batch 1–2 chương)

1. Gọi **critic** `MODE: BATCH`. Truyền: `reviews/<batch>/summaries.md`, context, mọi `critic-chapter-*` và `revalidate-*` của batch, `context/proposals/<batch>.md`, danh sách version hiện hành. Critic được tự đọc toàn văn đoạn liên quan khi nghi mâu thuẫn. Lưu `reviews/<batch>/critic-batch.md`.
2. Có issue cần sửa: chỉ gọi **translator** `MODE: FIX` cho đúng chương và đoạn bị nêu (version mới), kiểm tra nhanh, rồi gọi **critic** `MODE: REVALIDATE` cho các đoạn đó. Lưu `revalidate-batch.md`. Giới hạn như mục 3.d.
3. Batch có chương bị sửa sau khi đã review thì cập nhật `current_version` của chương đó.
4. `batches.<batch>.critic_verdict` = kết luận Critic; `user_decision = "PENDING_USER_APPROVAL"`. Ghi status.

## 5. Báo cáo và DỪNG

Tùy chọn `--draft-epub`: xuất `output/<id>.draft.epub` theo `rules/epub-export.md` (bản đọc thử, các chương đã dịch tới thời điểm này).

```
Batch <bNNNN> (ch a–b) · Critic: PASS | REWORK | LIMITED_PASS
- Chương xử lý: n (FAILED: …)
- Lỗi quan trọng phát hiện: CRITICAL n · MAJOR n — 3–5 ví dụ ngắn kèm file
- Đã sửa và đã revalidate: n / n
- Chưa giải quyết: … (chương, issue ID)
- Đề xuất context: n mục (context/proposals/<batch>.md), Critic: ACCEPT n · REJECT n · NEEDS_USER n
- Nên đọc thử: ch … (lý do: đổi xưng hô, cảnh khó, issue mở)
- [EPUB đọc thử: output/<id>.draft.epub]
Duyệt:  /novel-translate approve <id> <bNNNN>
Sửa:    /novel-translate rework <id> <bNNNN> "<ghi chú>"
```

**DỪNG.** Không tự chạy batch kế tiếp, không tự duyệt, không tự finalize.

## 6. Lệnh con của người dùng

### 6.1 `approve-context <book-id>`

- Chỉ chạy khi `context.decision = PENDING_USER_APPROVAL`.
- Chép `context/proposals/initial/*.md` sang `context/` (giữ các phần người dùng đã sửa tay).
- Đặt `context.version = 1` (hoặc +1), `decision = APPROVED`, `decided_by = "user"`, `decided_at`. Ghi status.
- Báo: gõ lại `/novel-translate <id> --range …` để dịch.

### 6.2 `approve <book-id> <bNNNN>`

- Chỉ chạy khi batch đang `PENDING_USER_APPROVAL`. Nếu có `open_issues` CRITICAL/MAJOR: in danh sách và hỏi xác nhận rõ ràng một lần nữa.
- Mỗi chương: `approved_version = current_version`.
- Gộp context đã duyệt:
  - mục ACCEPT trong `context/proposals/<batch>.md` vào `context/*.md`; mục `NEEDS_USER` thì hỏi từng mục;
  - nối `reviews/<batch>/summaries.md` vào `context/continuity.md`;
  - nếu context đổi thì `context.version += 1`.
- Ghi `reviews/<batch>/user-decision.md` (ngày, quyết định, mục context được nhận). `user_decision = APPROVED`, `decided_by = "user"`. Ghi status.
- Nếu `context.version` tăng: báo các chương đã dịch nhưng chưa duyệt sẽ thành STALE, để người dùng quyết định.

### 6.3 `rework <book-id> <bNNNN> "ghi chú"`

- `user_decision = NEEDS_REWORK`, `rework_notes = ghi chú`. Ghi status và `user-decision.md`.
- Ngay sau đó, chỉ xử lý những chương hoặc đoạn mà ghi chú nêu:
  - gọi translator `MODE: FIX`, truyền ghi chú của người dùng như một issue có bằng chứng;
  - kiểm tra nhanh;
  - gọi critic `MODE: REVALIDATE`;
  - quay lại mục 4.2–5.

## 7. Lỗi, gián đoạn, hạn mức

- Agent lỗi, hết usage hoặc bị ngắt: status đã ghi tới chương hoặc bước gần nhất; giữ mọi file; báo người dùng **chính xác** đang dừng ở đâu. Chạy lại cùng lệnh để tiếp tục. Không có retry chạy ngầm.
- Rework tốn nhiều lượt: dừng và đưa report cho người dùng; **không** hạ tiêu chuẩn để cho qua.
- Không có Git, không gọi API trả phí, không chạy nền.
