// 앱 아이콘 파일을 만든다. scripts/icon-art.ts의 그림(SVG)을 헤드리스 Edge로 크기마다 그려 PNG로 받는다.
// 사용법: npx tsx scripts/make-icons.ts
// 만드는 것(모두 git에 올린다):
//   public/icons/icon-192.png, icon-512.png, apple-touch-icon.png  웹앱과 아이폰 홈 화면(네모를 꽉 채운 그림)
//   public/icons/tray.png, tray@1.25x.png, tray@1.5x.png, tray@2x.png  PC 앱의 트레이(작은 크기용 단순한 그림, 화면 배율별)
//   public/favicon.ico  브라우저 탭과 PC 앱 실행 파일의 아이콘(16~32는 단순한 그림, 48~256은 모서리를 깎은 큰 그림)
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchEdge } from './cdp';
import { buildIco, pngSize } from './ico';
import { appIconSvg, smallIconSvg } from './icon-art';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iconsDir = resolve('public', 'icons');
const tmpDir = resolve('.tools', 'icons');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const { cdp, kill } = await launchEdge({ headless: true, profileDir: resolve('.tools', 'icons-profile') });
let shots = 0;

/** 그림을 size x size로 그려 PNG로 돌려준다. 그림 밖은 비운다(투명). */
async function render(svg: string, size: number): Promise<Buffer> {
  shots += 1;
  const html = resolve(tmpDir, 'icon.html');
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>${shots}</title><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await cdp.send('Page.navigate', { url: `${pathToFileURL(html).href}?n=${shots}` });
  for (let i = 0; ; i += 1) {
    const ready = await cdp.evaluate<boolean>(`document.readyState === 'complete' && document.title === '${shots}' && !!document.querySelector('svg')`).catch(() => false);
    if (ready) break;
    if (i > 100) throw new Error(`그림 쪽이 열리지 않았다 (${size}px)`);
    await sleep(50);
  }
  await sleep(100);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
  const png = Buffer.from(shot.data as string, 'base64');
  const real = pngSize(png);
  if (!real || real.width !== size || real.height !== size) throw new Error(`${size}px로 찍으려 했는데 ${real?.width}x${real?.height}가 나왔다`);
  return png;
}

function save(path: string, data: Uint8Array): void {
  writeFileSync(path, data);
  console.log(`저장: ${path}`);
}

try {
  await cdp.send('Page.enable');
  const full = appIconSvg({ rounded: false });
  const rounded = appIconSvg({ rounded: true });
  const small = smallIconSvg();
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const) save(resolve(iconsDir, name), await render(full, size));
  for (const [name, size] of [['tray.png', 16], ['tray@1.25x.png', 20], ['tray@1.5x.png', 24], ['tray@2x.png', 32]] as const) save(resolve(iconsDir, name), await render(small, size));
  const ico = [];
  for (const size of [16, 24, 32]) ico.push({ size, png: await render(small, size) });
  for (const size of [48, 64, 128, 256]) ico.push({ size, png: await render(rounded, size) });
  save(resolve('public', 'favicon.ico'), buildIco(ico));
  cdp.close();
} finally {
  kill();
}
process.exit(0);
