import { afterEach, describe, expect, it } from 'vitest';
import { holidayLabel, holidayNames, holidaysOfYear, parseOfficialHolidays, setOfficialHolidays, type OfficialYear } from './holidays';

const names = (...keys: string[]) => keys.map((k) => holidayNames(k));
/** 그해의 대체공휴일 날짜들. */
const substitutes = (year: number): string[] => [...holidaysOfYear(year)].filter(([, n]) => n.includes('대체공휴일')).map(([k]) => k);

it('날짜가 고정된 공휴일', () => {
  expect(names('2026-01-01', '2026-03-01', '2026-05-01', '2026-05-05', '2026-06-06', '2026-07-17', '2026-08-15', '2026-10-03', '2026-10-09', '2026-12-25', '2026-11-13'))
    .toEqual([['신정'], ['3.1절'], ['노동절'], ['어린이날'], ['현충일'], ['제헌절'], ['광복절'], ['개천절'], ['한글날'], ['성탄절'], []]);
});

it('공휴일이던 해에만 나온다: 노동절과 제헌절은 2026년부터, 제헌절은 2007년까지도, 한글날은 2013년부터, 식목일은 2005년까지', () => {
  expect(names('2025-05-01', '2025-07-17', '2008-07-17', '2007-07-17', '2012-10-09', '2013-10-09', '1990-10-09', '2005-04-05', '2006-04-05'))
    .toEqual([[], [], [], ['제헌절'], [], ['한글날'], ['한글날'], ['식목일'], []]);
});

it('음력으로 정해지는 설날 연휴, 부처님오신날, 추석 연휴', () => {
  expect(names('2026-02-16', '2026-02-17', '2026-02-18', '2026-05-24')).toEqual([['설날 연휴'], ['설날'], ['설날 연휴'], ['부처님오신날']]);
  expect(names('2026-09-24', '2026-09-25', '2026-09-26')).toEqual([['추석 연휴'], ['추석'], ['추석 연휴']]);
  expect(names('2027-02-06', '2027-02-07', '2027-02-08')).toEqual([['설날 연휴'], ['설날'], ['설날 연휴']]);
});

it('겹치면 둘 다 보여 주고, 이름은 가운뎃점으로 잇는다', () => {
  expect(names('2028-10-03', '2025-05-05')).toEqual([['개천절', '추석'], ['어린이날', '부처님오신날']]);
  expect([holidayLabel('2028-10-03'), holidayLabel('2026-11-13'), holidayLabel('2027-02-09')]).toEqual(['개천절·추석', '', '대체공휴일']);
});

it('2027년의 대체공휴일은 우주항공청의 2027년 월력요항과 같다', () => {
  // 설날(일), 노동절(토), 제헌절(토), 광복절(일), 개천절(일), 한글날(토), 성탄절(토)
  expect(substitutes(2027)).toEqual(['2027-02-09', '2027-05-03', '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27']);
  expect(names('2027-06-07', '2027-02-09')).toEqual([[], ['대체공휴일']]); // 현충일(일)은 대체하지 않는다
});

it('지난 해의 대체공휴일이 실제와 같다(제도가 넓어진 때를 따른다)', () => {
  expect(Object.fromEntries([2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => [y, substitutes(y)]))).toEqual({
    2013: [], // 제도가 생기기 전
    2014: ['2014-09-10'], // 추석 전날이 일요일
    2015: ['2015-09-29'], // 광복절(토)은 그때 대상이 아니었다
    2016: ['2016-02-10'],
    2017: ['2017-01-30', '2017-10-06'], // 추석 연휴와 개천절이 겹쳤다
    2018: ['2018-05-07', '2018-09-26'],
    2019: ['2019-05-06'],
    2020: ['2020-01-27'], // 개천절(토)은 그때 대상이 아니었다
    2021: ['2021-08-16', '2021-10-04', '2021-10-11'], // 국경일로 넓어진 첫해. 성탄절(토)은 아직 아니다
    2022: ['2022-09-12', '2022-10-10'], // 부처님오신날(일)과 성탄절(일)은 아직 아니다
    2023: ['2023-01-24', '2023-05-29'], // 부처님오신날(토)부터 적용
    2024: ['2024-02-12', '2024-05-06'],
    2025: ['2025-03-03', '2025-05-06', '2025-10-08'], // 어린이날과 부처님오신날이 같은 월요일: 하루만 대체한다
    2026: ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05'],
  });
});

