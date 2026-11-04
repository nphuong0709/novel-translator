# novel-translator

Framework cá nhân dịch tiểu thuyết EN/ZH sang tiếng Việt bằng Claude Code (3 subagent: translator, chapter-critic 2 vòng + hồi quy, consistency-critic), xuất EPUB. Mọi stage đều được commit Git.

- Thiết kế: [docs/blueprint-v4.md](docs/blueprint-v4.md)
- Quirk của các nguồn (bài học từ bản V1): [docs/source-quirks.md](docs/source-quirks.md)
- Ánh xạ test V1 → TS: [docs/test-mapping.md](docs/test-mapping.md)

## Cài đặt

```bash
nvm use            # Node 24
npm install
npm test
```

Công cụ ngoài: Google Drive for desktop (backup qua `novel snapshot`), `pandoc` + `epubcheck` (Slice 5). Adapter 69shuba dùng Google Chrome có sẵn trên máy (`channel: "chrome"`).

## Hai repo

| Repo | Nội dung | Remote |
|---|---|---|
| `novel-translator/` (repo này) | Code, agents, skills, rules, fixture tổng hợp | GitHub private |
| `../novel-books/<book-id>/` | Raw, bản dịch, review, context của từng truyện | Không có remote. Backup: `novel snapshot` → Google Drive `My Drive/novel-backups/<book-id>/` (không mã hóa) |

## Ingest (Slice 1)

```bash
npm run novel -- init   ../novel-books/kzgd --url <url-trang-giới-thiệu> --from 1 --to 201
npm run novel -- ingest ../novel-books/kzgd            # phạm vi lấy từ book.yaml
npm run novel -- ingest ../novel-books/kzgd --from 5 --to 9 --recrawl
npm run novel -- status ../novel-books/kzgd
npm run novel -- import ../novel-books/kzgd --dir <thư-mục-raw-V1>      # nhập <n>.txt có sẵn
npm run novel -- crosscheck ../novel-books/kzgd --v1-raw <thư-mục-raw-V1>
npm run novel -- snapshot ../novel-books/kzgd --stage raw    # tag raw-done + bundle + zip → Drive
```

Khôi phục từ Drive: `git clone <file>.bundle ../novel-books/kzgd` (đủ lịch sử và tag).

- Kết quả: `chapters/NNN/source.md` (frontmatter có hash, parser fingerprint) và `ingest-report.md`. CLI **không** commit; bạn tự xem rồi commit repo dữ liệu.
- 69shuba mở Google Chrome thật với profile trong `.cache/browser-profile/`. Gặp Cloudflare thì bạn tự xác minh trong cửa sổ đó (tool chờ tối đa 300s); `--headless` thì dừng với `BLOCKED`. Tool không tự vượt challenge.
- HTML gốc được cache trong `.cache/html/`: đổi parser hoặc `junkPatterns` thì chạy lại `ingest`, chương được parse lại offline.
- Mã thoát của `ingest`: 0 = ổn, 2 = có chương FAILED, 3 = BLOCKED.

## Môi trường Claude Code

Kết quả kiểm chứng: [docs/capability-verification.md](docs/capability-verification.md) (Claude Code 2.1.317).

**VS Code và config dir.** Extension VS Code chạy binary riêng (không phải `claude` trên PATH) và **không đọc alias shell** như `claude-personal`, nên mặc định dùng `~/.claude`. Muốn dùng config dir khác:

1. Mở User Settings (JSON). Đây là setting cấp máy (`scope: machine`), nên **không** đặt được trong `.vscode/settings.json` của workspace.
2. Thêm (đường dẫn **tuyệt đối**, extension không mở rộng `~`):
   ```json
   "claudeCode.environmentVariables": [
     { "name": "CLAUDE_CONFIG_DIR", "value": "/Users/<bạn>/.claude-personal" }
   ]
   ```
3. Reload Window. Kiểm tra bằng `/status`.

Khôi phục: xóa mục trên rồi Reload Window. Lưu ý: lịch sử, memory và skill nằm theo config dir, nên đổi dir thì không thấy phiên cũ. Agent và skill của framework nằm trong repo (`.claude/`), nên dùng config dir nào cũng giống nhau. CLI trên PATH và extension có thể khác phiên bản (`claude --version`); nên cập nhật cho cùng phiên bản trước khi chạy dịch.

**Tối ưu MCP cho phiên dịch.** Phiên điều phối mang theo định nghĩa của mọi tool đang bật, kể cả MCP connector (Gmail, Drive…). Ở B1, phần cố định này khoảng 30k token mỗi lượt và chiếm 97% chi phí PoC. Trước khi chạy `/translate-batch`:

- `/mcp`: tắt các server/connector không dùng cho dịch.
- `/context`: xem phần nào đang chiếm context.
- Subagent của framework luôn có `tools:` allowlist, nên không nhận các tool MCP này. Chi phí tăng chỉ nằm ở phiên main.
- `--allowedTools` chỉ là danh sách **tự động duyệt**, không giới hạn tool.

Mức tiết kiệm khi tắt MCP chưa được đo; đo ở PoC Slice 2 (blueprint 7.3).

## Trạng thái
Slice 1 (ingest, TypeScript): xong. KZGD 1–201 đã ingest, `content_hash` khớp V1 201/201. B1 (kiểm chứng Claude Code) xong; tiếp theo Slice 2.
