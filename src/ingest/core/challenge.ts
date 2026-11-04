/**
 * SHUBA-08: nhận diện trang challenge / bot-check (Cloudflare…).
 *
 * Chỉ để **phát hiện** rồi trả BLOCKED hoặc chờ người dùng tự xác minh trong trình
 * duyệt thật. Không có code nào ở đây (hay nơi khác) tự giải challenge.
 */
import * as cheerio from "cheerio";

// Đúng quy tắc V1 / golden `shuba69/challenge.json`. Thêm marker = đổi hành vi → cập nhật golden.
const TITLE_MARKERS = ["just a moment", "security verification"];
const TEXT_MARKERS = ["verify you are human"];

export function isChallengeHtml(html: string): boolean {
  const $ = cheerio.load(html);
  const title = $("title").first().text().toLowerCase();
  if (TITLE_MARKERS.some((m) => title.includes(m))) return true;
  const text = $("body").text().toLowerCase();
  return TEXT_MARKERS.some((m) => text.includes(m));
}
