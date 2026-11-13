import { normalizeText, splitLines } from './text';
import { EMPTY_DAY } from './types';
import type { DayChange, DayRecord, DayValue, PendingEdit } from './types';

/** Counts occurrences of each line. */
function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/** Takes one occurrence of `line` from `counts`; false if none is left. */
function consume(counts: Map<string, number>, line: string): boolean {
  const n = counts.get(line) ?? 0;
  if (n === 0) return false;
  counts.set(line, n - 1);
  return true;
}

export function mergeText(base: string, mine: string, server: string): string {
  if (mine === base) return server;
  if (server === base) return mine;

  const baseLines = splitLines(base);
  const mineLines = splitLines(mine);
  const serverLines = splitLines(server);
  const result = [...serverLines];

  // Lines I removed (multiset): drop the first matching line from the result.
  const mineCounts = countLines(mineLines);
  for (const line of baseLines) {
    if (consume(mineCounts, line)) continue;
    const at = result.indexOf(line);
    if (at >= 0) result.splice(at, 1);
  }

  // Lines I added (multiset), in my order, unless the server added the same line.
  const baseCounts = countLines(baseLines);
  const serverAdded = countLines(serverLines);
  for (const [line, n] of baseCounts) {
    serverAdded.set(line, Math.max(0, (serverAdded.get(line) ?? 0) - n));
  }
  mineLines.forEach((line, i) => {
    if (consume(baseCounts, line)) return;
    if (consume(serverAdded, line)) return;
    const at = i > 0 ? result.indexOf(mineLines[i - 1]) : -1;
    if (at >= 0) result.splice(at + 1, 0, line);
    else result.push(line);
  });

  return normalizeText(result.join('\n'));
}

export function mergeColor(
  base: string,
  mine: string,
  server: string,
  mineEditedAt: number,
  serverEditedAt: number,
): string {
  if (mine === base) return server;
  if (server === base) return mine;
  return mineEditedAt > serverEditedAt ? mine : server;
}

export function resolveEdit(edit: PendingEdit, server: DayRecord | null, editedBy: string): DayChange | null {
  const current: DayValue = server ?? EMPTY_DAY;
  const serverAt = server?.editedAt ?? 0;
  const { base, next } = edit;
  if (current.text === next.text && current.color === next.color) return null;

  let merged: DayValue;
  let editedAt: number;
  if (current.text === base.text && current.color === base.color) {
    merged = next;
    editedAt = edit.editedAt;
  } else {
    merged = {
      text: mergeText(base.text, next.text, current.text),
      color: mergeColor(base.color, next.color, current.color, edit.editedAt, serverAt),
    };
    editedAt = Math.max(edit.editedAt, serverAt);
    if (merged.text === current.text && merged.color === current.color) return null;
  }
  if (merged.text === '' && merged.color === '') return 'delete';
  return { text: merged.text, color: merged.color, editedAt, editedBy };
}
