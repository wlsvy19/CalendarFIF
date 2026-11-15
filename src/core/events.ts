import { todayKey } from './dates';
import { holidayLabel } from './holidays';
import { addDays } from './layout';
import { lunarDate, solarOfLunar } from './lunar';

// 알림과 카운트다운의 자료 형식과 반복 계산. DOM도 Firebase도 모른다.

export type RepeatFreq = 'none' | 'daily' | 'workday' | 'weekly' | 'monthly' | 'yearly' | 'lunarYearly';
export type RepeatRule = { freq: RepeatFreq; until?: string; count?: number };
export type CountdownKind = 'basic' | 'birthday' | 'anniversary' | 'holiday' | 'exam';
export const ADVANCE_DAYS: readonly number[] = [0, 1, 2, 3, 5, 7];

export type AlarmRecord = {
  type: 'alarm'; date: string; text: string; done: boolean; repeat: RepeatRule;
  time: string; advance: number[]; editedAt: number; editedBy: string;
};
export type CountdownRecord = {
  type: 'countdown'; date: string; text: string; done: boolean; repeat: RepeatRule;
  kind: CountdownKind; showBottom: boolean; editedAt: number; editedBy: string;
};
export type EventRecord = AlarmRecord | CountdownRecord;
export type EventMap = Record<string, EventRecord>;

const FREQS: readonly RepeatFreq[] = ['none', 'daily', 'workday', 'weekly', 'monthly', 'yearly', 'lunarYearly'];
const KINDS: readonly CountdownKind[] = ['basic', 'birthday', 'anniversary', 'holiday', 'exam'];

export const REPEAT_LABELS: Record<RepeatFreq, string> = {
  none: '안 함', daily: '매일', workday: '근무일', weekly: '매주', monthly: '매달', yearly: '매년', lunarYearly: '음력 매년',
};
export const COUNTDOWN_KIND_LABELS: Record<CountdownKind, string> = {
  basic: '기본', birthday: '생일', anniversary: '기념일', holiday: '명절', exam: '시험',
};
export const ADVANCE_LABELS: Record<number, string> = {
  0: '당일', 1: '하루 전', 2: '이틀 전', 3: '사흘 전', 5: '5일 전', 7: '일주일 전',
};

// ---- 날짜 도우미(UTC 기준이라 서머타임과 상관없다) ----

const DAY_MS = 86_400_000;
const pad2 = (n: number): string => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number): string => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;

function parts(key: string): [number, number, number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))];
}

function isRealDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = parts(v);
  if (y < 1) return false;
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function dayNumber(key: string): number {
  const [y, m, d] = parts(key);
  const t = new Date(Date.UTC(2000, m - 1, d));
  t.setUTCFullYear(y);
  return Math.round(t.getTime() / DAY_MS);
}

const dowOf = (key: string): number => ((dayNumber(key) % 7) + 11) % 7; // 1970-01-01은 목요일(4)
const daysInMonth = (y: number, m: number): number => {
  const t = new Date(Date.UTC(2000, m, 0));
  t.setUTCFullYear(y);
  return t.getUTCDate();
};

// ---- 항목 번호와 읽기 ----

