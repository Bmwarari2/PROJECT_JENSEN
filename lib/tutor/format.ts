import type { PronunciationResult } from "@/lib/types";

// How the learner's side of the conversation is written for Claude.

export function sessionStartMessage(): string {
  return "[Session start] The learner has opened the app and is ready to begin.";
}

export function learnerTextMessage(text: string, via: "voice" | "text"): string {
  const clean = text.trim();
  return via === "voice" ? `[spoken] ${clean}` : clean;
}

const score = (n: number | null) => (n === null ? "n/a" : String(Math.round(n)));

export function attemptMessage(result: Omit<PronunciationResult, "attemptId" | "passed">): string {
  const { target, recognized, scores, words, method } = result;
  const clarity = method === "recognition";
  const lines = [
    clarity ? "[Pronunciation attempt: clarity check]" : "[Pronunciation attempt]",
    `Target: ${target.hanzi} (${target.pinyin}) = ${target.english}`,
    `${clarity ? "Recogniser" : "Assessor"} heard: ${recognized.trim() || "(nothing recognisable)"}`,
    clarity
      ? `Overall ${score(scores.pron)}/100 — completeness ${score(scores.completeness)}`
      : `Overall ${score(scores.pron)}/100 — accuracy ${score(scores.accuracy)}, fluency ${score(scores.fluency)}, completeness ${score(scores.completeness)}`,
  ];
  if (words.length > 0) {
    lines.push("Per character:");
    for (const w of words) {
      const sounds = w.phonemes
        .filter((p) => p.phoneme)
        .map((p) => `${p.phoneme} ${score(p.accuracy)}`)
        .join(", ");
      const error = w.errorType && w.errorType !== "None" ? ` (${w.errorType})` : "";
      const heard = w.heard ? `; heard ${w.heard}` : "";
      lines.push(`- ${w.text}: ${score(w.accuracy)}${error}${heard}${sounds ? `; sounds: ${sounds}` : ""}`);
    }
  }
  return lines.join("\n");
}
