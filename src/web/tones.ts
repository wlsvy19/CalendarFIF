/**
 * 합성한 효과음. 파일 없이 WebAudio로 만든다. 소리는 작게(0.15 안팎), 길이는 1.5초 안쪽이다.
 * AudioContext는 하나를 다시 쓴다. 아이폰은 사용자가 누른 뒤에야 소리를 내므로 웹앱은 unlockAudioOnGesture로 누를 때마다 깨운다.
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

/** 멈춘(suspended) 컨텍스트와 아이폰이 끊은(interrupted: 전화, 다른 앱의 소리) 컨텍스트를 깨운다. 깨우기가 끝나면 풀리는 약속. */
function wake(ctx: ToneContext): Promise<void> {
  if (ctx.state !== 'suspended' && ctx.state !== 'interrupted') return Promise.resolve();
  return Promise.resolve(ctx.resume()).catch(() => undefined);
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
    void wake(ctx);
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
    void wake(context(make));
  } catch {
    /* 소리는 없어도 된다 */
  }
}

/** 아이폰 Safari가 사용자의 동작으로 보는 사건들. 손가락이 닿는 순간(pointerdown)은 터치에서는 동작으로 치지 않는다. */
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/**
 * 사용자가 누를 때마다 소리를 깨우고, 같이 쓰는 컨텍스트가 깨어나면(running) 듣기를 거둔다. 한 번에 깨지 못해도(아이폰은
 * 첫 터치가 동작이 아닐 수 있다) 다음 누르기에 다시 깨운다. 돌려주는 함수는 듣기를 거둔다.
 */
export function unlockAudioOnGesture(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  make?: () => ToneContext,
): () => void {
  const options = { capture: true, passive: true } as const;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    for (const type of GESTURES) target.removeEventListener(type, onGesture, options);
  };
  function onGesture(): void {
    let ctx: ToneContext;
    try {
      ctx = context(make);
    } catch {
      return; // 소리를 낼 수 없는 브라우저. 다음 누르기에 다시 해 본다.
    }
    if (ctx.state === 'running') {
      stop();
      return;
    }
    void wake(ctx).then(() => {
      if (ctx.state === 'running') stop();
    });
  }
  for (const type of GESTURES) target.addEventListener(type, onGesture, options);
  return stop;
}
