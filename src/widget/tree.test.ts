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
const memoOf = (cell: StackNode): TextNode | undefined => {
  const row = cell.children[1];
  return row.kind === 'stack' && row.children[0].kind === 'text' ? row.children[0] : undefined;
};

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
      expect(isFlex(first.children.at(-1))).toBe(true);
    }
  });

  it('오늘 칸: 숫자가 강조색 상자 안에 있고 다른 칸에는 없다', () => {
    const pills = stacks(t).filter((s) => s.background && s.background.light === PALETTES.light.accent);
    expect(pills).toHaveLength(1);
    expect(pills[0]).toMatchObject({ radius: 7.5, padding: [1, 4, 1, 4], dir: 'h' });
    expect(pills[0].children).toHaveLength(1);
    expect(pills[0].children[0]).toMatchObject({ kind: 'text', text: '13', color: pair('onAccent') });
    expect(cellOf(t, 13).children[0]).toMatchObject({ children: [pills[0], { kind: 'spacer', length: null }] });
  });

  it('날짜 색이 있으면 칸 바탕이 그 색이고 숫자는 ink, 잘못된 색은 surface', () => {
    const c = build('large', month({ '07': { text: '', color: 'F12424' }, '08': { text: '', color: 'zzz' }, '09': { text: '', color: '' } }));
    expect(cellOf(c, 7).background).toEqual({ light: dayBackground('F12424', 'light'), dark: dayBackground('F12424', 'dark') });
    expect(((cellOf(c, 7).children[0] as StackNode).children[0] as TextNode).color).toEqual(pair('ink'));
    expect(cellOf(c, 8).background).toEqual(pair('surface'));
    expect(cellOf(c, 9).background).toEqual(pair('surface'));
    expect(((cellOf(c, 14).children[0] as StackNode).children[0] as TextNode).color).toEqual(pair('sat')); // 토요일
  });

  it('완료 줄은 체크 표시, 메모는 글 하나에 줄바꿈으로 이어 붙인다', () => {
    const c = build('large', month({ '14': { text: '회의\n[+]장보기', color: '' } }));
    expect(memoOf(cellOf(c, 14))).toMatchObject({ text: '회의\n\u2713 장보기', lines: 2, size: 9, weight: 'regular', color: pair('ink') });
  });

  it('줄이 넘치면 마지막 줄이 +N이고 줄 수가 칸의 수용량과 같다', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
    const c = build('large', month({ '14': { text: ten, color: '' } }));
    const memo = memoOf(cellOf(c, 14))!;
    const lines = memo.text.split('\n');
    expect(lines).toHaveLength(3);
    expect(memo.lines).toBe(3);
    expect(lines.at(-1)).toBe('+8');
    expect(lines.slice(0, 2)).toEqual(['줄0', '줄1']);
  });

  it('긴 줄은 칸 폭에 맞게 잘린다', () => {
    const size = widgetSize(SCREEN, 'large');
    const inner = (size.width - 24 - 6) / 7 - 4;
    const c = build('large', month({ '14': { text: '아주아주아주 긴 한국어 메모\nlong english memo line that overflows\n[+]완료된 아주 긴 한국어 줄', color: '' } }));
    const memo = memoOf(cellOf(c, 14))!;
    for (const line of memo.text.split('\n')) expect(estimateWidth(line, 9)).toBeLessThanOrEqual(inner + 1e-9);
    expect(memo.text.split('\n')[0]).not.toBe('아주아주아주 긴 한국어 메모');
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
    expect(memoOf(cellOf(c, 30))?.text).toBe('월말');
  });

  it('1월(2027)은 6주, 2월(2026)은 4주이고 수용량이 그에 따라 변한다', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
    const jan = build('large', month({ '10': { text: ten, color: '' } }, '2027-01'), '2027-01-09');
    const feb = build('large', month({ '10': { text: ten, color: '' } }, '2026-02'), '2026-02-09');
    const nov = build('large', month({ '10': { text: ten, color: '' } }), TODAY);
    expect(weeks(jan)).toHaveLength(6);
    expect(weeks(feb)).toHaveLength(4);
    const lines = (tr: Tree, row: number, col: number): number => (((weeks(tr)[row].children[col] as StackNode).children[1] as StackNode).children[0] as TextNode).lines;
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
    expect(memoOf(weeks(t)[0].children[5] as StackNode)?.text).toBe('리뷰');
  });

  it('수용량은 한 줄 높이로 계산하며 6줄까지', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
    const t = build('medium', month({ '13': { text: ten, color: '' } }));
    const memo = ((weeks(t)[0].children[5] as StackNode).children[1] as StackNode).children[0] as TextNode;
    expect(memo.lines).toBe(6);
    expect(memo.text.split('\n').at(-1)).toBe('+5');
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
    const t = small(month({ '13': { text: '[+]하나\n둘\n셋\n넷\n다섯\n여섯\n일곱\n여덟', color: '' } }));
    const rows = memoRows(t);
    expect(rows.map((r) => r.text)).toEqual(['\u2713 하나', '둘', '셋', '넷', '다섯', '+3']);
    expect(rows[0].opacity).toBe(0.55);
    expect(rows[1].opacity).toBeUndefined();
    expect(rows[5].color).toEqual(pair('muted'));
    for (const r of rows) expect(r.lines).toBe(1);
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
  it('고정 크기는 없고 spacer.length는 null이거나 양수', () => {
    const trees = [build('large', month({ '13': { text: '가\n나', color: 'F12424' } })), build('medium', month({})), build('small', month({})), messageTree({ title: 't', lines: ['a'] })];
    for (const tr of trees) {
      for (const n of all(tr)) {
        if (n.kind === 'spacer') expect(n.length === null || n.length > 0).toBe(true);
        expect(n).not.toHaveProperty('width');
        expect(n).not.toHaveProperty('height');
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
    expect(memoOf(cellOf(t, 14))!.text.split('\n')).toEqual(['가족 모임', '가나다라']);
  });

  const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
  const jan = (height: number): Tree =>
    buildTree({ family: 'large', size: { width: 338, height }, today: '2027-01-09', month: month({ '10': { text: ten, color: '' } }, '2027-01'), offline: false });
  const cell10 = (t: Tree): StackNode => (weeks(t)[2].children[0] as StackNode); // 2027-01-10은 일요일, 셋째 주 첫 칸

  it('수용량이 0이면 메모가 없다(+N도 없다)', () => {
    const c = cell10(jan(150));
    expect(c.children).toHaveLength(2);
    expect(memoOf(c)).toBeUndefined();
  });

  it('수용량이 1이고 줄이 더 있으면 +N만 보인다', () => {
    const memo = memoOf(cell10(jan(282)))!;
    expect(memo.text).toBe('+10');
    expect(memo.lines).toBe(1);
  });
});
