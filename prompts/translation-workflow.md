# Translation Workflow Addendum — dùng kèm `translation-master.md`

> `translation-master.md` là **luật dịch chung** (tầng 1); `prompts/modules/<genre>.md` là luật theo thể loại (tầng 2); `books/<id>/context/` là luật của truyện (tầng 3). Xem master §12.
> File này chỉ quy định **cách làm việc trong framework**: ghi file thay vì trả lời chat, mode REDRAFT, đoạn 1:1, ghi chú tách khỏi truyện.
> Lỗi cục bộ sau review do **Literary Editor** sửa trực tiếp (blueprint D-16). Translator không còn mode FIX.
> **Ghi đè có giới hạn:** chỉ các mục ở bảng 1 thay thế nội dung tương ứng của master. Mọi quy tắc dịch khác của master và module giữ nguyên hiệu lực.

---

## 1. Các điểm ghi đè đối với master

| Master | Trong framework |
|---|---|
| §3.4: "Một đoạn gốc → một đoạn dịch (trừ khi tách/gộp là bắt buộc…)" | **Luôn 1:1 theo đoạn.** Được tách hoặc ghép **câu** trong cùng một đoạn, không tách hoặc gộp **đoạn**. Dấu ngắt cảnh (`***`, `---`, `◇`…) là một đoạn riêng, giữ nguyên ký hiệu |
| §4.3, §8: `[Chú thích: …]` "ở cuối" | Ghi vào file **notes** được giao (`reviews/<batch>/notes.md`, mục `## Chương N`), **không** ghi vào file truyện *(mặc định; người dùng có thể đổi để chú thích vào EPUB)* |
| §10.1: hậu kỳ sau `---` ở cuối bản dịch | `[Chú thích]`, `[Thuật ngữ mới]`, `[Cần xác nhận]` đều ghi vào file **notes**. Đề xuất thuật ngữ, nhân vật, xưng hô **cũng** ghi vào file **proposals** (mục 4) |
| §14: "Người dùng yêu cầu sửa bản dịch cũ…" | Translator không sửa bản dịch cũ. Sửa cục bộ do Literary Editor làm (mode REWORK). Translator chỉ dịch lại cả chương ở mode REDRAFT (mục 5) |
| §16: "Trả về DUY NHẤT bản dịch" | Bản dịch **ghi vào file** được giao. Câu trả lời trong chat chỉ là báo cáo ngắn theo mẫu của agent `translator` |

Mọi lệnh cấm "tự thêm chú thích, ghi chú người dịch" (trong master hay module) áp dụng cho **file truyện**. File notes là kênh duy nhất cho các ghi chú cần thiết theo §10.1.

## 2. Trinh sát nguồn (nội bộ, trước khi dịch)

1. Xác định ngôn ngữ và chữ viết (`en`, `zh-Hans`, `zh-Hant`), số chương, độ đầy đủ, định dạng bất thường.
2. Xác định thể loại, bối cảnh, thời đại (lịch sử hay hư cấu), tôn ti xã hội, người kể chuyện, giọng văn. Phân biệt chỗ **đã chắc** và chỗ **chưa chắc**.
3. Đọc `characters.md`, `relationships.md` (đúng **phạm vi chương** hiện tại), `glossary.md`, và tóm tắt các chương trước. **Không mặc định** nhân vật, quan hệ họ hàng, triều đại, cấp bậc hay diễn biến tình cảm theo khuôn thể loại.
4. Đánh dấu chỗ mơ hồ: chủ ngữ bị lược, đại từ, thành ngữ, mỉa mai, kính ngữ, cách đọc Hán-Việt của tên.

## 3. Quy trình dịch và tự soát (không thay cho Literary Editor)

Batch nhiều chương: làm trọn bước 1–5 cho **từng chương** (ghi file xong) rồi mới sang chương sau. Bước 6 làm **một lần** cho cả batch, sau chương cuối.

1. Đọc toàn chương nguồn và context liên quan; đếm số đoạn.
2. Dịch đủ mọi đoạn theo đúng thứ tự (master §10: Draft).
3. **Lượt tiếng Việt:** đọc bản dịch **không nhìn nguồn**, sửa văn dịch máy, trật tự từ, danh xưng gượng (theo `vietnamese-style.md`).
4. **Lượt trung thành:** đọc lại nguồn để bắt lỗi nghĩa phát sinh ở lượt 3, nhất là phủ định, chủ thể hành động, từ hạn định, quan hệ.
5. Kiểm tên, danh xưng, thuật ngữ, xưng hô, độ đầy đủ, **số đoạn = số đoạn nguồn** (master §15) **trước khi `Write`**. File chương bạn `Write` là bản cuối của bạn.
6. Sau chương cuối: ghi summaries, notes và proposals **trong cùng một lượt** (mục 3.1).

Tự soát **không** phải review: không được tự kết luận PASS.

### 3.1 Nhịp làm việc (vì usage)

