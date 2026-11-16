import { describe, expect, it } from 'vitest';
import type { MonthData } from './scene';
import { widgetSize, type Family } from './sizes';
import { estimateWidth } from './text';
import { PALETTES, dayBackground } from './theme';
import { buildTree, messageTree, type Dyn, type Node, type StackNode, type TextNode, type Tree } from './tree';

const SCREEN = { width: 390, height: 844 };
const TODAY = '2026-11-13';
const pair = (key: keyof typeof PALETTES.light): Dyn => ({ light: PALETTES.light[key], dark: PALETTES.dark[key] });

const month = (days: MonthData['days'], monthId = '2026-11'): MonthData => ({ monthId, days });
const build = (family: Family, m: MonthData, today = TODAY, offline = false): Tree =>
  buildTree({ family, size: widgetSize(SCREEN, family), today, month: m, offline });

function walk(nodes: Node[], visit: (n: Node) => void): void {
  for (const n of nodes) {
    visit(n);
    if (n.kind === 'stack') walk(n.children, visit);
  }
}
const all = (t: Tree): Node[] => {
  const out: Node[] = [];
  walk(t.children, (n) => out.push(n));
  return out;
};
const texts = (t: Tree): TextNode[] => all(t).filter((n): n is TextNode => n.kind === 'text');
const stacks = (t: Tree): StackNode[] => all(t).filter((n): n is StackNode => n.kind === 'stack');
const isFlex = (n: Node | undefined): boolean => n?.kind === 'spacer' && n.length === null;

/** 큰 위젯의 격자: 마지막 자식인 세로 상자. */
const grid = (t: Tree): StackNode => t.children.at(-1) as StackNode;
const weeks = (t: Tree): StackNode[] => grid(t).children as StackNode[];
const cells = (t: Tree): StackNode[] => weeks(t).flatMap((w) => w.children as StackNode[]);
/** n번째 날(1부터)이 든 칸. 2026년 11월은 1일이 일요일이라 첫 주의 앞이 비지 않는다. */
const cellOf = (t: Tree, dayOfMonth: number): StackNode => cells(t)[dayOfMonth - 1];
/** 칸의 메모 줄들: 숫자 줄과 마지막 남는 곳 채우기 사이에, 줄마다 [글, 남는 곳 채우기]인 가로 상자 하나. */
const memosOf = (cell: StackNode): TextNode[] =>
  cell.children.slice(1, -1).map((row) => {
    if (row.kind !== 'stack' || row.dir !== 'h' || row.children.length !== 2 || row.children[0].kind !== 'text' || !isFlex(row.children[1])) {
      throw new Error('메모 줄은 글 하나를 앞으로 미는 가로 상자여야 한다');
    }
    return row.children[0];
  });
const memoTexts = (cell: StackNode): string[] => memosOf(cell).map((m) => m.text);
const MEMO = { size: 9, weight: 'regular', color: pair('ink'), lines: 1, minScale: 0.9 };

