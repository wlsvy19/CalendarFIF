// 위젯 그림(src/widget/scene.ts)을 헤드리스 Edge의 canvas에 그리고, 기본 부품 위젯(src/widget/tree.ts)은 HTML 배치로 보여 주어 build/shots/에 PNG로 저장한다.
// 기본 부품 쪽은 HTML의 배치라서 iOS의 마지막 픽셀이 아니라 구조와 비율을 보여 준다.
// 지어낸 자료만 쓴다. 사용법: npx tsx scripts/widget-preview.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchEdge } from './cdp';
import { buildScene, messageScene, type MonthData, type Scene } from '../src/widget/scene';
import { widgetSize, type Family } from '../src/widget/sizes';
import type { Theme } from '../src/widget/theme';
import { buildTree, messageTree, type Node, type StackNode, type Tree } from '../src/widget/tree';

const SCREEN = { width: 402, height: 874 };
const SCALE = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const november: MonthData = {
  monthId: '2026-11',
  days: {
    '01': { text: '가족 모임\n점심 예약', color: '' },
    '03': { text: '[+]보고서 제출', color: '2E7D32' },
    '05': { text: '치과\n[+]약 받기\n마트', color: '' },
    '07': { text: '친구 결혼식', color: 'F12424' },
    '09': { text: '회의\n[+]자료 정리\n코드 리뷰\n배포 점검\n회고\n주간 보고\n메일 답장', color: '1976D2' },
    '11': { text: 'Dentist 3pm', color: '' },
    '12': { text: '[+]장보기\n[+]택배 보내기', color: '' },
    '13': { text: '오늘 할 일\n[+]장보기\nbuy milk\n치과 예약 전화\n운동\n세탁소', color: 'FFB300' },
    '16': { text: '아주아주아주 긴 한국어 메모 한 줄\nlong english memo line that overflows', color: '' },
    '18': { text: '점심\n저녁\n운동\n독서\n영화\n산책\n빨래', color: '2E7D32' },
    '21': { text: '가\n나\n다', color: 'F12424' },
    '25': { text: '[+]청소', color: '1976D2' },
    '27': { text: '출장 준비\n[+]표 예매\n숙소 예약', color: '' },
    '30': { text: '월말 정산', color: '' },
  },
};
const january: MonthData = {
  monthId: '2027-01',
  days: {
    '01': { text: '새해\n[+]떡국', color: 'F12424' },
    '09': { text: '스키장\n렌털\n리프트권\n점심', color: '1976D2' },
    '15': { text: '[+]치과', color: '' },
    '27': { text: '회의\n보고\n정리\n메일', color: 'FFB300' },
    '31': { text: '월말', color: '' },
  },
};

// 공휴일이 많은 달: 3일 개천절(토), 5일 대체공휴일(월), 9일 한글날(금).
const october: MonthData = {
  monthId: '2026-10',
  days: {
    '02': { text: '연휴 준비', color: '' },
    '05': { text: '가족 나들이', color: '' },
    '06': { text: '회의', color: '' },
    '09': { text: '산책', color: '2E7D32' },
    '23': { text: '보고서', color: '' },
  },
};

type Shot = { name: string; scene: Scene };
const make = (family: Family, theme: Theme, month: MonthData, today: string, offline = false): Scene =>
  buildScene({ family, theme, size: widgetSize(SCREEN, family), today, month, offline });

const shots: Shot[] = [
  { name: 'widget-large-light', scene: make('large', 'light', november, '2026-11-13') },
  { name: 'widget-large-dark', scene: make('large', 'dark', november, '2026-11-13') },
  { name: 'widget-large-6rows-light', scene: make('large', 'light', january, '2027-01-09') },
  { name: 'widget-large-offline-dark', scene: make('large', 'dark', november, '2026-11-13', true) },
  { name: 'widget-medium-light', scene: make('medium', 'light', november, '2026-11-13') },
  { name: 'widget-medium-dark', scene: make('medium', 'dark', november, '2026-11-13') },
  { name: 'widget-small-light', scene: make('small', 'light', november, '2026-11-13') },
  { name: 'widget-small-dark', scene: make('small', 'dark', november, '2026-11-13') },
  { name: 'widget-large-holidays-light', scene: make('large', 'light', october, '2026-10-23') },
  { name: 'widget-small-holiday-light', scene: make('small', 'light', october, '2026-10-05') },
  {
    name: 'widget-message-light',
    scene: messageScene({ theme: 'light', size: widgetSize(SCREEN, 'small'), title: 'CalendarFIF', lines: ['Scriptable 앱에서', '이 스크립트를 한 번 실행해', '로그인하세요.'] }),
  },
];

