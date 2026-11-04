# Artifact & Stage Contract (local-only MVP)

Dùng chung cho `/novel-crawl`, `/novel-translate`, `/novel-finalize`. Mọi đường dẫn tính từ **thư mục gốc project** (nơi mở Claude Code).

## 1. Vị trí file của một truyện

```text
books/<book-id>/
├── book.yaml                    # cấu hình do người dùng sửa: url, adapter, ngôn ngữ, genre, title_vi, author, models (tùy chọn)
├── manifest.json                # do crawler sinh: danh sách chương, tiêu đề gốc, hash, trạng thái nguồn
├── status.json                  # tiến độ, checkpoint, phê duyệt (main ghi; xem mục 4)
├── raw/chapter-0001.md          # nguyên tác do crawler ghi. KHÔNG BAO GIỜ sửa khi dịch/review/finalize
├── context/
│   ├── characters.md            # Character Bible (đã duyệt)
│   ├── relationships.md         # ma trận xưng hô theo phạm vi chương (đã duyệt)
│   ├── glossary.md              # thuật ngữ | bản dịch | biến thể cấm | nguồn chương (đã duyệt)
│   ├── continuity.md            # tóm tắt 1–3 dòng mỗi chương (đã duyệt)
│   └── proposals/               # đề xuất CHƯA duyệt của translator
│       ├── initial/             # context lần đầu: characters.md, relationships.md, glossary.md, style-notes.md
│       └── b0001.md             # đề xuất cập nhật context của batch b0001
├── translated/
│   ├── chapter-0001.v1.md       # bản dịch đầu (chỉ nội dung truyện)
│   └── chapter-0001.v2.md       # bản sửa (mỗi lần sửa là một version mới; không ghi đè version cũ)
├── reviews/
│   ├── ingestion.md             # báo cáo crawl
│   ├── b0001/
│   │   ├── summaries.md              # tóm tắt chương của batch (translator viết; gộp vào continuity khi duyệt)
│   │   ├── critic-chapter-0001.md    # CHAPTER review của v1
│   │   ├── revalidate-chapter-0001.md
│   │   ├── critic-batch.md
│   │   ├── revalidate-batch.md
│   │   ├── notes.md                  # [Chú thích], [Thuật ngữ mới], [Cần xác nhận] của translator
│   │   └── user-decision.md          # phê duyệt / yêu cầu sửa của người dùng
│   └── final/
│       ├── critic-final.md
│       └── revalidate-final.md
└── output/
    ├── <book-id>.epub           # bản cuối (chỉ /novel-finalize)
    ├── <book-id>.draft.epub     # bản đọc thử (theo yêu cầu, ở cuối batch hoặc finalize --draft)
    └── .build/                  # file tạm khi xuất EPUB
```

- Mã chương luôn có **4 chữ số** (`0001`). Mã batch: `b` + 4 chữ số của thứ tự batch.
- Phạm vi batch: chia phạm vi được yêu cầu thành các đoạn liên tiếp, mỗi đoạn `batch-size` chương (mặc định 10). Batch đã ghi trong `status.json` thì giữ nguyên phạm vi cũ.

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
2. Review report là file khác với bản dịch. Critic chạy như một subagent **chỉ đọc**; main lưu report mà Critic trả về.
3. Phê duyệt của người dùng tách khỏi kết luận của Critic. **Không bao giờ** chuyển `PASS` của Critic thành `APPROVED`.
4. Không tự nối các command: crawl xong không tự dịch; dịch xong không tự finalize.
5. Hoàn tất hoặc đánh dấu rõ bị gián đoạn ở bước hiện tại rồi mới sang bước kế.
6. Resume chỉ bỏ qua artifact có fingerprint khớp (mục 5). Không có fingerprint thì phải kiểm tra, không bỏ qua mù quáng.
7. EPUB chỉ chứa các file truyện đúng thứ tự, đúng version được duyệt; không bao giờ chứa notes, prompt, report hay context.
8. Không ghi đè hàng loạt; mỗi lần sửa tạo version mới; ghi file tạm rồi đổi tên khi có thể.
9. Không có thao tác Git trong workflow.
10. Context đã duyệt chỉ đổi khi người dùng duyệt đề xuất (`approve-context` hoặc `approve` batch).

