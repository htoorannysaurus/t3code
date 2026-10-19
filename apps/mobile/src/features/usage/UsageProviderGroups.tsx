import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { View } from "react-native";

import { ProviderIcon } from "../../components/ProviderIcon";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { environmentPresentations } from "../../state/presentation";
import {
  buildGlanceSections,
  type GlanceSection,
  type GlanceTone,
  updatedLabel,
} from "./limitGlance";
import { TrendCard, useWeekTrendCards } from "./WeekTrendCards";

const DRIVER_LABEL: Partial<Record<string, string>> = {
  codex: "Codex",
  claudeAgent: "Claude",
  antigravity: "Antigravity",
  cursor: "Cursor",
  grok: "Grok",
};

const TONE_COLOR: Record<GlanceTone, string> = {
  ok: "#34c759",
  warn: "#ff9f0a",
  hot: "#ff3b30",
};

/**
 * The Limits tab, one block per provider, so Codex and Claude never share a
 * card: a heading, a card with each limit window (spent, how far through the
 * window the clock is, the gap between the two, when it refills), then that
 * provider's weekly projections. Modelled on the Claudeputer usage screen.
 */
export function UsageProviderGroups(props: {
  readonly now: number;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  // Joe only wants the weekly projection for Claude, not Codex.
  const trendCards = useWeekTrendCards(props.now, props.selectedEnvironmentIds).filter(
    (card) => card.driver !== "codex",
  );
  const selected =
    props.selectedEnvironmentIds === null
      ? presentations
      : new Map(
          [...presentations].filter(([id]) => props.selectedEnvironmentIds?.has(id) ?? false),
        );
  const accounts = collectLimitAccounts(selected);
  const sections = buildGlanceSections(collectLimitPools(accounts, props.now), props.now).filter(
    (section) => section.rows.length > 0,
  );
  const drivers = [
    ...new Set([
      ...sections.map((section) => section.driver),
      ...trendCards.map((card) => card.driver),
    ]),
  ];
  if (drivers.length === 0) return null;
  const updated = updatedLabel(
    accounts.map((account) => account.limits.checkedAt),
    props.now,
  );

  return (
    <View className="gap-2">
      {updated ? <Text className="px-1 text-xs text-foreground-muted">{updated}</Text> : null}
      {drivers.map((driver, index) => {
        const section = sections.find((candidate) => candidate.driver === driver);
        const trends = trendCards.filter((card) => card.driver === driver);
        return (
          <View
            key={driver}
            className={index === 0 ? "gap-3" : "mt-6 gap-3 border-t border-border-subtle pt-6"}
          >
            <View className="flex-row items-center gap-2 px-1">
              <ProviderIcon provider={driver} size={20} />
              <Text className="text-xl font-t3-bold text-foreground">
                {DRIVER_LABEL[driver] ?? driver}
              </Text>
              {section ? (
                <View
                  className="size-2 rounded-full"
                  style={{ backgroundColor: TONE_COLOR[section.tone] }}
                />
              ) : null}
              {section?.plan ? (
                <Text className="ml-auto text-sm text-foreground-muted" numberOfLines={1}>
                  {section.plan}
                </Text>
              ) : null}
            </View>
            {section ? <LimitsCard section={section} /> : null}
            {trends.length > 0 ? (
              <Text className="px-1 pt-1 text-sm font-t3-medium text-foreground-muted">
                This week
              </Text>
            ) : null}
            {trends.map(({ key, ...card }) => (
              <TrendCard key={key} {...card} now={props.now} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function LimitsCard(props: { readonly section: GlanceSection }) {
  return (
    <View className="overflow-hidden rounded-[24px] border-continuous bg-grouped-card">
      {props.section.rows.map((row, index) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${row.label}, ${row.usedPercent}% used${
            row.elapsedPercent === null
              ? ""
              : `, ${Math.round(row.elapsedPercent)}% of the window elapsed`
          }${row.pace ? `, ${row.pace}` : ""}${row.resetsIn ? `, resets in ${row.resetsIn}` : ""}`}
          className={`flex-row items-center gap-3 px-4 py-2.5 ${index === 0 ? "" : "border-t border-border-subtle"}`}
        >
          <View className="min-w-0 flex-1 gap-1.5">
            <View className="flex-row flex-wrap items-baseline gap-x-1.5">
              <Text className="text-sm font-t3-medium text-foreground">{row.label}</Text>
              {row.elapsedPercent !== null ? (
                <Text className="text-xs tabular-nums text-foreground-muted">
                  {Math.round(row.elapsedPercent)}% elapsed
                </Text>
              ) : null}
              {row.pace ? (
                <Text
                  className="text-xs font-t3-medium tabular-nums text-foreground"
                  style={row.tone === "ok" ? undefined : { color: TONE_COLOR[row.tone] }}
                >
                  {row.pace}
                </Text>
              ) : null}
            </View>
            <View className="h-3 justify-center">
              <View className="h-1.5 flex-row overflow-hidden rounded-full bg-subtle">
                <View
                  className="h-full rounded-full"
                  style={{
                    flex: row.usedPercent,
                    backgroundColor: TONE_COLOR[row.tone],
                  }}
                />
                <View style={{ flex: 100 - row.usedPercent }} />
              </View>
              {row.elapsedPercent !== null ? (
                <View
                  className="absolute top-0 bottom-0 w-0.5 rounded-full bg-foreground"
                  style={{ left: `${row.elapsedPercent}%` }}
                />
              ) : null}
            </View>
          </View>
          <View className="w-[76px] items-end gap-0.5">
            <Text
              className="text-lg font-t3-bold tabular-nums text-foreground"
              style={row.tone === "ok" ? undefined : { color: TONE_COLOR[row.tone] }}
            >
              {row.usedPercent}%
            </Text>
            {row.resetsIn ? (
              <View className="flex-row items-center gap-1">
                <SymbolView name="clock" size={10} tintColorClassName="accent-foreground-muted" />
                <Text className="text-[11px] tabular-nums text-foreground-muted">
                  {row.resetsIn}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}
