import { describe, expect, it } from 'vitest';
import { refreshAt } from './refresh';

// 이 PC의 시각대로 만든 시각이다(시각대가 달라도 같은 결과가 나온다).
const at = (h: number, m: number, s = 0): Date => new Date(2026, 10, 17, h, m, s);
const minutesAfter = (now: Date): number => (refreshAt(now).getTime() - now.getTime()) / 60_000;

describe('refreshAt', () => {
  it('낮에는 15분 뒤', () => {
    expect(minutesAfter(at(8, 23))).toBe(15);
    expect(minutesAfter(at(0, 30))).toBe(15);
    expect(minutesAfter(at(6, 0))).toBe(15);
    expect(minutesAfter(at(23, 0))).toBe(15);
  });

  it('새벽 1시부터 6시 전까지는 30분 뒤', () => {
    expect(minutesAfter(at(1, 0))).toBe(30);
    expect(minutesAfter(at(3, 40))).toBe(30);
    expect(minutesAfter(at(5, 59))).toBe(30);
  });

  it('자정이 그보다 가까우면 자정 5초 뒤(오늘 표시가 바뀐다)', () => {
    expect(refreshAt(at(23, 50))).toEqual(new Date(2026, 10, 18, 0, 0, 5));
    expect(refreshAt(at(23, 59, 58))).toEqual(new Date(2026, 10, 18, 0, 0, 5));
    expect(minutesAfter(at(23, 44))).toBe(15); // 자정 전에 한 번 더 그릴 수 있다
    // 자정이 막 지났으면 다음 자정은 멀다.
    expect(minutesAfter(new Date(2026, 10, 18, 0, 0, 2))).toBe(15);
  });

  it('달과 해의 마지막 날에도 다음 날 자정을 찾는다', () => {
    expect(refreshAt(new Date(2026, 10, 30, 23, 59))).toEqual(new Date(2026, 11, 1, 0, 0, 5));
    expect(refreshAt(new Date(2026, 11, 31, 23, 59))).toEqual(new Date(2027, 0, 1, 0, 0, 5));
  });
});
