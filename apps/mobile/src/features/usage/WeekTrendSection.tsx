import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UsageProviderKind } from "@t3tools/contracts";
import { formatDuration, collectLimitAccounts } from "@t3tools/shared/usageLimits";
import { makeWindow } from "@t3tools/shared/usageFormat";
import { useMemo } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentPresentations } from "../../state/presentation";
import { useUsage } from "../../state/usage";
import { useProviderColors } from "./usageProviders";
import { weekTrend, type WeekTrend } from "./weekTrend";

const DRIVER_KIND: Partial<Record<string, UsageProviderKind>> = {
  claudeAgent: "claude",
  codex: "codex",
};
const DRIVER_LABEL: Partial<Record<string, string>> = { claudeAgent: "Claude", codex: "Codex" };
const BAR_HEIGHT = 72;

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TrendCard(props: {
  readonly title: string;
  readonly driver: string;
  readonly trend: WeekTrend;
  readonly color: string;
  readonly now: number;
}) {
  const { trend, now } = props;
  const projected = trend.projectedPercent === null ? null : Math.round(trend.projectedPercent);
  const tone =
    projected === null
      ? "text-foreground"
      : projected > 100
        ? "text-red-500"
        : projected > 90
          ? "text-amber-500"
          : "text-foreground";
  const evenDay = 100 / Math.max(1, trend.days.length - 1);
  const tallest = Math.max(evenDay * 1.5, ...trend.days.map((day) => day.usedPercent ?? 0));
  return (
    <View className="gap-3 rounded-[24px] border-continuous bg-grouped-card p-4">
      <View className="flex-row items-center gap-2">
        <ProviderIcon provider={props.driver} size={16} />
        <Text className="min-w-0 flex-1 text-sm font-t3-medium text-foreground" numberOfLines={1}>
          {props.title}
        </Text>
        <Text className="text-xs tabular-nums text-foreground-tertiary">
          resets {formatWhen(trend.resetsAt)}
        </Text>
      </View>
      <View className="gap-1">
        {projected === null ? (
          <Text className="text-2xl font-t3-bold text-foreground">Too early to tell</Text>
        ) : (
          <Text className={`text-2xl font-t3-bold tabular-nums ${tone}`}>
            Heading for {projected}%
          </Text>
        )}
        <Text className="text-sm text-foreground-muted">
          {trend.runsOutAt !== null
            ? trend.runsOutAt <= now
              ? "Limit reached."
              : `Runs out ${formatWhen(trend.runsOutAt)}, ${formatDuration(trend.resetsAt - trend.runsOutAt)} before reset.`
            : trend.dailyAllowance !== null
              ? `You can use about ${Math.round(trend.dailyAllowance)}% a day and still make it.`
              : "Resetting now."}
        </Text>
      </View>
      <View>
        <View className="flex-row items-end gap-1.5" style={{ height: BAR_HEIGHT }}>
          {trend.days.map((day) => (
            <View
              key={day.day}
              className={
                day.usedPercent === null
                  ? "flex-1 rounded-md border border-dashed border-border"
                  : "flex-1 rounded-md"
              }
              style={
                day.usedPercent === null
                  ? { height: 6 }
                  : {
                      height: Math.max(3, (day.usedPercent / tallest) * BAR_HEIGHT),
                      backgroundColor: props.color,
                      opacity: day.isToday ? 0.55 : 1,
                    }
              }
            />
          ))}
        </View>
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 border-t border-dashed border-foreground-tertiary"
          style={{ bottom: (evenDay / tallest) * BAR_HEIGHT }}
        />
      </View>
      <View className="flex-row gap-1.5">
        {trend.days.map((day) => (
          <Text
            key={day.day}
            className={
              day.isToday
                ? "flex-1 text-center text-xs font-t3-medium text-foreground"
                : "flex-1 text-center text-xs text-foreground-tertiary"
            }
          >
            {day.weekday}
          </Text>
        ))}
      </View>
      <Text className="text-xs tabular-nums text-foreground-tertiary">
        {Math.round(trend.usedPercent)}% used, {Math.round(trend.elapsed * 100)}% of the week gone.
        Dashed line is an even daily pace; daily bars are estimated from spend.
      </Text>
    </View>
  );
}

/** Weekly limits projected forward: where each one lands at reset at the current rate. */
export function WeekTrendSection(props: {
  readonly now: number;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const { now, selectedEnvironmentIds } = props;
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const window = useMemo(() => makeWindow(9), []);
  const { merged } = useUsage(window, selectedEnvironmentIds);
  const colors = useProviderColors();
  const selected =
    selectedEnvironmentIds === null
      ? presentations
      : new Map([...presentations].filter(([id]) => selectedEnvironmentIds.has(id)));
  const accounts = collectLimitAccounts(selected);
  const sameDriverCount = (driver: string) =>
    accounts.filter((account) => account.driver === driver).length;
  const cards = accounts.flatMap((account) => {
    const kind = DRIVER_KIND[account.driver];
    const dailyCost = new Map(
      merged.daily.map((day) => [
        day.day,
        kind ? (day.byProvider.get(kind)?.costUsd ?? 0) : day.costUsd,
      ]),
    );
    return account.limits.windows
      .filter((limit) => limit.kind === "weekly")
      .flatMap((limit) => {
        const trend = weekTrend({ window: limit, now, timeZone: window.timeZone, dailyCost });
        if (!trend) return [];
        const name = DRIVER_LABEL[account.driver] ?? String(account.driver);
        const who =
          sameDriverCount(account.driver) > 1
            ? ` (${account.displayName ?? account.email ?? ""})`
            : "";
        return [
          {
            key: `${account.key}:${limit.id}`,
            title: `${name}${who} · ${limit.label}`,
            driver: account.driver,
            color: (kind && colors[kind]) || account.accentColor || "#8b8b8b",
            trend,
          },
        ];
      });
  });
  if (cards.length === 0) return null;
  return (
    <View className="gap-3">
      <Text className="px-1 text-sm font-t3-medium text-foreground-muted">This week</Text>
      {cards.map(({ key, ...card }) => (
        <TrendCard key={key} {...card} now={now} />
      ))}
    </View>
  );
}
