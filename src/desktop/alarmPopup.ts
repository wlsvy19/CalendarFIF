import type { BrowserWindowConstructorOptions } from 'electron';
import { ADVANCE_DAYS, ADVANCE_LABELS } from '../core/events';
import type { AlarmPopupItem, AlarmTone } from './api';

// PC 알림 창의 순수한 부분: 화면에서 온 항목을 거르고, 창의 설정과 HTML을 만들고, 떠 있는 창에 합칠지 정한다.
// Electron의 값은 쓰지 않는다(타입만).

export const MAX_ALARM_ITEMS = 20;
/** 이만큼 안에 소리를 냈으면 떠 있는 창에 합칠 때 다시 내지 않는다. */
export const TONE_QUIET_MS = 5000;
const WIDTH = 340;

/** 알림 창의 설정. 꾸린 앱(packaged)에서는 달력 창처럼 개발자 도구를 막는다. */
export function alarmWindowOptions(height: number, packaged: boolean): BrowserWindowConstructorOptions {
  return {
    width: WIDTH, height, frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: false, show: false,
    title: 'CalendarFIF 알림',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required', devTools: !packaged },
  };
}

/** 지금 창의 상태. closing: 확인을 눌러 닫히는 중이다(closed가 오기 전). toneAt: 마지막으로 소리를 낸 때. */
export type AlarmPopupState = { closing: boolean; shown: AlarmPopupItem[]; toneAt: number | null };
/** reuse: 떠 있는 창에 합쳐 다시 연다. items: 그 창에 보일 것, tone: 이번에 낼 소리. */
export type AlarmPopupPlan = { reuse: boolean; items: AlarmPopupItem[]; tone: AlarmTone };

/**
 * 새 알림을 어디에 보일지 정한다. 떠 있고 닫히는 중이 아닌 창에는 합친다(20개를 넘으면 최근 것 20개). 그때 몇 초 안에 소리를
 * 냈으면 다시 내지 않는다. 창이 없거나 닫히는 중이면 새 창을 연다(닫히는 창에 합치면 함께 사라진다).
 */
export function planAlarmPopup(current: AlarmPopupState | null, items: AlarmPopupItem[], tone: AlarmTone, now: number): AlarmPopupPlan {
  if (current && !current.closing) {
    const quiet = current.toneAt !== null && now - current.toneAt < TONE_QUIET_MS;
    return { reuse: true, items: [...current.shown, ...items].slice(-MAX_ALARM_ITEMS), tone: quiet ? 'none' : tone };
  }
  return { reuse: false, items: items.slice(-MAX_ALARM_ITEMS), tone };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function realDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function sanitizeAlarmItems(input: unknown): AlarmPopupItem[] {
  if (!Array.isArray(input)) return [];
  const out: AlarmPopupItem[] = [];
  for (const raw of input) {
    if (out.length >= MAX_ALARM_ITEMS) break;
    if (!isObject(raw)) continue;
    const { time, text, date, advance } = raw;
    if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    if (typeof text !== 'string' || text.length < 1 || text.length > 200) continue;
    if (!realDate(date)) continue;
    if (typeof advance !== 'number' || !ADVANCE_DAYS.includes(advance)) continue;
    out.push({ time, text, date, advance });
  }
  return out;
}

export function parseAlarmTone(v: unknown): AlarmTone {
  return v === 'chime' || v === 'bell' ? v : 'none';
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// src/web/tones.ts의 chime, bell과 같은 소리를 짧게 다시 쓴 것이다. 창이 뜰 때 한 번 낸다.
const TONE_SCRIPT = `
const tone = '__TONE__';
try {
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  const note = (freq, start, length, volume, decay) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    if (decay) gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + length);
  };
  const t = ctx.currentTime;
  if (tone === 'chime') [880, 1175, 1568].forEach((f, i) => note(f, t + i * 0.18, 0.18, 0.15, false));
  else [[660, 0.1, 1.4], [1650, 0.05, 1.0], [2640, 0.03, 0.6]].forEach(([f, v, len]) => note(f, t, len, v, true));
} catch (e) {}
`;

/** 미리 알림의 말(웹앱의 알림 상자와 같은 ADVANCE_LABELS)과 그 날짜. 당일은 적지 않는다. */
function advanceNote(i: AlarmPopupItem): string {
  if (i.advance <= 0) return '';
  const [, m, d] = i.date.split('-').map(Number);
  return `${ADVANCE_LABELS[i.advance] ?? `${i.advance}일 전`} · ${m}월 ${d}일`;
}

export function alarmPopupHtml(items: AlarmPopupItem[], tone: AlarmTone): string {
  const rows = items
    .map((i) => {
      const note = advanceNote(i);
      const early = note ? `<span class="note">${escapeHtml(note)}</span>` : '';
      return `<li><b>${escapeHtml(i.time)}</b><span class="text">${escapeHtml(i.text)}</span>${early}</li>`;
    })
    .join('');
  const sound = tone === 'none' ? '' : TONE_SCRIPT.replace('__TONE__', tone);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>CalendarFIF 알림</title>
<style>
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; box-sizing: border-box; padding: 14px 16px; background: #1e232c; color: #f2f4f8; font: 14px 'Malgun Gothic', sans-serif; border: 1px solid #4a5568; }
h1 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #9fb3d1; }
ul { flex: 1; margin: 0; padding: 0; list-style: none; overflow-y: auto; }
li { padding: 6px 0; border-top: 1px solid #323a47; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
li b { font-size: 15px; }
.text { word-break: break-word; }
.note { width: 100%; font-size: 12px; color: #9fb3d1; }
button { align-self: flex-end; margin-top: 8px; padding: 6px 18px; border: 0; border-radius: 6px; background: #3d7be0; color: #fff; font: inherit; cursor: pointer; }
</style></head>
<body>
<h1>CalendarFIF 알림</h1>
<ul>${rows}</ul>
<button id="ok" type="button" autofocus>확인</button>
<script>
document.getElementById('ok').addEventListener('click', () => window.close());
${sound}
</script>
</body></html>`;
}
