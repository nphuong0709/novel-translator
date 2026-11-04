# Novel Translation Framework: Blueprint (Simplified)

> **Trạng thái:** đề xuất 2026-11-04, chờ người dùng duyệt. Thay phần **dịch, review, lưu trữ, backup** của `blueprint-v4.md`. Phần ingest của v4 (mục 2, 6, 8) và code Slice 1 vẫn giữ nguyên giá trị.
> **Lý do thay:** `docs/architecture-review-simplification.md`.
> **Bằng chứng năng lực Claude Code:** `docs/capability-verification.md`.

---

## 1. Mục tiêu

Biến quy trình dịch thủ công **đã chạy được** (khoảng 57 chương) thành workflow Claude Code dùng lại được cho nhiều bộ truyện. Framework tự động hóa **việc chuyển giao dữ liệu và prompt giữa các bước**, còn người dùng kiểm soát các điểm dừng quan trọng.

Quy trình thủ công cũ và lệnh thay thế:

```
crawl → đưa raw + prompt → Claude dựng context, glossary, dịch batch → EPUB đọc thử
      → thấy lỗi xưng hô, văn dịch máy → đưa prompt Critic → Claude review + sửa → duyệt → EPUB lại
```

| Bước thủ công | Lệnh thay thế |
|---|---|
| Crawl + kiểm dữ liệu | `/novel-crawl` |
| Context + dịch + review + sửa + dừng để duyệt | `/novel-translate` |
| Review toàn bộ + xuất EPUB | `/novel-finalize` |

**Ngoài phạm vi:** Web UI, database, Git workflow, hook không cần thiết, framework multi-agent, API trả phí.

**Giả định:** người dùng có quyền sử dụng phù hợp với nguồn đầu vào; crawler không vượt CAPTCHA, paywall hay cơ chế kiểm soát truy cập (blueprint-v4 mục 2).

## 2. Nguyên tắc thiết kế

1. **Simplicity First:** ít code, ít dependency, ít thành phần.
2. **Skills điều phối, code làm việc tất định:** crawl, kiểm tra, trạng thái và export là code. Dịch và review là agent.
3. **Chất lượng đến từ prompt:** master prompt được dùng nguyên văn, không rút gọn.
4. **Critic độc lập:** khác subagent với Translator và chỉ có quyền đọc.
5. **Human-in-the-loop:** dừng sau mỗi batch; chỉ người dùng đặt được `APPROVED`.
6. **Local-first, resumable, subscription-aware:** dữ liệu là file local; tiếp tục được sau khi hết hạn mức; không tự chuyển sang API.

## 3. Kiến trúc

```
                ┌──────────────── Claude Code (phiên main, gói Pro) ────────────────┐
 người dùng ──▶ │ /novel-crawl      /novel-translate          /novel-finalize       │
                │      │                │      │                  │      │          │
                │      ▼                ▼      ▼                  ▼      ▼          │
                │  [CLI code]     Translator  Critic          Critic  Translator    │
                │  crawl/check    (subagent)  (subagent,      (Final)  (sửa)        │
                │  mark/status                 chỉ đọc)                             │
                │      │             │          │               │                   │
                └──────┼─────────────┼──────────┼───────────────┼───────────────────┘
                       ▼             ▼          ▼               ▼
                  books/<id>/  raw/ context/ translated/ reviews/ status.json output/
```

- **Phiên main** (do skill điều khiển): gọi CLI qua Bash, gọi subagent, ghi report của Critic ra file, và báo cáo cho người dùng.
- **CLI `novel`** (TypeScript, có sẵn từ Slice 1, mở rộng thêm):
  - đã có: `ingest`, `status`, `import`, `init`;
  - thêm mới: `check`, `mark`, `approve`, `export`, `backup`.
- **Không dùng hook. Không dùng Git cho dữ liệu.** Repo framework vẫn dùng Git như mọi repo code.

## 4. Cấu trúc project tối thiểu

