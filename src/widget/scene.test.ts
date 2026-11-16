import { describe, expect, it } from 'vitest';
import { buildScene, messageScene, type Draw, type MonthData, type Scene } from './scene';
import { PALETTES, dayBackground } from './theme';
import { estimateWidth } from './text';
import { widgetSize, type Family } from './sizes';
import type { Theme } from './theme';

type Rect = Extract<Draw, { kind: 'rect' }>;
type Text = Extract<Draw, { kind: 'text' }>;
type Line = Extract<Draw, { kind: 'line' }>;

const rects = (s: Scene): Rect[] => s.draws.filter((d): d is Rect => d.kind === 'rect');
const texts = (s: Scene): Text[] => s.draws.filter((d): d is Text => d.kind === 'text');
const lines = (s: Scene): Line[] => s.draws.filter((d): d is Line => d.kind === 'line');
const sizeOf = (family: Family) => widgetSize({ width: 430, height: 932 }, family);

const TODAY = '2026-11-13'; // 금요일
const nov = (days: MonthData['days'] = {}): MonthData => ({ monthId: '2026-11', days });
const large = (month: MonthData, over: Partial<Parameters<typeof buildScene>[0]> = {}): Scene =>
  buildScene({ family: 'large', theme: 'light', size: sizeOf('large'), today: TODAY, month, offline: false, ...over });

const six = '하나\n둘\n셋\n넷\n다섯\n여섯';

describe('large scene, November 2026', () => {
  const p = PALETTES.light;
  const scene = large(nov({ '13': { text: '', color: '' }, '05': { text: '', color: 'F12424' }, '10': { text: '회의\n[+]장보기', color: '' }, '20': { text: six, color: '' } }));
  const gridRects = rects(scene).slice(1); // 첫 사각형은 hairline

  it('draws the surface background and a hairline rectangle behind 35 cells', () => {
    expect(scene.background).toBe(p.surface);
    expect(scene.width).toBe(364);
    expect(rects(scene)[0].color).toBe(p.hairline);
    expect(gridRects.filter((r) => r.radius === undefined)).toHaveLength(35);
  });

  it('has the header and the weekday labels', () => {
    expect(texts(scene)[0]).toMatchObject({ text: '2026년 11월', weight: 'bold', color: p.ink });
    const labels = texts(scene).filter((t) => '일월화수목금토'.includes(t.text) && t.text.length === 1);
    expect(labels.map((t) => t.text).join('')).toBe('일월화수목금토');
    expect(labels[0].color).toBe(p.sun);
    expect(labels[6].color).toBe(p.sat);
    expect(labels[3].color).toBe(p.muted);
  });

  it('marks today with an accent pill and an onAccent number', () => {
    const pill = rects(scene).find((r) => r.radius === 7.5)!;
    expect(pill.color).toBe(p.accent);
    const num = texts(scene).find((t) => t.text === '13')!;
    expect(num.color).toBe(p.onAccent);
    expect(num.x).toBeGreaterThanOrEqual(pill.x);
    expect(num.x + num.w).toBeLessThanOrEqual(pill.x + pill.w + 0.01);
    expect(estimateWidth('13', num.size)).toBeLessThanOrEqual(pill.w - 4);
    expect(rects(scene).filter((r) => r.radius === 7.5)).toHaveLength(1);
  });

  it('mixes the day colour into the cell background', () => {
    const num = texts(scene).find((t) => t.text === '5')!;
    const cell = gridRects.find((r) => r.color === dayBackground('F12424', 'light'))!;
    expect(cell).toBeDefined();
    expect(num.x).toBeGreaterThanOrEqual(cell.x);
    expect(num.color).toBe(p.ink);
  });

  it('draws memo lines and a strike-through for a done line', () => {
    const a = texts(scene).find((t) => t.text === '회의')!;
    const b = texts(scene).find((t) => t.text === '장보기')!;
    expect(b.alpha).toBe(0.55);
    expect(a.alpha).toBeUndefined();
    expect(b.y).toBeGreaterThan(a.y);
    const strike = lines(scene);
    expect(strike).toHaveLength(1);
    expect(strike[0].y1).toBeCloseTo(b.y + b.h / 2, 1);
    expect(strike[0].y2).toBe(strike[0].y1);
    expect(strike[0].x1).toBe(b.x);
    expect(strike[0].alpha).toBe(0.55);
    expect(strike[0].width).toBe(0.75);
    expect(strike[0].x2 - strike[0].x1).toBeCloseTo(estimateWidth('장보기', b.size), 1);
  });

  it('replaces the overflow of a six-line day with +N (cells here hold four lines)', () => {
    const shown = texts(scene).filter((t) => ['하나', '둘', '셋', '넷', '다섯', '여섯'].includes(t.text));
    expect(shown.map((t) => t.text)).toEqual(['하나', '둘', '셋']);
    const more = texts(scene).find((t) => t.text === '+3')!;
    expect(more.color).toBe(p.muted);
  });

  it('dims the trailing December days and gives them no memo or colour', () => {
    // 12월 1일의 키 '01'은 11월 1일의 키와 같다. 데이터는 11월 1일 칸에만 그려진다.
    const s = large(nov({ '01': { text: '한 번만', color: 'F12424' } }));
    expect(texts(s).filter((t) => t.alpha === 0.4).map((t) => t.text)).toEqual(['1', '2', '3', '4', '5']);
    expect(texts(s).filter((t) => t.text === '한 번만')).toHaveLength(1);
    expect(rects(s).filter((r) => r.color === dayBackground('F12424', 'light'))).toHaveLength(1);
  });
});

