import { describe, expect, it, vi } from 'vitest';
import { playTone, unlockAudio, unlockAudioOnGesture, type ToneContext } from './tones';

function fake(state = 'running') {
  const oscs: { frequency: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    currentTime: 2, destination: {}, state, resume: vi.fn((): Promise<void> => Promise.resolve()),
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
    const i = fake('interrupted'); // 아이폰이 끊은 컨텍스트
    unlockAudio(() => i.ctx);
    expect(i.raw.resume).toHaveBeenCalledTimes(1);
  });

  it('누를 때마다 깨우고, 깨어나면(running) 듣기를 거둔다', async () => {
    const f = fake('suspended');
    const target = new EventTarget();
    const added = vi.spyOn(target, 'addEventListener');
    unlockAudioOnGesture(target, () => f.ctx);
    expect(added.mock.calls.map((c) => c[0])).toEqual(['pointerup', 'touchend', 'click', 'keydown']);
    expect(added.mock.calls.every((c) => (c[2] as AddEventListenerOptions).capture && (c[2] as AddEventListenerOptions).passive)).toBe(true);
    target.dispatchEvent(new Event('pointerdown')); // 터치가 닿는 순간은 동작이 아니다
    expect(f.raw.resume).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('touchend')); // resume이 끝나도 아직 멈춰 있다(동작으로 쳐 주지 않았다)
    await Promise.resolve();
    target.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(f.raw.resume).toHaveBeenCalledTimes(2);
    f.raw.resume.mockImplementation(() => {
      f.raw.state = 'running';
      return Promise.resolve();
    });
    target.dispatchEvent(new Event('pointerup'));
    await vi.waitFor(() => expect(f.raw.state).toBe('running'));
    await Promise.resolve();
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('click'));
    expect(f.raw.resume).toHaveBeenCalledTimes(3); // 깨어난 뒤로는 듣지 않는다
  });

  it('아이폰이 끊은(interrupted) 컨텍스트도 누르면 깨운다', async () => {
    const f = fake('interrupted');
    const target = new EventTarget();
    f.raw.resume.mockImplementation(() => {
      f.raw.state = 'running';
      return Promise.resolve();
    });
    unlockAudioOnGesture(target, () => f.ctx);
    target.dispatchEvent(new Event('touchend'));
    await vi.waitFor(() => expect(f.raw.state).toBe('running'));
    expect(f.raw.resume).toHaveBeenCalledTimes(1);
  });

  it('이미 깨어 있으면 처음 누를 때 듣기를 거두고, 돌려준 함수로도 거둔다', () => {
    const running = fake('running');
    const a = new EventTarget();
    const removedA = vi.spyOn(a, 'removeEventListener');
    unlockAudioOnGesture(a, () => running.ctx);
    a.dispatchEvent(new Event('click'));
    expect(removedA).toHaveBeenCalledTimes(4);
    expect(running.raw.resume).not.toHaveBeenCalled();
    const asleep = fake('suspended');
    const b = new EventTarget();
    const stop = unlockAudioOnGesture(b, () => asleep.ctx);
    stop();
    b.dispatchEvent(new Event('click'));
    expect(asleep.raw.resume).not.toHaveBeenCalled();
    expect(() => unlockAudioOnGesture(b, () => { throw new Error('no audio'); })).not.toThrow();
    expect(() => b.dispatchEvent(new Event('click'))).not.toThrow();
  });
});
