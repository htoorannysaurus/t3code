import * as Dialog from "../../components/ui/Dialog";
import * as Haptics from "expo-haptics";
import * as Option from "effect/Option";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  CommandId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ChatAttachment,
  type ChatFileAttachment,
  type ComposerContextRecord,
  type EnvironmentId,
  type MessageId,
  type OrchestrationMessageContext,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { deriveThreadCheckpointSummaries } from "@t3tools/client-runtime/state/thread-checkpoints";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { encodeComposerContextFragment } from "@t3tools/shared/composerContextClipboard";
import { upgradeLegacyContextMessage } from "@t3tools/shared/composerContextLegacy";

import {
  importComposerContextClipboard,
  importServerAttachmentToDraft,
} from "../../lib/composerContextClipboard";
import {
  removePersistedComposerAttachmentFile,
  type DraftComposerAttachment,
} from "../../lib/composerImages";
import { scopedThreadKey } from "../../lib/scopedEntities";
import type { ThreadFeedEntry, ThreadFeedMessage } from "../../lib/threadActivity";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  appendComposerDraftAttachments,
  getComposerDraftSnapshot,
  insertComposerDraftContext,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { useThreadProjection } from "../../state/use-thread-detail";
import {
  deriveRewindTurnCountByUserMessageId,
  findRewindTargetCheckpoint,
  inspectRewindProgress,
  providerSupportsConversationRollback,
  recallableRewindPrompt,
  restoredPromptSeparator,
  rewindBlockReason,
  sameRewindTurnCounts,
  REWIND_MISSING_MESSAGE,
  REWIND_TIMEOUT_MESSAGE,
} from "./thread-rewind";

const REWIND_TIMEOUT_MS = 120_000;

interface PreparedRestore {
  readonly text: string;
  readonly context: OrchestrationMessageContext | undefined;
  readonly contextAttachments: ReadonlyArray<DraftComposerAttachment>;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly failures: ReadonlyArray<string>;
}

function isChatFileAttachment(attachment: ChatAttachment): attachment is ChatFileAttachment {
  return attachment.type === "file";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }
  return fallback;
}

async function discardImported(attachments: ReadonlyArray<DraftComposerAttachment>) {
  await Promise.all(
    attachments.map((attachment) =>
      attachment.fileUri
        ? removePersistedComposerAttachmentFile(attachment.fileUri).catch(() => undefined)
        : Promise.resolve(),
    ),
  );
}

/**
 * Downloads the message's attachments into local draft attachments before
 * anything is rolled back, so a failed download leaves the thread untouched.
 */
async function prepareRestore(input: {
  readonly message: ThreadFeedMessage;
  readonly environmentId: EnvironmentId;
  readonly draftKey: string;
  readonly signal: AbortSignal;
}): Promise<PreparedRestore> {
  const { message, environmentId, signal } = input;
  await waitForComposerDraftsLoaded();
  const draft = getComposerDraftSnapshot(input.draftKey);
  if (draft.attachments.length + message.attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    throw new Error("Make room for this message's attachments in the composer before rewinding.");
  }

  const prompt = recallableRewindPrompt(message.text);
  const legacy = message.context ? null : upgradeLegacyContextMessage(prompt);
  const text = legacy?.text ?? prompt;
  const records: ReadonlyArray<ComposerContextRecord> =
    message.context?.records ?? legacy?.records ?? [];

  const failures: string[] = [];
  let restoredText = text;
  let context: OrchestrationMessageContext | undefined;
  let contextAttachments: DraftComposerAttachment[] = [];
  if (records.length > 0) {
    const fragment = encodeComposerContextFragment({
      version: 1,
      source: { environmentId, messageId: message.id },
      records: [...records],
    });
    if (fragment === null) {
      throw new Error("This message has too much context to restore.");
    }
    const imported = await importComposerContextClipboard(
      { text, fragment, html: "" },
      draft.attachments.length,
      signal,
      draft.context?.records.length ?? 0,
    );
    if (imported !== null) {
      restoredText = imported.text;
      context = imported.context.records.length > 0 ? imported.context : undefined;
      contextAttachments = [...imported.attachments];
      failures.push(...imported.failures);
    }
  }

  const contextAttachmentIds = new Set(
    records.flatMap((record) => ("attachmentId" in record ? [record.attachmentId] : [])),
  );
  const attachments: DraftComposerAttachment[] = [];
  try {
    for (const attachment of message.attachments) {
      if (contextAttachmentIds.has(attachment.id)) continue;
      if (attachment.type !== "image" && attachment.type !== "file") {
        failures.push(attachment.name);
        continue;
      }
      try {
        const imported = await importServerAttachmentToDraft(
          {
            attachmentId: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            kind: attachment.type,
          },
          environmentId,
          signal,
        );
        attachments.push(
          imported.type === "file" && isChatFileAttachment(attachment) && attachment.source
            ? { ...imported, source: attachment.source }
            : imported,
        );
      } catch (error) {
        if (signal.aborted) throw error;
        failures.push(attachment.name);
      }
    }
  } catch (error) {
    await discardImported([...contextAttachments, ...attachments]);
    throw error;
  }
  return { text: restoredText, context, contextAttachments, attachments, failures };
}

