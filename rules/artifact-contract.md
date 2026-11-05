# Artifact & Stage Contract (local-only MVP)

Dùng chung cho `/novel-crawl`, `/novel-translate`, `/novel-finalize`. Mọi đường dẫn tính từ **thư mục gốc project** (nơi mở Claude Code).

## 1. Vị trí file của một truyện

```text
books/<book-id>/
├── book.yaml                    # url, adapter, ngôn ngữ, genre (tên module trong prompts/modules/, chuỗi hoặc danh sách; none = không module; approve-context ghi nếu thiếu), title_vi, author, models (tùy chọn)
├── manifest.json                # do crawler sinh: danh sách chương, tiêu đề gốc, hash, trạng thái nguồn
├── status.json                  # tiến độ, checkpoint, phê duyệt (main ghi; xem mục 4)
├── raw/chapter-0001.md          # nguyên tác do crawler ghi. KHÔNG BAO GIỜ sửa khi dịch/review/finalize
├── context/
│   ├── characters.md            # Character Bible (đã duyệt)
│   ├── relationships.md         # ma trận xưng hô theo phạm vi chương (đã duyệt)
│   ├── glossary.md              # thuật ngữ | bản dịch | biến thể cấm | nguồn chương (đã duyệt)
│   ├── continuity.md            # tóm tắt 1–3 dòng mỗi chương (đã duyệt)
│   ├── decisions.md             # nhật ký quyết định của người dùng (U1, U2…), mỗi mục ghi context version; hiệu lực ngay
│   └── proposals/               # đề xuất CHƯA duyệt của translator
│       ├── initial/             # context lần đầu: characters.md, relationships.md, glossary.md, style-notes.md
│       └── b0001.md             # đề xuất cập nhật context của batch b0001
├── translated/
│   ├── chapter-0001.v1.md       # bản NHÁP của translator (chỉ nội dung truyện); bất biến kể từ khi Editor bắt đầu
│   ├── chapter-0001.v2.md       # bản SAU BIÊN TẬP: `novel edit-prep` sao chép v1, literary-editor sửa cục bộ trên bản sao
│   ├── chapter-0001.v3.md       # (nếu có) rework / sync / REDRAFT / sửa ở FINAL; mỗi lần sửa là một version mới, không ghi đè version cũ
│   └── .history/                # version trung gian (`novel tidy`) và version không được duyệt (không xóa)
├── reviews/
│   ├── ingestion.md             # báo cáo crawl
│   ├── questions.md             # hàng đợi câu hỏi cho người dùng (OPEN / ANSWERED (U<n>)), một file cho cả truyện
│   ├── sync/
│   │   ├── editor-sync.md            # report SYNC (áp quyết định lên chương đã dịch); vòng sau nối `# Vòng N`
│   │   └── edit-guard.json
│   ├── b0001/
│   │   ├── summaries.md              # tóm tắt chương của batch (translator viết; gộp vào continuity khi duyệt)
│   │   ├── editor-batch.md           # REVIEW_EDIT cả batch (≤3 chương): phát hiện + change log + post-edit check + VERDICT (Editor ghi)
│   │   ├── editor-rework.md          # (nếu có) REWORK theo ghi chú người dùng; vòng sau nối `# Vòng N` trong cùng file (batch cũ có thể còn editor-rework-2.md…)
│   │   ├── editor-redraft.md         # (nếu có) review lại chương REDRAFT
│   │   ├── edit-guard.json           # hash các file Editor không được đổi (`novel edit-prep`), dùng cho `novel edit-check`
│   │   ├── critic-batch.md, revalidate-batch.md, critic-chapter-0001.md   # (cũ, trước D-16) report của Critic chỉ đọc
│   │   ├── notes.md                  # [Chú thích], [Thuật ngữ mới], [Cần xác nhận] của translator (cho người dùng đọc; không làm input cho agent)
│   │   └── user-decision.md          # phê duyệt / yêu cầu sửa của người dùng
│   └── final/
│       ├── editor-final.md           # FINAL review
│       └── editor-final-edit.md      # (nếu có) sửa ở FINAL
└── output/
    ├── <book-id>.epub           # bản cuối (chỉ /novel-finalize)
    ├── <book-id>.draft.epub     # bản đọc thử (theo yêu cầu, ở cuối batch hoặc finalize --draft)
    └── .build/                  # file tạm khi xuất EPUB
