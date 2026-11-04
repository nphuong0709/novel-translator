# Novel Translator — Blueprint V4

> **Trạng thái:** đã chốt hướng, đang làm Slice 1 (ingest).
> **Thay cho:** Blueprint V3 (bản review). Các mục không nhắc lại ở đây giữ nguyên tinh thần V3.
> **Phạm vi:** công cụ cá nhân, chạy local bằng Claude Code; nguồn EN/ZH → tiếng Việt → EPUB.

---

## 1. Các quyết định đã chốt

| ID | Quyết định | Lý do |
|---|---|---|
| D-01 | Chạy local bằng Claude Code; không UI, không DB, không backend | Công cụ một người dùng |
| D-02 | **TypeScript (Node 24)** cho mọi phần code: ingest, validate, export | Mục tiêu học TS; Python ngoài phạm vi. Kiến thức từ bản Python được giữ lại qua golden test (mục 8) |
| D-03 | Skill chỉ để điều phối; luật cứng nằm trong code (`validate`) | Lời dặn trong prompt không phải transaction boundary |
| D-04 | Translator, 2 critic, editor, batch critic, final critic là các subagent riêng | Không để agent tự duyệt bản của chính mình |
| D-05 | **Phương án C**: gom 2–3 chương mỗi lượt; 2 critic chạy song song; script áp fix; editor chỉ chạy khi cần | Ít hơn khoảng 3 lần token so với 6 vòng mà vẫn giữ 2 critic độc lập (mục 4) |
| D-06 | Commit review **trước** commit sửa | Lịch sử cho thấy ai phát hiện gì, ai sửa gì |
| D-07 | **Trạng thái được tính lại từ artifact và hash**, không lưu state file riêng | Không thể lệch giữa trạng thái và file thật |
| D-08 | EPUB bằng Pandoc, kiểm tra bằng epubcheck | Không tự viết bộ đóng gói EPUB |
| D-09 | Nguồn EN/ZH (Giản thể và Phồn thể), đích là tiếng Việt | Nhật/Hàn để V2 |
| D-10 | Tách 2 repo: framework và dữ liệu truyện | Text truyện không nằm chung repo với code |
| D-11 | Repo dữ liệu đẩy lên GitHub private qua **`git-remote-gcrypt`** | GitHub chỉ thấy blob đã mã hóa, kể cả tên file và commit message |
| D-12 | Mỗi chương 4 commit: `raw`, `translate`, `review`, `fix`/`approve` | Giữ được kiểm vết mà không phải tới 16 commit một chương |
| D-13 | Final critic chỉ làm kiểm tra xuyên batch | Batch critic đã đọc từng chương |

## 2. Nguyên tắc truy cập nguồn (thay nguyên tắc 11 của V3)

- Dùng cho mục đích cá nhân, không kinh doanh; người dùng tự chịu trách nhiệm về quyền với nội dung.
- **Cho phép xác minh bằng tay** (ví dụ Cloudflare) trong trình duyệt thật; tool chỉ tái sử dụng profile đã được xác minh.
- **Không** tự động giải CAPTCHA hay challenge, không dùng stealth hay giả fingerprint, không xoay proxy, không gọi dịch vụ giải CAPTCHA.
- Khi gặp challenge mà không có người xác minh: trạng thái `BLOCKED`, dừng batch sạch sẽ, gửi thông báo cho người dùng.
- Request ít và chậm: có delay và jitter, cache mục lục và HTML, không tải lại thứ đã có.

## 3. Layout hai repo

