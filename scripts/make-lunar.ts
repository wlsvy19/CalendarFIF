// 음력 표(src/core/lunar.ts의 TABLE)에서 2051~2100년의 글자를 만드는 도구. 한 번 만들어 붙여 넣는다.
//
// 한국천문연구원의 음양력 자료는 2050년까지다. 그 뒤는 같은 규칙으로 계산한다(시헌력, 시간대는 UTC+9):
//  - 달의 첫날은 삭(달과 해의 황경이 같아지는 순간)이 든 날이다.
//  - 동지가 든 달이 11월이다. 한 동지 달에서 다음 동지 달 앞까지 달이 열둘이면 윤달이 없고, 열셋이면
//    그 가운데 중기(대한, 우수, 춘분, ..., 소설)가 들지 않은 첫 달이 윤달이다. 윤달은 앞 달의 이름을 받는다.
//  - 중기가 어느 달에 드는지는 순간이 아니라 날짜로 본다(달의 첫날 0시부터 다음 달의 첫날 0시 앞까지).
// 계산은 scripts/astro.ts에 있다(삭은 Meeus 49장, 중기는 절기 표와 같은 계산).
// 같은 계산으로 1900~2050년을 다시 만들어 지금의 표와 견주고, 다른 해를 적어 낸다.
// 삭이나 달 끝의 중기가 자정 가까이에 들면 달의 크기나 윤달이 달라질 수 있어서 따로 적어 낸다(2050년까지는 2분 안, 그 뒤는 4분 안).
//
// 쓰는 법:
//   npx tsx scripts/make-lunar.ts               견준 결과, 2051~2100년의 글자, 자정 가까운 삭과 중기를 적는다
//   npx tsx scripts/make-lunar.ts --year 2060   그 음력 해의 달마다 첫날과 크기를 적는다
//   npx tsx scripts/make-lunar.ts --months 8    UTC+8로 계산한 모든 달의 첫날을 JSON으로 적는다(홍콩천문대 표와 견줄 때)
import { readFileSync } from 'node:fs';
import { DAY_MS, TERM_NAMES, newMoonInstant, readVsop, termInstant } from './astro';

const FIRST_YEAR = 1900;
const KASI_LAST_YEAR = 2050;
const LAST_YEAR = 2100; // 달력에서 고를 수 있는 마지막 해(src/web/ui/datePick.ts의 MAX_YEAR)

type Moon = { ms: number; day: number }; // day: 그 시간대의 날 번호(1970-01-01이 0)
type Month = Moon & { number: number; leap: boolean };
type LunarYear = { year: number; days: number[]; leapMonth: number; leapDays: number; code: string };

