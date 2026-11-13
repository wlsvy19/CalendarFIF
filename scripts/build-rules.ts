import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_UID = 'owner-test-uid';
// 규칙 문자열에 그대로 들어가므로 따옴표 등 특수문자는 허용하지 않는다. (시험용 uid의 '-'는 허용)
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function buildRules(template: string, ownerUid: string): string {
  if (!UID_PATTERN.test(ownerUid)) throw new Error('OWNER_UID 형식이 올바르지 않다');
  return template.replaceAll('__OWNER_UID__', ownerUid);
}

/** .env.local에서 키 하나의 값을 읽는다. 파일이나 키가 없으면 빈 문자열이다. */
export function readEnvLocalValue(key: string): string {
  if (!existsSync('.env.local')) return '';
  const line = readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}

function main(): void {
  const args = process.argv.slice(2);
  const i = args.indexOf('--uid');
  let uid: string;
  if (i >= 0) {
    uid = args[i + 1] ?? '';
  } else {
    uid = readEnvLocalValue('OWNER_UID');
    if (uid === '' || uid === TEST_UID) {
      console.error('.env.local의 OWNER_UID가 비었거나 시험용 값이다. 배포용 규칙은 만들지 않는다.');
      process.exit(1);
    }
  }
  try {
    const rules = buildRules(readFileSync('firestore.rules.template', 'utf8'), uid);
    mkdirSync('build', { recursive: true });
    writeFileSync('build/firestore.rules', rules);
    console.log('build/firestore.rules를 만들었다');
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
