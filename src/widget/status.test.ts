import { describe, expect, it } from 'vitest';
import { bridgeOf, clock, drawsOf, leaveOf, reloadLines, statusText, type UpdateNote } from './status';
import type { ReloadTry } from './reload';

const NOW = new Date(2026, 10, 17, 10, 5, 0).getTime();
const at = (h: number, m: number, s = 0): number => new Date(2026, 10, 17, h, m, s).getTime();
const NO_UPDATE: UpdateNote = { version: '', unfinished: {}, skipUntil: {}, note: '', libNote: '' };
const nothing = { now: NOW, draws: [], web: null, activeAt: 0, pending: null, bridge: null, update: NO_UPDATE };

describe('기록 읽기', () => {
  it('draws: 모양이 다른 것은 버리고 마지막 여덟 개만 남긴다', () => {
    expect(drawsOf([{ at: 5, v: 'a', src: 'server', over: 1, next: 9 }, { at: 0 }, null, 'x', { at: 6 }])).toEqual([{ at: 5, v: 'a', src: 'server', over: 1, next: 9 }, { at: 6, v: '', src: '', over: 0, next: 0 }]);
    expect(drawsOf(Array.from({ length: 12 }, (_, i) => ({ at: i + 1 }))).map((d) => d.at)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(drawsOf(undefined)).toEqual([]);
  });

  it('bridge: 없거나 모양이 다르면 null', () => {
    expect(bridgeOf({ at: 5, ok: 3, fail: 1, lastOkAt: 4, lastError: 'x' })).toEqual({ at: 5, ok: 3, fail: 1, lastOkAt: 4, lastError: 'x' });
    for (const v of [undefined, null, {}, { at: 0 }, []]) expect(bridgeOf(v)).toBeNull();
  });

  it('leave: 없거나 모양이 다르면 null', () => {
    expect(leaveOf({ at: 5, how: 'left' })).toEqual({ at: 5, how: 'left' });
    expect(leaveOf({ at: 5, how: 'closed', more: 1 })).toEqual({ at: 5, how: 'closed' });
    for (const v of [undefined, null, {}, { at: 0, how: 'left' }, { at: 5, how: 'other' }]) expect(leaveOf(v)).toBeNull();
  });

  it('clock: 오늘이면 시:분:초, 다른 날이면 월/일을 붙인다', () => {
    expect(clock(at(9, 5, 7), NOW)).toBe('09:05:07');
    expect(clock(new Date(2026, 10, 16, 23, 59, 1).getTime(), NOW)).toBe('11/16 23:59:01');
  });
});

describe('statusText', () => {
  it('적어 둔 것이 하나도 없으면 빈 글', () => {
    expect(statusText(nothing)).toBe('');
  });

  it('위젯을 그린 때(새 것부터), 마지막 그림, 달력 화면, 넘겨받은 편집, 화면 읽기, 업데이트를 적는다', () => {
    const text = statusText({
      now: NOW,
      draws: [{ at: at(10, 1, 7), v: '0.9.11 (2026-11-17)', src: 'server', over: 0, next: at(10, 3, 7) }, { at: at(10, 3, 12), v: '0.9.11 (2026-11-17)', src: 'server', over: 1, next: at(10, 3, 27) }],
      web: { at: at(10, 2, 50), app: '0.9.11', sw: false, bridge: true, log: [{ at: at(10, 2, 49), level: 'error', type: '@firebase/firestore', text: 'Firestore (13.3.0): 연결이 끊겼다' }] },
      activeAt: at(10, 2, 55),
      leave: { at: at(10, 2, 56), how: 'left' },
      pending: { uid: 'u', savedAt: at(10, 2, 51), edits: [{ monthId: '2026-11', day: '19', text: '', color: '', editedAt: 1 }] },
      bridge: { at: at(10, 2, 54), ok: 120, fail: 3, lastOkAt: at(10, 2, 54), lastError: 'JavaScript 오류' },
      update: { version: '0.9.11 (2026-11-17)', unfinished: { 'large|inapp': 2, 'small|': 0 }, skipUntil: { app: at(10, 30), old: at(9, 0) }, note: '', libNote: '받아 둔 것이 오류를 냈다' },
    });
    expect(text.split('\n')).toEqual([
      '— 상태 —',
      '위젯 그림: 10:03:12 · 10:01:07',
      '마지막 그림: 0.9.11 (2026-11-17), 서버에서 읽음, 얹은 편집 1건, 다음 요청 15초 뒤',
      '달력 화면(10:02:50): 웹앱 0.9.11, 서비스 워커 없음, 넘기기 켜짐',
      '웹 화면 기록(10:02:49): error @firebase/firestore Firestore (13.3.0): 연결이 끊겼다',
      '달력이 떠 있던 마지막 때: 10:02:55',
      '달력에서 나감(10:02:56): 닫지 않고 홈 화면으로 나감',
      '넘겨받은 편집: 1건(10:02:51) 11-19',
      '화면 읽기(10:02:54): 성공 120(마지막 10:02:54), 실패 3(마지막 실패: JavaScript 오류)',
      '업데이트: 받아 둔 0.9.11 (2026-11-17), 끝나지 못함 large|inapp 2번, 쉬는 중 app 10:30:00까지, 받아 둔 것이 오류를 냈다',
    ]);
  });

  it('위젯을 바로 새로 그리게 하는 방법의 판정과 마지막 시도 다섯 개를 적는다. 해 본 적이 없으면 적지 않는다', () => {
    const t = (how: ReloadTry['how'], why: ReloadTry['why'], when: number, more: Partial<ReloadTry> = {}): ReloadTry => ({ how, why, at: when, got: 0, alive: true, void: false, away: false, shut: false, err: '', ...more });
    expect(reloadLines([], NOW)).toEqual([]);
    expect(statusText({ ...nothing, reload: [] })).toBe('');
    const tries = [
      t('finish', 'save', at(9, 0, 0)), // 마지막 다섯 개보다 앞의 것은 시도 줄에 나오지 않는다
      t('setWidget', 'probe', at(10, 0, 0)),
      t('ping', 'probe', at(9, 30, 0), { got: at(9, 30, 0) + 700 }),
      t('ping', 'probe', at(10, 0, 4), { got: at(10, 0, 4) + 900 }),
      t('complete', 'probe', at(10, 0, 8), { void: true, shut: true }),
      t('ping', 'save', at(10, 2, 0), { away: true }),
      t('ping', 'leave', at(10, 3, 0), { void: true }),
      t('ping', 'save', at(10, 4, 58)),
    ];
    expect(reloadLines(tries, NOW)).toEqual([
      '바로 그리기: setWidget 안 됨 · ping 됨 · complete 시험 전 · finish 시험 전',
      '시도: 10:00:04 ping(시험) 0.9초 뒤 그림 · 10:00:08 complete(시험) 바로 닫힘 · 10:02:00 ping(저장) 나가서 지켜보지 못함 · 10:03:00 ping(나간 뒤) 닫아서 무효 · 10:04:58 ping(저장) 지켜보는 중',
    ]);
    expect(reloadLines(tries.slice(0, 2), NOW)[1]).toBe('시도: 09:00:00 finish(저장) 안 그려짐 · 10:00:00 setWidget(시험) 안 그려짐');
    expect(reloadLines([t('ping', 'probe', at(10, 0, 0), { alive: false }), t('setWidget', 'probe', at(10, 1, 0), { err: 'x'.repeat(60) })], NOW)[1]).toBe(`시도: 10:00:00 ping(시험) 스크립트가 멈춤 · 10:01:00 setWidget(시험) 못 함(${'x'.repeat(40)})`);
    expect(statusText({ ...nothing, reload: tries }).split('\n')[2]).toBe('바로 그리기: setWidget 안 됨 · ping 됨 · complete 시험 전 · finish 시험 전');
  });

  it('위젯을 그린 기록만 없으면 그렇다고 적는다. 2분은 분으로, 버전을 모르면 모른다고 적는다', () => {
    expect(statusText({ ...nothing, activeAt: at(10, 0) }).split('\n').slice(0, 2)).toEqual(['— 상태 —', '위젯 그림: 기록 없음(0.9.11보다 앞의 코드로 그려졌거나 아직 그려지지 않았다)']);
    expect(statusText({ ...nothing, draws: [{ at: at(10, 0), v: '', src: 'cache', over: 0, next: at(10, 2) }] })).toContain('마지막 그림: 버전 모름, 보관해 둔 것(오프라인), 얹은 편집 0건, 다음 요청 2분 뒤');
    expect(statusText({ ...nothing, web: { at: at(10, 0), app: '', sw: true, bridge: false, log: [] } })).toContain('달력 화면(10:00:00): 웹앱 버전 모름, 서비스 워커 있음, 넘기기 꺼짐');
    expect(statusText({ ...nothing, bridge: { at: at(10, 0), ok: 0, fail: 0, lastOkAt: 0, lastError: '' } })).toContain('화면 읽기(10:00:00): 성공 0, 실패 0');
  });
});
