import { expect, it } from 'vitest';
import type { DayValue, PendingEdit } from '../core/types';
import { PENDING_GLOBAL as WIDGET_GLOBAL, parsePendingMessage, pendingCount, savedBetween } from '../widget/pending';
import { PENDING_GLOBAL, pendingForWidget, pendingTeller, widgetHold } from './widgetBridge';

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

it('올리지 못한 편집의 목록이 달라질 때마다 n이 는다(저장 +1, 올라감 +1): 스크립트가 읽는 사이에 저장하고 올라가도 저장이 있었음을 안다', () => {
  const teller = pendingTeller('owner-test-uid');
  const tell = teller.text;
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
  // 보여 주는 값만 달라진 것(다른 기기의 것과 합쳐졌다)은 세지 않는다. 글에는 새 값이 들어간다.
  const merged = tell([edit('2026-11', '16', day('회의'), 200)], () => day('회의\n다른 기기의 줄'));
  expect([JSON.parse(merged).n, JSON.parse(merged).edits[0].text]).toEqual([4, '회의\n다른 기기의 줄']);
  // 위젯 쪽의 판정과 맞물린다: 저장은 저장으로, 올라간 것과 값만 달라진 것은 저장이 아닌 것으로 본다.
  const seen = (text: string) => ({ n: pendingCount(text), edits: parsePendingMessage(text)!.edits });
  expect([savedBetween(seen(empty), seen(saved)), savedBetween(seen(saved), seen(sent)), savedBetween(seen(empty), seen(sent)), savedBetween(seen(again), seen(merged))]).toEqual([true, false, true, false]);
  // 알림이나 카운트다운을 저장해 서버에 올라갔다(bump): 목록은 그대로이고 n만 하나 는다. 위젯 쪽은 저장으로 본다.
  teller.bump();
  const alarm = tell([edit('2026-11', '16', day('회의'), 200)], () => day('회의\n다른 기기의 줄'));
  expect([JSON.parse(alarm).n, JSON.parse(alarm).edits]).toEqual([5, JSON.parse(merged).edits]);
  expect(savedBetween(seen(merged), seen(alarm))).toBe(true);
  // 화면마다 따로 센다.
  expect(JSON.parse(pendingTeller('u').text([], shown)).n).toBe(1);
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

/** 알리기를 미루는 것을 흉내 낸다. log: 일어난 일의 차례. fire: 미루는 시간이 다 됐다. */
function holding() {
  const log: string[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const hold = widgetHold({
    tell: () => { log.push(hold.held() ? '건너뜀' : '알림'); },
    bump: () => { log.push('셈'); },
    holdMs: 2500,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { (t as { cleared: boolean }).cleared = true; },
  });
  return { hold, log, timers, fire: (i: number) => { if (!timers[i].cleared) timers[i].fn(); } };
}
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

it('알림이 서버에 올라가기를 기다리는 동안은 미루고, 올라가면 저장이 있었다고 세고 나서 알린다', async () => {
  const { hold, log, timers } = holding();
  let sent!: () => void;
  expect(hold.held()).toBe(false);
  hold.wait(new Promise<void>((resolve) => { sent = resolve; }));
  expect([hold.held(), timers[0].ms]).toEqual([true, 2500]);
  sent();
  await settle();
  // 세는 것이 알리는 것보다 먼저다: 알릴 때의 글에 늘어난 n이 들어간다.
  expect([hold.held(), log, timers[0].cleared]).toEqual([false, ['셈', '알림'], true]);
});

it('올리지 못하면(연결 없음) 세지 않고 미루기만 푼다. 달의 편집은 알려진다', async () => {
  const { hold, log } = holding();
  hold.wait(Promise.reject(new Error('보내지 못한 변경이 남았다')));
  await settle();
  expect([hold.held(), log]).toEqual([false, ['알림']]);
});

it('2.5초가 지나도 올라가지 않으면 미루기를 그만두고 알린다. 그 뒤에 올라가면 그때 세고 알린다', async () => {
  const { hold, log, fire } = holding();
  let sent!: () => void;
  hold.wait(new Promise<void>((resolve) => { sent = resolve; }));
  fire(0);
  expect([hold.held(), log]).toEqual([false, ['알림']]);
  sent();
  await settle();
  expect(log).toEqual(['알림', '셈', '알림']);
});

it('두 번 잇달아 저장하면 둘 다 끝날 때까지 미룬다', async () => {
  const { hold, log } = holding();
  let first!: () => void;
  let second!: () => void;
  hold.wait(new Promise<void>((resolve) => { first = resolve; }));
  hold.wait(new Promise<void>((resolve) => { second = resolve; }));
  first();
  await settle();
  expect([hold.held(), log]).toEqual([true, ['셈', '건너뜀']]);
  second();
  await settle();
  expect([hold.held(), log]).toEqual([false, ['셈', '건너뜀', '셈', '알림']]);
});
