import { expect, it } from 'vitest';
import { lunarDate, lunarLabel, lunarLong, lunarShort, solarOfLunar } from './lunar';

const DAY_MS = 86_400_000;
const keyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

it('양력 날짜의 음력 날짜와 윤달', () => {
  expect([lunarDate('2026-11-13'), lunarDate('2025-07-25')]).toEqual([
    { year: 2026, month: 10, day: 5, leap: false },
    { year: 2025, month: 6, day: 1, leap: true },
  ]);
  expect([lunarLabel('2026-11-13'), lunarLabel('2025-07-25')]).toEqual(['음 10.5', '음 윤6.1']);
  expect([lunarShort('2026-11-13'), lunarShort('2025-07-25')]).toEqual(['10.5', '윤6.1']);
  expect([lunarLong('2026-11-13'), lunarLong('2025-07-25')]).toEqual(['음력 10월 5일', '음력 윤6월 1일']);
});

it('설날 전날은 지난 음력 해의 섣달이고, 양력 1월은 아직 지난 음력 해다', () => {
  expect([lunarDate('2026-02-17'), lunarDate('2026-02-16'), lunarDate('2026-01-01')]).toEqual([
    { year: 2026, month: 1, day: 1, leap: false },
    { year: 2025, month: 12, day: 29, leap: false },
    { year: 2025, month: 11, day: 13, leap: false },
  ]);
});

it('음력 날짜를 양력으로 찾는다(윤달은 따로 말해야 한다)', () => {
  expect([solarOfLunar(2026, 1, 1), solarOfLunar(2026, 4, 8), solarOfLunar(2026, 8, 15), solarOfLunar(2028, 1, 1), solarOfLunar(2025, 6, 1), solarOfLunar(2025, 6, 1, true)])
    .toEqual(['2026-02-17', '2026-05-24', '2026-09-25', '2028-01-27', '2025-06-25', '2025-07-25']);
  // 그해에 없는 윤달, 그 달에 없는 날, 표 밖의 해
  expect([solarOfLunar(2026, 6, 1, true), solarOfLunar(2025, 12, 30), solarOfLunar(2026, 13, 1), solarOfLunar(2026, 1, 0), solarOfLunar(1899, 1, 1), solarOfLunar(2101, 1, 1)])
    .toEqual([null, null, null, null, null, null]);
});

it('알려진 설날, 부처님오신날, 추석 날짜와 맞는다', () => {
  // 2027년은 우주항공청의 2027년 월력요항(2026-06-29)에 적힌 날짜다.
  const seol = ['2014-01-31', '2017-01-28', '2020-01-25', '2023-01-22', '2024-02-10', '2025-01-29', '2026-02-17', '2027-02-07', '2028-01-27', '2030-02-03'];
  const chuseok = ['2014-09-08', '2017-10-04', '2020-10-01', '2023-09-29', '2024-09-17', '2025-10-06', '2026-09-25', '2027-09-15', '2028-10-03'];
  const buddha = ['2023-05-27', '2024-05-15', '2025-05-05', '2026-05-24', '2027-05-13'];
  expect(seol.map((k) => solarOfLunar(Number(k.slice(0, 4)), 1, 1))).toEqual(seol);
  expect(chuseok.map((k) => solarOfLunar(Number(k.slice(0, 4)), 8, 15))).toEqual(chuseok);
  expect(buddha.map((k) => solarOfLunar(Number(k.slice(0, 4)), 4, 8))).toEqual(buddha);
});

it('2017년 2월 26일은 음력 2월 1일이다(브라우저의 음력 계산은 이날을 1월 30일로 본다. 그래서 표를 쓴다)', () => {
  expect([lunarShort('2017-02-25'), lunarShort('2017-02-26'), lunarShort('2017-03-27'), lunarShort('2017-03-28')]).toEqual(['1.29', '2.1', '2.30', '3.1']);
});

