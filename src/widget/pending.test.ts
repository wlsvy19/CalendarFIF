import { describe, expect, it } from 'vitest';
import { PENDING_TTL_MS, applyPending, countPending, parsePendingMessage, parsePoll, parseProbe, pendingStateOf, probeLine, settlePending, webProbeOf, type PendingState } from './pending';

const edit = (day: string, text: string, color = '', editedAt = 2000, monthId = '2026-11') => ({ monthId, day, text, color, editedAt });
const message = (edits: unknown[], extra: Record<string, unknown> = {}): string => JSON.stringify({ v: 1, uid: 'owner-test-uid', edits, ...extra });

describe('parsePendingMessage', () => {
  it('웹 화면이 적어 둔 글을 읽는다. 빈 목록도 읽는다(올릴 것이 없다는 뜻이다)', () => {
    expect(parsePendingMessage(message([edit('16', '회의', 'F12424')]))).toEqual({ uid: 'owner-test-uid', edits: [edit('16', '회의', 'F12424')] });
    expect(parsePendingMessage(message([]))).toEqual({ uid: 'owner-test-uid', edits: [] });
  });

  it('모양이 다른 글은 null', () => {
    for (const text of ['', 'not json', '[]', 'null', JSON.stringify({ v: 2, uid: 'u', edits: [] }), JSON.stringify({ v: 1, edits: [] }), JSON.stringify({ v: 1, uid: '', edits: [] }), JSON.stringify({ v: 1, uid: 'u', edits: {} })]) {
      expect(parsePendingMessage(text)).toBeNull();
    }
    expect(parsePendingMessage(message(Array.from({ length: 201 }, () => edit('16', 'a'))))).toBeNull();
  });

  it('모양이 다른 날은 건너뛴다', () => {
    const bad = [
      { ...edit('16', 'a'), monthId: '2026-13' }, { ...edit('16', 'a'), day: '32' }, { ...edit('16', 'a'), day: '6' }, { ...edit('16', 'a'), text: 1 },
      { ...edit('16', 'a'), color: 'red' }, { ...edit('16', 'a'), editedAt: '2000' }, { ...edit('16', 'a'), editedAt: 0 }, null, 'x',
    ];
    expect(parsePendingMessage(message([...bad, edit('17', '남는 것')]))?.edits).toEqual([edit('17', '남는 것')]);
  });

  it('더 든 칸은 버린다', () => {
    expect(parsePendingMessage(message([{ ...edit('16', 'a'), extra: 1 }], { more: true }))).toEqual({ uid: 'owner-test-uid', edits: [edit('16', 'a')] });
  });
});

describe('pendingStateOf', () => {
  it('보관 파일의 칸을 읽고, 모양이 다르면 null', () => {
    expect(pendingStateOf({ uid: 'u', savedAt: 5, edits: [edit('16', 'a')] })).toEqual({ uid: 'u', savedAt: 5, edits: [edit('16', 'a')] });
    for (const v of [undefined, null, [], { savedAt: 5, edits: [] }, { uid: 'u', edits: [] }, { uid: 'u', savedAt: '5', edits: [] }, { uid: 'u', savedAt: 5 }]) expect(pendingStateOf(v)).toBeNull();
  });
});

describe('applyPending', () => {
  const NOW = 10_000;
  const state = (edits: ReturnType<typeof edit>[], extra: Partial<PendingState> = {}): PendingState => ({ uid: 'owner-test-uid', savedAt: NOW - 1000, edits, ...extra });
  const days = { '15': { text: '구매', color: '' }, '16': { text: 'AI', color: 'B5CEF6' } };
  const times = { '15': 1000, '16': 1000 };
  const apply = (s: PendingState | null, t: Record<string, number> = times, uid = 'owner-test-uid', now = NOW) => applyPending('2026-11', days, t, s, uid, now);

  it('서버보다 새로 고친 날을 얹는다: 바꾸기, 새로 적기, 지우기', () => {
    expect(apply(state([edit('16', 'AI', ''), edit('20', '새 메모'), edit('15', '')]))).toEqual({ '16': { text: 'AI', color: '' }, '20': { text: '새 메모', color: '' } });
  });

  it('서버의 것이 같거나 더 새로우면 서버의 것을 둔다(이미 올라갔거나 다른 기기가 뒤에 고쳤다)', () => {
    expect(apply(state([edit('16', '옛 편집', '', 2000)]), { '16': 2000 })).toEqual(days);
    expect(apply(state([edit('16', '옛 편집', '', 2000)]), { '16': 3000 })).toEqual(days);
    expect(apply(state([edit('16', '새 편집', '', 2000)]), { '16': 1999 })['16']).toEqual({ text: '새 편집', color: '' });
  });

  it('다른 달, 다른 계정, 너무 오래된 것, 없는 것은 얹지 않는다', () => {
    expect(apply(state([edit('16', '다른 달', '', 2000, '2026-12')]))).toEqual(days);
    expect(apply(state([edit('16', '다른 계정')]), times, 'someone-else')).toEqual(days);
    expect(apply(state([edit('16', '오래된 것')], { savedAt: NOW - PENDING_TTL_MS - 1 }))).toEqual(days);
    expect(apply(state([edit('16', '아직 쓴다')], { savedAt: NOW - PENDING_TTL_MS }))['16'].text).toBe('아직 쓴다');
    expect(apply(null)).toEqual(days);
  });

  it('받은 days를 바꾸지 않는다', () => {
    const before = JSON.stringify(days);
    apply(state([edit('16', '바뀐 것'), edit('15', '')]));
    expect(JSON.stringify(days)).toBe(before);
  });
});

