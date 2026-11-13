import type { Lang } from "@/lib/types";

export interface SsmlOptions {
  voiceEn: string;
  voiceZh: string;
  slowChinese: boolean;
}

/**
 * Learner pace for Chinese. Azure's Mandarin voices speak briskly, so a
 * beginner needs it well below normal speed to hear each tone:
 * ~60% inside a reply, ~50% when a single word is played on its own (tapping
 * a word, the practice card's "Listen", the progress page).
 */
export const SLOW_CHINESE_RATE = "-40%";
export const SINGLE_WORD_RATE = "-50%";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * One <voice> element per run of same-language segments: English in the
 * English voice, Chinese in a native Mandarin voice, slowed down for learners
 * and set off by short pauses so each word is easy to pick out.
 */
export function buildSsml(segments: Array<{ lang: Lang; text: string }>, options: SsmlOptions): string {
  const runs: Array<{ lang: Lang; texts: string[] }> = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const last = runs.at(-1);
    if (last && last.lang === segment.lang) last.texts.push(text);
    else runs.push({ lang: segment.lang, texts: [text] });
  }

  const singleWord = runs.length === 1 && runs[0]!.lang === "zh" && runs[0]!.texts.length === 1;
  const body = runs
    .map((run) => {
      if (run.lang === "en") {
        return `<voice name="${escapeXml(options.voiceEn)}">${escapeXml(run.texts.join(" "))}</voice>`;
      }
      const chinese = run.texts.map(escapeXml).join('<break time="400ms"/>');
      if (!options.slowChinese) {
        return `<voice name="${escapeXml(options.voiceZh)}"><break time="150ms"/>${chinese}<break time="250ms"/></voice>`;
      }
      const rate = singleWord ? SINGLE_WORD_RATE : SLOW_CHINESE_RATE;
      return `<voice name="${escapeXml(options.voiceZh)}"><break time="250ms"/><prosody rate="${rate}">${chinese}</prosody><break time="350ms"/></voice>`;
    })
    .join("");

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">${body}</speak>`;
}