describe('buildTree large', () => {
  const t = build('large', month({}));

  it('2026년 11월: 5주 x 7칸, 제목, 요일 글자', () => {
    expect(weeks(t)).toHaveLength(5);
    for (const w of weeks(t)) expect(w.children).toHaveLength(7);
    expect(t.padding).toEqual([12, 12, 12, 12]);
    expect(t.background).toEqual(pair('surface'));
    const title = (t.children[0] as StackNode).children[0] as TextNode;
    expect(title).toMatchObject({ text: '2026년 11월', size: 17, weight: 'bold', lines: 1, minScale: 0.7, color: pair('ink') });
    const row = t.children[2] as StackNode;
    const words = row.children.map((c) => ((c as StackNode).children[1] as TextNode));
    expect(words.map((w) => w.text)).toEqual(['일', '월', '화', '수', '목', '금', '토']);
    expect(words[0].color).toEqual(pair('sun'));
    expect(words[6].color).toEqual(pair('sat'));
    expect(words[3].color).toEqual(pair('muted'));
    expect(grid(t).background).toEqual(pair('hairline'));
  });

  it('모든 칸은 마지막이 남는 곳 채우기, 첫 자식은 끝이 남는 곳 채우기인 가로 상자', () => {
    expect(cells(t)).toHaveLength(35);
    for (const c of cells(t)) {
      expect(c.dir).toBe('v');
      expect(isFlex(c.children.at(-1))).toBe(true);
      const first = c.children[0] as StackNode;
      expect(first.kind).toBe('stack');
      expect(first.dir).toBe('h');
      expect(isFlex(first.children[1])).toBe(true);
    }
  });

  it('머리 줄의 뒤쪽 끝에 음력을 적는다(이번 달의 칸에만). lunar가 false면 적지 않는다', () => {
    const head = (tree: Tree, day: number): Node[] => (cellOf(tree, day).children[0] as StackNode).children;
    expect(head(t, 14)).toHaveLength(3);
    expect(head(t, 14)[2]).toMatchObject({ kind: 'text', text: '10.6', size: 7.5, color: pair('muted'), lines: 1, minScale: 0.7 });
    // 2026년 12월의 달력에는 11월 29, 30일이 앞에 붙는다. 그 칸에는 음력이 없다.
    const december = build('large', month({}, '2026-12'), '2026-12-10');
    const others = cells(december).filter((c) => ((c.children[0] as StackNode).children[0] as TextNode).opacity === 0.4);
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) expect((c.children[0] as StackNode).children).toHaveLength(2);
    const off = buildTree({ family: 'large', size: widgetSize(SCREEN, 'large'), today: TODAY, month: month({}), offline: false, lunar: false });
    for (const c of cells(off)) expect(isFlex((c.children[0] as StackNode).children.at(-1))).toBe(true);
  });

  it('절기와 복날이면 음력 대신 그 이름을 적는다', () => {
    const head = (tree: Tree, day: number): Node[] => (cellOf(tree, day).children[0] as StackNode).children;
    // 2026년 11월 7일은 입동, 22일은 소설이다. 8일은 음력 9월 29일이다.
    expect([head(t, 7)[2], head(t, 22)[2], head(t, 8)[2]]).toMatchObject([{ kind: 'text', text: '입동', size: 7.5, color: pair('term') }, { text: '소설', color: pair('term') }, { text: '9.29', color: pair('muted') }]);
  });

  it('공휴일과 대체공휴일은 숫자가 빨갛고 이름 한 줄을 적는다. 그 칸은 메모를 한 줄 덜 넣는다', () => {
    // 2026년 10월: 3일 개천절(토), 5일 대체공휴일(월), 9일 한글날(금)
    const many = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차'].join('\n');
    const october = build('large', month({ '05': { text: many, color: '' }, '06': { text: many, color: '' }, '09': { text: '', color: 'F12424' } }, '2026-10'), '2026-10-01');
    // 10월 1일은 목요일이라 앞에 9월의 칸이 있다. 흐리지 않은 숫자로 이번 달의 칸을 찾는다.
    const first = (c: StackNode): TextNode => (c.children[0] as StackNode).children[0] as TextNode;
    const cellOf = (_t: Tree, day: number): StackNode => cells(october).find((c) => first(c).kind === 'text' && first(c).text === String(day) && first(c).opacity === undefined)!;
    const memosOf = (c: StackNode): TextNode[] => texts({ ...october, children: [c] }).filter((x) => x.size === 9);
    const numberOf = (day: number): TextNode => first(cellOf(october, day));
    const nameOf = (day: number): TextNode | undefined => texts({ ...october, children: [cellOf(october, day)] }).find((x) => x.size === 8);
    expect([numberOf(3).color, numberOf(5).color, numberOf(6).color]).toEqual([pair('sun'), pair('sun'), pair('ink')]);
    expect([nameOf(3)?.text, nameOf(5)?.text, nameOf(6)]).toEqual(['개천절', '대체공휴일', undefined]);
    expect(nameOf(5)).toMatchObject({ weight: 'semibold', color: pair('sun'), lines: 1, minScale: 0.8 });
    // 색을 칠한 날은 숫자가 ink이고 이름은 그대로 빨갛다.
    expect([numberOf(9).color, nameOf(9)?.text]).toEqual([pair('ink'), '한글날']);
    expect(memosOf(cellOf(october, 6)).length - memosOf(cellOf(october, 5)).length).toBe(1);
  });

  it('오늘 칸: 숫자가 강조색 상자 안에 있고 다른 칸에는 없다', () => {
    const pills = stacks(t).filter((s) => s.background && s.background.light === PALETTES.light.accent);
    expect(pills).toHaveLength(1);
    // 음력을 같이 적는 두 자리 날은 옆 여백이 2.5다(음력이 들어갈 자리를 남긴다). 한 자리 날과 음력을 끈 때는 4다.
    expect(pills[0]).toMatchObject({ radius: 7.5, padding: [1, 2.5, 1, 2.5], dir: 'h' });
    const pillOf = (tree: Tree): StackNode => stacks(tree).find((s) => s.background && s.background.light === PALETTES.light.accent)!;
    expect(pillOf(build('large', month({}), '2026-11-05')).padding).toEqual([1, 4, 1, 4]);
    expect(pillOf(buildTree({ family: 'large', size: widgetSize(SCREEN, 'large'), today: TODAY, month: month({}), offline: false, lunar: false })).padding).toEqual([1, 4, 1, 4]);
    expect(pills[0].children).toHaveLength(1);
    expect(pills[0].children[0]).toMatchObject({ kind: 'text', text: '13', color: pair('onAccent') });
    expect(cellOf(t, 13).children[0]).toMatchObject({ children: [pills[0], { kind: 'spacer', length: null }, { kind: 'text', text: '10.5' }] });
  });

  it('날짜 색이 있으면 칸 바탕이 그 색이고 숫자는 ink, 잘못된 색은 surface', () => {
    const c = build('large', month({ '07': { text: '', color: 'F12424' }, '08': { text: '', color: 'zzz' }, '09': { text: '', color: '' } }));
    expect(cellOf(c, 7).background).toEqual({ light: dayBackground('F12424', 'light'), dark: dayBackground('F12424', 'dark') });
    expect(((cellOf(c, 7).children[0] as StackNode).children[0] as TextNode).color).toEqual(pair('ink'));
    expect(cellOf(c, 8).background).toEqual(pair('surface'));
    expect(cellOf(c, 9).background).toEqual(pair('surface'));
    expect(((cellOf(c, 14).children[0] as StackNode).children[0] as TextNode).color).toEqual(pair('sat')); // 토요일
  });

  it('메모는 줄마다 한 줄짜리 글이고(줄여 맞출 수 있다), 완료 줄은 체크 표시와 흐림', () => {
    const c = build('large', month({ '14': { text: '회의\n[+]장보기', color: '' } }));
    const memos = memosOf(cellOf(c, 14));
    expect(memos).toHaveLength(2);
    expect(memos[0]).toEqual({ kind: 'text', text: '회의', ...MEMO });
    expect(memos[1]).toEqual({ kind: 'text', text: '✓ 장보기', ...MEMO, opacity: 0.55 });
  });

  it('세 줄에 수용량 3이면 한 줄짜리 메모 글 셋', () => {
    const c = build('large', month({ '14': { text: '하나\n둘\n셋', color: '' } }));
    expect(memosOf(cellOf(c, 14))).toEqual(['하나', '둘', '셋'].map((text) => ({ kind: 'text', text, ...MEMO })));
  });

  it('줄이 넘치면 마지막 줄이 따로 된 +N이고 줄 수가 칸의 수용량과 같다', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
    const c = build('large', month({ '14': { text: ten, color: '' } }));
    const memos = memosOf(cellOf(c, 14));
    expect(memos.map((m) => m.text)).toEqual(['줄0', '줄1', '+8']);
    expect(memos[2]).toEqual({ kind: 'text', text: '+8', ...MEMO });
  });

  it('긴 줄은 칸 폭에 맞게 잘린다', () => {
    const size = widgetSize(SCREEN, 'large');
    const inner = (size.width - 24 - 6) / 7 - 4;
    const c = build('large', month({ '14': { text: '아주아주아주 긴 한국어 메모\nlong english memo line that overflows\n[+]완료된 아주 긴 한국어 줄', color: '' } }));
    const lines = memoTexts(cellOf(c, 14));
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(estimateWidth(line, 9)).toBeLessThanOrEqual(inner + 1e-9);
    expect(lines[0]).not.toBe('아주아주아주 긴 한국어 메모');
    expect(lines[2].startsWith('✓ ')).toBe(true);
  });

  it('격자의 어떤 글에도 줄바꿈이 없다(아이폰에서 한 줄이 두 줄로 접히지 않는다)', () => {
    const many = { '01': { text: '가\n나\n다\n라\n마\n바\n사', color: '' }, '13': { text: '회의\n[+]장보기\n세 번째\n네 번째', color: 'F12424' }, '14': { text: 'a\r\nb\n\nc', color: '' } };
    const trees = [build('large', month(many)), build('medium', month(many)), build('large', month(many, '2027-01'), '2027-01-09')];
    for (const tr of trees) {
      expect(texts(tr).length).toBeGreaterThan(20);
      for (const x of texts(tr)) expect(x.text).not.toMatch(/[\r\n]/);
    }
  });

  it('달 밖의 날: 숫자는 흐리고 메모와 색은 없다', () => {
    const c = build('large', month({ '30': { text: '월말', color: 'F12424' }, '01': { text: '지난달 키', color: 'F12424' } }, '2026-11'));
    // 11월 격자의 마지막 칸(12월 5일)과 첫 칸이 아닌, 달 밖 칸을 찾는다: 12월 1~5일
    const outside = cells(c).slice(30);
    expect(outside).toHaveLength(5);
    for (const cell of outside) {
      expect((cell.children[0] as StackNode).children[0]).toMatchObject({ kind: 'text', opacity: 0.4 });
      expect(cell.children).toHaveLength(2);
      expect(cell.background).toEqual(pair('surface'));
    }
    expect(memoTexts(cellOf(c, 30))).toEqual(['월말']);
  });

  it('1월(2027)은 6주, 2월(2026)은 4주이고 수용량이 그에 따라 변한다', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
    const jan = build('large', month({ '10': { text: ten, color: '' } }, '2027-01'), '2027-01-09');
    const feb = build('large', month({ '10': { text: ten, color: '' } }, '2026-02'), '2026-02-09');
    const nov = build('large', month({ '10': { text: ten, color: '' } }), TODAY);
    expect(weeks(jan)).toHaveLength(6);
    expect(weeks(feb)).toHaveLength(4);
    const lines = (tr: Tree, row: number, col: number): number => memosOf(weeks(tr)[row].children[col] as StackNode).length;
    // 2027-01-10은 일요일, 셋째 주 첫 칸(첫 주는 12월 27일부터). 2026-02-10은 화요일, 둘째 주 셋째 칸. 2026-11-10은 화요일, 둘째 주 셋째 칸.
    expect(lines(jan, 2, 0)).toBe(2);
    expect(lines(nov, 1, 2)).toBe(3);
    expect(lines(feb, 1, 2)).toBe(4);
  });

  it('오프라인 글자는 오프라인일 때만', () => {
    expect(texts(t).some((x) => x.text === '오프라인')).toBe(false);
    const off = build('large', month({}), TODAY, true);
    expect(texts(off).filter((x) => x.text === '오프라인')).toHaveLength(1);
    expect(texts(off).find((x) => x.text === '오프라인')).toMatchObject({ size: 11, color: pair('muted'), lines: 1 });
  });
});

