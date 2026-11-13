import { expect, it, vi } from 'vitest';
import { playDoneTone, type ToneContext } from './tone';

it('짧은 소리는 880Hz 사인파를 0.12초 낸다', () => {
  const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) };
  const gain = { gain: { value: 1 }, connect: vi.fn() };
  const ctx = { currentTime: 5, destination: {}, createOscillator: () => osc, createGain: () => gain, close: vi.fn() };
  playDoneTone(() => ctx as unknown as ToneContext);
  expect([osc.type, osc.frequency.value, gain.gain.value, osc.start.mock.calls[0], osc.stop.mock.calls[0]]).toEqual(['sine', 880, 0.15, [5], [5.12]]);
  osc.onended!();
  expect(ctx.close).toHaveBeenCalled();
});
