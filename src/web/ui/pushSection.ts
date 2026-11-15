import { SENDER_STALE_MS, type PushDoc } from '../../push/doc';
import type { PushView } from '../push';

// 설정 화면의 "아이폰 알림" 칸: 이 기기에서 푸시 알림을 켜고 끄고 시험하며, 알림 서버(Apps Script)를 만드는 방법과 스크립트를 준다.

export type PushSectionDeps = {
  client: { view(): PushView; onChange(fn: () => void): () => void; enable(): Promise<void>; disable(): Promise<void>; test(): Promise<void> };
  /** 알림 보내는 스크립트의 글을 읽어 온다. */
  loadScript(): Promise<string>;
  copy(text: string): Promise<void>;
  now(): number;
};

export const SERVER_STEPS = [
  'PC의 브라우저에서 Firebase 콘솔(console.firebase.google.com)을 열고 이 달력의 프로젝트를 고릅니다. 왼쪽 위 톱니바퀴 → 프로젝트 설정 → "서비스 계정" 탭 → "새 비공개 키 생성" → "키 생성"을 누르면 JSON 파일 하나가 내려받아집니다. 이 파일은 누구에게도 보내지 마세요.',
  'script.google.com을 Firebase와 같은 Google 계정으로 열고 "새 프로젝트"를 누릅니다. 위쪽의 "제목 없는 프로젝트"를 눌러 이름을 "CalendarFIF 알림"으로 바꿉니다.',
  '이 칸의 "알림 서버 스크립트 복사"를 누릅니다. 편집기(Code.gs)에 있던 글을 모두 지우고 붙여 넣은 뒤 저장(Ctrl+S)합니다.',
  '왼쪽의 톱니바퀴(프로젝트 설정)에서 시간대를 "(GMT+09:00) 서울"로 고릅니다. 같은 화면 아래 "스크립트 속성 추가"를 누르고, 속성에 SERVICE_ACCOUNT, 값에 1번 파일의 내용 전체를 넣은 뒤 "스크립트 속성 저장"을 누릅니다(파일을 메모장으로 열어 Ctrl+A, Ctrl+C). 넣은 뒤에는 PC의 키 파일을 지워도 됩니다.',
  '왼쪽의 "<>"(편집기)로 돌아가 위쪽 함수 고르기에서 setup을 고르고 "실행"을 누릅니다. "권한 검토" → 계정 고르기 → "고급" → "CalendarFIF 알림(으)로 이동(안전하지 않음)" → "허용"을 누릅니다. 직접 만든 스크립트라 확인 안 된 앱으로 나옵니다.',
  '아래 실행 로그에 "설정이 끝났습니다"가 나오면 됩니다. 다른 글이 나오면 그 글대로 고치거나 그 글을 알려 주세요.',
  '아이폰의 홈 화면에 있는 CalendarFIF 앱에서 설정 → 아이폰 알림 → "이 아이폰에서 알림 받기" → "허용"을 누르고, "시험 알림 보내기"로 확인합니다.',
];

const MODE_TEXT: Record<PushView['mode'], string> = {
  install: '아이폰 알림은 홈 화면에 추가한 CalendarFIF 앱에서 켭니다. Safari나 위젯으로 연 화면에서는 켤 수 없으니, 홈 화면의 CalendarFIF 아이콘으로 열어 주세요.',
  unsupported: '이 브라우저는 푸시 알림을 받을 수 없습니다.',
  denied: '알림이 막혀 있습니다. 아이폰 설정 → 알림 → CalendarFIF에서 "알림 허용"을 켠 뒤 앱을 다시 열어 주세요.',
  off: '이 기기는 알림을 받지 않습니다. 켜면 앱을 닫거나 화면을 잠가도 알림이 옵니다.',
  on: '이 기기로 알림이 옵니다. 앱을 닫거나 화면을 잠가도 옵니다.',
};

/** 알림 서버(보내는 쪽)의 상태 글. 기기가 하나도 없으면 빈 글. */
export function serverText(doc: PushDoc | null, now: number): string {
  if (!doc || Object.keys(doc.devices).length === 0) return '';
  const s = doc.sender;
  if (!s || s.at <= 0) return '알림 서버가 아직 연결되지 않았습니다. PC에서 아래 "알림 서버 만들기"를 한 번 해 주세요.';
  if (s.error) return `알림 서버 문제: ${s.error}`;
  const minutes = Math.floor((now - s.at) / 60_000);
  if (now - s.at >= SENDER_STALE_MS) return `알림 서버가 ${minutes}분 동안 확인하지 않았습니다. Apps Script의 "실행" 기록에 오류가 있는지 보세요.`;
  return minutes < 1 ? '알림 서버: 방금 확인했습니다.' : `알림 서버: ${minutes}분 전에 확인했습니다.`;
}

