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
// 움직이는 채 뗀 손가락은 튕기기(fling)를 남긴다. 아무것도 스크롤되지 않았어도(세로로 끈 경우) 그렇다. 튕기기가 끝나기 전에
// 누르면 Chromium은 그것을 "튕기기 멈추기"로 먹어 버리고 click을 내지 않는다(300ms 뒤 누르기: 16번 중 7번 무시, 1500ms 뒤: 0번).
// 그래서 누르기 전에는 마지막으로 움직이는 채 뗀 때부터 이만큼 기다린다.
const FLING_OVER_MS = 1500;
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
/** 시트가 나타날 때까지 기다렸다가 afterMs 뒤의 위치를 읽는다(시트가 없으면 null). */
const SHEET_TOP_JS = (afterMs: number) => `new Promise((resolve) => {
  const started = performance.now();
  const wait = () => {
    if (document.querySelector('.sheet')) return setTimeout(() => { const s = document.querySelector('.sheet'); resolve(s ? s.getBoundingClientRect().top : null); }, ${afterMs});
    if (performance.now() - started > 3000) return resolve(null);
    setTimeout(wait, 5);
  };
  wait();
})`;
/** afterMs 뒤의 시트 위치. 시트가 이미 없으면 null. */
const SHEET_NOW_JS = (afterMs: number) => `new Promise((resolve) => setTimeout(() => { const s = document.querySelector('.sheet'); resolve(s ? s.getBoundingClientRect().top : null); }, ${afterMs}))`;
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
  /** timestamp(초, 1970년부터)를 주면 그것이 이벤트가 일어난 시각이 된다. */
  const touch = (type: string, x?: number, y?: number, timestamp?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y, id: 1 }], ...(timestamp === undefined ? {} : { timestamp }) });
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

  let releasedMovingAt = 0; // 마지막으로 움직이는 채 손가락을 뗀 시각(FLING_OVER_MS 참고)

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
    if (holdMs === 0) releasedMovingAt = Date.now();
    await rest();
    return { before, after: await view(), ...(await recorded()) };
  }
  /** 짧게 누른다. 앞의 손짓이 남긴 튕기기가 끝난 뒤에 누른다(FLING_OVER_MS). */
  async function tap(at: { x: number; y: number }): Promise<void> {
    const flingLeft = releasedMovingAt + FLING_OVER_MS - Date.now();
    if (flingLeft > 0) await sleep(flingLeft);
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

  // 1~6: 손가락으로 넘기기. 이 동안의 긴 작업을 센다. 결과는 첫 번째에만 적는다. 긴 작업이 보이면(PC가 바쁜 탓일 수 있다)
  // 같은 손짓을 한 번 더 하고, 두 번 다 있어야 실패로 본다. 손짓은 한 바퀴 돌면 처음 달로 돌아온다.
  let g: Gesture;
  async function swipes(report: boolean): Promise<number> {
    const check = report ? record : () => {};
    await cdp.evaluate('__touchLog.longTasks = 0');
    g = await gesture([340, pagerY], [-280, 0], 28);
    check(
      '왼쪽으로 280px 밀고 움직이는 채 떼면 손가락을 따라가다 다음 달 칸에 멈춘다',
      followsFinger(g.down, g.before.left, 'left') && delta(g) === 1 && onSlot(g.after.left, g.after.width),
      describe(g),
    );
    const right = [await gesture([60, pagerY], [280, 0], 28), await gesture([60, pagerY], [280, 0], 28)];
    check(
      '오른쪽으로 두 번 밀면 처음 달로, 그리고 한 달 더 전으로 간다',
      right.every((r) => followsFinger(r.down, r.before.left, 'right') && delta(r) === -1 && onSlot(r.after.left, r.after.width)) &&
        right[0].after.title === start,
      right.map(describe).join(' / '),
    );
    const light = [await gesture([220, pagerY], [-40, 0], 6), await gesture([180, pagerY], [40, 0], 6)];
    check('40px만 밀고 움직이는 채 떼도 넘어가고, 반대로 밀면 돌아온다', delta(light[0]) === 1 && delta(light[1]) === -1, light.map(describe).join(' / '));
    const held = [await gesture([220, pagerY], [-40, 0], 6, 150), await gesture([180, pagerY], [40, 0], 6, 150)];
    check('40px 밀고 150ms 멈췄다 떼도 넘어가고, 반대로 하면 돌아온다', delta(held[0]) === 1 && delta(held[1]) === -1, held.map(describe).join(' / '));
    g = await gesture([200, pagerY], [12, 0], 6);
    const tapped = await cdp.evaluate<boolean>("!!document.querySelector('.sheet')");
    check('12px만 움직이면 달이 바뀌지 않는다', delta(g) === 0, `${describe(g)}${tapped ? ', 누른 것으로 보고 편집 화면을 열었다' : ''}`);
    if (tapped) {
      await cdp.evaluate("document.querySelector('.sheet .textbtn.start').click()");
      await sleep(600);
    }
    g = await gesture([330, pagerY], [-250, 0], 5);
    check('세게 튕겨도 한 달만 넘어간다', delta(g) === 1, describe(g));
    return cdp.evaluate<number>('__touchLog.longTasks');
  }
  const longTasks = await swipes(true);
  const longTasksAgain = longTasks > 0 ? await swipes(false) : null;

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

  // 시트가 미끄러져 열리고 닫힌다.
  const dayCell = "document.querySelectorAll('.grid.current .cell:not(.other)')[14]";
  await tap(await center(dayCell));
  const openingTop = await cdp.evaluate<number | null>(SHEET_TOP_JS(60));
  await sleep(700);
  const restTops: Array<number | null> = [await cdp.evaluate<number | null>(SHEET_NOW_JS(0))];
  restTops.push(await cdp.evaluate<number | null>(SHEET_NOW_JS(100)));
  const restTop = restTops[0] ?? 0;
  record(
    '편집 화면은 아래에서 미끄러져 올라오고, 멈춘 자리는 전과 같다',
    openingTop !== null && openingTop > restTop + 20 && restTops[0] === restTops[1] && Math.abs(restTop - 24) <= 1,
    `열린 지 60ms 뒤 top ${openingTop === null ? '없음' : Math.round(openingTop)}px, 멈춘 뒤 ${restTops.map((t) => (t === null ? '없음' : Math.round(t))).join(', ')}px`,
  );
  await tap(await center($('.sheet .textbtn.start')));
  const closingTop = await cdp.evaluate<number | null>(SHEET_NOW_JS(60));
  await sleep(500);
  const leftOver = await cdp.evaluate<number>("document.querySelectorAll('.sheet, .scrim').length");
  record(
    '취소하면 시트가 아래로 미끄러져 내려간 뒤 사라진다',
    closingTop !== null && closingTop > restTop + 5 && leftOver === 0,
    `닫은 지 60ms 뒤 top ${closingTop === null ? '없음' : Math.round(closingTop)}px, 500ms 뒤 .sheet/.scrim ${leftOver}개`,
  );

  // 들어오는 중에 닫아도 시트가 위로 튀지 않고 있던 자리에서 내려간다.
  await tap(await center(dayCell));
  // 시트가 움직이는 중에는 단추의 자리가 계속 바뀌어 손가락을 정확히 댈 수 없으므로, 시트가 나타난 120ms 뒤에 단추를 누른 것으로 한다.
  await cdp.evaluate(`new Promise((resolve) => {
    const started = performance.now();
    const wait = () => {
      const s = document.querySelector('.sheet');
      if (s) return setTimeout(() => { s.querySelector('.textbtn.start').click(); resolve(null); }, 120);
      if (performance.now() - started > 3000) return resolve(null);
      setTimeout(wait, 5);
    };
    wait();
  })`);
  const tops = await cdp.evaluate<Array<number | null>>(
    `new Promise((resolve) => { const out = []; let n = 0; const read = () => { const s = document.querySelector('.sheet'); out.push(s ? s.getBoundingClientRect().top : null); if (++n < 6) setTimeout(read, 40); else resolve(out); }; read(); })`,
  );
  await sleep(500);
  const goneAfter = await cdp.evaluate<number>("document.querySelectorAll('.sheet, .scrim').length");
  const seen = tops.filter((t): t is number => t !== null);
  record(
    '들어오는 중에 취소해도 시트가 위로 움직이지 않고 내려가서 사라진다',
    seen.length > 0 && seen.every((t, i) => i === 0 || t >= seen[i - 1]) && goneAfter === 0,
    `top ${tops.map((t) => (t === null ? '없음' : Math.round(t))).join(', ')}px, 500ms 뒤 .sheet/.scrim ${goneAfter}개`,
  );

  // 끌어 내려 닫기(sheetSwipe.ts): 끄는 동안 시트가 손가락을 따라오고, 놓으면 닫히거나 제자리로 돌아간다.
  type SheetNow = { top: number; inline: string; moving: boolean } | null;
  const sheetNow = () =>
    cdp.evaluate<SheetNow>(
      "(() => { const s = document.querySelector('.sheet'); return s ? { top: s.getBoundingClientRect().top, inline: s.style.transform, moving: s.getAnimations().some((a) => a.playState === 'running') } : null; })()",
    );
  const px = (n: number | null | undefined) => (n === null || n === undefined ? '없음' : `${Math.round(n * 10) / 10}px`);
  // 저장은 먼저 대기열(localStorage의 calfif.outbox.*)에 적힌다. 적힌 횟수를 센다.
  await cdp.evaluate(`(() => {
    if (window.__outboxWrites !== undefined) return;
    window.__outboxWrites = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('calfif.outbox.')) window.__outboxWrites++; return set.call(this, k, v); };
  })()`);
  const outboxWrites = () => cdp.evaluate<number>('window.__outboxWrites');
  const cellText = () => cdp.evaluate<string>(`(${dayCell}).textContent`);
  /** 시트가 나타나 자리를 잡을 때까지 기다린 뒤 멈춘 자리(top)를 돌려준다. 나타나지 않으면 null. */
  async function sheetSettled(): Promise<number | null> {
    if ((await cdp.evaluate<number | null>(SHEET_TOP_JS(0))) === null) return null;
    await sleep(700);
    return (await sheetNow())?.top ?? null;
  }
  const openDay = async (): Promise<number | null> => {
    await tap(await center(dayCell));
    return sheetSettled();
  };
  /** from에서 아래로 dy만큼 steps번에 나눠 끌고, holdMs만큼 멈췄다가 뗀다. follow이면 걸음마다 시트의 top을 읽는다. */
  async function pull(
    from: { x: number; y: number },
    dy: number,
    steps: number,
    opts: { holdMs?: number; follow?: boolean } = {},
  ): Promise<{ follow: Array<{ finger: number; top: number | null }> }> {
    const follow: Array<{ finger: number; top: number | null }> = [];
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= steps; i++) {
      const finger = (dy * i) / steps;
      await touch('touchMove', from.x, from.y + finger);
      if (opts.follow) follow.push({ finger, top: (await sheetNow())?.top ?? null });
      await sleep(MOVE_GAP_MS);
    }
    if (opts.holdMs) await sleep(opts.holdMs);
    await touch('touchEnd');
    if (!opts.holdMs) releasedMovingAt = Date.now();
    return { follow };
  }
  /**
   * 걸음마다 읽은 시트 자리가 손가락을 따라갔는가. 움직이기 시작한 뒤로는 걸음마다 손가락과 같은 만큼(±1.5px) 내려가고,
   * 처음 움직일 때 한 걸음보다 크게 튀지 않으며, 끝에서 손가락보다 25px 넘게 뒤처지지 않아야 한다.
   * Chromium은 처음 몇 px(이 확인에서는 10px)의 touchmove를 페이지에 보내지 않으므로 시트는 그만큼 늦게 출발한다.
   */
  function followed(samples: Array<{ finger: number; top: number | null }>, rest: number | null, step: number): { ok: boolean; text: string } {
    if (rest === null || samples.length === 0 || samples.some((s) => s.top === null)) return { ok: false, text: '시트를 읽지 못함' };
    const offsets = samples.map((s) => (s.top as number) - rest);
    let worst = 0;
    let start = -1;
    offsets.forEach((o, i) => {
      const before = i === 0 ? 0 : offsets[i - 1];
      const d = o - before;
      worst = Math.max(worst, before > 0.5 ? Math.abs(d - step) : Math.max(0, d - step), o < -0.5 ? -o : 0);
      if (start < 0 && o > 0.5) start = i;
    });
    const lag = samples[samples.length - 1].finger - offsets[offsets.length - 1];
    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      ok: worst <= 1.5 && lag <= 25,
      text: `${samples.length}걸음 중 ${start + 1}번째부터 움직임, 걸음마다 손가락과 어긋난 값 최대 ${r(worst)}px, 끝에서 손가락보다 ${r(lag)}px 뒤`,
    };
  }
  const titleBar = () => center($('.sheet .sheet-bar h3'));

  const restA = await openDay();
  const grabber = await cdp.evaluate<{ content: string; width: string; height: string; color: string; barTop: number } | null>(`(() => {
    const s = document.querySelector('.sheet');
    if (!s) return null;
    const b = getComputedStyle(s, '::before');
    return { content: b.content, width: b.width, height: b.height, color: b.backgroundColor, barTop: s.querySelector('.sheet-bar').getBoundingClientRect().top - s.getBoundingClientRect().top };
  })()`);
  record(
    '폰 화면의 시트 위 가운데에 손잡이 막대(36x5px)가 있고 제목 줄은 그 아래에서 시작한다',
    grabber !== null && grabber.content !== 'none' && grabber.width === '36px' && grabber.height === '5px' && grabber.barTop >= 15,
    grabber ? `막대 ${grabber.width} x ${grabber.height}, 색 ${grabber.color}, 제목 줄은 시트 위에서 ${Math.round(grabber.barTop)}px` : '시트 없음',
  );
  const beforeA = { text: await cellText(), writes: await outboxWrites() };
  const slow = await pull(await titleBar(), 300, 30, { holdMs: 150, follow: true });
  await sleep(600);
  const afterA = { sheet: await sheetNow(), text: await cellText(), writes: await outboxWrites() };
  const followA = followed(slow.follow, restA, 10);
  record(
    '편집 화면을 제목 줄에서 천천히 300px 끌어 내리면 시트가 손가락을 따라오고, 놓으면 닫히며 아무것도 저장하지 않는다',
    followA.ok && slow.follow.length === 30 && afterA.sheet === null && afterA.text === beforeA.text && afterA.writes === beforeA.writes,
    `멈춘 자리 ${px(restA)}, 끄는 동안 top ${slow.follow.slice(0, 4).map((s) => px(s.top)).join(', ')}..${px(slow.follow.at(-1)?.top)}(${followA.text}), 놓은 뒤 시트 ${afterA.sheet ? '있음' : '없음'}, 칸 글 ${afterA.text === beforeA.text ? '그대로' : '바뀜'}, 대기열 쓰기 ${afterA.writes - beforeA.writes}번`,
  );

  const restB = await openDay();
  await pull(await titleBar(), 40, 8, { holdMs: 150 });
  const springing = await sheetNow();
  await sleep(400);
  const settledB = await sheetNow();
  const swatch = "document.querySelectorAll('.sheet .swatch')[3]";
  await tap(await center(swatch));
  await sleep(150);
  const picked = await cdp.evaluate<boolean>(`(${swatch})?.getAttribute('aria-checked') === 'true'`);
  record(
    '40px만 끌고 멈췄다 놓으면 닫히지 않고 제자리로 돌아가며, 그 뒤에도 색 단추가 눌린다',
    restB !== null && springing !== null && springing.moving && settledB !== null && Math.abs(settledB.top - restB) <= 1 && settledB.inline === '' && !settledB.moving && picked,
    `멈춘 자리 ${px(restB)}, 놓은 직후 ${springing ? `top ${px(springing.top)}, 움직임 ${springing.moving ? '있음' : '없음'}` : '시트 없음'}, 400ms 뒤 ${settledB ? `top ${px(settledB.top)}, inline transform ${settledB.inline === '' ? '없음' : settledB.inline}` : '시트 없음'}, 색 단추 ${picked ? '눌림' : '안 눌림'}`,
  );
  if (settledB) {
    await tap(await center($('.sheet .textbtn.start'))); // 색을 바꿨으므로 취소로 닫는다
    await sleep(600);
  }

  const typed = '끌어 닫기로 저장';
  await openDay();
  await tap(await center($('.sheet textarea')));
  await sleep(200);
  await cdp.send('Input.insertText', { text: typed });
  const typedValue = await cdp.evaluate<string>("document.querySelector('.sheet textarea')?.value ?? ''");
  const writesC = await outboxWrites();
  await pull(await titleBar(), 300, 30, { holdMs: 150 });
  await sleep(800);
  const afterC = { sheet: await sheetNow(), text: await cellText(), writes: await outboxWrites() };
  record(
    '메모를 적고 아래로 끌어 닫으면 저장되어 날짜 칸에 보인다',
    typedValue.includes(typed) && afterC.sheet === null && afterC.text.includes(typed) && afterC.writes > writesC,
    `메모 칸 ${typedValue.includes(typed) ? '적힘' : '안 적힘'}, 놓은 뒤 시트 ${afterC.sheet ? '있음' : '없음'}, 칸에 ${afterC.text.includes(typed) ? '보임' : '안 보임'}, 대기열 쓰기 ${afterC.writes - writesC}번`,
  );

  // DevTools로 보내는 터치 하나가 30~40ms 걸려서 그대로 보내면 빠르게 튕긴 손가락이 되지 않는다. 그래서 일어난 시각을
  // 60Hz 간격(16ms)으로 적어 보낸다. 시트는 놓을 때의 속도를 이벤트가 일어난 시각(timeStamp)으로 잰다.
  const restD = await openDay();
  const flickFrom = await titleBar();
  const flickAt = Date.now() / 1000;
  await touch('touchStart', flickFrom.x, flickFrom.y, flickAt);
  for (let i = 1; i <= 3; i++) await touch('touchMove', flickFrom.x, flickFrom.y + 24 * i, flickAt + 0.016 * i);
  await touch('touchEnd', undefined, undefined, flickAt + 0.056);
  releasedMovingAt = Date.now();
  const flickTops = await cdp.evaluate<Array<number | null>>(
    `new Promise((resolve) => { const out = []; let n = 0; const read = () => { const s = document.querySelector('.sheet'); out.push(s ? s.getBoundingClientRect().top : null); if (++n < 6) setTimeout(read, 40); else resolve(out); }; read(); })`,
  );
  await sleep(500);
  const afterD = await sheetNow();
  const seenD = flickTops.filter((t): t is number => t !== null);
  record(
    '제목 줄을 72px만 빠르게 튕겨 내려도 닫히고, 내려가는 동안 위로 돌아가지 않는다',
    restD !== null && afterD === null && seenD.every((t, i) => i === 0 || t >= seenD[i - 1]),
    `72px을 56ms에 끌고 놓음, 놓은 뒤 top ${flickTops.map((t) => (t === null ? '없음' : Math.round(t))).join(', ')}px, 700ms 뒤 시트 ${afterD ? '있음' : '없음'}`,
  );

  const restE = await openDay();
  const area = $('.sheet textarea');
  const scrollBefore = await cdp.evaluate<number>(
    `(() => { const a = ${area}; a.value = Array.from({ length: 60 }, (_, i) => '줄 ' + (i + 1)).join('\\n'); a.scrollTop = a.scrollHeight; return a.scrollTop; })()`,
  );
  const inArea = await pull(await center(area), 150, 15, { holdMs: 150, follow: true });
  await sleep(300);
  const scrollAfter = await cdp.evaluate<number>(`${area}.scrollTop`);
  const afterE = await sheetNow();
  const worstE = restE === null ? Infinity : inArea.follow.reduce((w, s) => Math.max(w, s.top === null ? Infinity : Math.abs(s.top - restE)), 0);
  record(
    '긴 메모를 아래까지 내린 채 메모 칸에서 아래로 끌면 메모만 스크롤되고 시트는 움직이지 않는다',
    restE !== null && scrollBefore > 200 && scrollAfter < scrollBefore - 50 && worstE <= 0.5 && afterE !== null && Math.abs(afterE.top - restE) <= 0.5,
    `메모 스크롤 ${Math.round(scrollBefore)} -> ${Math.round(scrollAfter)}px, 끄는 동안 시트가 멈춘 자리에서 가장 크게 벗어난 값 ${px(worstE)}, 뗀 뒤 시트 ${afterE ? `top ${px(afterE.top)}` : '없음'}`,
  );
  if (afterE) {
    await tap(await center($('.sheet .textbtn.start')));
    await sleep(600);
  }

  const gear = $('[aria-label="설정"]');
  await tap(await center(gear));
  const restF = await sheetSettled();
  await pull(await titleBar(), 300, 30, { holdMs: 150 });
  await sleep(600);
  const settingsGone = (await sheetNow()) === null;
  await tap(await center(gear));
  const restF2 = await sheetSettled();
  // 목록이 시트보다 길어야 스크롤된다. 위젯 설치 방법을 펼치고, 그래도 짧으면 시험용 빈 칸을 덧붙인다.
  const listBefore = await cdp.evaluate<{ top: number; padded: boolean } | null>(`(() => {
    const s = document.querySelector('.sheet.settings');
    if (!s) return null;
    const d = s.querySelector('details');
    if (d) d.open = true;
    let padded = false;
    if (s.scrollHeight - s.clientHeight < 300) { const pad = document.createElement('div'); pad.style.cssText = 'flex: none; height: 600px'; s.append(pad); padded = true; }
    s.scrollTop = 300;
    return { top: s.scrollTop, padded };
  })()`);
  const onList = await pull({ x: Math.round(PHONE.width / 2), y: 460 }, 150, 15, { holdMs: 150, follow: true });
  await sleep(300);
  const listAfter = await cdp.evaluate<number | null>("document.querySelector('.sheet.settings')?.scrollTop ?? null");
  const afterF = await sheetNow();
  const worstF = restF2 === null ? Infinity : onList.follow.reduce((w, s) => Math.max(w, s.top === null ? Infinity : Math.abs(s.top - restF2)), 0);
  record(
    '설정도 제목 줄에서 끌어 내리면 닫히고, 목록이 내려가 있으면 아래로 끌어도 목록만 스크롤된다',
    restF !== null && settingsGone && restF2 !== null && listBefore !== null && listAfter !== null && listAfter < listBefore.top - 50 && worstF <= 0.5 && afterF !== null,
    `끌어 닫은 뒤 설정 ${settingsGone ? '없음' : '있음'}, 목록 스크롤 ${listBefore ? Math.round(listBefore.top) : '없음'} -> ${listAfter === null ? '없음' : Math.round(listAfter)}px${listBefore?.padded ? '(시험용 빈 칸을 덧붙임)' : ''}, 끄는 동안 시트가 벗어난 값 ${px(worstF)}, 뗀 뒤 설정 ${afterF ? '열림' : '없음'}`,
  );
  if (afterF) {
    // 닫기 단추가 목록과 함께 스크롤되어 올라가 있으므로 맨 위로 되돌린 뒤 누른다.
    await cdp.evaluate("document.querySelector('.sheet.settings').scrollTop = 0");
    await sleep(100);
    await tap(await center($('.sheet .sheet-bar .textbtn.end')));
    await sleep(600);
  }

  await emulatePhone(cdp, { reducedMotion: true });
  await sleep(500);
  g = await pressNext();
  const reducedSteps = between(g.all, g.before.left, g.after.left);
  record(
    '움직임 줄이기에서는 다음 달 단추가 움직임 없이 바로 넘긴다',
    delta(g) === 1 && reducedSteps === 0,
    `${g.before.title} -> ${g.after.title}, 중간 위치 ${reducedSteps}개`,
  );

  await tap(await center(dayCell));
  await cdp.evaluate<number | null>(SHEET_TOP_JS(0));
  await sleep(300);
  await tap(await center($('.sheet .textbtn.start')));
  const reducedLeft = await cdp.evaluate<number | null>(SHEET_NOW_JS(40));
  record('움직임 줄이기에서는 취소하면 50ms 안에 시트가 사라진다', reducedLeft === null, reducedLeft === null ? '시트 없음' : `top ${Math.round(reducedLeft)}px에 남아 있다`);
  await sleep(300);

  // 움직임 줄이기: 손가락을 따라가는 것은 그대로이고, 놓은 뒤의 움직임만 없다.
  const restG = await openDay();
  const pulledG = await pull(await titleBar(), 40, 8, { holdMs: 150, follow: true });
  const backG = await sheetNow();
  const followG = followed(pulledG.follow, restG, 5);
  await pull(await titleBar(), 300, 30, { holdMs: 150 });
  const goneG = await cdp.evaluate<number | null>(SHEET_NOW_JS(40));
  record(
    '움직임 줄이기에서도 끄는 동안은 따라오고, 놓으면 움직임 없이 바로 제자리로 가거나 50ms 안에 사라진다',
    followG.ok && backG !== null && restG !== null && Math.abs(backG.top - restG) <= 0.5 && !backG.moving && goneG === null,
    `${followG.text}, 40px 끌고 놓은 직후 ${backG ? `top ${px(backG.top)}, 움직임 ${backG.moving ? '있음' : '없음'}` : '시트 없음'}, 300px 끌고 놓은 뒤 ${goneG === null ? '시트 없음' : `top ${Math.round(goneG)}px에 남아 있다`}`,
  );
  await sleep(300);

  record(
    '손가락으로 넘기는 동안(1~6) 50ms 넘는 긴 작업이 없다',
    longTasks === 0 || longTasksAgain === 0,
    longTasksAgain === null ? `긴 작업 ${longTasks}개` : `긴 작업 ${longTasks}개, 다시 해서 ${longTasksAgain}개`,
  );

  // 주소로 곧바로 연 시트를 닫은 뒤 뒤로 가도 그 시트가 다시 열리지 않는다. 페이지를 새로 읽으므로 맨 끝에서 한다.
  // 앱을 한 번 열어 두고(from=1, 달력), 시트의 주소를 새 문서로 연다(from=2#...). 닫은 뒤 뒤로 가면 첫 쪽의 달력이어야 한다.
  // 고치기 전에는 닫을 때 기록이 하나 더 쌓여, 뒤로 가면 from=2#... 로 돌아와 시트가 다시 열렸다.
  type Cold = { opened: boolean; closed: boolean; hashClean: boolean; sameLength: boolean; landed: boolean; reopened: boolean };
  async function coldSheet(hash: string, closeSelector: string): Promise<Cold> {
    const pageUrl = (from: number, suffix = ''): string => {
      const u = new URL(url);
      u.hash = '';
      u.searchParams.set('from', String(from));
      return `${u.href}${suffix}`;
    };
    const calendarUp = "!!document.querySelector('.grid.current .cell') && !document.querySelector('.sheet')";
    await cdp.send('Page.navigate', { url: pageUrl(1) });
    for (let i = 0; i < 100 && !(await cdp.evaluate<boolean>(calendarUp).catch(() => false)); i++) await sleep(200);
    await cdp.send('Page.navigate', { url: pageUrl(2, `#${hash}`) });
    let opened = false;
    for (let i = 0; i < 100 && !opened; i++) {
      opened = await cdp.evaluate<boolean>("!!document.querySelector('.sheet') && location.search.includes('from=2')").catch(() => false);
      if (!opened) await sleep(200);
    }
    await sleep(700); // 시트가 자리를 잡고, 첫 누름이 먹히게 한다
    const lengthBefore = await cdp.evaluate<number>('history.length');
    releasedMovingAt = 0;
    await tap(await center($(closeSelector)));
    await sleep(600);
    const closed = await cdp.evaluate<boolean>("!document.querySelector('.sheet')");
    const hashClean = await cdp.evaluate<boolean>("location.hash === ''");
    const sameLength = (await cdp.evaluate<number>('history.length')) === lengthBefore;
    await cdp.evaluate('history.back()');
    let landed = false;
    for (let i = 0; i < 40 && !landed; i++) {
      landed = await cdp.evaluate<boolean>(`location.search.includes('from=1') && ${calendarUp}`).catch(() => false);
      if (!landed) await sleep(200);
    }
    await sleep(500);
    const reopened = await cdp.evaluate<boolean>("!!document.querySelector('.sheet')").catch(() => false);
    return { opened, closed, hashClean, sameLength, landed, reopened };
  }
  const now = new Date();
  const dayHash = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  const describeCold = (c: Cold) =>
    `시트 ${c.opened ? '열림' : '안 열림'}, 닫은 뒤 시트 ${c.closed ? '없음' : '있음'}, 주소 ${c.hashClean ? '깨끗' : '#가 남음'}, 기록 수 ${c.sameLength ? '그대로' : '바뀜'}, 뒤로 간 곳 ${c.landed ? '앞 쪽 달력' : '앞 쪽 달력이 아님'}, 뒤로 간 뒤 시트 ${c.reopened ? '다시 열림' : '없음'}`;
  const coldDay = await coldSheet(dayHash, '.sheet .textbtn.start');
  record(
    '날짜 주소로 곧바로 연 편집 화면을 취소한 뒤 뒤로 가도 다시 열리지 않는다',
    coldDay.opened && coldDay.closed && coldDay.hashClean && coldDay.sameLength && coldDay.landed && !coldDay.reopened,
    describeCold(coldDay),
  );
  const coldSettings = await coldSheet('settings', '.sheet .sheet-bar .textbtn.end');
  record(
    '#settings로 곧바로 연 설정을 닫은 뒤 뒤로 가도 다시 열리지 않는다',
    coldSettings.opened && coldSettings.closed && coldSettings.hashClean && coldSettings.sameLength && coldSettings.landed && !coldSettings.reopened,
    describeCold(coldSettings),
  );
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
