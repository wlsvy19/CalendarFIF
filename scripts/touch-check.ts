// 실제 터치 입력(Input.dispatchTouchEvent)으로 웹앱의 달 넘기기와 날짜 열기를 확인한다.
// 달 넘기기는 브라우저의 스크롤이므로, 페이지 안에서 scroll 이벤트마다 위치를 적어 두고 그것을 본다.
// 사용법: npx tsx scripts/touch-check.ts --url <주소> [--with-vite]
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { emulatePhone, launchEdge, PHONE, startVite, type Cdp } from './cdp';

/**
 * 손가락이 닿아 있는 동안 적힌 위치들이 손가락을 따라갔는가: 거꾸로 간 걸음이 없고 start에서 minTravel 이상 갔다.
 * 손가락을 왼쪽으로 밀면 scrollLeft가 커진다.
 */
export function followsFinger(positions: number[], start: number, direction: 'left' | 'right', minTravel = 200): boolean {
  const sign = direction === 'left' ? 1 : -1;
  let previous = start;
  for (const p of positions) {
    if ((p - previous) * sign < 0) return false;
    previous = p;
  }
  return (previous - start) * sign >= minTravel;
}

/** 스크롤 위치가 칸의 시작에 맞는가. 기기 화소로 반올림된 만큼만 봐준다. */
export function onSlot(left: number, width: number): boolean {
  return width > 0 && Math.abs(left - Math.round(left / width) * width) < 0.5;
}

/** from과 to 사이(양 끝은 빼고)에 적힌 위치의 수. 움직임이 몇 단계로 보였는지 센다. */
export function between(positions: number[], from: number, to: number): number {
  const [low, high] = from < to ? [from, to] : [to, from];
  return positions.filter((p) => p > low + 0.5 && p < high - 0.5).length;
}

