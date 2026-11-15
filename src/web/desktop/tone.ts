import { playTone, type ToneContext } from '../tones';

export type { ToneContext };

/** 완료 표시를 저장할 때 내는 짧은 소리. 소리를 낼 수 없으면 조용히 넘어간다. */
export function playDoneTone(make?: () => ToneContext): void {
  playTone('done', make);
}
