---
name: novel-finalize
description: Review cuối xuyên batch bằng Critic độc lập, sửa các vấn đề còn tồn tại, rồi xuất EPUB sạch và kiểm tra. Chỉ chạy khi người dùng gõ /novel-finalize.
disable-model-invocation: true
argument-hint: "<book-id> [--range 1-20] [--draft] [--force]"
allowed-tools: Read, Write, Grep, Glob, Agent, Bash(awk:*), Bash(perl:*), Bash(grep:*), Bash(sed:*), Bash(ls:*), Bash(mkdir:*), Bash(rm -f books/*/output/.build/*), Bash(mv books/*/output/*), Bash(pandoc:*), Bash(epubcheck:*), Bash(unzip:*), Bash(basename:*)
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

1. Gọi **critic** `MODE: FINAL`. Truyền: `context/*.md` (gồm `continuity.md`), mọi `reviews/b*/critic-batch.md`, các `open_issues` còn lại, danh sách file `approved_version`.
2. **Đoạn mẫu do main chọn**, chỉ đường dẫn và số đoạn:
   - lần đầu xuất hiện mỗi nhân vật chính;
   - các chương có đổi xưng hô theo `relationships.md`;
   - chương có issue mở hoặc đã rework.
3. Lưu nguyên văn report vào `reviews/final/critic-final.md`. `final.critic_verdict` = kết luận.
4. Report phải ghi rõ phần soát đầy đủ và phần chỉ soát mẫu. Không có phần này thì gọi lại một lần.

## 3. Sửa vấn đề còn tồn tại

- Issue `CRITICAL`/`MAJOR`:
  - gọi **translator** `MODE: FIX` cho đúng chương và đoạn, tạo version mới;
  - kiểm tra nhanh (contract mục 6);
  - gọi **critic** `MODE: REVALIDATE` cho các đoạn đó, cùng các chỗ khác có cùng tên hoặc thuật ngữ bị sửa. Lưu `reviews/final/revalidate-final.md`.
- Thay đổi chạm vào chương đã được người dùng duyệt:
  - batch đó quay về `PENDING_USER_APPROVAL`;
  - báo danh sách chương cùng version mới, kèm lệnh `/novel-translate approve <id> <bNNNN>`;
  - **DỪNG**, không xuất EPUB cuối.
- Không xuất bản cuối khi còn `CRITICAL`/`MAJOR` mở, hoặc khi kết luận FINAL không phải `PASS`. `--force` chỉ bỏ qua điều kiện `PASS` của Critic (cho phép `LIMITED_PASS`/`REWORK`; không bỏ qua yêu cầu batch `APPROVED`), và phải ghi lý do vào `critic-final.md`.

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
- Critic FINAL: PASS | LIMITED_PASS | REWORK | BLOCKED — phạm vi soát đầy đủ: … · soát mẫu: …
- Đã sửa và revalidate: n · Còn mở (không chặn): n
- EPUB: books/<id>/output/<id>.epub · epubcheck: PASS · mục lục: n/n chương
- Kiểm tra chưa chạy: … (nếu có)
```

Không Git commit hay push. Không upload.