it('대체공휴일은 다음의 첫 번째 비공휴일이다: 토요일, 일요일, 다른 공휴일, 이미 정해진 대체공휴일을 건너뛴다', () => {
  // 2036년: 부처님오신날(5/3 토)의 대체일은 일요일과 어린이날(5/5 월)을 지나 5/6이다.
  // 개천절(10/3 금)이 추석 전날과 겹치고 추석 다음날(10/5)이 일요일이라 대체공휴일이 이틀(10/6, 10/7)이다.
  expect(substitutes(2036)).toEqual(['2036-01-30', '2036-03-03', '2036-05-06', '2036-10-06', '2036-10-07']);
  // 2044년: 어린이날과 부처님오신날이 같은 목요일이다. 대체일은 금요일 하루다.
  expect(names('2044-05-05', '2044-05-06', '2044-05-09')).toEqual([['어린이날', '부처님오신날'], ['대체공휴일'], []]);
});

it('선거일과 임시공휴일은 표에 적힌 날만 나온다', () => {
  expect(names('2024-04-10', '2024-10-01', '2025-01-27', '2025-06-03', '2026-06-03', '2028-04-12', '2027-06-02'))
    .toEqual([['국회의원선거'], ['임시공휴일'], ['임시공휴일'], ['대통령선거'], ['지방선거'], ['국회의원선거'], []]);
});

it('그해의 공휴일을 날짜순으로 준다', () => {
  const keys = [...holidaysOfYear(2026).keys()];
  expect(keys).toEqual([...keys].sort());
  expect(keys).toEqual([
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-01', '2026-05-05', '2026-05-24', '2026-05-25',
    '2026-06-03', '2026-06-06', '2026-07-17', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05',
    '2026-10-09', '2026-12-25',
  ]);
});

it('음력 표 밖의 해는 날짜가 고정된 공휴일만 나오고, 날짜가 아닌 글은 빈 목록이다', () => {
  expect(names('2101-01-01', '2101-08-15', '1899-03-01')).toEqual([['신정'], ['광복절'], ['3.1절']]);
  expect([...holidaysOfYear(2101).values()].flat().filter((n) => n.startsWith('설날') || n.startsWith('추석') || n === '부처님오신날')).toEqual([]);
  // 2051~2100년은 계산한 음력으로 설날, 부처님오신날, 추석이 나온다.
  expect(names('2060-02-02', '2092-02-07', '2092-02-08', '2092-02-09', '2092-05-13', '2100-09-18')).toEqual([['설날'], ['설날 연휴'], ['설날'], ['설날 연휴'], ['부처님오신날'], ['추석']]);
  expect(names('', '날짜아님', '2026-1-1')).toEqual([[], [], []]);
});

// 공휴일 자료(특일 정보)를 받아 둔 경우. 아래 자료는 지어낸 것이고 날짜만 2026년의 실제 공휴일을 닮게 했다.
const day = (date: string, name: string) => ({ date, name });
const OFFICIAL_2026: OfficialYear = {
  days: [
    day('2026-01-01', '1월1일'), day('2026-02-16', '설날'), day('2026-02-17', '설날'), day('2026-02-18', '설날'), day('2026-03-01', '삼일절'),
    day('2026-03-02', '대체공휴일(삼일절)'), day('2026-05-05', '어린이날'), day('2026-05-24', '부처님오신날'), day('2026-05-25', '대체공휴일(부처님오신날)'),
    day('2026-06-03', '전국동시지방선거'), day('2026-06-06', '현충일'), day('2026-08-15', '광복절'), day('2026-08-17', '대체공휴일(광복절)'),
    day('2026-09-24', '추석'), day('2026-09-25', '추석'), day('2026-09-26', '추석'), day('2026-10-03', '개천절'), day('2026-10-05', '대체공휴일(개천절)'),
    day('2026-10-09', '한글날'), day('2026-12-25', '기독탄신일'),
  ],
};
const withDays = (year: OfficialYear, ...extra: { date: string; name: string }[]): OfficialYear => ({ days: [...year.days, ...extra] });
/** 그해의 공휴일(날짜와 이름들). */
const computed = (year: number) => [...holidaysOfYear(year)].map(([k, v]) => [k, [...v]]);

