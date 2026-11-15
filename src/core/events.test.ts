import { expect, it } from 'vitest';
import {
  allAlarmTriggers,
  alarmTriggers,
  countdownChips,
  countdownLabel,
  countdownStatus,
  eventsByDate,
  isEventId,
  newEventId,
  occurrences,
  parseEventMap,
  parseEventRecord,
  type AlarmRecord,
  type CountdownRecord,
  type EventMap,
} from './events';
import { addDays } from './layout';
import { holidayLabel } from './holidays';
import { lunarDate, solarOfLunar } from './lunar';

const alarm = (over: Partial<AlarmRecord> = {}): AlarmRecord => ({
  type: 'alarm', date: '2026-11-20', text: '회의', done: false, repeat: { freq: 'none' }, time: '09:30', advance: [0], editedAt: 1, editedBy: 'u', ...over,
});
const countdown = (over: Partial<CountdownRecord> = {}): CountdownRecord => ({
  type: 'countdown', date: '2026-12-25', text: '성탄', done: false, repeat: { freq: 'none' }, kind: 'basic', showBottom: true, editedAt: 1, editedBy: 'u', ...over,
});
const range = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

it('parseEventRecord는 형식이 맞는 알림과 카운트다운만 받고 기본값을 채운다', () => {
  const base = { type: 'alarm', date: '2026-11-20', text: ' 회의 ', time: '09:30', extra: 1 };
  const a = parseEventRecord({ ...base, advance: [] }) as AlarmRecord;
  expect(a).toEqual({ type: 'alarm', date: '2026-11-20', text: '회의', done: false, repeat: { freq: 'none' }, time: '09:30', advance: [0], editedAt: 0, editedBy: '' });
  expect('extra' in a).toBe(false);
  expect((parseEventRecord({ ...base, advance: [7, 0, 0, 4] }) as AlarmRecord).advance).toEqual([0, 7]);
  expect(parseEventRecord({ ...base, text: 'ㅁ'.repeat(201), advance: [0] })).toBeNull();
  expect(parseEventRecord({ ...base, time: '24:00' })).toBeNull();
  expect(parseEventRecord({ ...base, date: '2026-02-30' })).toBeNull();
  expect(parseEventRecord({ ...base, text: '   ' })).toBeNull();
  expect(parseEventRecord({ ...base, type: 'memo' })).toBeNull();
  expect(parseEventRecord(null)).toBeNull();
  const r = parseEventRecord({ ...base, repeat: { freq: 'weekly', until: '2026-13-01', count: 2.5, x: 1 }, editedAt: 5, editedBy: 'me' }) as AlarmRecord;
  expect(r.repeat).toEqual({ freq: 'weekly' });
  expect([r.editedAt, r.editedBy]).toEqual([5, 'me']);
  expect((parseEventRecord({ ...base, repeat: { freq: 'daily', until: '2026-12-01', count: 3 } }) as AlarmRecord).repeat).toEqual({ freq: 'daily', until: '2026-12-01', count: 3 });
  expect((parseEventRecord({ ...base, repeat: { freq: 'bogus' } }) as AlarmRecord).repeat).toEqual({ freq: 'none' });
  const c = parseEventRecord({ type: 'countdown', date: '2026-12-25', text: '성탄', kind: 'zzz' }) as CountdownRecord;
  expect(c).toEqual({ type: 'countdown', date: '2026-12-25', text: '성탄', done: false, repeat: { freq: 'none' }, kind: 'basic', showBottom: true, editedAt: 0, editedBy: '' });
  expect((parseEventRecord({ type: 'countdown', date: '2026-12-25', text: 'a', kind: 'exam', showBottom: false }) as CountdownRecord)).toMatchObject({ kind: 'exam', showBottom: false });
});

it('parseEventMap은 열쇠와 항목이 맞는 것만 남긴다', () => {
  const ok = { type: 'countdown', date: '2026-12-25', text: '성탄' };
  const map = parseEventMap({ abc123: ok, 'bad-id': ok, good: { type: 'x' } });
  expect(Object.keys(map)).toEqual(['abc123']);
  expect(parseEventMap(null)).toEqual({});
});

