// 알림 줄 앞의 종과 카운트다운 줄 앞의 모래시계: 웹앱의 칸과 같은 선 그림을 놓는다.
import { afterEach, describe, expect, it } from 'vitest';
import { parseEventMap } from '../core/events';
import { withEventLines } from './eventLines';
import { makeFakeHost, widgetRecord, type FakeNode } from './fakeHost';
import { renderTree } from './renderTree';
import type { MonthData } from './scene';
import { widgetSize } from './sizes';
import { PALETTES } from './theme';
import { buildTree, type IconNode, type Node, type StackNode, type Tree } from './tree';

const now = new Date(2026, 10, 18, 9, 0, 0);
const SCREEN = { width: 402, height: 874 };
const events = parseEventMap({
  evaaaaaaaaaaaaaaaa: { type: 'alarm', date: '2026-11-18', time: '14:00', text: 'AI 회의', repeat: { freq: 'none' }, advance: [0], done: false, editedAt: 1, editedBy: 'web' },
  evbbbbbbbbbbbbbbbb: { type: 'countdown', date: '2026-11-20', text: '시험', kind: 'basic', repeat: { freq: 'none' }, done: true, editedAt: 1, editedBy: 'web' },
});
const month: MonthData = withEventLines({ monthId: '2026-11', days: { '18': { text: '수습해제', color: '' } } }, events);
const tree = (family: 'large' | 'small'): Tree => buildTree({ family, size: widgetSize(SCREEN, family), today: '2026-11-18', month, offline: false });
const walk = (nodes: Node[]): Node[] => nodes.flatMap((n) => (n.kind === 'stack' ? [n, ...walk(n.children)] : [n]));
const fakeWalk = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((n) => (n.kind === 'stack' ? [n, ...fakeWalk(n.children)] : [n]));
const ink = { light: PALETTES.light.ink, dark: PALETTES.dark.ink };

afterEach(() => {
  delete (globalThis as Record<string, unknown>).SFSymbol;
});

describe('나무', () => {
  it('알림 줄은 종 그림, 틈, 글, 남는 곳의 차례다. 그림 글자는 글에 넣지 않는다. 그림은 글자와 같은 크기와 색이다', () => {
    const all = walk(tree('large').children);
    const line = all.find((n): n is StackNode => n.kind === 'stack' && n.children[0]?.kind === 'icon' && (n.children[0] as IconNode).symbol === 'bell')!;
    expect(line).toMatchObject({ dir: 'h', align: 'center' });
    expect(line.children).toEqual([
      { kind: 'icon', symbol: 'bell', size: 9, color: ink, fallback: '🔔' },
      { kind: 'spacer', length: 2 },
      expect.objectContaining({ kind: 'text', size: 9, color: ink, lines: 1 }),
      { kind: 'spacer', length: null },
    ]);
    const words = line.children[2];
    if (words.kind !== 'text') throw new Error('글이 아니다');
    expect(words.text.startsWith('14:00')).toBe(true);
    // 어디에도 그림 글자로 시작하는 글이 없다.
    expect(all.filter((n) => n.kind === 'text' && /^(🔔|⏳)/u.test(n.text))).toEqual([]);
    // 메모 줄은 전과 같다(그림 없음).
    expect(all.some((n) => n.kind === 'text' && n.text === '수습해제')).toBe(true);
  });

  it('끝낸 카운트다운은 모래시계와 글이 함께 흐리고, 글 앞에 완료 표시가 붙는다', () => {
    const all = walk(tree('large').children);
    const line = all.find((n): n is StackNode => n.kind === 'stack' && n.children[0]?.kind === 'icon' && (n.children[0] as IconNode).symbol === 'hourglass')!;
    expect(line.children[0]).toEqual({ kind: 'icon', symbol: 'hourglass', size: 9, color: ink, opacity: 0.55, fallback: '⏳' });
    expect(line.children[2]).toMatchObject({ kind: 'text', text: '✓ 시험', opacity: 0.55 });
  });

  it('작은 위젯(오늘)의 줄에도 같은 그림을 놓는다(11pt)', () => {
    const icons = walk(tree('small').children).filter((n): n is IconNode => n.kind === 'icon');
    expect(icons).toEqual([{ kind: 'icon', symbol: 'bell', size: 11, color: ink, fallback: '🔔' }]);
  });
});

describe('위젯으로 만들기', () => {
  it('Scriptable의 SFSymbol에서 그림을 가져와 놓는다: 크기는 글자 크기, 색은 글자 색(밝기를 따른다)', () => {
    const asked: [string, unknown][] = [];
    (globalThis as Record<string, unknown>).SFSymbol = {
      named: (name: string) => ({ image: { symbol: name }, applyFont: (font: unknown) => { asked.push([name, font]); } }),
    };
    const host = makeFakeHost();
    const images = fakeWalk(widgetRecord(renderTree(host, tree('large'), 'https://example.test/', now)).children).filter((n) => n.kind === 'image');
    expect(images).toEqual([
      { kind: 'image', image: { symbol: 'bell' }, imageSize: { width: 9, height: 9 }, tintColor: { dynamic: { light: { hex: PALETTES.light.ink, alpha: 1 }, dark: { hex: PALETTES.dark.ink, alpha: 1 } } } },
      { kind: 'image', image: { symbol: 'hourglass' }, imageSize: { width: 9, height: 9 }, tintColor: expect.anything(), imageOpacity: 0.55 },
    ]);
    // 놓는 크기보다 크게 그려 둔다(또렷하게).
    expect(asked.map(([name]) => name)).toEqual(['bell', 'hourglass']);
    // 그림 글자는 어디에도 없다.
    const texts = fakeWalk(widgetRecord(host.state.widgets.length ? renderTree(host, tree('large'), 'https://example.test/', now) : null).children).filter((n) => n.kind === 'text');
    expect(texts.some((n) => n.kind === 'text' && /🔔|⏳/u.test(n.text))).toBe(false);
  });

  it('그림을 쓸 수 없으면(SFSymbol이 없다, 그 이름이 없다, 오류) 그림 글자를 글자로 놓는다: 줄은 그대로 보인다', () => {
    const fallbacks = (): string[] => {
      const host = makeFakeHost();
      return fakeWalk(widgetRecord(renderTree(host, tree('large'), 'https://example.test/', now)).children).flatMap((n) => (n.kind === 'text' && /^(🔔|⏳)$/u.test(n.text) ? [n.text] : []));
    };
    expect(fallbacks()).toEqual(['🔔', '⏳']);
    (globalThis as Record<string, unknown>).SFSymbol = { named: () => null };
    expect(fallbacks()).toEqual(['🔔', '⏳']);
    (globalThis as Record<string, unknown>).SFSymbol = { named: () => { throw new Error('없다'); } };
    expect(fallbacks()).toEqual(['🔔', '⏳']);
  });
});
