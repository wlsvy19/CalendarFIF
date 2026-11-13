// 앱 아이콘을 만든다. 파란 바탕에 흰 글자 F를 HTML로 그려 헤드리스 Edge로 찍는다.
// 사용법: npx tsx scripts/make-icons.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SIZES: [string, number][] = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

const outDir = resolve('public', 'icons');
const tmpDir = resolve('.tools', 'icons');
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

for (const [name, size] of SIZES) {
  const html = resolve(tmpDir, `${size}.html`);
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}
body{display:grid;place-items:center;background:#2550D0;color:#fff;
font:700 ${Math.round(size * 0.62)}px/1 "Segoe UI","Arial",sans-serif}
span{transform:translateY(-4%)}</style><body><span>F</span></body>`,
  );
  const out = resolve(outDir, name);
  const r = spawnSync(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${resolve('.tools', 'icons-profile')}`,
      `--window-size=${size},${size}`,
      '--force-device-scale-factor=1',
      `--screenshot=${out}`,
      pathToFileURL(html).href,
    ],
    { stdio: 'ignore', timeout: 60000 },
  );
  if (r.status !== 0) throw new Error(`Edge가 ${name}을 만들지 못했다: 종료 코드 ${r.status}, 신호 ${r.signal}, ${r.error?.message ?? ''}`);
  console.log(`저장: ${out}`);
}