```text
novel-translator/
├── CLAUDE.md
├── .claude/
│   ├── skills/
│   │   ├── novel-crawl/SKILL.md
│   │   ├── novel-translate/SKILL.md
│   │   └── novel-finalize/SKILL.md
│   └── agents/
│       ├── translator.md          # vai trò + danh sách file bắt buộc đọc; tools: Read, Grep, Glob, Write
│       └── critic.md              # vai trò + 3 mode; tools: Read, Grep, Glob (chỉ đọc)
├── prompts/
│   ├── translation-master.md      # = V1 novel-translation-system.md (nguyên văn, chỉ sửa §10.1)
│   ├── modules/eastern-ancient.md # = V1 eastern_ancient.md (nạp theo thể loại)
│   ├── critic-master.md           # prompt Critic của người dùng (CẦN CUNG CẤP); 3 mode
│   └── vietnamese-style.md        # chuẩn tiếng Việt, anti-translationese, ví dụ theo ngữ cảnh
├── src/                           # code có sẵn: ingest (crawler), cli; thêm: check, status, export
├── tests/
└── books/                         # gitignored (đã có trong .gitignore). KHÔNG commit
    └── {book-id}/
        ├── book.yaml              # cấu hình (người dùng sửa): url, adapter, ngôn ngữ, thể loại, model
        ├── manifest.json          # do crawler sinh: danh sách chương, tiêu đề, hash, trạng thái nguồn
        ├── status.json            # tiến độ dịch/review/duyệt (chỉ CLI ghi)
        ├── raw/NNNN.md            # nguyên tác, không bao giờ bị sửa
        ├── context/
        │   ├── characters.md      # Character Bible
        │   ├── relationships.md   # ma trận xưng hô theo phạm vi chương
        │   ├── glossary.md        # thuật ngữ | bản dịch | biến thể cấm | nguồn (chương)
        │   ├── style.md           # giọng văn riêng của truyện
        │   └── summaries.md       # 1–3 dòng mỗi chương (Translator viết)
        ├── translated/
        │   ├── NNNN.md            # bản dịch hiện hành (chỉ nội dung truyện)
        │   └── drafts/NNNN.md     # bản nháp đầu (giữ để đối chiếu)
        ├── reviews/
        │   ├── b001/chNNNN.md          # Chapter Review
        │   ├── b001/chNNNN.verify.md   # kiểm lại sau khi sửa
        │   ├── b001/batch-review.md
        │   ├── b001/context-updates.md # đề xuất cập nhật context của batch
        │   ├── b001/notes.md           # ghi chú hậu kỳ (không vào EPUB)
        │   └── final.md
        ├── output/{book-id}.epub
        └── .cache/                # HTML cache, browser profile, lock (không backup)
```

**Chuyển dữ liệu hiện có:** `../novel-books/kzgd/chapters/NNN/source.md` chuyển thành `books/kzgd/raw/NNNN.md` (giữ frontmatter hash), cộng thêm `manifest.json`. Thư mục `.git` cũ không cần nữa; bạn giữ hay xóa tùy ý.

## 5. Command contracts

### 5.1 `/novel-crawl <book-id> [--url URL] [--from N --to M] [--recrawl]`

| | |
|---|---|
| **Làm** | (1) chưa có `book.yaml` thì chạy `novel init`; (2) `novel ingest`, tức crawler bằng code (HTTP; hoặc Playwright với Chrome thật khi site cần); (3) lấy danh sách chương, trích xuất, normalize, validate; (4) ghi `raw/` + `manifest.json`; (5) báo cáo |
| **Kiểm tra nguồn** | Chương thiếu, trùng hash với chương liền kề, sai số thứ tự, nội dung < 200 ký tự, độ dài bất thường, tỷ lệ trích xuất < 0,9, còn rác: VALID / SUSPECT / FAILED / BLOCKED (code Slice 1) |
| **Báo cáo** | Số chương ở mỗi trạng thái; danh sách SUSPECT/FAILED kèm lý do; khoảng chương còn thiếu |
| **Không làm** | Không dịch; không tự vượt challenge (gặp BLOCKED thì dừng và nhờ người dùng tự xác minh trong Chrome) |
| **Resume** | Chạy lại thì bỏ qua chương đã có raw hợp lệ (CORE-13) |

