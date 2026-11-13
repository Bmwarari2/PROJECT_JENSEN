// A small spaced-repetition scheduler driven by pronunciation scores.
//
// Words you say well come back after growing gaps (1 → ~2.5 → ~6 → ~15 days…);
// a weak attempt resets the word so it comes back in the next session.

export const PASS_SCORE = 70;
const MAX_INTERVAL_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SrsState {
  intervalDays: number;
}

export interface SrsUpdate {
  passed: boolean;
  intervalDays: number;
  nextReviewAt: Date;
}

export function scheduleAfterAttempt(state: SrsState, score: number | null, now: Date = new Date()): SrsUpdate {
  const passed = score !== null && score >= PASS_SCORE;
  if (!passed) {
    // Come back soon (next session), not mid-way through this one.
    return { passed, intervalDays: 0, nextReviewAt: new Date(now.getTime() + 2 * 60 * 60 * 1000) };
  }
  const growth = score >= 90 ? 3 : score >= 80 ? 2.5 : 2;
  const intervalDays =
    state.intervalDays <= 0 ? 1 : Math.min(MAX_INTERVAL_DAYS, round1(state.intervalDays * growth));
  return { passed, intervalDays, nextReviewAt: new Date(now.getTime() + intervalDays * DAY_MS) };
}

export type Strength = "new" | "learning" | "familiar" | "mastered";

export function strengthOf(intervalDays: number, practiceAttempts: number): Strength {
  if (practiceAttempts === 0) return "new";
  if (intervalDays >= 14) return "mastered";
  if (intervalDays >= 3) return "familiar";
  return "learning";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
