import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('배포가 데이터베이스를 만들 때 기본 데이터베이스를 서울 리전에 만든다', () => {
  const config = JSON.parse(readFileSync('firebase.json', 'utf8')) as { firestore: Record<string, unknown> };
  expect(config.firestore).toEqual({
    database: '(default)',
    location: 'asia-northeast3',
    rules: 'build/firestore.rules',
  });
});
