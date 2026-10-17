import { describe, expect, it } from "vite-plus/test";

import { weekTrend } from "./weekTrend";

const HOUR = 3_600_000;
const resetsAt = Date.parse("2026-10-20T16:00:00Z");
const window = (usedPercent: number) => ({
  id: "weekly",
  kind: "weekly" as const,
  label: "Weekly",
  usedPercent,
  resetsAt: new Date(resetsAt).toISOString(),
  windowDurationMins: 7 * 24 * 60,
});

describe("weekTrend", () => {
  it("projects the current rate to the reset", () => {
    const now = resetsAt - 3.5 * 24 * HOUR;
    const trend = weekTrend({ window: window(30), now, timeZone: "UTC", dailyCost: new Map() });
    expect(trend?.projectedPercent).toBeCloseTo(60);
    expect(trend?.runsOutAt).toBeNull();
    expect(trend?.dailyAllowance).toBeCloseTo(20);
  });

  it("says when the limit runs out early", () => {
    const now = resetsAt - 3.5 * 24 * HOUR;
    const trend = weekTrend({ window: window(70), now, timeZone: "UTC", dailyCost: new Map() });
    expect(trend?.projectedPercent).toBeCloseTo(140);
    expect(trend?.runsOutAt).toBeCloseTo(now + 1.5 * 24 * HOUR, -3);
  });

  it("holds the projection back in the first hours", () => {
    const now = resetsAt - 7 * 24 * HOUR + 2 * HOUR;
    expect(
      weekTrend({ window: window(5), now, timeZone: "UTC", dailyCost: new Map() })
        ?.projectedPercent,
    ).toBeNull();
  });

  it("splits used percent across days by spend", () => {
    const now = resetsAt - 5 * 24 * HOUR;
    const trend = weekTrend({
      window: window(40),
      now,
      timeZone: "UTC",
      dailyCost: new Map([
        ["2026-10-13", 10],
        ["2026-10-14", 30],
        ["2026-10-15", 40],
      ]),
    });
    expect(trend?.days).toHaveLength(8);
    expect(trend?.days.map((day) => day.usedPercent)).toEqual([
      5,
      15,
      20,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(trend?.days[2]?.isToday).toBe(true);
  });
});