describe('공휴일 자료를 더한다', () => {
  afterEach(() => setOfficialHolidays(null));

  it('표에 없는 임시공휴일이 자료에 있으면 나온다', () => {
    expect(holidayNames('2026-08-14')).toEqual([]);
    setOfficialHolidays({ 2026: withDays(OFFICIAL_2026, day('2026-08-14', '임시공휴일')) });
    expect(holidayNames('2026-08-14')).toEqual(['임시공휴일']);
    expect(holidayLabel('2026-08-14')).toBe('임시공휴일');
    const keys = [...holidaysOfYear(2026).keys()];
    expect(keys).toContain('2026-08-14');
    expect(keys).toEqual([...keys].sort());
  });

  it('둘 다 있는 날은 계산한 이름을 쓴다', () => {
    setOfficialHolidays({ 2026: OFFICIAL_2026 });
    expect(names('2026-01-01', '2026-02-16', '2026-03-01', '2026-03-02', '2026-06-03', '2026-12-25'))
      .toEqual([['신정'], ['설날 연휴'], ['3.1절'], ['대체공휴일'], ['지방선거'], ['성탄절']]);
  });

  it('자료에만 있는 날의 이름은 가볍게 맞춘다', () => {
    setOfficialHolidays({
      2026: withDays(OFFICIAL_2026,
        day('2026-11-02', '1월1일'), day('2026-11-03', '기독탄신일'), day('2026-11-04', '삼일절'), day('2026-11-05', '대체공휴일(현충일)'),
        day('2026-11-06', '대체공휴일'), day('2026-11-09', '대통령선거일'), day('2026-11-10', '임시공휴일')),
    });
    expect(names('2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10'))
      .toEqual([['신정'], ['성탄절'], ['3.1절'], ['대체공휴일'], ['대체공휴일'], ['대통령선거일'], ['임시공휴일']]);
  });

  it('자료에만 있는 날에 항목이 둘이면 둘 다 나온다(이름이 같아지면 하나)', () => {
    setOfficialHolidays({
      2026: withDays(OFFICIAL_2026, day('2026-11-18', '대통령선거일'), day('2026-11-18', '임시공휴일'), day('2026-11-19', '대체공휴일(설날)'), day('2026-11-19', '대체공휴일(추석)')),
    });
    expect(names('2026-11-18', '2026-11-19')).toEqual([['대통령선거일', '임시공휴일'], ['대체공휴일']]);
    expect(holidayLabel('2026-11-18')).toBe('대통령선거일·임시공휴일');
  });

  it('계산한 날은 그해 자료에 없어도 남는다: 자료가 늦어도 실제 공휴일을 가리지 않는다', () => {
    const before = computed(2026);
    // OFFICIAL_2026에는 노동절(5/1)과 제헌절(7/17)이 없다.
    setOfficialHolidays({ 2026: OFFICIAL_2026 });
    expect(names('2026-05-01', '2026-07-17')).toEqual([['노동절'], ['제헌절']]);
    expect(computed(2026)).toEqual(before);
  });

  it('대체공휴일이 계산과 다르게 정해지면 자료의 날이 더해지고 계산한 날도 남는다', () => {
    // 지어낸 경우: 노동절(2027-05-01 토)의 대체공휴일을 자료가 5/4로 알린다.
    setOfficialHolidays({ 2027: { days: [day('2027-01-01', '1월1일'), day('2027-05-04', '대체공휴일(노동절)')] } });
    expect(names('2027-05-03', '2027-05-04')).toEqual([['대체공휴일'], ['대체공휴일']]);
  });

  it('자료가 없는 해는 계산 그대로다', () => {
    const before = computed(2027);
    setOfficialHolidays({ 2026: withDays(OFFICIAL_2026, day('2026-08-14', '임시공휴일')) });
    expect(computed(2027)).toEqual(before);
  });

  it('null을 주면 계산만 하던 때로 돌아간다', () => {
    const before = computed(2026);
    setOfficialHolidays({ 2026: withDays(OFFICIAL_2026, day('2026-08-14', '임시공휴일')) });
    expect(computed(2026)).not.toEqual(before);
    setOfficialHolidays(null);
    expect(computed(2026)).toEqual(before);
    expect(holidayNames('2026-08-14')).toEqual([]);
  });

  it('새 자료를 주면 앞의 자료를 바꾼다', () => {
    setOfficialHolidays({ 2026: withDays(OFFICIAL_2026, day('2026-08-14', '임시공휴일')) });
    setOfficialHolidays({ 2026: withDays(OFFICIAL_2026, day('2026-11-13', '임시공휴일')) });
    expect(names('2026-08-14', '2026-11-13')).toEqual([[], ['임시공휴일']]);
  });

  it('준 객체를 나중에 고쳐도 달라지지 않는다', () => {
    const input = { 2026: withDays(OFFICIAL_2026, day('2026-08-14', '임시공휴일')) };
    setOfficialHolidays(input);
    input[2026].days.push(day('2026-11-13', '임시공휴일'));
    expect(names('2026-08-14', '2026-11-13')).toEqual([['임시공휴일'], []]);
  });

  it('잘못된 자료는 아무것도 바꾸지 않는다', () => {
    const before = computed(2026);
    const bad: unknown[] = [
      undefined, 'x', [], { 2026: null }, { 2026: { days: 'x' } }, { 26: { days: [day('2026-08-14', '임시공휴일')] } },
      { 2026: { days: [day('2026-08-14', '임시공휴일'), day('2026-02-30', '임시공휴일')] } },
      { 2026: { days: [day('2027-08-14', '임시공휴일')] } },
      { 2026: { days: [day('2026-08-14', '')] } },
    ];
    for (const input of bad) {
      setOfficialHolidays(input as Record<string, OfficialYear>);
      expect(computed(2026)).toEqual(before);
    }
  });

  it('한 해가 잘못되면 그해만 빼고 다른 해는 쓴다', () => {
    setOfficialHolidays({ 2026: { days: [day('2026-08-14', '임시공휴일'), day('2026-13-01', 'x')] }, 2027: { days: [day('2027-08-13', '임시공휴일')] } });
    expect(names('2026-08-14', '2027-08-13')).toEqual([[], ['임시공휴일']]);
  });
});