describe('large scene, row counts', () => {
  const cells = (s: Scene): Rect[] => rects(s).slice(1).filter((r) => r.radius === undefined);
  const jan = (days: MonthData['days'] = {}): MonthData => ({ monthId: '2027-01', days });
  const feb = (days: MonthData['days'] = {}): MonthData => ({ monthId: '2026-02', days });

  it('draws 42 cells for a six-row month and 28 for a four-row month', () => {
    expect(cells(large(jan(), { today: '2027-01-10' }))).toHaveLength(42);
    expect(cells(large(feb(), { today: '2026-02-10' }))).toHaveLength(28);
  });

  it('lets the memo capacity follow the cell height', () => {
    const memo = '1\n2\n3\n4\n5\n6\n7\n8';
    const count = (s: Scene): number => texts(s).filter((t) => /^[1-8]$/.test(t.text) && t.size < 10).length;
    const cap6 = count(large(jan({ '20': { text: memo, color: '' } }), { today: '2027-01-10' }));
    const cap5 = count(large(nov({ '20': { text: memo, color: '' } })));
    const cap4 = count(large(feb({ '20': { text: memo, color: '' } }), { today: '2026-02-10' }));
    // 보이는 줄 = 칸에 들어가는 줄 수 - 1 (마지막 줄은 +N)
    expect([cap6, cap5, cap4]).toEqual([2, 3, 4]);
  });
});

describe('offline', () => {
  it('shows 오프라인 only when offline', () => {
    expect(texts(large(nov())).some((t) => t.text === '오프라인')).toBe(false);
    const off = texts(large(nov(), { offline: true })).find((t) => t.text === '오프라인')!;
    expect(off).toMatchObject({ align: 'right', color: PALETTES.light.muted });
    for (const family of ['medium', 'small'] as const) {
      const on = buildScene({ family, theme: 'dark', size: sizeOf(family), today: TODAY, month: nov(), offline: true });
      const no = buildScene({ family, theme: 'dark', size: sizeOf(family), today: TODAY, month: nov(), offline: false });
      expect(texts(on).some((t) => t.text === '오프라인')).toBe(true);
      expect(texts(no).some((t) => t.text === '오프라인')).toBe(false);
    }
  });
});

const busy: MonthData = {
  monthId: '2026-11',
  days: {
    '02': { text: '아주아주아주아주 긴 한국어 메모 줄입니다', color: '2E7D32' },
    '05': { text: '[+]done line with English words that is long', color: 'F12424' },
    '13': { text: '오늘 할 일\n[+]장보기\nbuy milk\n치과 예약 전화\n운동\n세탁소\n책 반납', color: 'FFB300' },
    '20': { text: six, color: '1976D2' },
    '30': { text: '막날', color: '' },
  },
};

