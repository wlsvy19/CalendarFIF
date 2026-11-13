import type { KeyValueStore } from '../sync/outbox';

const PROBE_KEY = 'calfif.storage-probe';

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/**
 * Opens the browser's localStorage for the edit queue. In Safari with all cookies blocked even reading
 * `window.localStorage` throws, so a failing getter or a failing probe write falls back to memory.
 */
export function openStorage(getLocalStorage: () => KeyValueStore = () => window.localStorage): {
  store: KeyValueStore;
  persistent: boolean;
} {
  try {
    const storage = getLocalStorage();
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return { store: storage, persistent: true };
  } catch {
    return { store: memoryStore(), persistent: false };
  }
}
