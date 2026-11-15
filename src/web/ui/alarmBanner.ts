import { ADVANCE_LABELS, type AlarmTrigger } from '../../core/events';
import { todayKey } from '../../core/dates';

// 화면 안 알림: 시각이 된 알림을 화면 위쪽에 아이폰 알림처럼 띄운다. 이미 떠 있으면 거기에 더한다.
// 포커스를 가져오지 않는다(편집 중인 글자판을 내리지 않는다). 스크린 리더는 aria-live로 읽는다.

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 알림 아래 줄: 시각, 오늘이 아니면 그 날짜, 미리 알림이면 며칠 전인지. */
export function metaText(t: AlarmTrigger, today: string): string {
  const [y, m, d] = t.occurrence.split('-').map(Number);
  const day = `${m}월 ${d}일 (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
  const when = t.occurrence === today ? `오늘 ${t.time}` : `${day} ${t.time}`;
  return t.advance > 0 ? `${ADVANCE_LABELS[t.advance] ?? `${t.advance}일 전`} 알림 · ${when}` : when;
}

const BELL = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.6 1.6A.8.8 0 0 0 4 19h16a.8.8 0 0 0 .6-1.4Z"/></svg>';

export function showAlarmBanner(
  root: HTMLElement,
  triggers: AlarmTrigger[],
  onOpen: (dateKey: string) => void,
  now: () => Date = () => new Date(),
): { destroy(): void } {
  let banner = root.querySelector<HTMLElement>(':scope > .alarm-banner');
  if (!banner) {
    const made = document.createElement('div');
    made.className = 'alarm-banner';
    made.setAttribute('role', 'alertdialog');
    made.setAttribute('aria-live', 'assertive');
    made.setAttribute('aria-label', '알림');
    const head = document.createElement('div');
    head.className = 'alarm-head';
    const icon = document.createElement('span');
    icon.className = 'alarm-icon';
    icon.innerHTML = BELL;
    const app = document.createElement('span');
    app.className = 'alarm-app';
    app.textContent = '알림';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'alarm-ok';
    ok.textContent = '확인';
    ok.addEventListener('click', () => made.remove());
    head.append(icon, app, ok);
    const list = document.createElement('div');
    list.className = 'alarm-list';
    made.append(head, list);
    root.append(made);
    banner = made;
  }
  const shown = banner;
  const list = shown.querySelector('.alarm-list')!;
  const today = todayKey(now());
  const added: HTMLElement[] = [];
  for (const t of triggers) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'alarm-item';
    const text = document.createElement('span');
    text.className = 'alarm-text';
    text.textContent = t.text;
    const meta = document.createElement('span');
    meta.className = 'alarm-meta';
    meta.textContent = metaText(t, today);
    item.append(text, meta);
    item.addEventListener('click', () => {
      // 편집 화면이 열리므로 눌린 줄은 치우고, 남은 줄이 없으면 상자도 닫는다.
      item.remove();
      if (!list.querySelector('.alarm-item')) shown.remove();
      onOpen(t.occurrence);
    });
    list.append(item);
    added.push(item);
  }
  return {
    destroy(): void {
      for (const item of added) item.remove();
      if (!shown.querySelector('.alarm-item')) shown.remove();
    },
  };
}