describe('settlePending', () => {
  const state = (edits: ReturnType<typeof edit>[]): PendingState => ({ uid: 'owner-test-uid', savedAt: 5, edits });

  it('서버의 그날 고친 시각이 같거나 더 새로운 편집을 뺀다. 다른 달의 것과 서버에 없는 날의 것은 둔다', () => {
    const s = state([edit('13', '같다', '', 2000), edit('14', '서버가 새롭다', '', 2000), edit('15', '내가 새롭다', '', 2000), edit('16', '서버에 없다', '', 2000), edit('13', '다른 달', '', 2000, '2026-12')]);
    expect(settlePending('2026-11', { '13': 2000, '14': 2001, '15': 1999 }, s)).toEqual(state([edit('15', '내가 새롭다', '', 2000), edit('16', '서버에 없다', '', 2000), edit('13', '다른 달', '', 2000, '2026-12')]));
  });

  it('뺄 것이 없으면 받은 것 그대로다(다시 적지 않는다)', () => {
    const s = state([edit('15', '내가 새롭다', '', 2000)]);
    expect(settlePending('2026-11', { '15': 1999 }, s)).toBe(s);
    expect(settlePending('2026-11', {}, state([]))).toEqual(state([]));
  });
});

it('얹는 기한은 한 시간이다', () => {
  expect(PENDING_TTL_MS).toBe(3_600_000);
});

describe('웹 화면의 상태', () => {
  it('답한 글을 읽는다. 모양이 다르면 null', () => {
    expect(parseProbe(JSON.stringify({ app: '0.9.9', sw: true, bridge: false, more: 1 }))).toEqual({ app: '0.9.9', sw: true, bridge: false });
    expect(parseProbe(JSON.stringify({ app: 'x'.repeat(100), sw: false, bridge: false }))?.app).toHaveLength(40);
    for (const text of ['', 'x', 'null', '[]', JSON.stringify({ app: 1, sw: true, bridge: true }), JSON.stringify({ app: '', sw: 'no', bridge: true }), JSON.stringify({ app: '', sw: true })]) expect(parseProbe(text)).toBeNull();
  });

  it('보관 파일의 칸을 읽는다', () => {
    expect(webProbeOf({ at: 5, app: '0.9.9', sw: false, bridge: true })).toEqual({ at: 5, app: '0.9.9', sw: false, bridge: true });
    for (const v of [undefined, null, {}, { at: '5', app: '', sw: false, bridge: true }, { at: 5, app: '', sw: false }]) expect(webProbeOf(v)).toBeNull();
  });

  it('메뉴에 적을 한 줄', () => {
    const at = new Date(2026, 10, 17, 9, 5).getTime();
    expect(probeLine({ at, app: '0.9.9', sw: false, bridge: true })).toBe('위젯에서 연 달력(11월 17일 09:05 확인): 웹앱 0.9.9, 서비스 워커 없음, 위젯에 넘기기 켜짐');
    expect(probeLine({ at, app: '', sw: true, bridge: false })).toBe('위젯에서 연 달력(11월 17일 09:05 확인): 웹앱 버전 모름(0.9.8 이하), 서비스 워커 있음, 위젯에 넘기기 꺼짐');
    expect(probeLine(null)).toBe('');
  });
});

describe('0.3초마다 묻는 식의 답', () => {
  it('올리지 못한 편집의 글과 화면이 보이는지를 읽는다', () => {
    expect(parsePoll(JSON.stringify(['{"v":1}', 'visible']))).toEqual({ pending: '{"v":1}', hidden: false, visible: true });
    expect(parsePoll(JSON.stringify(['', 'hidden']))).toEqual({ pending: '', hidden: true, visible: false });
    expect(parsePoll(JSON.stringify(['', 'prerender']))).toEqual({ pending: '', hidden: false, visible: false });
    expect(parsePoll(JSON.stringify(['', '']))).toEqual({ pending: '', hidden: false, visible: false });
  });

  it('모양이 다르면 null', () => {
    for (const text of ['', 'x', 'null', '{}', '[]', JSON.stringify(['a']), JSON.stringify([1, 'visible']), JSON.stringify(['a', true])]) expect(parsePoll(text)).toBeNull();
  });
});

describe('countPending', () => {
  const state: PendingState = { uid: 'u', savedAt: 9000, edits: [
    { monthId: '2026-11', day: '13', text: 'a', color: '', editedAt: 2000 }, { monthId: '2026-11', day: '14', text: 'b', color: '', editedAt: 2000 }, { monthId: '2026-12', day: '13', text: 'c', color: '', editedAt: 2000 },
  ] };
  it('applyPending이 얹을 것만 센다', () => {
    expect(countPending('2026-11', { '13': 2000 }, state, 'u', 10_000)).toBe(1);
    expect(countPending('2026-11', {}, state, 'u', 10_000)).toBe(2);
    expect(countPending('2026-11', {}, state, 'other', 10_000)).toBe(0);
    expect(countPending('2026-11', {}, state, 'u', 9000 + PENDING_TTL_MS + 1)).toBe(0);
    expect(countPending('2026-11', {}, null, 'u', 10_000)).toBe(0);
  });
});