### 5.2 `/novel-translate <book-id> <from>-<to> [--batch 10]` và `/novel-translate approve|rework <book-id> <batch>`

| | |
|---|---|
| **Điều kiện vào** | Mọi chương trong phạm vi có raw VALID (SUSPECT phải được người dùng chấp nhận trong `manifest.json`); không có batch nào trước đó đang ở `PENDING_USER_APPROVAL` hay `NEEDS_REWORK` (trừ khi đang sửa đúng batch đó) |
| **Bước 0, context** | Chưa có `context/` thì Translator (mode *analyze*) đọc vài chương đầu và dựng `characters`, `relationships`, `glossary`, `style`. Sau đó **dừng** (`PENDING_USER_APPROVAL` cho context) |
| **Bước 1–5, mỗi chương** (tuần tự, foreground) | Translator dịch ra `drafts/` và `translated/`, kèm tóm tắt; `novel check` chạy; Critic (Chapter) viết report; có issue thì Translator sửa đúng đoạn có issue; `novel check` so sánh; Critic kiểm lại các đoạn đã sửa ra `verify.md`; `novel mark reviewed` |
| **Bước 6, cuối batch** | Critic (Batch) đọc tóm tắt, context và các đoạn bị gắn cờ của 10–20 chương; có vấn đề thì Translator sửa đúng chương và đoạn đó, rồi kiểm lại; ghi `batch-review.md` và `context-updates.md` |
| **Bước 7, báo cáo và dừng** | `novel mark batch PENDING_USER_APPROVAL`, rồi báo cáo (mục 9). **Dừng.** Không tự sang batch kế |
| **Duyệt** | Người dùng gõ `approve`: CLI đặt `APPROVED`, gộp `context-updates.md` đã duyệt vào `context/`, tăng `contextVersion`. Gõ `rework` kèm ghi chú: `NEEDS_REWORK`, lần chạy sau chỉ sửa theo ghi chú |
| **Không làm** | Không crawl; không xuất EPUB; không dịch ngoài phạm vi; không tự đặt `APPROVED` |

### 5.3 `/novel-finalize <book-id> [<from>-<to>]`

| | |
|---|---|
| **Điều kiện vào** | Mọi batch trong phạm vi đều `APPROVED`; không chương nào bị stale (mục 10) hoặc đã được người dùng xác nhận |
| **Làm** | (1) Critic (Final) soát xuyên batch: tình tiết, nhân vật, danh xưng, thuật ngữ, phong cách, dựa trên tóm tắt, context, các batch review và các đoạn mẫu; (2) Translator sửa các vấn đề còn tồn tại; Critic kiểm lại các đoạn đó; (3) Critic kết luận `READY` hoặc `NEEDS_REWORK`; (4) `novel export` (Pandoc), rồi `epubcheck`, rồi kiểm mục lục; (5) ghi `output/` và chạy `novel backup` |
| **Không làm** | Không crawl hay dịch chương mới; không xuất khi Critic chưa `READY`, trừ khi người dùng truyền `--force` (ghi rõ vào `final.md`) |

### 5.4 Lệnh hỗ trợ

Không thêm skill. Xem tiến độ bằng `npm run novel -- status <book-id>` (mở rộng lệnh có sẵn). Resume được tích hợp sẵn: gọi lại `/novel-translate` với cùng phạm vi.

## 6. Subagent