describe('buildTree medium', () => {
  it('오늘이 든 한 주, 7칸', () => {
    const t = build('medium', month({ '13': { text: '리뷰', color: '' } }));
    expect(weeks(t)).toHaveLength(1);
    const numbers = (weeks(t)[0].children as StackNode[]).map((c) => {
      const n = (c.children[0] as StackNode).children[0];
      return n.kind === 'text' ? n.text : ((n as StackNode).children[0] as TextNode).text;
    });
    expect(numbers).toEqual(['8', '9', '10', '11', '12', '13', '14']);
    expect(memoTexts(weeks(t)[0].children[5] as StackNode)).toEqual(['리뷰']);
  });

  it('수용량은 한 줄 높이로 계산하며 6줄까지', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
    const t = build('medium', month({ '13': { text: ten, color: '' } }));
    const memos = memosOf(weeks(t)[0].children[5] as StackNode);
    expect(memos).toHaveLength(6);
    for (const m of memos) expect(m).toMatchObject({ lines: 1, minScale: 0.9 });
    expect(memos.at(-1)!.text).toBe('+5');
  });
});

describe('buildTree small', () => {
  const small = (m: MonthData, offline = false): Tree => build('small', m, TODAY, offline);
  const memoRows = (t: Tree): TextNode[] =>
    (t.children.slice(2, -1).concat() as StackNode[]).filter((n) => n.kind === 'stack').map((n) => n.children[0] as TextNode);

  it('날짜, 달, 요일', () => {
    const t = small(month({}));
    expect(t.padding).toEqual([12, 12, 12, 12]);
    const head = t.children[0] as StackNode;
    expect(head).toMatchObject({ dir: 'h', spacing: 8, align: 'center' });
    expect(head.children[0]).toMatchObject({ text: '13', size: 34, weight: 'bold', color: pair('ink') });
    expect((head.children[1] as StackNode).children.map((c) => (c as TextNode).text)).toEqual(['11월', '금요일']);
    expect(isFlex(head.children[2])).toBe(true);
    expect(isFlex(t.children.at(-1))).toBe(true);
  });

  it('메모 없음', () => {
    const t = small(month({}));
    expect(texts(t).map((x) => x.text)).toContain('메모 없음');
    expect(texts(t).find((x) => x.text === '메모 없음')!.color).toEqual(pair('muted'));
  });

  it('여섯 줄이 넘으면 +N으로 줄이고, 완료 줄은 취소선과 흐림', () => {
    const eight = month({ '13': { text: '[+]하나\n둘\n셋\n넷\n다섯\n여섯\n일곱\n여덟', color: '' } });
    const t = buildTree({ family: 'small', size: widgetSize(SCREEN, 'small'), today: TODAY, month: eight, offline: false, lunar: false });
    // 날짜 아래에 음력 줄이 있으면 한 줄을 덜 넣는다.
    expect(memoRows(small(eight)).map((r) => r.text).slice(1)).toEqual(['둘', '셋', '넷', '+4']);
    const rows = memoRows(t);
    expect(rows.map((r) => r.text)).toEqual(['\u2713 하나', '둘', '셋', '넷', '다섯', '+3']);
    expect(rows[0].opacity).toBe(0.55);
    expect(rows[1].opacity).toBeUndefined();
    expect(rows[5].color).toEqual(pair('muted'));
    for (const r of rows) expect(r.lines).toBe(1);
  });

  it('날짜 아래 한 줄에 음력과 공휴일 이름을 적고, 공휴일은 숫자와 그 줄이 빨갛다', () => {
    const under = (t: Tree): Node => t.children[1];
    expect(under(small(month({})))).toMatchObject({ kind: 'stack', dir: 'h', children: [{ text: '음 10.5', size: 10, color: pair('muted'), lines: 1 }, { kind: 'spacer', length: null }] });
    // 2026-10-05는 개천절(토)의 대체공휴일인 월요일이다.
    const holiday = build('small', month({}, '2026-10'), '2026-10-05');
    expect(under(holiday)).toMatchObject({ children: [{ text: '음 8.25 · 대체공휴일', color: pair('sun') }, { kind: 'spacer' }] });
    expect(((holiday.children[0] as StackNode).children[0] as TextNode).color).toEqual(pair('sun'));
    // 음력을 끄면 평일에는 그 줄이 없고(바로 틈), 공휴일에는 이름만 적는다.
    const plain = (today: string, monthId: string): Tree => buildTree({ family: 'small', size: widgetSize(SCREEN, 'small'), today, month: month({}, monthId), offline: false, lunar: false });
    expect(under(plain(TODAY, '2026-11'))).toEqual({ kind: 'spacer', length: 6 });
    expect(under(plain('2026-10-05', '2026-10'))).toMatchObject({ children: [{ text: '대체공휴일' }, { kind: 'spacer' }] });
    // 절기와 복날은 음력 뒤에 적는다(2026-11-07은 입동). 음력을 끄면 같이 적지 않는다.
    expect(under(build('small', month({}), '2026-11-07'))).toMatchObject({ children: [{ text: '음 9.28 · 입동', color: pair('muted') }, { kind: 'spacer' }] });
    expect(under(plain('2026-11-07', '2026-11'))).toEqual({ kind: 'spacer', length: 6 });
  });

  it('배경은 오늘 날짜 색을 따른다', () => {
    const colored = small(month({ '13': { text: '', color: 'FFB300' } }));
    expect(colored.background).toEqual({ light: dayBackground('FFB300', 'light'), dark: dayBackground('FFB300', 'dark') });
    expect(small(month({ '13': { text: '', color: 'nope' } })).background).toEqual(pair('surface'));
  });

  it('오프라인 글자는 맨 아래 오른쪽', () => {
    const t = small(month({}), true);
    const last = t.children.at(-1) as StackNode;
    expect(isFlex(last.children[0])).toBe(true);
    expect(last.children[1]).toMatchObject({ text: '오프라인', size: 10 });
    expect(texts(small(month({}))).some((x) => x.text === '오프라인')).toBe(false);
  });

  it('일요일은 sun 색', () => {
    const t = buildTree({ family: 'small', size: widgetSize(SCREEN, 'small'), today: '2026-11-15', month: month({}), offline: false });
    expect((t.children[0] as StackNode).children[0]).toMatchObject({ text: '15', color: pair('sun') });
  });
});

