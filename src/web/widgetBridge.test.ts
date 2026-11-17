import { expect, it } from 'vitest';
import type { DayValue, PendingEdit } from '../core/types';
import { PENDING_GLOBAL as WIDGET_GLOBAL, parsePendingMessage } from '../widget/pending';
import { PENDING_GLOBAL, pendingForWidget, pendingTeller } from './widgetBridge';

const day = (text: string, color = ''): DayValue => ({ text, color });
const edit = (monthId: string, d: string, next: DayValue, editedAt: number, extra: Partial<PendingEdit> = {}): PendingEdit => ({ monthId, day: d, base: day(''), next, editedAt, ...extra });

it('위젯 스크립트가 읽는 이름과 같은 이름에 적는다', () => {
  expect(PENDING_GLOBAL).toBe(WIDGET_GLOBAL);
});

it('올리지 못한 날마다 화면이 보여 주는 값과 마지막으로 고친 시각을 적는다. 위젯이 그대로 읽는다', () => {
  const shown: Record<string, DayValue> = { '2026-11-16': day('AI 생산성'), '2026-11-20': day('합쳐진 값', 'F12424') };
  const text = pendingForWidget('owner-test-uid', [
    edit('2026-11', '20', day('먼저 고친 것'), 100, { sent: true }),
    edit('2026-11', '16', day('AI 생산성'), 300),
    edit('2026-11', '20', day('나중에 고친 것', 'F12424'), 200),
  ], (monthId, d) => shown[`${monthId}-${d}`]);
  expect(parsePendingMessage(text)).toEqual({
    uid: 'owner-test-uid',
    edits: [
      { monthId: '2026-11', day: '16', text: 'AI 생산성', color: '', editedAt: 300 },
      { monthId: '2026-11', day: '20', text: '합쳐진 값', color: 'F12424', editedAt: 200 },
    ],
  });
});

it('지운 날은 빈 값으로 적는다', () => {
  const text = pendingForWidget('owner-test-uid', [edit('2026-11', '16', day(''), 300, { base: day('AI', 'B5CEF6') })], () => day(''));
  expect(parsePendingMessage(text)?.edits).toEqual([{ monthId: '2026-11', day: '16', text: '', color: '', editedAt: 300 }]);
});

it('올릴 것이 없으면 빈 목록이고, 같은 것은 늘 같은 글이다', () => {
  expect(pendingForWidget('owner-test-uid', [], () => day(''))).toBe('{"v":1,"uid":"owner-test-uid","n":0,"edits":[]}');
  const a = [edit('2026-11', '16', day('a'), 1), edit('2026-12', '01', day('b'), 2)];
  expect(pendingForWidget('u', a, () => day('x'))).toBe(pendingForWidget('u', [...a].reverse(), () => day('x')));
});

it('편집 목록이 달라질 때마다 n이 는다: 스크립트가 읽는 사이에 저장하고 올라가도 저장이 있었음을 안다', () => {
  const tell = pendingTeller('owner-test-uid');
  const shown = () => day('회의');
  const one = [edit('2026-11', '16', day('회의'), 100)];
  const empty = tell([], shown);
  expect(JSON.parse(empty)).toEqual({ v: 1, uid: 'owner-test-uid', n: 1, edits: [] });
  // 달라지지 않으면 같은 글이다(스크립트가 다시 적지 않는다).
  expect(tell([], shown)).toBe(empty);
  const saved = tell(one, shown);
  expect(JSON.parse(saved).n).toBe(2);
  expect(tell(one, shown)).toBe(saved);
  // 올라가서 다시 빈 목록이 됐다: 처음의 빈 목록과 다른 글이다.
  const sent = tell([], shown);
  expect([JSON.parse(sent).n, sent === empty]).toEqual([3, false]);
  // 같은 날을 다시 고치면(시각이 다르다) 또 는다. 위젯은 n이 있어도 그대로 읽는다.
  const again = tell([edit('2026-11', '16', day('회의'), 200)], shown);
  expect(JSON.parse(again).n).toBe(4);
  expect(parsePendingMessage(again)).toEqual({ uid: 'owner-test-uid', edits: [{ monthId: '2026-11', day: '16', text: '회의', color: '', editedAt: 200 }] });
  // 화면마다 따로 센다.
  expect(JSON.parse(pendingTeller('u')([], shown)).n).toBe(1);
});

it('아직 서버에서 읽지 못한 달(valueOf가 null)은 대기열의 마지막 값을 그대로 적는다', () => {
  const text = pendingForWidget('owner-test-uid', [
    edit('2026-11', '16', day('A\nB'), 100, { base: day('A'), sent: true }),
    edit('2026-11', '16', day('A\nB\nC', 'F12424'), 200, { base: day('A\nB') }),
    edit('2026-11', '17', day('읽은 달'), 300),
  ], (monthId, d) => (d === '17' ? day('화면의 값') : null));
  expect(parsePendingMessage(text)?.edits).toEqual([
    { monthId: '2026-11', day: '16', text: 'A\nB\nC', color: 'F12424', editedAt: 200 },
    { monthId: '2026-11', day: '17', text: '화면의 값', color: '', editedAt: 300 },
  ]);
});

it('고친 시각이 같은 편집이 둘이면 대기열의 뒤의 것이 마지막이다', () => {
  const text = pendingForWidget('owner-test-uid', [edit('2026-11', '16', day('앞'), 100), edit('2026-11', '16', day('뒤'), 100)], () => null);
  expect(parsePendingMessage(text)?.edits.map((e) => e.text)).toEqual(['뒤']);
});