type NativeShot = { name: string; tree: Tree; theme: Theme; width: number; height: number };
const tree = (family: Family, month: MonthData, today: string, offline = false): Tree =>
  buildTree({ family, size: widgetSize(SCREEN, family), today, month, offline });
const sizeOf = (family: Family) => widgetSize(SCREEN, family);

const nativeShots: NativeShot[] = [
  { name: 'widget-native-large-light', tree: tree('large', november, '2026-11-13'), theme: 'light', ...sizeOf('large') },
  { name: 'widget-native-large-dark', tree: tree('large', november, '2026-11-13'), theme: 'dark', ...sizeOf('large') },
  { name: 'widget-native-large-holidays-light', tree: tree('large', october, '2026-10-23'), theme: 'light', ...sizeOf('large') },
  { name: 'widget-native-small-holiday-dark', tree: tree('small', october, '2026-10-05'), theme: 'dark', ...sizeOf('small') },
  { name: 'widget-native-large-6rows-light', tree: tree('large', january, '2027-01-09'), theme: 'light', ...sizeOf('large') },
  { name: 'widget-native-large-offline-dark', tree: tree('large', november, '2026-11-13', true), theme: 'dark', ...sizeOf('large') },
  { name: 'widget-native-medium-light', tree: tree('medium', november, '2026-11-13'), theme: 'light', ...sizeOf('medium') },
  { name: 'widget-native-medium-dark', tree: tree('medium', november, '2026-11-13'), theme: 'dark', ...sizeOf('medium') },
  { name: 'widget-native-small-light', tree: tree('small', november, '2026-11-13'), theme: 'light', ...sizeOf('small') },
  { name: 'widget-native-small-dark', tree: tree('small', november, '2026-11-13'), theme: 'dark', ...sizeOf('small') },
  { name: 'widget-native-message-light', tree: messageTree({ title: 'CalendarFIF', lines: ['Scriptable 앱에서', '이 스크립트를 한 번 실행해', '로그인하세요.'] }), theme: 'light', ...sizeOf('small') },
];

// 나무를 HTML로 바꾼다. iOS와 같은 규칙: 남는 곳 채우기(spacer)가 든 상자는 그 방향으로 늘어나고,
// 늘어나는 형제들은 남는 길이를 똑같이 나눈다. 상자는 자식 중 하나라도 늘어나면 늘어난다.
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
type Axis = 'x' | 'y';
const mainAxis = (dir: 'h' | 'v'): Axis => (dir === 'h' ? 'x' : 'y');
function flexes(node: Node, axis: Axis, parentDir: 'h' | 'v'): boolean {
  if (node.kind === 'spacer') return node.length === null && mainAxis(parentDir) === axis;
  if (node.kind === 'text') return false;
  return node.children.some((c) => flexes(c, axis, node.dir));
}
const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700 };

function nodeHtml(node: Node, parentDir: 'h' | 'v', theme: Theme): string {
  if (node.kind === 'spacer') {
    if (node.length === null) return '<div style="flex:1 1 0;min-width:0;min-height:0"></div>';
    return `<div style="flex:none;${parentDir === 'h' ? 'width' : 'height'}:${node.length}px"></div>`;
  }
  const main = mainAxis(parentDir);
  const cross: Axis = main === 'x' ? 'y' : 'x';
  const placement = [
    flexes(node, main, parentDir) ? 'flex:1 1 0;min-width:0;min-height:0' : 'flex:none',
    flexes(node, cross, parentDir) ? 'align-self:stretch' : '',
  ].filter(Boolean).join(';');
  if (node.kind === 'stack') return stackHtml(node, theme, placement);
  const clamp = node.lines > 0 ? `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${node.lines};overflow:hidden;` : '';
  const opacity = node.opacity !== undefined ? `opacity:${node.opacity};` : '';
  const style = `${placement};font-size:${node.size}px;font-weight:${WEIGHTS[node.weight]};color:${node.color[theme]};${opacity}white-space:pre-line;line-height:1.22;${clamp}`;
  return `<div style="${style}">${esc(node.text)}</div>`;
}

