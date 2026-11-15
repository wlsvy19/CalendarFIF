import { BrowserWindow, screen } from 'electron';
import { MAX_ALARM_ITEMS, alarmPopupHtml } from './alarmPopup';
import type { AlarmPopupItem, AlarmTone } from './api';

// 알림 시각에 맨 위에 뜨는 작은 창. 달력 창과 따로이고, 달력 창의 순서 처리(window.ts)의 대상이 아니다.
const WIDTH = 340;
const MARGIN = 16;
const MAX_HEIGHT = 420;

let popup: BrowserWindow | null = null;
let shown: AlarmPopupItem[] = [];

const heightFor = (count: number): number => Math.min(MAX_HEIGHT, 110 + count * 44);

function place(win: BrowserWindow, count: number): void {
  const area = screen.getPrimaryDisplay().workArea;
  const height = heightFor(count);
  win.setBounds({ x: area.x + area.width - WIDTH - MARGIN, y: area.y + area.height - height - MARGIN, width: WIDTH, height });
}

function load(win: BrowserWindow, tone: AlarmTone): void {
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(alarmPopupHtml(shown, tone))}`);
}

export function showAlarmWindow(items: AlarmPopupItem[], tone: AlarmTone): void {
  if (popup && !popup.isDestroyed()) {
    // 이미 떠 있으면 항목을 합쳐(최대 20) 다시 연다.
    shown = [...shown, ...items].slice(0, MAX_ALARM_ITEMS);
    place(popup, shown.length);
    load(popup, tone);
    return;
  }
  shown = items.slice(0, MAX_ALARM_ITEMS);
  const win = new BrowserWindow({
    width: WIDTH, height: heightFor(shown.length), frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: false, show: false,
    title: 'CalendarFIF 알림',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  popup = win;
  win.setMenu(null);
  win.on('closed', () => {
    if (popup === win) popup = null;
    shown = [];
  });
  // 이동과 새 창은 installSecurity(window.ts)가 모든 창에 대해 막는다.
  place(win, shown.length);
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  load(win, tone);
}

/** 시험용: 지금 떠 있는 알림 창. */
export function alarmWindowForSmoke(): BrowserWindow | null {
  return popup && !popup.isDestroyed() ? popup : null;
}
