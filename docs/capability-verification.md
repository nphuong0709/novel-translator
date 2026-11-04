# Claude Code Capability Verification: novel-translator (B1)

Ngày: 2026-11-04 · Người chạy: Claude Code (phiên VS Code) · Scratch project: `poc-capability/` (ngoài repo sản phẩm)

Quy ước trạng thái:
- **VERIFIED**: đã quan sát trực tiếp trong PoC (transcript, hook log hoặc file).
- **PARTIAL**: một phần quan sát được, phần còn lại chỉ có từ tài liệu.
- **FAILED**: PoC cho kết quả trái kỳ vọng.
- **NOT TESTED**: chưa chạy PoC, chỉ có tài liệu.

---

## 1. Phiên bản và môi trường

| Thành phần | Giá trị | Nguồn |
|---|---|---|
| VS Code extension (chạy phiên này) | `anthropic.claude-code-2.1.317` | thư mục extension |
| Binary dùng cho PoC | `…/resources/native-binary/claude` → **2.1.317** | `--version`; `system/init.claude_code_version` = `2.1.317` |
| CLI trên PATH (Homebrew) | **2.1.311**, **khác** extension | `claude --version` |
| Tài khoản | đăng nhập Claude (subscription). Không có `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`; không dùng Bedrock/Vertex | env |
| Config dir của PoC | `~/.claude` (mặc định; `CLAUDE_CONFIG_DIR` không đặt) | env |
| Cờ cô lập | `--setting-sources project` (không nạp settings user), hook chỉ ở `poc-capability/.claude/settings.json` | lệnh chạy |

## 2. Tài liệu chính thức đã tham chiếu

| Trang | Dùng cho |
|---|---|
| https://code.claude.com/docs/en/sub-agents | frontmatter (`tools`, `disallowedTools`, `model`, `effort`, `background`…), thứ tự ưu tiên model, subagent lồng nhau, chạy foreground/background, nơi lưu transcript |
| https://code.claude.com/docs/en/hooks | danh sách event; payload `SubagentStart` / `SubagentStop`; `PostToolUse(Agent)` có `resolvedModel` / `usage` |
| https://code.claude.com/docs/en/skills | `$ARGUMENTS`, `$0`/`$1`, `arguments`, frontmatter skill (`model`, `effort`, `context: fork`…), gọi skill trong `-p` |
| https://code.claude.com/docs/en/vs-code | `claudeCode.environmentVariables`, `CLAUDE_CONFIG_DIR` phải là đường dẫn tuyệt đối, binary đi kèm, phần nào dùng chung với CLI |
| https://code.claude.com/docs/en/costs | `/usage`, attribution theo subagent, ý nghĩa của số tiền với gói subscription |
| `claude-code-settings.schema.json` và `package.json` trong extension 2.1.317 | `effortLevel` (`low…xhigh`); `claudeCode.environmentVariables` có `scope: machine` |

Trang hooks và sub-agents dài hơn 100k ký tự; tôi chỉ đọc các đoạn liên quan (có ghi offset trong phiên làm việc).

## 3. Thiết kế PoC

- Dữ liệu giả: `data/sample.txt` chỉ có 2 dòng tự viết; không dùng chương truyện.
- 3 agent thử, đều `model: haiku`, `effort: low`:
  - `probe` (`tools: Read`)
  - `critic` (`tools: Read, Grep, Glob`)
  - `nester` (`tools: Agent, Read`)
- 1 skill `echo-args` (`disable-model-invocation: true`).
- Hook `SubagentStart`, `SubagentStop`, `PostToolUse(matcher: Agent)` → `node .claude/hooks/log.mjs` ghi `logs/hooks.jsonl`. Hook chỉ giữ metadata, không giữ nội dung.
- **Run 1**: một phiên `-p`, main là Sonnet 5.5, gọi lần lượt 5 bước: probe (không ghi đè), probe (`model: sonnet`), probe (`effort: high`), critic (yêu cầu ghi file), nester (gọi lồng probe).
- **Run 2**: một phiên `-p '/echo-args 4-6 epic'`, model Haiku.
- Tổng chi phí: Run 1 có 6 lượt main; ước tính `total_cost_usd` = **$0,0847** theo giá niêm yết (Sonnet $0,0825; Haiku $0,0022). Run 2 có 1 lượt. Không chạy lặp lại.

