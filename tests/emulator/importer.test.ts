import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore/lite';
import { expect, it } from 'vitest';
import { LiteMonthStore } from '../../src/importer/liteStore';
import { rec } from '../../src/sync/testing';
import { OWNER } from './env';

it('Lite 어댑터로 달 문서를 쓰고 읽는다', async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  const db = getFirestore(initializeApp({ projectId: 'demo-calfif' }, `lite-${Date.now()}`));
  connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: OWNER } });
  const store = new LiteMonthStore(db, OWNER);
  const monthId = '2031-01';
  await store.transactMonth(monthId, () => ({ '13': rec('A', 'F12424', 100, 'import'), '14': rec('B') }));
  await store.transactMonth(monthId, () => ({ '14': 'delete' }));
  expect(await store.getMonth(monthId)).toEqual({ days: { '13': { text: 'A', color: 'F12424', editedAt: 100, editedBy: 'import' } } });
  expect(await store.getMonth('2031-02')).toBeNull();
});
