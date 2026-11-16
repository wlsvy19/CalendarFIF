import { expect, it } from 'vitest';
import { TERM_NAMES, seasonNames, solarTermDates } from './solarTerms';

const monthDays = (year: number): string[] => solarTermDates(year)!.map((d) => d.slice(5));
/** 그해 6~8월에서 복날을 찾아 '07-15 초복' 꼴로 준다. */
function bok(year: number): string[] {
  const out: string[] = [];
  for (let ms = Date.UTC(year, 5, 1); ms < Date.UTC(year, 8, 1); ms += 86_400_000) {
    const key = new Date(ms).toISOString().slice(0, 10);
    const name = seasonNames(key).find((n) => n.endsWith('복'));
    if (name) out.push(`${key.slice(5)} ${name}`);
  }
  return out;
}

it('24절기의 이름은 소한부터 동지까지 스물넷이다', () => {
  expect([TERM_NAMES.length, TERM_NAMES[0], TERM_NAMES[2], TERM_NAMES[11], TERM_NAMES[23]]).toEqual([24, '소한', '입춘', '하지', '동지']);
});

it('2025~2027년의 24절기는 한국천문연구원 달력자료의 날짜와 같다', () => {
  expect(monthDays(2025)).toEqual([
    '01-05', '01-20', '02-03', '02-18', '03-05', '03-20', '04-04', '04-20', '05-05', '05-21', '06-05', '06-21',
    '07-07', '07-22', '08-07', '08-23', '09-07', '09-23', '10-08', '10-23', '11-07', '11-22', '12-07', '12-22',
  ]);
  expect(monthDays(2026)).toEqual([
    '01-05', '01-20', '02-04', '02-19', '03-05', '03-20', '04-05', '04-20', '05-05', '05-21', '06-06', '06-21',
    '07-07', '07-23', '08-07', '08-23', '09-07', '09-23', '10-08', '10-23', '11-07', '11-22', '12-07', '12-22',
  ]);
  expect(monthDays(2027)).toEqual([
    '01-05', '01-20', '02-04', '02-19', '03-06', '03-21', '04-05', '04-20', '05-06', '05-21', '06-06', '06-21',
    '07-07', '07-23', '08-08', '08-23', '09-08', '09-23', '10-08', '10-24', '11-08', '11-22', '12-07', '12-22',
  ]);
});

it('한국 시각의 날짜다: 자정 가까이의 절기와, 중국 달력과 하루 다른 절기', () => {
  // 2021년 입춘은 2월 3일 23시 59분이었다(한국천문연구원 달력자료). 2019년 소설은 계산으로 11월 22일 23시 58분 52초다.
  expect([seasonNames('2021-02-03'), seasonNames('2021-02-04'), seasonNames('2019-11-22')]).toEqual([['입춘'], [], ['소설']]);
  // 2026년 우수는 한국 시각 2월 19일 0시 52분이다. 중국 시각으로는 18일이다.
  expect([seasonNames('2026-02-18'), seasonNames('2026-02-19')]).toEqual([[], ['우수']]);
  // 1979년 대한은 한국 시각 1월 21일 1시 0분이다.
  expect(seasonNames('1979-01-21')).toEqual(['대한']);
});

it('그날의 이름: 절기가 아닌 날은 비어 있다', () => {
  expect([seasonNames('2026-11-07'), seasonNames('2026-11-08'), seasonNames('2026-12-22'), seasonNames('2026-12-25')]).toEqual([['입동'], [], ['동지'], []]);
});

it('삼복: 초복은 하지부터 세 번째 경일, 중복은 네 번째 경일, 말복은 입추부터 첫 번째 경일이다', () => {
  expect(bok(2020)).toEqual(['07-16 초복', '07-26 중복', '08-15 말복']);
  expect(bok(2024)).toEqual(['07-15 초복', '07-25 중복', '08-14 말복']);
  expect(bok(2025)).toEqual(['07-20 초복', '07-30 중복', '08-09 말복']);
  expect(bok(2026)).toEqual(['07-15 초복', '07-25 중복', '08-14 말복']);
  // 하지(6월 21일)가 경일이면 그날부터 센다: 2021년과 2023년의 초복은 7월 11일이다.
  expect([bok(2021), bok(2023)]).toEqual([['07-11 초복', '07-21 중복', '08-10 말복'], ['07-11 초복', '07-21 중복', '08-10 말복']]);
});

