import { z } from "zod";
import type { TutorReply } from "@/lib/types";

// The tutor answers in this JSON shape (enforced by structured outputs), so
// the app always knows which parts are English, which are Chinese, what to
// ask the learner to repeat, and what to save to their progress.
//
// Descriptions here are sent to Claude as part of the schema.

const ChineseItemSchema = z.object({
  hanzi: z.string().describe("Simplified Chinese characters only."),
  pinyin: z
    .string()
    .describe("Tone-marked pinyin, one syllable per character separated by spaces, e.g. 'xiè xie'."),
  english: z.string().describe("Short English meaning."),
});

export const TutorReplySchema = z.object({
  speech: z
    .array(
      z.object({
        lang: z.enum(["en", "zh"]),
        text: z
          .string()
          .describe(
            "en: plain spoken English with no Chinese characters or pinyin. zh: Simplified Chinese characters only.",
          ),
        pinyin: z.string().describe("zh: tone-marked pinyin, one syllable per character, spaces between. en: ''."),
        english: z.string().describe("zh: short English meaning. en: ''."),
      }),
    )
    .describe("What you say, in order. The app speaks each segment in the right voice."),
  on_screen_note: z
    .string()
    .describe("Optional short written tip shown on screen, not spoken (may contain pinyin). '' if none."),
  practice: ChineseItemSchema.nullable().describe(
    "The word or short phrase the learner should now say aloud (they'll get a pronunciation score), or null.",
  ),
  vocabulary: z
    .array(ChineseItemSchema)
    .describe("Chinese words or set phrases taught, reviewed or practised in this turn."),
  learner_notes: z
    .string()
    .nullable()
    .describe("Complete updated notes about the learner if something worth remembering changed; otherwise null."),
  unit_complete: z.boolean().describe("True only when the learner has finished the current unit."),
}) satisfies z.ZodType<TutorReply>;

/** Light clean-up so small formatting slips don't reach the UI or the voice. */
export function normalizeReply(reply: TutorReply): TutorReply {
  return {
    ...reply,
    speech: reply.speech
      .map((s) => ({
        lang: s.lang,
        text: s.text.trim(),
        pinyin: s.lang === "zh" ? s.pinyin.trim() : "",
        english: s.lang === "zh" ? s.english.trim() : "",
      }))
      .filter((s) => s.text.length > 0),
    on_screen_note: reply.on_screen_note.trim(),
    practice:
      reply.practice && reply.practice.hanzi.trim()
        ? {
            hanzi: reply.practice.hanzi.trim(),
            pinyin: reply.practice.pinyin.trim(),
            english: reply.practice.english.trim(),
          }
        : null,
    vocabulary: reply.vocabulary.filter((v) => v.hanzi.trim().length > 0),
    learner_notes: reply.learner_notes?.trim() || null,
  };
}
