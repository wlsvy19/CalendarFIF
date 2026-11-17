import { describe, expect, it } from 'vitest';
import { refreshAt } from './refresh';

// 이 PC의 시각대로 만든 시각이다(시각대가 달라도 같은 결과가 나온다).
const at = (h: number, m: number, s = 0): Date => new Date(2026, 10, 17, h, m, s);
const minutesAfter = (now: Date): number => (refreshAt(now).getTime() - now.getTime()) / 60_000;

describe('refreshAt', () => {
  it('낮에는 2분 뒤', () => {
    expect(minutesAfter(at(8, 23))).toBe(2);
    expect(minutesAfter(at(0, 30))).toBe(2);
    expect(minutesAfter(at(6, 0))).toBe(2);
    expect(minutesAfter(at(23, 0))).toBe(2);
  });

  it('방금까지 위젯에서 연 달력을 쓰고 있었으면(3분 안) 15초 뒤. 새벽에도 같다', () => {
    const now = at(8, 23);
    const secondsAfter = (activeAt: number, when = now): number => (refreshAt(when, activeAt).getTime() - when.getTime()) / 1000;
    expect(secondsAfter(now.getTime())).toBe(15);
    expect(secondsAfter(now.getTime() - 179_000)).toBe(15);
    expect(secondsAfter(now.getTime() - 180_000)).toBe(120);
    expect(secondsAfter(now.getTime() + 2_000)).toBe(15); // 달력이 아직 떠 있는 동안 그려졌다
    expect(secondsAfter(0)).toBe(120);
    expect(secondsAfter(at(3, 0).getTime() - 10_000, at(3, 0))).toBe(15);
    // 자정이 더 가까우면 자정 5초 뒤다.
    expect(refreshAt(at(23, 59, 58), at(23, 59, 50).getTime())).toEqual(new Date(2026, 10, 18, 0, 0, 5));
  });

  it('새벽 1시부터 6시 전까지는 30분 뒤', () => {
    expect(minutesAfter(at(1, 0))).toBe(30);
    expect(minutesAfter(at(3, 40))).toBe(30);
    expect(minutesAfter(at(5, 59))).toBe(30);
  });

  it('자정이 그보다 가까우면 자정 5초 뒤(오늘 표시가 바뀐다)', () => {
    expect(refreshAt(at(23, 59))).toEqual(new Date(2026, 10, 18, 0, 0, 5));
    expect(minutesAfter(at(23, 57))).toBe(2); // 자정 전에 한 번 더 그릴 수 있다
    expect(refreshAt(at(23, 59, 58))).toEqual(new Date(2026, 10, 18, 0, 0, 5));
    // 자정이 막 지났으면 다음 자정은 멀다.
    expect(minutesAfter(new Date(2026, 10, 18, 0, 0, 2))).toBe(2);
  });

  it('달과 해의 마지막 날에도 다음 날 자정을 찾는다', () => {
    expect(refreshAt(new Date(2026, 10, 30, 23, 59))).toEqual(new Date(2026, 11, 1, 0, 0, 5));
    expect(refreshAt(new Date(2026, 11, 31, 23, 59))).toEqual(new Date(2027, 0, 1, 0, 0, 5));
  });
});