| | **Translator** | **Critic** |
|---|---|---|
| File | `.claude/agents/translator.md` | `.claude/agents/critic.md` |
| `tools:` | `Read, Grep, Glob, Write` | `Read, Grep, Glob` (chỉ đọc; không có `Agent`, `Edit`, `Bash`) |
| Model mặc định | Opus 5.5 · effort `high` | Opus 5.5 · effort `high` (Batch Mode có thể dùng Sonnet) |
| Ghi đè | `book.yaml: models.translator` | `book.yaml: models.critic.{chapter,batch,final}` (skill truyền tham số `model`/`effort` khi gọi; B1 Q1–Q2) |
| Trách nhiệm | Phân tích nguyên tác; dịch EN/ZH → VI; giữ giọng văn theo thể loại; tuân theo glossary, Character Bible, ma trận xưng hô; tránh dịch sát chữ và văn dịch máy; **chỉ sửa các đoạn có issue**; viết tóm tắt và đề xuất cập nhật context (có nguồn chương) | Đánh giá theo mode; trả về issue report có cấu trúc; **không sửa văn bản**; phiên main ghi report ra file |
| Không được | Tự review bản dịch của mình; sửa ngoài issue; tự thêm thông tin context không có nguồn | Ghi file; gọi agent khác; đặt `APPROVED` |

Chặn subagent lồng nhau bằng cách **không cấp tool `Agent`** (B1 Q4). Không cần hook hay biến môi trường.

### 6.1 Ba mode của Critic

| Mode | Input (skill truyền đúng bộ này) | Mục tiêu và checklist | Output |
|---|---|---|---|
| **Chapter** | raw chương, bản dịch, context (bản hiện hành), tóm tắt 3 chương trước | **Phần A:** nghĩa (Semantic Fidelity), bối cảnh, nhân vật, thân phận, xưng hô. **Phần B:** ngữ pháp tiếng Việt, trật tự từ, dấu vết dịch máy, văn phong, thuật ngữ | `reviews/bNNN/chNNNN.md`: danh sách issue + dòng kết luận `VERDICT: PASS \| NEEDS_REWORK` |
| **Chapter / verify** | các đoạn đã sửa (trước và sau), đoạn nguyên tác tương ứng, issue gốc | Issue đã được giải quyết chưa; có phát sinh lỗi nghĩa mới không (Review → Fix → Revalidate) | `chNNNN.verify.md`: mỗi issue `RESOLVED \| NOT_RESOLVED \| REGRESSION` |
| **Batch** | tóm tắt của batch, context, các issue đã có của batch, `context-updates.md`, các đoạn bị `check` gắn cờ | Tính nhất quán giữa 10–20 chương: danh xưng đổi sai, quan hệ, thuật ngữ, lỗi lặp lại. **Không soát lại câu chữ từng chương** | `batch-review.md`: chỉ liệt kê chương và đoạn cần sửa; nhận xét về `context-updates`; `VERDICT` |
| **Final** | tóm tắt toàn phạm vi, context, mọi `batch-review.md`, issue còn mở, đoạn mẫu | Nhất quán xuyên batch: tình tiết, nhân vật, danh xưng, thuật ngữ, phong cách; liệt kê vấn đề còn tồn tại | `final.md`: danh sách issue + `VERDICT: READY \| NEEDS_REWORK` |

**Định dạng issue** (dùng chung cho mọi mode):
```
- id: ch0012-03
  severity: CRITICAL | MAJOR | MINOR
  rule: (một trong 10 quy tắc, mục 7)
  chapter: 12
  paragraph: 7                 # số thứ tự đoạn, 1:1 giữa raw và bản dịch
  source_excerpt: "<trích nguyên văn>"
  translation_excerpt: "<trích nguyên văn>"
  problem: "<vì sao sai, dựa trên ngữ cảnh>"
  suggestion: "<gợi ý; Translator quyết định cách viết cuối>"
```

## 7. Prompt architecture và cách nạp

