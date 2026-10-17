import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

export interface DictationDictionaryEntry {
  readonly word: string;
  readonly replacement?: string;
}

const normalizePhrase = (text: string) => text.trim().replace(/\s+/gu, " ");
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Apply personal corrections once, without rewriting parts of words or cascading replacements. */
export function applyDictationDictionary(
  text: string,
  dictionary: ReadonlyArray<DictationDictionaryEntry>,
): string {
  const byPhrase = new Map<string, DictationDictionaryEntry[]>();
  for (const entry of dictionary) {
    const word = normalizePhrase(entry.word);
    // Apple's transcriber cannot be biased, so entries without a replacement do nothing.
    if (!word || entry.replacement === undefined) continue;
    const key = word.toLowerCase();
    const entries = byPhrase.get(key) ?? [];
    entries.push({ word, replacement: entry.replacement });
    byPhrase.set(key, entries);
  }
  if (byPhrase.size === 0) return text;

  const alternatives = [...byPhrase.keys()]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.split(" ").map(escapeRegExp).join("\\s+"));
  // Capture the leading boundary instead of using lookbehind, for native JS engines.
  const boundary = "[^\\p{L}\\p{N}\\p{M}_]";
  const pattern = new RegExp(`(^|${boundary})(${alternatives.join("|")})(?=$|${boundary})`, "giu");
  return text.replace(pattern, (_match, prefix: string, phrase: string) => {
    const normalized = normalizePhrase(phrase);
    const entries = byPhrase.get(normalized.toLowerCase());
    // Prefer an exact-case rule; otherwise use the first saved variant.
    const entry = entries?.find((candidate) => candidate.word === normalized) ?? entries?.[0];
    return prefix + (entry?.replacement ?? phrase);
  });
}

/** Wrap a transcriber so every transcript passes through the current dictionary. */
export function withDictationDictionary(
  transcriber: VoiceTranscriber | null,
  readDictionary: () => ReadonlyArray<DictationDictionaryEntry>,
): VoiceTranscriber | null {
  if (!transcriber) return null;
  return {
    prepare: async (options) => {
      const prepared = await transcriber.prepare(options);
      return {
        ...prepared,
        transcribe: async (uri, transcribeOptions) =>
          applyDictationDictionary(
            await prepared.transcribe(uri, transcribeOptions),
            readDictionary(),
          ),
      };
    },
  };
}

/** Parse "heard => meant" lines; lines without an arrow are skipped. */
export function parseDictationDictionary(text: string): DictationDictionaryEntry[] {
  return text.split("\n").flatMap((line): DictationDictionaryEntry[] => {
    const arrow = line.indexOf("=>");
    if (arrow < 0) return [];
    const word = normalizePhrase(line.slice(0, arrow));
    const replacement = line.slice(arrow + 2).trim();
    return word ? [{ word, replacement }] : [];
  });
}

export function formatDictationDictionary(
  dictionary: ReadonlyArray<DictationDictionaryEntry>,
): string {
  return dictionary
    .filter((entry) => entry.replacement !== undefined)
    .map((entry) => `${entry.word} => ${entry.replacement}`)
    .join("\n");
}
