/**
 * 대한민국의 공휴일(일요일은 뺀다). 「관공서의 공휴일에 관한 규정」의 공휴일과 대체공휴일을 해마다 계산하고,
 * 선거일과 임시공휴일은 아래 표(ONE_OFF)에 적힌 날만 안다. 새로 정해지면 표에 더한다.
 * 1990년 이전은 그때의 규정과 다를 수 있다(설날과 추석 연휴의 길이, 국군의 날 등은 따지지 않는다).
 */
import { solarOfLunar } from './lunar';

const DAY_MS = 86_400_000;
const SUBSTITUTE = '대체공휴일';

/** 대체공휴일이 생기는 경우. weekend: 토요일·일요일·다른 공휴일과 겹칠 때. sunday: 일요일·다른 공휴일과 겹칠 때. none: 대체하지 않는다. */
type Rule = 'weekend' | 'sunday' | 'none';
type Entry = { key: string; name: string; rule: Rule };

// 날짜가 고정된 공휴일. years는 공휴일이던 해들(없으면 늘), substituteFrom은 대체공휴일을 적용하기 시작한 해(없으면 대체하지 않는다).
// 어린이날 2014년(2013-11-05 개정), 광복절·개천절·한글날 2021년(2021-08-04 개정), 3.1절은 그다음 해부터,
// 성탄절과 부처님오신날 2023년(2023-05-04 개정), 노동절과 제헌절은 공휴일이 된 2026년부터다.
const FIXED: { md: string; name: string; years?: [from: number, to: number][]; substituteFrom?: number }[] = [
  { md: '01-01', name: '신정' },
  { md: '03-01', name: '3.1절', substituteFrom: 2022 },
  { md: '04-05', name: '식목일', years: [[0, 2005]] },
  { md: '05-01', name: '노동절', years: [[2026, Infinity]], substituteFrom: 2026 },
  { md: '05-05', name: '어린이날', substituteFrom: 2014 },
  { md: '06-06', name: '현충일' },
  { md: '07-17', name: '제헌절', years: [[0, 2007], [2026, Infinity]], substituteFrom: 2026 },
  { md: '08-15', name: '광복절', substituteFrom: 2021 },
  { md: '10-03', name: '개천절', substituteFrom: 2021 },
  { md: '10-09', name: '한글날', years: [[0, 1990], [2013, Infinity]], substituteFrom: 2021 },
  { md: '12-25', name: '성탄절', substituteFrom: 2023 },
];
const FESTIVE_SUBSTITUTE_FROM = 2014; // 설날과 추석 연휴
const BUDDHA_SUBSTITUTE_FROM = 2023;

// 선거일(임기가 끝나서 하는 선거)과 임시공휴일. 규칙으로 계산하지 않고 정해진 것만 적는다.
// 2028-04-12는 공직선거법의 날짜 규칙(임기 만료 50일 전 이후 첫 수요일)에 따른 제23대 국회의원 선거일이다.
const ONE_OFF: Record<string, string> = {
  '2010-06-02': '지방선거', '2012-04-11': '국회의원선거', '2012-12-19': '대통령선거', '2014-06-04': '지방선거',
  '2015-08-14': '임시공휴일', '2016-04-13': '국회의원선거', '2016-05-06': '임시공휴일', '2017-05-09': '대통령선거',
  '2017-10-02': '임시공휴일', '2018-06-13': '지방선거', '2020-04-15': '국회의원선거', '2020-08-17': '임시공휴일',
  '2022-03-09': '대통령선거', '2022-06-01': '지방선거', '2023-10-02': '임시공휴일', '2024-04-10': '국회의원선거',
  '2024-10-01': '임시공휴일', '2025-01-27': '임시공휴일', '2025-06-03': '대통령선거', '2026-06-03': '지방선거',
  '2028-04-12': '국회의원선거',
};

const tables = new Map<number, Map<string, string[]>>();

