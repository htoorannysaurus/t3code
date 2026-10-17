import {
  displayLimitWindows,
  elapsedShare,
  formatDuration,
  type LimitPool,
} from "@t3tools/shared/usageLimits";

export type GlanceTone = "ok" | "warn" | "hot";

export interface GlanceRow {
  readonly key: string;
  readonly label: string;
  readonly usedPercent: number;
  /** Share of the window already gone, 0-100, or null when the window has no clock. */
  readonly elapsedPercent: number | null;
  /** "16 to spare" or "36 over pace", empty when the window is too young to judge. */
  readonly pace: string;
  readonly tone: GlanceTone;
  /** Compact countdown to the next refill, e.g. "4d 1h". */
  readonly resetsIn: string | null;
}

export interface GlanceSection {
  readonly driver: LimitPool["driver"];
  readonly plan: string | null;
  readonly tone: GlanceTone;
  readonly rows: readonly GlanceRow[];
}

// Early in a window, spend divided by time is dominated by the first session,
// so neither the projection nor the pace figure is worth showing yet.
const PACE_MIN_ELAPSED = 10;
const NEARLY_SPENT = 95;
const TONE_RANK: Record<GlanceTone, number> = { ok: 0, warn: 1, hot: 2 };

/**
 * Grades a limit by where its spend is projected to land when the window ends,
 * not by the raw percentage: 70% of a week is fine on day six and alarming on
 * day one. Windows without a clock fall back to flat thresholds.
 */
export function glanceTone(usedPercent: number, elapsedPercent: number | null): GlanceTone {
  if (usedPercent >= NEARLY_SPENT) return "hot";
  if (elapsedPercent !== null && elapsedPercent >= PACE_MIN_ELAPSED) {
    const projected = (usedPercent / elapsedPercent) * 100;
    if (projected >= 100) return "hot";
    if (projected >= 95) return "warn";
    return "ok";
  }
  if (usedPercent >= 90) return "hot";
  if (usedPercent >= 75) return "warn";
  return "ok";
}

function paceText(usedPercent: number, elapsedPercent: number | null, tone: GlanceTone): string {
  if (elapsedPercent === null || elapsedPercent < PACE_MIN_ELAPSED) return "";
  const gap = Math.round(usedPercent - elapsedPercent);
  if (gap > 0) return `${gap} over pace`;
  // Below the clock but still projected past the end would read "2 to spare"
  // in amber, so the surplus is only quoted on a healthy row.
  if (gap < 0 && tone === "ok") return `${-gap} to spare`;
  return "";
}

export function buildGlanceSections(
  pools: readonly LimitPool[],
  now: number,
): readonly GlanceSection[] {
  return pools.map((pool) => {
    const rows = displayLimitWindows(pool).map((window): GlanceRow => {
      const shares = window.members.flatMap((member) => {
        const share = elapsedShare(member.window, now);
        return share === null ? [] : [share];
      });
      const elapsedPercent =
        shares.length > 0
          ? (shares.reduce((sum, share) => sum + share, 0) / shares.length) * 100
          : null;
      const tone = glanceTone(window.usedPercent, elapsedPercent);
      const nextReset = window.resets.find((reset) => reset.at > now);
      return {
        key: `${window.kind}:${window.id}`,
        label: window.label,
        usedPercent: window.usedPercent,
        elapsedPercent,
        pace: paceText(window.usedPercent, elapsedPercent, tone),
        tone,
        resetsIn: nextReset ? formatDuration(nextReset.at - now) : null,
      };
    });
    const plans = [
      ...new Set(pool.accounts.flatMap((account) => (account.plan ? [account.plan] : []))),
    ];
    return {
      driver: pool.driver,
      plan: pool.accounts.length > 1 ? `${pool.accounts.length} accounts` : (plans[0] ?? null),
      tone: rows.reduce<GlanceTone>(
        (worst, row) => (TONE_RANK[row.tone] > TONE_RANK[worst] ? row.tone : worst),
        "ok",
      ),
      rows,
    };
  });
}

/** "Updated 4m ago" from the oldest reading on screen. */
export function updatedLabel(checkedAt: readonly string[], now: number): string | null {
  const times = checkedAt.map((value) => Date.parse(value)).filter(Number.isFinite);
  if (times.length === 0) return null;
  const age = Math.max(0, now - Math.min(...times));
  if (age < 60_000) return "Updated just now";
  return `Updated ${formatDuration(age)} ago`;
}
