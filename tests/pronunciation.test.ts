import { describe, expect, it } from "vitest";
import { attemptRowToResult, normalizeAssessment } from "@/lib/speech/pronunciation";
import { attemptMessage } from "@/lib/tutor/format";

describe("normalizeAssessment", () => {
  it("reads the REST shape (scores directly on objects)", () => {
    const outcome = normalizeAssessment({
      RecognitionStatus: "Success",
      DisplayText: "谢谢。",
      NBest: [
        {
          Display: "谢谢。",
          AccuracyScore: 78,
          FluencyScore: 90,
          CompletenessScore: 100,
          PronScore: 84.5,
          Words: [
            {
              Word: "谢谢",
              AccuracyScore: 78,
              ErrorType: "None",
              Phonemes: [
                { Phoneme: "x ie 4", AccuracyScore: 92 },
                { Phoneme: "x ie 5", AccuracyScore: 61 },
              ],
            },
          ],
        },
      ],
    });
    expect(outcome).toEqual({
      status: "ok",
      recognized: "谢谢。",
      scores: { pron: 84.5, accuracy: 78, fluency: 90, completeness: 100 },
      words: [
        {
          text: "谢谢",
          accuracy: 78,
          errorType: "None",
          phonemes: [
            { phoneme: "x ie 4", accuracy: 92 },
            { phoneme: "x ie 5", accuracy: 61 },
          ],
        },
      ],
    });
  });

  it("reads the SDK shape (scores nested under PronunciationAssessment)", () => {
    const outcome = normalizeAssessment({
      RecognitionStatus: "Success",
      NBest: [
        {
          Display: "你好",
          PronunciationAssessment: { AccuracyScore: 95, FluencyScore: 100, CompletenessScore: 100, PronScore: 97 },
          Words: [{ Word: "你", PronunciationAssessment: { AccuracyScore: 40, ErrorType: "Mispronunciation" } }],
        },
      ],
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.scores.pron).toBe(97);
    expect(outcome.words[0]).toMatchObject({ text: "你", accuracy: 40, errorType: "Mispronunciation", phonemes: [] });
  });

  it("maps non-success statuses", () => {
    expect(normalizeAssessment({ RecognitionStatus: "InitialSilenceTimeout" })).toEqual({ status: "no_speech" });
    expect(normalizeAssessment({ RecognitionStatus: "NoMatch" })).toEqual({ status: "no_match" });
    expect(normalizeAssessment({ RecognitionStatus: "Success", NBest: [] }).status).toBe("error");
  });
});

describe("attempt formatting", () => {
  const row = {
    id: 7,
    target_hanzi: "谢谢",
    target_pinyin: "xiè xie",
    target_english: "thank you",
    recognized_text: "谢谢。",
    pron_score: 66.4,
    accuracy_score: 60,
    fluency_score: 88,
    completeness_score: 100,
    words: [{ text: "谢谢", accuracy: 60, errorType: "Mispronunciation", phonemes: [{ phoneme: "x ie 4", accuracy: 55 }] }],
  };

  it("turns a stored row into a result", () => {
    const result = attemptRowToResult(row);
    expect(result).toMatchObject({ attemptId: 7, passed: false, target: { english: "thank you" } });
  });

  it("writes a readable summary for the tutor", () => {
    const text = attemptMessage(attemptRowToResult(row));
    expect(text).toContain("[Pronunciation attempt]");
    expect(text).toContain("Target: 谢谢 (xiè xie) = thank you");
    expect(text).toContain("Overall 66/100");
    expect(text).toContain("- 谢谢: 60 (Mispronunciation); sounds: x ie 4 55");
  });
});
