export type ToneContext = Pick<AudioContext, 'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'close'>;

/** 완료 표시를 저장할 때 내는 짧은 소리. 소리를 낼 수 없으면 조용히 넘어간다. */
export function playDoneTone(make: () => ToneContext = () => new AudioContext()): void {
  try {
    const ctx = make();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => void ctx.close();
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    /* 소리는 없어도 된다 */
  }
}
