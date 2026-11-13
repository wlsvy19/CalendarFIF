import { expect, it } from 'vitest';
import { applyPending } from './view';
import { edit, rec } from './testing';

it('서버 값에 대기 편집을 얹어 보여 준다', () => {
  const server = { days: { '13': rec('A'), '14': rec('Z', 'F12424') } };
  const pending = [edit('2026-11', '13', 'A', 'A\nB'), edit('2026-12', '01', '', 'other')];
  expect(applyPending('2026-11', server, pending, 'pc')).toEqual({
    '13': { text: 'A\nB', color: '' },
    '14': { text: 'Z', color: 'F12424' },
  });
});
it('서버 문서가 없어도 대기 편집은 보인다', () => {
  expect(applyPending('2026-11', null, [edit('2026-11', '13', '', 'X')], 'pc')).toEqual({ '13': { text: 'X', color: '' } });
});
it('지우는 편집이면 그 날짜가 빠진다', () => {
  expect(applyPending('2026-11', { days: { '13': rec('A') } }, [edit('2026-11', '13', 'A', '')], 'pc')).toEqual({});
});
it('같은 날짜의 편집 두 개는 서버가 첫 편집을 이미 받았어도 같게 보인다', () => {
  const pending = [{ ...edit('2026-11', '13', 'A', 'A\nB', 100), sent: true as const }, edit('2026-11', '13', 'A\nB', 'A\nB\nC', 200)];
  expect(applyPending('2026-11', { days: { '13': rec('A') } }, pending, 'pc')).toEqual({ '13': { text: 'A\nB\nC', color: '' } });
  expect(applyPending('2026-11', { days: { '13': rec('A\nB') } }, pending, 'pc')).toEqual({ '13': { text: 'A\nB\nC', color: '' } });
});