Bằng chứng nằm trong `poc-capability/logs/`:
- `run1.stream.jsonl`, `hooks.jsonl`, `run2.stream.jsonl`.
- Transcript subagent ở `~/.claude/projects/-private-tmp-…-poc-capability/<session>/subagents/agent-*.jsonl` và `*.meta.json`.

---

## 4. Kết quả từng câu hỏi

### Nhóm A: Model precedence và per-invocation effort

#### Q1. Ghi đè `model` cho từng lần gọi có ưu tiên hơn frontmatter không? **VERIFIED**
- **Expected** (tài liệu): thứ tự ưu tiên là tham số `model` của lần gọi > `model` trong frontmatter > `CLAUDE_CODE_SUBAGENT_MODEL` > model của main.
- **Actual:**

| Bước | Tham số truyền | `resolvedModel` (PostToolUse) | model trong transcript subagent |
|---|---|---|---|
| 1 | (không có) | `claude-haiku-5-5` | `claude-haiku-5-5` |
| 2 | `model: "sonnet"` | **`claude-sonnet-5-5`** | **`claude-sonnet-5-5`** |
| 3 | `effort: "high"` | `claude-haiku-5-5` | `claude-haiku-5-5` |

- **Bằng chứng:** `hooks.jsonl` (`PostToolUse.resolvedModel`), `agent-aa74efa568a8e721a.jsonl` (`message.model`).
- **Giới hạn:** chưa thử `CLAUDE_CODE_SUBAGENT_MODEL`, chưa thử model ID đầy đủ (chỉ thử alias), chưa thử `opus`.

#### Q2. Đặt `effort` trong frontmatter và ghi đè cho từng lần gọi? **VERIFIED** (ở mức harness)
- **Expected:** frontmatter `effort` nhận `low | medium | high | xhigh | max`; tool `Agent` có tham số `effort`.
- **Actual:** `SubagentStop.effort` ghi `{"level":"low"}` ở các bước 1, 2, 4, 5 (theo frontmatter), và **`{"level":"high"}` ở bước 3** (ghi đè). Trường `effort` trong transcript subagent khớp với giá trị này.
- **Bằng chứng:** `hooks.jsonl`; trường `effort` trong `agent-aed87fa0abf23e234.jsonl`.
- **Giới hạn:** chỉ quan sát được giá trị harness **ghi nhận và gửi đi**. Không đo được tác động lên chất lượng; thinking token tăng nhẹ (bước 3 có 98 output token so với 74 ở bước 1) nhưng mẫu quá nhỏ để kết luận. Trường `effort` trong payload `SubagentStop` **không có trong ví dụ của tài liệu**, nên có thể thay đổi giữa các phiên bản.

### Nhóm B: Critic chỉ đọc và subagent lồng nhau

#### Q3. `tools:` trong frontmatter giới hạn tool (critic chỉ đọc)? **VERIFIED**
- **Expected:** `tools` là allowlist; tool không có trong danh sách thì không được cấp.
- **Actual:**
  - Request gửi cho model của critic chỉ có `Read, Grep, Glob, advisor`.
  - Critic trả lời `CANNOT_WRITE, Read, Grep, Glob`.
  - Transcript **không có tool_use nào**, và `out/` vẫn trống.
- **Bằng chứng:** trường `tools` trong `agent-a604354de520b72b5.jsonl`; `ls out/`.
- **Lưu ý:**
  - Harness **tự thêm `advisor`**, một tool server-side để hỏi ý kiến; tool này không ghi được file.
  - Phiên main thì có đủ ~90 tool, gồm Write, Bash và các MCP connector (Gmail, Drive…). Vì vậy allowlist ở frontmatter là **chốt chặn duy nhất** cho subagent.

