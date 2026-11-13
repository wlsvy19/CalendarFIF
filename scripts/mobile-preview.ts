// 폰 크기 Edge 창을 연다. 마우스로 끌면 터치 입력으로 전달된다. 창을 닫으면 끝난다.
// 사용법: npx tsx scripts/mobile-preview.ts [--url <주소>] [--with-vite]
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeEdgeByProfile, emulatePhone, findEdge, launchEdge, PHONE, previewProfile, startVite } from './cdp';
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

// 내 PC의 주소(에뮬레이터)는 프로필 폴더를 따로 써서, 실제 웹앱을 열어 둔 창과 로그인에 닿지 않는다.
const profileDir = resolve('.tools', previewProfile(url));
// 이미 열려 있는 창이 있으면 닫고 새로 연다. 그대로 띄우면 Edge가 새 프로세스를 띄우지 않고 빈 창만 하나 더 연다.
if ((await closeEdgeByProfile(profileDir)) > 0) console.log('먼저 열려 있던 폰 크기 창을 닫고 새로 엽니다.');

const vite = values['with-vite'] ? await startVite() : null;
// 창은 페이지 영역보다 제목 표시줄과 테두리만큼 크다.
const FRAME = { width: 16, height: 39 };
const { cdp, closed, kill } = await launchEdge({
  headless: false,
  profileDir,
  // 주소창 없는 창(--app)은 실제 주소를 줘야 열린다. about:blank를 주면 Edge가 일반 창을 열고, 일반 창은 500px보다 좁아지지 않는다.
  args: [`--app=${url}`, `--window-size=${PHONE.width + FRAME.width},${PHONE.height + FRAME.height}`],
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
  const realWidth = await cdp.evaluate<number>('window.innerWidth').catch(() => PHONE.width);
  await emulatePhone(cdp);
  await cdp.send('Page.navigate', { url }); // 폰으로 보이게 한 상태에서 처음부터 다시 연다
  console.log(`폰 크기 창을 열었습니다(${PHONE.width}x${PHONE.height}). 마우스로 끌면 터치로 전달됩니다. 창을 닫으면 끝납니다.`);
  if (realWidth > PHONE.width + 2) console.log(`창이 폰 폭보다 넓게 열렸습니다(${realWidth}px). 오른쪽에 빈 곳이 남습니다.`);
  await closed;
} finally {
  stop();
}
process.exit(0);
