// 폰 크기 Edge 창을 연다. 마우스로 끌면 터치 입력으로 전달된다. 창을 닫으면 끝난다.
// 사용법: npx tsx scripts/mobile-preview.ts [--url <주소>] [--with-vite]
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { emulatePhone, findEdge, launchEdge, PHONE, startVite } from './cdp';
import { readEnvLocalValue } from './build-rules';

const { values } = parseArgs({ options: { url: { type: 'string' }, 'with-vite': { type: 'boolean', default: false } } });

if (!findEdge()) {
  console.error('Microsoft Edge를 찾지 못했습니다.');
  process.exit(1);
}
let url = values.url;
if (!url) {
  const projectId = readEnvLocalValue('VITE_FIREBASE_PROJECT_ID');
  if (!projectId) {
    console.error('.env.local에 VITE_FIREBASE_PROJECT_ID가 없습니다. --url로 주소를 주거나 npm run mobile:emu를 쓰세요.');
    process.exit(1);
  }
  url = `https://${projectId}.web.app`;
}

const vite = values['with-vite'] ? await startVite() : null;
// 창은 페이지 영역보다 제목 표시줄과 테두리만큼 크다.
const FRAME = { width: 16, height: 39 };
const { cdp, closed, kill } = await launchEdge({
  headless: false,
  profileDir: resolve('.tools', 'edge-profile-mobile'),
  args: ['--app=about:blank', `--window-size=${PHONE.width + FRAME.width},${PHONE.height + FRAME.height}`],
});
const stop = (): void => {
  kill();
  vite?.stop();
};
process.once('SIGINT', () => {
  stop();
  process.exit(0);
});
try {
  await cdp.send('Page.enable');
  await emulatePhone(cdp);
  await cdp.send('Page.navigate', { url });
  console.log(`폰 크기 창을 열었습니다(${PHONE.width}x${PHONE.height}). 마우스로 끌면 터치로 전달됩니다. 창을 닫으면 끝납니다.`);
  await closed;
} finally {
  stop();
}
process.exit(0);
