// Pinyin helpers used to colour characters by tone (a standard learning aid:
// seeing the tone on every character makes the pitch pattern stick).

export type Tone = 1 | 2 | 3 | 4 | 5; // 5 = neutral

const TONE_MARKS: Record<string, Tone> = {};
for (const [tone, chars] of [
  [1, "āēīōūǖĀĒĪŌŪǕ"],
  [2, "áéíóúǘÁÉÍÓÚǗńŃ"],
  [3, "ǎěǐǒǔǚǍĚǏǑǓǙňŇ"],
  [4, "àèìòùǜÀÈÌÒÙǛǹǸ"],
] as const) {
  for (const ch of chars) TONE_MARKS[ch] = tone;
}

const HAN = /\p{Script=Han}/u;

export function isHan(char: string): boolean {
  return HAN.test(char);
}

/** Tone of one pinyin syllable, from its tone mark or a trailing digit (ni3). */
export function toneOf(syllable: string): Tone {
  const normalized = syllable.normalize("NFC");
  for (const ch of normalized) {
    const tone = TONE_MARKS[ch];
    if (tone) return tone;
  }
  const digit = /([1-5])$/.exec(normalized.trim());
  if (digit) return Number(digit[1]) as Tone;
  // Combining marks (if the text arrived decomposed).
  if (/̄/.test(syllable.normalize("NFD"))) return 1;
  if (/́/.test(syllable.normalize("NFD"))) return 2;
  if (/̌/.test(syllable.normalize("NFD"))) return 3;
  if (/̀/.test(syllable.normalize("NFD"))) return 4;
  return 5;
}

/** Split pinyin into syllables on whitespace, apostrophes, hyphens and punctuation. */
export function splitPinyin(pinyin: string): string[] {
  return pinyin
    .normalize("NFC")
    .split(/[\s'’\-–—,.!?;:，。！？；：、…"“”()（）]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AlignedChar {
  char: string;
  /** Pinyin syllable for a Han character when alignment succeeded. */
  pinyin?: string;
  tone?: Tone;
}

/**
 * Pair each Han character with its pinyin syllable. Succeeds when the pinyin has
 * exactly one syllable per character (which the tutor is asked to produce); on
 * a mismatch it returns the characters unaligned and the caller shows the
 * pinyin as one line instead.
 */
export function alignHanziPinyin(hanzi: string, pinyin: string): { aligned: boolean; chars: AlignedChar[] } {
  const chars = Array.from(hanzi.normalize("NFC"));
  const syllables = splitPinyin(pinyin);
  const hanCount = chars.filter(isHan).length;
  if (hanCount === 0 || hanCount !== syllables.length) {
    return { aligned: false, chars: chars.map((char) => ({ char })) };
  }
  let i = 0;
  return {
    aligned: true,
    chars: chars.map((char) => {
      if (!isHan(char)) return { char };
      const syllable = syllables[i++]!;
      return { char, pinyin: syllable, tone: toneOf(syllable) };
    }),
  };
}

export function containsHan(text: string): boolean {
  return HAN.test(text);
}