export function isEventId(id: string): boolean {
  return /^[A-Za-z0-9]{1,40}$/.test(id);
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function newEventId(random?: () => number): string {
  let out = '';
  if (random) {
    for (let i = 0; i < 20; i += 1) out += ID_CHARS[Math.min(61, Math.floor(random() * 62))];
  } else {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    for (const b of bytes) out += ID_CHARS[b % 62];
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseRepeat(raw: unknown): RepeatRule {
  const r = isObj(raw) ? raw : {};
  const freq = FREQS.includes(r.freq as RepeatFreq) ? (r.freq as RepeatFreq) : 'none';
  const out: RepeatRule = { freq };
  if (freq === 'none') return out;
  if (isRealDate(r.until)) out.until = r.until;
  if (typeof r.count === 'number' && Number.isInteger(r.count) && r.count >= 1 && r.count <= 99999) out.count = r.count;
  return out;
}

export function parseEventRecord(raw: unknown): EventRecord | null {
  if (!isObj(raw)) return null;
  if (raw.type !== 'alarm' && raw.type !== 'countdown') return null;
  if (!isRealDate(raw.date)) return null;
  if (typeof raw.text !== 'string') return null;
  const text = raw.text.trim();
  if (text.length < 1 || text.length > 200) return null;
  const common = {
    date: raw.date,
    text,
    done: raw.done === true,
    repeat: parseRepeat(raw.repeat),
  };
  const editedAt = typeof raw.editedAt === 'number' && Number.isFinite(raw.editedAt) ? raw.editedAt : 0;
  const editedBy = typeof raw.editedBy === 'string' ? raw.editedBy : '';
  if (raw.type === 'alarm') {
    if (typeof raw.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) return null;
    const list = Array.isArray(raw.advance) ? raw.advance : [];
    let advance = [...new Set(list.filter((a): a is number => typeof a === 'number' && ADVANCE_DAYS.includes(a)))].sort((a, b) => a - b);
    if (advance.length === 0) advance = [0];
    advance = advance.slice(0, 5);
    return { type: 'alarm', ...common, time: raw.time, advance, editedAt, editedBy };
  }
  const kind = KINDS.includes(raw.kind as CountdownKind) ? (raw.kind as CountdownKind) : 'basic';
  return { type: 'countdown', ...common, kind, showBottom: raw.showBottom === undefined ? true : raw.showBottom !== false, editedAt, editedBy };
}

export function parseEventMap(raw: unknown): EventMap {
  const out: EventMap = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!isEventId(id)) continue;
    const rec = parseEventRecord(v);
    if (rec) out[id] = rec;
  }
  return out;
}

// ---- 반복 계산 ----

/** s 이상인 걸리는 날을 오름차순으로 낸다(rec.date 이전은 내지 않는다). hi를 넘으면 멈춘다. */
function* candidates(rec: EventRecord, s: string, hi: string): Generator<string> {
  const freq = rec.repeat.freq;
  const [, rm, rd] = parts(rec.date);
  if (freq === 'daily') {
    for (let d = s; d <= hi; d = addDays(d, 1)) yield d;
  } else if (freq === 'workday') {
    for (let d = s; d <= hi; d = addDays(d, 1)) {
      const w = dowOf(d);
      if (w !== 0 && w !== 6 && holidayLabel(d) === '') yield d;
    }
  } else if (freq === 'weekly') {
    for (let d = addDays(s, (dowOf(rec.date) - dowOf(s) + 7) % 7); d <= hi; d = addDays(d, 7)) yield d;
  } else if (freq === 'monthly') {
    let [y, m] = parts(s);
    const [hy] = parts(hi);
    while (y <= hy && y <= 9999) {
      if (rd <= daysInMonth(y, m)) {
        const d = keyOf(y, m, rd);
        if (d > hi) return;
        if (d >= s) yield d;
      } else if (keyOf(y, m, 1) > hi) return;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else if (freq === 'yearly') {
    const [hy] = parts(hi);
    for (let y = parts(s)[0]; y <= hy && y <= 9999; y += 1) {
      if (rd > daysInMonth(y, rm)) continue;
      const d = keyOf(y, rm, rd);
      if (d > hi) return;
      if (d >= s) yield d;
    }
  } else if (freq === 'lunarYearly') {
    const l = lunarDate(rec.date);
    if (!l) return;
    const [hy] = parts(hi);
    // 음력 y년의 날은 양력 y년이나 y+1년 초에 걸린다.
    for (let y = Math.max(parts(s)[0] - 1, l.year); y <= hy && y <= 2100; y += 1) {
      const d = solarOfLunar(y, l.month, l.day);
      if (!d) continue;
      if (d > hi) return;
      if (d >= s) yield d;
    }
  }
}

export function occurrences(rec: EventRecord, from: string, to: string): string[] {
  const { freq, until, count } = rec.repeat;
  const hi = until && until < to ? until : to;
  const lo = from > rec.date ? from : rec.date;
  if (lo > hi) return [];
  if (freq === 'none') return rec.date >= lo && rec.date <= hi ? [rec.date] : [];
  const out: string[] = [];
  if (count === undefined) {
    for (const d of candidates(rec, lo, hi)) out.push(d);
    return out;
  }
  // 횟수를 세야 하면 rec.date부터 센다. 근무일은 100년을 넘기지 않는다.
  let limit = hi;
  if (freq === 'workday') {
    const [y, m, d] = parts(rec.date);
    const cap = keyOf(Math.min(9999, y + 100), m, Math.min(d, daysInMonth(Math.min(9999, y + 100), m)));
    if (cap < limit) limit = cap;
  }
  let n = 0;
  for (const d of candidates(rec, rec.date, limit)) {
    n += 1;
    if (n > count) break;
    if (d >= lo) out.push(d);
  }
  return out;
}

// ---- 알림 ----

export type AlarmTrigger = { key: string; id: string; at: Date; occurrence: string; advance: number; time: string; text: string };

export function alarmTriggers(id: string, rec: EventRecord, from: Date, to: Date): AlarmTrigger[] {
  if (rec.type !== 'alarm' || rec.done) return [];
  const [hh, mm] = rec.time.split(':').map(Number);
  const out: AlarmTrigger[] = [];
  for (const occ of occurrences(rec, todayKey(from), addDays(todayKey(to), 7))) {
    for (const a of rec.advance) {
      const [y, m, d] = parts(addDays(occ, -a));
      const at = new Date(y, m - 1, d, hh, mm);
      if (at.getTime() >= from.getTime() && at.getTime() < to.getTime()) {
        out.push({ key: `${id}@${occ}@${a}`, id, at, occurrence: occ, advance: a, time: rec.time, text: rec.text });
      }
    }
  }
  return out.sort((x, y) => x.at.getTime() - y.at.getTime() || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

export function allAlarmTriggers(items: EventMap, from: Date, to: Date): AlarmTrigger[] {
  const out: AlarmTrigger[] = [];
  for (const [id, rec] of Object.entries(items)) out.push(...alarmTriggers(id, rec, from, to));
  return out.sort((x, y) => x.at.getTime() - y.at.getTime() || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

// ---- 카운트다운 ----

/** today 이상인 첫 걸리는 날. 규칙이 끝났거나 찾는 한도(매년 9년, 그 밖 400일) 안에 없으면 undefined. */
function firstOccurrence(rec: EventRecord, today: string): string | undefined {
  const { freq, until, count } = rec.repeat;
  const yearly = freq === 'yearly' || freq === 'lunarYearly';
  const [y, m, d] = parts(today);
  let cap = yearly ? keyOf(Math.min(9999, y + 9), m, Math.min(d, daysInMonth(Math.min(9999, y + 9), m))) : addDays(today, 400);
  if (until && until < cap) cap = until;
  const lo = today > rec.date ? today : rec.date;
  if (lo > cap) return undefined;
  if (count !== undefined) return occurrences(rec, lo, cap)[0];
  for (const day of candidates(rec, lo, cap)) return day;
  return undefined;
}

export type CountdownStatus = { date: string; days: number; age: number | null };

export function countdownStatus(rec: CountdownRecord, today: string): CountdownStatus | null {
  if (rec.repeat.freq === 'none') return { date: rec.date, days: dayNumber(rec.date) - dayNumber(today), age: null };
  const date = firstOccurrence(rec, today);
  if (!date) return null;
  let age: number | null = null;
  if (rec.kind === 'birthday') {
    if (rec.repeat.freq === 'yearly') age = parts(date)[0] - parts(rec.date)[0];
    else if (rec.repeat.freq === 'lunarYearly') {
      const a = lunarDate(date);
      const b = lunarDate(rec.date);
      if (a && b) age = a.year - b.year;
    }
    if (age !== null && age <= 0) age = null; // 태어난 해의 그날은 나이를 적지 않는다("(0살)"이 되지 않게)
  }
  return { date, days: dayNumber(date) - dayNumber(today), age };
}

// ---- 화면에 쓰는 묶음 ----

export type DayEventLine = { id: string; type: 'alarm' | 'countdown'; text: string; time: string; kind: CountdownKind | null; done: boolean };

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function eventsByDate(items: EventMap, from: string, to: string): Map<string, DayEventLine[]> {
  const days = new Map<string, DayEventLine[]>();
  for (const [id, rec] of Object.entries(items)) {
    for (const d of occurrences(rec, from, to)) {
      const line: DayEventLine = rec.type === 'alarm'
        ? { id, type: 'alarm', text: rec.text, time: rec.time, kind: null, done: rec.done }
        : { id, type: 'countdown', text: rec.text, time: '', kind: rec.kind, done: rec.done };
      const list = days.get(d);
      if (list) list.push(line);
      else days.set(d, [line]);
    }
  }
  const sorted = new Map<string, DayEventLine[]>();
  for (const d of [...days.keys()].sort()) {
    sorted.set(d, days.get(d)!.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'alarm' ? -1 : 1;
      return (a.type === 'alarm' ? cmp(a.time, b.time) : 0) || cmp(a.text, b.text);
    }));
  }
  return sorted;
}

export type CountdownChip = { id: string; text: string; kind: CountdownKind; date: string; days: number; age: number | null };

export function countdownChips(items: EventMap, today: string): CountdownChip[] {
  const chips: CountdownChip[] = [];
  for (const [id, rec] of Object.entries(items)) {
    if (rec.type !== 'countdown' || !rec.showBottom || rec.done) continue;
    const st = countdownStatus(rec, today);
    if (st) chips.push({ id, text: rec.text, kind: rec.kind, date: st.date, days: st.days, age: st.age });
  }
  return chips.sort((a, b) => {
    if ((a.days >= 0) !== (b.days >= 0)) return a.days >= 0 ? -1 : 1;
    const byDays = a.days >= 0 ? a.days - b.days : b.days - a.days;
    return byDays || cmp(a.text, b.text);
  });
}

export function countdownLabel(days: number): string {
  if (days === 0) return '오늘';
  return days > 0 ? `${days}일 남음` : `${-days}일 지남`;
}
