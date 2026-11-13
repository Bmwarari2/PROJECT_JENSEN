// Date helpers that respect the learner's own time zone.

export function safeTimezone(tz: string | undefined | null): string {
  if (!tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** YYYY-MM-DD for `date` in `timezone`. */
export function localDate(date: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function describeDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive study days ending today (or yesterday — the streak survives
 * until you miss a full day). `days` are YYYY-MM-DD strings in any order.
 */
export function streakLength(days: string[], today: string): number {
  const set = new Set(days);
  let cursor = set.has(today) ? today : previousDay(today);
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = previousDay(cursor);
  }
  return streak;
}
