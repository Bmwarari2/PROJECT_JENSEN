import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { activityDays, countAttempts, getLearnerState, listRecentAttempts, listVocabulary, vocabStrength } from "@/lib/db";
import { TOTAL_UNITS, unitInfo } from "@/lib/curriculum";
import { localDate, safeTimezone, streakLength } from "@/lib/time";
import type { ProgressResponse } from "@/lib/types";

export async function GET(request: NextRequest) {
  const timezone = safeTimezone(request.nextUrl.searchParams.get("tz"));
  try {
    const [state, vocab, attempts, attemptCount, days] = await Promise.all([
      getLearnerState(),
      listVocabulary(),
      listRecentAttempts(30),
      countAttempts(),
      activityDays(timezone),
    ]);
    const now = Date.now();
    const vocabulary = vocab.map((v) => ({
      hanzi: v.hanzi,
      pinyin: v.pinyin,
      english: v.english,
      introducedAt: v.introduced_at,
      practiceAttempts: v.practice_attempts,
      practicePasses: v.practice_passes,
      lastScore: v.last_score,
      bestScore: v.best_score,
      intervalDays: v.interval_days,
      nextReviewAt: v.next_review_at,
      reviewInDays: Math.ceil((Date.parse(v.next_review_at) - now) / 86_400_000),
      strength: vocabStrength(v),
    }));
    const scored = attempts.filter((a) => a.pron_score !== null).slice(0, 20);

    const body: ProgressResponse = {
      unit: unitInfo(state.current_unit),
      totalUnits: TOTAL_UNITS,
      streakDays: streakLength(days, localDate(new Date(), timezone)),
      studyDays: days.length,
      wordsLearned: vocabulary.length,
      wordsMastered: vocabulary.filter((v) => v.strength === "mastered").length,
      dueForReview: vocabulary.filter((v) => v.reviewInDays <= 0).length,
      attempts: attemptCount,
      recentAverage: scored.length ? scored.reduce((n, a) => n + (a.pron_score ?? 0), 0) / scored.length : null,
      vocabulary,
      recentAttempts: attempts.slice(0, 15).map((a) => ({
        id: a.id,
        createdAt: a.created_at,
        hanzi: a.target_hanzi,
        pinyin: a.target_pinyin,
        score: a.pron_score,
      })),
    };
    return NextResponse.json(body);
  } catch (error) {
    return handleRouteError("progress", error);
  }
}
