import { describe, expect, it, vi } from 'vitest';
import { playTone, unlockAudio, type ToneContext } from './tones';

function fake(state = 'running') {
  const oscs: { frequency: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    currentTime: 2, destination: {}, state, resume: vi.fn(() => Promise.resolve()),
    createOscillator: () => {
      const o = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      oscs.push(o);
      return o;
    },
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
  };
  return { ctx: ctx as unknown as ToneContext, raw: ctx, oscs };
}

describe('효과음', () => {
  it('세 소리가 가짜 AudioContext로 오실레이터를 만든다', () => {
    for (const [name, count, maxEnd] of [['done', 1, 0.2], ['chime', 3, 1.5], ['bell', 3, 1.5]] as const) {
      const f = fake();
      playTone(name, () => f.ctx);
      expect(f.oscs.length, name).toBe(count);
      for (const o of f.oscs) {
        expect(o.start).toHaveBeenCalled();
        expect(o.stop.mock.calls[0][0] - 2, name).toBeLessThanOrEqual(maxEnd);
      }
    }
    const chime = fake();
    playTone('chime', () => chime.ctx);
    expect(chime.oscs.map((o) => o.frequency.value)).toEqual([880, 1175, 1568]);
  });

  it('만들기가 실패해도 던지지 않는다', () => {
    expect(() => playTone('bell', () => { throw new Error('no audio'); })).not.toThrow();
    expect(() => unlockAudio(() => { throw new Error('no audio'); })).not.toThrow();
  });

  it('unlockAudio는 멈춘 컨텍스트를 resume한다', () => {
    const f = fake('suspended');
    unlockAudio(() => f.ctx);
    expect(f.raw.resume).toHaveBeenCalledTimes(1);
    const g = fake('running');
    unlockAudio(() => g.ctx);
    expect(g.raw.resume).not.toHaveBeenCalled();
  });
});