```

- Mã chương luôn có **4 chữ số** (`0001`). Mã batch: `b` + 4 chữ số của thứ tự batch.
- Phạm vi batch: chia phạm vi được yêu cầu thành các đoạn liên tiếp, mỗi đoạn `batch-size` chương (mặc định **3**, tối đa 3: một lần gọi translator và một lần gọi literary-editor cho cả batch). Batch đã ghi trong `status.json` thì giữ nguyên phạm vi cũ.
- `--auto`: chạy liền nhiều batch, mỗi batch dừng ở `PENDING_USER_APPROVAL`; người dùng duyệt sau, có thể duyệt gộp `approve <id> bNNNN-bMMMM`.
- **Context tạm:** `context/proposals/<b>.md` của các batch trước đang `PENDING_USER_APPROVAL` được đưa cho translator và literary-editor để giữ nhất quán. Đây không phải context đã duyệt (bất biến 10 vẫn giữ); ưu tiên: context (gồm `decisions.md`) > đề xuất chưa duyệt.
- **Quyết định của người dùng** (trả lời câu hỏi, ghi chú rework mang tính quy ước) được ghi thẳng vào `context/` ngay khi trả lời và tăng `context.version`; chương đã dịch bị ảnh hưởng được cập nhật bằng `sync`, không dịch lại.
- Batch `PENDING_USER_APPROVAL` không chặn dịch tiếp; người dùng duyệt gộp theo chặng. Finalize chỉ dùng chương `APPROVED`.

## 2. Định dạng file chương

**Raw** (`raw/chapter-NNNN.md`): frontmatter YAML (do crawler ghi, có `content_hash`) + `# <tiêu đề gốc>` + các đoạn văn cách nhau **một dòng trống**.

**Bản dịch** (`translated/chapter-NNNN.vN.md`):
```markdown
# <Tiêu đề chương tiếng Việt>

<đoạn 1>

<đoạn 2>
```
- **Chỉ** tiêu đề và nội dung truyện. Không frontmatter, không ghi chú, không bảng QA, không lời dẫn, không code fence, không phần hậu kỳ sau `---`.
- **Đoạn 1:1** *(mặc định, người dùng có thể đổi)*: số đoạn bản dịch = số đoạn raw, cùng thứ tự. Được tách hoặc ghép **câu** trong một đoạn; không tách hoặc gộp **đoạn**. Dấu ngắt cảnh của nguyên tác là một đoạn riêng.
- Chú thích cho độc giả *(mặc định)*: ghi vào `reviews/bNNNN/notes.md`, không đưa vào bản dịch và EPUB.

## 3. Bất biến (không thương lượng)

1. Raw không bị sửa bởi translate, review hay finalize.
2. Review report là file khác với bản dịch. Literary-editor chỉ được ghi **file version đích** và **file report** được giao. Bản nháp (v1), mọi version cũ, raw và context là chỉ đọc đối với nó. `novel edit-check` kiểm bằng hash; vi phạm thì lượt biên tập bị loại.
3. Phê duyệt của người dùng tách khỏi kết luận của Editor. **Không bao giờ** chuyển `PASS` của Editor thành `APPROVED`. Bản đã được Editor sửa **chưa** phải bản đã duyệt.
4. Không tự nối các command: crawl xong không tự dịch; dịch xong không tự finalize.
5. Hoàn tất hoặc đánh dấu rõ bị gián đoạn ở bước hiện tại rồi mới sang bước kế.
6. Resume chỉ bỏ qua artifact có fingerprint khớp (mục 5). Không có fingerprint thì phải kiểm tra, không bỏ qua mù quáng.
7. EPUB chỉ chứa các file truyện đúng thứ tự, đúng version được duyệt; không bao giờ chứa notes, prompt, report hay context.
8. Không ghi đè hàng loạt; mỗi lần sửa tạo version mới; ghi file tạm rồi đổi tên khi có thể. Sau mỗi lượt biên tập đã qua edit-check, `novel tidy` chuyển version trung gian sang `translated/.history/`; trong `translated/` chỉ còn `v1` (bản nháp, để so), `current_version` và `approved_version`. Khi batch được `approve`, các version khác `approved_version` được chuyển sang `.history/` (lưu trữ, không xóa). Version hỏng hoặc dở dang chuyển sang `.history/` với hậu tố `.partial`, `.invalid`, `.broken`, `.redraft-source` (không xóa).
9. Không có thao tác Git trong workflow.
10. Context chỉ đổi theo người dùng: `approve-context`, `approve` batch (gộp đề xuất ACCEPT), hoặc khi người dùng trả lời câu hỏi / ra quyết định (ghi vào `decisions.md` và file context liên quan). Agent không tự đổi context.

