import { describe, expect, it } from "vitest";
import { compileJunkPatterns, isJunk } from "../src/ingest/core/junk.js";
import { chapterNumberFromTitle, chineseNumeralToInt } from "../src/ingest/core/numerals.js";

describe("CORE-01 chineseNumeralToInt: biên", () => {
  it("ký tự lạ thì ném lỗi", () => expect(() => chineseNumeralToInt("十a")).toThrow(/Không phải số chữ Hán/));
  it("chuỗi rỗng trả 0 (giống V1)", () => expect(chineseNumeralToInt("")).toBe(0));
});

describe("CORE-02 chapterNumberFromTitle: biên", () => {
  it("khoảng trắng full-width U+3000", () => expect(chapterNumberFromTitle("第　12　章")).toBe(12));
  it("gọi liên tiếp không bị ảnh hưởng bởi lastIndex", () => {
    expect(chapterNumberFromTitle("第3章")).toBe(3);
    expect(chapterNumberFromTitle("第3章")).toBe(3);
  });
});

describe("CORE-04 junk pattern spec", () => {
  it("flags 'i' thay cho (?i)", () => {
    const [re] = compileJunkPatterns([], [{ pattern: "abc", flags: "i" }]);
    expect(isJunk("  ABC  ", [re!])).toBe(true);
  });
  it("cú pháp (?i) kiểu Python bị từ chối kèm thông báo rõ", () => {
    expect(() => compileJunkPatterns([], [{ pattern: "(?i)abc" }])).toThrow(/regex lỗi '\(\?i\)abc'/);
  });
  it("cờ g/y bị từ chối vì làm test() có trạng thái", () => {
    expect(() => compileJunkPatterns([], [{ pattern: "x", flags: "g" }])).toThrow(/g\/y/);
  });
  it("mẫu bổ sung được nối sau mặc định", () => {
    const res = compileJunkPatterns([{ pattern: "^a$" }], [{ pattern: "^b$" }]);
    expect(res.map((r) => r.source)).toEqual(["^a$", "^b$"]);
  });
});