/** Port of web's `waitForRevertedMessage`: resolves once the rollback has landed. */
function waitForRewind(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly message: ThreadFeedMessage;
  readonly turnCount: number;
  readonly requestId: CommandId;
  readonly revert: () => Promise<void>;
}): Promise<void> {
  const atom = environmentThreadDetails.stateAtom({
    environmentId: input.environmentId,
    threadId: input.threadId,
  });
  const readProjection = () => Option.getOrNull(appAtomRegistry.get(atom).data);
  const initial = readProjection();
  const sourceMessage = initial?.messages.find((message) => message.id === input.message.id);
  if (!sourceMessage) return Promise.reject(new Error(REWIND_MISSING_MESSAGE));
  const messageRunId = sourceMessage.runId;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let accepted = false;
    let unsubscribe = () => {};
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      unsubscribe();
      if (error !== undefined) reject(error);
      else resolve();
    };
    const inspect = () => {
      const projection = readProjection();
      if (!projection) return;
      const progress = inspectRewindProgress(projection, {
        requestId: input.requestId,
        messageRunId,
        turnCount: input.turnCount,
        accepted,
      });
      if (progress.kind === "failed") finish(new Error(progress.message));
      else if (progress.kind === "done") finish();
    };
    unsubscribe = appAtomRegistry.subscribe(atom, inspect);
    timeout = globalThis.setTimeout(
      () => finish(new Error(REWIND_TIMEOUT_MESSAGE)),
      REWIND_TIMEOUT_MS,
    );
    Promise.resolve()
      .then(input.revert)
      .then(() => {
        accepted = true;
        inspect();
      }, finish);
  });
}

function applyRestore(draftKey: string, restore: PreparedRestore): void {
  const current = getComposerDraftSnapshot(draftKey).text;
  const separator = restoredPromptSeparator(current);
  const atEnd = { text: current, start: current.length, end: current.length };
  const inserted =
    restore.context !== undefined &&
    insertComposerDraftContext(
      draftKey,
      {
        text: `${separator}${restore.text}`,
        context: restore.context,
        attachments: restore.contextAttachments,
      },
      atEnd,
    );
  if (!inserted) {
    if (restore.text.length > 0) {
      setComposerDraftText(draftKey, `${current}${separator}${restore.text}`);
    }
    appendComposerDraftAttachments(draftKey, restore.contextAttachments, { allowOverflow: true });
  }
  appendComposerDraftAttachments(draftKey, restore.attachments, { allowOverflow: true });
}

export interface ThreadRewindControls {
  /** Turn count to roll back to, for each user message that can be edited from. */
  readonly turnCountByMessageId: ReadonlyMap<MessageId, number>;
  readonly onEditFromHere: (message: ThreadFeedMessage) => void;
}

/**
 * "Edit from here" for sent user messages: asks whether to restore files,
 * rolls the thread back to before the message, then puts its prompt and
 * attachments back in the composer.
 */
