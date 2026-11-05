# Pilot Slice T5: Translator (Sonnet) → Literary Editor (Opus)

Mục tiêu: trước khi dùng mô hình D-16 cho các chương mới, so nó với mô hình cũ trên **cùng 3 chương**, theo tiêu chí 11–13 ở mục 14 của blueprint.

## 1. Chọn chương: dùng lại ch 6–8 làm đối chứng

| Nhánh | Mô hình | Bản dịch | Usage |
|---|---|---|---|
| **A (cũ)** | Translator Opus → Critic Opus (đã chạy 2026-11-04, batch b0003, Critic `PASS`, không có vòng sửa) | `books/kzgd/translated/chapter-000{6,7,8}.v1.md` | Đã đo từ transcript: Translator 15 lượt, cache read 1 638 152, cache write 302 660, output 77 039 (thinking 37 845). Critic 11 lượt, cache read 898 134, cache write 150 452, output 36 498 |
| **B (mới)** | Translator Sonnet → Literary Editor Opus | `books/kzgd-pilot/translated/chapter-000{6,7,8}.v2.md` | Đo bằng `novel agent-check` |

Lý do chọn ch 6–8 thay vì ch 9–11:
- nhánh A đã có sẵn bản dịch và số đo, nên không tốn thêm usage cho mô hình cũ;
- skill cũ đã được thay, không còn chạy lại được.

**Điều kiện công bằng:** nhánh B phải nhận **đúng context mà nhánh A đã nhận** lúc dịch b0003:
- context đã duyệt v1;
- proposals b0001, b0002;
- của b0003, **chỉ** mục `## Quyết định của người dùng` (U4, U5);
- **không** có các đề xuất mà Translator viết sau khi dịch ch6–8, cũng **không** có b0004 (U6–U10 ra đời sau b0003).

## 2. Chuẩn bị `books/kzgd-pilot/` (chỉ sao chép, không sửa `books/kzgd/`)

**Đã chuẩn bị 2026-11-05** (`books/kzgd-pilot/pilot/README.md`). Ngoài danh sách dưới, thư mục còn có report Critic của b0001 và b0002, để main tóm kết luận về đề xuất context như skill mới yêu cầu. Danh sách:
- `book.yaml` (đổi `id: kzgd-pilot`), `manifest.json`;
- `raw/chapter-0006.md` … `chapter-0008.md`;
- `context/characters.md`, `relationships.md`, `glossary.md`, `style-notes.md`;
- `context/proposals/b0001.md`, `b0002.md`;
- `context/proposals/b0003.md`, chỉ phần `## Quyết định của người dùng`;
- `reviews/b0001/summaries.md`, `reviews/b0002/summaries.md`;
- `status.json` tối giản:
  - `context` v1 `APPROVED`;
  - ch6–8 `raw = DONE` với `raw_hash` lấy từ status gốc;
  - batch `b0001`, `b0002` `PENDING_USER_APPROVAL` (để context tạm được truyền đúng như lúc chạy A);
  - batch `b0003` = ch 6–8, chưa dịch.

## 3. Chạy nhánh B

```
/clear
/novel-translate kzgd-pilot --range 6-8 --auto
```

- **Phải có `--auto`:** b0001 và b0002 đang `PENDING_USER_APPROVAL`, nên không có `--auto` thì skill sẽ dừng ở bước "không dồn việc". Lần chạy b0003 gốc cũng dùng `--auto`. Phạm vi chỉ có 1 batch, nên vẫn dừng sau b0003.
- Nếu skill hỏi về các mục `Cần xác nhận` trong context, trả lời `dùng đề xuất (U3 đã chốt ở proposals b0001)`, đúng như lần chạy gốc.

Skill dừng ở Human Approval Checkpoint. **Không approve** (đây là pilot). Ghi lại:
- dòng `Agent:` của báo cáo (agentId, model, usage);
- `EDIT-CHECK: PASS/FAIL` và các `WARN`;
- số change ID mỗi chương, số `REDRAFT`.

Nếu `agent-check` báo `chạy: background` thì pilot không hợp lệ cho phần usage: báo lại để sửa trước.

## 4. Chấm mù bằng reviewer chuẩn (`critic`, chỉ đọc)

1. Sao chép bản dịch thành hai bộ ẩn danh, ghi bảng gán vào `books/kzgd-pilot/pilot/assignment.md` (người dùng giữ; reviewer không được đọc):
   - `books/kzgd-pilot/pilot/X/chapter-000N.md`;
   - `books/kzgd-pilot/pilot/Y/chapter-000N.md`.
2. Gọi `critic` `MODE: REVIEW` **hai lần riêng**, một lần cho X và một lần cho Y. Hai lần nhận cùng input: raw ch6–8, bộ bản dịch, context như mục 1, tóm tắt 3 chương trước.
3. Lưu report:
   - `npm run -s novel -- save-report books/kzgd-pilot --agent <id> --out reviews/pilot/review-X.md`;
   - tương tự cho `review-Y.md`.

## 5. Kiểm tra tự động (cả hai bộ)

| Kiểm tra | Cách |
|---|---|
| Số đoạn, chữ Hán sót, ghi chú lọt | contract mục 6 |
| Biến thể cấm trong glossary | `grep` cột "Biến thể cấm" của `glossary.md` trên từng bộ |
| Cặp xưng hô chính | `grep` các cặp theo `relationships.md` (Chu Vân ↔ Quan Viễn Phong) trong lời thoại; đếm lệch |
| Vùng từ (U4: miền Nam) | `grep` danh sách từ miền Bắc ở proposals b0003 mục A |

## 6. Đọc mù của người dùng

Chọn 2–3 cảnh (có thoại của cặp chính, có cảnh tả). Đọc bản X và Y cạnh nhau, chọn bản hay hơn hoặc "ngang nhau", **trước khi** mở `assignment.md`.

## 7. Kết luận (blueprint mục 14)

| Tiêu chí | Đạt khi |
|---|---|
| 11. Chất lượng | Reviewer chuẩn: B có `CRITICAL` ≤ A, `MAJOR` ≤ A + 1. Kiểm tra tự động không có lỗi mới. Đọc mù: không chọn A ở ≥ 2/3 cảnh |
| 12. Biên tập có kiểm soát | `EDIT-CHECK: PASS`. Không chương nào sửa trên 30% số đoạn mà không ghi `REDRAFT`. Mọi change ID có `basis` hợp lệ (đọc lướt `editor-batch.md`) |
| 13. Usage | % `/usage` của nhánh B (đo trước và sau lệnh ở mục 3) thấp hơn nhánh A, tính theo token ở mục 1 quy đổi cùng cách. Ghi kèm token thô của cả hai nhánh |

**Đạt:**
- xóa `.claude/agents/critic.md`, mục `critic` trong CLAUDE.md và ngoại lệ ở mục 14.2 của blueprint;
- `prompts/critic-master.md` chuyển sang `docs/archive/` (không xóa);
- giữ hoặc xóa `books/kzgd-pilot/` tùy ý.

**Không đạt:** ghi lý do vào blueprint mục 6.0 và chọn một trong hai:
- (a) chỉnh chính sách hoặc prompt rồi chạy lại pilot;
- (b) quay về mô hình cũ. Prompt cũ vẫn còn: `critic-master.md`, và `translation-workflow.md` cũ trong lịch sử Git của repo framework.
