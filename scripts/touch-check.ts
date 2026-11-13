// 실제 터치 입력(Input.dispatchTouchEvent)으로 웹앱의 달 넘기기와 날짜 열기를 확인한다.
// 사용법: npx tsx scripts/touch-check.ts --url <주소> [--with-vite]
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { emulatePhone, launchEdge, PHONE, startVite, type Cdp } from './cdp';

/** `translate3d(-12px, 0, 0)` 같은 값에서 가로 이동량을 읽는다. 읽을 수 없으면 null. */
export function translateX(transform: string): number | null {
  const m = /translate(?:3d|X)?\(\s*(-?\d+(?:\.\d+)?)/.exec(transform);
  return m ? Number(m[1]) : null;
}

/** 끌기 중에 잰 값들이 손가락 쪽으로 따라갔는가. 왼쪽으로 끌면 음수, 오른쪽이면 양수. */
export function followsFinger(samples: string[], direction: 'left' | 'right'): boolean {
  const xs = samples.map(translateX).filter((x): x is number => x !== null && x !== 0);
  const sign = direction === 'left' ? -1 : 1;
  return xs.length > 0 && xs.every((x) => Math.sign(x) === sign);
}

/** 움직임 줄이기에서는 끌기 중에 달력이 움직이지 않는다. */
export function staysPut(samples: string[]): boolean {
  return samples.length > 0 && samples.every((s) => s === '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TITLE_JS = "document.querySelector('.year').textContent + ' ' + document.querySelector('.month').textContent";
const TRANSFORM_JS = "document.querySelector('.track').style.transform || ''";

type Result = { name: string; ok: boolean; seen: string };
type Drag = { before: string; after: string; samples: string[] };

async function run(cdp: Cdp, url: string): Promise<Result[]> {
  const results: Result[] = [];
  const record = (name: string, ok: boolean, seen: string): void => {
    results.push({ name, ok, seen });
    console.log(`${ok ? '통과' : '실패'}: ${name} (${seen})`);
  };
  const touch = (type: string, x?: number, y?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y, id: 1 }] });
  const title = () => cdp.evaluate<string>(TITLE_JS);

  await cdp.send('Page.enable');
  await emulatePhone(cdp);
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    if (await cdp.evaluate<boolean>("!!document.querySelector('.cell')").catch(() => false)) break;
    await sleep(300);
  }
  await sleep(500);
  const pagerY = await cdp.evaluate<number>(
    "(() => { const r = document.querySelector('.pager').getBoundingClientRect(); return Math.round(r.top + r.height / 2); })()",
  );

  /** 손가락을 한 점에서 다른 점으로 끌고, 끄는 동안 달력의 transform을 잰다. */
  async function drag(from: [number, number], to: [number, number]): Promise<Drag> {
    const before = await title();
    const samples: string[] = [];
    await touch('touchStart', from[0], from[1]);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
      await sleep(30);
      if (i >= 4) samples.push(await cdp.evaluate<string>(TRANSFORM_JS));
    }
    await touch('touchEnd');
    await sleep(900);
    return { before, after: await title(), samples };
  }
  const left = () => drag([340, pagerY], [60, pagerY]);
  const right = () => drag([60, pagerY], [340, pagerY]);
  const describe = (d: Drag) => `${d.before} -> ${d.after}, 끄는 동안 ${JSON.stringify(d.samples.slice(-2))}`;

  const start = await title();
  let d = await left();
  record('왼쪽으로 끌면 달력이 따라오고 다음 달이 된다', followsFinger(d.samples, 'left') && d.after !== d.before, describe(d));
  const next = d.after;
  d = await right();
  record('오른쪽으로 끌면 달력이 따라오고 이전 달이 된다', followsFinger(d.samples, 'right') && d.after === start, describe(d));
  d = await right();
  record('오른쪽으로 한 번 더 끌면 한 달 더 전으로 간다', followsFinger(d.samples, 'right') && d.after !== start && d.after !== next, describe(d));

  // 사용자가 "살짝 밀어도 넘어가야 한다"고 했다: 40px이면 넘어가고, 12px을 천천히 움직인 것은 넘어가지 않는다.
  d = await drag([220, pagerY], [180, pagerY]);
  record('40px만 밀어도 다음 달이 된다', d.after !== d.before, describe(d));
  d = await drag([180, pagerY], [220, pagerY]);
  record('40px만 반대로 밀어도 이전 달이 된다', d.after !== d.before, describe(d));
  d = await drag([200, pagerY], [212, pagerY]);
  record('12px을 천천히 움직인 것은 달을 넘기지 않는다', d.after === d.before, describe(d));

  const cell = await cdp.evaluate<{ x: number; y: number }>(
    "(() => { const c = document.querySelectorAll('.cell:not(.other)')[14].getBoundingClientRect(); return { x: Math.round(c.left + c.width / 2), y: Math.round(c.top + c.height / 2) }; })()",
  );
  await touch('touchStart', cell.x, cell.y);
  await sleep(60);
  await touch('touchEnd');
  await sleep(600);
  const opened = await cdp.evaluate<boolean>("!!document.querySelector('.sheet')");
  record('날짜 칸을 짧게 누르면 편집 화면이 열린다', opened, opened ? '.sheet 있음' : '.sheet 없음');
  if (opened) {
    await cdp.evaluate("document.querySelector('.sheet .textbtn.start').click()");
    await sleep(600);
  }

  const beforeVertical = await title();
  d = await drag([200, pagerY - 150], [200, pagerY + 150]);
  record('세로로 끌면 달이 바뀌지 않는다', d.after === beforeVertical, describe(d));

  await emulatePhone(cdp, { reducedMotion: true });
  d = await left();
  record('움직임 줄이기에서는 달이 넘어가고 끄는 동안 달력이 움직이지 않는다', staysPut(d.samples) && d.after !== d.before, describe(d));
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
