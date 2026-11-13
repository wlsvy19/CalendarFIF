import { describe, expect, it } from 'vitest';
import { normalizeText, parseLine, setLineDone, splitLines, toggleDoneInRange } from './text';

describe('text', () => {
  it('줄 끝 공백과 앞뒤 빈 줄을 없애고 가운데 빈 줄은 남긴다', () => {
    expect(normalizeText('a  \r\nb\t\r\n\r\n')).toBe('a\nb');
    expect(normalizeText('\n\n a\n\nb\n')).toBe(' a\n\nb');
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
  it('[+]로 시작하는 줄은 완료한 줄이다', () => {
    expect(parseLine('[+]장보기')).toEqual({ done: true, text: '장보기' });
    expect(parseLine('  [+]x')).toEqual({ done: true, text: 'x' });
    expect(parseLine('a[+]b')).toEqual({ done: false, text: 'a[+]b' });
    expect(setLineDone('장보기', true)).toBe('[+]장보기');
    expect(setLineDone('[+]장보기', false)).toBe('장보기');
    expect(setLineDone('[+]a', true)).toBe('[+]a');
  });
  it('선택한 줄들의 완료 표시를 바꾼다', () => {
    expect(toggleDoneInRange('a\nb\nc', 2, 2).text).toBe('a\n[+]b\nc');
    expect(toggleDoneInRange('a\n[+]b\nc', 0, 6).text).toBe('[+]a\n[+]b\nc');
    expect(toggleDoneInRange('[+]a\n[+]b', 0, 9).text).toBe('a\nb');
    expect(toggleDoneInRange('a\nb', 3, 3)).toEqual({ text: 'a\n[+]b', selStart: 6, selEnd: 6 });
    expect(toggleDoneInRange('a\nb\nc', 0, 2).text).toBe('[+]a\nb\nc');
    expect(toggleDoneInRange('a\nb', 2, 2).text).toBe('a\n[+]b');
  });
});