describe('모든 나무', () => {
  // 나무에 고정 크기를 넣을 자리가 생기면(크기 속성이 붙으면) 이 시험이 실패한다.
  const ALLOWED: Record<Node['kind'], string[]> = {
    text: ['kind', 'text', 'size', 'weight', 'color', 'opacity', 'lines', 'minScale'],
    spacer: ['kind', 'length'],
    stack: ['kind', 'dir', 'children', 'spacing', 'padding', 'background', 'radius', 'align'],
  };

  it('마디는 정해진 속성만 가져 고정 크기가 없고, spacer.length는 null이거나 양수', () => {
    const trees = [build('large', month({ '13': { text: '가\n나', color: 'F12424' } })), build('medium', month({})), build('small', month({ '13': { text: '[+]가\n나', color: '' } }), TODAY, true), messageTree({ title: 't', lines: ['a'] })];
    for (const tr of trees) {
      for (const n of all(tr)) {
        if (n.kind === 'spacer') expect(n.length === null || n.length > 0).toBe(true);
        for (const key of Object.keys(n)) expect(ALLOWED[n.kind]).toContain(key);
      }
    }
  });
});

describe('messageTree', () => {
  it('제목과 줄들', () => {
    const t = messageTree({ title: '로그인이 필요합니다', lines: ['첫째', '둘째'] });
    expect(t.padding).toEqual([14, 14, 14, 14]);
    expect(t.background).toEqual(pair('surface'));
    expect(t.children[0]).toMatchObject({ kind: 'text', text: '로그인이 필요합니다', size: 15, weight: 'bold', lines: 2 });
    expect(t.children[1]).toEqual({ kind: 'spacer', length: 6 });
    expect(t.children.slice(2, 4)).toMatchObject([{ text: '첫째', size: 12, color: pair('muted'), lines: 0 }, { text: '둘째', lines: 0 }]);
    expect(isFlex(t.children.at(-1))).toBe(true);
  });
});

