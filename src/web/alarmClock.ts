import { allAlarmTriggers, type AlarmTrigger } from '../core/events';
import type { KeyValueStore } from '../sync/outbox';
import type { EventsView } from './eventsStore';

// 알림을 울리는 시계. 화면이 열려 있는 동안 시각이 된 알림을 한 번만 울린다.
// 울린 것은(열쇠 -> 그때 예정 시각) 저장소에 적어서 다시 열기, 잠자기 뒤, 여러 탭에서도 같은 알림이 두 번 울리지 않게 한다.

export const FIRED_KEY = 'calfif.alarmsFired';
const LATE_MS = 10 * 60_000; // 이보다 오래 지난 것은 울리지 않는다
const AHEAD_MS = 60_000;
const KEEP_MS = 30 * 86_400_000;
const MAX_WAIT_MS = 60_000;
const LOOK_AHEAD_MS = 2 * 86_400_000;

type Fired = Record<string, number>;

export function startAlarmClock(deps: {
  view: EventsView;
  storage: KeyValueStore;
  now?: () => number;
  /** 한 번에 울릴 것들(보통 하나). */
  onRing(triggers: AlarmTrigger[]): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
}): { stop(): void; check(): void } {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined);
  // 저장소를 읽거나 쓰지 못해도 이 실행 동안은 기억한다.
  let memory: Fired = {};
  let timer: unknown;
  let stopped = false;

  const read = (): Fired => {
    let stored: Fired = {};
    try {
      const raw = deps.storage.getItem(FIRED_KEY);
      const parsed: unknown = raw === null ? {} : JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'number') stored[k] = v;
      }
    } catch {
      stored = {};
    }
    return { ...memory, ...stored };
  };

  const write = (fired: Fired): void => {
    memory = fired;
    try {
      if (Object.keys(fired).length === 0) deps.storage.removeItem(FIRED_KEY);
      else deps.storage.setItem(FIRED_KEY, JSON.stringify(fired));
    } catch {
      // 메모리에만 남는다
    }
  };

  const schedule = (t: number): void => {
    if (timer !== undefined) clearTimer(timer);
    // t 자신은 방금 울렸거나 울릴 것이므로 그 다음부터 찾는다.
    const next = allAlarmTriggers(deps.view.items(), new Date(t + 1), new Date(t + LOOK_AHEAD_MS))[0];
    const wait = next ? Math.min(MAX_WAIT_MS, Math.max(1, next.at.getTime() - t)) : MAX_WAIT_MS;
    timer = setTimer(check, wait);
  };

  function check(): void {
    if (stopped) return;
    const t = now();
    const fired = read();
    let dirty = false;
    for (const [k, at] of Object.entries(fired)) {
      if (t - at > KEEP_MS) { delete fired[k]; dirty = true; }
    }
    const due = allAlarmTriggers(deps.view.items(), new Date(t - LATE_MS), new Date(t + AHEAD_MS))
      .filter((x) => x.at.getTime() <= t && fired[x.key] !== x.at.getTime());
    // 울리기 전에 예정 시각을 적는다. 울리는 중에 던져도 다시 울리지 않고, 시각을 바꾼 알림은 새 시각에 다시 울린다.
    for (const x of due) fired[x.key] = x.at.getTime();
    if (dirty || due.length > 0) write(fired);
    else memory = fired;
    if (due.length > 0) deps.onRing(due);
    schedule(t);
  }

  const onVisible = (): void => {
    if (doc?.visibilityState === 'visible') check();
  };
  const offChange = deps.view.onChange(check);
  doc?.addEventListener('visibilitychange', onVisible);
  check();

  return {
    check,
    stop(): void {
      stopped = true;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      offChange();
      doc?.removeEventListener('visibilitychange', onVisible);
    },
  };
}