describe('every scene', () => {
  const all: Scene[] = [];
  for (const family of ['large', 'medium', 'small'] as const)
    for (const theme of ['light', 'dark'] as Theme[])
      for (const offline of [false, true]) all.push(buildScene({ family, theme, size: sizeOf(family), today: TODAY, month: busy, offline }));

  it('fits every text into its rectangle', () => {
    for (const s of all) for (const t of texts(s)) expect(estimateWidth(t.text, t.size), t.text).toBeLessThanOrEqual(t.w + 1e-6);
  });

  it('keeps every command inside the picture', () => {
    const e = 0.011;
    for (const s of all) {
      for (const d of s.draws) {
        if (d.kind === 'line') {
          for (const [x, y] of [[d.x1, d.y1], [d.x2, d.y2]]) {
            expect(x).toBeGreaterThanOrEqual(-e);
            expect(x).toBeLessThanOrEqual(s.width + e);
            expect(y).toBeGreaterThanOrEqual(-e);
            expect(y).toBeLessThanOrEqual(s.height + e);
          }
        } else {
          expect(d.x).toBeGreaterThanOrEqual(-e);
          expect(d.y).toBeGreaterThanOrEqual(-e);
          expect(d.x + d.w).toBeLessThanOrEqual(s.width + e);
          expect(d.y + d.h).toBeLessThanOrEqual(s.height + e);
        }
      }
    }
  });
});

