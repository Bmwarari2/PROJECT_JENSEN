import { describe, expect, it } from "vitest";
import { clarityCheck, type HeardChar } from "@/lib/speech/clarity";

const heard = (text: string, confidence: number | null = 1): HeardChar[] =>
  Array.from(text).map((char) => ({ char, confidence }));

describe("clarityCheck", () => {
  it("scores a confident exact match as perfect", () => {
    const { scores, words } = clarityCheck("谢谢", heard("谢谢。"));
    expect(scores).toEqual({ pron: 100, accuracy: 100, fluency: null, completeness: 100 });
    expect(words.map((w) => [w.text, w.errorType, w.heard])).toEqual([
      ["谢", "None", "谢 xiè"],
      ["谢", "None", "谢 xiè"],
    ]);
  });

  it("flags a tone error when the right syllable is heard with another tone", () => {
    const { scores, words } = clarityCheck("谢谢", heard("歇歇"));
    expect(words.every((w) => w.errorType === "Tone")).toBe(true);
    expect(words[0]!.heard).toBe("歇 xiē");
    expect(scores.pron).toBe(45);
  });

  it("accepts homophones and traditional characters", () => {
    expect(clarityCheck("谢谢", heard("謝謝")).scores.pron).toBe(100);
    expect(clarityCheck("妈", heard("嗎")).words[0]!.errorType).not.toBe("None"); // mā vs ma: tone differs
  });

  it("accepts third-tone sandhi but not other tone changes", () => {
    // 你好: nǐ before hǎo is spoken ní, so hearing 泥 ní is right.
    expect(clarityCheck("你好", heard("泥好")).words[0]!.errorType).toBe("None");
    // But a rising tone on the last of the pair is still wrong (好 → 豪 háo).
    expect(clarityCheck("你好", heard("你豪")).words[1]!.errorType).toBe("Tone");
    // And 你 alone keeps its third tone.
    expect(clarityCheck("你", heard("泥")).words[0]!.errorType).toBe("Tone");
  });

  it("marks a different syllable as mispronounced", () => {
    const { words } = clarityCheck("你好", heard("你跑"));
    expect(words.map((w) => w.errorType)).toEqual(["None", "Mispronunciation"]);
  });

  it("aligns around missing and extra syllables", () => {
    const missing = clarityCheck("不客气", heard("不气"));
    expect(missing.words.map((w) => w.errorType)).toEqual(["None", "Omission", "None"]);
    expect(missing.scores.completeness).toBeCloseTo(66.7, 1);

    const extra = clarityCheck("你好", heard("你们好"));
    expect(extra.words.map((w) => w.errorType)).toEqual(["None", "None"]);
    expect(extra.scores.pron).toBe(95); // one extra syllable costs 5
  });

  it("scales by recogniser confidence", () => {
    expect(clarityCheck("你好", heard("你好", 0.2)).scores.pron).toBe(80);
    expect(clarityCheck("你好", heard("你好", null)).scores.pron).toBe(100);
  });

  it("scores zero when nothing matches", () => {
    const { scores, words } = clarityCheck("你好", heard("hello"));
    expect(scores.pron).toBe(0);
    expect(words.every((w) => w.errorType === "Omission")).toBe(true);
  });
});
