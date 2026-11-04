# Translation Workflow Addendum — dùng kèm `translation-master.md`

> `translation-master.md` là **bộ luật dịch** (bản V1, giữ nguyên văn). File này chỉ quy định **cách làm việc trong framework**: ghi file thay vì trả lời chat, mode FIX, đoạn 1:1, ghi chú tách khỏi truyện.
> **Ghi đè có giới hạn:** chỉ các mục ở bảng 1 thay thế nội dung tương ứng của master. Mọi quy tắc dịch khác của master (xưng hô, tên riêng, thơ, đơn vị, nội dung nhạy cảm…) giữ nguyên hiệu lực.

---

## 1. Các điểm ghi đè đối với master

| Master | Trong framework |
|---|---|
| Đầu file: "dán làm System Prompt…", Phụ lục A/B/C là mẫu | Glossary, bảng xưng hô, ghi chú riêng của truyện nằm ở `books/<id>/context/`. Phụ lục của master chỉ là **mẫu tham khảo**, không phải context của truyện đang dịch |
| §3.4: "Một đoạn gốc → một đoạn dịch (trừ khi tách/gộp là bắt buộc…)" | **Luôn 1:1 theo đoạn.** Được tách hoặc ghép **câu** trong cùng một đoạn, không tách hoặc gộp **đoạn**. Dấu ngắt cảnh (`***`, `---`, `◇`…) là một đoạn riêng, giữ nguyên ký hiệu |
| §4.3, §8: `[Chú thích: …]` "ở cuối" | Ghi vào file **notes** được giao (`reviews/<batch>/notes.md`, mục `## Chương N`), **không** ghi vào file truyện *(mặc định; người dùng có thể đổi để chú thích vào EPUB)* |
| §10.1: hậu kỳ sau `---` ở cuối bản dịch | `[Chú thích]`, `[Thuật ngữ mới]`, `[Cần xác nhận]` đều ghi vào file **notes**. Đề xuất thuật ngữ, nhân vật, xưng hô **cũng** ghi vào file **proposals** (mục 4) |
| §14: "Người dùng yêu cầu sửa bản dịch cũ…" | Chỉ sửa qua mode FIX (mục 5), theo issue có bằng chứng |
| §16: "Trả về DUY NHẤT bản dịch" | Bản dịch **ghi vào file** được giao. Câu trả lời trong chat chỉ là báo cáo ngắn theo mẫu của agent `translator` |
| §12.1: truyện hiện đại (ngắn) | Áp dụng §12.1 và mục 6 của file này khi `genre` là hiện đại, đô thị, tận thế. **Không** mặc định giọng cổ trang Hán-Việt cho truyện hiện đại |

Module thể loại (ví dụ `modules/eastern-ancient.md`) cấm "tự thêm chú thích, ghi chú người dịch". Lệnh cấm này áp dụng cho **file truyện**. File notes là kênh duy nhất cho các ghi chú cần thiết theo §10.1.

## 2. Trinh sát nguồn (nội bộ, trước khi dịch)

1. Xác định ngôn ngữ và chữ viết (`en`, `zh-Hans`, `zh-Hant`), số chương, độ đầy đủ, định dạng bất thường.
2. Xác định thể loại, bối cảnh, thời đại (lịch sử hay hư cấu), tôn ti xã hội, người kể chuyện, giọng văn. Phân biệt chỗ **đã chắc** và chỗ **chưa chắc**.
3. Đọc `characters.md`, `relationships.md` (đúng **phạm vi chương** hiện tại), `glossary.md`, và tóm tắt các chương trước. **Không mặc định** nhân vật, quan hệ họ hàng, triều đại, cấp bậc hay diễn biến tình cảm theo khuôn thể loại.
4. Đánh dấu chỗ mơ hồ: chủ ngữ bị lược, đại từ, thành ngữ, mỉa mai, kính ngữ, cách đọc Hán-Việt của tên.

## 3. Quy trình dịch và tự soát (không thay cho Critic)