describe('medium scene', () => {
  const s = buildScene({ family: 'medium', theme: 'light', size: sizeOf('medium'), today: TODAY, month: busy, offline: false });
  it('shows the week of today in 7 cells with at most 6 memo lines', () => {
    expect(rects(s).slice(1).filter((r) => r.radius === undefined)).toHaveLength(7);
    // 2026-11-13 의 주: 8일(일)~14일(토)
    const nums = texts(s).filter((t) => t.weight === 'semibold' && /^\d+$/.test(t.text)).map((t) => t.text);
    expect(nums).toEqual(['8', '9', '10', '11', '12', '13', '14']);
    // 음력(오른쪽 맞춤)은 메모가 아니다.
    const memo = texts(s).filter((t) => t.size < 10 && t.weight === 'regular' && t.align === 'left');
    expect(memo.length).toBeLessThanOrEqual(6);
    expect(memo.length).toBe(6); // 7줄 -> 5줄 + "+2"
    expect(memo[5].text).toBe('+2');
  });
  it('uses the week across the month edge as dimmed days', () => {
    const edge = buildScene({ family: 'medium', theme: 'light', size: sizeOf('medium'), today: '2026-11-30', month: busy, offline: false });
    expect(texts(edge).filter((t) => t.alpha === 0.4).map((t) => t.text)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('small scene', () => {
  const small = (month: MonthData): Scene => buildScene({ family: 'small', theme: 'light', size: sizeOf('small'), today: TODAY, month, offline: false });
  it('shows the day, the month, the weekday and a colour bar', () => {
    const s = small(busy);
    const t = texts(s).map((x) => x.text);
    expect(t).toEqual(expect.arrayContaining(['13', '11월', '금요일', '오늘 할 일']));
    expect(texts(s).find((x) => x.text === '13')).toMatchObject({ weight: 'bold', size: 34, color: PALETTES.light.ink });
    const bar = rects(s).find((r) => r.color === '#FFB300')!;
    expect(bar).toMatchObject({ x: 0, y: 0, w: 4, h: 170 });
  });
  it('says there is no memo and has no bar without a colour', () => {
    const s = small(nov());
    expect(texts(s).some((x) => x.text === '메모 없음')).toBe(true);
    expect(rects(s)).toHaveLength(0);
  });
  it('colours a Saturday number with sat', () => {
    const s = buildScene({ family: 'small', theme: 'light', size: sizeOf('small'), today: '2026-11-14', month: nov(), offline: false });
    expect(texts(s).find((x) => x.text === '14')!.color).toBe(PALETTES.light.sat);
    expect(texts(s).some((x) => x.text === '토요일')).toBe(true);
  });
  it('caps at six lines, or five under the lunar and holiday line', () => {
    const memoOf = (s: Scene): string[] => texts(s).filter((x) => x.size === 11 && x.weight === 'regular').map((x) => x.text);
    const plain = buildScene({ family: 'small', theme: 'light', size: sizeOf('small'), today: TODAY, month: busy, offline: false, lunar: false });
    expect([memoOf(plain).length, memoOf(plain)[5]]).toEqual([6, '+2']);
    const s = small(busy);
    expect([memoOf(s).length, memoOf(s)[4]]).toEqual([5, '+3']);
    expect(texts(s).find((x) => x.text === '음 10.5')).toMatchObject({ size: 10, color: PALETTES.light.muted, y: 54 });
    expect(texts(plain).some((x) => x.text.startsWith('음 '))).toBe(false);
  });
  it('shows a holiday in red with its name', () => {
    // 2026-10-05는 개천절(토)의 대체공휴일인 월요일이다.
    const s = buildScene({ family: 'small', theme: 'light', size: sizeOf('small'), today: '2026-10-05', month: { monthId: '2026-10', days: {} }, offline: false });
    expect(texts(s).find((x) => x.text === '5')!.color).toBe(PALETTES.light.sun);
    expect(texts(s).find((x) => x.text === '음 8.25 · 대체공휴일')).toMatchObject({ color: PALETTES.light.sun });
  });
});

describe('holidays and lunar dates in the grid', () => {
  // 2026년 10월: 3일 개천절(토), 5일 그 대체공휴일(월), 9일 한글날(금). 1일이 오늘이다.
  const days: MonthData['days'] = { '05': { text: six, color: '' }, '06': { text: six, color: '' }, '09': { text: '', color: 'F12424' } };
  const october = (over: Partial<Parameters<typeof buildScene>[0]> = {}): Scene =>
    buildScene({ family: 'large', theme: 'light', size: sizeOf('large'), today: '2026-10-01', month: { monthId: '2026-10', days }, offline: false, ...over });
  const s = october();
  const p = PALETTES.light;
  const number = (scene: Scene, day: number): Text => texts(scene).find((t) => t.weight === 'semibold' && t.text === String(day) && t.alpha === undefined)!;
  const lunar = (scene: Scene): Text[] => texts(scene).filter((t) => t.align === 'right' && t.color === p.muted);

  it('colours holidays and substitute holidays red, whatever the weekday', () => {
    expect([number(s, 3).color, number(s, 5).color, number(s, 6).color, number(s, 4).color]).toEqual([p.sun, p.sun, p.ink, p.sun]);
    // 색을 칠한 날은 숫자가 ink다.
    expect(number(s, 9).color).toBe(p.ink);
  });
  it('writes the holiday name under the number and gives the memo one line less', () => {
    const names = texts(s).filter((t) => t.weight === 'semibold' && t.color === p.sun && t.size < number(s, 5).size);
    expect(names.map((t) => t.text)).toEqual(['개천절', '대체공휴일', '한글날']);
    const memoIn = (day: number): Text[] => texts(s).filter((t) => t.x === number(s, day).x && t.weight === 'regular' && t.align === 'left');
    expect(memoIn(6).length - memoIn(5).length).toBe(1);
    expect(memoIn(5)[0].y).toBeGreaterThan(names[1].y);
  });
  it('shrinks a name that is wider than the cell instead of cutting it, down to 6.5', () => {
    const narrow = buildScene({ family: 'large', theme: 'light', size: { width: 321, height: 324 }, today: '2026-10-01', month: { monthId: '2026-10', days }, offline: false });
    const name = texts(narrow).find((t) => t.text.startsWith('대체'))!;
    expect(name.text).toBe('대체공휴일');
    expect(name.size).toBeLessThan(8);
    expect(name.size).toBeGreaterThanOrEqual(6.5);
    expect(estimateWidth(name.text, name.size)).toBeLessThanOrEqual(name.w + 0.05); // 소수 둘째 자리로 반올림한 만큼
  });
  it('writes the lunar date at the right of the number row, for days of this month only', () => {
    expect(lunar(s).map((t) => t.text)).toEqual(expect.arrayContaining(['8.23', '8.25', '9.1']));
    expect(lunar(s)).toHaveLength(31);
    for (const t of lunar(s)) expect(t.size).toBeGreaterThanOrEqual(8);
    expect(lunar(october({ lunar: false }))).toEqual([]);
  });
  it('writes the solar term or dog day name in place of the lunar date', () => {
    // 2026년 10월 8일(음력 8.28)은 한로, 23일은 상강이다.
    expect(lunar(s).map((t) => t.text)).toEqual(expect.arrayContaining(['한로', '상강']));
    expect(lunar(s).some((t) => t.text === '8.28')).toBe(false);
    for (const t of lunar(s).filter((x) => x.text === '한로' || x.text === '상강')) expect(t.size).toBeGreaterThanOrEqual(8);
    // 작은 위젯의 날짜 아래 줄에는 음력 뒤에 적는다(2026-11-07은 입동). 음력을 끄면 같이 적지 않는다.
    const small = (over: Partial<Parameters<typeof buildScene>[0]> = {}): Scene =>
      buildScene({ family: 'small', theme: 'light', size: sizeOf('small'), today: '2026-11-07', month: nov(), offline: false, ...over });
    expect([texts(small()).some((x) => x.text === '음 9.28 · 입동'), texts(small({ lunar: false })).some((x) => x.text.includes('입동'))]).toEqual([true, false]);
  });
  it('shrinks the lunar date of today beside the number pill down to 6.5, and leaves it out when it still overlaps', () => {
    // 좁은 위젯(321)에서 오늘이 23일(음력 10.15)이면 8로는 숫자 상자와 겹친다.
    const narrow = (today: string, monthId: string): Scene => buildScene({ family: 'large', theme: 'light', size: { width: 321, height: 324 }, today, month: { monthId, days: {} }, offline: false });
    const tight = lunar(narrow('2026-11-23', '2026-11')).find((t) => t.text === '10.15')!;
    expect(tight.size).toBeLessThan(8);
    expect(tight.size).toBeGreaterThanOrEqual(6.5);
    // 그날이 오늘이 아니면 8 그대로다.
    expect(lunar(narrow('2026-11-13', '2026-11')).find((t) => t.text === '10.15')!.size).toBe(8);
    // 오늘이 두 자리 날이고 음력이 윤달의 두 자리 날이면 들어가지 않아 적지 않는다(2025-08-10은 음력 윤6월 17일).
    // 그 전날(9일)은 말복이라 음력 대신 이름이 들어가 있으므로 8일(윤6월 15일)과 견준다.
    const leap = lunar(narrow('2025-08-10', '2025-08'));
    expect([leap.some((t) => t.text === '윤6.17'), leap.some((t) => t.text === '윤6.15'), leap.some((t) => t.text === '말복')]).toEqual([false, true, true]);
  });
});

describe('scaling', () => {
  it('scales a different large size by width', () => {
    const a = large(busy);
    const b = buildScene({ family: 'large', theme: 'light', size: { width: 338, height: 354 }, today: TODAY, month: busy, offline: false });
    expect(b.draws).toHaveLength(a.draws.length);
    const k = 338 / 364;
    b.draws.forEach((d, i) => {
      const o = a.draws[i];
      expect(d.kind).toBe(o.kind);
      if (d.kind !== 'line' && o.kind !== 'line') {
        expect(Math.abs(d.x - o.x * k)).toBeLessThan(0.02);
        expect(Math.abs(d.w - o.w * k)).toBeLessThan(0.02);
      }
    });
  });
});

describe('messageScene', () => {
  it('puts the title and then the lines in order', () => {
    const s = messageScene({ theme: 'dark', size: sizeOf('large'), title: 'CalendarFIF', lines: ['첫째 줄', '둘째 줄'] });
    expect(s.background).toBe(PALETTES.dark.surface);
    expect(texts(s).map((t) => t.text)).toEqual(['CalendarFIF', '첫째 줄', '둘째 줄']);
    const [title, a, b] = texts(s);
    expect(title).toMatchObject({ weight: 'bold', size: 15, color: PALETTES.dark.ink, x: 14 });
    expect(a).toMatchObject({ weight: 'regular', size: 12, color: PALETTES.dark.muted });
    expect(b.y - a.y).toBe(17);
    expect(a.y).toBeGreaterThan(title.y);
  });
  it('wraps lines that are too long and keeps every character', () => {
    const size = widgetSize({ width: 402, height: 874 }, 'small');
    const input = ['Scriptable 앱에서', '이 스크립트를 한 번 실행해', '로그인하세요.'];
    const s = messageScene({ theme: 'light', size, title: 'CalendarFIF', lines: input });
    const body = texts(s).slice(1);
    expect(body.length).toBeGreaterThan(input.length);
    expect(body.map((t) => t.text).join('').replace(/ /g, '')).toBe(input.join('').replace(/ /g, ''));
    for (const t of body) expect(estimateWidth(t.text, t.size)).toBeLessThanOrEqual(t.w);
    for (const t of body) expect(t.y + t.h).toBeLessThanOrEqual(size.height);
  });
  it('leaves out lines that no longer fit the height', () => {
    const s = messageScene({ theme: 'light', size: { width: 161, height: 80 }, title: 'T', lines: ['하나', '둘', '셋', '넷', '다섯'] });
    expect(texts(s).length).toBeLessThan(6);
    for (const t of texts(s)) expect(t.y + t.h).toBeLessThanOrEqual(80);
  });
});

describe('fix round 1', () => {
  it('never draws a font below 8 pt, also on a 375x667 screen', () => {
    for (const family of ['large', 'medium', 'small'] as const) {
      const size = widgetSize({ width: 375, height: 667 }, family);
      for (const offline of [false, true]) {
        const s = buildScene({ family, theme: 'light', size, today: TODAY, month: busy, offline });
        for (const t of texts(s)) {
          expect(t.size, t.text).toBeGreaterThanOrEqual(8);
          expect(estimateWidth(t.text, t.size), t.text).toBeLessThanOrEqual(t.w + 1e-6);
        }
      }
    }
  });

  it('strikes done lines in the small widget too', () => {
    const s = buildScene({ family: 'small', theme: 'light', size: sizeOf('small'), today: TODAY, month: nov({ '13': { text: '할 일\n[+]장보기', color: '' } }), offline: false });
    const done = texts(s).find((t) => t.text === '장보기')!;
    expect(done.alpha).toBe(0.55);
    const strike = lines(s);
    expect(strike).toHaveLength(1);
    expect(strike[0]).toMatchObject({ x1: done.x, alpha: 0.55, width: 0.75 });
    expect(strike[0].y1).toBeCloseTo(done.y + done.h / 2, 1);
    expect(strike[0].x2 - strike[0].x1).toBeCloseTo(estimateWidth('장보기', done.size), 1);
  });

  it('ignores a day colour that is not six hex digits', () => {
    for (const color of ['zzz', 'f12424', '#F12424']) {
      const m = nov({ '13': { text: '메모', color } });
      const l = large(m);
      expect(rects(l).every((r) => /^#[0-9A-F]{6}$/.test(r.color))).toBe(true);
      expect(rects(l).filter((r) => r.radius === undefined).slice(1).every((r) => r.color === PALETTES.light.surface)).toBe(true);
      const sm = buildScene({ family: 'small', theme: 'light', size: sizeOf('small'), today: TODAY, month: m, offline: false });
      expect(rects(sm)).toHaveLength(0);
    }
  });

  it('draws no strike line for a done line that was dropped', () => {
    const s = buildScene({ family: 'large', theme: 'light', size: { width: 40, height: 80 }, today: TODAY, month: nov({ '10': { text: '[+]장보기', color: '' } }), offline: false });
    expect(texts(s).some((t) => t.text.includes('장'))).toBe(false);
    expect(lines(s)).toHaveLength(0);
  });
});