const dateOf = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
const clock = (ms: number, hours: number): string => new Date(ms + hours * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
/** 그 시간대의 자정에서 몇 초 떨어졌는지. 0시 뒤면 양수, 0시 앞이면 음수다. */
function fromMidnight(ms: number, hours: number): number {
  const since = ((((ms + hours * 3_600_000) % DAY_MS) + DAY_MS) % DAY_MS) / 1000;
  return since <= 43200 ? since : since - 86400;
}

function compute(hours: number): { months: Month[]; years: LunarYear[]; near: string[]; sameDay: number } {
  const vsop = readVsop();
  const dayOf = (ms: number): number => Math.floor((ms + hours * 3_600_000) / DAY_MS);
  const limit = (day: number): number => (Number(dateOf(day).slice(0, 4)) <= KASI_LAST_YEAR ? 120 : 240);

  // 삭: 1899년 여름부터 2102년 봄까지.
  const moons: Moon[] = [];
  for (let k = Math.floor((1899.5 - 2000) * 12.3685); k <= Math.ceil((2102.3 - 2000) * 12.3685); k += 1) {
    const ms = newMoonInstant(k);
    moons.push({ ms, day: dayOf(ms) });
  }
  // 중기: 홀수 번째 절기(대한, 우수, ..., 동지).
  const zhongqi: (Moon & { name: string; year: number; i: number })[] = [];
  for (let year = FIRST_YEAR - 1; year <= LAST_YEAR + 1; year += 1) {
    for (let i = 1; i < 24; i += 2) {
      const ms = termInstant(vsop, year, i);
      zhongqi.push({ ms, day: dayOf(ms), name: TERM_NAMES[i], year, i });
    }
  }
  const solstice = (year: number): number => zhongqi.find((z) => z.year === year && z.i === 23)!.day;
  /** 그날이 든 달(그날이나 그 앞에서 가장 늦은 삭)의 번호. */
  const monthOf = (day: number): number => {
    let idx = moons.findIndex((m) => m.day > day) - 1;
    if (idx < 0) idx = moons.length - 1;
    return idx;
  };
  const hasZhongqi = (idx: number): boolean => zhongqi.some((z) => z.day >= moons[idx].day && z.day < moons[idx + 1].day);

  // 동지 달에서 다음 동지 달 앞까지 이름을 붙인다.
  const names = new Map<number, { number: number; leap: boolean }>();
  for (let year = FIRST_YEAR; year <= LAST_YEAR + 1; year += 1) {
    const first = monthOf(solstice(year - 1));
    const next = monthOf(solstice(year));
    const count = next - first;
    if (count !== 12 && count !== 13) throw new Error(`${year}년: 동지 달 사이의 달이 ${count}개다`);
    let number = 11;
    let leapUsed = count === 12;
    names.set(first, { number, leap: false });
    for (let idx = first + 1; idx < next; idx += 1) {
      if (!leapUsed && !hasZhongqi(idx)) {
        leapUsed = true;
        names.set(idx, { number, leap: true });
      } else {
        number = (number % 12) + 1;
        names.set(idx, { number, leap: false });
      }
    }
    if (count === 13 && !leapUsed) throw new Error(`${year}년: 달이 열셋인데 중기 없는 달이 없다`);
    if (number !== 10) throw new Error(`${year}년: 동지 달 앞의 달이 10월이 아니다(${number}월)`);
  }
  const months: Month[] = [...names.entries()].sort((a, b) => a[0] - b[0]).map(([idx, n]) => ({ ...moons[idx], ...n }));

  // 음력 해마다: 1월부터 다음 1월 앞까지.
  const years: LunarYear[] = [];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
    const start = months.findIndex((m) => m.number === 1 && !m.leap && dateOf(m.day).startsWith(String(year)));
    if (start < 0) throw new Error(`${year}년의 음력 1월을 찾지 못했다`);
    const days: number[] = [];
    let leapMonth = 0;
    let leapDays = 0;
    for (let idx = start; idx === start || !(months[idx].number === 1 && !months[idx].leap); idx += 1) {
      const m = months[idx];
      const next = months[idx + 1];
      if (!next) throw new Error(`${year}년: 달이 모자란다`);
      const length = next.day - m.day;
      if (length !== 29 && length !== 30) throw new Error(`${year}년 ${m.number}월의 크기가 ${length}일이다`);
      if (m.leap) { leapMonth = m.number; leapDays = length; } else { days.push(length); }
    }
    if (days.length !== 12) throw new Error(`${year}년: 평달이 ${days.length}개다`);
    // lunar.ts의 꼴: 0~11번 비트는 1~12월의 크기(1월이 11번 비트, 1이면 30일), 12~15번은 윤달이 붙는 달, 16번은 윤달의 크기.
    let bits = 0;
    days.forEach((d, n) => { if (d === 30) bits |= 1 << (11 - n); });
    bits |= leapMonth << 12;
    if (leapDays === 30) bits |= 1 << 16;
    years.push({ year, days, leapMonth, leapDays, code: bits.toString(36).padStart(4, '0') });
  }

  // 날짜가 하루 달라질 수 있는 곳.
  const near: string[] = [];
  for (const m of months) {
    const gap = fromMidnight(m.ms, hours);
    if (Math.abs(gap) < limit(m.day)) near.push(`삭 ${clock(m.ms, hours)} (${m.leap ? '윤' : ''}${m.number}월의 첫날, 자정에서 ${gap.toFixed(0)}초)`);
  }
  let sameDay = 0;
  for (const z of zhongqi) {
    const idx = monthOf(z.day);
    if (z.day === moons[idx].day) sameDay += 1;
    const gap = fromMidnight(z.ms, hours);
    const first = z.day === moons[idx].day && gap >= 0; // 0시 조금 뒤: 하루 이르면 앞 달에 든다
    const last = idx + 1 < moons.length && z.day === moons[idx + 1].day - 1 && gap < 0; // 0시 조금 앞: 하루 늦으면 다음 달에 든다
    if ((first || last) && Math.abs(gap) < limit(z.day)) near.push(`중기 ${z.name} ${clock(z.ms, hours)} (달의 ${first ? '첫날' : '끝 날'}, 자정에서 ${gap.toFixed(0)}초)`);
  }
  return { months, years, near, sameDay };
}