```text
~/Documents/2.phuong-nguyen/
├── novel-translator/            ← repo FRAMEWORK (GitHub private, không mã hóa)
│   ├── CLAUDE.md  README.md  package.json  tsconfig.json
│   ├── docs/                    blueprint, source-quirks, test-mapping
│   ├── src/ingest/core/         numerals, junk, retry, lock, raw-store, checks
│   ├── src/ingest/adapters/     shuba69.ts, shuku52.ts, local-file.ts
│   ├── src/validate/            gate tất định (Slice 2)
│   ├── src/cli.ts               ingest | import | validate | status | export
│   ├── .claude/agents/          (Slice 2) translator, semantic-critic, vietnamese-critic, editor, batch-critic, final-critic
│   ├── .claude/skills/          (Slice 2+) ingest, translate-batch, review-batch, finalize, status
│   ├── rules/                   (Slice 2) port từ translation_skills/*.md của bản V1
│   └── tests/fixtures + golden  HTML tổng hợp, KHÔNG chứa text truyện thật
└── novel-books/
    └── <book-id>/               ← mỗi truyện 1 repo DỮ LIỆU (remote: gcrypt::git@github.com:<user>/<book-id>-data.git)
        ├── book.yaml            url, adapter, ngôn ngữ, phạm vi chương
        ├── context/             characters.md, relationships.md, glossary.md, style-guide.md, continuity.md
        ├── chapters/NNN/        source.md, draft_v1.md, summary.md, semantic_review.md, language_review.md, draft_v2.md
        ├── batch-reviews/  final-review.md  export-manifest.json
        ├── ingest-report.md
        └── .cache/              (gitignored) html/, catalog.json, browser-profile/
```

Không bao giờ commit: `.env`, `browser-profile/`, `token.json`, `credentials.json`, `.cache/`, file `*.epub` (chỉ commit `export-manifest.json`).

## 4. Luồng end-to-end

```text
/ingest   → code: tìm chương → tải (có cache HTML) → parse → kiểm tra → source.md
          → trạng thái mỗi chương VALID | SUSPECT | BLOCKED | FAILED → ingest-report.md → commit raw(...)

/translate-batch (theo nhóm 2–3 chương):
  translator           → draft_v1.md + summary.md (mỗi chương)          → commit translate(chNNN-MMM)
  semantic-critic ∥ vietnamese-critic (chỉ đọc)  → 2 review / chương      → commit review(...)
  apply-fixes (code)   → áp `excerpt → fix` khớp chính xác → draft_v2.md
                         fix không khớp / xung đột / thay >30% câu → danh sách cho editor
  editor (chỉ khi danh sách khác rỗng)                                   → draft_v2.md
  validate (code)      → độ phủ đoạn, chữ Hán sót, glossary, hash
                         + semantic-critic chạy delta nếu editor sửa nghĩa
                       → approve | rework (≤2 lần) | NEEDS_HUMAN_REVIEW   → commit fix/approve(...)
  sau mỗi N chương: batch-critic đọc summary.md + glossary + đoạn bị gắn cờ, ghi rõ độ phủ → commit

/finalize → final-critic (xuyên batch) → sửa + regression → pandoc → epubcheck → export-manifest.json → commit
/status   → tính trạng thái từ artifact + git log; không ghi gì
```

Chỉ có `validate --commit` được phép commit. LLM không tự commit.

## 5. Trạng thái tính lại từ artifact (D-07)

Mỗi artifact có frontmatter ghi hash của input:

```yaml
---
stage: semantic_review
chapter: 12
agent: semantic-critic
input: { source: sha256:…, draft_v1: sha256:… }
output_sha256: sha256:…
---
```

`status` suy ra trạng thái theo quy tắc: artifact của stage S hợp lệ ⇔ file tồn tại, `output_sha256` khớp nội dung, và mọi `input.*` khớp hash hiện tại của file input. Source đổi → mọi stage phía sau tự trở nên không hợp lệ, không cần invalidation thủ công. Rollback bằng `git revert`, xong là `status` tự đúng.

## 6. Yêu cầu ingest (Slice 1)

### 6.1 Interface adapter

```ts
interface SourceAdapter {
  id: string;                                   // "shuba69" | "shuku52" | "local-file"
  matches(url: string): boolean;
  fetchChapter(bookUrl: string, n: number): Promise<RawChapter>;   // bắt buộc
  discover?(bookUrl: string): Promise<number[]>;                    // tùy chọn: site chia theo trang không biết trước danh sách chương
  cleanContent(text: string): string;                               // lọc rác, dùng lại cho raw cũ
}
```

### 6.2 Kiểm tra sau khi ingest

| Kiểm tra | Kết quả |
|---|---|
| Challenge hoặc 403 có dấu hiệu bot-check | `BLOCKED`, dừng batch |
| Trùng hash với chương liền kề | `FAILED` |
| Số trong tiêu đề ≠ số chương yêu cầu | `FAILED` |
| Nội dung < 200 ký tự | `FAILED` |
| **Tỷ lệ ký tự trích ra / text của container < 0,9** | `SUSPECT` (bắt lỗi HTML hỏng làm mất đoạn) |
| Độ dài < 0,5× hoặc **> 2×** trung vị của các chương trong phạm vi ±20 | `SUSPECT` (chương bị cắt cụt hoặc bị gộp) |
| Còn khớp mẫu rác sau khi lọc | `SUSPECT` |

