import { describe, expect, it } from "vitest";
import { alignHanziPinyin, containsHan, splitPinyin, toneOf } from "@/lib/pinyin";

describe("toneOf", () => {
  it.each([
    ["mā", 1],
    ["má", 2],
    ["mǎ", 3],
    ["mà", 4],
    ["ma", 5],
    ["lǜ", 4],
    ["nü3", 3],
    ["xie5", 5],
    ["Nǐ", 3],
  ] as const)("%s → tone %i", (syllable, tone) => {
    expect(toneOf(syllable)).toBe(tone);
  });

  it("handles decomposed (NFD) tone marks", () => {
    expect(toneOf("mǎ")).toBe(3);
  });
});

describe("splitPinyin", () => {
  it("splits on spaces, apostrophes and punctuation", () => {
    expect(splitPinyin("nǐ hǎo, xī'ān!")).toEqual(["nǐ", "hǎo", "xī", "ān"]);
  });
});

describe("alignHanziPinyin", () => {
  it("pairs each character with its syllable and tone", () => {
    const { aligned, chars } = alignHanziPinyin("谢谢", "xiè xie");
    expect(aligned).toBe(true);
    expect(chars).toEqual([
      { char: "谢", pinyin: "xiè", tone: 4 },
      { char: "谢", pinyin: "xie", tone: 5 },
    ]);
  });

  it("passes punctuation through", () => {
    const { aligned, chars } = alignHanziPinyin("你好！", "nǐ hǎo");
    expect(aligned).toBe(true);
    expect(chars.map((c) => c.char)).toEqual(["你", "好", "！"]);
    expect(chars[2]).toEqual({ char: "！" });
  });

  it("reports a mismatch when pinyin isn't split per syllable", () => {
    expect(alignHanziPinyin("谢谢", "xièxie").aligned).toBe(false);
  });
});

describe("containsHan", () => {
  it("detects Chinese characters", () => {
    expect(containsHan("say 你好")).toBe(true);
    expect(containsHan("ni hao")).toBe(false);
  });
});
