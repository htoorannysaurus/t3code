import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

/** Percent of the context window in use, picked the same way as the web
    ContextWindowMeter: newest provider turn report first, then the active
    provider thread's snapshot. Null when the provider reports no window size. */
export function contextUsedPercentage(
  projection: Pick<
    OrchestrationV2ThreadProjection,
    "providerTurns" | "providerThreads" | "thread"
  > | null,
): number | null {
  if (projection === null) return null;

  let latest: {
    usedTokens: number;
    maxTokens?: number | null | undefined;
    updatedAt: string;
  } | null = null;
  for (const { tokenUsage } of projection.providerTurns) {
    if (tokenUsage === undefined) continue;
    if (latest === null || Date.parse(tokenUsage.updatedAt) >= Date.parse(latest.updatedAt)) {
      latest = tokenUsage;
    }
  }
  const usage =
    latest ??
    projection.providerThreads.find(
      (thread) => thread.id === projection.thread.activeProviderThreadId,
    )?.contextUsage ??
    null;
  if (usage === null) return null;

  const maxTokens = usage.maxTokens;
  if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) return null;
  return Math.min(100, (Math.max(0, usage.usedTokens) / maxTokens) * 100);
}