it('항목 번호', () => {
  expect(isEventId('abcXYZ019')).toBe(true);
  expect(['', 'a-b', 'a'.repeat(41)].map(isEventId)).toEqual([false, false, false]);
  const id = newEventId();
  expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  expect(newEventId(() => 0)).toBe('A'.repeat(20));
  expect(newEventId(() => 0.999999)).toMatch(/^[A-Za-z0-9]{20}$/);
});

it('매달 31일은 31일이 없는 달을 건너뛰고 횟수에 세지 않는다', () => {
  const rec = alarm({ date: '2026-01-31', repeat: { freq: 'monthly', count: 3 } });
  expect(occurrences(rec, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
});

it('매년 2월 29일은 윤년에만', () => {
  const rec = alarm({ date: '2024-02-29', repeat: { freq: 'yearly' } });
  expect(occurrences(rec, '2024-01-01', '2032-12-31')).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
});

it('반복 없음, 매일, 매주, until과 count, from 이전 건너뛰기', () => {
  expect(occurrences(alarm(), '2026-11-20', '2026-11-20')).toEqual(['2026-11-20']);
  expect(occurrences(alarm(), '2026-11-21', '2026-12-20')).toEqual([]);
  const daily = alarm({ date: '2026-11-10', repeat: { freq: 'daily', count: 5, until: '2026-11-13' } });
  expect(occurrences(daily, '2026-11-01', '2026-11-30')).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  expect(occurrences(alarm({ date: '2026-11-10', repeat: { freq: 'daily', count: 5 } }), '2026-11-12', '2026-11-30')).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
  const weekly = alarm({ date: '2026-11-02', repeat: { freq: 'weekly' } });
  expect(occurrences(weekly, '2026-11-10', '2026-11-30')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30']);
  expect(occurrences(alarm({ date: '2026-11-02', repeat: { freq: 'monthly' } }), '2026-10-01', '2027-01-31')).toEqual(['2026-11-02', '2026-12-02', '2027-01-02']);
});

it('근무일은 주말과 공휴일을 빼고', () => {
  const rec = alarm({ date: '2026-09-21', repeat: { freq: 'workday' } });
  const expected = range('2026-09-21', '2026-09-30').filter((d) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return dow !== 0 && dow !== 6 && holidayLabel(d) === '';
  });
  expect(expected).not.toContain('2026-09-25');
  expect(occurrences(rec, '2026-09-01', '2026-09-30')).toEqual(expected);
  // 첫 날이 주말이어도 그 뒤의 근무일부터 센다
  const sat = alarm({ date: '2026-09-19', repeat: { freq: 'workday', count: 2 } });
  expect(occurrences(sat, '2026-09-01', '2026-09-30')).toEqual(['2026-09-21', '2026-09-22']);
});

it('음력 매년은 그해의 양력 날로 오고 until을 지킨다', () => {
  const date = '2026-11-13';
  const l = lunarDate(date)!;
  const want = [2026, 2027, 2028].map((y) => solarOfLunar(y, l.month, l.day)!);
  const rec = alarm({ date, repeat: { freq: 'lunarYearly' } });
  expect(occurrences(rec, '2026-01-01', '2028-12-31')).toEqual(want);
  const cut = alarm({ date, repeat: { freq: 'lunarYearly', until: want[1] } });
  expect(occurrences(cut, '2026-01-01', '2030-12-31')).toEqual(want.slice(0, 2));
  const cnt = alarm({ date, repeat: { freq: 'lunarYearly', count: 2 } });
  expect(occurrences(cnt, '2020-01-01', '2040-12-31')).toEqual(want.slice(0, 2));
  // 윤달(2025 윤6월 1일)에 만든 것은 평달로 온다
  const leap = alarm({ date: '2025-07-25', repeat: { freq: 'lunarYearly' } });
  expect(occurrences(leap, '2025-01-01', '2027-12-31')).toEqual([solarOfLunar(2026, 6, 1)!, solarOfLunar(2027, 6, 1)!].filter((d) => d >= '2025-07-25'));
});

it('알림의 미리 알림은 그날 그 시각에 울린다', () => {
  const rec = alarm({ advance: [0, 1] });
  const t = alarmTriggers('id', rec, new Date(2026, 10, 18), new Date(2026, 10, 21));
  expect(t.map((x) => x.at)).toEqual([new Date(2026, 10, 19, 9, 30), new Date(2026, 10, 20, 9, 30)]);
  expect(t.map((x) => x.key)).toEqual(['id@2026-11-20@1', 'id@2026-11-20@0']);
  expect(t[0]).toMatchObject({ id: 'id', occurrence: '2026-11-20', advance: 1, time: '09:30', text: '회의' });
  // from은 포함, to는 미포함
  expect(alarmTriggers('id', rec, new Date(2026, 10, 20, 9, 30), new Date(2026, 10, 20, 9, 31)).map((x) => x.key)).toEqual(['id@2026-11-20@0']);
  expect(alarmTriggers('id', rec, new Date(2026, 10, 18), new Date(2026, 10, 20, 9, 30))).toHaveLength(1);
});

it('완료한 알림과 카운트다운은 울리지 않는다', () => {
  const from = new Date(2026, 10, 18);
  const to = new Date(2026, 10, 21);
  expect(alarmTriggers('a', alarm({ done: true }), from, to)).toEqual([]);
  expect(alarmTriggers('c', countdown({ date: '2026-11-20' }), from, to)).toEqual([]);
});

it('allAlarmTriggers는 시각, 같으면 열쇠 순', () => {
  const items: EventMap = { b: alarm({ time: '08:00' }), a: alarm({ time: '08:00' }), c: alarm({ time: '07:00' }) };
  const t = allAlarmTriggers(items, new Date(2026, 10, 20), new Date(2026, 10, 21));
  expect(t.map((x) => x.key)).toEqual(['c@2026-11-20@0', 'a@2026-11-20@0', 'b@2026-11-20@0']);
});

it('반복 없는 카운트다운은 지난 날을 음수로, 매년 생일은 다음 생일과 나이를', () => {
  expect(countdownStatus(countdown({ date: '2026-12-25' }), '2026-11-15')).toEqual({ date: '2026-12-25', days: 40, age: null });
  expect(countdownStatus(countdown({ date: '2026-11-10' }), '2026-11-15')).toEqual({ date: '2026-11-10', days: -5, age: null });
  const b = countdown({ date: '1983-03-02', kind: 'birthday', repeat: { freq: 'yearly' } });
  expect(countdownStatus(b, '2026-11-15')).toEqual({ date: '2027-03-02', days: 107, age: 44 });
  expect(countdownStatus(b, '2027-03-02')).toEqual({ date: '2027-03-02', days: 0, age: 44 });
  expect(countdownStatus(countdown({ date: '2026-01-01', repeat: { freq: 'daily', until: '2026-06-01' } }), '2026-11-15')).toBeNull();
  const lb = countdown({ date: '2026-11-13', kind: 'birthday', repeat: { freq: 'lunarYearly' } });
  expect(countdownStatus(lb, '2027-01-01')?.age).toBe(1);
  expect(countdownStatus(countdown({ date: '2020-01-01', kind: 'anniversary', repeat: { freq: 'yearly' } }), '2026-11-15')?.age).toBeNull();
});

it('태어난 해의 생일(올해 태어난 아이)은 0살이 아니라 나이 없이', () => {
  const baby = countdown({ date: '2026-11-20', kind: 'birthday', repeat: { freq: 'yearly' } });
  expect(countdownStatus(baby, '2026-11-15')).toEqual({ date: '2026-11-20', days: 5, age: null });
  expect(countdownStatus(baby, '2026-11-21')).toEqual({ date: '2027-11-20', days: 364, age: 1 });
  const lunarBaby = countdown({ date: '2026-11-13', kind: 'birthday', repeat: { freq: 'lunarYearly' } });
  expect(countdownStatus(lunarBaby, '2026-11-01')).toMatchObject({ date: '2026-11-13', age: null });
  expect(countdownChips({ baby }, '2026-11-15')[0]).toMatchObject({ id: 'baby', days: 5, age: null });
});

it('달력 아래 줄은 다가오는 것 먼저 가까운 순, 지난 것은 최근 순, 숨김과 완료는 빠진다', () => {
  const items: EventMap = {
    far: countdown({ date: '2026-12-25', text: '먼' }),
    near: countdown({ date: '2026-11-16', text: '가까운' }),
    sameB: countdown({ date: '2026-11-16', text: '나' }),
    today: countdown({ date: '2026-11-15', text: '오늘' }),
    old: countdown({ date: '2026-11-01', text: '오래' }),
    recent: countdown({ date: '2026-11-14', text: '최근' }),
    hidden: countdown({ date: '2026-11-17', showBottom: false }),
    done: countdown({ date: '2026-11-18', done: true }),
    al: alarm({ date: '2026-11-17' }),
  };
  expect(countdownChips(items, '2026-11-15').map((c) => c.id)).toEqual(['today', 'near', 'sameB', 'far', 'recent', 'old']);
  expect(countdownChips(items, '2026-11-15')[0]).toMatchObject({ days: 0, kind: 'basic', date: '2026-11-15', age: null });
});

it('countdownLabel은 오늘, N일 남음, N일 지남', () => {
  expect([0, 3, -2].map(countdownLabel)).toEqual(['오늘', '3일 남음', '2일 지남']);
});

it('날짜별 줄은 알림을 시각 순으로 먼저, 카운트다운을 뒤에', () => {
  const items: EventMap = {
    c2: countdown({ date: '2026-11-20', text: '나' }),
    c1: countdown({ date: '2026-11-20', text: '가', kind: 'exam' }),
    a2: alarm({ time: '10:00', text: '가' }),
    a1: alarm({ time: '08:00', text: '나' }),
    a3: alarm({ time: '10:00', text: 'a' }),
  };
  const m = eventsByDate(items, '2026-11-01', '2026-11-30');
  expect([...m.keys()]).toEqual(['2026-11-20']);
  expect(m.get('2026-11-20')).toEqual([
    { id: 'a1', type: 'alarm', text: '나', time: '08:00', kind: null, done: false },
    { id: 'a3', type: 'alarm', text: 'a', time: '10:00', kind: null, done: false },
    { id: 'a2', type: 'alarm', text: '가', time: '10:00', kind: null, done: false },
    { id: 'c1', type: 'countdown', text: '가', time: '', kind: 'exam', done: false },
    { id: 'c2', type: 'countdown', text: '나', time: '', kind: 'basic', done: false },
  ]);
});

it('범위가 몇십 년이어도 빨리 끝난다', () => {
  const rec = alarm({ date: '1950-01-01', repeat: { freq: 'daily' } });
  const t0 = performance.now();
  const out = occurrences(rec, '2026-11-01', '2026-11-30');
  expect(performance.now() - t0).toBeLessThan(50);
  expect(out).toHaveLength(30);
  const t1 = performance.now();
  const ly = occurrences(alarm({ date: '1950-02-03', repeat: { freq: 'lunarYearly' } }), '2026-01-01', '2026-12-31');
  const wk = occurrences(alarm({ date: '1950-01-02', repeat: { freq: 'workday' } }), '2026-11-01', '2026-11-30');
  expect(performance.now() - t1).toBeLessThan(50);
  expect(ly).toHaveLength(1);
  expect(wk.length).toBeGreaterThan(15);
});

it('매년 2월 29일 카운트다운은 다음 윤년의 날을 찾는다', () => {
  const rec = countdown({ date: '2024-02-29', kind: 'birthday', repeat: { freq: 'yearly' } });
  const st = countdownStatus(rec, '2025-03-01')!;
  expect(st.date).toBe('2028-02-29');
  expect(st.days).toBeGreaterThan(1000);
  expect(st.age).toBe(4);
  expect(countdownStatus(countdown({ date: '2024-02-29', repeat: { freq: 'yearly', until: '2026-12-31' } }), '2025-03-01')).toBeNull();
  expect(countdownStatus(countdown({ date: '2024-02-29', repeat: { freq: 'yearly', count: 1 } }), '2025-03-01')).toBeNull();
});

it('매달 29일·30일은 그날이 없는 달을 건너뛴다', () => {
  const rec = alarm({ date: '2027-01-30', repeat: { freq: 'monthly' } });
  expect(occurrences(rec, '2027-01-01', '2027-04-30')).toEqual(['2027-01-30', '2027-03-30', '2027-04-30']);
});

it('반복 없음이면 until과 count를 버린다', () => {
  const r = parseEventRecord({ type: 'alarm', date: '2026-11-20', text: 'a', time: '09:00', repeat: { freq: 'none', until: '2026-11-01', count: 3 } }) as AlarmRecord;
  expect(r.repeat).toEqual({ freq: 'none' });
  expect(occurrences(r, '2026-11-01', '2026-12-01')).toEqual(['2026-11-20']);
});