function stackHtml(s: StackNode, theme: Theme, placement: string): string {
  const align = s.dir === 'h' ? { top: 'flex-start', center: 'center', bottom: 'flex-end' }[s.align ?? 'top'] : 'flex-start';
  const style = [
    placement,
    'display:flex', `flex-direction:${s.dir === 'h' ? 'row' : 'column'}`, `align-items:${align}`, 'box-sizing:border-box',
    s.spacing ? `gap:${s.spacing}px` : '',
    s.padding ? `padding:${s.padding[0]}px ${s.padding[3]}px ${s.padding[2]}px ${s.padding[1]}px` : '',
    s.background ? `background:${s.background[theme]}` : '',
    s.radius !== undefined ? `border-radius:${s.radius}px` : '',
  ].filter(Boolean).join(';');
  return `<div style="${style}">${s.children.map((c) => nodeHtml(c, s.dir, theme)).join('')}</div>`;
}

/** 위젯 한 개: ListWidget은 세로로 쌓는 상자다. */
function widgetHtml(shot: NativeShot): string {
  const t = shot.tree;
  const root: StackNode = { kind: 'stack', dir: 'v', children: t.children, spacing: t.spacing, padding: t.padding, background: t.background };
  const box = stackHtml(root, shot.theme, `width:${shot.width}px;height:${shot.height}px;overflow:hidden;border-radius:22px`);
  return `<!doctype html><meta charset="utf-8"><title>${shot.name}</title><body style="margin:0;background:#8a8f98;font-family:-apple-system,'Malgun Gothic',sans-serif">${box}</body>`;
}

// 브라우저 쪽: 장면 하나를 canvas에 그린다(Scriptable의 DrawContext가 하는 일과 같다).
const PAINT = `
const FONT = '-apple-system, "Malgun Gothic", sans-serif';
const WEIGHT = { regular: 400, semibold: 600, bold: 700 };
function paint(scene, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scene.width * scale);
  canvas.height = Math.round(scene.height * scale);
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = scene.background;
  g.fillRect(0, 0, scene.width, scene.height);
  for (const d of scene.draws) {
    g.save();
    g.globalAlpha = d.alpha === undefined ? 1 : d.alpha;
    if (d.kind === 'rect') {
      g.fillStyle = d.color;
      g.beginPath();
      if (d.radius) g.roundRect(d.x, d.y, d.w, d.h, d.radius); else g.rect(d.x, d.y, d.w, d.h);
      g.fill();
    } else if (d.kind === 'text') {
      g.beginPath();
      g.rect(d.x, d.y, d.w, d.h);
      g.clip();
      g.fillStyle = d.color;
      g.font = WEIGHT[d.weight] + ' ' + d.size + 'px ' + FONT;
      g.textBaseline = 'top';
      g.textAlign = d.align;
      const x = d.align === 'left' ? d.x : d.align === 'center' ? d.x + d.w / 2 : d.x + d.w;
      g.fillText(d.text, x, d.y);
    } else {
      g.strokeStyle = d.color;
      g.lineWidth = d.width;
      g.beginPath();
      g.moveTo(d.x1, d.y1);
      g.lineTo(d.x2, d.y2);
      g.stroke();
    }
    g.restore();
  }
  return canvas.toDataURL('image/png');
}
`;

async function main(): Promise<void> {
  const outDir = resolve('build', 'shots');
  mkdirSync(outDir, { recursive: true });
  const page = resolve('build', 'widget-preview.html');
  writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>widget preview</title><body></body>');

  const { cdp, kill } = await launchEdge({ headless: true, profileDir: resolve('.tools', 'edge-profile-widget'), url: `file:///${page.replace(/\\/g, '/')}` });
  try {
    await cdp.evaluate(`${PAINT}; window.__paint = paint; document.fonts.load('600 12px "Malgun Gothic"').then(() => document.fonts.ready).then(() => true)`);
    for (const { name, scene } of shots) {
      const url = await cdp.evaluate<string>(`window.__paint(${JSON.stringify(scene)}, ${SCALE})`);
      const file = resolve(outDir, `${name}.png`);
      writeFileSync(file, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
      console.log(`${name}.png  ${scene.width}x${scene.height}pt  ${scene.draws.length} commands`);
    }
    await cdp.send('Page.enable');
    for (const shot of nativeShots) {
      const htmlFile = resolve('build', `${shot.name}.html`);
      writeFileSync(htmlFile, widgetHtml(shot));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: SCALE, mobile: false });
      await cdp.send('Page.navigate', { url: `file:///${htmlFile.replace(/\\/g, '/')}` });
      await sleep(400);
      await cdp.evaluate('document.fonts.ready.then(() => true)');
      const png = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: shot.width, height: shot.height, scale: 1 } });
      writeFileSync(resolve(outDir, `${shot.name}.png`), Buffer.from(png.data, 'base64'));
      console.log(`${shot.name}.png  ${shot.width}x${shot.height}pt  native`);
    }
  } finally {
    cdp.close();
    kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