## 4. Trạng thái

| Đối tượng | Giá trị |
|---|---|
| Bước của chương (`raw`, `translation`, `review`) | `NOT_STARTED`, `IN_PROGRESS`, `DONE`, `BLOCKED`, `FAILED` |
| Kết luận Editor (`editor_verdict`; batch cũ: `critic_verdict`) | `PASS`, `REWORK`, `BLOCKED`, `LIMITED_PASS`; chương có thể là `REDRAFT`; FINAL: `READY`, `NEEDS_REWORK` |
| Quyết định của người dùng (batch, context) | `PENDING_USER_APPROVAL`, `APPROVED`, `NEEDS_REWORK`, `BLOCKED` |

Schema: `templates/status.example.json`. Quy tắc ghi `status.json`:
- Main đọc toàn bộ file, sửa, rồi ghi lại **toàn bộ** (Write). Không sửa từng dòng bằng Edit.
- Cập nhật `last_updated` (ISO-8601).
- Ghi **sau mỗi chương** và **sau mỗi bước quan trọng** để có thể resume.
- Chỉ đặt `APPROVED` khi **người dùng gõ** lệnh `approve` hoặc `approve-context`. Ghi `decided_by: "user"` cùng `decided_at`.
- `raw_status` sao chép trạng thái nguồn trong manifest (`VALID | SUSPECT`). Chương `SUSPECT` chỉ được dịch khi `suspect_accepted` có giá trị `{ "by": "user", "at": "<ISO>", "note": "…" }`. Hỏi người dùng **một lần**, rồi ghi lại để không hỏi lại.

## 5. Fingerprint (resume và phát hiện cũ)

- `raw_hash` = `content_hash` trong frontmatter của raw (crawler tính). Nếu thiếu: `shasum -a 256 raw/chapter-NNNN.md`.
- `context_version` = `status.json → context.version` (số nguyên, tăng mỗi lần duyệt context).
- Một bản dịch là **hiện hành** khi `raw_hash` và `context_version` lưu trong chương bằng giá trị hiện tại.
  - `raw_hash` khác: chương **STALE**, báo người dùng, **không** tự dịch lại.
  - Chỉ `context_version` nhỏ hơn: chương **cần sync** (áp các mục `U` mới hơn trong `decisions.md` bằng `/novel-translate sync`), không dịch lại.

## 6. Kiểm tra nhanh bằng shell (không cần code mới)

| Kiểm tra | Lệnh | Đạt khi |
|---|---|---|
| Số đoạn | `awk 'BEGIN{RS=""} NR>1{n++} END{print n+0}' <file>` (block đầu là frontmatter + tiêu đề của raw, hoặc tiêu đề của bản dịch) | raw = bản dịch |
| Chữ Hán sót | `perl -CSD -ne 'print "$.: $_" if /\p{Han}/' <bản dịch>` (**bắt buộc** `-CSD`: thiếu thì perl đọc byte và không bao giờ khớp) | không có dòng nào (trừ tên được glossary cho giữ) |
| Ghi chú lọt vào truyện | `grep -nE '^(---|\*\*\*)$\|\[(Chú thích\|Thuật ngữ mới\|Cần xác nhận)' <bản dịch>` | chỉ còn dòng ngắt cảnh có trong nguyên tác |
| Tiêu đề | dòng 1 bắt đầu bằng `# ` | đúng |
| Hash raw không đổi | so `content_hash` với `status.json` | bằng nhau |
| Biến thể cấm | `npm run -s novel -- term-scan books/<id> [--from N --to M]` (đọc cột `Cấm (scan)` của các bảng trong `context/*.md`, trừ proposals; tìm trong `current_version`) | mã 0; mã 2 = có ứng viên, Editor xét ở `sync` |
| Dọn version | `npm run -s novel -- tidy books/<id> [--chapters …]` | chỉ chạy sau edit-check PASS |

