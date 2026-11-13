import type { SyncStatus } from '../sync/engine';

export function startAutoFlush(
  engine: { flush(): Promise<void>; status(): SyncStatus },
  target: EventTarget,
  doc: { visibilityState: string },
  retryMs = 15000,
): () => void {
  const flush = () => {
    void engine.flush();
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') flush();
  };
  flush();
  target.addEventListener('online', flush);
  target.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(() => {
    if (engine.status().pending > 0) flush();
  }, retryMs);
  return () => {
    target.removeEventListener('online', flush);
    target.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
  };
}
