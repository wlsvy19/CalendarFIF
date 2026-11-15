import { BrowserWindow, app, screen } from 'electron';
import { ALARM_OK_TITLE, alarmPopupHtml, alarmWindowOptions, planAlarmPopup } from './alarmPopup';
import type { AlarmPopupItem, AlarmTone } from './api';

// 알림 시각에 맨 위에 뜨는 작은 창. 달력 창과 따로이고, 달력 창의 순서 처리(window.ts)의 대상이 아니다.
const WIDTH = 340;
const MARGIN = 16;
const MAX_HEIGHT = 420;

/** 떠 있는 창과 그 상태. closing은 확인을 눌러 닫히는 중(close 뒤, closed 전)이다. */
type Popup = { win: BrowserWindow; shown: AlarmPopupItem[]; closing: boolean; toneAt: number | null };
let popup: Popup | null = null;

const heightFor = (count: number): number => Math.min(MAX_HEIGHT, 110 + count * 44);

function place(win: BrowserWindow, count: number): void {
  const area = screen.getPrimaryDisplay().workArea;
  const height = heightFor(count);
  win.setBounds({ x: area.x + area.width - WIDTH - MARGIN, y: area.y + area.height - height - MARGIN, width: WIDTH, height });
}

function load(win: BrowserWindow, items: AlarmPopupItem[], tone: AlarmTone): void {
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(alarmPopupHtml(items, tone))}`);
}

export function showAlarmWindow(items: AlarmPopupItem[], tone: AlarmTone): void {
  const now = Date.now();
  const live = popup && !popup.win.isDestroyed() ? popup : null;
  const plan = planAlarmPopup(live, items, tone, now);
  if (plan.reuse && live) {
    // 떠 있으면 항목을 합쳐(최근 20개) 다시 연다. 몇 초 안에 소리를 냈으면 다시 내지 않는다.
    live.shown = plan.items;
    if (plan.tone !== 'none') live.toneAt = now;
    place(live.win, plan.items.length);
    load(live.win, plan.items, plan.tone);
    return;
  }
  // 창이 없거나 닫히는 중이면 새 창을 연다. 닫히는 창에 합치면 그 알림도 함께 사라진다.
  const win = new BrowserWindow(alarmWindowOptions(heightFor(plan.items.length), app.isPackaged));
  const mine: Popup = { win, shown: plan.items, closing: false, toneAt: plan.tone !== 'none' ? now : null };
  popup = mine;
  win.setMenu(null);
  // 확인은 페이지가 제목을 바꿔 알린다(페이지가 직접 닫으면 close가 오지 않는다. data 주소는 #주소 이동도 알려 주지 않는다).
  // 닫는 것은 이쪽이 맡아 닫히는 중임을 먼저 적는다.
  win.webContents.on('page-title-updated', (e, title) => {
    if (title !== ALARM_OK_TITLE) return;
    e.preventDefault();
    mine.closing = true;
    if (!win.isDestroyed()) win.close();
  });
  win.on('close', () => {
    mine.closing = true;
  });
  win.on('closed', () => {
    if (popup === mine) popup = null; // 그 사이 연 새 창은 그대로 둔다
  });
  // 이동과 새 창은 installSecurity(window.ts)가 모든 창에 대해 막는다.
  place(win, plan.items.length);
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  load(win, plan.items, plan.tone);
}

/** 시험용: 지금 떠 있는 알림 창. */
export function alarmWindowForSmoke(): BrowserWindow | null {
  return popup && !popup.win.isDestroyed() ? popup.win : null;
}
