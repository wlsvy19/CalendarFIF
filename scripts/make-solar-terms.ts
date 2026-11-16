// 24절기 표(src/core/solarTerms.ts의 BASE와 TABLE)를 만드는 도구. 한 번 만들어 붙여 넣는다.
//
// 절기는 태양의 겉보기 황경이 15°의 배수가 되는 순간이다. 그 순간을 구해 한국 표준시(UTC+9)의 날짜로 적는다.
// 계산은 scripts/astro.ts에 있다(쓰는 자료와 정확도도 그 파일의 머리에 있다).
// 앞날의 ΔT를 모르므로 자정 가까이에 드는 절기는 따로 적어 낸다(2050년까지는 2분 안, 그 뒤는 4분 안). 그 날짜는 하루 다를 수 있다.
// 시간대는 모든 해에 UTC+9를 쓴다. 한국이 UTC+8:30을 쓴 1908~1911년, 1954~1961년에도 그렇다.
//
// 쓰는 법:
//   npx tsx scripts/make-solar-terms.ts                표(BASE, TABLE)와 자정 가까운 절기를 적는다
//   npx tsx scripts/make-solar-terms.ts --times 2026   그해 절기의 한국 시각을 적는다(다른 자료와 견줄 때)
//   npx tsx scripts/make-solar-terms.ts --json 8       UTC+8의 날짜를 JSON으로 적는다(홍콩천문대 표와 견줄 때)
//   npx tsx scripts/make-solar-terms.ts --instants     모든 절기의 순간을 JSON으로 적는다(한국천문연구원 달력자료의 시각과 견줄 때)
//   npx tsx scripts/make-solar-terms.ts --check        책의 예제(Meeus 25.b)와 견준다
import { DAY_MS, TERM_NAMES, apparentLongitude, readVsop, termInstant } from './astro';

const FIRST_YEAR = 1900;
const LAST_YEAR = 2100; // 달력에서 고를 수 있는 마지막 해(src/web/ui/datePick.ts의 MAX_YEAR)

function main(): void {
  const vsop = readVsop();
  const args = process.argv.slice(2);
  const hours = args[0] === '--json' ? Number(args[1]) : 9;
  const local = (ms: number): Date => new Date(ms + hours * 3_600_000);

  if (args[0] === '--check') {
    // Meeus 25.b: 1992-10-13 0시(지구시)의 겉보기 황경은 199°54'21.818"(199.906061°)이다.
    console.log('Meeus 25.b:', apparentLongitude(vsop, 2448908.5).toFixed(6), '(책: 199.906061)');
    return;
  }
  if (args[0] === '--instants') {
    // 모든 해의 절기 순간(세계시 밀리초). 다른 자료의 시각과 견줄 때 쓴다.
    const all: Record<number, number[]> = {};
    for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) all[year] = TERM_NAMES.map((_, i) => Math.round(termInstant(vsop, year, i)));
    console.log(JSON.stringify(all));
    return;
  }
  if (args[0] === '--times') {
    const year = Number(args[1]);
    for (let i = 0; i < 24; i += 1) console.log(TERM_NAMES[i], new Date(termInstant(vsop, year, i) + 9 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19), 'KST');
    return;
  }

  const days: number[][] = [];
  const near: string[] = [];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
    const row: number[] = [];
    for (let i = 0; i < 24; i += 1) {
      const at = local(termInstant(vsop, year, i));
      if (at.getUTCFullYear() !== year || at.getUTCMonth() !== i >> 1) throw new Error(`${year}년 ${TERM_NAMES[i]}이 제 달에 없다: ${at.toISOString()}`);
      row.push(at.getUTCDate());
      const sinceMidnight = (((at.getTime() % DAY_MS) + DAY_MS) % DAY_MS) / 1000; // 1970년 앞은 나머지가 음수다
      const gap = Math.min(sinceMidnight, 86400 - sinceMidnight);
      if (gap < (year <= 2050 ? 120 : 240)) near.push(`${year} ${TERM_NAMES[i]} ${at.toISOString().replace('T', ' ').slice(0, 19)} (자정에서 ${gap.toFixed(0)}초)`);
    }
    days.push(row);
  }

  if (args[0] === '--json') {
    console.log(JSON.stringify(Object.fromEntries(days.map((row, n) => [FIRST_YEAR + n, row]))));
    return;
  }

  // 절기마다 가장 이른 날을 바닥으로 삼고, 해마다 바닥에서 며칠 뒤인지(0~3)를 두 비트로 적는다. 두 절기가 16진수 한 글자다.
  const base = Array.from({ length: 24 }, (_, i) => Math.min(...days.map((row) => row[i])));
  let table = '';
  for (const row of days) {
    for (let i = 0; i < 24; i += 2) {
      const [hi, lo] = [row[i] - base[i], row[i + 1] - base[i + 1]];
      if (hi > 3 || lo > 3) throw new Error('바닥에서 3일 넘게 떨어진 절기가 있다');
      table += ((hi << 2) | lo).toString(16);
    }
  }
  console.log(`const BASE = [${base.join(', ')}];`);
  console.log('const TABLE =');
  const chunks = table.match(/.{1,96}/g) ?? [];
  console.log(chunks.map((c, n) => `  '${c}'${n === chunks.length - 1 ? ';' : ' +'}`).join('\n'));
  console.log(`\n// ${FIRST_YEAR}~${LAST_YEAR}년, ${days.length}해, 글자 ${table.length}개`);
  console.log(`// 자정 가까이에 드는 절기(2050년까지는 2분 안, 그 뒤는 4분 안) ${near.length}개:`);
  for (const line of near) console.log(`//   ${line}`);
}

main();