it('2051~2100년(계산한 음력)의 설날, 추석, 부처님오신날, 윤달', () => {
  // 설날은 홍콩천문대 대조표의 정월 초하루와 50해 가운데 47해가 같다. 2061, 2089, 2092년은 삭이 한국 시각 0시~1시 사이라 한국이 하루 늦다
  // (2092년의 삭은 한국 시각 2월 8일 0시 2분, 중국 시각 2월 7일 23시 2분).
  expect([2051, 2060, 2075, 2092, 2100].map((y) => solarOfLunar(y, 1, 1))).toEqual(['2051-02-11', '2060-02-02', '2075-02-15', '2092-02-08', '2100-02-09']);
  expect([2051, 2060, 2075, 2092, 2100].map((y) => solarOfLunar(y, 8, 15))).toEqual(['2051-09-19', '2060-09-09', '2075-09-24', '2092-09-16', '2100-09-18']);
  expect([2051, 2092, 2100].map((y) => solarOfLunar(y, 4, 8))).toEqual(['2051-05-17', '2092-05-13', '2100-05-16']);
  const leaps: string[] = [];
  for (let y = 2051; y <= 2100; y += 1) for (let m = 1; m <= 12; m += 1) if (solarOfLunar(y, m, 1, true)) leaps.push(`${y}-${m}`);
  expect(leaps).toEqual([
    '2052-8', '2055-6', '2058-4', '2061-3', '2063-7', '2066-5', '2069-4', '2071-8', '2074-6',
    '2077-4', '2080-3', '2082-7', '2085-5', '2088-4', '2090-8', '2093-6', '2096-4', '2099-3',
  ]);
  expect([lunarShort('2060-08-15'), lunarLong('2092-02-08'), lunarLabel('2100-12-31')]).toEqual(['7.20', '음력 1월 1일', '음 12.1']);
});

it('표의 범위는 1900-01-31부터 2100-12-31까지이고, 밖의 날짜와 날짜가 아닌 글은 null과 빈 글이다', () => {
  // 2050-12-31까지는 한국천문연구원 자료이고 2051-01-01부터는 계산한 것이다. 그 사이가 하루씩 이어진다.
  expect([lunarDate('1900-01-31'), lunarDate('2050-12-31'), lunarDate('2051-01-01'), lunarDate('2100-12-31')]).toEqual([
    { year: 1900, month: 1, day: 1, leap: false },
    { year: 2050, month: 11, day: 18, leap: false },
    { year: 2050, month: 11, day: 19, leap: false },
    { year: 2100, month: 12, day: 1, leap: false },
  ]);
  const outside = ['1900-01-30', '1899-12-31', '2101-01-01', '2126-11-14', '', '날짜아님', '2026-13-01', '2026-02-30'];
  expect(outside.map(lunarDate)).toEqual(outside.map(() => null));
  expect(outside.flatMap((k) => [lunarLabel(k), lunarShort(k), lunarLong(k)]).join('')).toBe('');
});

it('범위 안의 모든 날이 이어진다: 날마다 하루씩 늘거나 다음 달 1일이 되고, 양력으로 되돌리면 같은 날이다', () => {
  const start = Date.UTC(1900, 0, 31);
  const end = Date.UTC(2100, 11, 31);
  let kasiCounts: number[] = [];
  let previous = lunarDate(keyOf(start))!;
  let months = 1;
  let leapMonths = 0;
  for (let ms = start + DAY_MS; ms <= end; ms += DAY_MS) {
    const key = keyOf(ms);
    const l = lunarDate(key)!;
    if (l.day === 1) {
      expect([29, 30], key).toContain(previous.day);
      // 다음 달이거나, 같은 달의 윤달이거나, 다음 해의 1월이다.
      const next = l.leap ? [previous.year, previous.month] : previous.month === 12 ? [previous.year + 1, 1] : [previous.year, previous.month + 1];
      expect([l.year, l.month], key).toEqual(next);
      months += 1;
      if (l.leap) leapMonths += 1;
    } else {
      expect(l, key).toEqual({ ...previous, day: previous.day + 1 });
    }
    if (solarOfLunar(l.year, l.month, l.day, l.leap) !== key) throw new Error(`${key}를 되돌리지 못했다`);
    previous = l;
    if (key === '2050-12-31') kasiCounts = [months, leapMonths];
  }
  // 범위 안에서 시작하는 달의 수와 그 가운데 윤달의 수(19년에 7번꼴). 표가 바뀌면 여기서 걸린다.
  // 앞의 둘은 한국천문연구원 자료가 있는 2050-12-31까지, 뒤의 둘은 2100-12-31까지다.
  expect([...kasiCounts, months, leapMonths]).toEqual([1867, 56, 2486, 74]);
});
