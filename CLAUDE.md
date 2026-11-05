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
- Hai subagent (blueprint D-16):
  - `translator`: Opus; dựng context (`CONTEXT_INIT`) và dịch bản nháp (đổi từ Sonnet ngày 2026-11-05).
  - `literary-editor`: Opus; độc lập với `translator`, review và sửa cục bộ có căn cứ trên bản sao. Không bao giờ sửa raw, bản nháp v1, context đã duyệt; `novel edit-check` kiểm bằng hash.
  - Phiên main điều phối. Gọi agent ở **foreground** (`run_in_background: false`) khi có thể, chờ xong mới sang bước sau, rồi chạy `novel agent-check`. Bị chạy nền nhưng đã xong thì `agent-check` chỉ cảnh báo; sai model hoặc chưa xong thì chặn. Subagent không được gọi subagent khác.
- **Không có thao tác Git trong workflow dữ liệu:** không commit, stage, push hay sửa `.gitignore` như một bước của workflow.
- Chỉ file local: không UI, DB, chi tiêu API key, upload cloud hay chạy nền ngầm.
- Giữ nguyên nguồn. Bản dịch, review, context và ấn phẩm là các file tách biệt (`rules/artifact-contract.md`).
- Kết luận và bản sửa của Editor **không phải** phê duyệt của người dùng. Không gọi lại translator để sửa lỗi cục bộ mà Editor sửa được. Batch tối đa 3 chương. Mặc định dừng sau mỗi batch; chỉ khi người dùng gõ `--auto` mới chạy liền nhiều batch (vẫn không tự duyệt). Batch đang chờ duyệt **không** chặn dịch tiếp; người dùng duyệt gộp theo chặng. Chỉ đặt `APPROVED` khi người dùng gõ lệnh `approve`.
- Câu hỏi cho người dùng gom về `reviews/questions.md`, hỏi gộp. Câu trả lời (quyết định) ghi thẳng vào `context/decisions.md` + file context liên quan, tăng `context.version`, rồi `/novel-translate sync` áp lên chương đã dịch. Không rework từng batch cho cùng một quyết định.
- Không bao giờ đưa bình luận, ghi chú, bảng QA hay report vào file truyện hoặc EPUB.
- Không tự rút gọn hay thay thế các master prompt khi gọi agent.
- Thiếu script hoặc lệnh cần thiết: báo `NOT_IMPLEMENTED`, không giả vờ đã xong.

## Nguồn sự thật
- Workflow: `.claude/skills/{novel-crawl,novel-translate,novel-finalize}/SKILL.md`
- Translator: `prompts/translation-master.md` (tầng 1, luật chung mọi thể loại), `prompts/modules/<genre>.md` (tầng 2, nạp theo `book.yaml → genre`), `prompts/translation-workflow.md`, `prompts/vietnamese-style.md`. Context của truyện là tầng 3 (master §12). Phần riêng thể loại viết vào module, không viết vào master.
- Literary Editor: `prompts/literary-editor-master.md`, `prompts/translation-master.md`, `prompts/vietnamese-style.md`, module. Prompt Critic cũ lưu ở `docs/archive/critic-master.md` (chỉ để đọc report `critic-batch.md` của batch cũ).
- Artifact, trạng thái, kiểm tra: `rules/artifact-contract.md`, `templates/status.example.json`; EPUB: `rules/epub-export.md`

## Lệnh phát triển
```bash
npm test            # toàn bộ test
npm run test:golden # chỉ golden test (port từ V1)
npm run typecheck
npm run novel -- <lệnh>   # CLI qua tsx: init | ingest | import | status | crosscheck | save-report | edit-prep | edit-check | agent-check | tidy | term-scan (help để xem cú pháp)
```

## Trạng thái
- Slice 1 (crawler TS) xong; layout skill (`raw/chapter-NNNN.md`, `manifest.json`, `reviews/ingestion.md`) xong. KZGD ở `books/kzgd/`.
- Đã chạy b0001–b0003 (ch1–8) theo mô hình Critic cũ, đang chờ duyệt.
- Slice T5 (Translator → Literary Editor Opus, D-16; Translator đổi từ Sonnet sang Opus ngày 2026-11-05) đã cài prompt, agent, skill, contract và `novel edit-prep | edit-check | agent-check`. Pilot T5 bỏ (2026-11-05, không đo tiếp); dùng thẳng mô hình này.
- Đơn giản hóa duyệt (2026-11-05, người dùng đồng ý A–E): quyết định hiệu lực ngay (`decisions.md`), hàng đợi `questions.md`, lệnh `sync` + `edit-prep --next`/`--batch sync`, batch chờ duyệt không chặn, `tidy` + report rework một file (`# Vòng N`). KZGD: b0001–b0003 (ch1–8) đã rework đồng bộ U4–U18, chờ duyệt gộp; tiếp theo dịch ch9+.
- Còn tồn tại từ thiết kế cũ, chưa dùng trong workflow: `src/snapshot.ts` (git bundle; sẽ thay bằng backup zip ở T4).

Bản đồ code:
- `src/ingest/adapters/`: `shuba69` (Chrome thật), `shuku52` (HTTP, ghép trang), `local-file` (import).
- `src/ingest/core/`: numerals, junk, html, checks, challenge, retry, lock, fs-atomic, html-cache, http, browser, raw-store.
- `src/ingest/run.ts` (orchestrator ingest), `src/ingest/factory.ts` (cache → polite → network), `src/config.ts` (book.yaml), `src/cli.ts`.
- Khác biệt có chủ đích so với V1: cuối `docs/source-quirks.md`.
