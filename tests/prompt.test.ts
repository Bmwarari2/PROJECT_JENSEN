import { describe, expect, it } from "vitest";
import { buildSystemPrompt, renderSnapshot, splitSystemPrompt, STATIC_SYSTEM_PROMPT, type LearnerSnapshot } from "@/lib/tutor/prompt";
import { CURRICULUM } from "@/lib/curriculum";

const snapshot: LearnerSnapshot = {
  now: "Friday 13 November 2026 at 19:05",
  sessionCount: 3,
  lastSessionDate: "2026-11-12",
  currentUnit: 2,
  tutorNotes: "Name is Sam. Mixes up tones 2 and 3.",
  wordsLearned: [{ hanzi: "你好", pinyin: "nǐ hǎo", english: "hello", strength: "familiar" }],
  dueForReview: [{ hanzi: "谢谢", pinyin: "xiè xie", english: "thank you", lastScore: 62.4 }],
  recentAverage: 74.2,
  weakest: [{ hanzi: "谢谢", score: 62.4 }],
};

describe("system prompt", () => {
  it("includes every unit of the course", () => {
    for (const unit of CURRICULUM) expect(STATIC_SYSTEM_PROMPT).toContain(`Unit ${unit.number}: ${unit.title}`);
  });

  it("splits back into the cacheable static part and the snapshot", () => {
    const prompt = buildSystemPrompt(snapshot);
    const { staticPart, dynamicPart } = splitSystemPrompt(prompt);
    expect(staticPart).toBe(STATIC_SYSTEM_PROMPT);
    expect(dynamicPart.startsWith("<learner_snapshot>")).toBe(true);
    expect(`${staticPart}\n\n${dynamicPart}`).toBe(prompt);
  });

  it("renders the learner snapshot", () => {
    const text = renderSnapshot(snapshot);
    expect(text).toContain("Previous sessions: 3 (last one: 2026-11-12).");
    expect(text).toContain("Current unit: 2, Greetings and courtesy");
    expect(text).toContain("- 你好 nǐ hǎo = hello [familiar]");
    expect(text).toContain("- 谢谢 xiè xie = thank you (last score 62)");
    expect(text).toContain("Recent pronunciation average: 74/100; weakest recent items: 谢谢 (62).");
  });

  it("describes a first session", () => {
    const text = renderSnapshot({ ...snapshot, sessionCount: 0, wordsLearned: [], dueForReview: [], recentAverage: null, tutorNotes: "" });
    expect(text).toContain("This is their first session.");
    expect(text).toContain("Words learned: none yet.");
    expect(text).toContain("(none yet)");
  });
});
