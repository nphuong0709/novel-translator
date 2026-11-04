# novel-translator

Framework cá nhân dịch tiểu thuyết EN/ZH sang tiếng Việt bằng Claude Code (subagent dịch, 2 critic độc lập, batch critic, final critic), xuất EPUB. Mọi stage đều được commit Git.

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

## Trạng thái
Slice 1 (ingest, TypeScript): xong. KZGD 1–201 đã ingest, `content_hash` khớp V1 201/201.
