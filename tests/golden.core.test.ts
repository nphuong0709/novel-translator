import { describe, expect, it } from "vitest";
import { chapterNumberFromTitle, chineseNumeralToInt } from "../src/ingest/core/numerals.js";
import { compileJunkPatterns, isJunk } from "../src/ingest/core/junk.js";
import { SHUBA69_JUNK } from "../src/ingest/adapters/shuba69.js";
import { SHUKU52_JUNK } from "../src/ingest/adapters/shuku52.js";
import { golden } from "./helpers.js";

const numerals = golden<{
  chinese_numeral_to_int: Record<string, number>;
  chapter_number_from_title: Record<string, number | null>;
}>("core/numerals.json");

describe("CORE-01 chineseNumeralToInt", () => {
  for (const [input, expected] of Object.entries(numerals.chinese_numeral_to_int)) {
    it(`${input} → ${expected}`, () => expect(chineseNumeralToInt(input)).toBe(expected));
  }
});

describe("CORE-02 chapterNumberFromTitle", () => {
  for (const [input, expected] of Object.entries(numerals.chapter_number_from_title)) {
    it(`${input} → ${expected}`, () => expect(chapterNumberFromTitle(input)).toBe(expected));
  }
});

const junk = golden<Record<"shuba69" | "shuku52", Record<string, boolean>>>("core/junk.json");

describe("CORE-03 junk filter", () => {
  const sites = { shuba69: SHUBA69_JUNK, shuku52: SHUKU52_JUNK } as const;
  for (const site of ["shuba69", "shuku52"] as const) {
    for (const [line, expected] of Object.entries(junk[site])) {
      it(`${site}: ${expected ? "rác" : "giữ"} — ${line}`, () => {
        expect(isJunk(line, compileJunkPatterns(sites[site]))).toBe(expected);
      });
    }
  }
});
