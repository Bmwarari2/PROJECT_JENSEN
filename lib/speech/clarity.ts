import { pinyin } from "pinyin-pro";
import { isHan } from "@/lib/pinyin";
import type { PronunciationScores, PronunciationWord } from "@/lib/types";

/**
 * A pronunciation "clarity check" built from speech recognition, used when
 * Azure's pronunciation assessment isn't configured.
 *
 * The learner's attempt is transcribed as Mandarin, and each target character
 * is compared with what the recogniser heard, by sound rather than by
 * character:
 *   - same character, or a different character with the same pinyin and tone
 *     (a homophone, or traditional vs simplified): correct
 *   - same syllable, different tone (heard 歇 xiē for 谢 xiè): a tone error,
 *     except the rising tone that third-tone sandhi calls for (你 in 你好)
 *   - different syllable: mispronounced
 *   - nothing aligned: omitted
 * Scores are scaled by how confident the recogniser was. This measures whether
 * a native-trained recogniser understood you; it can't grade sounds as finely
 * as a phoneme-level assessor, and the UI and tutor are told so.
 */

export interface HeardChar {
  char: string;
  /** Recogniser confidence for this character, 0..1 (null if unknown). */
  confidence: number | null;
}

interface Syllable {
  char: string;
  marked: string; // "xiè"
  base: string; // "xie"
  tone: string; // "4" ("0" = neutral)
}

function syllables(chars: string[]): Syllable[] {
  if (chars.length === 0) return [];
  const text = chars.join("");
  // Converting the whole string lets pinyin-pro pick the right reading for
  // characters with several pronunciations.
  const marked = pinyin(text, { type: "array" });
  const numbered = pinyin(text, { type: "array", toneType: "num" });
  return chars.map((char, i) => {
    const num = numbered[i] ?? "";
    const m = /^([a-zü]+)([0-5]?)$/i.exec(num.replace("v", "ü"));
    return { char, marked: marked[i] ?? "", base: m?.[1]?.toLowerCase() ?? num, tone: m?.[2] || "0" };
  });
}

type Match = "same" | "tone" | "different";

function compare(target: Syllable, heard: Syllable): Match {
  if (target.char === heard.char) return "same";
  if (target.base === heard.base) return target.tone === heard.tone ? "same" : "tone";
  return "different";
}

const SUBSTITUTION_COST: Record<Match, number> = { same: 0, tone: 0.5, different: 1 };

/** Edit-distance alignment; returns, for each target syllable, the index of the heard syllable (or -1). */
function align(target: Syllable[], heard: Syllable[]): number[] {
  const rows = target.length + 1;
  const cols = heard.length + 1;
  const cost: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      cost[i]![j] = Math.min(
        cost[i - 1]![j]! + 1, // target syllable missing
        cost[i]![j - 1]! + 1, // extra heard syllable
        cost[i - 1]![j - 1]! + SUBSTITUTION_COST[compare(target[i - 1]!, heard[j - 1]!)],
      );
    }
  }
  const pairs = new Array<number>(target.length).fill(-1);
  let i = target.length;
  let j = heard.length;
  while (i > 0 && j > 0) {
    const here = cost[i]![j]!;
    if (here === cost[i - 1]![j - 1]! + SUBSTITUTION_COST[compare(target[i - 1]!, heard[j - 1]!)]) {
      pairs[i - 1] = j - 1;
      i--;
      j--;
    } else if (here === cost[i - 1]![j]! + 1) {
      i--;
    } else {
      j--;
    }
  }
  return pairs;
}

const BASE_SCORE: Record<Match, number> = { same: 100, tone: 45, different: 20 };
const ERROR_TYPE: Record<Match, string> = { same: "None", tone: "Tone", different: "Mispronunciation" };

const round1 = (n: number) => Math.round(n * 10) / 10;

export function clarityCheck(
  targetText: string,
  heard: HeardChar[],
): { scores: PronunciationScores; words: PronunciationWord[] } {
  const target = syllables(Array.from(targetText).filter(isHan));
  const heardHan = heard.filter((h) => isHan(h.char));
  const heardSyllables = syllables(heardHan.map((h) => h.char));
  const pairs = align(target, heardSyllables);

  const words: PronunciationWord[] = target.map((t, index) => {
    const j = pairs[index]!;
    if (j < 0) return { text: t.char, accuracy: 0, errorType: "Omission", phonemes: [] };
    const h = heardSyllables[j]!;
    let match = compare(t, h);
    // Third-tone sandhi: before another third tone, a third tone is spoken as
    // a second tone (你好 nǐ hǎo sounds like ní hǎo), so hearing it is correct.
    if (match === "tone" && t.tone === "3" && h.tone === "2" && target[index + 1]?.tone === "3") match = "same";
    const confidence = heardHan[j]!.confidence ?? 1;
    return {
      text: t.char,
      accuracy: round1(BASE_SCORE[match] * (0.75 + 0.25 * confidence)),
      errorType: ERROR_TYPE[match],
      phonemes: [],
      heard: `${h.char} ${h.marked}`,
    };
  });

  if (words.length === 0) return { scores: { pron: null, accuracy: null, fluency: null, completeness: null }, words };

  const said = words.filter((w) => w.errorType !== "Omission");
  const extra = heardSyllables.length - said.length;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const accuracy = said.length ? mean(said.map((w) => w.accuracy ?? 0)) : 0;
  const completeness = (said.length / words.length) * 100;
  // Overall: every target character counts (omissions score 0); extra
  // syllables cost a little each.
  const pron = Math.max(0, mean(words.map((w) => w.accuracy ?? 0)) - 5 * Math.max(0, extra));

  return {
    scores: { pron: round1(pron), accuracy: round1(accuracy), fluency: null, completeness: round1(completeness) },
    words,
  };
}
