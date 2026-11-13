import { parseLine, splitLines } from '../core/text';

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
}

const charWidth = (ch: string, size: number): number => size * (isWide(ch.codePointAt(0)!) ? 1 : 0.6);

/** 글자 폭 어림(pt). 한글·한자·가나·전각 문자는 size x 1.0, 그 밖은 size x 0.6. */
export function estimateWidth(text: string, size: number): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch, size);
  return total;
}

/** 폭 안에 들어가는 만큼만 남긴다(잘라낸 표시는 붙이지 않는다). */
export function fitText(text: string, size: number, maxWidth: number): string {
  let width = 0;
  let out = '';
  for (const ch of text) {
    width += charWidth(ch, size);
    if (width > maxWidth + 1e-9) break;
    out += ch;
  }
  return out;
}

/** 메모를 그릴 줄로 바꾼다: 빈 줄은 빼고, 완료 줄 표시([+])는 떼어 done으로 둔다. */
export function memoLines(text: string): { text: string; done: boolean }[] {
  return splitLines(text)
    .map(parseLine)
    .map(({ text: t, done }) => ({ text: t.trimEnd(), done }))
    .filter((l) => l.text.trim() !== '');
}

/** 줄 수가 넘치면 마지막 줄을 "+N"으로 바꾼다(N = 보이지 않는 줄 수). */
export function capLines<T>(lines: T[], max: number): { shown: T[]; more: number } {
  if (max <= 0) return { shown: [], more: lines.length };
  if (lines.length <= max) return { shown: lines, more: 0 };
  return { shown: lines.slice(0, max - 1), more: lines.length - (max - 1) };
}
