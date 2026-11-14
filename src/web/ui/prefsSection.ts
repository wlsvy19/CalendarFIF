import { ACCENTS, type Accent, type Prefs } from '../prefs';

type Choice<T> = { value: T; label: string };

/** 여럿 가운데 하나를 고르는 단추 줄(radiogroup). 화살표 키로 옮긴다. */
function segmented<T extends string | number>(labelId: string, choices: Choice<T>[], current: T, onPick: (value: T) => void, className = 'segmented'): HTMLElement {
  const group = document.createElement('div');
  group.className = className;
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', labelId);
  const buttons = choices.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.value = String(c.value);
    if (className === 'segmented') b.textContent = c.label;
    else {
      b.setAttribute('aria-label', c.label);
      b.title = c.label;
    }
    group.append(b);
    return b;
  });
  let value = current;
  const paint = (): void => {
    // 고른 것이 목록에 없으면(직접 고친 값) 첫 단추가 Tab을 받는다.
    const picked = choices.findIndex((c) => c.value === value);
    buttons.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === picked));
      b.tabIndex = i === Math.max(0, picked) ? 0 : -1;
    });
  };
  const pick = (index: number, focus: boolean): void => {
    value = choices[index].value;
    paint();
    if (focus) buttons[index].focus();
    onPick(value);
  };
  group.addEventListener('click', (e) => {
    const index = buttons.indexOf((e.target as Element).closest('button') as HTMLButtonElement);
    if (index >= 0 && choices[index].value !== value) pick(index, false);
  });
  group.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const from = Math.max(0, choices.findIndex((c) => c.value === value));
    pick((from + step + choices.length) % choices.length, true);
  });
  paint();
  return group;
}

function row(label: string, control: HTMLElement, labelId?: string, className = 'pref-row'): HTMLElement {
  // 스위치는 글자를 눌러도 바뀌게 label로 감싼다. 단추 줄은 글자에 id를 주어 이름으로 쓴다.
  const el = document.createElement(control instanceof HTMLInputElement ? 'label' : 'div');
  el.className = className;
  const text = document.createElement('span');
  text.className = 'pref-name';
  text.textContent = label;
  if (labelId) text.id = labelId;
  el.append(text, control);
  return el;
}

function toggle(checked: boolean, onChange: (on: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'switch';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function field(title: string, rows: HTMLElement[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'field prefs';
  const label = document.createElement('span');
  label.className = 'field-label';
  label.textContent = title;
  el.append(label, ...rows);
  return el;
}

/**
 * 설정 화면의 화면, 달력, 메모 칸. 고르면 바로 onChange에 새 설정을 준다(저장과 적용은 부른 쪽이 한다).
 * 감싸는 요소는 상자를 만들지 않는다(display: contents).
 */
export function prefsSection(props: { prefs: Prefs; onChange(next: Prefs): void }): HTMLElement {
  let prefs = props.prefs;
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]): void => {
    prefs = { ...prefs, [key]: value };
    props.onChange(prefs);
  };
  const el = document.createElement('div');
  el.style.display = 'contents';

  const accents = segmented<Accent>(
    'prefAccent',
    (Object.keys(ACCENTS) as Accent[]).map((value) => ({ value, label: ACCENTS[value].label })),
    prefs.accent,
    (v) => set('accent', v),
    'swatches accents',
  );
  for (const b of accents.querySelectorAll<HTMLElement>('button')) {
    const accent = ACCENTS[b.dataset.value as Accent];
    b.className = 'swatch';
    b.style.setProperty('--sw-light', accent.light);
    b.style.setProperty('--sw-dark', accent.dark);
  }

  el.append(
    field('화면', [
      row('밝기', segmented('prefTheme', [{ value: 'auto', label: '자동' }, { value: 'light', label: '밝게' }, { value: 'dark', label: '어둡게' }], prefs.theme, (v) => set('theme', v)), 'prefTheme'),
      row('색상', accents, 'prefAccent', 'pref-row stack'), // 색상 여덟 개는 이름 아래 한 줄에 놓는다
    ]),
    field('달력', [
      row('음력', toggle(prefs.lunar, (on) => set('lunar', on))),
      row('공휴일', toggle(prefs.holidays, (on) => set('holidays', on))),
      row('주 번호', toggle(prefs.weekNumbers, (on) => set('weekNumbers', on))),
      row('한 주의 시작', segmented('prefWeekStart', [{ value: 0, label: '일요일' }, { value: 1, label: '월요일' }], prefs.weekStart, (v) => set('weekStart', v)), 'prefWeekStart'),
    ]),
    field('메모', [
      row('글자 크기', segmented('prefMemoSize', [{ value: 'small', label: '작게' }, { value: 'medium', label: '보통' }, { value: 'large', label: '크게' }], prefs.memoSize, (v) => set('memoSize', v)), 'prefMemoSize'),
      row('완료한 줄 보이기', toggle(prefs.showDone, (on) => set('showDone', on))),
      row('완료한 줄을 아래로', toggle(prefs.doneToBottom, (on) => set('doneToBottom', on))),
      row('줄 머리 기호', segmented('prefBullet', [{ value: 'none', label: '없음' }, { value: 'number', label: '숫자' }, { value: 'dot', label: '점' }], prefs.bullet, (v) => set('bullet', v)), 'prefBullet'),
    ]),
  );
  return el;
}
