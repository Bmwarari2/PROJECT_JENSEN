import { describe, expect, it } from "vitest";
import { localDate, safeTimezone, streakLength } from "@/lib/time";

describe("streakLength", () => {
  it("counts consecutive days ending today", () => {
    expect(streakLength(["2026-11-13", "2026-11-12", "2026-11-11", "2026-11-09"], "2026-11-13")).toBe(3);
  });

  it("keeps the streak alive until a full day is missed", () => {
    expect(streakLength(["2026-11-12", "2026-11-11"], "2026-11-13")).toBe(2);
    expect(streakLength(["2026-11-11"], "2026-11-13")).toBe(0);
  });

  it("crosses month boundaries", () => {
    expect(streakLength(["2026-12-01", "2026-11-30", "2026-11-29"], "2026-12-01")).toBe(3);
  });
});

describe("time zones", () => {
  it("falls back to UTC for invalid zones", () => {
    expect(safeTimezone("Africa/Nairobi")).toBe("Africa/Nairobi");
    expect(safeTimezone("Not/AZone")).toBe("UTC");
    expect(safeTimezone(undefined)).toBe("UTC");
  });

  it("formats the local date", () => {
    const instant = new Date("2026-11-13T22:30:00Z");
    expect(localDate(instant, "UTC")).toBe("2026-11-13");
    expect(localDate(instant, "Asia/Shanghai")).toBe("2026-11-14");
  });
});