it('1970년 앞의 해도 일진이 맞다: 1900-01-01이 갑술일이라는 기준에서 손으로 센 복날과 같다', () => {
  // 1900-01-01(갑술일)에서 1950-06-22(하지)까지 18,434일이라 그날은 무(戊)일이고, 이틀 뒤 6월 24일이 첫 경일이다.
  // 세 번째 경일은 7월 14일, 네 번째는 7월 24일이다. 입추(8월 8일)는 을(乙)일이라 닷새 뒤 8월 13일이 말복이다.
  expect([solarTermDates(1950)![11], solarTermDates(1950)![14]]).toEqual(['1950-06-22', '1950-08-08']);
  expect(bok(1950)).toEqual(['07-14 초복', '07-24 중복', '08-13 말복']);
  // 1900년: 하지 6월 22일은 1900-01-01에서 172일 뒤라 병(丙)일이고, 나흘 뒤 6월 26일이 첫 경일이다. 입추 8월 8일은 계(癸)일이다.
  expect([solarTermDates(1900)![11], solarTermDates(1900)![14]]).toEqual(['1900-06-22', '1900-08-08']);
  expect(bok(1900)).toEqual(['07-16 초복', '07-26 중복', '08-15 말복']);
});

it('절기와 복날이 겹치면 절기가 앞이다', () => {
  // 2012년과 2014년은 입추(8월 7일)가 경일이라 그날이 말복이고, 2013년은 중복이 대서와 같은 날이다.
  expect([seasonNames('2012-08-07'), seasonNames('2014-08-07'), seasonNames('2013-07-23')]).toEqual([['입추', '말복'], ['입추', '말복'], ['대서', '중복']]);
  expect([bok(2012), bok(2013)]).toEqual([['07-18 초복', '07-28 중복', '08-07 말복'], ['07-13 초복', '07-23 중복', '08-12 말복']]);
});

it('1900년부터 2100년까지 해마다 절기 스물넷이 제 달에 차례로 있고, 중복 뒤 말복은 10일이나 20일 뒤다', () => {
  for (let year = 1900; year <= 2100; year += 1) {
    const dates = solarTermDates(year)!;
    expect(dates).toHaveLength(24);
    dates.forEach((d, i) => {
      expect(Number(d.slice(5, 7))).toBe((i >> 1) + 1);
      expect(seasonNames(d)[0]).toBe(TERM_NAMES[i]);
      if (i > 0) expect(d > dates[i - 1]).toBe(true);
    });
    const days = bok(year).map((b) => Date.UTC(year, Number(b.slice(0, 2)) - 1, Number(b.slice(3, 5))) / 86_400_000);
    expect(bok(year).map((b) => b.slice(6))).toEqual(['초복', '중복', '말복']);
    expect(days[1] - days[0]).toBe(10);
    expect([10, 20]).toContain(days[2] - days[1]);
  }
  // 2092년(달력에서 고르는 마지막 쪽의 첫 해)과 2100년에도 나온다.
  expect([seasonNames('2092-02-04'), seasonNames('2100-12-22'), bok(2092).length]).toEqual([['입춘'], ['동지'], 3]);
});

it('표 밖의 해와 날짜가 아닌 글은 비어 있다', () => {
  expect([solarTermDates(1899), solarTermDates(2101), solarTermDates(2026.5)]).toEqual([null, null, null]);
  expect([solarTermDates(1900)![0], solarTermDates(2100)![23]]).toEqual(['1900-01-06', '2100-12-22']);
  for (const key of ['1899-12-22', '2101-01-05', '2026-02-30', '2026-13-01', '', '날짜아님', '2026-11-7']) expect(seasonNames(key)).toEqual([]);
});
