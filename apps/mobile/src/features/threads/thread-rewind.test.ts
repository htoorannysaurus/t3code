import { describe, expect, it } from "@effect/vitest";
import { CommandId, MessageId, RunId } from "@t3tools/contracts";

import {
  findRewindTargetCheckpoint,
  REWIND_BUSY_MESSAGE,
  REWIND_DISCONNECTED_MESSAGE,
  REWIND_QUEUED_EDIT_MESSAGE,
  REWIND_UNSUPPORTED_MESSAGE,
  deriveRewindTurnCountByUserMessageId,
  inspectRewindProgress,
  providerSupportsConversationRollback,
  recallableRewindPrompt,
  restoredPromptSeparator,
  rewindBlockReason,
  sameRewindTurnCounts,
} from "./thread-rewind";

const runA = RunId.make("run-a");
const runB = RunId.make("run-b");
const runC = RunId.make("run-c");

describe("deriveRewindTurnCountByUserMessageId", () => {
  it("maps turn-starting user messages to the turn before their ready checkpoint", () => {
    const result = deriveRewindTurnCountByUserMessageId({
      messages: [
        { id: MessageId.make("u1"), role: "user", runId: runA, inputIntent: "turn_start" },
        { id: MessageId.make("a1"), role: "assistant", runId: runA },
        { id: MessageId.make("u2"), role: "user", runId: runB, inputIntent: "queued_turn" },
        { id: MessageId.make("u3"), role: "user", runId: runC, inputIntent: "turn_start" },
      ],
      checkpoints: [
        { runId: runA, status: "ready", checkpointTurnCount: 1 },
        { runId: runB, status: "ready", checkpointTurnCount: 2 },
        { runId: runC, status: "missing", checkpointTurnCount: 3 },
      ],
    });
    expect([...result.entries()]).toEqual([
      [MessageId.make("u1"), 0],
      [MessageId.make("u2"), 1],
    ]);
  });

  it("skips steering messages and messages without a run", () => {
    const result = deriveRewindTurnCountByUserMessageId({
      messages: [
        { id: MessageId.make("u1"), role: "user", runId: runA, inputIntent: "steer" },
        { id: MessageId.make("u2"), role: "user", runId: null, inputIntent: "turn_start" },
      ],
      checkpoints: [{ runId: runA, status: "ready", checkpointTurnCount: 1 }],
    });
    expect(result.size).toBe(0);
  });
});

describe("providerSupportsConversationRollback", () => {
  const providers = [
    { instanceId: "codex" },
    { instanceId: "grok", supportsConversationRollback: false },
  ];

  it("treats an unreported capability as supported", () => {
    expect(providerSupportsConversationRollback(providers, "codex")).toBe(true);
  });

  it("rejects providers that opt out or are unknown", () => {
    expect(providerSupportsConversationRollback(providers, "grok")).toBe(false);
    expect(providerSupportsConversationRollback(providers, "missing")).toBe(false);
    expect(providerSupportsConversationRollback(undefined, "codex")).toBe(false);
    expect(providerSupportsConversationRollback(providers, null)).toBe(false);
  });
});

describe("rewindBlockReason", () => {
  const ready = {
    supportsRollback: true,
    connected: true,
    threadBusy: false,
    queuedEditActive: false,
  };

  it("allows an idle, connected thread", () => {
    expect(rewindBlockReason(ready)).toBeNull();
  });

  it("explains each blocked state", () => {
    expect(rewindBlockReason({ ...ready, supportsRollback: false })).toBe(
      REWIND_UNSUPPORTED_MESSAGE,
    );
    expect(rewindBlockReason({ ...ready, connected: false })).toBe(REWIND_DISCONNECTED_MESSAGE);
    expect(rewindBlockReason({ ...ready, threadBusy: true })).toBe(REWIND_BUSY_MESSAGE);
    expect(rewindBlockReason({ ...ready, queuedEditActive: true })).toBe(
      REWIND_QUEUED_EDIT_MESSAGE,
    );
  });
});

describe("recallableRewindPrompt", () => {
  it("trims and drops the ultrathink prefix", () => {
    expect(recallableRewindPrompt("  fix the bug \n")).toBe("fix the bug");
    expect(recallableRewindPrompt("Ultrathink:\nplan the refactor")).toBe("plan the refactor");
  });
});

