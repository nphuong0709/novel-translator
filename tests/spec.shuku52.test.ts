import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { Shuku52Adapter, headingNumber, parsePageHtml } from "../src/ingest/adapters/shuku52.js";
import { ownText } from "../src/ingest/core/html.js";
import { CrawlError } from "../src/ingest/types.js";
import { fixture, golden } from "./helpers.js";

const BASE = "https://www.52shuku.net/demo/1_b/demo01";
const LINE = "清晨的雾气还没散去，码头上已经挤满了等船的人。"; // 24 ký tự

function fixtureFetcher(requested: string[]) {
  return async (url: string): Promise<string> => {
    requested.push(url);
    return fixture(`shuku52/book/${url.split("/").pop() ?? ""}`);
  };
}

/** Truyện giả trong bộ nhớ: index + các trang, mỗi trang là danh sách đoạn. */
function memoryBook(pages: string[][]) {
  const requested: string[] = [];
  const index = `<html><body>${pages.map((_, i) => `<a href="demo01_${i + 2}.html">${i + 1}</a>`).join("")}</body></html>`;
  const html = (ps: string[]) =>
    `<html><body><article class="article-content">${ps.map((p) => `<p>${p}</p>`).join("")}</article></body></html>`;
  const fetcher = async (url: string): Promise<string> => {
    requested.push(url);
    const m = /_(\d+)\.html$/.exec(url);
    if (!m) return index;
    const page = pages[Number(m[1]) - 2];
    if (!page) throw new Error(`404 ${url}`);
    return html(page);
  };
  return { fetcher, requested };
}

describe("SHUKU-03 ownText độc lập với cách parser lồng thẻ", () => {
  it("cây kiểu html.parser: <div> phân trang và <p> quảng cáo nằm TRONG <p> cuối", () => {
    // Dựng tay cây mà html.parser của Python sinh ra (parse5 không bao giờ sinh cây này).
    const $ = cheerio.load("<section></section>");
    $("section").html("");
    const p = $("<p></p>").text("　　đoạn cuối\n");
    p.append($('<div class="pagination2"><a>上一页</a></div>'));
    p.append($("<span>vẫn thuộc p</span>"));
    p.append($("<p>quảng cáo</p>"));
    expect(ownText(p).replace(/\s+/gu, " ").trim()).toBe("đoạn cuối vẫn thuộc p");
  });

  it("script trong article bị bỏ", () => {
    const html = `<article class="article-content"><script>ad()</script><p>${LINE}</p></article>`;
    expect(parsePageHtml(html)).toEqual([LINE]);
  });

  it("không có article.article-content thì ném CrawlError", () => {
    expect(() => parsePageHtml("<html><body><p>x</p></body></html>")).toThrow(CrawlError);
  });
});

describe("SHUKU-05 headingNumber: biên", () => {
  it.each([
    ["第3章：夜行", 3],
    ["第3章（上）", 3],
    ["第 3 章 夜行", 3],
    ["　第3章 夜行　", 3],
    ["第3章里", null],
    [`第3章 ${"长".repeat(40)}`, null],
  ])("%s → %s", (input, expected) => expect(headingNumber(input)).toBe(expected));
});

describe("SHUKU-09 lỗi khi không tìm được chương", () => {
  it("N lớn hơn chương cuối: thông báo khớp golden", async () => {
    const g = golden<Record<string, { message?: string }>>("shuku52/chapters.json");
    await expect(new Shuku52Adapter(fixtureFetcher([])).fetchChapter(`${BASE}.html`, 5)).rejects.toThrow(
      g["5"]?.message ?? "",
    );
  });

  it("site nhảy số (không có 第2章) thì FAILED, không gộp sang chương 3", async () => {
    const { fetcher } = memoryBook([
      ["第1章 一", ...Array(10).fill(LINE)],
      ["第3章 三", ...Array(10).fill(LINE)],
    ]);
    await expect(new Shuku52Adapter(fetcher).fetchChapter(`${BASE}.html`, 2)).rejects.toThrow(/第2章/);
  });

  it("chương quá ngắn thì ném CrawlError", async () => {
    const { fetcher } = memoryBook([["第1章 一", LINE], ["第2章 二", ...Array(10).fill(LINE)]]);
    await expect(new Shuku52Adapter(fetcher).fetchChapter(`${BASE}.html`, 1)).rejects.toThrow(/quá ngắn/);
  });
});

describe("Trạng thái giữa các lần gọi", () => {
  it("cào chương 1..4 liên tiếp: mỗi trang và index chỉ tải một lần", async () => {
    const requested: string[] = [];
    const adapter = new Shuku52Adapter(fixtureFetcher(requested));
    for (const n of [1, 2, 3, 4]) await adapter.fetchChapter(`${BASE}.html`, n);
    expect(requested.length).toBe(new Set(requested).size);
    expect(requested.filter((u) => u.endsWith("demo01.html"))).toHaveLength(1);
  });

  it("URL trang giữa (_7.html) dẫn về cùng truyện", async () => {
    const adapter = new Shuku52Adapter(fixtureFetcher([]));
    const ch = await adapter.fetchChapter(`${BASE}_7.html?from=x`, 2);
    expect(ch.title).toBe("第2章 旧图");
  });
});

describe("matches", () => {
  const adapter = new Shuku52Adapter(async () => "");
  it.each([
    ["https://www.52shuku.net/x.html", true],
    ["https://52shuku.vip/x.html", true],
    ["https://www.69shuba.com/book/1/", false],
    ["https://evil.com/52shuku.net/x.html", false],
  ])("%s → %s", (url, expected) => expect(adapter.matches(url)).toBe(expected));
});