| Lớp | File | Ai dùng | Nội dung |
|---|---|---|---|
| **Skill** | `.claude/skills/novel-*/SKILL.md` | phiên main | Thứ tự bước, gọi agent nào và truyền file nào, khi nào gọi CLI, khi nào dừng. **Không chứa quy tắc dịch** |
| **Agent prompt** | `.claude/agents/{translator,critic}.md` | subagent | Vai trò, phương pháp, danh sách file **bắt buộc đọc** trước khi làm, mẫu output |
| **Master prompt** | `prompts/translation-master.md`, `prompts/modules/*.md` | Translator (Critic tham chiếu) | Toàn bộ quy tắc dịch của V1, **nguyên văn** |
| | `prompts/critic-master.md` | Critic | Prompt Critic của người dùng; 3 mode với mục tiêu, phạm vi, checklist, output riêng |
| | `prompts/vietnamese-style.md` | Translator **và** Critic | Chuẩn tiếng Việt chung để hai bên dùng cùng thước đo |
| **Context** | `books/<id>/context/*` | cả hai | Dữ liệu riêng của bộ truyện |
| **Quality gate** | `novel check`, `novel mark` | phiên main (qua CLI) | Tiêu chí tất định, mục 9 |

**Cách nạp prompt:**
- Thân file agent liệt kê các file phải `Read` ở đầu mỗi lần gọi, chọn module theo `book.yaml: genre`.
- Output **bắt buộc** mở đầu bằng `Đã áp dụng: translation-master.md, vietnamese-style.md, modules/eastern-ancient.md, context v<N>`. Skill kiểm dòng này và gọi lại nếu thiếu.
- Phương án nạp sẵn qua `skills:` trong frontmatter của agent có trong tài liệu nhưng chưa được kiểm chứng; sẽ thử ở Slice T1.

**Mười quy tắc bắt buộc** (có trong cả `translation-master.md` lẫn `critic-master.md`):
1. Semantic Fidelity
2. Contextual Accuracy
3. Character & Addressing Consistency
4. Vietnamese Native Grammar
5. Natural Word Order
6. Anti-Translationese
7. Literary Fluency
8. Historical/Cultural Authenticity
9. Cross-Chapter Consistency
10. Review → Fix → Revalidate

**Ví dụ minh họa** (trong `vietnamese-style.md`; đây **không phải bảng thay thế cứng**, mỗi quyết định phải dựa vào ngữ cảnh):

| Câu dịch máy | Gợi ý | Điều kiện |
|---|---|---|
| "Hay lắm thật!" | "Hay thật đấy!" | Tùy giọng nhân vật và cảm xúc |
| "Cung thân vương thế tử" | "Thế tử Cung Thân vương" | Chỉ khi đúng quan hệ danh xưng |
| "Ta đối với nàng rất thất vọng" | "Ta rất thất vọng về nàng" | Cấu trúc 对…很… |

**Sửa bắt buộc trong master prompt V1:** §10.1 (ghi chú hậu kỳ ở cuối bản dịch) đổi thành ghi chú vào `reviews/bNNN/notes.md`. File `translated/NNNN.md` **chỉ chứa** dòng tiêu đề `# …` và các đoạn văn, đúng 1:1 với số đoạn của raw.

**Phụ thuộc chưa giải quyết:** prompt Critic mà người dùng đã dùng thủ công **chưa có trong repo**. Cần người dùng cung cấp trước Slice T1. Nếu chưa có, dựng tạm từ §15 (checklist) của master prompt, 10 quy tắc và các ví dụ trên, rồi người dùng duyệt.

## 8. Crawler workflow (giữ code Slice 1)

```
book.yaml (url, adapter) → adapter.matches → (52shuku: HTTP | 69shuba: Playwright + Chrome thật, profile riêng)
  → cache HTML → parse → lọc rác → kiểm tra (mục 5.1) → raw/NNNN.md (+ frontmatter hash) → manifest.json
```

- Đã có: retry/backoff, nghỉ giữa các request, dừng khi gặp BLOCKED hoặc sau 3 lỗi liên tiếp, lock, ghi atomic, bỏ qua chương đã có, parse lại offline khi đổi parser.
- Thêm adapter cho site mới: một file trong `src/ingest/adapters/`, kèm fixture và golden.
- Hỗ trợ trong MVP: EN → VI và ZH → VI. Tiếng Hàn và tiếng Nhật: DEFER.

