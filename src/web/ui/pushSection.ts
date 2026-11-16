import type { PushView } from '../push';

// 설정 화면의 "알림" 칸: 이 기기에서 푸시 알림을 켜고 끄는 스위치 하나. 켤 수 없는 화면이거나 켜지 못했을 때만 까닭을 한 줄 적는다.
// (2026-11-16 사용자가 시험 알림, 알림 서버 상태, 만드는 방법 안내를 빼고 켜기/끄기만 두라고 했다.)

export type PushSectionDeps = {
  client: { view(): PushView; onChange(fn: () => void): () => void; enable(): Promise<void>; disable(): Promise<void> };
};

/** 스위치를 쓸 수 없는 때의 짧은 까닭. */
const BLOCKED: Partial<Record<PushView['mode'], string>> = {
  install: '홈 화면의 CalendarFIF 앱에서 켤 수 있습니다.',
  unsupported: '이 브라우저에서는 쓸 수 없습니다.',
  denied: '아이폰 설정 → 알림 → CalendarFIF에서 허용해 주세요.',
};

export function pushSection(deps: PushSectionDeps): { el: HTMLElement; destroy(): void } {
  const field = document.createElement('div');
  field.className = 'field push-field';
  field.innerHTML = `
    <span class="field-label">알림</span>
    <label class="pref-row"><span class="pref-name">알림 받기</span><input type="checkbox" class="switch" role="switch"></label>
    <p class="settings-note push-message" role="status" hidden></p>`;
  const sw = field.querySelector<HTMLInputElement>('input.switch')!;
  const note = field.querySelector<HTMLElement>('.push-message')!;

  // 누른 일이 끝날 때까지(아이폰의 권한 질문이 떠 있는 동안 포함) 스위치를 막고 누른 대로 둔다.
  let pending = false;
  const paint = (): void => {
    const v = deps.client.view();
    const busy = pending || v.busy;
    if (!busy) sw.checked = v.mode === 'on';
    sw.disabled = busy || (v.mode !== 'on' && v.mode !== 'off');
    // 다시 누르면 지난번 까닭은 지운다. 끝나면 새 까닭(있으면)을 보인다.
    const text = busy ? '' : v.message || BLOCKED[v.mode] || '';
    note.textContent = text;
    note.hidden = text === '';
  };
  const off = deps.client.onChange(paint);
  paint();
  // 아이폰은 누름 안에서만 알림 권한을 물으므로 click에서 바로 부른다.
  sw.addEventListener('click', () => {
    const run = sw.checked ? deps.client.enable() : deps.client.disable();
    pending = true;
    paint();
    void run.finally(() => {
      pending = false;
      paint();
    });
  });

  return { el: field, destroy: off };
}