#### Q4. Subagent gọi được subagent khác không? **VERIFIED** (được phép theo mặc định)
- **Expected** (tài liệu): mặc định cho phép tới 3 tầng; tắt bằng `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`.
- **Actual:** `nester` gọi được `probe`. Probe đó có `spawnDepth: 2` trong `meta.json`, và log có `PostToolUse` kèm `agent_type: nester`.
- **Giới hạn:** chưa thử biến môi trường `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`.
- **Hệ quả:** giả định của blueprint ("subagent không gọi được subagent") **sai**. Cần chủ động chặn việc gọi lồng.

### Nhóm C: Chạy tuần tự và log `SubagentStop`

#### Q5. Payload `SubagentStop` dùng để log agent thật? **VERIFIED**
- **Expected** (tài liệu): `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `stop_hook_active`…
- **Actual:** các trường quan sát được: `session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, agent_id, agent_type, effort, hook_event_name, stop_hook_active, agent_transcript_path, last_assistant_message, background_tasks, session_crons`.
  - **Không có `model` và không có `usage`.**
  - Hai thông tin này nằm ở **`PostToolUse(Agent)`**, trong `tool_response`: `agentId, agentType, resolvedModel, totalTokens, usage, totalDurationMs, totalToolUseCount, status…`.
- **Hệ quả:** muốn có đủ cả model, effort và usage thì phải ghép `SubagentStop` (có effort) với `PostToolUse(Agent)` (có model và usage) theo `agent_id`. Ngoài ra có thể đọc thẳng `agent_transcript_path`.
- **Giới hạn:** hook chạy được trong `-p` với settings của project (đã quan sát). Chưa thử trong phiên tương tác của VS Code.

#### Q7. Chạy tuần tự: R1 xong mới tới bước sửa? **VERIFIED** khi truyền `run_in_background: false`; **NOT TESTED** với hành vi mặc định
- **Expected** (tài liệu): khi không cấu hình gì, subagent được gọi từ main sẽ **chạy nền**. Foreground thì chặn main cho tới khi xong.
- **Actual:**
  - Main tự truyền `run_in_background: false` ở cả 5 bước, vì prompt yêu cầu làm "từng bước một".
  - `meta.json` ghi `requestShape: "foreground"`.
  - Dấu thời gian nối đuôi nhau, không chồng lấn: bước 1 kết thúc lúc 09:57:44.55, bước 2 bắt đầu lúc 09:57:47.77; bước 2 kết thúc 50.24, bước 3 bắt đầu 53.87…
- **Giới hạn:** chưa thử trường hợp **không** truyền `run_in_background`, và chưa thử `background: false` trong frontmatter. Ở đây, việc chạy tuần tự phụ thuộc vào việc model main làm đúng chỉ dẫn.

### Nhóm D: Tham số skill, cấu hình VS Code, đo usage

#### Q6. Skill nhận tham số? **VERIFIED** (trong `-p`)
- **Expected:** `$ARGUMENTS` nhận cả chuỗi; `$0`, `$1` nhận theo vị trí.
- **Actual:** chạy `/echo-args 4-6 epic` thì nội dung skill được mở rộng thành `ARGS=[4-6 epic] P0=[4-6] P1=[epic]`. Transcript không còn placeholder nào chưa thay, nên chính harness đã thay, không phải model tự điền.
- **Giới hạn:** chưa thử trong phiên tương tác VS Code; chưa thử `arguments:` có đặt tên; chưa thử skill dùng `context: fork`.

#### Q8. VS Code extension dùng `CLAUDE_CONFIG_DIR` khác? **PARTIAL**
- **Quan sát cấu hình:**
  - Extension 2.1.317 có setting `claudeCode.environmentVariables` (mảng `{name, value}`) với **`scope: "machine"`**. Setting này chỉ đặt được ở User Settings, **không** đặt được trong `.vscode/settings.json` của workspace.
  - Extension chạy binary riêng (2.1.317), không phải CLI trên PATH (2.1.311).
  - Alias `claude-personal` trong `~/.zshrc` **không** áp dụng cho extension.
- **Từ tài liệu (chưa thử):** `CLAUDE_CONFIG_DIR` phải là đường dẫn **tuyệt đối**, vì extension không mở rộng `~`. Lịch sử hội thoại và `~/.claude/settings.json` dùng chung giữa CLI và extension, trong cùng một config dir.
- **Không thử** vì setting nằm ở cấp máy (vi phạm yêu cầu số 8). Phần đề xuất và cách khôi phục ở mục 6.

#### Q9. Đo usage cho từng lần gọi subagent? **VERIFIED** (có dữ liệu); chưa kiểm tổng hợp nhiều lượt
- **Actual:**
  - Kết quả `-p` có `modelUsage` **theo model** (input, output, cache, thinking, `costUSD`).
  - `PostToolUse(Agent)` có `totalTokens` và `usage` cho từng lần gọi. Tài liệu nói `usage` ở đây chỉ tính **request cuối** của subagent.
  - Transcript subagent có `message.model` và `message.usage` cho từng lượt; `meta.json` có `agentType`. Vì vậy cộng được usage theo agent hoặc theo lượt.
- **Lưu ý:** `costUSD` / `total_cost_usd` được tính **theo giá niêm yết**. Với gói subscription, đây không phải hóa đơn; tài liệu khuyên xem `/usage` (thanh hạn mức và attribution theo subagent).
- **Phát hiện ngoài dự kiến:** phiên main tốn tới **97% chi phí** dù chỉ điều phối. Sonnet đọc cache 187k token sau 6 lượt, khoảng 30k token mỗi lượt, do system prompt kèm ~90 tool, gồm cả các MCP connector của claude.ai. Mỗi subagent bị giới hạn tool chỉ tốn khoảng 2,2–6k token.
- **Giới hạn:** chưa thử subagent chạy nhiều lượt; chưa đối chiếu với `/usage` trên giao diện; chưa thử tắt MCP connector.

---

## 5. Tổng hợp

| # | Câu hỏi | Trạng thái | Ảnh hưởng tới Blueprint |
|---|---|---|---|
| Q1 | Ghi đè `model` cho từng lần gọi | VERIFIED | D-14 khả thi |
| Q2 | `effort` frontmatter và ghi đè từng lần gọi | VERIFIED (ở mức harness) | D-14 khả thi |
| Q3 | Critic chỉ đọc qua `tools:` | VERIFIED | Ràng buộc 7.1 khả thi; allowlist là chốt chặn duy nhất |
| Q4 | Subagent lồng nhau | VERIFIED (mặc định **được phép**) | **Trái giả định**; phải chặn |
| Q5 | Payload `SubagentStop` | VERIFIED (không có model và usage) | Log phải ghép thêm `PostToolUse(Agent)` |
| Q6 | Tham số skill | VERIFIED (`-p`) | `/translate-batch <range> <profile>` khả thi |
| Q7 | Chạy tuần tự | VERIFIED khi truyền rõ `run_in_background:false`; mặc định NOT TESTED | Bắt buộc chạy foreground và kiểm thứ tự |
| Q8 | VS Code và `CLAUDE_CONFIG_DIR` | PARTIAL | Chỉ ảnh hưởng vận hành, không ảnh hưởng kiến trúc |
| Q9 | Đo usage | VERIFIED (có dữ liệu) | Đo được ở PoC Slice 2; chi phí của main cần giảm |

## 6. Thay đổi cấu hình người dùng: chỉ đề xuất, chưa áp dụng

**Đưa VS Code về `~/.claude-personal`** (nếu muốn):
- Cách làm: User Settings (JSON) →
  ```json
  "claudeCode.environmentVariables": [{ "name": "CLAUDE_CONFIG_DIR", "value": "/Users/phuong.nguyen/.claude-personal" }]
  ```
  rồi Reload Window.
- Hệ quả:
  - Lịch sử, memory và skill hiện ở `~/.claude` (arena, repo-onboarding…) sẽ không còn hiện trong VS Code.
  - Hai config dir hiện đều đăng nhập **cùng tài khoản cá nhân**; nếu `~/.claude` là cho công việc thì cần kiểm lại tài khoản.
- Khôi phục: xóa mục `claudeCode.environmentVariables` đó rồi Reload Window.

**Thống nhất phiên bản:** CLI Homebrew (2.1.311) cũ hơn extension (2.1.317). Đề xuất `brew upgrade claude-code` để chạy headless và tương tác cùng một phiên bản. Chưa làm.

**Dọn dẹp PoC:** PoC không đổi gì ở cấu hình toàn cục. Có 2 phiên transcript được ghi vào:
```
~/.claude/projects/-private-tmp-claude-503--Users-phuong-nguyen-Documents-2-phuong-nguyen-novel-translator-45fd4b2d-88e5-4872-a16a-d68622f43390-scratchpad-poc-capability/
```
Xóa thư mục này nếu muốn; Claude Code cũng tự xóa sau 30 ngày (`cleanupPeriodDays`).

## 7. Giới hạn chung của thử nghiệm
- Mẫu cực nhỏ, mỗi trường hợp 1 lần, model Haiku/Sonnet; không đánh giá chất lượng dịch hay chất lượng review.
- Mọi thử nghiệm chạy trong `-p` (headless). Hành vi trong phiên tương tác VS Code (nơi subagent mặc định chạy nền) chưa thử.
- Main tuân thủ chỉ dẫn (truyền `model`, `effort`, `run_in_background`) vì prompt rất rõ. PoC **không** chứng minh được LLM điều phối luôn truyền đúng tham số trong luồng thật.
- Các trường không có trong tài liệu (`SubagentStop.effort`, `meta.json`) có thể đổi giữa các phiên bản.

## 8. Những quyết định kiến trúc cần điều chỉnh (đề xuất tối thiểu, chưa triển khai)

1. **Mục 10 / D-03:** bỏ giả định "subagent không gọi được subagent". Thay bằng hai lớp chặn:
   - Cả 3 agent đều **không có `Agent`** trong `tools:`.
   - `.claude/settings.json` của repo đặt `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"`.
   - Điều phối vẫn nằm ở skill và phiên main.
