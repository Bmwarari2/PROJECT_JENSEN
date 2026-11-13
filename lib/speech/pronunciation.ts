import { PASS_SCORE } from "@/lib/srs";
import type {
  ChineseItem,
  PronunciationPhoneme,
  PronunciationResult,
  PronunciationScores,
  PronunciationWord,
} from "@/lib/types";

// Normalises Azure's pronunciation-assessment JSON. The REST API puts scores
// directly on each object, while SDK-style JSON nests them under
// "PronunciationAssessment"; both shapes are accepted.

type Scored = {
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  PronScore?: number;
  ErrorType?: string;
};

interface AzurePhoneme extends Scored {
  Phoneme?: string;
  PronunciationAssessment?: Scored;
}

interface AzureWord extends Scored {
  Word?: string;
  PronunciationAssessment?: Scored;
  Phonemes?: AzurePhoneme[];
}

interface AzureNBest extends Scored {
  Display?: string;
  Lexical?: string;
  PronunciationAssessment?: Scored;
  Words?: AzureWord[];
}

export interface AzureShortAudioResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: AzureNBest[];
}

export type AssessmentOutcome =
  | { status: "ok"; recognized: string; scores: PronunciationScores; words: PronunciationWord[] }
  | { status: "no_speech" } // silence or noise only
  | { status: "no_match" } // speech, but not recognisable as the target language
  | { status: "error"; detail: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function pick(obj: Scored & { PronunciationAssessment?: Scored }, key: keyof Scored): unknown {
  return obj.PronunciationAssessment?.[key] ?? obj[key];
}

export function normalizeAssessment(response: AzureShortAudioResponse): AssessmentOutcome {
  const status = response.RecognitionStatus ?? "Error";
  if (status === "InitialSilenceTimeout" || status === "BabbleTimeout") return { status: "no_speech" };
  if (status === "NoMatch") return { status: "no_match" };
  const best = response.NBest?.[0];
  if (status !== "Success" || !best) return { status: "error", detail: `RecognitionStatus=${status}` };

  const words: PronunciationWord[] = (best.Words ?? []).map((w) => ({
    text: w.Word ?? "",
    accuracy: num(pick(w, "AccuracyScore")),
    errorType: String(pick(w, "ErrorType") ?? "None"),
    phonemes: (w.Phonemes ?? []).map(
      (p): PronunciationPhoneme => ({ phoneme: p.Phoneme ?? "", accuracy: num(pick(p, "AccuracyScore")) }),
    ),
  }));

  return {
    status: "ok",
    recognized: best.Display ?? response.DisplayText ?? best.Lexical ?? "",
    scores: {
      pron: num(pick(best, "PronScore")),
      accuracy: num(pick(best, "AccuracyScore")),
      fluency: num(pick(best, "FluencyScore")),
      completeness: num(pick(best, "CompletenessScore")),
    },
    words,
  };
}

/** Shape a stored attempt for the UI and for the tutor. */
export function attemptRowToResult(row: {
  id: number;
  target_hanzi: string;
  target_pinyin: string;
  target_english: string;
  recognized_text: string;
  pron_score: number | null;
  accuracy_score: number | null;
  fluency_score: number | null;
  completeness_score: number | null;
  words: unknown;
}): PronunciationResult {
  const target: ChineseItem = { hanzi: row.target_hanzi, pinyin: row.target_pinyin, english: row.target_english };
  return {
    attemptId: row.id,
    target,
    recognized: row.recognized_text,
    scores: {
      pron: row.pron_score,
      accuracy: row.accuracy_score,
      fluency: row.fluency_score,
      completeness: row.completeness_score,
    },
    words: Array.isArray(row.words) ? (row.words as PronunciationWord[]) : [],
    passed: row.pron_score !== null && row.pron_score >= PASS_SCORE,
  };
}
