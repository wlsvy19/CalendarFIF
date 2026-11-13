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

const charWidth = (ch: string, size: number): number => size * (ch === ' ' ? 0.3 : isWide(ch.codePointAt(0)!) ? 1 : 0.6);

/** 글자 폭 어림(pt). 한글·한자·가나·전각 문자는 size x 1.0, 공백은 size x 0.3, 그 밖은 size x 0.6. */
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

/** 폭을 넘는 줄을 여러 줄로 나눈다. 폭 안에 들어가는 마지막 공백에서 끊고, 공백이 없으면 낱말 안에서 끊는다. 한 글자도 안 들어가는 폭이면 거기서 멈춘다. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest !== '') {
    const fit = fitText(rest, size, maxWidth);
    if (fit === '') break;
    if (fit === rest) {
      out.push(fit);
      break;
    }
    const space = rest[fit.length] === ' ' ? fit.length : fit.lastIndexOf(' ');
    if (space > 0) {
      out.push(rest.slice(0, space).trimEnd());
      rest = rest.slice(space + 1).trimStart();
    } else {
      out.push(fit);
      rest = rest.slice(fit.length);
    }
  }
  return out;
}