## 9. Translation workflow, quality gate và duyệt batch

### 9.1 Trạng thái (`status.json`, chỉ CLI ghi, ghi atomic)

```json
{
  "contextVersion": 3,
  "chapters": {
    "12": { "stage": "reviewed", "batch": "b002", "rawHash": "…", "contextVersion": 3,
            "critic": "PASS", "issues": { "found": 5, "resolved": 5, "open": 0 } }
  },
  "batches": {
    "b002": { "range": [11, 20], "status": "PENDING_USER_APPROVAL", "critic": "PASS",
              "approvedBy": null, "approvedAt": null, "reworkNotes": null }
  },
  "final": { "critic": null, "exportedAt": null }
}
```

- `stage` của chương: `translated` → `reviewed` (đã qua Critic, đã sửa và kiểm lại).
- Batch chỉ dùng 4 trạng thái: `NEEDS_REWORK`, `BLOCKED`, `PENDING_USER_APPROVAL`, `APPROVED`.
- **Kết luận của Critic** (`critic: PASS | NEEDS_REWORK`, `final.critic: READY | NEEDS_REWORK`) tách khỏi **phê duyệt của người dùng** (`status: APPROVED`, `approvedBy: "user"`). Critic không bao giờ đặt được `APPROVED`.

### 9.2 Quality gate tất định

**`novel check <book> <chapters>`** (port từ `qa.py` V1, không gọi model):

| Kiểm tra | Kết quả |
|---|---|
| Số đoạn bản dịch ≠ số đoạn raw | FAIL |
| Còn chữ Hán / tiếng Anh chưa dịch (trừ tên trong glossary) | FAIL |
| Dùng biến thể thuật ngữ bị cấm trong `glossary.md` | FAIL |
| Xưng hô trái `relationships.md` trong phạm vi chương | WARN, chuyển cho Critic |
| Có dòng `---`, `Ghi chú`, hay dấu vết của review hoặc prompt trong `translated/` | FAIL |
| Sau khi sửa: đoạn thay đổi mà không có issue nào trỏ tới | WARN, báo trong report batch |

**`novel mark`** từ chối chuyển bước khi:
- thiếu bản nháp hoặc `check` FAIL (bước `translated`);
- thiếu `chNNNN.md` có `VERDICT` hợp lệ (bước `reviewed`);
- còn issue `CRITICAL`/`MAJOR` mà không có `verify.md` ghi `RESOLVED` (bước `reviewed`);
- thiếu `batch-review.md` (bước `PENDING_USER_APPROVAL`).

**`novel approve`** chỉ chạy được khi batch đang `PENDING_USER_APPROVAL`, và chỉ được gọi từ lệnh `/novel-translate approve …` **do người dùng gõ**. Skill ghi rõ: không bao giờ tự gọi lệnh này.

### 9.3 Vòng sửa

- Translator nhận danh sách issue cùng các đoạn liên quan (±1 đoạn), **không dịch lại cả chương**.
- Sửa và kiểm lại tối đa 2 vòng. Sau đó chương được gắn `open issues` và chuyển cho người dùng quyết định.

### 9.4 Báo cáo cuối batch (phiên main viết, rồi dừng)

```
Batch b002 (ch 11–20): 10 chương, Critic: PASS
- Lỗi quan trọng phát hiện: 7 (CRITICAL 1, MAJOR 6): …
- Đã sửa và kiểm lại: 7 / 7
- Chưa giải quyết: 0
- Cảnh báo của check: …
- Đề xuất cập nhật context: 3 mục (xem reviews/b002/context-updates.md)
- Nên đọc thử: ch 14 (đổi xưng hô sau tình tiết …), ch 18
→ /novel-translate approve kzgd b002   hoặc   /novel-translate rework kzgd b002 "<ghi chú>"
```

Mặc định không tự chạy batch kế tiếp. Chế độ tự động: DEFER.

## 10. Recovery và checkpoint

