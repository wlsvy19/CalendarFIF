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
  // 프로필(.tools/edge-profile-touch)은 실행 사이에 남는다. 지난 실행이 남긴 웹앱 설정(calfif.prefs 등)이 있으면
  // 설정 확인이 켜고 끄기를 거꾸로 하게 되므로, 이 주소의 브라우저 저장소를 비우고 시작한다.
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(url).origin, storageTypes: 'local_storage' });
  await cdp.send('Page.navigate', { url });
  let calendarUp = false;
  for (let i = 0; i < 100 && !calendarUp; i++) {
    calendarUp = await cdp.evaluate<boolean>("!!document.querySelector('.grid.current .cell')").catch(() => false);
    if (!calendarUp) await sleep(300);
  }
  // 달력이 끝내 뜨지 않으면 무엇이 보였는지 적고 멈춘다(뒤의 확인이 엉뚱한 오류로 죽지 않게).
  if (!calendarUp) {
    const seen = await cdp.evaluate<string>('document.body.innerText').catch(() => '');
    throw new Error(`30초 안에 달력이 뜨지 않았다. 화면의 글: ${seen.replace(/\s+/g, ' ').slice(0, 200) || '(없음)'}`);
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
  await tap(await center("document.querySelector('.sheet button.tool.color')")); // 배경 도구로 색 상자를 연다
  await sleep(150);
  const swatch = "document.querySelectorAll('.sheet .palette .swatch')[3]";
  const swatchColor = await cdp.evaluate<string>(`(${swatch})?.dataset.color ?? ''`);
  await tap(await center(swatch));
  await sleep(150);
  const picked = await cdp.evaluate<boolean>(
    `document.querySelector('.sheet .palette') === null && document.querySelector('.sheet .memo-input')?.dataset.color === ${JSON.stringify(swatchColor)} && document.querySelector('.sheet .tool.color .dot')?.style.getPropertyValue('--sw') === ${JSON.stringify('#' + swatchColor)}`,
  );
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
  // 목록을 내린 채로도 제목 줄은 시트 맨 위에 붙어 있고, 제목 줄을 잡고 끌어 내리면 닫힌다.
  const stuck = await cdp.evaluate<{ scrollTop: number; barTop: number; barBottom: number; closeVisible: boolean } | null>(`(() => {
    const s = document.querySelector('.sheet.settings');
    if (!s) return null;
    s.scrollTop = 300;
    const sheet = s.getBoundingClientRect();
    const bar = s.querySelector('.sheet-bar').getBoundingClientRect();
    const close = s.querySelector('.sheet-bar .textbtn.end').getBoundingClientRect();
    return { scrollTop: s.scrollTop, barTop: bar.top - sheet.top, barBottom: bar.bottom - sheet.top, closeVisible: close.top >= sheet.top && close.bottom <= sheet.bottom };
  })()`);
  await sleep(200);
  if (stuck) await pull(await titleBar(), 300, 30, { holdMs: 150 });
  await sleep(600);
  const goneFromBar = (await sheetNow()) === null;
  record(
    '설정 목록을 내린 채로도 제목 줄과 닫기는 시트 맨 위에 붙어 있고, 제목 줄을 잡고 끌어 내리면 닫힌다',
    stuck !== null && stuck.scrollTop > 200 && Math.abs(stuck.barTop) <= 0.5 && stuck.barBottom >= 56 && stuck.closeVisible && goneFromBar,
    stuck === null ? '설정 시트가 없다' : `목록 스크롤 ${Math.round(stuck.scrollTop)}px, 제목 줄은 시트 위에서 ${px(stuck.barTop)}~${px(stuck.barBottom)}, 닫기 ${stuck.closeVisible ? '보임' : '안 보임'}, 제목 줄을 끌어 내린 뒤 설정 ${goneFromBar ? '없음' : '있음'}`,
  );
  if (!goneFromBar) {
    await tap(await center($('.sheet .sheet-bar .textbtn.end')));
    await sleep(600);
  }

  // 음력과 공휴일: 12월에는 성탄절이 있다. 다음 달 단추로 가장 가까운 12월까지 가서 그 칸을 본다.
  const monthNow = Number((await view()).title.split('년')[1].replace('월', '').trim());
  for (let i = monthNow; i < 12; i++) await pressNext();
  type HolidayCell = { holiday: boolean; numRed: boolean; name: string | null; nameBelow: boolean; nameFits: boolean; lunar: string | null; lunarBeside: boolean; lunarCount: number; lunarClipped: number; days: number };
  const xmas = await cdp.evaluate<HolidayCell | null>(`(() => {
    const cell = document.querySelector('.grid.current .cell[data-key$="-12-25"]');
    if (!cell) return null;
    const num = cell.querySelector('.num');
    const name = cell.querySelector('.hname');
    const lunar = cell.querySelector('.lunar');
    const box = (el) => el.getBoundingClientRect();
    // 글이 상자보다 넓은가. 음력은 앞쪽이 잘리므로 scrollWidth로는 알 수 없어 글의 폭을 직접 잰다.
    const wider = (el) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().width > box(el).width + 0.5; };
    const probe = document.createElement('span');
    probe.style.color = 'var(--sun)';
    document.body.append(probe);
    const sun = getComputedStyle(probe).color;
    probe.remove();
    const lunars = [...document.querySelectorAll('.grid.current .cell:not(.other) .lunar')];
    return {
      holiday: cell.classList.contains('holiday'),
      numRed: getComputedStyle(num).color === sun || cell.classList.contains('today') || cell.hasAttribute('data-color'),
      name: name ? name.textContent : null,
      nameBelow: !!name && box(name).top >= box(num).bottom - 0.5,
      nameFits: !!name && !wider(name),
      lunar: lunar ? lunar.textContent : null,
      lunarBeside: !!lunar && box(lunar).left >= box(num).right - 0.5 && box(lunar).top < box(num).bottom && box(lunar).right <= box(cell).right + 0.5,
      lunarCount: lunars.length,
      lunarClipped: lunars.filter(wider).length,
      days: document.querySelectorAll('.grid.current .cell:not(.other)').length,
    };
  })()`);
  record(
    '공휴일은 숫자가 빨갛고 이름이 숫자 아래에 나오며, 음력은 숫자 옆에 잘리지 않고 나온다',
    xmas !== null && xmas.holiday && xmas.numRed && xmas.name === '성탄절' && xmas.nameBelow && xmas.nameFits && xmas.lunar !== null && xmas.lunarBeside && xmas.days === 31 && xmas.lunarCount === 31 && xmas.lunarClipped === 0,
    xmas === null
      ? '12월 25일 칸을 찾지 못했다'
      : `12월 25일: 공휴일 ${xmas.holiday ? '표시' : '아님'}, 숫자 ${xmas.numRed ? '빨강' : '빨강 아님'}, 이름 ${xmas.name ?? '없음'}(${xmas.nameBelow ? '숫자 아래' : '숫자 아래가 아님'}, ${xmas.nameFits ? '다 보임' : '잘림'}), 음력 ${xmas.lunar ?? '없음'}(${xmas.lunarBeside ? '숫자 옆' : '숫자 옆이 아님'}), 이번 달 ${xmas.days}일 가운데 음력 ${xmas.lunarCount}칸, 잘린 것 ${xmas.lunarClipped}칸`,
  );
  await tap(await center($('.pill')));
  await rest();

  // 설정: 고르면 바로 바뀌고 이 기기에 저장된다. 다시 고르면 처음으로 돌아온다.
  type Look = { theme: string | null; accent: string; lunars: number; dow: string; memoSize: string; weeks: number; saved: Record<string, unknown> | null };
  const look = () =>
    cdp.evaluate<Look>(`(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase(),
      lunars: document.querySelectorAll('.grid.current .lunar').length,
      dow: [...document.querySelectorAll('.dow span')].map((s) => s.textContent).join(''),
      memoSize: document.querySelector('.calendar').style.getPropertyValue('--memo-size'),
      weeks: document.querySelectorAll('.grid.current .wk').length,
      saved: JSON.parse(localStorage.getItem('calfif.prefs') || 'null'),
    }))()`);
  const choice = (group: string, value: string) => `document.querySelector('[aria-labelledby="${group}"] [data-value="${value}"]')`;
  const toggleOf = (name: string) => `[...document.querySelectorAll('label.pref-row')].find((l) => l.querySelector('.pref-name').textContent === ${JSON.stringify(name)}).querySelector('input')`;
  /** 설정 목록에서 그 조작부가 보이게 한 뒤 손가락으로 누른다. */
  const tapIn = async (elementJs: string): Promise<void> => {
    await cdp.evaluate(`(${elementJs}).scrollIntoView({ block: 'center' })`);
    await sleep(150);
    await tap(await center(elementJs));
    await sleep(350);
  };
  const lookBefore = await look();
  await tap(await center(gear));
  await sheetSettled();
  for (const el of [choice('prefTheme', 'dark'), choice('prefAccent', 'pink'), toggleOf('음력'), choice('prefWeekStart', '1'), choice('prefMemoSize', 'large'), toggleOf('주 번호')]) await tapIn(el);
  const lookChanged = await look();
  for (const el of [choice('prefTheme', 'auto'), choice('prefAccent', 'blue'), toggleOf('음력'), choice('prefWeekStart', '0'), choice('prefMemoSize', 'medium'), toggleOf('주 번호')]) await tapIn(el);
  const lookBack = await look();
  const savedChanged = lookChanged.saved ?? {};
  record(
    '설정에서 고르면 달력이 바로 바뀌고 저장된다(밝기, 색상, 음력, 한 주의 시작, 글자 크기, 주 번호). 다시 고르면 처음과 같다',
    lookChanged.theme === 'dark' && lookChanged.accent === '#FF8FB8' && lookBefore.lunars > 0 && lookChanged.lunars === 0 && lookBefore.dow === '일월화수목금토' && lookChanged.dow === '월화수목금토일' &&
      lookChanged.memoSize === '12px' && lookBefore.weeks === 0 && lookChanged.weeks > 0 &&
      savedChanged.theme === 'dark' && savedChanged.accent === 'pink' && savedChanged.lunar === false && savedChanged.weekStart === 1 && savedChanged.memoSize === 'large' && savedChanged.weekNumbers === true &&
      lookBack.theme === null && lookBack.accent === lookBefore.accent && lookBack.lunars === lookBefore.lunars && lookBack.dow === lookBefore.dow && lookBack.memoSize === '10px' && lookBack.weeks === 0,
    `바꾼 뒤: 밝기 ${lookChanged.theme}, 강조색 ${lookChanged.accent}, 음력 ${lookBefore.lunars} -> ${lookChanged.lunars}칸, 요일 줄 ${lookChanged.dow}, 메모 글자 ${lookChanged.memoSize}, 주 번호 ${lookChanged.weeks}칸, 저장 ${JSON.stringify(lookChanged.saved)} / 되돌린 뒤: 밝기 ${lookBack.theme ?? '자동'}, 강조색 ${lookBack.accent}, 음력 ${lookBack.lunars}칸, 요일 줄 ${lookBack.dow}, 메모 글자 ${lookBack.memoSize}`,
  );
  // 목록이 내려가 있어도 닫기는 위에 붙어 있으므로 그대로 누른다.
  await tap(await center($('.sheet .sheet-bar .textbtn.end')));
  await sleep(600);
  const closedByButton = (await sheetNow()) === null;
  if (!closedByButton) throw new Error('목록을 내린 채로 설정의 닫기를 눌렀는데 닫히지 않았다');

  // 년도와 월 고르기: 년도를 눌러 다음 12년으로 넘기고 그 첫 해를 고르면 같은 달의 그해로 간다. 월을 눌러 3월을 고른다.
  // 상자가 열린 채 바깥(날짜 칸 위)을 누르면 닫히기만 하고 편집 화면은 열리지 않는다. 끝나면 오늘로 돌아온다.
  const titleNow = async (): Promise<string> => (await view()).title;
  const pickBefore = await titleNow();
  const [beforeYear, beforeMonth] = (/(\d+)년\s*(\d+)월/.exec(pickBefore) ?? []).slice(1).map(Number);
  const nextPage = 1900 + Math.floor((beforeYear - 1900) / 12) * 12 + 12;
  await tap(await center($('.year')));
  await sleep(400);
  const yearBox = await cdp.evaluate<{ items: number; current: string | null } | null>(
    `(() => { const p = document.querySelector('.datepick'); if (!p) return null; return { items: p.querySelectorAll('.datepick-item').length, current: p.querySelector('[aria-current="true"]')?.textContent ?? null }; })()`,
  );
  await tap(await center($('.datepick-step[aria-label="다음 12년"]')));
  await sleep(250);
  await tap(await center($('.datepick-item')));
  await rest();
  const afterYear = await titleNow();
  await tap(await center($('.month .title-btn')));
  await sleep(400);
  await tap(await center("[...document.querySelectorAll('.datepick-item')].find((b) => b.textContent === '3월')"));
  await rest();
  const afterMonth = await titleNow();
  await tap(await center($('.year')));
  await sleep(400);
  await tap(await center($('.grid.current .cell:nth-child(18)')));
  await sleep(600);
  const outside = await cdp.evaluate<{ picker: boolean; sheet: boolean }>("({ picker: !!document.querySelector('.datepick, .datepick-scrim'), sheet: !!document.querySelector('.sheet') })");
  const afterOutside = await titleNow();
  if (outside.sheet) {
    await tap(await center($('.sheet .textbtn.start')));
    await sleep(600);
  }
  await tap(await center($('.pill')));
  await rest();
  record(
    '년도를 누르면 12년 상자가 뜨고 고른 해의 같은 달로 가며, 월을 누르면 1월~12월에서 고른 달로 간다. 바깥을 누르면 닫히기만 한다',
    yearBox !== null && yearBox.items === 12 && yearBox.current === String(beforeYear) &&
      afterYear === `${nextPage}년 ${beforeMonth}월` && afterMonth === `${nextPage}년 3월` &&
      !outside.picker && !outside.sheet && afterOutside === afterMonth,
    `처음 ${pickBefore}, 년도 상자 ${yearBox ? `${yearBox.items}칸(골라 둔 것 ${yearBox.current})` : '없음'}, 다음 12년의 첫 해를 고른 뒤 ${afterYear}, 3월을 고른 뒤 ${afterMonth}, 바깥을 누른 뒤 상자 ${outside.picker ? '남음' : '닫힘'}·편집 화면 ${outside.sheet ? '열림' : '없음'}·${afterOutside}`,
  );

  // 좁은 폰(폭 320px): 음력이 칸에 안 들어가면 그 쪽을 좁은 꼴로 바꾸고, 그래도 넘치는 칸은 숨긴다.
  // 앞쪽이 잘린 채 보이면 다른 날짜로 읽히므로("11.15"가 "1.15"로) 잘린 채 보이는 것이 하나도 없어야 한다.
  type LunarFit = { tight: boolean; shown: number; hidden: number; clipped: number };
  const lunarFit = () =>
    cdp.evaluate<LunarFit>(`(() => {
      const grid = document.querySelector('.grid.current');
      const labels = [...grid.querySelectorAll('.lunar')];
      const wider = (el) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.5; };
      const hidden = labels.filter((l) => getComputedStyle(l).visibility === 'hidden');
      const shown = labels.filter((l) => !hidden.includes(l));
      return { tight: grid.classList.contains('lunar-tight'), shown: shown.length, hidden: hidden.length, clipped: shown.filter(wider).length };
    })()`);
  const resizeTo = async (width: number): Promise<void> => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: PHONE.height, deviceScaleFactor: PHONE.deviceScaleFactor, mobile: true });
    await sleep(500);
    await rest();
  };
  await resizeTo(320);
  const narrowFit = await lunarFit();
  await resizeTo(PHONE.width);
  const wideFit = await lunarFit();
  record(
    '폭 320px의 좁은 폰에서는 음력을 좁은 꼴로 바꾸고 안 들어가는 칸은 숨긴다. 잘린 채 보이는 음력은 없고, 폭을 되돌리면 처음과 같다',
    narrowFit.tight && narrowFit.clipped === 0 && narrowFit.shown > 0 && !wideFit.tight && wideFit.hidden === 0 && wideFit.clipped === 0 && wideFit.shown === narrowFit.shown + narrowFit.hidden,
    `폭 320: 좁은 꼴 ${narrowFit.tight ? '예' : '아니오'}, 보이는 음력 ${narrowFit.shown}칸, 숨긴 것 ${narrowFit.hidden}칸, 잘린 채 보이는 것 ${narrowFit.clipped}칸 / 폭 ${PHONE.width}: 좁은 꼴 ${wideFit.tight ? '예' : '아니오'}, 보이는 음력 ${wideFit.shown}칸, 숨긴 것 ${wideFit.hidden}칸, 잘린 것 ${wideFit.clipped}칸`,
  );

  // 메모 도구(배경, 알림, 카운트다운)와 셀 간격. 다음 달로 가서(오늘 이후라야 "N일 남음"이 된다) 그 달의 10일과 20일 칸을 쓴다.
  const waitFor = async (js: string, timeoutMs = 3000): Promise<boolean> => {
    for (let t = 0; t < timeoutMs; t += 50) {
      if (await cdp.evaluate<boolean>(js).catch(() => false)) return true;
      await sleep(50);
    }
    return false;
  };
  const eventSheetUp = "!!document.querySelector('.event-sheet')";
  const openKey = async (key: string): Promise<boolean> => {
    await tap(await center($(`.grid.current .cell[data-key="${key}"]`)));
    return waitFor("!!document.querySelector('.sheet:not(.event-sheet)')");
  };
  /** 편집 화면의 도구 단추로 알림 시트를 연다. 시트가 자리를 잡을 때까지 기다린다. */
  const openEventSheet = async (tool: 'alarm' | 'countdown'): Promise<boolean> => {
    await tap(await center($(`.sheet button.tool.${tool}`)));
    const up = await waitFor(eventSheetUp);
    await sleep(600);
    return up;
  };
  const typeInto = async (selector: string, value: string): Promise<void> => {
    await tap(await center($(selector)));
    await sleep(200);
    await cdp.send('Input.insertText', { text: value });
  };
  const closeDay = async (): Promise<void> => {
    await tap(await center($('.sheet:not(.event-sheet) .textbtn.start')));
    await waitFor("!document.querySelector('.sheet, .scrim')");
    await sleep(300);
  };
  await pressNext();
  const monthKeys = await cdp.evaluate<string[]>("[...document.querySelectorAll('.grid.current .cell:not(.other)')].map((c) => c.dataset.key)");
  const alarmKey = monthKeys[9];
  const countdownKey = monthKeys[19];
  const dayDiff = (key: string): number => {
    const t = new Date();
    const [y, m, d] = key.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  };

  // 배경: 상자에서 고른 색이 메모 칸 바탕에 보인다.
  const colorOpened = await openKey(alarmKey);
  await sleep(700);
  const memoBg = () => cdp.evaluate<string>("getComputedStyle(document.querySelector('.sheet .memo-input')).backgroundColor");
  const bgBefore = await memoBg();
  await tap(await center($('.sheet button.tool.color')));
  await waitFor("!!document.querySelector('.sheet .palette .swatch')");
  const swatchTwo = "document.querySelectorAll('.sheet .palette .swatch')[3]";
  const swatchHex = await cdp.evaluate<string>(`(${swatchTwo})?.dataset.color ?? ''`);
  await tap(await center(swatchTwo));
  await sleep(200);
  const bgAfter = await memoBg();
  const memoColor = await cdp.evaluate<{ data: string | null; day: string; dot: string }>(
    "(() => { const m = document.querySelector('.sheet .memo-input'); return { data: m.dataset.color ?? null, day: m.style.getPropertyValue('--day-color').trim(), dot: document.querySelector('.sheet .tool.color .dot')?.style.getPropertyValue('--sw') ?? '' }; })()",
  );
  record(
    '배경 상자에서 고른 색이 메모 칸 바탕에 보인다',
    colorOpened && swatchHex !== '' && memoColor.data === swatchHex && memoColor.day.toUpperCase() === `#${swatchHex}`.toUpperCase() && memoColor.dot === `#${swatchHex}` && bgAfter !== bgBefore && bgAfter !== 'rgba(0, 0, 0, 0)',
    `고른 색 ${swatchHex}, 메모 칸 바탕 ${bgBefore} -> ${bgAfter}, data-color ${memoColor.data ?? '없음'}, --day-color ${memoColor.day || '없음'}, 점 ${memoColor.dot || '없음'}`,
  );
  await closeDay(); // 색을 바꿨지만 저장하지 않고 취소한다

  // 알림: 편집 화면의 알림 단추로 만들면 띠와 달력 칸에 보인다.
  const alarmText = '약 먹기';
  const alarmTime = '08:45';
  const dayOpened = await openKey(alarmKey);
  await sleep(700);
  const alarmUp = await openEventSheet('alarm');
  await typeInto('.event-sheet input.ev-text', alarmText);
  await cdp.evaluate(`(() => { const t = document.querySelector('.event-sheet input[type=time]'); t.value = ${JSON.stringify(alarmTime)}; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await tap(await center($('.event-sheet .textbtn.end'))); // 저장
  const sheetGone = await waitFor("!document.querySelector('.event-sheet, .event-scrim')");
  const stripOk = await waitFor(`[...document.querySelectorAll('.sheet .ev-strip button.ev-chip')].some((c) => c.textContent === ${JSON.stringify(`${alarmTime} ${alarmText}`)})`);
  const cellOk = await waitFor(`[...document.querySelectorAll('.grid.current .cell[data-key="${alarmKey}"] .ln.ev.alarm')].some((l) => l.textContent.includes(${JSON.stringify(alarmText)}))`);
  const cellLine = await cdp.evaluate<string>(`document.querySelector('.grid.current .cell[data-key="${alarmKey}"] .ln.ev.alarm')?.textContent ?? ''`);
  const dayStillOpen = await cdp.evaluate<boolean>("!!document.querySelector('.sheet:not(.event-sheet)')");
  record(
    '편집 화면의 알림 단추로 알림을 만들면 띠와 달력 칸에 보인다',
    dayOpened && alarmUp && sheetGone && dayStillOpen && stripOk && cellOk,
    `${alarmKey}에 ${alarmTime} ${alarmText}: 알림 시트 ${alarmUp ? '열림' : '안 열림'}, 저장 뒤 시트 ${sheetGone ? '닫힘' : '남음'}, 편집 화면 ${dayStillOpen ? '그대로' : '없음'}, 띠의 칩 ${stripOk ? '있음' : '없음'}, 달력 칸 줄 ${cellOk ? `"${cellLine}"` : '없음'}`,
  );

  // 알림 시트 바깥 누르기: 고친 것이 없으면 시트만 닫히고 편집 화면은 그대로다. 고친 것이 있으면 시트도 그대로다. 시트를 닫으면 편집 화면으로 돌아온다.
  const dayTop = (await sheetNow())?.top ?? null;
  const memoBefore = await cdp.evaluate<string>("document.querySelector('.sheet .memo-input')?.value ?? ''");
  const sheetOpenedAgain = await openEventSheet('alarm');
  const outsideY = await cdp.evaluate<number>("Math.max(6, Math.round(document.querySelector('.event-sheet').getBoundingClientRect().top / 2))");
  const hitScrim = await cdp.evaluate<boolean>(`document.elementFromPoint(${Math.round(PHONE.width / 2)}, ${outsideY})?.classList.contains('event-scrim') ?? false`);
  await typeInto('.event-sheet input.ev-text', '시험');
  await tap({ x: Math.round(PHONE.width / 2), y: outsideY });
  await sleep(500);
  const dirtyStays = await cdp.evaluate<boolean>(eventSheetUp);
  await tap(await center("[...document.querySelectorAll('.event-sheet button')].find((b) => b.textContent === '취소')"));
  const cancelled = await waitFor("!document.querySelector('.event-sheet, .event-scrim')");
  await openEventSheet('alarm');
  await tap({ x: Math.round(PHONE.width / 2), y: outsideY });
  const cleanClosed = await waitFor("!document.querySelector('.event-sheet, .event-scrim')");
  await sleep(400);
  const back = await cdp.evaluate<{ day: boolean; focus: string; memo: string }>(
    "(() => { const s = document.querySelector('.sheet:not(.event-sheet)'); const a = document.activeElement; return { day: !!s, focus: !s ? '없음' : a === s ? '편집 화면' : a?.classList.contains('memo-input') ? '메모 칸' : s.contains(a) ? '편집 화면 안' : (a?.tagName ?? '없음'), memo: s?.querySelector('.memo-input')?.value ?? '' }; })()",
  );
  const dayTopAfter = (await sheetNow())?.top ?? null;
  record(
    '알림 시트가 열린 동안 바깥을 눌러도 편집 화면은 그대로이고, 시트를 닫으면 메모 칸으로 돌아온다',
    dayTop !== null && sheetOpenedAgain && hitScrim && dirtyStays && cancelled && cleanClosed && back.day && back.memo === memoBefore &&
      dayTopAfter !== null && Math.abs(dayTopAfter - dayTop) <= 1 && (back.focus === '메모 칸' || back.focus === '편집 화면'),
    `바깥 y ${outsideY}px(알림 막 ${hitScrim ? '맞음' : '아님'}), 글을 적고 바깥을 누른 뒤 시트 ${dirtyStays ? '남음' : '닫힘'}, 취소 뒤 ${cancelled ? '닫힘' : '남음'}, 안 고치고 바깥을 누른 뒤 ${cleanClosed ? '닫힘' : '남음'}, 편집 화면 ${back.day ? `top ${px(dayTopAfter)}(전 ${px(dayTop)})` : '없음'}, 메모 ${back.memo === memoBefore ? '그대로' : '바뀜'}, 초점 ${back.focus}`,
  );
  await closeDay();

  // 카운트다운: 만들면 달력 아래 줄에 N일 남음으로 보인다.
  const cdText = '시험';
  const cdDays = dayDiff(countdownKey);
  const cdDayOpened = await openKey(countdownKey);
  await sleep(700);
  const cdUp = await openEventSheet('countdown');
  await typeInto('.event-sheet input.ev-text', cdText);
  await tap(await center($('.event-sheet .textbtn.end')));
  const cdSheetGone = await waitFor("!document.querySelector('.event-sheet, .event-scrim')");
  await closeDay();
  const chipJs = `[...document.querySelectorAll('.cd-bar .cd-chip')].find((c) => c.textContent.includes(${JSON.stringify(cdText)}))`;
  const chipShown = await waitFor(`!!(${chipJs})`);
  const chip = await cdp.evaluate<{ days: string; hidden: boolean; below: boolean; key: string } | null>(
    `(() => { const c = ${chipJs}; if (!c) return null; const bar = document.querySelector('.cd-bar'); return { days: c.querySelector('.cd-days')?.textContent ?? '', hidden: bar.hidden, below: bar.getBoundingClientRect().top >= document.querySelector('.pager').getBoundingClientRect().bottom - 0.5, key: c.dataset.key }; })()`,
  );
  record(
    '카운트다운을 만들면 달력 아래 줄에 N일 남음으로 보인다',
    cdDayOpened && cdUp && cdSheetGone && chipShown && chip !== null && !chip.hidden && chip.below && chip.days === `${cdDays}일 남음` && chip.key === countdownKey,
    `${countdownKey}에 ${cdText}: 카운트다운 시트 ${cdUp ? '열림' : '안 열림'}, 저장 뒤 시트 ${cdSheetGone ? '닫힘' : '남음'}, 아래 줄 칩 ${chip ? `"${chip.days}"(기대 ${cdDays}일 남음, 달력 ${chip.below ? '아래' : '아래가 아님'})` : '없음'}`,
  );

  // 셀 간격: 설정에서 넓게를 고르면 .grid의 gap이 4px이 되어 칸 사이가 벌어진다.
  const gapNow = () =>
    cdp.evaluate<{ gap: string; between: number; pref: string | null }>(
      "(() => { const g = document.querySelector('.grid.current'); const [a, b] = [...g.querySelectorAll('.cell')]; const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect(); return { gap: getComputedStyle(g).gap, between: Math.round((rb.left - ra.right) * 10) / 10, pref: JSON.parse(localStorage.getItem('calfif.prefs') || 'null')?.cellGap ?? null }; })()",
    );
  const gapBefore = await gapNow();
  await tap(await center(gear));
  await sheetSettled();
  await tapIn(choice('prefCellGap', 'wide'));
  const gapWide = await gapNow();
  await tapIn(choice('prefCellGap', 'narrow'));
  const gapBack = await gapNow();
  await tap(await center($('.sheet .sheet-bar .textbtn.end')));
  await sleep(600);
  record(
    '셀 설정의 셀 간격 넓게가 달력 칸 사이에 보인다',
    gapBefore.gap === '1px' && gapWide.gap === '4px' && Math.abs(gapWide.between - 4) <= 0.5 && gapWide.pref === 'wide' && gapBack.gap === '1px' && gapBack.pref === 'narrow',
    `처음 gap ${gapBefore.gap}(칸 사이 ${gapBefore.between}px), 넓게 gap ${gapWide.gap}(칸 사이 ${gapWide.between}px, 저장 ${gapWide.pref}), 좁게로 되돌린 뒤 gap ${gapBack.gap}(저장 ${gapBack.pref})`,
  );
  await tap(await center($('.pill')));
  await rest();

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
    // Windows의 애니메이션 효과가 꺼져 있으면(설정 → 접근성 → 시각 효과) Chromium은 scrollTo의 부드러운 스크롤을 한 번에 건너뛴다.
    // 그러면 다음 달 단추와 멈췄다 떼기의 확인이 PC 설정 때문에 실패한다. 이 확인은 움직임이 켜진 기기를 보는 것이므로 켜 둔다.
    args: [`--window-size=${PHONE.width},${PHONE.height}`, '--enable-smooth-scrolling'],
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
