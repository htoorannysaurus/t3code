import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { Fragment } from "react";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { environmentPresentations } from "../../state/presentation";
import { buildGlanceSections, type GlanceTone, updatedLabel } from "./limitGlance";

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
 * Every plan limit on one card, one row per window: how much is spent, how far
 * through the window the clock is, the gap between the two, and when it
 * refills. Modelled on the Claudeputer usage screen.
 */
export function UsageGlanceCard(props: {
  readonly now: number;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
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
  if (sections.length === 0) return null;
  const updated = updatedLabel(
    accounts.map((account) => account.limits.checkedAt),
    props.now,
  );
  let block = 0;
  const ruled = () => (block++ === 0 ? "" : "border-t border-border-subtle");

  return (
    <View className="gap-2">
      {updated ? <Text className="px-1 text-xs text-foreground-muted">{updated}</Text> : null}
      <View className="overflow-hidden rounded-[24px] border-continuous bg-grouped-card">
        {sections.map((section) => (
          <Fragment key={section.driver}>
            <View className={`flex-row items-center gap-2 px-4 pt-3 pb-2 ${ruled()}`}>
              <View
                className="size-2 rounded-full"
                style={{ backgroundColor: TONE_COLOR[section.tone] }}
              />
              <Text className="text-base font-t3-bold text-foreground">
                {DRIVER_LABEL[section.driver] ?? section.driver}
              </Text>
              {section.plan ? (
                <Text className="ml-auto text-xs text-foreground-muted" numberOfLines={1}>
                  {section.plan}
                </Text>
              ) : null}
            </View>
            {section.rows.map((row) => (
              <View
                key={row.key}
                accessible
                accessibilityLabel={`${row.label}, ${row.usedPercent}% used${
                  row.elapsedPercent === null
                    ? ""
                    : `, ${Math.round(row.elapsedPercent)}% of the window elapsed`
                }${row.pace ? `, ${row.pace}` : ""}${row.resetsIn ? `, resets in ${row.resetsIn}` : ""}`}
                className={`flex-row items-center gap-3 px-4 py-2.5 ${ruled()}`}
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
                      <SymbolView
                        name="clock"
                        size={10}
                        tintColorClassName="accent-foreground-muted"
                      />
                      <Text className="text-[11px] tabular-nums text-foreground-muted">
                        {row.resetsIn}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ))}
          </Fragment>
        ))}
      </View>
    </View>
  );
}