const msOf = (dateKey: string): number => Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10)));
const keyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const shiftKey = (dateKey: string, days: number): string => keyOf(msOf(dateKey) + days * DAY_MS);
const weekdayOf = (dateKey: string): number => new Date(msOf(dateKey)).getUTCDay();

function build(year: number): Map<string, string[]> {
  const y = String(year).padStart(4, '0');
  const base: Entry[] = [];
  for (const f of FIXED) {
    if (f.years && !f.years.some(([from, to]) => year >= from && year <= to)) continue;
    base.push({ key: `${y}-${f.md}`, name: f.name, rule: f.substituteFrom !== undefined && year >= f.substituteFrom ? 'weekend' : 'none' });
  }
  const festive: Rule = year >= FESTIVE_SUBSTITUTE_FROM ? 'sunday' : 'none';
  const around = (key: string | null, name: string): void => {
    if (!key) return;
    base.push({ key: shiftKey(key, -1), name: `${name} 연휴`, rule: festive }, { key, name, rule: festive }, { key: shiftKey(key, 1), name: `${name} 연휴`, rule: festive });
  };
  around(solarOfLunar(year, 1, 1), '설날');
  const buddha = solarOfLunar(year, 4, 8);
  if (buddha) base.push({ key: buddha, name: '부처님오신날', rule: year >= BUDDHA_SUBSTITUTE_FROM ? 'weekend' : 'none' });
  around(solarOfLunar(year, 8, 15), '추석');

  const byDate = new Map<string, Entry[]>();
  for (const e of base) byDate.set(e.key, [...(byDate.get(e.key) ?? []), e]);
  const dates = [...byDate.keys()].sort();

  // 대체공휴일(규정 제3조). 겹친 공휴일마다 그 공휴일 다음의 첫 번째 비공휴일을 대체공휴일로 한다. 같은 날로 겹치면 그다음 비공휴일까지,
  // 토요일이면 그다음 비공휴일로 넘긴다. 토요일·일요일이 아닌 날에 공휴일 둘이 겹친 것은 하루만 대체한다(2025-05-05가 그랬다).
  const substitutes = new Set<string>();
  const taken = (key: string): boolean => {
    const dow = weekdayOf(key);
    return dow === 0 || dow === 6 || byDate.has(key) || key in ONE_OFF || substitutes.has(key);
  };
  for (const key of dates) {
    const entries = byDate.get(key)!;
    const dow = weekdayOf(key);
    let count: number;
    if (dow === 6) count = entries.filter((e) => e.rule === 'weekend').length;
    else if (dow === 0) count = entries.filter((e) => e.rule !== 'none').length;
    else count = entries.length >= 2 && entries.some((e) => e.rule !== 'none') ? 1 : 0;
    for (let i = 0; i < count; i += 1) {
      let next = shiftKey(key, 1);
      while (taken(next)) next = shiftKey(next, 1);
      substitutes.add(next);
    }
  }

  const all = new Map<string, string[]>();
  const add = (key: string, name: string): void => {
    all.set(key, [...(all.get(key) ?? []), name]);
  };
  for (const e of base) add(e.key, e.name);
  for (const [key, name] of Object.entries(ONE_OFF)) if (key.startsWith(`${y}-`)) add(key, name);
  for (const key of substitutes) add(key, SUBSTITUTE);
  return new Map([...all].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** 그해의 공휴일. 날짜순이고, 값은 그날의 이름들이다(대체공휴일은 '대체공휴일'). */
export function holidaysOfYear(year: number): ReadonlyMap<string, readonly string[]> {
  let table = tables.get(year);
  if (!table) {
    table = build(year);
    tables.set(year, table);
  }
  return table;
}

/** 그날의 공휴일 이름들. 공휴일이 아니면 빈 목록. */
export function holidayNames(dateKey: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return [];
  return [...(holidaysOfYear(Number(dateKey.slice(0, 4))).get(dateKey) ?? [])];
}

export function holidayLabel(dateKey: string): string {
  return holidayNames(dateKey).join('·');
}
