import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CSP, contentType, isAppUrl, resolveAppPath } from './protocol';

it('app://calfif/ 아래, 렌더러 폴더 안의 파일만 내준다', () => {
  const r = 'C:\\r';
  expect([resolveAppPath('app://calfif/', r), resolveAppPath('app://calfif/index.html?autologin=1#2026-11-13', r), resolveAppPath('app://calfif/assets/index-abc.js', r)])
    .toEqual([join(r, 'index.html'), join(r, 'index.html'), join(r, 'assets', 'index-abc.js')]);
  for (const bad of ['app://calfif/..%5C..%5Csecret.txt', 'app://calfif/a%00.js', 'app://other/index.html', 'https://calfif/index.html']) expect(resolveAppPath(bad, r)).toBeNull();
});
it('앱 주소만 앱 주소로 보고, 형식과 보안 정책을 붙인다', () => {
  expect([isAppUrl('app://calfif/index.html#2026-11-13'), isAppUrl('https://example.invalid/'), isAppUrl('app://calfif.evil/'), isAppUrl('not a url'), isAppUrl(undefined)]).toEqual([true, false, false, false, false]);
  expect([contentType('x.js'), contentType('x.css'), contentType('x.png'), contentType('x.bin')]).toEqual(['text/javascript; charset=utf-8', 'text/css; charset=utf-8', 'image/png', 'application/octet-stream']);
  expect([CSP.includes("script-src 'self'"), CSP.includes("frame-src 'none'")]).toEqual([true, true]);
});