| Yêu cầu | Cách làm |
|---|---|
| Không dịch lại chương đã xong | Chương có `stage ≥ translated`, `rawHash` khớp và `contextVersion` khớp thì bỏ qua |
| Không review lại batch đã duyệt khi dữ liệu không đổi | `APPROVED`, đồng thời mọi chương không stale, thì bỏ qua |
| Không mất bản dịch khi hết usage | Mỗi chương ghi file xong mới `mark`; ghi atomic; đơn vị việc là 1 chương. Chạy lại cùng lệnh thì làm tiếp từ chương chưa `mark` |
| Sửa một chương riêng | `/novel-translate <book> 14-14` (chỉ chương 14, giữ nguyên batch); batch của chương đó quay về `PENDING_USER_APPROVAL` |
| Raw hoặc context đổi thì bản dịch cũ cần xem lại | `novel status` so `rawHash` và `contextVersion` của từng chương với hiện tại rồi in **STALE** (tính ra, không lưu). Không tự dịch lại; người dùng quyết định |
| Không tự đánh dấu `APPROVED` | Mục 9.2 |
| Hai phiên chạy song song | Lock file theo truyện (có sẵn) |
| Backup | `novel backup <book>`: zip `books/<id>` (bỏ `.cache`) vào Google Drive for desktop (`My Drive/novel-backups/<id>/`). Chạy sau khi crawl xong, sau mỗi batch được duyệt, và lúc finalize. Không dùng Git |

## 11. EPUB export

- `novel export <book> [range]` dùng **Pandoc** (đã có trên máy) rồi **epubcheck** (đã cài).
- Input: chỉ các chương thuộc batch `APPROVED`, theo thứ tự số chương, lấy từ `translated/NNNN.md`.
- Metadata (tiêu đề, tác giả, ngôn ngữ `vi`, nguồn) lấy từ `book.yaml` và `manifest.json`.
- Yêu cầu và cách kiểm:

| Yêu cầu | Kiểm tra |
|---|---|
| Đúng thứ tự, tiêu đề chương chuẩn | Mỗi file bắt đầu bằng `# <tiêu đề>`; export sắp xếp theo số chương |
| Mục lục điều hướng | Pandoc `--toc --split-level=1`; đối chiếu số mục trong mục lục với số chương |
| Unicode tiếng Việt, xuống dòng, hội thoại | UTF-8; mỗi đoạn là một paragraph; dấu ngắt cảnh (`————`, `===`) được giữ dưới dạng text, không biến thành `<hr>` ngoài ý muốn |
| Không lẫn review, prompt hay ghi chú | `check` FAIL nếu có; export chỉ đọc `translated/*.md` |
| Xuất lại sau khi sửa | Idempotent: ghi đè `output/<id>.epub` |
| File hợp lệ | `epubcheck` pass mới bàn giao |

## 12. Tối ưu usage cho Claude Pro

- Chạy tuần tự; mỗi lần gọi subagent xử lý 1 chương.
- Chỉ nạp context, tóm tắt 3 chương trước, và raw cùng bản dịch của chương đang làm. Không nạp cả truyện.
- Batch Mode và Final Mode đọc **tóm tắt cùng các đoạn bị gắn cờ**, không đọc lại toàn văn.
- Sửa theo đoạn; tận dụng report cũ khi người dùng yêu cầu `rework`.
- Hết hạn mức thì dừng; chạy lại cùng lệnh để tiếp tục (mục 10). Lệnh `/usage` cho thấy mức tiêu hao của gói và tỷ trọng theo subagent.
- Trước khi dịch, tắt MCP connector không dùng (`/mcp`) và xem `/context`. Ở B1, phần cố định của phiên main khoảng 30k token mỗi lượt.
- Không có token accounting, hook hay observability.

## 13. Implementation slices

Thứ tự ưu tiên: dùng lại code crawler và prompt có sẵn; mỗi slice chạy được từ đầu tới cuối.