export function useThreadRewind(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly providerInstanceId: string | null;
  readonly canOperateThread: boolean;
  readonly connected: boolean;
  readonly threadBusy: boolean;
  readonly queuedEditActive: boolean;
  readonly onRestored: (draftKey: string) => void;
}): ThreadRewindControls | null {
  const thread = useThreadProjection({
    environmentId: input.environmentId,
    threadId: input.threadId,
  });
  const revertCheckpoint = useAtomCommand(threadEnvironment.revertCheckpoint, {
    label: "edit from here",
    reportFailure: false,
  });
  const supportsRollback = providerSupportsConversationRollback(
    input.providers,
    input.providerInstanceId,
  );
  const checkpoints = useMemo(
    () => (thread === null ? [] : deriveThreadCheckpointSummaries(thread.projection)),
    [thread],
  );
  const derivedTurnCountByMessageId = useMemo(
    () =>
      supportsRollback
        ? deriveRewindTurnCountByUserMessageId({
            messages: input.feed.flatMap((entry) =>
              entry.type === "message" ? [entry.message] : [],
            ),
            checkpoints,
          })
        : new Map<MessageId, number>(),
    [checkpoints, input.feed, supportsRollback],
  );
  // The feed changes on every streamed token; keep the map's identity until
  // its contents change so the feed rows are not invalidated each time.
  const stableTurnCountsRef = useRef(derivedTurnCountByMessageId);
  if (!sameRewindTurnCounts(stableTurnCountsRef.current, derivedTurnCountByMessageId)) {
    stableTurnCountsRef.current = derivedTurnCountByMessageId;
  }
  const turnCountByMessageId = stableTurnCountsRef.current;

  const stateRef = useRef(input);
  stateRef.current = input;
  const turnCountByMessageIdRef = useRef(turnCountByMessageId);
  turnCountByMessageIdRef.current = turnCountByMessageId;
  const supportsRollbackRef = useRef(supportsRollback);
  supportsRollbackRef.current = supportsRollback;
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const runRewind = useCallback(
    async (message: ThreadFeedMessage, turnCount: number, restoreFiles: boolean) => {
      if (busyRef.current) return;
      const { environmentId, threadId } = stateRef.current;
      const draftKey = scopedThreadKey(environmentId, threadId);
      busyRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      void Haptics.selectionAsync();
      let restore: PreparedRestore | null = null;
      try {
        restore = await prepareRestore({
          message,
          environmentId,
          draftKey,
          signal: controller.signal,
        });
        const requestId = CommandId.make(uuidv4());
        await waitForRewind({
          environmentId,
          threadId,
          message,
          turnCount,
          requestId,
          revert: async () => {
            const projection = Option.getOrNull(
              appAtomRegistry.get(environmentThreadDetails.stateAtom({ environmentId, threadId }))
                .data,
            );
            const runId = projection?.messages.find((entry) => entry.id === message.id)?.runId;
            const target =
              projection && runId
                ? findRewindTargetCheckpoint(projection.checkpoints, runId)
                : null;
            const result = await revertCheckpoint({
              environmentId,
              input: {
                commandId: requestId,
                threadId,
                turnCount,
                restoreFiles,
                ...(target === null ? {} : target),
              },
            });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          },
        });
        // The rollback has landed, so the prompt goes back into the thread's
        // draft even if this screen has gone away meanwhile.
        const { failures } = restore;
        applyRestore(draftKey, restore);
        restore = null;
        if (failures.length > 0) {
          Dialog.alert(
            "Some attachments were not restored",
            `Attach these again if you need them: ${failures.join(", ")}`,
          );
        }
        const current = stateRef.current;
        if (
          !controller.signal.aborted &&
          scopedThreadKey(current.environmentId, current.threadId) === draftKey
        ) {
          current.onRestored(draftKey);
        }
      } catch (error) {
        if (restore !== null) {
          await discardImported([...restore.contextAttachments, ...restore.attachments]);
        }
        if (controller.signal.aborted) return;
        Dialog.alert(
          "Could not edit from here",
          errorMessage(error, "Failed to revert thread state."),
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        busyRef.current = false;
      }
    },
    [revertCheckpoint],
  );

  const onEditFromHere = useCallback(
    (message: ThreadFeedMessage) => {
      const current = stateRef.current;
      if (!current.canOperateThread || busyRef.current) return;
      const turnCount = turnCountByMessageIdRef.current.get(message.id);
      if (turnCount === undefined) return;
      const blocked = rewindBlockReason({
        supportsRollback: supportsRollbackRef.current,
        connected: current.connected,
        threadBusy: current.threadBusy,
        queuedEditActive: current.queuedEditActive,
      });
      if (blocked !== null) {
        Dialog.alert("Can't edit from here yet", blocked);
        return;
      }
      Dialog.alert(
        "Edit from here?",
        "Rewind the chat to before this message. Your prompt and attachments return to the composer. Rewinding files too also undoes file changes made since then.",
        [
          {
            text: "Rewind chat only",
            onPress: () => void runRewind(message, turnCount, false),
          },
          {
            text: "Rewind chat and files",
            style: "destructive",
            onPress: () => void runRewind(message, turnCount, true),
          },
          { text: "Cancel", style: "cancel" },
        ],
        { cancelable: true },
      );
    },
    [runRewind],
  );
  return useMemo(
    () =>
      input.canOperateThread && turnCountByMessageId.size > 0
        ? { turnCountByMessageId, onEditFromHere }
        : null,
    [input.canOperateThread, onEditFromHere, turnCountByMessageId],
  );
}
