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

Công cụ ngoài (cài khi tới slice tương ứng): `gpg`, `git-remote-gcrypt` (repo dữ liệu mã hóa), `pandoc` + `epubcheck` (Slice 5). Adapter 69shuba dùng Google Chrome có sẵn trên máy (`channel: "chrome"`).

## Hai repo

| Repo | Nội dung | Remote |
|---|---|---|
| `novel-translator/` (repo này) | Code, agents, skills, rules, fixture tổng hợp | GitHub private |
| `../novel-books/<book-id>/` | Raw, bản dịch, review, context của từng truyện | `gcrypt::` lên GitHub private (đã mã hóa) |

## Trạng thái
Slice 1 — ingest (TypeScript): đang dựng khung; golden test đỏ cho tới khi port xong.
