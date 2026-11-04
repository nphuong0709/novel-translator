# CLAUDE.md — novel-translator

Framework cá nhân: nguồn EN/ZH → tiếng Việt → EPUB, chạy local bằng Claude Code.
Thiết kế: `docs/blueprint-v4.md`. Kiến thức từ bản V1: `docs/source-quirks.md`.

## Quy tắc bắt buộc
- Trả lời bằng tiếng Việt; giữ nguyên thuật ngữ kỹ thuật tiếng Anh.
- **Repo này không chứa text truyện.** Dữ liệu truyện nằm ở `../novel-books/<book-id>/` (repo riêng, remote gcrypt). Không copy raw, bản dịch hay review vào đây. Fixture trong `tests/fixtures` phải là câu văn tự viết.
- Không commit `.env`, `token.json`, `credentials.json`, `.cache/`, browser profile, `*.epub`.
- Truy cập nguồn: cho phép người dùng **tự** xác minh Cloudflare trong trình duyệt thật. **Không** tự động giải challenge hay CAPTCHA, không stealth hay giả fingerprint, không xoay proxy.
- Ingest do code làm; LLM không tự đi tải chương.
- Hành vi ingest phải khớp `tests/golden/**`. Đổi hành vi ⇒ sinh lại golden bằng oracle V1 (xem `docs/test-mapping.md`) và ghi lý do trong commit.
- Chỉ `validate --commit` được commit stage dữ liệu truyện; agent không tự commit (từ Slice 2).
- Không push và không tạo remote khi chưa được người dùng yêu cầu.

## Lệnh
```bash
npm test            # toàn bộ test
npm run test:golden # chỉ golden test (port từ V1)
npm run typecheck
npm run novel -- <lệnh>   # CLI qua tsx
```

## Trạng thái
Slice 1 (ingest): code xong, golden + spec xanh. Còn lại để đóng Slice 1: chạy thật trên KZGD 1–201 rồi `novel crosscheck` với raw V1; tạo repo dữ liệu đầu tiên (gcrypt, người dùng tự làm).

Bản đồ code:
- `src/ingest/adapters/`: `shuba69` (Chrome thật), `shuku52` (HTTP, ghép trang), `local-file` (import).
- `src/ingest/core/`: numerals, junk, html, checks, challenge, retry, lock, fs-atomic, html-cache, http, browser, raw-store.
- `src/ingest/run.ts` (orchestrator), `src/ingest/factory.ts` (ráp fetcher: cache → polite → network), `src/config.ts` (book.yaml), `src/cli.ts`.
- Khác biệt có chủ đích so với V1: xem cuối `docs/source-quirks.md`.
