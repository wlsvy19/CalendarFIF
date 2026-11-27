/**
 * PC 앱의 메모 편집 화면에서 줄마다 앞에 붙여 보이는 줄 머리(점 "•", 번호 "1. "). 설정 → 셀의 줄 머리를 따른다.
 * 2026-11-27 사용자: "줄머리를 점으로 했으면 메모 입력 눌렀을때 이렇게 점표시 자동으로 돼야지. 번호로 했으면 1. … 엔터 치면 2.".
 *
 * 줄 머리는 편집 화면에만 있다. 저장하는 글에는 넣지 않는다(stripHeads). 달력의 칸, 아이폰, 위젯은 각자의 설정대로 머리를 그린다.
 */
import { toggleDoneInRange } from '../../core/text';

export type HeadStyle = 'dot' | 'number';

/** 점 뒤의 빈칸: 보통 빈칸보다 넓은 en 빈칸(U+2002). 2026-11-27 사용자: "점하고 글자하고 사이 간격 조금 있었으면". */
const DOT_GAP = ' ';
// 떼기는 어느 빈칸이든 뗀다(보통 빈칸, 끊기지 않는 빈칸, en 빈칸).
const HEAD = { dot: /^•[   ]?/, number: /^\d+\.[   ]?/ } as const;

export function headOf(style: HeadStyle, n: number): string {
  return style === 'dot' ? `•${DOT_GAP}` : `${n}. `;
}

/** 줄마다 머리를 붙인다. 빈 글이면 첫 줄의 머리 하나만 있다. */
export function addHeads(text: string, style: HeadStyle): string {
  return text
    .split('\n')
    .map((line, i) => headOf(style, i + 1) + line)
    .join('\n');
}

/** 줄 맨 앞의 머리를 뗀다(그 줄에 머리가 있을 때만). */
export function stripHeads(text: string, style: HeadStyle): string {
  return text
    .split('\n')
    .map((line) => line.replace(HEAD[style], ''))
    .join('\n');
}

/** 줄마다 맨 앞 머리의 길이. */
function headLengths(text: string, style: HeadStyle): number[] {
  return text.split('\n').map((line) => HEAD[style].exec(line)?.[0].length ?? 0);
}

/** 글 안의 자리 pos가 몇째 줄의 몇째 글자인가. */
function lineCol(text: string, pos: number): { line: number; col: number } {
  const before = text.slice(0, pos).split('\n');
  return { line: before.length - 1, col: before[before.length - 1].length };
}

function posOf(text: string, line: number, col: number): number {
  const lines = text.split('\n');
  let p = 0;
  for (let i = 0; i < line && i < lines.length; i++) p += lines[i].length + 1;
  return p + col;
}

/**
 * 번호 머리를 위에서부터 1, 2, 3으로 다시 매긴다(머리가 있는 줄만 센다). 자리(커서)는 같은 글자 뒤에 남게 옮긴다.
 */
export function renumber(text: string, sel: { start: number; end: number }): { text: string; start: number; end: number } {
  const lines = text.split('\n');
  let n = 0;
  const shift: number[] = [];
  const next = lines.map((line) => {
    const m = HEAD.number.exec(line);
    if (!m) {
      shift.push(0);
      return line;
    }
    n++;
    const head = `${n}. `;
    // 머리 안에 있던 커서는 머리 끝으로 간다. 빈칸이 없던 머리("3.")에도 빈칸을 넣는다.
    shift.push(head.length - m[0].length);
    return head + line.slice(m[0].length);
  });
  const out = next.join('\n');
  const map = (p: number): number => {
    const { line, col } = lineCol(text, p);
    const oldHead = HEAD.number.exec(lines[line])?.[0].length ?? 0;
    const newCol = col < oldHead ? oldHead + shift[line] : col + shift[line];
    return posOf(out, line, newCol);
  };
  return { text: out, start: map(sel.start), end: map(sel.end) };
}

/**
 * 완료 표시([+])를 머리 뒤의 글에 붙이거나 뗀다. 머리를 뗀 글로 toggleDoneInRange를 하고 머리를 다시 붙인다.
 */
export function toggleDoneWithHeads(text: string, selStart: number, selEnd: number, style: HeadStyle): { text: string; selStart: number; selEnd: number } {
  const heads = headLengths(text, style);
  const lines = text.split('\n');
  const plain = lines.map((line, i) => line.slice(heads[i])).join('\n');
  const toPlain = (p: number): number => {
    const { line, col } = lineCol(text, p);
    return posOf(plain, line, Math.max(0, col - heads[line]));
  };
  const r = toggleDoneInRange(plain, toPlain(selStart), toPlain(selEnd));
  const outLines = r.text.split('\n').map((line, i) => lines[i].slice(0, heads[i]) + line);
  const out = outLines.join('\n');
  const fromPlain = (p: number): number => {
    const { line, col } = lineCol(r.text, p);
    return posOf(out, line, heads[line] + col);
  };
  return { text: out, selStart: fromPlain(r.selStart), selEnd: fromPlain(r.selEnd) };
}

/**
 * 커서가 줄 머리 바로 뒤에 있으면 Backspace 한 번에 머리를 통째로 지운다(2026-11-27 사용자: "BackSpace 한번만 누르면 점이 지워 져야
 * 하는데, 두번 눌러야 지워지네"). 머리 뒤가 아니면 null(브라우저가 한 글자를 지운다).
 */
export function removeHeadBefore(text: string, pos: number, style: HeadStyle): { text: string; pos: number } | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const m = HEAD[style].exec(text.slice(lineStart));
  if (!m || m[0].length === 0 || pos !== lineStart + m[0].length) return null;
  return { text: text.slice(0, lineStart) + text.slice(pos), pos: lineStart };
}
