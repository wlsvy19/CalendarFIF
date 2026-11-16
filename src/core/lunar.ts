/**
 * 한국 음력. 표로만 계산한다. 양력 1900-01-31(음력 1900년 1월 1일)부터 2100-12-31까지다.
 *
 * 2050년까지는 한국천문연구원 자료이고, 2051~2100년은 같은 규칙으로 계산한 것이다(scripts/make-lunar.ts: 달의 첫날은 삭이 든 날,
 * 동지가 든 달이 11월, 달이 열셋인 해는 중기가 없는 첫 달이 윤달, 시간대는 UTC+9). 같은 계산으로 1912~2050년을 다시 만들면
 * 139해가 모두 한국천문연구원 자료와 같고(1903, 1904, 1905, 1907, 1908, 1909, 1911년은 다르다. 그때는 표준시가 달랐다), UTC+8로 계산하면
 * 홍콩천문대의 1901~2100년 대조표와 달 2,474개 가운데 3개(1914, 1916, 1920년)만 다르다.
 * 2051년부터는 지구 자전이 얼마나 느려질지 몰라서 삭이 자정에서 몇 분 안에 드는 달은 첫날이 하루 다를 수 있다
 * (2051년 음력 10월, 2052년 9월, 2071년 3월, 2074년 7월, 2092년 1월, 2096년 12월). 한국천문연구원이 그해의 자료를 내면 그것이 맞다.
 *
 * 브라우저의 음력 계산(Intl의 dangi)은 쓰지 않는다. 기기마다 결과가 다를 수 있고(아이폰 Safari, Scriptable, PC 앱),
 * 한국천문연구원 자료와 다른 날이 있다(2017-02-26~03-27을 한 달 늦게 본다).
 */
export type LunarDate = { year: number; month: number; day: number; leap: boolean };

const FIRST_YEAR = 1900;
const DAY_MS = 86_400_000;
const FIRST_DAY = Date.UTC(1900, 0, 31) / DAY_MS; // 음력 1900년 1월 1일
const LAST_DAY = Date.UTC(2100, 11, 31) / DAY_MS; // 달력에서 고를 수 있는 마지막 날. 한국천문연구원 자료는 2050-12-31까지다

// 해마다 네 글자(36진수, 17비트). 0~11번 비트는 1~12월의 크기(1월이 11번 비트, 1이면 30일, 0이면 29일),
// 12~15번 비트는 윤달이 붙는 달(0은 윤달 없음), 16번 비트는 윤달의 크기다.
// 출처: 1900~2050년은 공개 패키지 korean-lunar-calendar 0.4.0(MIT, Jinil Lee)의 표. 그 표는 한국천문연구원 자료를 따른다.
// 2051~2100년은 scripts/make-lunar.ts가 계산한 것이다.
// 저작권 고지는 THIRD-PARTY-NOTICES.md에 있다.
const TABLE =
  '0q7x00xa021j0gul02li02ol1sgl012i01wt07dp00xa0l0b021902lh0ii1028l012i08gq01ul0n2300wr02170i1701bd0250' +
  '0eyd00ja01uj07cn00wn0k7q02tm02w51vop014l00ja1pri01ta236502hh02mi207e0295012l1rob00gt01t908x702390or9' +
  '028a028l1vf900yj00gr1pp3010r0rdn01at01be0l4a024500xi0er2021j010n0aw602ol0ng5012i01wt0grh00xa021a0f9p' +
  '02lh0rx5028k02ne1zdm01uj00wr0eqj02170xt301b901ck0l8500ja01uj0gqf00wn018r0ax602w50qmx014d00ja0hny01ta' +
  '02hi0fit02mi02p107rp012k0o8r00gt01t90iaz0239028a1qa2028l0ti500xm021n0guv010r02390exh01be025107n900xi' +
  '0l0u021j010n0h4602oj014a0bqi01v10zov00xa0219203x02lh02mq0ij8029601v107dn00wr0o5z021702791wkl01ck0256' +
  '1prq' +
  // 2051~2100년(계산)
  '01uf24rb00wn018r1ytm02w501bm1tbg024601tj0ai602hi0or902mi02p10gyd012i023x0ehp01t90rrv0239028a0l7u0251' +
  '01220ere021n010r0bor02370nkl01be02511vat00xi021j0dov010m0s5y02mr014a1zmy01v100xa0er1021902li0ch102mq';

