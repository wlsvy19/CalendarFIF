import { describe, expect, it } from 'vitest';
import { makeFakeHost, widgetRecord, type FakeNode } from './fakeHost';
import { renderTree } from './renderTree';
import { widgetSize } from './sizes';
import { buildTree, type Dyn, type Node, type Tree } from './tree';
import { refreshAt } from './refresh';

const now = new Date(2026, 10, 13, 9, 0, 0);
const dyn = (light: string, dark: string): unknown => ({ dynamic: { light: { hex: light, alpha: 1 }, dark: { hex: dark, alpha: 1 } } });
const D = (light: string, dark: string): Dyn => ({ light, dark });

describe('renderTree', () => {
  it('손으로 만든 나무가 정해진 호출 그대로 위젯이 된다', () => {
    const tree: Tree = {
      background: D('#FFFFFF', '#000000'), padding: [1, 2, 3, 4], spacing: 5,
      children: [
        { kind: 'text', text: '제목', size: 17, weight: 'bold', color: D('#111111', '#EEEEEE'), lines: 1, minScale: 0.7 },
        { kind: 'spacer', length: 4 },
        {
          kind: 'stack', dir: 'h', spacing: 8, padding: [1, 4, 1, 4], background: D('#AAAAAA', '#222222'), radius: 7.5, size: [19, 15], align: 'center',
          children: [
            { kind: 'text', text: '글', size: 9, weight: 'regular', color: D('#111111', '#EEEEEE'), opacity: 0.4, lines: 0 },
            { kind: 'spacer', length: null },
          ],
        },
        { kind: 'stack', dir: 'v', children: [{ kind: 'text', text: '가', size: 11, weight: 'semibold', color: D('#1', '#2'), lines: 2 }, { kind: 'text', text: '나', size: 12, weight: 'medium', color: D('#1', '#2'), lines: 2 }] },
      ],
    };
    const host = makeFakeHost();
    const w = renderTree(host, tree, 'https://example.test/', now);
    const rec = widgetRecord(w);
    expect(rec.padding).toEqual([1, 2, 3, 4]);
    expect(rec.props).toMatchObject({ spacing: 5, backgroundColor: dyn('#FFFFFF', '#000000'), url: 'https://example.test/', refreshAfterDate: refreshAt(now), backgroundImage: null });
    const expected: FakeNode[] = [
      { kind: 'text', text: '제목', font: { font: 'bold', size: 17 }, textColor: dyn('#111111', '#EEEEEE'), lineLimit: 1, minimumScaleFactor: 0.7 },
      { kind: 'spacer', length: 4 },
      {
        kind: 'stack', layout: 'h', spacing: 8, padding: [1, 4, 1, 4], backgroundColor: dyn('#AAAAAA', '#222222'), cornerRadius: 7.5, size: { width: 19, height: 15 }, align: 'center',
        children: [
          { kind: 'text', text: '글', font: { font: 'system', size: 9 }, textColor: dyn('#111111', '#EEEEEE'), textOpacity: 0.4, lineLimit: 0 },
          { kind: 'spacer', length: null },
        ],
      },
      {
        kind: 'stack', layout: 'v',
        children: [
          { kind: 'text', text: '가', font: { font: 'semibold', size: 11 }, textColor: dyn('#1', '#2'), lineLimit: 2 },
          { kind: 'text', text: '나', font: { font: 'medium', size: 12 }, textColor: dyn('#1', '#2'), lineLimit: 2 },
        ],
      },
    ];
    expect(rec.children).toEqual(expected);
    expect(w.backgroundImage).toBeNull();
  });

  it('밝기를 정해 주면 Color.dynamic 없이 그쪽 색으로만 칠한다', () => {
    const tree: Tree = {
      background: D('#FFFFFF', '#000000'), padding: [0, 0, 0, 0], spacing: 0,
      children: [
        { kind: 'text', text: '글', size: 9, weight: 'regular', color: D('#111111', '#EEEEEE'), lines: 1 },
        { kind: 'stack', dir: 'h', background: D('#AAAAAA', '#222222'), children: [{ kind: 'text', text: '안', size: 9, weight: 'regular', color: D('#333333', '#CCCCCC'), lines: 1 }] },
      ],
    };
    for (const [force, bg, ink, box, inner] of [['dark', '#000000', '#EEEEEE', '#222222', '#CCCCCC'], ['light', '#FFFFFF', '#111111', '#AAAAAA', '#333333']] as const) {
      const host = makeFakeHost();
      host.Color.dynamic = () => { throw new Error('dynamic을 쓰면 안 된다'); };
      const rec = widgetRecord(renderTree(host, tree, 'https://example.test/', now, force));
      const plain = (hex: string) => ({ hex, alpha: 1 });
      expect(rec.props.backgroundColor).toEqual(plain(bg));
      expect(rec.children[0]).toMatchObject({ kind: 'text', textColor: plain(ink) });
      expect(rec.children[1]).toMatchObject({ kind: 'stack', backgroundColor: plain(box), children: [{ kind: 'text', textColor: plain(inner) }] });
    }
  });

  it('칸의 메모 줄은 lineLimit 1, minimumScaleFactor 0.9인 글 하나씩이고, 완료 줄은 흐리다', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `줄${i}`).join('\n');
    const month = { monthId: '2026-11', days: { '14': { text: '회의\n[+]장보기', color: '' }, '17': { text: ten, color: '' } } };
    const tree = buildTree({ family: 'large', size: widgetSize({ width: 390, height: 844 }, 'large'), today: '2026-11-13', month, offline: false });
    const rec = widgetRecord(renderTree(makeFakeHost(), tree, 'https://example.test/', now));
    const found: Extract<FakeNode, { kind: 'text' }>[] = [];
    const walk = (nodes: FakeNode[]): void => nodes.forEach((n) => (n.kind === 'text' ? found.push(n) : n.kind === 'stack' ? walk(n.children) : undefined));
    walk(rec.children);
    const byText = (t: string) => found.filter((n) => n.text === t);
    for (const t of ['회의', '✓ 장보기', '줄0', '줄1', '+8']) {
      expect(byText(t)).toHaveLength(1);
      expect(byText(t)[0]).toMatchObject({ font: { font: 'system', size: 9 }, lineLimit: 1, minimumScaleFactor: 0.9 });
    }
    expect(byText('✓ 장보기')[0].textOpacity).toBe(0.55);
    expect(byText('회의')[0].textOpacity).toBeUndefined();
    expect(found.some((n) => n.text.includes('\n'))).toBe(false);
  });

  it('buildTree의 결과는 나무와 같은 수의 글자, 상자, 빈 곳이 된다', () => {
    const month = { monthId: '2026-11', days: { '13': { text: '회의\n[+]장보기', color: 'F12424' }, '14': { text: 'a\nb\nc\nd\ne\nf', color: '' } } };
    for (const family of ['large', 'medium', 'small'] as const) {
      const tree = buildTree({ family, size: widgetSize({ width: 390, height: 844 }, family), today: '2026-11-13', month, offline: true });
      const count = (nodes: Node[], kind: Node['kind']): number => nodes.reduce((n, x) => n + (x.kind === kind ? 1 : 0) + (x.kind === 'stack' ? count(x.children, kind) : 0), 0);
      const countFake = (nodes: FakeNode[], kind: FakeNode['kind']): number => nodes.reduce((n, x) => n + (x.kind === kind ? 1 : 0) + (x.kind === 'stack' ? countFake(x.children, kind) : 0), 0);
      const host = makeFakeHost();
      const rec = widgetRecord(renderTree(host, tree, 'https://example.test/', now));
      for (const kind of ['text', 'stack', 'spacer'] as const) expect(countFake(rec.children, kind)).toBe(count(tree.children, kind));
      expect(countFake(rec.children, 'text')).toBeGreaterThan(0);
      const every = (nodes: FakeNode[]): boolean => nodes.every((n) => n.kind !== 'stack' || (n.layout !== null && every(n.children)));
      expect(every(rec.children)).toBe(true);
    }
  });
});