/** `2026년 11월` 같은 제목 두 개 사이의 달 수. 읽을 수 없으면 null. */
export function monthDelta(before: string, after: string): number | null {
  const index = (title: string): number | null => {
    const m = /(\d+)년\s*(\d+)월/.exec(title);
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
  };
  const [a, b] = [index(before), index(after)];
  return a === null || b === null ? null : b - a;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MOVE_GAP_MS = 8; // 표본이 40ms보다 벌어지면 Chromium은 손가락이 멈췄다고 보고 튕기지 않는다
const TITLE_JS = "document.querySelector('.year').textContent + ' ' + document.querySelector('.month').textContent";
const VIEW_JS = `(() => { const p = document.querySelector('.pager'); return { title: ${TITLE_JS}, left: p.scrollLeft, width: p.getBoundingClientRect().width }; })()`;
// 페이지 안의 기록: scroll마다의 위치, 손을 떼기 직전까지 적힌 수(upAt), 마지막 scroll 시각, 긴 작업(50ms 이상) 수.
// upAt은 확인 쪽이 touchEnd를 보내기 직전에 적는다. 끄는 중에 손가락 밑의 칸이 다시 그려지면 touchend가 떨어져 나간
// 칸으로만 가서 페이지의 리스너에 오지 않기 때문이다(브라우저의 스크롤은 그대로 이어진다).
const RECORDER_JS = `(() => {
  const pager = document.querySelector('.pager');
  const log = { scrolls: [], upAt: -1, lastAt: performance.now(), longTasks: 0 };
  pager.addEventListener('scroll', () => { log.scrolls.push(pager.scrollLeft); log.lastAt = performance.now(); }, { passive: true });
  new PerformanceObserver((list) => { log.longTasks += list.getEntries().length; }).observe({ type: 'longtask' });
  window.__touchLog = log;
})()`;
const RESET_JS = '__touchLog.scrolls = []; __touchLog.upAt = -1; __touchLog.lastAt = performance.now();';

type View = { title: string; left: number; width: number };
type Result = { name: string; ok: boolean; seen: string };
type Gesture = { before: View; after: View; down: number[]; all: number[] };

async function run(cdp: Cdp, url: string): Promise<Result[]> {
  const results: Result[] = [];
  const record = (name: string, ok: boolean, seen: string): void => {
    results.push({ name, ok, seen });
    console.log(`${ok ? '통과' : '실패'}: ${name} (${seen})`);
  };
  const touch = (type: string, x?: number, y?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y, id: 1 }] });
  const view = () => cdp.evaluate<View>(VIEW_JS);
  /** elementJs는 요소 하나를 돌려주는 식이다. */
  const center = (elementJs: string) =>
    cdp.evaluate<{ x: number; y: number }>(
      `(() => { const r = (${elementJs}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
  const $ = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

  /** 스크롤이 400ms 동안 조용해질 때까지 기다린다(도움이 끼어드는 80ms와 부드러운 스크롤을 넉넉히 넘긴다). */
  async function rest(): Promise<void> {
    await sleep(300);
    for (let i = 0; i < 40; i++) {
      if ((await cdp.evaluate<number>('performance.now() - __touchLog.lastAt')) >= 400) return;
      await sleep(100);
    }
  }
  async function recorded(): Promise<{ all: number[]; down: number[] }> {
    const log = await cdp.evaluate<{ scrolls: number[]; upAt: number }>('({ scrolls: __touchLog.scrolls, upAt: __touchLog.upAt })');
    return { all: log.scrolls, down: log.upAt < 0 ? log.scrolls : log.scrolls.slice(0, log.upAt) };
  }

  /** 손가락을 from에서 by만큼 steps번에 나눠 촘촘히 움직이고, holdMs만큼 멈췄다가 뗀다. 스크롤이 멈출 때까지 기다린다. */
  async function gesture(from: [number, number], by: [number, number], steps: number, holdMs = 0): Promise<Gesture> {
    await cdp.evaluate(RESET_JS);
    const before = await view();
    await touch('touchStart', from[0], from[1]);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from[0] + (by[0] * i) / steps, from[1] + (by[1] * i) / steps);
      await sleep(MOVE_GAP_MS);
    }
    if (holdMs > 0) await sleep(holdMs);
    await cdp.evaluate('__touchLog.upAt = __touchLog.scrolls.length');
    await touch('touchEnd');
    await rest();
    return { before, after: await view(), ...(await recorded()) };
  }
  async function tap(at: { x: number; y: number }): Promise<void> {
    await touch('touchStart', at.x, at.y);
    await sleep(60);
    await touch('touchEnd');
  }
  /** 다음 달 단추를 손가락으로 누르고 스크롤이 멈출 때까지 기다린다. */
  async function pressNext(): Promise<Gesture> {
    await cdp.evaluate(RESET_JS);
    const before = await view();
    await tap(await center($('[aria-label="다음 달"]')));
    await rest();
    return { before, after: await view(), ...(await recorded()) };
  }

  const delta = (g: Gesture) => monthDelta(g.before.title, g.after.title);
  const restText = (v: View) => (onSlot(v.left, v.width) ? `칸 ${Math.round(v.left / v.width)}` : `칸 사이 ${Math.round(v.left)}px`);
  const describe = (g: Gesture) => {
    const rel = g.down.map((p) => Math.round(p - g.before.left));
    const down = rel.length > 0 ? `${rel.length}번 ${Math.min(...rel)}..${Math.max(...rel)}px` : '움직임 없음';
    return `${g.before.title} -> ${g.after.title}, 누르는 동안 ${down}, 멈춘 곳 ${restText(g.after)}`;
  };

  await cdp.send('Page.enable');
  await emulatePhone(cdp);
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    if (await cdp.evaluate<boolean>("!!document.querySelector('.grid.current .cell')").catch(() => false)) break;
    await sleep(300);
  }
  await sleep(1500); // 첫 자리 잡기와 첫 스냅숏이 끝나게 한다
  await cdp.evaluate(RECORDER_JS);
  const pagerY = (await center($('.pager'))).y;
  const start = (await view()).title;

  // 1~6: 손가락으로 넘기기. 이 동안의 긴 작업을 센다.
  let g = await gesture([340, pagerY], [-280, 0], 28);
  record(
    '왼쪽으로 280px 밀고 움직이는 채 떼면 손가락을 따라가다 다음 달 칸에 멈춘다',
    followsFinger(g.down, g.before.left, 'left') && delta(g) === 1 && onSlot(g.after.left, g.after.width),
    describe(g),
  );
  const right = [await gesture([60, pagerY], [280, 0], 28), await gesture([60, pagerY], [280, 0], 28)];
  record(
    '오른쪽으로 두 번 밀면 처음 달로, 그리고 한 달 더 전으로 간다',
    right.every((r) => followsFinger(r.down, r.before.left, 'right') && delta(r) === -1 && onSlot(r.after.left, r.after.width)) &&
      right[0].after.title === start,
    right.map(describe).join(' / '),
  );
  const light = [await gesture([220, pagerY], [-40, 0], 6), await gesture([180, pagerY], [40, 0], 6)];
  record('40px만 밀고 움직이는 채 떼도 넘어가고, 반대로 밀면 돌아온다', delta(light[0]) === 1 && delta(light[1]) === -1, light.map(describe).join(' / '));
  const held = [await gesture([220, pagerY], [-40, 0], 6, 150), await gesture([180, pagerY], [40, 0], 6, 150)];
  record('40px 밀고 150ms 멈췄다 떼도 넘어가고, 반대로 하면 돌아온다', delta(held[0]) === 1 && delta(held[1]) === -1, held.map(describe).join(' / '));
  g = await gesture([200, pagerY], [12, 0], 6);
  const tapped = await cdp.evaluate<boolean>("!!document.querySelector('.sheet')");
  record('12px만 움직이면 달이 바뀌지 않는다', delta(g) === 0, `${describe(g)}${tapped ? ', 누른 것으로 보고 편집 화면을 열었다' : ''}`);
  if (tapped) {
    await cdp.evaluate("document.querySelector('.sheet .textbtn.start').click()");
    await sleep(600);
  }
  g = await gesture([330, pagerY], [-250, 0], 5);
  record('세게 튕겨도 한 달만 넘어간다', delta(g) === 1, describe(g));
  const longTasks = await cdp.evaluate<number>('__touchLog.longTasks');

  await tap(await center("document.querySelectorAll('.grid.current .cell:not(.other)')[14]"));
  await sleep(600);
  const opened = await cdp.evaluate<boolean>("!!document.querySelector('.sheet')");
  record('지금 쪽의 날짜 칸을 짧게 누르면 편집 화면이 열린다', opened, opened ? '.sheet 있음' : '.sheet 없음');
  if (opened) {
    await cdp.evaluate("document.querySelector('.sheet .textbtn.start').click()");
    await sleep(600);
  }

  g = await gesture([200, pagerY - 150], [0, 300], 30);
  record('세로로 300px 끌면 달이 바뀌지 않는다', delta(g) === 0, describe(g));

  g = await pressNext();
  const steps = between(g.all, g.before.left, g.after.left);
  record(
    '다음 달 단추는 다음 달 칸까지 움직여 가며 넘긴다',
    delta(g) === 1 && onSlot(g.after.left, g.after.width) && steps > 3,
    `${g.before.title} -> ${g.after.title}, 중간 위치 ${steps}개, 멈춘 곳 ${restText(g.after)}`,
  );

  const pages = await cdp.evaluate<number[]>(
    "[document.querySelectorAll('.pager .grid').length, document.querySelectorAll('.pager .grid.current').length, document.querySelectorAll('.pager .grid[inert]').length]",
  );
  record('쪽 세 개가 붙어 있고 하나만 지금 쪽이며 나머지 둘은 inert다', pages.join() === '3,1,2', `쪽 ${pages[0]}개, 지금 쪽 ${pages[1]}개, inert ${pages[2]}개`);

  const upright = await view();
  const turned: View[] = [];
  for (const [width, height] of [[PHONE.height, PHONE.width], [PHONE.width, PHONE.height]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: PHONE.deviceScaleFactor, mobile: true });
    await sleep(500);
    await rest();
    turned.push(await view());
  }
  record(
    '폰을 가로로 돌렸다가 되돌려도 같은 달이고 칸에 맞는다',
    turned.every((v) => v.title === upright.title && onSlot(v.left, v.width)),
    turned.map((v) => `폭 ${Math.round(v.width)}: ${v.title}, ${restText(v)}`).join(' / '),
  );

  await emulatePhone(cdp, { reducedMotion: true });
  await sleep(500);
  g = await pressNext();
  const reducedSteps = between(g.all, g.before.left, g.after.left);
  record(
    '움직임 줄이기에서는 다음 달 단추가 움직임 없이 바로 넘긴다',
    delta(g) === 1 && reducedSteps === 0,
    `${g.before.title} -> ${g.after.title}, 중간 위치 ${reducedSteps}개`,
  );

  record('손가락으로 넘기는 동안(1~6) 50ms 넘는 긴 작업이 없다', longTasks === 0, `긴 작업 ${longTasks}개`);
  return results;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { url: { type: 'string' }, 'with-vite': { type: 'boolean', default: false } } });
  if (!values.url) {
    console.error('사용법: tsx scripts/touch-check.ts --url <주소> [--with-vite]');
    process.exit(1);
  }
  const vite = values['with-vite'] ? await startVite() : null;
  const { cdp, kill } = await launchEdge({
    headless: true,
    profileDir: resolve('.tools', 'edge-profile-touch'),
    args: [`--window-size=${PHONE.width},${PHONE.height}`],
  });
  let passed = false;
  try {
    passed = (await run(cdp, values.url)).every((x) => x.ok);
  } catch (e) {
    console.error(`실패: 확인을 끝내지 못했다 (${(e as Error).message})`);
  } finally {
    cdp.close();
    kill();
    vite?.stop();
  }
  process.exit(passed ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
