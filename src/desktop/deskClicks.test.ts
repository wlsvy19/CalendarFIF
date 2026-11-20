import { describe, expect, it } from 'vitest';
import { createClickTracker } from './deskClicks';

const rule = { time: 500, width: 4, height: 4 };

describe('createClickTracker', () => {
  it('두 번 누르기 시간과 거리 안의 두 번째 누름에서 open을 내고 왼쪽 단추는 삼키지 않는다', () => {
    const t = createClickTracker(rule);
    expect(t('ldown', 100, 100, 1000, true)).toEqual({ swallow: false });
    expect(t('lup', 100, 100, 1080, true)).toEqual({ swallow: false });
    expect(t('ldown', 101, 99, 1200, true)).toEqual({ swallow: false, emit: { kind: 'open', x: 101, y: 99 } });
    // 세 번째 누름은 새 첫 누름이다
    expect(t('ldown', 101, 99, 1300, true)).toEqual({ swallow: false });
  });

  it('시간이 지났거나 멀거나 칸이 아니면 열지 않는다', () => {
    const t = createClickTracker(rule);
    t('ldown', 100, 100, 1000, true);
    expect(t('ldown', 100, 100, 1600, true).emit).toBeUndefined();
    expect(t('ldown', 110, 100, 1700, true).emit).toBeUndefined();
    t('ldown', 110, 100, 1800, false); // 칸 밖(아이콘 자리 등)을 누르면 앞의 누름을 잊는다
    expect(t('ldown', 110, 100, 1900, true).emit).toBeUndefined();
  });

  it('시각이 한 바퀴 돌아도 차이를 바르게 잰다', () => {
    const t = createClickTracker(rule);
    t('ldown', 5, 5, 0xffffff00, true);
    expect(t('ldown', 5, 5, 0x50, true).emit?.kind).toBe('open');
  });

  it('칸 위의 오른쪽 단추는 누름과 뗌을 삼키고 뗄 때 menu를 낸다', () => {
    const t = createClickTracker(rule);
    expect(t('rdown', 50, 60, 1000, true)).toEqual({ swallow: true });
    // 칸 밖에서 떼도 삼킨다
    expect(t('rup', 300, 60, 1100, false)).toEqual({ swallow: true, emit: { kind: 'menu', x: 300, y: 60 } });
    expect(t('rup', 300, 60, 1200, true)).toEqual({ swallow: false });
  });

  it('칸이 아닌 곳의 오른쪽 단추는 바탕화면에 그대로 간다', () => {
    const t = createClickTracker(rule);
    expect(t('rdown', 50, 60, 1000, false)).toEqual({ swallow: false });
    expect(t('rup', 50, 60, 1100, false)).toEqual({ swallow: false });
  });
});
