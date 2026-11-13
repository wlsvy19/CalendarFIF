import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { findJdkBin } from './jdk';

it('풀어 둔 JDK의 bin 폴더를 찾는다', () => {
  const tools = mkdtempSync(join(tmpdir(), 'calfif-tools-'));
  expect(findJdkBin(tools)).toBeNull();
  const bin = join(tools, 'jdk-21', 'jdk-21.0.13+11', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'java.exe'), '');
  expect(findJdkBin(tools)).toBe(bin);
});
