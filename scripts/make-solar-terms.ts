// 24절기 표(src/core/solarTerms.ts의 BASE와 TABLE)를 만드는 도구. 한 번 만들어 붙여 넣는다.
//
// 절기는 태양의 겉보기 황경이 15°의 배수가 되는 순간이다. 그 순간을 구해 한국 표준시(UTC+9)의 날짜로 적는다.
//  - 지구의 위치: VSOP87D(Bretagnon & Francou, 1988)의 전체 급수. 파일은 저장소에 넣지 않았다.
//    https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.ear 를 받아 .tools/vsop87/에 두고 돌린다.
//  - FK5 보정, 장동(IAU 1980 급수의 큰 항), 광행차: Meeus, Astronomical Algorithms 2판 22장과 25장.
//  - ΔT(지구시와 세계시의 차): Espenak & Meeus의 다항식. 2005년부터는 잰 값보다 6~9초 크고 앞날은 아무도 모른다
//    (다항식은 2100년에 203초를 주는데 2026년의 실제 값은 69초에서 거의 늘지 않고 있다).
//    그래서 자정 가까이에 드는 절기는 따로 적어 낸다(2050년까지는 2분 안, 그 뒤는 4분 안). 그 날짜는 하루 다를 수 있다.
// 시간대는 모든 해에 UTC+9를 쓴다. 한국이 UTC+8:30을 쓴 1908~1911년, 1954~1961년에도 그렇다.
//
// 쓰는 법:
//   npx tsx scripts/make-solar-terms.ts                표(BASE, TABLE)와 자정 가까운 절기를 적는다
//   npx tsx scripts/make-solar-terms.ts --times 2026   그해 절기의 한국 시각을 적는다(다른 자료와 견줄 때)
//   npx tsx scripts/make-solar-terms.ts --json 8       UTC+8의 날짜를 JSON으로 적는다(홍콩천문대 표와 견줄 때)
//   npx tsx scripts/make-solar-terms.ts --instants     모든 절기의 순간을 JSON으로 적는다(한국천문연구원 달력자료의 시각과 견줄 때)
import { readFileSync } from 'node:fs';

const DATA = '.tools/vsop87/VSOP87D.ear';
const FIRST_YEAR = 1900;
const LAST_YEAR = 2100; // 달력에서 고를 수 있는 마지막 해(src/web/ui/datePick.ts의 MAX_YEAR)
const RAD = Math.PI / 180;
const ARCSEC = RAD / 3600;
const DAY_MS = 86_400_000;
const TERM_NAMES = [
  '소한', '대한', '입춘', '우수', '경칩', '춘분', '청명', '곡우', '입하', '소만', '망종', '하지',
  '소서', '대서', '입추', '처서', '백로', '추분', '한로', '상강', '입동', '소설', '대설', '동지',
];

type Term = { a: number; b: number; c: number };
type Series = Term[][]; // [τ의 차수][항]

/** VSOP87D 파일을 읽는다. 변수 1은 황경 L, 2는 황위 B, 3은 거리 R. 항은 a·cos(b + c·τ)이고 τ의 차수별로 묶여 있다. */
function readVsop(path: string): { L: Series; B: Series; R: Series } {
  const out: Series[] = [[], [], []];
  let current: Term[] | null = null;
  let expected = 0;
  const closeBlock = (): void => {
    if (current && current.length !== expected) throw new Error(`항의 수가 머리와 다르다: ${current.length} != ${expected}`);
  };
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const head = /VSOP87 VERSION D4\s+EARTH\s+VARIABLE (\d) \(LBR\)\s+\*T\*\*(\d)\s+(\d+) TERMS/.exec(line);
    if (head) {
      closeBlock();
      current = [];
      expected = Number(head[3]);
      out[Number(head[1]) - 1][Number(head[2])] = current;
      continue;
    }
    if (!current) throw new Error('머리 줄보다 먼저 항이 나왔다');
    const cols = line.trim().split(/\s+/);
    const [a, b, c] = cols.slice(-3).map(Number);
    if (![a, b, c].every(Number.isFinite)) throw new Error(`읽지 못한 줄: ${line}`);
    current.push({ a, b, c });
  }
  closeBlock();
  return { L: out[0], B: out[1], R: out[2] };
}

const sum = (series: Series, tau: number): number =>
  series.reduce((total, terms, power) => total + tau ** power * terms.reduce((s, t) => s + t.a * Math.cos(t.b + t.c * tau), 0), 0);