### 6.3 Độ bền

- Retry có backoff; luôn nghỉ giữa các request, kể cả khi lỗi; không retry `BLOCKED`.
- Dừng batch sau N chương lỗi liên tiếp (mặc định 3).
- **Lock file** cho từng truyện: không cho hai lệnh chạy song song.
- Ghi file theo kiểu atomic: viết vào file tạm có PID riêng, rồi đổi tên.
- **Cache HTML gốc** kèm `parserVersion`; sửa parser thì parse lại offline, không gọi mạng.

## 7. Phương án C — chi tiết critic

- Nhóm 2–3 chương mỗi lượt gọi; đo cả nhóm 2 và nhóm 3 ở PoC.
- Issue bắt buộc có `translation_excerpt` trích **nguyên văn** từ bản nháp, cùng `proposed_fix`; thiếu thì không được áp tự động.
- Script áp fix theo thứ tự: issue `CRITICAL`/`MAJOR` trước; hai critic sửa cùng một excerpt thì gọi là xung đột và chuyển cho editor.
- Model cho từng agent được khai báo trong frontmatter. Chọn theo số liệu golden set, không theo cảm tính.
- Ước lượng (cần đo lại): khoảng 40k token input và 11k output mỗi chương, so với khoảng 135k và 26k của phương án 6 vòng.

## 8. Chuyển kiến thức từ bản Python sang TS

1. `docs/source-quirks.md`: mỗi lỗi hoặc đặc điểm đã gặp có một ID (CORE-xx, SHUBA-xx, SHUKU-xx).
2. `tests/fixtures/**`: HTML tổng hợp mô phỏng đúng cấu trúc từng quirk.
3. `tests/golden/**`: output chuẩn, sinh **một lần** bằng code Python V1 (dùng làm oracle).
4. `docs/test-mapping.md`: test Python → quirk ID → test TS.
5. So sánh chéo trên dữ liệu thật (chỉ local): hash từng chương của TS so với raw do Python tạo.

Golden mô tả **hành vi mong muốn**, không phải chi tiết hiện thực. Ví dụ cheerio (parse5) tự đóng `<p>` khác `html.parser`, nhưng kết quả vẫn phải khớp golden.

## 9. Vertical slices

| Slice | Nội dung | Xong khi |
|---|---|---|
| **1** | Ingest TS: core + shuku52 + shuba69 + local-file, CLI `ingest`/`import`, repo dữ liệu đầu tiên | Golden test xanh; cào lại KZGD 1–201 khớp hash với bản Python đã sửa (hoặc lệch có giải thích); lock, cache, resume chạy đúng |
| 2 | 1 nhóm chương, đủ agent theo phương án C + `validate` + golden set lỗi cài sẵn | Bắt được ≥ 8/10 lỗi cài sẵn; commit đúng 4 bước; gate chặn được review cũ (stale) |
| 3 | Context có version, 5–10 chương, resume giữa chừng | Xưng hô và tiêu đề đổi theo phạm vi chương mà không sửa lan sang chương cũ |
| 4 | Batch critic | Phát hiện tên hoặc tiêu đề không nhất quán đã cài sẵn; sửa xong thì duyệt lại |
| 5 | Final + EPUB | Bị chặn khi còn chương chưa duyệt; epubcheck pass; manifest trỏ đúng commit |

## 10. Việc mở và rủi ro còn lại

- **Cần xác minh trong docs Claude Code:** subagent có gọi được subagent khác không (giả định là không, nên điều phối ở phiên chính); gọi 2 critic song song; payload của hook `SubagentStop` dùng để log agent thật; cách skill nhận tham số.
- **Công cụ cần cài:** `gpg`, `git-remote-gcrypt`, `epubcheck` (Slice 5).
- **Rủi ro mất khóa GPG** = mất bản sao trên GitHub. Lưu khóa trong trình quản lý mật khẩu, tách khỏi dữ liệu.
- Truyện dài 200+ chương có thể chạm usage limit; đo ở Slice 2 trước khi chạy cả bộ.
