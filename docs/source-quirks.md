# Source quirks — kiến thức thực tế từ bản Python V1

Mỗi mục là một hành vi **bắt buộc** mà bản TS phải giữ. Cột "Kiểm chứng" cho biết cách test:
- **golden**: so với `tests/golden/**`, file do Python V1 sinh ra (`tools/export_golden.py` trong project V1).
- **spec**: không có golden (cần mạng, thời gian hoặc file system); viết test TS theo mô tả.

Nguồn gốc: các sự cố thật trong khi cào HYWYW (69shuba) và KZGD (52shuku), tháng 11/2026.

## CORE — dùng chung

| ID | Hành vi | Vì sao (sự cố thật) | Kiểm chứng |
|---|---|---|---|
| CORE-01 | Đổi số chữ Hán sang số: `十二`→12, `一百零五`→105, `两千零五`→2005, `一万二千`→12000, `四一二`→412 | Tiêu đề kiểu `第一百二十章` | golden `core/numerals.json` |
| CORE-02 | Lấy số chương từ tiêu đề `第N章`, chấp nhận số full-width `第４１２章` và khoảng trắng `第 7 章` | **TS:** `parseInt("４１２")` ra `NaN`, phải `normalize("NFKC")` trước | golden `core/numerals.json` |
| CORE-03 | Lọc rác theo từng đoạn bằng regex mặc định của adapter + `junkPatterns` trong config | Mỗi site chèn rác kiểu khác | golden `core/junk.json` |
| CORE-04 | Regex trong config ở dạng `{ pattern, flags }` | **TS:** JS không hỗ trợ cờ inline `(?i)` (Python có) | spec |
| CORE-05 | Retry có backoff (10s, 20s…); **luôn nghỉ giữa các request kể cả khi lỗi**; không retry `BLOCKED` | Trước đây lỗi xong là gửi request kế tiếp ngay, dồn tải lên site | spec |
| CORE-06 | Dừng batch sau N chương lỗi liên tiếp (mặc định 3); dừng ngay khi `BLOCKED` | Khi Cloudflare chặn, mỗi chương vẫn chờ hết timeout | spec |
| CORE-07 | Nội dung trùng hash với chương liền kề thì `FAILED` | Site trả nhầm trang | spec |
| CORE-08 | Độ dài so với trung vị của các chương **trong phạm vi ±20**: < 0,5× hoặc > 2× thì `SUSPECT` | Trung vị cả bộ cho cảnh báo sai (KZGD 122, 124); chương bị gộp dài gấp 3 lần (KZGD 63 = 14.552 ký tự) mà không bị phát hiện | spec |
| CORE-09 | Tỷ lệ ký tự trích ra / text của container < 0,9 thì `SUSPECT` | Lỗi `<p>` không đóng (SHUKU-03) làm mất 1 đoạn mỗi trang mà không báo gì | spec (mới, V1 chưa có) |
| CORE-10 | Lock file theo từng truyện; chặn lệnh thứ hai | Hai tiến trình cùng ghi state gây crash (KZGD 191) | spec (mới) |
| CORE-11 | Ghi file atomic bằng file tạm có PID riêng rồi đổi tên | Như trên | spec |
| CORE-12 | Cache HTML gốc kèm `parserVersion`; đổi parser thì parse lại offline | Sửa lỗi SHUKU-03 xong phải tải lại 521 trang | spec (mới; V1 chỉ cache đoạn văn đã parse) |
| CORE-13 | Chương đã có raw hợp lệ thì bỏ qua; `--recrawl` để ép cào lại | Tránh làm phiền site và vượt Cloudflare lại | spec |
| CORE-14 | Nội dung < 200 ký tự thì `FAILED` | Trang trắng hoặc trang khóa | golden `shuba69/chapter-too-short.json` |

## SHUBA — 69shuba (Playwright, Cloudflare)

