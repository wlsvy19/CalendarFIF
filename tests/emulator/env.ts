import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { buildRules } from '../../scripts/build-rules';

export const OWNER = 'owner-test-uid';

export async function createEnv(): Promise<RulesTestEnvironment> {
  const rules = buildRules(readFileSync('firestore.rules.template', 'utf8'), OWNER);
  const hostAndPort = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
  const i = hostAndPort.lastIndexOf(':');
  return initializeTestEnvironment({
    projectId: 'demo-calfif',
    firestore: { rules, host: hostAndPort.slice(0, i), port: Number(hostAndPort.slice(i + 1)) },
  });
}

export function ownerDb(env: RulesTestEnvironment): Firestore {
  return env.authenticatedContext(OWNER).firestore() as unknown as Firestore;
}
export function otherDb(env: RulesTestEnvironment): Firestore {
  return env.authenticatedContext('someone-else').firestore() as unknown as Firestore;
}
export function anonDb(env: RulesTestEnvironment): Firestore {
  return env.unauthenticatedContext().firestore() as unknown as Firestore;
}
