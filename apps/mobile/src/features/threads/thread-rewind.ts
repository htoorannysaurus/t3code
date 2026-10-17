/**
 * "Edit from here" on a sent user message: roll the thread back to before
 * that message and put its prompt back in the composer. Mirrors the web
 * `RevertUserMessageButton` / `rewindToMessage` flow.
 */
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type {
  CommandId,
  MessageId,
  OrchestrationV2UserMessageInputIntent,
  RunId,
} from "@t3tools/contracts";

export const REWIND_UNSUPPORTED_MESSAGE =
  "This provider does not support reverting conversation history. Start a new thread instead.";
export const REWIND_BUSY_MESSAGE = "Interrupt the current turn before reverting checkpoints.";
export const REWIND_QUEUED_EDIT_MESSAGE =
  "Finish editing the queued message before reverting checkpoints.";
export const REWIND_DISCONNECTED_MESSAGE =
  "Reconnect to this environment before reverting checkpoints.";
export const REWIND_TIMEOUT_MESSAGE = "Timed out waiting for the thread to rewind.";
export const REWIND_MISSING_MESSAGE = "The message to rewind is no longer available.";

const CLAUDE_ULTRATHINK_PREFIX = "Ultrathink:\n";

export interface RewindableMessage {
  readonly id: MessageId;
  readonly role: string;
  readonly runId: RunId | null;
  readonly inputIntent?: OrchestrationV2UserMessageInputIntent | undefined;
}

/**
 * The turn count to roll back to for each user message that started a turn
 * with a ready checkpoint. Same rule as web's `deriveRevertTurnCountByUserMessageId`.
 */
export function deriveRewindTurnCountByUserMessageId(input: {
  readonly messages: ReadonlyArray<RewindableMessage>;
  readonly checkpoints: ReadonlyArray<
    Pick<ThreadCheckpointSummary, "runId" | "status" | "checkpointTurnCount">
  >;
}): ReadonlyMap<MessageId, number> {
  const readyCheckpointTurnCountByRunId = new Map<RunId, number>();
  for (const checkpoint of input.checkpoints) {
    if (checkpoint.status === "ready") {
      readyCheckpointTurnCountByRunId.set(checkpoint.runId, checkpoint.checkpointTurnCount);
    }
  }
  const byUserMessageId = new Map<MessageId, number>();
  for (const message of input.messages) {
    if (message.role !== "user" || message.runId === null) continue;
    if (message.inputIntent !== "turn_start" && message.inputIntent !== "queued_turn") continue;
    const checkpointTurnCount = readyCheckpointTurnCountByRunId.get(message.runId);
    if (checkpointTurnCount === undefined) continue;
    byUserMessageId.set(message.id, Math.max(0, checkpointTurnCount - 1));
  }
  return byUserMessageId;
}

/**
 * The checkpoint holding the state from just before `runId`'s turn. Counting
 * runs breaks once an earlier turn has been rolled back (its ordinal no longer
 * names a checkpoint), so walk the checkpoints themselves: the run's parent, or
 * the latest ready checkpoint before it in the same scope.
 */
export function findRewindTargetCheckpoint(
  checkpoints: ReadonlyArray<{
    readonly id: string;
    readonly scopeId: string;
    readonly runId: RunId | null;
    readonly parentCheckpointId: string | null;
    readonly ordinalWithinScope: number;
    readonly status: string;
  }>,
  runId: RunId,
): { readonly checkpointId: string; readonly scopeId: string } | null {
  const runCheckpoint = checkpoints.findLast((checkpoint) => checkpoint.runId === runId);
  if (runCheckpoint === undefined) return null;
  const parent = checkpoints.find(
    (checkpoint) =>
      checkpoint.id === runCheckpoint.parentCheckpointId && checkpoint.status === "ready",
  );
  let target = parent;
  if (target === undefined) {
    for (const checkpoint of checkpoints) {
      if (
        checkpoint.scopeId === runCheckpoint.scopeId &&
        checkpoint.status === "ready" &&
        checkpoint.ordinalWithinScope < runCheckpoint.ordinalWithinScope &&
        (target === undefined || checkpoint.ordinalWithinScope > target.ordinalWithinScope)
      ) {
        target = checkpoint;
      }
    }
  }
  return target === undefined ? null : { checkpointId: target.id, scopeId: target.scopeId };
}

export function sameRewindTurnCounts(
  a: ReadonlyMap<MessageId, number>,
  b: ReadonlyMap<MessageId, number>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [messageId, turnCount] of a) {
    if (b.get(messageId) !== turnCount) return false;
  }
  return true;
}

/** A provider that does not report the capability is assumed to support it, as on web. */
export function providerSupportsConversationRollback(
  providers:
    | ReadonlyArray<{
        readonly instanceId: string;
        readonly supportsConversationRollback?: boolean;
      }>
    | undefined,
  instanceId: string | null | undefined,
): boolean {
  if (providers === undefined || instanceId === null || instanceId === undefined) return false;
  const provider = providers.find((candidate) => candidate.instanceId === instanceId);
  return provider !== undefined && provider.supportsConversationRollback !== false;
}

export function rewindBlockReason(input: {
  readonly supportsRollback: boolean;
  readonly connected: boolean;
  readonly threadBusy: boolean;
  readonly queuedEditActive: boolean;
}): string | null {
  if (!input.supportsRollback) return REWIND_UNSUPPORTED_MESSAGE;
  if (!input.connected) return REWIND_DISCONNECTED_MESSAGE;
  if (input.threadBusy) return REWIND_BUSY_MESSAGE;
  if (input.queuedEditActive) return REWIND_QUEUED_EDIT_MESSAGE;
  return null;
}

/** Strips what the client adds when sending so the prompt reads as the user typed it. */
export function recallableRewindPrompt(messageText: string): string {
  const prompt = messageText.trim();
  return prompt.startsWith(CLAUDE_ULTRATHINK_PREFIX)
    ? prompt.slice(CLAUDE_ULTRATHINK_PREFIX.length).trim()
    : prompt;
}

/** Text to put before the restored prompt so it lands after anything already drafted. */
export function restoredPromptSeparator(currentDraft: string): string {
  if (currentDraft.length === 0) return "";
  if (currentDraft.endsWith("\n\n")) return "";
  return currentDraft.endsWith("\n") ? "\n" : "\n\n";
}

export type RewindProgress =
  | { readonly kind: "pending" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Reads whether the server has applied the rollback for `requestId`. The run
 * the message started flips to `rolled_back` once the rollback lands; a
 * failure is reported on the thread keyed by the request id.
 */
export function inspectRewindProgress(
  projection: {
    readonly runs: ReadonlyArray<{
      readonly id: RunId;
      readonly ordinal: number;
      readonly status: string;
    }>;
    readonly thread: {
      readonly rollbackFailure?: {
        readonly requestId: CommandId;
        readonly message: string;
      } | null;
    };
  },
  input: {
    readonly requestId: CommandId;
    readonly messageRunId: RunId | null;
    readonly turnCount: number;
    readonly accepted: boolean;
  },
): RewindProgress {
  const failure = projection.thread.rollbackFailure;
  if (failure && failure.requestId === input.requestId) {
    return { kind: "failed", message: failure.message };
  }
  if (
    input.accepted &&
    projection.runs.some(
      (run) =>
        run.id === input.messageRunId &&
        run.ordinal > input.turnCount &&
        run.status === "rolled_back",
    )
  ) {
    return { kind: "done" };
  }
  return { kind: "pending" };
}
