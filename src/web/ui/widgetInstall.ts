/** holidayUrl은 공휴일 자료 파일의 주소(VITE_HOLIDAY_URL)다. 빈 글이면 위젯은 계산한 공휴일만 쓴다. */
export type WidgetConfig = { projectId: string; apiKey: string; appUrl: string; holidayUrl: string };
export type WidgetInstallDeps = {
  /** 스크립트 글을 읽어 온다(자리 표시가 든 채로). */
  load(): Promise<string>;
  config: WidgetConfig;
  /** 클립보드에 쓴다. 막히면 거절한다. */
  copy(text: string): Promise<void>;
};

const PLACEHOLDERS: Array<[token: string, key: keyof WidgetConfig, mayBeEmpty?: true]> = [
  ['__PROJECT_ID__', 'projectId'],
  ['__API_KEY__', 'apiKey'],
  ['__APP_URL__', 'appUrl'],
  ['__HOLIDAY_URL__', 'holidayUrl', true],
];

/** 자리 표시 넷을 공개 설정으로 바꾼다. 하나라도 없거나 둘 이상이면, 또는 공휴일 자료 주소 말고 빈 값이 있으면 오류를 던진다. */
export function fillPlaceholders(script: string, config: WidgetConfig): string {
  let out = script;
  for (const [token, key, mayBeEmpty] of PLACEHOLDERS) {
    const value = config[key] ?? '';
    if (!value && !mayBeEmpty) throw new Error(`${key} 값이 비어 있습니다.`);
    const parts = out.split(token);
    if (parts.length !== 2) throw new Error(`${token}이(가) ${parts.length - 1}번 나옵니다.`);
    // 큰따옴표 글자열 안에 들어가므로 따옴표와 역슬래시를 막는다.
    out = parts.join(JSON.stringify(value).slice(1, -1));
  }
  return out;
}

const STEPS = [
  'App Store에서 Scriptable을 설치합니다(무료).',
  '위의 단추로 스크립트를 복사합니다.',
  'Scriptable을 열고 오른쪽 위 +를 눌러 새 스크립트를 만든 뒤 붙여 넣습니다. 이름을 CalendarFIF로 바꿉니다.',
  '▶를 눌러 한 번 실행하고, 이 달력에 쓰는 이메일과 비밀번호로 로그인합니다. 비밀번호는 저장되지 않습니다.',
  '홈 화면의 빈 곳을 길게 누른 뒤 왼쪽 위의 "편집" → "위젯 추가"(예전 iOS에서는 +)를 눌러 Scriptable의 큰 위젯을 추가합니다.',
  '추가한 위젯을 길게 눌러 "위젯 편집"에서 Script를 CalendarFIF로 고릅니다.',
];
const NOTES = [
  '한 번 붙여 넣으면 그 뒤로는 위젯이 스스로 새 버전을 받습니다(세 시간에 한 번 확인합니다). 바로 받으려면 Scriptable에서 CalendarFIF를 한 번 실행합니다. 0.9.0보다 앞의 스크립트를 쓰고 있다면 이번 한 번만 다시 붙여 넣으세요.',
  '위젯은 아이폰이 정한 때(보통 15~60분마다)에 새로 그려집니다. 위젯을 누르면 Scriptable을 거쳐 Safari에서 달력이 열립니다(iOS에서는 위젯이 홈 화면 앱을 바로 열 수 없습니다). 주소창 없이 보려면 홈 화면의 CalendarFIF 아이콘을 누르세요.',
  'Safari로 넘어가는 것이 싫으면 "위젯 편집"의 Parameter에 inapp을 적으세요. 위젯을 누르면 Scriptable 안에서 달력이 열립니다(주소창이 없습니다). 그 화면에서 한 번 로그인해야 하고, Scriptable이 열리는 것 자체는 없앨 수 없습니다.',
  '오류가 나오거나, 비어 보이거나, 모양이 어긋나 보이면 "위젯 편집"의 Parameter에 image dark 또는 image light를 적으면 그림 방식으로 그립니다.',
];

/** 설정 화면의 위젯 칸. */
export function widgetSection(deps: WidgetInstallDeps): HTMLElement {
  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
    <span class="field-label">위젯</span>
    <button type="button" class="settings-btn" disabled>위젯 스크립트 복사</button>
    <p class="settings-note" role="status"></p>
    <details class="widget-steps">
      <summary>설치 방법</summary>
      <ol></ol>
    </details>
    <textarea class="widget-script" readonly hidden aria-label="위젯 스크립트"></textarea>`;
  const button = field.querySelector<HTMLButtonElement>('button')!;
  const status = field.querySelector<HTMLElement>('[role="status"]')!;
  const list = field.querySelector('ol')!;
  const area = field.querySelector<HTMLTextAreaElement>('textarea')!;
  for (const text of STEPS) {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
  }
  for (const text of NOTES) {
    const p = document.createElement('p');
    p.className = 'settings-note';
    p.textContent = text;
    field.querySelector('details')!.append(p);
  }

  let filled = '';
  status.textContent = '불러오는 중';
  const prepared = (): void => {
    status.textContent = '';
    button.disabled = false;
  };
  const failed = (): void => {
    status.textContent = '스크립트를 준비하지 못했습니다.';
  };
  deps.load().then(
    (script) => {
      try {
        filled = fillPlaceholders(script, deps.config);
      } catch {
        failed();
        return;
      }
      prepared();
    },
    failed,
  );

  // 클립보드 쓰기는 누르는 바로 그 순간에 시작해야 하므로, 글은 미리 읽어 둔다.
  button.addEventListener('click', () => {
    let pending: Promise<void>;
    try {
      pending = deps.copy(filled);
    } catch (e) {
      pending = Promise.reject(e);
    }
    pending.then(
      () => {
        area.hidden = true;
        status.textContent = '복사했습니다. Scriptable에 붙여 넣으세요.';
      },
      () => {
        area.value = filled;
        area.hidden = false;
        area.focus({ preventScroll: true });
        area.select();
        area.setSelectionRange(0, area.value.length); // 아이폰에서는 select()만으로 안 골라질 때가 많다
        status.textContent = '복사하지 못했습니다. 아래 글을 길게 눌러 전체 선택한 뒤 복사하세요.';
      },
    );
  });
  return field;
}