// 장동의 황경 성분 Δψ(IAU 1980)의 큰 항. [D, M, M', F, Ω의 배수, 계수(0.0001"), T에 비례하는 몫].
// 뺀 항을 모두 더해도 0.1"(태양이 2초 동안 가는 각)가 안 된다.
const NUTATION: [number, number, number, number, number, number, number][] = [
  [0, 0, 0, 0, 1, -171996, -174.2], [-2, 0, 0, 2, 2, -13187, -1.6], [0, 0, 0, 2, 2, -2274, -0.2], [0, 0, 0, 0, 2, 2062, 0.2],
  [0, 1, 0, 0, 0, 1426, -3.4], [0, 0, 1, 0, 0, 712, 0.1], [-2, 1, 0, 2, 2, -517, 1.2], [0, 0, 0, 2, 1, -386, -0.4],
  [0, 0, 1, 2, 2, -301, 0], [-2, -1, 0, 2, 2, 217, -0.5], [-2, 0, 1, 0, 0, -158, 0], [-2, 0, 0, 2, 1, 129, 0.1],
  [0, 0, -1, 2, 2, 123, 0], [2, 0, 0, 0, 0, 63, 0], [0, 0, 1, 0, 1, 63, 0.1], [2, 0, -1, 2, 2, -59, 0],
  [0, 0, -1, 0, 1, -58, -0.1], [0, 0, 1, 2, 1, -51, 0], [-2, 0, 2, 0, 0, 48, 0], [0, 0, -2, 2, 1, 46, 0],
];

function nutationInLongitude(T: number): number {
  const D = 297.85036 + 445267.11148 * T - 0.0019142 * T * T + (T * T * T) / 189474;
  const M = 357.52772 + 35999.05034 * T - 0.0001603 * T * T - (T * T * T) / 300000;
  const Mp = 134.96298 + 477198.867398 * T + 0.0086972 * T * T + (T * T * T) / 56250;
  const F = 93.27191 + 483202.017538 * T - 0.0036825 * T * T + (T * T * T) / 327270;
  const O = 125.04452 - 1934.136261 * T + 0.0020708 * T * T + (T * T * T) / 450000;
  let psi = 0;
  for (const [d, m, mp, f, o, coef, perT] of NUTATION) psi += (coef + perT * T) * Math.sin((d * D + m * M + mp * Mp + f * F + o * O) * RAD);
  return psi * 0.0001 * ARCSEC;
}

/** 지구시 jde(율리우스일)에서 태양의 겉보기 황경(도, 0~360). */
function apparentLongitude(vsop: { L: Series; R: Series }, jde: number): number {
  const tau = (jde - 2451545) / 365250;
  const T = tau * 10;
  const geometric = sum(vsop.L, tau) + Math.PI; // 지구에서 본 태양은 지구의 반대쪽이다
  const fk5 = -0.09033 * ARCSEC;
  const aberration = (-20.4898 * ARCSEC) / sum(vsop.R, tau);
  const deg = (geometric + fk5 + nutationInLongitude(T) + aberration) / RAD;
  return ((deg % 360) + 360) % 360;
}

/** ΔT = 지구시 - 세계시(초). Espenak & Meeus의 다항식. */
function deltaT(year: number): number {
  if (year < 1920) { const t = year - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (year < 1941) { const t = year - 1920; return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3; }
  if (year < 1961) { const t = year - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (year < 1986) { const t = year - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (year < 2005) { const t = year - 2000; return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (year < 2050) { const t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t ** 2; }
  return -20 + 32 * ((year - 1820) / 100) ** 2 - 0.5628 * (2150 - year);
}

const jdOf = (ms: number): number => ms / DAY_MS + 2440587.5;
const msOf = (jd: number): number => (jd - 2440587.5) * DAY_MS;

/** year년의 i번째 절기(0 소한 ~ 23 동지)의 순간. 세계시의 밀리초(Date의 값). */
function termInstant(vsop: { L: Series; R: Series }, year: number, i: number): number {
  const target = (285 + 15 * i) % 360;
  let jde = jdOf(Date.UTC(year, 0, 6)) + i * 15.2184;
  for (let n = 0; n < 50; n += 1) {
    const diff = ((target - apparentLongitude(vsop, jde) + 540) % 360) - 180;
    const step = (diff * 365.2422) / 360;
    jde += step;
    if (Math.abs(step) < 1e-8) break;
  }
  return msOf(jde) - deltaT(year + (i + 0.5) / 24) * 1000;
}

function main(): void {
  const vsop = readVsop(DATA);
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