export function pushSection(deps: PushSectionDeps): { el: HTMLElement; destroy(): void } {
  const field = document.createElement('div');
  field.className = 'field push-field';
  field.innerHTML = `
    <span class="field-label">아이폰 알림</span>
    <p class="settings-note push-state"></p>
    <div class="push-actions">
      <button type="button" class="settings-btn push-enable">이 아이폰에서 알림 받기</button>
      <button type="button" class="settings-btn push-test">시험 알림 보내기</button>
      <button type="button" class="settings-btn push-disable">끄기</button>
    </div>
    <p class="settings-note push-server"></p>
    <p class="settings-note push-message" role="status"></p>
    <details class="widget-steps push-steps">
      <summary>알림 서버 만들기 (PC에서 한 번)</summary>
      <p class="settings-note">알림은 Google Apps Script(무료)가 1분마다 확인해 보냅니다. 처음 한 번만 PC에서 만들면 됩니다.</p>
      <button type="button" class="settings-btn push-copy" disabled>알림 서버 스크립트 복사</button>
      <p class="settings-note push-copy-status" role="status"></p>
      <ol></ol>
      <textarea class="widget-script" readonly hidden aria-label="알림 서버 스크립트"></textarea>
    </details>`;
  const q = <T extends HTMLElement>(sel: string): T => field.querySelector<T>(sel)!;
  const state = q('.push-state');
  const enable = q<HTMLButtonElement>('.push-enable');
  const test = q<HTMLButtonElement>('.push-test');
  const disable = q<HTMLButtonElement>('.push-disable');
  const server = q('.push-server');
  const message = q('.push-message');
  const copyBtn = q<HTMLButtonElement>('.push-copy');
  const copyStatus = q('.push-copy-status');
  const area = q<HTMLTextAreaElement>('textarea');
  for (const text of SERVER_STEPS) {
    const li = document.createElement('li');
    li.textContent = text;
    q('ol').append(li);
  }

  const paint = (): void => {
    const v = deps.client.view();
    state.textContent = MODE_TEXT[v.mode];
    enable.hidden = v.mode !== 'off';
    test.hidden = v.mode !== 'on';
    disable.hidden = v.mode !== 'on';
    for (const b of [enable, test, disable]) b.disabled = v.busy;
    server.textContent = serverText(v.doc, deps.now());
    server.hidden = server.textContent === '';
    message.textContent = v.message;
    message.hidden = v.message === '';
  };
  const off = deps.client.onChange(paint);
  // 서버 상태의 "n분 전"이 흐르도록 30초마다 다시 적는다.
  const timer = setInterval(paint, 30_000);
  paint();
  enable.addEventListener('click', () => void deps.client.enable());
  test.addEventListener('click', () => void deps.client.test());
  disable.addEventListener('click', () => void deps.client.disable());

  // 클립보드 쓰기는 누르는 순간에 시작해야 하므로 글은 미리 읽어 둔다.
  let script = '';
  copyStatus.textContent = '불러오는 중';
  deps.loadScript().then(
    (text) => {
      script = text;
      copyStatus.textContent = '';
      copyBtn.disabled = false;
    },
    () => {
      copyStatus.textContent = '스크립트를 불러오지 못했습니다. 연결을 확인하고 설정을 다시 열어 주세요.';
    },
  );
  copyBtn.addEventListener('click', () => {
    let pending: Promise<void>;
    try {
      pending = deps.copy(script);
    } catch (e) {
      pending = Promise.reject(e);
    }
    pending.then(
      () => {
        area.hidden = true;
        copyStatus.textContent = '복사했습니다. Apps Script 편집기에 붙여 넣으세요.';
      },
      () => {
        area.value = script;
        area.hidden = false;
        area.focus({ preventScroll: true });
        area.select();
        copyStatus.textContent = '복사하지 못했습니다. 아래 글을 모두 골라 복사하세요.';
      },
    );
  });

  return {
    el: field,
    destroy(): void {
      off();
      clearInterval(timer);
    },
  };
}
