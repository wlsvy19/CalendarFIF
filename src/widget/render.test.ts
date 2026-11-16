import { describe, expect, it } from 'vitest';
import { makeFakeHost, widgetRecord } from './fakeHost';
import { makeWidget, renderScene } from './render';
import type { Scene } from './scene';
import { refreshAt } from './refresh';

const scene: Scene = {
  width: 100,
  height: 60,
  background: '#FFFFFF',
  draws: [
    { kind: 'rect', x: 1, y: 2, w: 3, h: 4, color: '#112233' },
    { kind: 'rect', x: 5, y: 6, w: 7, h: 8, color: '#445566', alpha: 0.5, radius: 3 },
    { kind: 'text', x: 10, y: 11, w: 12, h: 13, text: '가', size: 9, weight: 'regular', color: '#000000', align: 'left' },
    { kind: 'text', x: 10, y: 11, w: 12, h: 13, text: '나', size: 10, weight: 'semibold', color: '#000000', alpha: 0.4, align: 'center' },
    { kind: 'text', x: 10, y: 11, w: 12, h: 13, text: '다', size: 11, weight: 'bold', color: '#000000', align: 'right' },
    { kind: 'line', x1: 1, y1: 2, x2: 3, y2: 2, color: '#778899', alpha: 0.55, width: 0.75 },
  ],
};

describe('renderScene', () => {
  it('명령을 차례대로 Scriptable 호출로 바꾼다', () => {
    const host = makeFakeHost();
    const image = renderScene(host, scene);
    expect(image).toEqual({ image: 0 });
    const ctx = host.state.contexts[0];
    expect(ctx.size).toEqual({ width: 100, height: 60 });
    expect(ctx.opaque).toBe(false);
    expect(ctx.respectScreenScale).toBe(true);
    const c = (hex: string, alpha = 1) => ({ hex, alpha });
    const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
    expect(ctx.calls).toEqual([
      ['setFillColor', c('#FFFFFF')],
      ['fillRect', r(0, 0, 100, 60)],
      ['setFillColor', c('#112233')],
      ['fillRect', r(1, 2, 3, 4)],
      ['setFillColor', c('#445566', 0.5)],
      ['addPath', { ops: [['addRoundedRect', r(5, 6, 7, 8), 3, 3]] }],
      ['fillPath'],
      ['setFont', { font: 'system', size: 9 }],
      ['setTextColor', c('#000000')],
      ['setTextAlignedLeft'],
      ['drawTextInRect', '가', r(10, 11, 12, 13)],
      ['setFont', { font: 'semibold', size: 10 }],
      ['setTextColor', c('#000000', 0.4)],
      ['setTextAlignedCenter'],
      ['drawTextInRect', '나', r(10, 11, 12, 13)],
      ['setFont', { font: 'bold', size: 11 }],
      ['setTextColor', c('#000000')],
      ['setTextAlignedRight'],
      ['drawTextInRect', '다', r(10, 11, 12, 13)],
      ['addPath', { ops: [['move', { x: 1, y: 2 }], ['addLine', { x: 3, y: 2 }]] }],
      ['setStrokeColor', c('#778899', 0.55)],
      ['setLineWidth', 0.75],
      ['strokePath'],
    ]);
  });
});

describe('makeWidget', () => {
  it('주소, 여백 0, 그림, 다음에 새로 그릴 때', () => {
    const host = makeFakeHost();
    const now = new Date('2026-11-13T09:00:00Z');
    const widget = makeWidget(host, scene, 'https://example.test/', now);
    const rec = widgetRecord(widget);
    expect(rec.padding).toEqual([0, 0, 0, 0]);
    expect(rec.props.url).toBe('https://example.test/');
    expect(rec.props.backgroundImage).toEqual({ image: 0 });
    expect(rec.props.backgroundColor).toEqual({ hex: '#FFFFFF', alpha: 1 });
    expect(rec.props.refreshAfterDate).toEqual(refreshAt(now));
  });
});