describe('parseOfficialHolidays: 올려 둔 공휴일 자료를 확인한다', () => {
  const file = (years: unknown, extra: Record<string, unknown> = {}) => ({ version: 1, updatedAt: '2026-11-14T18:23:05.000Z', years, ...extra });

  it('맞는 자료는 해마다의 날짜와 이름으로 돌려준다(다른 칸은 버리고 이름의 앞뒤 공백을 뗀다)', () => {
    const input = file({ 2026: { days: [day('2026-01-01', '1월1일'), { date: '2026-08-14', name: ' 임시공휴일 ', seq: 1 }], other: true }, 2027: { days: [] } });
    expect(parseOfficialHolidays(input)).toEqual({ 2026: { days: [day('2026-01-01', '1월1일'), day('2026-08-14', '임시공휴일')] }, 2027: { days: [] } });
  });

  it('맨 위가 잘못되면 null', () => {
    for (const input of [null, undefined, 'x', 1, [], {}, file({}, { version: 2 }), { version: '1', years: {} }, file(null), file([]), file('x')]) {
      expect(parseOfficialHolidays(input)).toBeNull();
    }
  });

  it('쓸 수 있는 해가 하나도 없으면 null', () => {
    expect(parseOfficialHolidays(file({}))).toBeNull();
    expect(parseOfficialHolidays(file({ 26: { days: [] } }))).toBeNull();
  });

  it('해 안의 것이 하나라도 잘못되면 그해를 뺀다', () => {
    const good = { days: [day('2027-01-01', '1월1일')] };
    const badYears: Record<string, unknown> = { 26: { days: [] }, 20260: { days: [] }, abcd: { days: [] }, 2026: { days: 'x' } };
    for (const [key, value] of Object.entries(badYears)) expect(parseOfficialHolidays(file({ [key]: value, 2027: good }))).toEqual({ 2027: good });
    const badDays: unknown[] = [
      day('2026-02-30', '없는 날'), day('2026-2-3', '모양이 다른 날'), day('2025-12-31', '다른 해'), day('2026-01-01', ''), day('2026-01-01', '   '),
      day('2026-01-01', '가'.repeat(31)), { date: '2026-01-01', name: 1 }, { date: 20260101, name: '1월1일' }, null, 'x',
    ];
    for (const bad of badDays) expect(parseOfficialHolidays(file({ 2026: { days: [day('2026-01-01', '1월1일'), bad] }, 2027: good }))).toEqual({ 2027: good });
    expect(parseOfficialHolidays(file({ 2026: null, 2027: good }))).toEqual({ 2027: good });
  });

  it('이름은 30자까지, 한 해에 60일까지', () => {
    const thirty = '가'.repeat(30);
    expect(parseOfficialHolidays(file({ 2026: { days: [day('2026-01-01', thirty)] } }))).toEqual({ 2026: { days: [day('2026-01-01', thirty)] } });
    const days = (n: number) => Array.from({ length: n }, (_, i) => day(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), '임시공휴일'));
    expect(parseOfficialHolidays(file({ 2026: { days: days(60) } }))?.[2026].days).toHaveLength(60);
    expect(parseOfficialHolidays(file({ 2026: { days: days(61) } }))).toBeNull();
  });
});
