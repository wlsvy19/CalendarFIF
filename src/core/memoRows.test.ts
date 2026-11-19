import { describe, expect, it } from 'vitest';
import { fitRows } from './memoRows';

describe('fitRows', () => {
  it('다 들어가면 모두 그대로', () => expect(fitRows([2, 1, 3], 6)).toEqual({ counts: [2, 1, 3], more: 0 }));
  it('제한이 없으면 모두', () => expect(fitRows([5, 4], Infinity)).toEqual({ counts: [5, 4], more: 0 }));
  it('모든 줄이 한 행이면 앞의 capacity-1줄과 +N(전과 같다)', () => expect(fitRows([1, 1, 1, 1, 1, 1], 4)).toEqual({ counts: [1, 1, 1], more: 3 }));
  it('긴 줄이 다른 줄을 밀어내지 않는다: 줄마다 한 행을 먼저 주고 남는 행을 앞줄부터', () => expect(fitRows([2, 1], 2)).toEqual({ counts: [1, 1], more: 0 }));
  it('남는 행은 앞의 긴 줄부터 받는다', () => expect(fitRows([3, 1, 4], 5)).toEqual({ counts: [3, 1, 1], more: 0 }));
  it('긴 줄 하나는 칸을 다 쓴다', () => expect(fitRows([9], 3)).toEqual({ counts: [3], more: 0 }));
  it('줄이 넘치면 +N 자리를 빼고 남는 행이 없다', () => expect(fitRows([4, 4, 4], 2)).toEqual({ counts: [1], more: 2 }));
  it('한 행짜리 칸에 두 줄이면 +2', () => expect(fitRows([3, 1], 1)).toEqual({ counts: [], more: 2 }));
  it('0행이면 보이는 줄이 없다', () => expect(fitRows([1, 1], 0)).toEqual({ counts: [], more: 2 }));
});
