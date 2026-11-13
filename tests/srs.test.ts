import { describe, expect, it } from "vitest";
import { PASS_SCORE, scheduleAfterAttempt, strengthOf } from "@/lib/srs";

const now = new Date("2026-11-13T12:00:00Z");
const DAY = 86_400_000;

describe("scheduleAfterAttempt", () => {
  it("first pass schedules a review tomorrow", () => {
    const r = scheduleAfterAttempt({ intervalDays: 0 }, 80, now);
    expect(r).toMatchObject({ passed: true, intervalDays: 1 });
    expect(r.nextReviewAt.getTime() - now.getTime()).toBe(DAY);
  });

  it("grows the interval faster for better scores", () => {
    expect(scheduleAfterAttempt({ intervalDays: 2 }, 95, now).intervalDays).toBe(6);
    expect(scheduleAfterAttempt({ intervalDays: 2 }, 85, now).intervalDays).toBe(5);
    expect(scheduleAfterAttempt({ intervalDays: 2 }, PASS_SCORE, now).intervalDays).toBe(4);
  });

  it("caps the interval", () => {
    expect(scheduleAfterAttempt({ intervalDays: 100 }, 99, now).intervalDays).toBe(120);
  });

  it("a weak attempt resets the word to come back soon", () => {
    const r = scheduleAfterAttempt({ intervalDays: 20 }, PASS_SCORE - 1, now);
    expect(r.passed).toBe(false);
    expect(r.intervalDays).toBe(0);
    expect(r.nextReviewAt.getTime() - now.getTime()).toBeLessThan(DAY);
  });

  it("treats a missing score as a fail", () => {
    expect(scheduleAfterAttempt({ intervalDays: 3 }, null, now).passed).toBe(false);
  });
});

describe("strengthOf", () => {
  it("classifies by interval once practised", () => {
    expect(strengthOf(0, 0)).toBe("new");
    expect(strengthOf(1, 2)).toBe("learning");
    expect(strengthOf(5, 3)).toBe("familiar");
    expect(strengthOf(30, 6)).toBe("mastered");
  });
});