describe('칸 폭과 수용량', () => {
  it('402x874 화면의 큰 위젯에서 `가족 모임`은 잘리지 않고 한글 여섯 글자는 잘린다', () => {
    const size = widgetSize({ width: 402, height: 874 }, 'large');
    const t = buildTree({ family: 'large', size, today: TODAY, month: month({ '14': { text: '가족 모임\n가나다라마바', color: '' } }), offline: false });
    expect(memoTexts(cellOf(t, 14))).toEqual(['가족 모임', '가나다라']);
  });

  const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
  const jan = (height: number): Tree =>
    buildTree({ family: 'large', size: { width: 338, height }, today: '2027-01-09', month: month({ '10': { text: ten, color: '' } }, '2027-01'), offline: false });
  const cell10 = (t: Tree): StackNode => (weeks(t)[2].children[0] as StackNode); // 2027-01-10은 일요일, 셋째 주 첫 칸

  it('수용량이 0이면 메모가 없다(+N도 없다)', () => {
    const c = cell10(jan(150));
    expect(c.children).toHaveLength(2);
    expect(memosOf(c)).toEqual([]);
  });

  it('수용량이 1이고 줄이 더 있으면 +N만 보인다', () => {
    expect(memosOf(cell10(jan(282)))).toEqual([{ kind: 'text', text: '+10', ...MEMO }]);
  });
});