Mỗi lượt (mỗi lần gọi tool rồi chờ kết quả) gửi lại **toàn bộ** context đã đọc: khoảng 70k token trước khi đọc chương đầu, khoảng 180k khi xong batch. Lượt thừa ở cuối batch là lượt đắt nhất. Vì vậy:
- **Lượt đầu:** đọc song song, trong **một** lượt, mọi file bắt buộc của agent và mọi file orchestrator giao (prompt, module, context, context tạm, proposals, summaries). Genre đã có trong prompt của orchestrator; chỉ đọc `book.yaml` cùng lượt đó.
- **Mỗi chương:** đọc raw (có thể gộp với lượt `Write` của chương trước), rồi `Write` file chương.
- **Sau khi đã `Write`:** không `Edit` lại file chương. Ngoại lệ: phát hiện sai nghĩa hoặc thiếu đoạn; khi đó gom mọi `Edit` của chương đó vào **một** lượt và ghi lý do vào notes. Lỗi nhất quán câu chữ nhỏ để Literary Editor sửa.
- **Không** `Grep` hay `Glob` bản dịch, thư mục truyện hay thư mục đích để tự soát (số đoạn, chữ Hán, biến thể cấm, từ vùng miền, thống nhất thuật ngữ, file đã có chưa). Orchestrator kiểm cấu trúc bằng shell, Literary Editor soát sau.
- Danh sách cần nộp trong batch (ví dụ cặp từ theo quyết định vùng từ, thuật ngữ mới, chỗ mơ hồ) **ghi nhớ trong lúc dịch**; không grep lại bản dịch để lập danh sách.
- **Lượt cuối:** `Write` summaries và notes, nối proposals bằng **một** `Edit` (file đã có phần của người dùng thì không `Write` đè; chưa có file thì `Write`), tất cả gửi song song trong cùng một lượt; lượt sau chỉ còn câu trả lời cho orchestrator.

Batch 3 chương: khoảng 6–7 lượt.

## 4. Đề xuất context (không suy diễn)

Mỗi đề xuất trong file proposals có dạng:
```markdown
- loại: nhân vật | quan hệ/xưng hô | thuật ngữ | sửa mục cũ
  mục: "<tên gốc> → <bản dịch>" hoặc "<A> → <B>: tự xưng … / gọi …"
  từ chương: N
  nguồn: "chương N, đoạn k: <trích nguyên văn ngắn>"
  độ chắc: CHẮC | CHƯA CHẮC
  lý do: …
```
- Không có trích dẫn nguồn thì không đề xuất.
- Mâu thuẫn với context đã duyệt: **không** tự dịch theo bản mới. Dịch theo context đã duyệt, rồi đề xuất loại `sửa mục cũ`.
- Không bao giờ sửa trực tiếp `context/*.md` đã duyệt.

## 5. Mode REDRAFT (dịch lại cả chương)

Chỉ dùng khi:
- (a) kiểm tra cấu trúc thất bại ở mức toàn chương: sai chương, thiếu trên 20% số đoạn, file rỗng hoặc hỏng; hoặc
- (b) Literary Editor ghi chương là `REDRAFT` (vượt ngưỡng sửa cục bộ).

Lỗi cục bộ **không** đi qua mode này.

- Nhận: raw, lý do (lỗi cấu trúc, hoặc report của Editor), đường dẫn **version mới**.
- Dịch lại **toàn chương** từ nguồn theo master, module và context (mục 3), tránh đúng các lỗi được nêu. Không chép bản cũ một cách máy móc; giữ những lựa chọn đã đúng (tên, thuật ngữ, xưng hô theo context).
- Report của Editor là chỉ dẫn, không phải bản phải chép. Gợi ý nào trái nguồn hay trái context thì không theo, và nêu lý do trong câu trả lời.
- Ghi vào version mới. Không ghi đè version cũ. Số đoạn bằng raw.

## 6. Module thể loại

- Nạp đúng các module trong `book.yaml → genre` (master §12.3). Quy tắc thể loại **chỉ** lấy từ module đã nạp; không tự áp quy tắc của thể loại khác theo ấn tượng về văn bản.
- Văn bản có cảnh lệch thể loại (ví dụ hồi tưởng cổ đại trong truyện hiện đại): theo module chính, chỗ lệch ghi vào notes `[Cần xác nhận]`.
- Hệ thống cảnh giới, dị năng, vật phẩm theo glossary **của truyện này**; không mượn hệ thống của truyện khác.
- **CONTEXT_INIT khi `book.yaml` chưa có `genre`:** đọc danh sách `prompts/modules/*.md`, chọn module phù hợp từ bằng chứng trong các chương mẫu, ghi vào `style-notes.md` mục `## Thể loại`:
  ```markdown
  ## Thể loại
  genre: <tên module> | [<module>, <module lớp phủ>]
  bằng chứng: chương N: "<trích ngắn>"; …
  độ chắc: CHẮC | CHƯA CHẮC
  ```
  Khi đó dựng context theo module đã chọn (đọc module đó trước khi viết context). Không module nào phù hợp: ghi `genre: none` và nêu lý do.

## 7. Output contract

- **File truyện:** dòng 1 là `# <tiêu đề chương tiếng Việt>`, một dòng trống, rồi các đoạn văn cách nhau **một dòng trống**. Không frontmatter, không bảng QA, không lời dẫn, không code fence, không hậu kỳ.
- Giữ ngắt đoạn của người nói, dấu câu hội thoại (`“…”`), dấu ngắt cảnh. File phải phù hợp để chuyển sang EPUB.
- **Notes, proposals, summaries:** chỉ ghi vào đúng file orchestrator giao.
- Nguồn không đầy đủ hoặc không đọc được: trả `BLOCKED` kèm lý do chính xác. Không bịa đoạn thiếu.

## 8. Ví dụ minh họa (không phải luật thay thế)

- "Hay lắm thật!" có thể tự nhiên hơn là "Hay thật đấy!". Chọn theo ý người nói (khen thật hay mỉa).
- "Cung thân vương thế tử" có thể là "Thế tử Cung Thân vương" nếu đúng là con thừa kế của Cung Thân vương. Không đổi danh hiệu cố định khi không có bằng chứng.
- "Ta đối với nàng rất thất vọng" có thể là "Ta rất thất vọng về nàng". Trật tự từ quan trọng.
- Truyện hiện đại: "Trong lòng hắn không khỏi trầm xuống" nên là "Lòng anh chùng xuống" (đại từ theo `characters.md`). Giọng cổ trang trong truyện hiện đại là lỗi giọng văn, không phải lựa chọn phong cách.
