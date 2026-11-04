# EPUB export recipe (Pandoc + epubcheck, không cần code mới)

Dùng chung cho EPUB đọc thử (cuối batch) và EPUB cuối (`/novel-finalize`). Kiểm công cụ trước: `pandoc --version` (cần ≥ 3.0 vì `--split-level`), `epubcheck --version`. Thiếu công cụ thì báo `NOT_IMPLEMENTED`, không giả vờ đã xuất.

## 1. Chọn file

- **Bản cuối:** mỗi chương lấy `translated/chapter-NNNN.<approved_version>.md` theo `status.json`. Thiếu `approved_version` thì dừng.
- **Bản đọc thử:** lấy `current_version` của các chương đã có bản dịch; tên file `.draft.epub`; trang đầu ghi rõ "BẢN ĐỌC THỬ — chưa duyệt".
- Sắp xếp theo số chương tăng dần. Không lấy bất cứ file nào ngoài `translated/`.

## 2. Chuẩn bị trong `output/.build/` (xóa và tạo lại mỗi lần)

Dòng mở đầu bằng ký tự Markdown sẽ bị Pandoc hiểu sai (thoại bắt đầu bằng `- ` thành danh sách…), nên escape trước:

```bash
mkdir -p books/<id>/output/.build && rm -f books/<id>/output/.build/*.md
for f in <danh sách file theo thứ tự>; do
  n=$(basename "$f" | sed -E 's/chapter-([0-9]{4}).*/\1/')
  sed -E \
    -e '2,$ s/^([-*+]) /\\\1 /' \
    -e '2,$ s/^([0-9]+)([.)]) /\1\\\2 /' \
    -e '2,$ s/^(>|#)/\\\1/' \
    "$f" > "books/<id>/output/.build/$n.md"
done
```

Chỉ dòng 1 (`# tiêu đề`) được giữ là heading. Dòng ngắt cảnh `---` và `***` đứng riêng được giữ là đường kẻ (scene break).

`books/<id>/output/.build/metadata.yaml`:
```yaml
title: "<book.yaml: title_vi (thiếu thì hỏi người dùng)>"
author: "<book.yaml: author>"
lang: vi
rights: "Bản dịch cá nhân"
identifier: "<book-id>"
```

## 3. Xuất

```bash
pandoc --from=markdown --to=epub3 --toc --toc-depth=1 --split-level=1 \
  --metadata-file=books/<id>/output/.build/metadata.yaml \
  -o books/<id>/output/.build/out.epub books/<id>/output/.build/[0-9]*.md \
&& mv books/<id>/output/.build/out.epub books/<id>/output/<id>[.draft].epub
```

## 4. Kiểm tra

| Kiểm tra | Lệnh | Đạt khi |
|---|---|---|
| Hợp lệ | `epubcheck books/<id>/output/<id>.epub` | không có `ERROR` hoặc `FATAL` |
| Số mục lục | `unzip -p <epub> EPUB/nav.xhtml \| grep -o 'id="toc-li-' \| wc -l` (đếm `<li` sẽ tính nhầm cả landmarks) | bằng số chương xuất |
| Unicode tiếng Việt | `unzip -p <epub> EPUB/text/ch001.xhtml \| head -40` | dấu tiếng Việt hiển thị đúng |
| Không lẫn ghi chú | `unzip -p <epub> 'EPUB/text/*.xhtml' \| grep -cE 'Chú thích:\|Thuật ngữ mới\|Cần xác nhận\|VERDICT'` | 0 |

Báo cáo rõ kiểm tra nào đã chạy và kiểm tra nào bị bỏ qua. Không ghi "hợp lệ" nếu epubcheck chưa chạy.