2. **D-14:** truyền `model` và `effort` **cho từng lần gọi** là khả thi. Vì LLM điều phối mới là bên truyền tham số, cần thêm một **hook kiểm chứng**:
   - Hook `SubagentStop` và `PostToolUse(Agent)` ghi `agent_id, agent_type, resolvedModel, effort, usage` vào log của repo dữ liệu.
   - `validate` **từ chối** review mà model hoặc effort ghi trong log không khớp profile.
   - Thêm dòng này vào bảng 7.1.
3. **7.1:** mọi agent (kể cả translator) phải có `tools:` dạng allowlist, vì main có cả MCP connector và Bash. Critic: `Read, Grep, Glob`. Translator: thêm `Write`, nhưng chỉ ghi file nháp. Ghi chú `advisor` là tool do harness tự thêm.
4. **Luồng mục 4:** mọi lần gọi subagent phải chạy **foreground** (`run_in_background: false`), vì mặc định là chạy nền. Thứ tự được kiểm lại bằng log hook (Start của lượt sau phải sau Stop của lượt trước).
5. **D-07 / frontmatter review:** lấy `model`, `effort` và `usage` từ log hook do code ghi, không lấy từ lời tự khai của agent.
6. **7.3 (đo usage):** dùng `modelUsage` trong kết quả, cộng thêm usage từ transcript subagent (theo `agentType`). Đây là **ước tính theo giá niêm yết**; mức tiêu hao thật của gói xem ở `/usage`. Bổ sung một thử nghiệm: chạy điều phối khi **tắt MCP connector** của claude.ai, vì chi phí cố định của main (~30k token mỗi lượt) có thể vượt chi phí của subagent khi chương ngắn.
7. **Vận hành (README):** ghi rõ extension VS Code không đọc alias `claude-personal`, và nêu cách đặt `claudeCode.environmentVariables` (setting cấp máy, đường dẫn tuyệt đối).
