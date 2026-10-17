import type { ServerProviderUsageWindow } from "@t3tools/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeekTrendDay {
  /** Local calendar day, YYYY-MM-DD. */
  readonly day: string;
  readonly weekday: string;
  /** Estimated share of the limit used that day, or null for days still ahead. */
  readonly usedPercent: number | null;
  readonly isToday: boolean;
}

export interface WeekTrend {
  readonly usedPercent: number;
  /** 0-1 share of the window that has passed. */
  readonly elapsed: number;
  readonly startsAt: number;
  readonly resetsAt: number;
  /** Where usage lands at reset if the current rate holds; null while too early to tell. */
  readonly projectedPercent: number | null;
  /** When the limit runs out at the current rate, if that is before the reset. */
  readonly runsOutAt: number | null;
  /** Percent per day still available to finish at 100%. */
  readonly dailyAllowance: number | null;
  readonly days: readonly WeekTrendDay[];
}

function localDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function localWeekday(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "narrow" }).format(new Date(ms));
}

/**
 * Projects a weekly limit window forward from its current rate, and splits the
 * percent used so far across days in proportion to each day's spend.
 */
export function weekTrend(input: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly timeZone: string;
  /** Spend per local day for the provider behind this window. */
  readonly dailyCost: ReadonlyMap<string, number>;
}): WeekTrend | null {
  const { window, now, timeZone } = input;
  if (window.resetsAt === undefined || window.windowDurationMins === undefined) return null;
  const resetsAt = Date.parse(window.resetsAt);
  const length = window.windowDurationMins * 60_000;
  if (!Number.isFinite(resetsAt) || length <= 0) return null;
  const startsAt = resetsAt - length;
  const elapsed = Math.max(0, Math.min(1, (now - startsAt) / length));
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const leftMs = Math.max(0, resetsAt - now);

  // Under ~6 hours in, one burst swings the projection wildly.
  const projectedPercent = elapsed * length >= 6 * 60 * 60 * 1000 ? used / elapsed : null;
  const rate = now > startsAt ? used / (now - startsAt) : 0;
  const runsOutAt =
    used >= 100
      ? now
      : rate > 0 && now + (100 - used) / rate < resetsAt
        ? now + (100 - used) / rate
        : null;
  const dailyAllowance = leftMs > 0 ? ((100 - used) / leftMs) * DAY_MS : null;

  const today = localDay(now, timeZone);
  const columns: { day: string; at: number }[] = [];
  // The window rarely starts at midnight, so its first and last local days are partial.
  for (const at of [
    ...Array.from({ length: Math.ceil(length / DAY_MS) }, (_, index) => startsAt + index * DAY_MS),
    resetsAt - 1,
  ]) {
    const day = localDay(at, timeZone);
    if (!columns.some((column) => column.day === day)) columns.push({ day, at });
  }
  const pastDays = columns.filter((column) => column.day <= today);
  const totalCost = pastDays.reduce(
    (sum, column) => sum + (input.dailyCost.get(column.day) ?? 0),
    0,
  );
  const days = columns.map((column): WeekTrendDay => {
    const past = column.day <= today;
    const cost = input.dailyCost.get(column.day) ?? 0;
    return {
      day: column.day,
      weekday: localWeekday(column.at, timeZone),
      usedPercent: !past ? null : totalCost > 0 ? (used * cost) / totalCost : 0,
      isToday: column.day === today,
    };
  });
  return {
    usedPercent: used,
    elapsed,
    startsAt,
    resetsAt,
    projectedPercent,
    runsOutAt,
    dailyAllowance,
    days,
  };
}