1. Đọc toàn chương nguồn và context liên quan; đếm số đoạn.
2. Dịch đủ mọi đoạn theo đúng thứ tự (master §10: Draft).
3. **Lượt tiếng Việt:** đọc bản dịch **không nhìn nguồn**, sửa văn dịch máy, trật tự từ, danh xưng gượng (theo `vietnamese-style.md`).
4. **Lượt trung thành:** đọc lại nguồn để bắt lỗi nghĩa phát sinh ở lượt 3, nhất là phủ định, chủ thể hành động, từ hạn định, quan hệ.
5. Kiểm tên, danh xưng, thuật ngữ, xưng hô, độ đầy đủ, **số đoạn = số đoạn nguồn** (master §15).
6. Ghi file truyện; ghi notes và proposals riêng.

Tự soát **không** phải review: không được tự kết luận PASS.

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

## 5. Mode FIX (sau Critic, hoặc theo ghi chú `rework` của người dùng)

- Nhận: issue ID, report, version hiện hành, đường dẫn **version mới**.
- Với mỗi issue: đọc **đoạn nguồn** và đoạn dịch; sửa đúng đoạn đó (±1 đoạn nếu câu nối liền).
- Chỉ sửa lỗi **có căn cứ**. Giữ nguyên cách diễn đạt đã trung thành và tự nhiên. Không viết lại theo khẩu vị.
- Không bắt buộc chép `proposed fix` của Critic; viết câu đúng nhất theo nguồn và master. Gợi ý trái nguồn thì **không sửa** và nêu lý do.
- Sửa tên, danh xưng hay thuật ngữ thì rà các chỗ khác trong **cùng chương** để tránh hồi quy.
- Ghi toàn bộ chương (đã sửa) vào version mới. Không ghi đè version cũ. Số đoạn không đổi.

## 6. Ghi chú thể loại (chỉ bật khi văn bản thật sự thuộc thể loại đó)

- **Cổ đại, cung đấu, trạch đấu:** cấp bậc, tôn ti hoàng thất, quan hệ họ hàng, lời nói gián tiếp, phép tắc công khai và riêng tư (master §5, `modules/eastern-ancient.md`).
- **Võ hiệp, tiên hiệp, huyền huyễn:** hệ thống môn phái, cảnh giới, vật phẩm theo glossary **của truyện này**; không mượn hệ thống của truyện khác.
- **Ngôn tình:** tiến triển quan hệ, độ thân mật, cảm xúc; không tô vẽ thêm.
- **Hiện đại, đô thị, tận thế:** xưng hô và ngôn ngữ xã hội hiện đại tự nhiên (master §12.1). Tên người vẫn theo glossary. Từ ngữ hệ thống, dị năng, quân sự dùng tiếng Việt hiện đại chuẩn.

## 7. Output contract

- **File truyện:** dòng 1 là `# <tiêu đề chương tiếng Việt>`, một dòng trống, rồi các đoạn văn cách nhau **một dòng trống**. Không frontmatter, không bảng QA, không lời dẫn, không code fence, không hậu kỳ.
- Giữ ngắt đoạn của người nói, dấu câu hội thoại (`“…”`), dấu ngắt cảnh. File phải phù hợp để chuyển sang EPUB.
- **Notes, proposals, summaries:** chỉ ghi vào đúng file orchestrator giao.
- Nguồn không đầy đủ hoặc không đọc được: trả `BLOCKED` kèm lý do chính xác. Không bịa đoạn thiếu.

## 8. Ví dụ minh họa (không phải luật thay thế)

- "Hay lắm thật!" có thể tự nhiên hơn là "Hay thật đấy!". Chọn theo ý người nói (khen thật hay mỉa).
- "Cung thân vương thế tử" có thể là "Thế tử Cung Thân vương" nếu đúng là con thừa kế của Cung Thân vương. Không đổi danh hiệu cố định khi không có bằng chứng.
- "Ta đối với nàng rất thất vọng" có thể là "Ta rất thất vọng về nàng". Trật tự từ quan trọng.