**Sau mỗi lần gọi literary-editor:** `npm run -s novel -- edit-check books/<id> --batch <b> --report <reviews/...md>` (mã 0 = PASS, 2 = FAIL). Lệnh kiểm:
- hash của raw, mọi version cũ, `context/**`, summaries và notes không đổi;
- các kiểm tra ở bảng trên cho version đích;
- tập đoạn khác nhau giữa version trước và sau **trùng** tập đoạn trong `## Change log`;
- report có `Đã áp dụng:`, `VERDICT:`, `## Change log`, `## Post-edit Source Fidelity Check`.

Cảnh báo (`WARN`, không chặn) khi:
- sửa trên 30% số đoạn mà không ghi `REDRAFT`;
- change ID trỏ tới đoạn không đổi.

**Sau mỗi lần gọi agent:** `npm run -s novel -- agent-check books/<id> --agent <id> [--model opus|sonnet]` kiểm model thật và cách chạy. Mã 2 khi sai model, hoặc chạy nền mà chưa xác nhận đã xong (`meta.json → finished`, hoặc lượt cuối là `SubagentHandback` / `end_turn`). Chạy nền nhưng đã xong: `WARN`, mã 0.

## 7. Chính sách sửa (literary-editor; chi tiết: `prompts/literary-editor-master.md` §6)

- `CRITICAL`, `MAJOR` (`CONFIRMED`): Editor **bắt buộc** sửa ngay trong lần gọi, rồi tự kiểm theo nguồn (bước 8).
- `MINOR`: sửa khi chắc chắn và có căn cứ.
- `SUGGESTION`, `NEEDS_CONTEXT`: không sửa.
- Mỗi thay đổi có căn cứ: nguyên tác, context đã duyệt hoặc quyết định của người dùng, hoặc quy tắc có định danh. Chỉ sửa cục bộ; không tách, gộp đoạn; không viết lại cả chương.
- **REDRAFT** (người dùng duyệt 2026-11-05): trên 30% số đoạn cần sửa, hoặc có từ 5 lỗi `CRITICAL` về nghĩa trở lên, hoặc lỗi cấu trúc toàn chương. Khi đó translator dịch lại **một lần**, Editor review lại; vẫn không đạt thì `REWORK` cho người dùng.
- Translator **không** được gọi để sửa lỗi cục bộ.
- `edit-check` FAIL (trừ trường hợp file được bảo vệ bị đổi): làm lại lượt biên tập **một lần**; vẫn FAIL thì `BLOCKED`.

## 8. Phạm vi của literary-editor theo mode

| Mode | Input | Ghi được |
|---|---|---|
| REVIEW_EDIT | raw + bản làm việc (bản sao của v1) của mọi chương trong batch (≤3) + kết quả kiểm tra cấu trúc + context + context tạm + `proposals/bNNNN.md` + tóm tắt 3 chương trước | bản làm việc; `editor-batch.md` |
| REWORK | ghi chú người dùng + bản làm việc (bản sao của `current_version`) + raw + report trước + context (+ bản nháp nếu `revert`) | bản làm việc; `editor-rework.md` |
| FINAL | continuity toàn phạm vi + context + mọi `editor-batch.md` (batch cũ: `critic-batch.md`) + issue còn mở + đoạn mẫu; lượt sửa: thêm bản làm việc của chương bị nêu | `editor-final.md`; lượt sửa: bản làm việc và `editor-final-edit.md` |

Không khẳng định đã soát toàn văn khi chỉ đọc tóm tắt. Không nhận `notes.md` của translator.
