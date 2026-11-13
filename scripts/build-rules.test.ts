import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildRules } from './build-rules';

const template = readFileSync('firestore.rules.template', 'utf8');

it('uid를 규칙에 넣는다', () => {
  const rules = buildRules(template, 'abc123');
  expect(rules).toContain("'abc123'");
  expect(rules).not.toContain('__OWNER_UID__');
});
it('빈 uid나 이상한 uid는 거부한다', () => {
  expect(() => buildRules(template, '')).toThrow();
  expect(() => buildRules(template, "a' || true || '")).toThrow();
});
