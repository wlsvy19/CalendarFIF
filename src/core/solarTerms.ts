/**
 * 24절기와 삼복(초복, 중복, 말복). 표로만 계산한다. 1900년부터 2100년까지다(달력에서 고를 수 있는 해 전부. 음력 표는 2050년까지다).
 *
 * 절기는 태양의 겉보기 황경이 15°의 배수가 되는 순간이 든 날이다. 한국 표준시(UTC+9)의 날짜로 적었다. 그래서 중국 달력(UTC+8)과
 * 하루 다른 날이 있다(2026년 우수는 한국 2월 19일, 중국 2월 18일). 표는 scripts/make-solar-terms.ts가 계산해 만들었다
 * (지구의 위치는 VSOP87D의 전체 급수). 한국천문연구원 달력자료의 2023~2028년 절기 144개와 날짜가 모두 같고 시각도 1분 안에서
 * 같다. 같은 계산을 UTC+8로 해서 홍콩천문대의 1901~2100년 대조표와 견주면 4,800개 가운데
 * 4,794개가 같고, 다른 6개(1912, 1913, 1917, 1927, 1928, 1979년)는 모두 그 순간이 UTC+8의 자정에서 12분 안이다.
 *
 * 하루 다를 수 있는 날: 한국 시각으로 자정에서 30초 안에 드는 절기가 셋 있다. 1917년 추분(9월 24일 0시 0분 11초),
 * 2030년 우수(2월 18일 23시 59분 46초), 2095년 동지(12월 22일 0시 0분 29초). 2051년부터는 지구 자전이 얼마나 느려질지 몰라서
 * 순간이 1~2분 다를 수 있고, 자정에서 4분 안에 드는 2053년 대한, 2064년 입동, 2074년 추분, 2097년 입동도 그렇다.
 * 한국천문연구원이 그해의 월력요항을 내면 그것이 맞다.
 *
 * 삼복은 절기와 일진으로 정한다: 초복은 하지부터 세 번째 경일(庚日), 중복은 네 번째 경일, 말복은 입추부터 첫 번째 경일이다.
 * 하지나 입추가 경일이면 그날부터 센다.
 */
export const TERM_NAMES = [
  '소한', '대한', '입춘', '우수', '경칩', '춘분', '청명', '곡우', '입하', '소만', '망종', '하지',
  '소서', '대서', '입추', '처서', '백로', '추분', '한로', '상강', '입동', '소설', '대설', '동지',
] as const;

const FIRST_YEAR = 1900;
const LAST_YEAR = 2100; // 달력에서 고를 수 있는 마지막 해(src/web/ui/datePick.ts의 MAX_YEAR)
const DAY_MS = 86_400_000;
const SUMMER_SOLSTICE = 11; // 하지
const START_OF_AUTUMN = 14; // 입추

// 절기마다 표에서 가장 이른 날(소한 4일, 대한 19일, 입춘 3일, ...). i번째 절기는 (i / 2)번째 달에 있다.
const BASE = [4, 19, 3, 18, 4, 19, 4, 19, 4, 20, 4, 20, 6, 22, 6, 22, 6, 22, 7, 22, 6, 21, 6, 21];
// 해마다 열두 글자(16진수). 한 글자에 그달의 두 절기가 들어 있다: 위 두 비트는 첫 절기가, 아래 두 비트는 둘째 절기가
// BASE의 날에서 며칠 뒤인지(0~3)다.
const TABLE =
  '95a59a9a9aa5a5a6aa9aaaa9a9aaaeaaaaaaaafaefaeeaaaeaa59a599aa5a5a6aa9aaaa9a9aaaeaaaaaaaafaeeaeeaaa' +
  'eaa59a599aa5a5a6aa9aaaa9a9aaaaaaaaaaaafaeeaeeaaaeaa59a599aa5a5a6aa9aaaa9a9aaaaaaaaaaaafaeeaeeaaa' +
  'eaa59a599a9595a6aa9aaaa9a5a6aaaaaaaaaafaaeaaeaaaaaa59a59969595a6aa9a9aa9a5a6aaaaaaa9aabaaeaaeaaa' +
  'aaa59a59969595a59a9a9aa5a5a6aaaaaaa9aaaaaeaaeaaaaaa59a59969595a59a9a9aa5a5a6aa9aaaa9a9aaaeaaeaaa' +
  'aaa59a59965595a59a599aa5a5a6aa9aaaa9a9aaaeaaaaaaaaa59959955595a59a599aa5a5a6aa9aaaa9a9aaaaaaaaaa' +
  'aaa59959955595a59a599aa5a5a6aa9aaaa9a9aaaaaaaaaaaaa59959955595a59a599aa5a5a6aa9aaaa9a9aaaaaaaaaa' +
  'aaa55959955595a59a599aa595a6aa9a9aa9a9a6aaaaaaaaaaa55955955595a59a59969595a69a9a9aa9a5a6aaaaaaaa' +
  'aa655955955555a59a59969595a59a9a9aa5a5a6aa9aaaa9aa555955955555a59a59969595a59a5a9aa5a5a6aa9aaaa9' +
  'a9555955555555a59959969595a59a599aa5a5a6aa9aaaa9a9555955555555a59959955595a59a599aa5a5a6aa9aaaa9' +
  'a9555555555555a59959955595a59a599aa5a5a6aa9aaaa9a9555555555555a59959955595a59a599aa5a5a6aa9aaaa9' +
  'a9555555555555a55955955595a59a599aa5a5a6aa9a9aa9a9515555555555a55955955595a59a59969595a59a9a9aa9' +
  'a5515545555555655955955555a59a59969595a59a5a9aa5a5515545555455555955955555a59959969595a59a599aa5' +
  'a5515545555454555955555555a59959959595a59a599aa5a5515545555454555555555555a59959955595a59a599aa5' +
  'a5515545555454555555555555a59959955595a59a599aa5a5515545555454555555555555a55955955595a59a599aa5' +
  'a5515545455454555555555555a55955955595a59a5996a5a5514545455454515555555555a55955955595a59a599695' +
  '95504545455450515545555555655955955595a59959969595504504455450515545555555555955555555a599599695' +
  '95504504455050515545555454555555555555a59959959595504504455050515545555454555555555555a599599555' +
  '95504504455050515545555454555555555555a59959955595504504455050515545555454555555555555a559559555' +
  '95504504455050514545455454515555555555a55955955595504504415050514545455454515545555555a559559555' +
  '955045044140405045054554545155455555556559559555955044044140405045044554505155455555555559555555' +
  '555044044140405045044550505155455554555555555555555044044040405045044550505155455554545555555555' +
  '555044044000405045044550505155455554545555555555555004004000405045044550505155455554545555555555' +
  '555004004000405045044550505145454554545155455555555004004000405045044150505045054554545155455555' +
  '555004004000405044044140505045044554545155455555551004000000405044044140405045044554505155455555' +
  '550000000000005044044140405045044554505155455555550000000000005044044040405045044550505155455554' +
  '545555555555';

