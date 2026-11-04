---
name: novel-crawl
description: Lấy nguyên tác bằng crawler code có sẵn (hoặc import file local), kiểm tra và lưu raw. Không dịch. Chỉ chạy khi người dùng gõ /novel-crawl.
disable-model-invocation: true
argument-hint: "<book-id> [--url URL | --dir PATH] [--range 1-10] [--recrawl]"
allowed-tools: Read, Write, Bash(npm run novel:*), Bash(shasum:*), Bash(ls:*)
---

# /novel-crawl: chỉ lấy dữ liệu nguồn, không bao giờ dịch

Tham số người dùng: `$ARGUMENTS`

Đọc `rules/artifact-contract.md` trước. Thư mục truyện là `books/<book-id>/`.

## 1. Hiểu tham số

- Tách `book-id`, nguồn (`--url` hoặc `--dir`), `--range a-b`, `--recrawl`. In lại cách hiểu cho người dùng.
- Thiếu `book-id`, hoặc truyện mới mà không có `--url`/`--dir`: **hỏi lại**, không đoán.
- `--range` không có thì dùng `chapters` trong `book.yaml`; cũng không có thì hỏi.

## 2. Kiểm tra crawler thật

- Chạy `npm run novel -- help` và đọc cú pháp thật. **Chỉ** dùng lệnh và cờ có trong output này.
- Thiếu lệnh cần thiết (ví dụ chưa có `import`, hoặc chưa ghi được `raw/chapter-NNNN.md` và `manifest.json`): báo `NOT_IMPLEMENTED`, kèm chính xác thứ còn thiếu, rồi **dừng**. Không tự viết crawler, không tự tải trang.

## 3. Chạy crawler bằng code

| Trường hợp | Lệnh |
|---|---|
| Truyện mới, nguồn web | `npm run novel -- init books/<id> --url <URL> --from <a> --to <b>`, rồi in `book.yaml` cho người dùng kiểm (adapter, phạm vi) |
| Lấy chương | `npm run novel -- ingest books/<id> --from <a> --to <b> [--recrawl]` |
| File local đã có quyền dùng | `npm run novel -- import books/<id> --dir <PATH> --from <a> --to <b>` |

- Việc tải HTTP, mở trình duyệt, retry, nghỉ giữa request, cache, parse, lọc rác và kiểm tra **đều do code làm**. Claude **không** được tự fetch hay browse chương để thay thế.
- **Không vượt kiểm soát truy cập.** Kết quả `BLOCKED` (Cloudflare, captcha, đăng nhập) thì dừng nguồn đó và báo cho người dùng. Với 69shuba: người dùng có thể **tự** xác minh trong cửa sổ Chrome mà crawler mở ra (crawler chờ tối đa 300s). Không dùng `--headless` khi cần người dùng xác minh.
- `--recrawl` ghi đè raw đã có. Trước khi chạy, liệt kê các chương sẽ bị ghi đè và **hỏi xác nhận**. Sau khi chạy, báo chương nào đổi `content_hash`.
- Crawler trả mã thoát 2 (có chương FAILED) hoặc 3 (BLOCKED): vẫn đọc báo cáo rồi tiếp tục bước 4.

## 4. Kiểm tra kết quả

Đọc `books/<id>/manifest.json` và `reviews/ingestion.md` do crawler sinh. Xác nhận cho **đúng phạm vi yêu cầu**:
- đủ số chương; thứ tự đúng; không trùng chương;
- trạng thái từng chương là `VALID`, `SUSPECT` (kèm lý do), `FAILED` hoặc `BLOCKED`;
- raw có tiêu đề và nội dung (lấy mẫu 1–2 chương đầu và cuối, đọc vài dòng).

Mã HTTP thành công **không** có nghĩa chương hợp lệ; tin vào trạng thái kiểm tra của crawler.

## 5. Cập nhật status

- Chưa có `status.json`: tạo theo `templates/status.example.json`, với `context.version = 0` và `context.decision = "NOT_STARTED"`.
- Với mỗi chương trong phạm vi: `raw = DONE` (VALID/SUSPECT) hoặc `FAILED`/`BLOCKED`; `raw_hash` = `content_hash` trong frontmatter raw.
- Ghi lại cả file `status.json` (contract mục 4).
- Chương đã có bản dịch mà `raw_hash` đổi (sau `--recrawl`): đánh dấu trong báo cáo là **STALE** (contract mục 5). **Không** xóa bản dịch.

## 6. Báo cáo và DỪNG

```
/novel-crawl <id> (ch a–b)
- VALID: n · SUSPECT: n (ch …: lý do) · FAILED: n · BLOCKED: n
- Thiếu: ch …
- Raw đổi hash (STALE nếu đã dịch): ch …
- File: books/<id>/raw/, manifest.json, reviews/ingestion.md
Bước tiếp (tự gõ khi đã kiểm raw): /novel-translate <id> --range a-b
```

**Không** gọi `/novel-translate` hay `/novel-finalize`. Không dùng Git, API key, MCP connector hay upload ra ngoài. Nguồn truy cập được không có nghĩa là có quyền dịch; người dùng chịu trách nhiệm về quyền với nội dung.
