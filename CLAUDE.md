# CLAUDE.md — novel-translator

Tự động hóa quy trình dịch truyện **cá nhân** đã chạy được thủ công (EN/ZH → tiếng Việt → EPUB), chạy local bằng Claude Code. Không phải nền tảng multi-agent chung.
Thiết kế: `docs/novel_translation_framework_blueprint_simplified.md` (thay phần dịch/review của `docs/blueprint-v4.md`). Năng lực Claude Code đã kiểm chứng: `docs/capability-verification.md`. Kiến thức nguồn từ V1: `docs/source-quirks.md`.

## Quy tắc bắt buộc
- Trả lời bằng tiếng Việt; giữ nguyên thuật ngữ kỹ thuật tiếng Anh.
- **Không commit text truyện.** Dữ liệu truyện nằm ở `books/<book-id>/` (đã có trong `.gitignore`). Không `git add -f` thư mục này; không chép raw, bản dịch, review vào `src/`, `docs/`, `tests/`. Fixture trong `tests/fixtures` phải là câu văn tự viết.
- Không commit `.env`, `token.json`, `credentials.json`, `.cache/`, browser profile, `*.epub`.
- Truy cập nguồn: cho phép người dùng **tự** xác minh Cloudflare trong trình duyệt thật. **Không** tự động giải challenge hay CAPTCHA, không stealth hay giả fingerprint, không xoay proxy. Chỉ xử lý nội dung người dùng có quyền lưu và dịch.
- Ingest do code làm (`src/ingest/**`); LLM không tự đi tải hay browse chương.
- Hành vi ingest phải khớp `tests/golden/**`. Đổi hành vi ⇒ sinh lại golden bằng oracle V1 (xem `docs/test-mapping.md`) và ghi lý do trong commit.
- Không push và không tạo remote khi chưa được người dùng yêu cầu.

## Workflow dịch (skills)
- Chỉ ba skill chính, **do người dùng gọi**: `/novel-crawl`, `/novel-translate`, `/novel-finalize`. Không bao giờ tự nối chúng với nhau.
- Hai subagent: `translator`, `critic`. Phiên main điều phối; `critic` chỉ đọc và độc lập với `translator`. Chỉ gọi agent ở **foreground** (`run_in_background: false`), chờ xong mới sang bước sau. Subagent không được gọi subagent khác.
- **Không có thao tác Git trong workflow dữ liệu:** không commit, stage, push hay sửa `.gitignore` như một bước của workflow.
- Chỉ file local: không UI, DB, chi tiêu API key, upload cloud hay chạy nền ngầm.
- Giữ nguyên nguồn. Bản dịch, review, context và ấn phẩm là các file tách biệt (`rules/artifact-contract.md`).
- Khuyến nghị của Critic **không phải** phê duyệt của người dùng. Mặc định dừng sau mỗi batch. Chỉ đặt `APPROVED` khi người dùng gõ lệnh `approve`.
- Không bao giờ đưa bình luận, ghi chú, bảng QA hay report vào file truyện hoặc EPUB.
- Không tự rút gọn hay thay thế các master prompt khi gọi agent.
- Thiếu script hoặc lệnh cần thiết: báo `NOT_IMPLEMENTED`, không giả vờ đã xong.

## Nguồn sự thật
- Workflow: `.claude/skills/{novel-crawl,novel-translate,novel-finalize}/SKILL.md`
- Translator: `prompts/translation-master.md` (V1, nguyên văn), `prompts/translation-workflow.md`, `prompts/vietnamese-style.md`, `prompts/modules/*`
- Critic: `prompts/critic-master.md`, `prompts/vietnamese-style.md`
- Artifact, trạng thái, kiểm tra: `rules/artifact-contract.md`, `templates/status.example.json`; EPUB: `rules/epub-export.md`

## Lệnh phát triển
```bash
npm test            # toàn bộ test
npm run test:golden # chỉ golden test (port từ V1)
npm run typecheck
npm run novel -- <lệnh>   # CLI qua tsx: init | ingest | import | status | crosscheck (help để xem cú pháp)
```

## Trạng thái
- Slice 1 (crawler TS) xong; layout skill (`raw/chapter-NNNN.md`, `manifest.json`, `reviews/ingestion.md`) xong. KZGD ở `books/kzgd/`.
- Tiếp theo: T2, chạy thử `/novel-translate` 1–2 chương (dừng ở `approve-context`).
- Còn tồn tại từ thiết kế cũ, chưa dùng trong workflow: `src/snapshot.ts` (git bundle; sẽ thay bằng backup zip ở T4).

Bản đồ code:
- `src/ingest/adapters/`: `shuba69` (Chrome thật), `shuku52` (HTTP, ghép trang), `local-file` (import).
- `src/ingest/core/`: numerals, junk, html, checks, challenge, retry, lock, fs-atomic, html-cache, http, browser, raw-store.
- `src/ingest/run.ts` (orchestrator ingest), `src/ingest/factory.ts` (cache → polite → network), `src/config.ts` (book.yaml), `src/cli.ts`.
- Khác biệt có chủ đích so với V1: cuối `docs/source-quirks.md`.
