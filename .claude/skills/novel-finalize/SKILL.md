---
name: novel-finalize
description: Review cuối xuyên batch bằng Literary Editor (Opus) độc lập, sửa cục bộ các vấn đề còn tồn tại, dừng để người dùng duyệt thay đổi, rồi xuất EPUB sạch và kiểm tra. Chỉ chạy khi người dùng gõ /novel-finalize.
disable-model-invocation: true
argument-hint: "<book-id> [--range 1-20] [--draft] [--force]"
allowed-tools: Read, Write, Grep, Glob, Agent, Bash(awk:*), Bash(perl:*), Bash(grep:*), Bash(sed:*), Bash(ls:*), Bash(mkdir:*), Bash(rm -f books/*/output/.build/*), Bash(mv books/*/output/*), Bash(pandoc:*), Bash(epubcheck:*), Bash(unzip:*), Bash(basename:*), Bash(npm run -s novel -- edit-prep:*), Bash(npm run -s novel -- edit-check:*), Bash(npm run -s novel -- agent-check:*)
---

# /novel-finalize: review cuối và xuất EPUB

Tham số người dùng: `$ARGUMENTS`

**Không** crawl, không dịch chương chưa có, không chạy Git. Đọc `rules/artifact-contract.md`, `rules/epub-export.md`, `book.yaml`, `manifest.json`, `status.json`.

## 1. Phạm vi và điều kiện

- Phạm vi: `--range` hoặc toàn bộ chương đã có trong `status.json`. In lại cho người dùng.
- **`--draft`:** bỏ qua mục 2–3, xuất `.draft.epub` từ `current_version` (rules/epub-export.md), báo rõ là bản chưa duyệt rồi dừng.
- **Bản cuối** yêu cầu:
  - mọi batch có chương trong phạm vi đều `user_decision = APPROVED`;
  - mọi chương có `approved_version`;
  - không chương nào STALE (contract mục 5).
  Thiếu điều kiện nào thì liệt kê rồi **dừng**.

## 2. Review cuối (foreground, `run_in_background: false`)

1. Gọi **literary-editor** `MODE: FINAL`. Truyền:
   - `context/*.md` (gồm `continuity.md`);
   - mọi `reviews/b*/editor-batch.md` (batch cũ: `critic-batch.md`);
   - các `open_issues` còn lại;
   - danh sách file `approved_version`.
   Đích report `reviews/final/editor-final.md`. Sau khi gọi, chạy `npm run -s novel -- agent-check books/<id> --agent <agentId> --model opus`.
2. **Đoạn mẫu do main chọn**, chỉ đường dẫn và số đoạn:
   - lần đầu xuất hiện mỗi nhân vật chính;
   - các chương có đổi xưng hô theo `relationships.md`;
   - chương có issue mở hoặc đã rework.
3. Lượt này **chưa giao bản làm việc**. Editor chỉ review, ghi `## Vấn đề chặn xuất bản` (kèm chương, đoạn) và `VERDICT`. `final.editor_verdict` = kết luận.
4. Report phải ghi rõ phần soát đầy đủ và phần chỉ soát mẫu. Không có phần này thì gọi lại một lần.

## 3. Sửa vấn đề còn tồn tại (Editor sửa trực tiếp, không gọi Translator)

- Có vấn đề `CRITICAL`/`MAJOR`:
  1. Với các chương bị nêu: `npm run -s novel -- edit-prep books/<id> --batch final --chapters <…> --from <approved_version> --to <vN+1>`.
  2. Gọi **literary-editor** `MODE: FINAL` lần hai, giao **đúng** các bản làm việc đó, report gốc `editor-final.md`, raw tương ứng, context. Đích report `reviews/final/editor-final-edit.md`.
  3. `npm run -s novel -- edit-check books/<id> --batch final --report reviews/final/editor-final-edit.md`. FAIL thì xử lý như `/novel-translate` mục 3.e.
  4. Mỗi chương: `versions.<vN+1> = { role: "final-edit", by: "literary-editor", from: <approved_version> }`, `current_version = vN+1`.
- Chương cần dịch lại cả chương (Editor ghi `REDRAFT`): **không** tự dịch lại ở finalize. Liệt kê và đề nghị người dùng chạy `/novel-translate rework <id> <bNNNN> "dịch lại chN"`.
- **Human Approval Checkpoint:** có bất kỳ thay đổi nào ở bước này thì:
  - batch chứa chương đó quay về `PENDING_USER_APPROVAL`;
  - báo danh sách chương cùng version mới và mục "Thay đổi quan trọng" của report, kèm lệnh `/novel-translate approve <id> <bNNNN>`;
  - **DỪNG**, không xuất EPUB cuối. Chạy lại `/novel-finalize` sau khi người dùng duyệt.
- Không xuất bản cuối khi còn `CRITICAL`/`MAJOR` mở, hoặc khi kết luận FINAL không phải `READY`. `--force` chỉ bỏ qua điều kiện `READY` của Editor (cho phép `NEEDS_REWORK`; không bỏ qua yêu cầu batch `APPROVED`), và phải ghi lý do vào `editor-final.md`.

## 4. Xuất EPUB

Theo `rules/epub-export.md`:
- chọn file `approved_version`;
- chuẩn bị `.build/` (escape Markdown, `metadata.yaml`; thiếu `title_vi` hoặc `author` thì hỏi);
- chạy Pandoc;
- chạy các kiểm tra: epubcheck, số mục lục bằng số chương, Unicode, không lẫn ghi chú.

Thiếu `pandoc` hoặc `epubcheck` thì báo `NOT_IMPLEMENTED`, không khẳng định đã xuất hay đã hợp lệ.

## 5. Chốt và báo cáo

- `final.status = DONE`, `epub_path`, `epubcheck = PASS | FAIL`, ghi status.
- Gợi ý backup (chỉ khi người dùng muốn; không tự upload): `zip -r <Drive>/novel-backups/<id>-<ngày>.zip books/<id> -x 'books/<id>/.cache/*'`.

```
/novel-finalize <id> (ch a–b)
- Editor FINAL: READY | NEEDS_REWORK — phạm vi soát đầy đủ: … · soát mẫu: …
- Đã sửa ở finalize: n (đã được người dùng duyệt) · Còn mở (không chặn): n
- EPUB: books/<id>/output/<id>.epub · epubcheck: PASS · mục lục: n/n chương
- Kiểm tra chưa chạy: … (nếu có)
```

Không Git commit hay push. Không upload.
