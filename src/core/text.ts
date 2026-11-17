export const DONE_MARK = '[+]';

export function normalizeText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+$/, ''));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  return lines.slice(start, end).join('\n');
}

export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

export function parseLine(line: string): { done: boolean; text: string } {
  const trimmed = line.trimStart();
  return trimmed.startsWith(DONE_MARK)
    ? { done: true, text: trimmed.slice(DONE_MARK.length) }
    : { done: false, text: line };
}

export function setLineDone(line: string, done: boolean): string {
  const { text } = parseLine(line);
  return done ? DONE_MARK + text : text;
}

export function toggleDoneInRange(
  text: string,
  selStart: number,
  selEnd: number,
): { text: string; selStart: number; selEnd: number } {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const lo = Math.min(selStart, selEnd);
  const hi = Math.max(selStart, selEnd);
  const touched: number[] = [];
  lines.forEach((line, i) => {
    // 선택 범위가 있을 때 다음 줄 맨 앞에서 끝나면 그 줄은 건드리지 않는다.
    const reachesStart = lo === hi ? starts[i] <= hi : starts[i] < hi;
    if (reachesStart && lo <= starts[i] + line.length) touched.push(i);
  });
  if (touched.length === 0) return { text, selStart, selEnd };

  const makeDone = touched.some((i) => !parseLine(lines[i]).done);
  // Each change is (line start, removed prefix length, added prefix length).
  const changes: { start: number; removed: number; added: number }[] = [];
  for (const i of touched) {
    const before = lines[i];
    const after = setLineDone(before, makeDone);
    if (after === before) continue;
    const bodyLen = parseLine(before).text.length;
    const removed = before.length - bodyLen;
    const added = after.length - bodyLen;
    changes.push({ start: starts[i], removed, added });
    lines[i] = after;
  }

  const mapPos = (p: number): number => {
    let shift = 0;
    for (const c of changes) {
      if (p <= c.start) continue;
      shift += c.added - Math.min(p - c.start, c.removed);
    }
    return p + shift;
  };

  return { text: lines.join('\n'), selStart: mapPos(selStart), selEnd: mapPos(selEnd) };
}