| ID | Hành vi | Vì sao | Kiểm chứng |
|---|---|---|---|
| SHUBA-01 | `/book/9001.htm` → `/book/9001/` (trang mục lục); bỏ query và fragment | URL người dùng copy thường là `.htm` | golden `normalize-book-url.json` |
| SHUBA-02 | Mục lục: chỉ lấy `.catalog a[href*='/txt/']`; bỏ trùng URL; mục không có số (楔子) thì bỏ; trùng số thì giữ cái đầu và cảnh báo | Có đánh số lại theo quyển; có link "最新章节" ngoài catalog | golden `catalog-title.json` |
| SHUBA-03 | `numbering: order`: đánh số theo ID cuối URL, tăng dần | Bộ có 楔子/番外 không đánh số | golden `catalog-order.json` |
| SHUBA-04 | Nội dung là các **text node trực tiếp** của `.txtnav`, ngăn cách bằng `<br>`; bỏ `<div class="contentadv">`; bỏ dòng trùng `<h1>` | Cấu trúc thật của site | golden `chapter-basic.json` |
| SHUBA-05 | Bỏ dòng tiêu đề lặp ở đầu thân bài dù khác `<h1>` một chút (`第14章 灯下……夜谈`) | HYWYW 536, 538 bị lặp tiêu đề | golden `chapter-repeated-heading.json` |
| SHUBA-06 | Lọc `（到潇湘书院看更新）`, `(本章完)`, watermark `69书吧/69shu`; **giữ** `————` | 6/12 chương HYWYW có dòng quảng cáo | golden `chapter-promo.json` |
| SHUBA-07 | Số trong tiêu đề ≠ số yêu cầu thì `FAILED` (khi `numbering: title`) | Site trả nhầm chương | golden `chapter-mismatch.json` |
| SHUBA-08 | Phát hiện challenge: title chứa `just a moment` / `security verification`, hoặc text `Verify you are human`. Headless thì `BLOCKED`; có cửa sổ thì chờ người dùng tự xác minh (tối đa 300s) rồi `BLOCKED` | Nguyên tắc truy cập: **không tự động vượt** | golden viết tay `challenge.json` |
| SHUBA-09 | Cache mục lục; nếu cần chương chưa có thì tải lại mục lục **một lần** mỗi lần chạy | Truyện đang ra chương mới | spec |
| SHUBA-10 | Mở Chrome **lười**: chỉ khi thật sự cần tải trang | Chương đã có raw thì không phải bật trình duyệt | spec |
| SHUBA-11 | Profile Chrome bền vững nằm trong `.cache/`, không bao giờ commit | Profile chứa Cookies và Login Data | spec + `.gitignore` |

## SHUKU — 52shuku (HTTP, chia theo trang)

| ID | Hành vi | Vì sao | Kiểm chứng |
|---|---|---|---|
| SHUKU-01 | `<id>_7.html` → `<id>.html` (trang giới thiệu) | Người dùng có thể copy link trang giữa | golden `normalize-index-url.json` |
| SHUKU-02 | Danh sách trang = link khớp `/<id>_(\d+).html`, sắp tăng dần, bỏ trùng; bỏ link của truyện khác | Trang giới thiệu liệt kê 521 trang | golden `page-list.json` |
| SHUKU-03 | **`<p>` cuối trang không đóng** nên nuốt khối phân trang và quảng cáo; mỗi `<p>` chỉ lấy text của chính nó | Mất đoạn cuối mỗi trang, mất tiêu đề KZGD 64, 126, 189 | golden `pages.json` (đoạn cuối mỗi trang phải còn) |
| SHUKU-04 | Lọc `52书库`, `52shuku`, `传送门：…`, `上一页/下一页/目录`; giữ `===` | Rác thật của site | golden `core/junk.json` |
| SHUKU-05 | Dòng tiêu đề: bắt đầu bằng `第N章`, ≤ 40 ký tự, không kết thúc bằng `。”？！`, **ngay sau `第N章` là hết dòng, khoảng trắng hoặc `:：、.．-—（(`** | `第1章里那句话…` bị nhận nhầm là tiêu đề (oracle phát hiện) | golden `headings.json` |
| SHUKU-06 | Bỏ phần giới thiệu (tên truyện, tác giả, 简介) đứng trước `第1章` | Trang 2 có phần giới thiệu | golden `chapters.json` (chương 1) |
| SHUKU-07 | Ghép trang: bắt đầu tại tiêu đề N, nối các trang sau, dừng khi gặp tiêu đề có số **> N** (số nhỏ hơn là câu nhắc chương cũ) | Một chương trải qua 2–4 trang | golden `chapters.json` |
| SHUKU-08 | Tìm trang chứa tiêu đề N bằng tìm kiếm nhị phân theo "chương đang diễn ra ở cuối trang" | Chương 120 chỉ cần 14 request thay vì khoảng 350 | spec (đếm số request) |
| SHUKU-09 | N lớn hơn chương cuối thì lỗi "chương cuối là X"; không có tiêu đề N thì `FAILED`, không âm thầm gộp chương | | golden `chapters.json` (chương 5) |
| SHUKU-10 | Cache từng trang kèm `parserVersion`; cache cũ thì tải lại | Cache bằng parser lỗi đã làm hỏng dữ liệu | spec |
| SHUKU-11 | `metadata.pages` = danh sách số trang đã ghép | Để truy vết khi chương bị nghi lỗi | golden `chapters.json` |

## Hạn chế đã biết (giữ nguyên, có thể sửa sau)

- **SHUKU-05:** tiêu đề kết thúc bằng `”`, `？`, `！` (ví dụ `第5章 “谁？”`) sẽ **không** được nhận là tiêu đề, và chương đó sẽ `FAILED`. Golden đang ghi nhận hành vi này (`null`). Nếu gặp ở site thật, sửa cả quy tắc lẫn golden.
- AO3, NovelLunar, FreeWebNovel chưa được port (V2).
- Raw KZGD do V1 cào **trước** khi sửa SHUKU-05 có thể có chương bị cắt sai nếu thân bài có câu dạng `第N章里…`. Khi so sánh chéo (blueprint mục 8.5), lệch ở những chương này là bình thường.