## 4. Trạng thái

| Đối tượng | Giá trị |
|---|---|
| Bước của chương (`raw`, `translation`, `review`) | `NOT_STARTED`, `IN_PROGRESS`, `DONE`, `BLOCKED`, `FAILED` |
| Kết luận Critic | `PASS`, `REWORK`, `BLOCKED`, `LIMITED_PASS` |
| Quyết định của người dùng (batch, context) | `PENDING_USER_APPROVAL`, `APPROVED`, `NEEDS_REWORK`, `BLOCKED` |

Schema: `templates/status.example.json`. Quy tắc ghi `status.json`:
- Main đọc toàn bộ file, sửa, rồi ghi lại **toàn bộ** (Write). Không sửa từng dòng bằng Edit.
- Cập nhật `last_updated` (ISO-8601).
- Ghi **sau mỗi chương** và **sau mỗi bước quan trọng** để có thể resume.
- Chỉ đặt `APPROVED` khi **người dùng gõ** lệnh `approve` hoặc `approve-context`. Ghi `decided_by: "user"` cùng `decided_at`.

## 5. Fingerprint (resume và phát hiện cũ)

- `raw_hash` = `content_hash` trong frontmatter của raw (crawler tính). Nếu thiếu: `shasum -a 256 raw/chapter-NNNN.md`.
- `context_version` = `status.json → context.version` (số nguyên, tăng mỗi lần duyệt context).
- Một bản dịch là **hiện hành** khi `raw_hash` và `context_version` lưu trong chương bằng giá trị hiện tại. Khác thì chương là **STALE**: báo cho người dùng, **không** tự dịch lại.

## 6. Kiểm tra nhanh bằng shell (không cần code mới)

| Kiểm tra | Lệnh | Đạt khi |
|---|---|---|
| Số đoạn | `awk 'BEGIN{RS=""} NR>1{n++} END{print n+0}' <file>` (block đầu là frontmatter + tiêu đề của raw, hoặc tiêu đề của bản dịch) | raw = bản dịch |
| Chữ Hán sót | `perl -CSD -ne 'print "$.: $_" if /\p{Han}/' <bản dịch>` (**bắt buộc** `-CSD`: thiếu thì perl đọc byte và không bao giờ khớp) | không có dòng nào (trừ tên được glossary cho giữ) |
| Ghi chú lọt vào truyện | `grep -nE '^(---|\*\*\*)$\|\[(Chú thích\|Thuật ngữ mới\|Cần xác nhận)' <bản dịch>` | chỉ còn dòng ngắt cảnh có trong nguyên tác |
| Tiêu đề | dòng 1 bắt đầu bằng `# ` | đúng |
| Hash raw không đổi | so `content_hash` với `status.json` | bằng nhau |

## 7. Chính sách sửa

- `CRITICAL`, `MAJOR`: **bắt buộc** sửa và revalidate.
- `MINOR`: sửa khi cùng chương đã có lượt FIX, hoặc khi Critic Batch nêu nó lặp lại ở nhiều chương; nếu không thì ghi nhận.
- `SUGGESTION`: không sửa.
- Mỗi chương hoặc batch: tối đa **2 lượt FIX → REVALIDATE**. Vẫn còn `CRITICAL`/`MAJOR` thì chuyển `NEEDS_REWORK` cho người dùng, không lặp tiếp.

## 8. Phạm vi của Critic theo mode

| Mode | Input | Ghi chú |
|---|---|---|
| CHAPTER | raw + bản dịch hiện hành của 1 chương + context + tóm tắt 3 chương trước | So từng đoạn |
| REVALIDATE | issue gốc + đoạn trước/sau khi sửa + đoạn nguyên tác tương ứng | Chỉ các đoạn đã đổi |
| BATCH | tóm tắt batch + context + mọi report của batch + `proposals/bNNNN.md` | Đọc toàn văn đoạn liên quan khi nghi mâu thuẫn; không soát lại câu chữ từng chương |
| FINAL | continuity toàn phạm vi + context + mọi `critic-batch.md` + issue còn mở + đoạn mẫu | Ghi rõ phần soát đầy đủ và phần chỉ soát mẫu |

Không khẳng định đã soát toàn văn khi chỉ đọc tóm tắt.
