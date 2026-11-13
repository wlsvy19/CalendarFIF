// 위젯이 그릴 장면(src/widget/scene.ts)을 헤드리스 Edge의 canvas에 그려서 build/shots/에 PNG로 저장한다.
// 지어낸 자료만 쓴다. 사용법: npx tsx scripts/widget-preview.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchEdge } from './cdp';
import { buildScene, messageScene, type MonthData, type Scene } from '../src/widget/scene';
import { widgetSize, type Family } from '../src/widget/sizes';
import type { Theme } from '../src/widget/theme';

const SCREEN = { width: 402, height: 874 };
const SCALE = 3;

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
  {
    name: 'widget-message-light',
    scene: messageScene({ theme: 'light', size: widgetSize(SCREEN, 'small'), title: 'CalendarFIF', lines: ['Scriptable에서 이 스크립트를 한 번 실행해', '로그인하세요.'] }),
  },
];

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
