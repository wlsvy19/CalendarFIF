// 절기 표와 음력 표를 만드는 도구(make-solar-terms.ts, make-lunar.ts)가 같이 쓰는 천문 계산. 앱에는 들어가지 않는다.
//
//  - 태양의 겉보기 황경: 지구의 위치는 VSOP87D(Bretagnon & Francou, 1988)의 전체 급수, FK5 보정과 장동(IAU 1980 급수의 큰 항)과
//    광행차는 Meeus, Astronomical Algorithms 2판 22장과 25장.
//    VSOP87D 파일은 저장소에 넣지 않았다. https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.ear 를 받아 .tools/vsop87/에 둔다.
//  - 삭(달과 해의 황경이 같아지는 순간): Meeus 49장의 식. 책은 1980~2020년에 평균 4초, 가장 크게 17초 틀린다고 적었다.
//  - ΔT(지구시와 세계시의 차): Espenak & Meeus의 다항식. 2005년부터는 잰 값보다 6~9초 크고 앞날은 아무도 모른다
//    (다항식은 2100년에 203초를 주는데 2026년의 실제 값은 69초에서 거의 늘지 않고 있다).
import { readFileSync } from 'node:fs';

export const VSOP_FILE = '.tools/vsop87/VSOP87D.ear';
export const DAY_MS = 86_400_000;
const RAD = Math.PI / 180;
const ARCSEC = RAD / 3600;

export const TERM_NAMES = [
  '소한', '대한', '입춘', '우수', '경칩', '춘분', '청명', '곡우', '입하', '소만', '망종', '하지',
  '소서', '대서', '입추', '처서', '백로', '추분', '한로', '상강', '입동', '소설', '대설', '동지',
];

type Term = { a: number; b: number; c: number };
type Series = Term[][]; // [τ의 차수][항]
export type Vsop = { L: Series; B: Series; R: Series };

/** VSOP87D 파일을 읽는다. 변수 1은 황경 L, 2는 황위 B, 3은 거리 R. 항은 a·cos(b + c·τ)이고 τ의 차수별로 묶여 있다. */
export function readVsop(path = VSOP_FILE): Vsop {
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
export function apparentLongitude(vsop: Vsop, jde: number): number {
  const tau = (jde - 2451545) / 365250;
  const T = tau * 10;
  const geometric = sum(vsop.L, tau) + Math.PI; // 지구에서 본 태양은 지구의 반대쪽이다
  const fk5 = -0.09033 * ARCSEC;
  const aberration = (-20.4898 * ARCSEC) / sum(vsop.R, tau);
  const deg = (geometric + fk5 + nutationInLongitude(T) + aberration) / RAD;
  return ((deg % 360) + 360) % 360;
}

/** ΔT = 지구시 - 세계시(초). Espenak & Meeus의 다항식. year는 소수가 붙은 해다. */
export function deltaT(year: number): number {
  if (year < 1920) { const t = year - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (year < 1941) { const t = year - 1920; return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3; }
  if (year < 1961) { const t = year - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (year < 1986) { const t = year - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (year < 2005) { const t = year - 2000; return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (year < 2050) { const t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t ** 2; }
  return -20 + 32 * ((year - 1820) / 100) ** 2 - 0.5628 * (2150 - year);
}

export const jdOf = (ms: number): number => ms / DAY_MS + 2440587.5;
export const msOf = (jd: number): number => (jd - 2440587.5) * DAY_MS;

/** year년의 i번째 절기(0 소한 ~ 23 동지)의 순간. 세계시의 밀리초(Date의 값). */
export function termInstant(vsop: Vsop, year: number, i: number): number {
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

// 삭의 주기항(Meeus 표 49.A의 "New Moon" 열). [계수(일), M의 배수, M'의 배수, F의 배수, Ω의 배수, E의 차수].
const NEW_MOON: [number, number, number, number, number, number][] = [
  [-0.4072, 0, 1, 0, 0, 0], [0.17241, 1, 0, 0, 0, 1], [0.01608, 0, 2, 0, 0, 0], [0.01039, 0, 0, 2, 0, 0],
  [0.00739, -1, 1, 0, 0, 1], [-0.00514, 1, 1, 0, 0, 1], [0.00208, 2, 0, 0, 0, 2], [-0.00111, 0, 1, -2, 0, 0],
  [-0.00057, 0, 1, 2, 0, 0], [0.00056, 1, 2, 0, 0, 1], [-0.00042, 0, 3, 0, 0, 0], [0.00042, 1, 0, 2, 0, 1],
  [0.00038, 1, 0, -2, 0, 1], [-0.00024, -1, 2, 0, 0, 1], [-0.00017, 0, 0, 0, 1, 0], [-0.00007, 2, 1, 0, 0, 0],
  [0.00004, 0, 2, -2, 0, 0], [0.00004, 3, 0, 0, 0, 0], [0.00003, 1, 1, -2, 0, 0], [0.00003, 0, 2, 2, 0, 0],
  [-0.00003, 1, 1, 2, 0, 0], [0.00003, -1, 1, 2, 0, 0], [-0.00002, -1, 1, -2, 0, 0], [-0.00002, 1, 3, 0, 0, 0],
  [0.00002, 0, 4, 0, 0, 0],
];
// 행성 때문에 더하는 항. [계수(일), 처음 각(도), k마다 늘어나는 각(도)]. 첫 항에는 -0.009173·T²이 더 붙는다.
const PLANETARY: [number, number, number][] = [
  [0.000325, 299.77, 0.107408], [0.000165, 251.88, 0.016321], [0.000164, 251.83, 26.651886], [0.000126, 349.42, 36.412478],
  [0.00011, 84.66, 18.206239], [0.000062, 141.74, 53.303771], [0.00006, 207.14, 2.453732], [0.000056, 154.84, 7.30686],
  [0.000047, 34.52, 27.261239], [0.000042, 207.19, 0.121824], [0.00004, 291.34, 1.844379], [0.000037, 161.72, 24.198154],
  [0.000035, 239.56, 25.513099], [0.000023, 331.55, 3.592518],
];

/** k번째 삭(k = 0이 2000-01-06의 삭)의 순간. 세계시의 밀리초. */
export function newMoonInstant(k: number): number {
  const T = k / 1236.85;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T ** 2 - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T ** 2;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T ** 2 - 0.00000011 * T ** 3) * RAD;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T ** 2 + 0.00001238 * T ** 3 - 0.000000058 * T ** 4) * RAD;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T ** 2 - 0.00000227 * T ** 3 + 0.000000011 * T ** 4) * RAD;
  const O = (124.7746 - 1.56375588 * k + 0.0020672 * T ** 2 + 0.00000215 * T ** 3) * RAD;
  for (const [coef, m, mp, f, o, e] of NEW_MOON) jde += coef * E ** e * Math.sin(m * M + mp * Mp + f * F + o * O);
  PLANETARY.forEach(([coef, start, perK], i) => {
    jde += coef * Math.sin((start + perK * k - (i === 0 ? 0.009173 * T ** 2 : 0)) * RAD);
  });
  const year = 2000 + (jde - 2451545) / 365.25;
  return msOf(jde) - deltaT(year) * 1000;
}