describe("restoredPromptSeparator", () => {
  it("separates the restored prompt from an existing draft with a blank line", () => {
    expect(restoredPromptSeparator("")).toBe("");
    expect(restoredPromptSeparator("draft")).toBe("\n\n");
    expect(restoredPromptSeparator("draft\n")).toBe("\n");
    expect(restoredPromptSeparator("draft\n\n")).toBe("");
  });
});

describe("inspectRewindProgress", () => {
  const requestId = CommandId.make("cmd-1");
  const projection = (input: {
    readonly status: "completed" | "rolled_back";
    readonly failure?: { readonly requestId: CommandId; readonly message: string } | null;
  }) => ({
    runs: [{ id: runB, ordinal: 2, status: input.status }],
    thread: { rollbackFailure: input.failure ?? null },
  });
  const base = { requestId, messageRunId: runB, turnCount: 1, accepted: true };

  it("waits until the message's run is rolled back after the command is accepted", () => {
    expect(inspectRewindProgress(projection({ status: "completed" }), base)).toEqual({
      kind: "pending",
    });
    expect(
      inspectRewindProgress(projection({ status: "rolled_back" }), {
        ...base,
        accepted: false,
      }),
    ).toEqual({ kind: "pending" });
    expect(inspectRewindProgress(projection({ status: "rolled_back" }), base)).toEqual({
      kind: "done",
    });
  });

  it("reports a failure only for this request", () => {
    expect(
      inspectRewindProgress(
        projection({ status: "completed", failure: { requestId, message: "No checkpoint" } }),
        base,
      ),
    ).toEqual({ kind: "failed", message: "No checkpoint" });
    expect(
      inspectRewindProgress(
        projection({
          status: "completed",
          failure: { requestId: CommandId.make("other"), message: "Old failure" },
        }),
        base,
      ),
    ).toEqual({ kind: "pending" });
  });
});

describe("sameRewindTurnCounts", () => {
  it("compares entries rather than identity", () => {
    const u1 = MessageId.make("u1");
    const u2 = MessageId.make("u2");
    expect(sameRewindTurnCounts(new Map([[u1, 0]]), new Map([[u1, 0]]))).toBe(true);
    expect(sameRewindTurnCounts(new Map([[u1, 0]]), new Map([[u1, 1]]))).toBe(false);
    expect(sameRewindTurnCounts(new Map([[u1, 0]]), new Map([[u2, 0]]))).toBe(false);
    expect(sameRewindTurnCounts(new Map([[u1, 0]]), new Map())).toBe(false);
  });
});

describe("findRewindTargetCheckpoint", () => {
  const scope = "scope:root";
  const checkpoint = (
    id: string,
    ordinal: number,
    runId: string | null,
    parent: string | null = null,
    status = "ready",
  ) => ({
    id,
    scopeId: scope,
    runId: runId as RunId | null,
    parentCheckpointId: parent,
    ordinalWithinScope: ordinal,
    status,
  });

  it("finds the state before a turn after an earlier turn was rolled back", () => {
    // Run 13 was rolled back: its slot holds a run-less rollback checkpoint.
    const checkpoints = [
      checkpoint("c11", 11, "run11"),
      checkpoint("c12", 12, "run12"),
      checkpoint("c13", 13, null),
      checkpoint("c14", 14, "run14"),
    ];
    expect(findRewindTargetCheckpoint(checkpoints, "run14" as RunId)).toEqual({
      checkpointId: "c13",
      scopeId: scope,
    });
  });

  it("prefers the run checkpoint's ready parent", () => {
    const checkpoints = [
      checkpoint("c1", 1, "run1"),
      checkpoint("c2", 2, "run2"),
      checkpoint("c3", 3, "run3", "c1"),
    ];
    expect(findRewindTargetCheckpoint(checkpoints, "run3" as RunId)?.checkpointId).toBe("c1");
  });

  it("skips checkpoints that are not ready", () => {
    const checkpoints = [
      checkpoint("c1", 1, "run1"),
      checkpoint("c2", 2, "run2", null, "missing"),
      checkpoint("c3", 3, "run3"),
    ];
    expect(findRewindTargetCheckpoint(checkpoints, "run3" as RunId)?.checkpointId).toBe("c1");
  });

  it("returns null when the run has no checkpoint", () => {
    expect(findRewindTargetCheckpoint([checkpoint("c1", 1, "run1")], "run9" as RunId)).toBeNull();
  });
});
