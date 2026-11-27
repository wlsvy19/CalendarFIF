import { describe, expect, it } from 'vitest';
import { addHeads, removeHeadBefore, renumber, stripHeads, toggleDoneWithHeads } from './lineHeads';

describe('편집 화면의 줄 머리', () => {
  it('줄마다 점이나 번호를 붙이고, 저장할 때는 뗀다', () => {
    // 점 뒤는 넓은 en 빈칸(U+2002)이다.
    expect(addHeads('', 'dot')).toBe('• ');
    expect(addHeads('회의\n[+]운동', 'dot')).toBe('• 회의\n• [+]운동');
    expect(addHeads('회의\n운동', 'number')).toBe('1. 회의\n2. 운동');
    expect(stripHeads('• 회의\n• [+]운동\n•', 'dot')).toBe('회의\n[+]운동\n');
    expect(stripHeads('1. 회의\n2.운동\n글 3. 가운데', 'number')).toBe('회의\n운동\n글 3. 가운데');
    // 머리를 지운 줄은 그대로 둔다.
    expect(stripHeads('회의', 'dot')).toBe('회의');
  });
  it('번호를 위에서부터 다시 매기고 커서는 같은 글자 뒤에 남는다', () => {
    // "1. a" 뒤에서 Enter → "1. a\n1. |" → 2.
    const text = '1. a\n1. \n2. b';
    const r = renumber(text, { start: 8, end: 8 });
    expect(r).toEqual({ text: '1. a\n2. \n3. b', start: 8, end: 8 });
    // 10번째 줄로 넘어가면 머리가 한 글자 길어지고 커서도 따라간다.
    const nine = Array.from({ length: 9 }, (_, i) => `${i + 1}. x`).join('\n') + '\n1. y';
    const end = nine.length;
    const r2 = renumber(nine, { start: end, end });
    expect([r2.text.split('\n').at(-1), r2.start]).toEqual(['10. y', end + 1]);
    // 머리 없는 줄은 세지 않는다.
    expect(renumber('1. a\n그냥\n5. b', { start: 0, end: 0 }).text).toBe('1. a\n그냥\n2. b');
  });
  it('머리 바로 뒤의 Backspace 한 번에 머리를 통째로 지운다', () => {
    // Enter로 생긴 빈 줄의 점: 한 번에 지워지고 커서는 줄 맨 앞.
    expect(removeHeadBefore('• a\n• ', 6, 'dot')).toEqual({ text: '• a\n', pos: 4 });
    expect(removeHeadBefore('1. a\n2. b', 8, 'number')).toEqual({ text: '1. a\nb', pos: 5 });
    // 머리 뒤가 아니면 건드리지 않는다(글자 하나를 지우는 보통 Backspace).
    expect(removeHeadBefore('• ab', 3, 'dot')).toBeNull();
    expect(removeHeadBefore('ab', 1, 'dot')).toBeNull();
    expect(removeHeadBefore('• ', 0, 'dot')).toBeNull();
  });
  it('완료는 머리 뒤의 글에 붙는다', () => {
    const r = toggleDoneWithHeads('• 회의\n• 운동', 4, 4, 'dot');
    expect([r.text, r.selStart]).toEqual(['• [+]회의\n• 운동', 7]);
    const back = toggleDoneWithHeads(r.text, r.selStart, r.selEnd, 'dot');
    expect([back.text, back.selStart]).toEqual(['• 회의\n• 운동', 4]);
    const n = toggleDoneWithHeads('1. a\n2. b', 0, 9, 'number');
    expect(n.text).toBe('1. [+]a\n2. [+]b');
  });
});
