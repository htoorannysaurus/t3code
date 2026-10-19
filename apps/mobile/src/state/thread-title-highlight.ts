import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";

import { mobilePreferencesAtom } from "./preferences";

// A joined string keeps rows from re-rendering when unrelated preferences change.
const highlightedThreadEnvironmentIdsAtom = Atom.make((get) => {
  const preferences = get(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences)
    ? (preferences.value.highlightedThreadEnvironmentIds ?? []).join("\n")
    : "";
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:preferences:highlighted-thread-environments"));

/** Tint for thread titles from environments the user marked to stand out. */
export const HIGHLIGHTED_THREAD_TITLE_CLASS_NAME = "text-adaptive-amber-700-300";

export function useThreadTitleHighlighted(environmentId: string | null | undefined): boolean {
  const ids = useAtomValue(highlightedThreadEnvironmentIdsAtom);
  return environmentId ? ids.split("\n").includes(environmentId) : false;
}
