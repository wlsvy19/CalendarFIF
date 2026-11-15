/**
 * 합성한 효과음. 파일 없이 WebAudio로 만든다. 소리는 작게(0.15 안팎), 길이는 1.5초 안쪽이다.
 * AudioContext는 하나를 다시 쓴다. 아이폰은 사용자가 누른 뒤에야 소리를 내므로 unlockAudio를 누를 때 부른다.
 */
export type ToneName = 'done' | 'chime' | 'bell';
export type ToneContext = Pick<AudioContext, 'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'resume' | 'state'>;

const VOLUME = 0.15;
let shared: ToneContext | null = null;

function context(make?: () => ToneContext): ToneContext {
  if (make) return make();
  shared ??= new AudioContext() as ToneContext;
  return shared;
}

function wake(ctx: ToneContext): void {
  if (ctx.state === 'suspended') void Promise.resolve(ctx.resume()).catch(() => undefined);
}

/** 사인파 한 음. 감쇠가 있으면 끝으로 갈수록 작아진다. */
function note(ctx: ToneContext, freq: number, start: number, length: number, volume: number, decay: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.value = volume;
  if (decay) gain.gain.exponentialRampToValueAtTime?.(0.0001, start + length);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length);
}

export function playTone(name: ToneName, make?: () => ToneContext): void {
  try {
    const ctx = context(make);
    wake(ctx);
    const t = ctx.currentTime;
    if (name === 'done') {
      note(ctx, 880, t, 0.12, VOLUME, false);
    } else if (name === 'chime') {
      [880, 1175, 1568].forEach((f, i) => note(ctx, f, t + i * 0.18, 0.18, VOLUME, false));
    } else {
      // 종: 기본음과 배음을 겹쳐 길게 줄어들게 한다.
      [[660, 0.1, 1.4], [1650, 0.05, 1.0], [2640, 0.03, 0.6]].forEach(([f, v, len]) => note(ctx, f, t, len, v, true));
    }
  } catch {
    /* 소리는 없어도 된다 */
  }
}

export function unlockAudio(make?: () => ToneContext): void {
  try {
    wake(context(make));
  } catch {
    /* 소리는 없어도 된다 */
  }
}
