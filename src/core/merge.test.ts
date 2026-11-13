import { describe, expect, it } from 'vitest';
import type { DayRecord, DayValue, PendingEdit } from './types';
import { mergeColor, mergeText, resolveEdit } from './merge';

const v = (text: string, color = ''): DayValue => ({ text, color });
const r = (text: string, color = '', editedAt = 5, editedBy = 'pc'): DayRecord => ({ text, color, editedAt, editedBy });
const E = (base: DayValue, next: DayValue, editedAt = 100): PendingEdit => ({ monthId: '2026-11', day: '13', base, next, editedAt });

describe('mergeText', () => {
  it.each([
    ['설계 문서의 예', 'A\nB', 'A\nB\nC', 'A\nB2', 'A\nB2\nC'],
    ['나만 고침', 'A', 'A\nX', 'A', 'A\nX'],
    ['서버만 고침', 'A', 'A', 'A\nY', 'A\nY'],
    ['양쪽이 다른 줄을 추가', 'A', 'A\nX', 'A\nY', 'A\nX\nY'],
    ['양쪽이 같은 줄을 추가', 'A', 'A\nX', 'A\nX', 'A\nX'],
    ['내가 지운 줄은 지워진다', 'A\nB\nC', 'A\nC', 'A\nB\nC\nD', 'A\nC\nD'],
    ['내가 지운 줄을 서버가 고쳤으면 서버 것이 남는다', 'A\nB', 'A', 'A\nB2', 'A\nB2'],
    ['같은 줄을 다르게 고치면 둘 다 남는다', 'A\nB', 'A\nB1', 'A\nB2', 'A\nB1\nB2'],
    ['같은 글의 줄은 개수로 센다', 'X\nX', 'X', 'X\nX\nY', 'X\nY'],
    ['빈 날짜에 양쪽이 적음', '', 'M', 'S', 'S\nM'],
    ['내가 다 지움', 'A\nB', '', 'A\nB\nC', 'C'],
    ['완료 표시와 글 수정이 겹침', 'A', '[+]A', 'A2', 'A2\n[+]A'],
    ['연달아 추가한 줄은 순서를 지킨다', 'A', 'A\nX\nY', 'A\nZ', 'A\nX\nY\nZ'],
  ])('%s', (_name, base, mine, server, expected) => {
    expect(mergeText(base, mine, server)).toBe(expected);
  });
});

describe('mergeColor', () => {
  it.each([
    ['나만 바꿈(시계와 무관)', '', 'F12424', '', 100, 999, 'F12424'],
    ['서버만 바꿈', '', '', '009300', 999, 100, '009300'],
    ['둘 다 바꿈, 내가 나중', '', 'F12424', '009300', 200, 100, 'F12424'],
    ['둘 다 바꿈, 서버가 나중', '', 'F12424', '009300', 100, 200, '009300'],
    ['둘 다 바꿈, 같은 시각이면 서버', '', 'F12424', '009300', 100, 100, '009300'],
  ])('%s', (_name, base, mine, server, mineAt, serverAt, expected) => {
    expect(mergeColor(base, mine, server, mineAt, serverAt)).toBe(expected);
  });
});

describe('resolveEdit', () => {
  it('서버가 이미 같은 값이면 쓰지 않는다', () => {
    expect(resolveEdit(E(v('A'), v('B')), r('B'), 'iphone')).toBeNull();
  });
  it('서버가 base와 같으면 next를 쓴다', () => {
    expect(resolveEdit(E(v('A'), v('B')), r('A'), 'iphone')).toEqual({ text: 'B', color: '', editedAt: 100, editedBy: 'iphone' });
    expect(resolveEdit(E(v(''), v('B')), null, 'pc')).toEqual({ text: 'B', color: '', editedAt: 100, editedBy: 'pc' });
  });
  it('달라졌으면 합치고 editedAt은 큰 쪽을 쓴다', () => {
    expect(resolveEdit(E(v('A\nB'), v('A\nB\nC'), 100), r('A\nB2', '', 300), 'iphone'))
      .toEqual({ text: 'A\nB2\nC', color: '', editedAt: 300, editedBy: 'iphone' });
  });
  it('한쪽은 배경색만, 다른 쪽은 메모만 고치면 둘 다 남는다', () => {
    expect(resolveEdit(E(v('A'), v('A', 'F12424'), 100), r('A\nB', '', 300), 'iphone'))
      .toEqual({ text: 'A\nB', color: 'F12424', editedAt: 300, editedBy: 'iphone' });
  });
  it('합친 결과가 서버와 같으면 쓰지 않는다', () => {
    expect(resolveEdit(E(v('A\nB'), v('A')), r('A\nC'), 'pc')).toBeNull();
  });
  it('내용과 색이 모두 비면 날짜를 지운다', () => {
    expect(resolveEdit(E(v('A', 'F12424'), v('', '')), r('A', 'F12424'), 'pc')).toBe('delete');
    expect(resolveEdit(E(v('A'), v('')), null, 'pc')).toBeNull();
  });
});