const monthDays = (bits: number, month: number): number => ((bits >> (12 - month)) & 1 ? 30 : 29);
const leapMonthOf = (bits: number): number => (bits >> 12) & 15;
const leapDays = (bits: number): number => ((bits >> 16) & 1 ? 30 : 29);

// 표는 처음 쓸 때 한 번 푼다. years[i]는 음력 (1900+i)년의 비트, starts[i]는 그해 1월 1일의 날 번호(1970-01-01이 0).
let table: { years: number[]; starts: number[] } | null = null;
function load(): { years: number[]; starts: number[] } {
  if (table) return table;
  const years: number[] = [];
  const starts: number[] = [];
  let cursor = FIRST_DAY;
  for (let i = 0; i < TABLE.length; i += 4) {
    const bits = parseInt(TABLE.slice(i, i + 4), 36);
    years.push(bits);
    starts.push(cursor);
    for (let m = 1; m <= 12; m += 1) cursor += monthDays(bits, m);
    if (leapMonthOf(bits) !== 0) cursor += leapDays(bits);
  }
  table = { years, starts };
  return table;
}

/** 'YYYY-MM-DD'의 날 번호. 날짜가 아니면 null. */
function dayNumber(dateKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ms / DAY_MS;
}

/** 양력 날짜의 음력 날짜. 표 밖이거나 날짜가 아니면 null. */
export function lunarDate(dateKey: string): LunarDate | null {
  const dayNo = dayNumber(dateKey);
  if (dayNo === null || dayNo < FIRST_DAY || dayNo > LAST_DAY) return null;
  const { years, starts } = load();
  // 음력 해는 같은 양력 해의 1월 하순~2월에 시작한다. 그 전이면 지난 음력 해다.
  let i = Number(dateKey.slice(0, 4)) - FIRST_YEAR;
  if (starts[i] > dayNo) i -= 1;
  const bits = years[i];
  const leapMonth = leapMonthOf(bits);
  let rest = dayNo - starts[i];
  for (let month = 1; month <= 12; month += 1) {
    const days = monthDays(bits, month);
    if (rest < days) return { year: FIRST_YEAR + i, month, day: rest + 1, leap: false };
    rest -= days;
    if (leapMonth === month) {
      const extra = leapDays(bits);
      if (rest < extra) return { year: FIRST_YEAR + i, month, day: rest + 1, leap: true };
      rest -= extra;
    }
  }
  return null;
}

const monthText = (l: LunarDate): string => `${l.leap ? '윤' : ''}${l.month}`;

/** 칸에 적는 짧은 음력: '10.5', 윤달은 '윤6.1'. 표 밖이면 빈 글. */
export function lunarShort(dateKey: string): string {
  const l = lunarDate(dateKey);
  return l ? `${monthText(l)}.${l.day}` : '';
}

/** PC 앱의 칸에 적는 음력: '음 10.5'. 표 밖이면 빈 글. */
export function lunarLabel(dateKey: string): string {
  const short = lunarShort(dateKey);
  return short === '' ? '' : `음 ${short}`;
}

/** 풀어 쓴 음력: '음력 10월 5일', 윤달은 '음력 윤6월 1일'. 표 밖이면 빈 글. */
export function lunarLong(dateKey: string): string {
  const l = lunarDate(dateKey);
  return l ? `음력 ${monthText(l)}월 ${l.day}일` : '';
}

/** 음력 year년 month월 day일의 양력 날짜. leap은 윤달인지다. 표 밖이거나 그런 날이 없으면 null. */
export function solarOfLunar(year: number, month: number, day: number, leap = false): string | null {
  const { years, starts } = load();
  const bits = years[year - FIRST_YEAR];
  if (bits === undefined || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return null;
  const leapMonth = leapMonthOf(bits);
  if (leap && leapMonth !== month) return null;
  if (day > (leap ? leapDays(bits) : monthDays(bits, month))) return null;
  let dayNo = starts[year - FIRST_YEAR];
  for (let m = 1; m < month; m += 1) dayNo += monthDays(bits, m) + (leapMonth === m ? leapDays(bits) : 0);
  if (leap) dayNo += monthDays(bits, month);
  dayNo += day - 1;
  return dayNo > LAST_DAY ? null : new Date(dayNo * DAY_MS).toISOString().slice(0, 10);
}