| Slice | Nội dung | Code mới | Xong khi |
|---|---|---|---|
| **T0. Chuẩn bị** | Chuyển prompt V1 vào `prompts/` (nguyên văn; sửa §10.1); nhận prompt Critic của người dùng thành `critic-master.md` (3 mode); viết `vietnamese-style.md`; cập nhật CLAUDE.md (bỏ quy tắc Git và `validate --commit`, thêm `books/` không được commit) | Không | Người dùng duyệt 3 file prompt |
| **T1. Crawl skill + layout** | Đổi raw-store sang `books/<id>/raw/` + `manifest.json`; chuyển dữ liệu KZGD; `/novel-crawl` gọi CLI có sẵn | Nhỏ (đổi đường dẫn, sinh manifest) | `/novel-crawl kzgd` chạy lại thì báo đủ 201 chương, 0 request mạng; golden test vẫn xanh |
| **T2. Dịch và review 1 chương** | Agent `translator` và `critic` (Chapter, verify); `novel check` (port `qa.py`); `status.json` + `novel mark`; `/novel-translate kzgd 1-2` chỉ có vòng chương. Thử preload prompt bằng `skills:` | Vừa (`check`, `status`, `mark`) | Lỗi cài sẵn trong 1–2 chương: Critic bắt được ≥ 8/10; `check` chặn được lệch số đoạn và chữ Hán sót; ngắt giữa chừng rồi chạy lại thì không dịch lại chương đã `mark`; Critic không ghi được file |
| **T3. Context + batch + duyệt** | Bước 0 dựng context và dừng; Critic Batch Mode; `context-updates`; `approve`/`rework`; phát hiện STALE; báo cáo batch | Nhỏ (`approve`, stale) | Batch 10 chương dừng ở `PENDING_USER_APPROVAL`; `approve` gộp context và tăng version; sửa raw hoặc context thì `status` báo STALE; xưng hô cài sai giữa các chương bị Batch Mode bắt |
| **T4. Finalize + EPUB + backup** | Critic Final Mode; `novel export` (Pandoc + epubcheck); `novel backup` (zip lên Drive; thay `snapshot` dùng `git bundle`) | Nhỏ | Bị chặn khi còn batch chưa `APPROVED`; EPUB qua epubcheck; mục lục đúng số chương; không lẫn ghi chú; zip lên Drive giải nén ra đọc được |

**Code bỏ hoặc đổi:**
- `src/snapshot.ts` (`git bundle`, tag) chuyển thành `novel backup` (zip).
- Khi đổi layout, `crosscheck` đọc theo đường dẫn mới; lệnh này vẫn là công cụ phát triển.
- Không viết: apply-fixes, logger, validator runtime, profile đo song song.

## 14. Acceptance criteria (MVP)

1. Ba command chạy được trên KZGD: crawl (dữ liệu đã có), dịch 1 batch, finalize ra EPUB.
2. Chỉ có 2 subagent; Critic không ghi được file và không gọi được agent khác.
3. Không có thao tác Git nào trong workflow dữ liệu; không có hook.
4. Batch dừng ở `PENDING_USER_APPROVAL`; chỉ lệnh do người dùng gõ mới đặt `APPROVED`; trạng thái tách kết luận của Critic khỏi phê duyệt của người dùng.
5. Chạy lại sau khi bị ngắt hoặc hết usage thì không dịch lại và không review lại phần đã xong; phát hiện được STALE.
6. `check` chặn được: lệch số đoạn, chữ Hán sót, biến thể thuật ngữ bị cấm, ghi chú lọt vào bản dịch.
7. Critic bắt được ≥ 8/10 lỗi cài sẵn (nghĩa, xưng hô, văn dịch máy) trên dữ liệu thử.
8. EPUB qua epubcheck, mục lục đúng, Unicode tiếng Việt đúng, không lẫn review hay prompt.
9. Master prompt được dùng nguyên văn; agent khai báo đúng các file đã áp dụng.
10. Không dùng API key trả phí; chạy được trên gói Claude Pro (kiểm `/model` và `/usage` ở T2).
