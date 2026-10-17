import Storage from "expo-sqlite/kv-store";

export interface BrowserPage {
  readonly url: string;
  readonly title: string;
}

interface ThreadBrowserMemory {
  readonly last: BrowserPage | null;
  readonly recent: readonly BrowserPage[];
}

const RECENT_LIMIT = 15;
const EMPTY: ThreadBrowserMemory = { last: null, recent: [] };

const keyFor = (threadId: string) => `browser-memory:${threadId}`;

/** The browser's last page and recent pages for one chat, kept across app launches. */
export function readBrowserMemory(threadId: string | undefined): ThreadBrowserMemory {
  if (!threadId) return EMPTY;
  try {
    const raw = Storage.getItemSync(keyFor(threadId));
    return raw ? (JSON.parse(raw) as ThreadBrowserMemory) : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function rememberBrowserPage(threadId: string | undefined, page: BrowserPage): void {
  if (!threadId || !/^https?:\/\//i.test(page.url)) return;
  const current = readBrowserMemory(threadId);
  const next: ThreadBrowserMemory = {
    last: page,
    recent: [page, ...current.recent.filter((entry) => entry.url !== page.url)].slice(
      0,
      RECENT_LIMIT,
    ),
  };
  try {
    Storage.setItemSync(keyFor(threadId), JSON.stringify(next));
  } catch {
    // Memory is a convenience; a failed write just means the page is not restored.
  }
}
