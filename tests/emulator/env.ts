import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { buildRules } from '../../scripts/build-rules';

export const OWNER = 'owner-test-uid';
export const USER = 'user-test-uid';

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
export function userDb(env: RulesTestEnvironment): Firestore {
  return env.authenticatedContext(USER).firestore() as unknown as Firestore;
}
export function otherDb(env: RulesTestEnvironment): Firestore {
  return env.authenticatedContext('someone-else').firestore() as unknown as Firestore;
}
export function anonDb(env: RulesTestEnvironment): Firestore {
  return env.unauthenticatedContext().firestore() as unknown as Firestore;
}

// 규칙을 끄고 문서를 미리 써 둔다(사용 허가 문서 준비용).
export async function seedDocs(env: RulesTestEnvironment, docs: Record<string, Record<string, unknown>>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [path, data] of Object.entries(docs)) await db.doc(path).set(data);
  });
}
