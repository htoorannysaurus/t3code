/**
 * Inserts "/" at the cursor so the slash-command menu opens exactly as if it
 * had been typed. A slash only starts a command at the start of a word, so one
 * typed straight after other text gets a space in front of it.
 */
export function insertSlashCommand(
  value: string,
  selection: { readonly start: number; readonly end: number },
): { readonly value: string; readonly cursor: number } {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const before = value.slice(0, start);
  const needsSpace = before.length > 0 && !/\s$/.test(before);
  const inserted = needsSpace ? " /" : "/";
  return { value: before + inserted + value.slice(end), cursor: start + inserted.length };
}