function describe(y: { days: number[]; leapMonth: number; leapDays: number }): string {
  return `${y.days.map((d) => (d === 30 ? '대' : '소')).join('')}${y.leapMonth ? ` 윤${y.leapMonth}월(${y.leapDays})` : ''}`;
}
function decode(code: string): { days: number[]; leapMonth: number; leapDays: number } {
  const bits = parseInt(code, 36);
  const leapMonth = (bits >> 12) & 15;
  return { days: Array.from({ length: 12 }, (_, n) => ((bits >> (11 - n)) & 1 ? 30 : 29)), leapMonth, leapDays: leapMonth ? ((bits >> 16) & 1 ? 30 : 29) : 0 };
}
/** src/core/lunar.ts에 지금 들어 있는 표의 글자. */
function currentTable(): string {
  const source = readFileSync('src/core/lunar.ts', 'utf8');
  const block = /const TABLE =([\s\S]*?);/.exec(source);
  if (!block) throw new Error('lunar.ts에서 TABLE을 찾지 못했다');
  return [...block[1].matchAll(/'([0-9a-z]+)'/g)].map((m) => m[1]).join('');
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === '--months') {
    const { months } = compute(Number(args[1]));
    console.log(JSON.stringify(months.map((m) => [dateOf(m.day), m.number, m.leap])));
    return;
  }
  const { months, years, near, sameDay } = compute(9);
  if (args[0] === '--year') {
    const year = Number(args[1]);
    const start = months.findIndex((m) => m.number === 1 && !m.leap && dateOf(m.day).startsWith(String(year)));
    for (let idx = start; idx === start || !(months[idx].number === 1 && !months[idx].leap); idx += 1) {
      const m = months[idx];
      console.log(`${m.leap ? '윤' : ''}${m.number}월 ${dateOf(m.day)} ${months[idx + 1].day - m.day}일 (삭 ${clock(m.ms, 9)})`);
    }
    return;
  }

  const table = currentTable();
  const diffs: string[] = [];
  for (const y of years.filter((x) => x.year <= KASI_LAST_YEAR)) {
    const old = table.slice((y.year - FIRST_YEAR) * 4, (y.year - FIRST_YEAR) * 4 + 4);
    if (old !== y.code) diffs.push(`${y.year}: 표 ${describe(decode(old))} / 계산 ${describe(y)}`);
  }
  console.log(`// ${FIRST_YEAR}~${KASI_LAST_YEAR}년을 다시 계산해 지금의 표와 견줌: ${KASI_LAST_YEAR - FIRST_YEAR + 1}해 가운데 다른 해 ${diffs.length}개`);
  for (const d of diffs) console.log(`//   ${d}`);
  const added = years.filter((y) => y.year > KASI_LAST_YEAR).map((y) => y.code).join('');
  console.log(`\n// ${KASI_LAST_YEAR + 1}~${LAST_YEAR}년(계산), 글자 ${added.length}개:`);
  for (const chunk of added.match(/.{1,100}/g) ?? []) console.log(`  '${chunk}' +`);
  console.log(`\n// 중기와 삭이 같은 날인 것: ${sameDay}번(그 중기는 그날 시작하는 달에 든다)`);
  console.log(`// 자정 가까이에 드는 삭과 달 끝의 중기(2050년까지는 2분 안, 그 뒤는 4분 안) ${near.length}개:`);
  for (const line of near) console.log(`//   ${line}`);
}

main();
