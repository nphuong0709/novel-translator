# novel-translator

Tự động hóa quy trình dịch tiểu thuyết cá nhân EN/ZH → tiếng Việt bằng Claude Code: crawler bằng code, **Translator** và **Critic** độc lập (2 subagent), người dùng duyệt từng batch, xuất EPUB. Toàn bộ dữ liệu ở local, **không dùng Git cho dữ liệu truyện**.

- Thiết kế: [docs/novel_translation_framework_blueprint_simplified.md](docs/novel_translation_framework_blueprint_simplified.md) (lý do: [docs/architecture-review-simplification.md](docs/architecture-review-simplification.md))
- Workflow và quy tắc artifact: [rules/artifact-contract.md](rules/artifact-contract.md), [rules/epub-export.md](rules/epub-export.md)
- Năng lực Claude Code đã kiểm chứng: [docs/capability-verification.md](docs/capability-verification.md)
- Quirk của các nguồn (bài học từ V1): [docs/source-quirks.md](docs/source-quirks.md) · Ánh xạ test V1 → TS: [docs/test-mapping.md](docs/test-mapping.md)

## Cài đặt

```bash
nvm use            # Node 24
npm install
npm test
```

Công cụ ngoài: `pandoc` ≥ 3 và `epubcheck` (xuất EPUB), Google Chrome (adapter 69shuba). Tùy chọn: Google Drive for desktop (backup zip thủ công).

## Workflow (gõ trong Claude Code, mở tại thư mục gốc repo)

```
/novel-crawl kzgd --url <url-trang-giới-thiệu> --range 1-201   # chỉ lấy raw, rồi DỪNG
/novel-translate kzgd --range 1-10                              # lần đầu: dựng context rồi DỪNG
/novel-translate approve-context kzgd                           # bạn duyệt context
/novel-translate kzgd --range 1-10 [--draft-epub]               # dịch, review, sửa, review batch, rồi DỪNG
/novel-translate approve kzgd b0001                             # hoặc: rework kzgd b0001 "ghi chú"
/novel-finalize kzgd --range 1-10                               # review cuối + EPUB
```

| Thành phần | Vai trò |
|---|---|
| Skills (`.claude/skills/`) | Thứ tự bước, chuyển file, điểm dừng |
| Agents (`.claude/agents/`) | `translator` (Opus: dựng context, dịch nháp, REDRAFT), `literary-editor` (Opus: review và sửa cục bộ; REVIEW_EDIT, REWORK, FINAL) |
| Prompts (`prompts/`) | Chất lượng: master prompt V1 nguyên văn, workflow addendum, literary-editor master, module thể loại, chuẩn tiếng Việt |
| Context (`books/<id>/context/`) | Nhân vật, quan hệ và xưng hô theo chương, glossary, tóm tắt |
| Status (`books/<id>/status.json`) | Checkpoint, kết luận của Editor, phê duyệt của bạn (tách nhau) |

- Dừng sau crawl, sau khi dựng context, và sau mỗi batch. Finalize chỉ khi bạn gõ lệnh.
- Bị ngắt hoặc hết usage: gõ lại đúng lệnh; workflow đọc `status.json` và artifact để làm tiếp.
- Prompt dài là có chủ đích; không rút gọn thành vài dòng trong skill.

## CLI crawler (được `/novel-crawl` gọi; chạy tay cũng được)

```bash
npm run novel -- help
npm run novel -- init   books/kzgd --url <url> --from 1 --to 201
npm run novel -- ingest books/kzgd [--from 5 --to 9] [--recrawl] [--headless]
npm run novel -- import books/kzgd --dir <thư-mục-<n>.txt> [--from 1 --to 10]
npm run novel -- status books/kzgd
npm run novel -- crosscheck books/kzgd --v1-raw <thư-mục-raw-V1>
```

- Kết quả: `raw/chapter-NNNN.md` (frontmatter có `content_hash`, parser fingerprint), `manifest.json`, `reviews/ingestion.md`.
- 69shuba mở Google Chrome thật với profile ở `.cache/browser-profile/`. Gặp Cloudflare thì bạn tự xác minh trong cửa sổ đó (tool chờ tối đa 300s); `--headless` thì dừng với `BLOCKED`. Tool không tự vượt challenge.
- HTML gốc được cache ở `.cache/html/`: đổi parser hoặc `junkPatterns` thì chạy lại `ingest`, chương được parse lại offline.
- Mã thoát của `ingest`: 0 = ổn, 2 = có chương FAILED, 3 = BLOCKED.

## Usage gói Claude (Pro)

- Mọi lượt của phiên main **và** của subagent đều tính vào hạn mức gói. Framework không dùng API key trả phí.
- Chạy dịch trong **phiên mới** (`/clear`), không chạy tiếp trong một phiên thiết kế dài. Xem mức tiêu hao bằng `/usage`.
- Bắt đầu với 1–2 chương để đo chất lượng và usage trước khi chạy cả bộ.

## Môi trường Claude Code

**VS Code và config dir.** Extension VS Code chạy binary riêng (không phải `claude` trên PATH) và **không đọc alias shell** như `claude-personal`, nên mặc định dùng `~/.claude`. Muốn dùng config dir khác:

1. Mở User Settings (JSON). Đây là setting cấp máy (`scope: machine`), nên **không** đặt được trong `.vscode/settings.json` của workspace.
2. Thêm (đường dẫn **tuyệt đối**, extension không mở rộng `~`):
   ```json
   "claudeCode.environmentVariables": [
     { "name": "CLAUDE_CONFIG_DIR", "value": "/Users/<bạn>/.claude-personal" }
   ]
   ```
3. Reload Window. Kiểm tra bằng `/status`.

Khôi phục: xóa mục trên rồi Reload Window. Lịch sử, memory và skill cá nhân nằm theo config dir. Agent và skill của framework nằm trong repo (`.claude/`), nên dùng config dir nào cũng giống nhau. CLI trên PATH và extension có thể khác phiên bản (`claude --version`).

**Tối ưu MCP.** Phiên điều phối mang theo định nghĩa của mọi tool đang bật, kể cả MCP connector (Gmail, Drive…). Ở B1, phần cố định này khoảng 30k token mỗi lượt. Trước khi dịch: `/mcp` để tắt connector không dùng, `/context` để xem phần nào chiếm chỗ. Subagent của framework có `tools:` allowlist nên không nhận các tool MCP. `--allowedTools` chỉ là danh sách **tự động duyệt**, không giới hạn tool.

## Bảo mật và bản quyền

- Chỉ ingest, dịch và lưu nội dung bạn có quyền phù hợp. Truy cập công khai không có nghĩa là được phép dịch toàn văn.
- Claude Code gửi nội dung được cung cấp tới model khi bạn gọi lệnh. Framework không upload dữ liệu đi nơi khác.
- `books/` đã có trong `.gitignore`. Nếu từng track file truyện trước đó, `.gitignore` **không** tự bỏ track. Backup `books/` riêng nếu cần (checkpoint không phải backup).

## Trạng thái

Crawler TS xong (KZGD 1–201, `content_hash` khớp V1 201/201). Skills, agents và prompts đã kích hoạt. Tiếp theo: T2, chạy thử `/novel-translate` 1–2 chương.
