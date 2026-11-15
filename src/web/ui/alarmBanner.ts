import { ADVANCE_LABELS, type AlarmTrigger } from '../../core/events';

// 화면 안 알림: 시각이 된 알림을 화면 위쪽에 띄운다. 이미 떠 있으면 거기에 더한다.
// 포커스를 가져오지 않는다(편집 중인 글자판을 내리지 않는다). 스크린 리더는 aria-live로 읽는다.

function lineText(t: AlarmTrigger): string {
  const label = t.advance > 0 ? `${ADVANCE_LABELS[t.advance] ?? `${t.advance}일 전`} ` : '';
  return `${label}${t.time} · ${t.text}`;
}

export function showAlarmBanner(
  root: HTMLElement,
  triggers: AlarmTrigger[],
  onOpen: (dateKey: string) => void,
): { destroy(): void } {
  let banner = root.querySelector<HTMLElement>(':scope > .alarm-banner');
  if (!banner) {
    const made = document.createElement('div');
    made.className = 'alarm-banner';
    made.setAttribute('role', 'alertdialog');
    made.setAttribute('aria-live', 'assertive');
    made.setAttribute('aria-label', '알림');
    const list = document.createElement('div');
    list.className = 'alarm-list';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'alarm-ok';
    ok.textContent = '확인';
    ok.addEventListener('click', () => made.remove());
    made.append(list, ok);
    root.append(made);
    banner = made;
  }
  const list = banner.querySelector('.alarm-list')!;
  const added: HTMLElement[] = [];
  for (const t of triggers) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'alarm-item';
    item.textContent = lineText(t);
    item.addEventListener('click', () => onOpen(t.occurrence));
    list.append(item);
    added.push(item);
  }
  const shown = banner;
  return {
    destroy(): void {
      for (const item of added) item.remove();
      if (!shown.querySelector('.alarm-item')) shown.remove();
    },
  };
}