/** year년 i번째 절기(0 소한 ~ 23 동지)의 날(1~31). 표 안의 해에만 부른다. */
function termDay(year: number, i: number): number {
  const digit = parseInt(TABLE[(year - FIRST_YEAR) * 12 + (i >> 1)], 16);
  return BASE[i] + (i % 2 === 0 ? digit >> 2 : digit & 3);
}

const inTable = (year: number): boolean => Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR;
const two = (n: number): string => String(n).padStart(2, '0');

/** 날 번호(1970-01-01이 0)부터 처음 오는 경일(庚日)의 날 번호. 1970-01-01이 신사(辛巳)일이라 경일은 10으로 나눈 나머지가 9다. */
function firstGeng(dayNo: number): number {
  return dayNo + ((((9 - dayNo) % 10) + 10) % 10);
}

// 해마다 처음 물을 때 한 번 만든다. 'MM-DD' → 그날의 이름들(절기가 앞, 복날이 뒤).
const cache = new Map<number, Map<string, string[]>>();
function namesOf(year: number): Map<string, string[]> | null {
  if (!inTable(year)) return null;
  let names = cache.get(year);
  if (names) return names;
  names = new Map();
  const add = (monthDay: string, name: string): void => {
    const list = names!.get(monthDay);
    if (list) list.push(name);
    else names!.set(monthDay, [name]);
  };
  for (let i = 0; i < 24; i += 1) add(`${two((i >> 1) + 1)}-${two(termDay(year, i))}`, TERM_NAMES[i]);
  const dayNoOf = (i: number): number => Date.UTC(year, i >> 1, termDay(year, i)) / DAY_MS;
  const third = firstGeng(dayNoOf(SUMMER_SOLSTICE)) + 20;
  for (const [dayNo, name] of [[third, '초복'], [third + 10, '중복'], [firstGeng(dayNoOf(START_OF_AUTUMN)), '말복']] as const) {
    add(new Date(dayNo * DAY_MS).toISOString().slice(5, 10), name);
  }
  cache.set(year, names);
  return names;
}

/** year년 24절기의 날짜('YYYY-MM-DD' 24개, 소한부터 동지까지). 표 밖이면 null. */
export function solarTermDates(year: number): string[] | null {
  if (!inTable(year)) return null;
  return TERM_NAMES.map((_, i) => `${year}-${two((i >> 1) + 1)}-${two(termDay(year, i))}`);
}

/** 그날의 절기와 복날 이름. 없거나 표 밖이거나 날짜가 아니면 빈 배열. 둘 다이면 절기가 앞이다(['입추', '말복']). */
export function seasonNames(dateKey: string): readonly string[] {
  const m = /^(\d{4})-(\d{2}-\d{2})$/.exec(dateKey);
  if (!m) return NONE;
  return namesOf(Number(m[1]))?.get(m[2]) ?? NONE;
}
const NONE: readonly string[] = [];
