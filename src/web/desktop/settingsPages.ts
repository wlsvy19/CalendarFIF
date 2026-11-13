import { acceleratorFromKey } from '../../core/accelerator';
import { PALETTE } from '../../core/color';
import type { Layout } from '../../core/layout';
import type { CalfifDesktop, Hotkey, SettingsPage } from '../../desktop/api';
import type { Appearance, Bullet } from '../appearance';
import { accountSection, type AccountProps, type AccountSection } from '../ui/settings';
import { makeDraggable, sessionMemory } from './dragSheet';
import { playDoneTone } from './tone';

type Props = {
  appearance: Appearance;
  /** 바뀐 모양을 받는다. 이 기기에 저장하지 못했으면 false를 돌려준다(값은 화면에 그대로 둔다). */
  onAppearance(next: Appearance): boolean | void;
  bridge: CalfifDesktop | null;
  account: AccountProps;
  page?: SettingsPage;
  onClose(): void;
};

const PAGES: { id: SettingsPage; name: string }[] = [
  { id: 'calendar', name: '캘린더' },
  { id: 'cell', name: '셀' },
  { id: 'font', name: '글꼴 및 색상' },
  { id: 'advanced', name: '고급' },
  { id: 'account', name: '계정' },
];
const DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const SHORT_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const SAVE_FAILED = '이 기기에 저장하지 못했습니다. 지금 화면에만 적용됩니다.';
const BROWSER_ONLY = '바탕화면 앱에서만 바꿀 수 있습니다.';
const INVALID_HOTKEY = 'Ctrl 또는 Alt를 넣은 조합을 고르세요.';
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS']);
const HEX_ERROR = '16진수 6자리로 적어 주세요.';
// 설정 상자를 옮긴 자리는 앱이 켜져 있는 동안 기억한다.
const settingsMemory = sessionMemory();
const NONE_COLOR = new Set<keyof Appearance>(['calendarBg', 'restBg', 'todayBorder']);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

type Row = { root: HTMLElement; ctl: HTMLElement; help(text: string): void; error(text: string): void };

function makeRow(label: string): Row {
  const root = el('div', 'srow');
  const ctl = el('div', 'srow-ctl');
  const help = el('p', 'srow-help');
  const error = el('p', 'srow-error');
  error.setAttribute('role', 'alert');
  help.hidden = true;
  error.hidden = true;
  root.append(el('span', 'srow-label', label), ctl, help, error);
  const setText = (p: HTMLElement) => (text: string) => {
    p.textContent = text;
    p.hidden = text === '';
  };
  return { root, ctl, help: setText(help), error: setText(error) };
}

function switchInput(label: string, checked: boolean, onChange: (on: boolean) => void): HTMLInputElement {
  const input = el('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', label);
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function selectInput(label: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const select = el('select');
  select.setAttribute('aria-label', label);
  for (const [v, text] of options) {
    const option = el('option', undefined, text);
    option.value = v;
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

const numberOptions = (from: number, to: number, unit = ''): [string, string][] =>
  Array.from({ length: to - from + 1 }, (_, i) => [String(from + i), `${from + i}${unit}`]);

let radioGroups = 0;
function radioGroup(label: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLElement {
  const group = el('div', 'srow-choices');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  const name = `srow-radio-${radioGroups++}`;
  for (const [v, text] of options) {
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = v;
    input.checked = v === value;
    input.addEventListener('change', () => input.checked && onChange(v));
    const wrap = el('label', 'srow-choice');
    wrap.append(input, document.createTextNode(text));
    group.append(wrap);
  }
  return group;
}

function rangeInput(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, show: (v: number) => void): HTMLInputElement {
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    show(v);
    onInput(v);
  });
  return input;
}

export function mountDesktopSettings(
  root: HTMLElement,
  props: Props,
): { destroy(): void; showPage(page: SettingsPage): void; setManageUsers: AccountSection['setManageUsers'] } {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  let cur = props.appearance;
  let destroyed = false;

  const scrim = el('div', 'scrim');
  const sheet = el('div', 'sheet settings desk-settings');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'settingsTitle');
  sheet.tabIndex = -1;
  sheet.innerHTML = `
    <div class="sheet-bar">
      <span></span>
      <h3 id="settingsTitle">설정</h3>
      <button type="button" class="textbtn end">닫기</button>
    </div>`;
  const tablist = el('div', 'desk-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', '설정 쪽');
  const notice = el('p', 'settings-warn desk-notice');
  notice.setAttribute('role', 'status');
  notice.hidden = true;

  const set = <K extends keyof Appearance>(key: K, value: Appearance[K]): void => {
    cur = { ...cur, [key]: value };
    const stored = props.onAppearance(cur);
    notice.textContent = stored === false ? SAVE_FAILED : '';
    notice.hidden = stored !== false;
  };

  const rows: Record<SettingsPage, HTMLElement[]> = { calendar: [], cell: [], font: [], advanced: [], account: [] };
  const add = (page: SettingsPage, row: Row): Row => {
    rows[page].push(row.root);
    return row;
  };

  const toggleRow = (page: SettingsPage, label: string, key: 'monthGap' | 'weekNumbers' | 'shadow' | 'titleBar' | 'holidays' | 'lunar' | 'doneToBottom' | 'showDone' | 'showRestDays', help?: string): Row => {
    const row = add(page, makeRow(label));
    row.ctl.append(switchInput(label, cur[key], (on) => set(key, on)));
    if (help) row.help(help);
    return row;
  };

  // 캘린더 쪽
  const layoutRow = add('calendar', makeRow('배치'));
  const layoutOptions: [Layout, string][] = [['floating', '변동 월'], ['month', '전체 월'], ['week', '고정 단일 행'], ['days', '변동 단일 행']];
  const dependent: [Row, HTMLSelectElement][] = [];
  const syncDependents = (): void => {
    for (const [row, select] of dependent) {
      select.disabled = cur.layout !== 'floating';
      row.help(select.disabled ? '변동 월에서만 씁니다.' : '');
    }
  };
  layoutRow.ctl.append(radioGroup('배치', layoutOptions, cur.layout, (v) => {
    set('layout', v as Layout);
    syncDependents();
  }));
  const maxRows = add('calendar', makeRow('최대 행'));
  const maxSelect = selectInput('최대 행', numberOptions(2, 8), String(cur.maxRows), (v) => set('maxRows', Number(v)));
  maxRows.ctl.append(maxSelect);
  const pastWeeks = add('calendar', makeRow('지나간 주 표시'));
  const pastSelect = selectInput('지나간 주 표시', numberOptions(0, 3), String(cur.pastWeeks), (v) => set('pastWeeks', Number(v)));
  pastWeeks.ctl.append(pastSelect);
  dependent.push([maxRows, maxSelect], [pastWeeks, pastSelect]);
  syncDependents();
  toggleRow('calendar', '월 간격', 'monthGap');
  toggleRow('calendar', '주 번호', 'weekNumbers');
  toggleRow('calendar', '그림자', 'shadow');
  toggleRow('calendar', '제목 표시줄 표시', 'titleBar');
  toggleRow('calendar', '공휴일', 'holidays', '대한민국 공휴일 이름을 칸에 표시합니다.');
  toggleRow('calendar', '음력', 'lunar', '칸에 음력 날짜를 표시합니다.');

  // 셀 쪽
  add('cell', makeRow('줄 머리')).ctl.append(radioGroup('줄 머리', [['none', '없음'], ['number', '번호'], ['dot', '점']], cur.bullet, (v) => set('bullet', v as Bullet)));
  add('cell', makeRow('셀 간격')).ctl.append(selectInput('셀 간격', numberOptions(0, 12, 'px'), String(cur.cellGap), (v) => set('cellGap', Number(v))));
  const spacing = add('cell', makeRow('줄 간격'));
  const spacingValue = el('span', 'srow-value', cur.lineSpacing.toFixed(2));
  spacing.ctl.append(
    rangeInput('줄 간격', 1, 2, 0.05, cur.lineSpacing, (v) => set('lineSpacing', Math.round(v * 20) / 20), (v) => (spacingValue.textContent = v.toFixed(2))),
    spacingValue,
  );
  toggleRow('cell', '완료 작업 자동으로 맨 아래 줄로 이동', 'doneToBottom');
  toggleRow('cell', '완료된 작업 표시', 'showDone');
  add('cell', makeRow('편집 완료 알람')).ctl.append(selectInput('편집 완료 알람', [['none', '없음'], ['short', '짧은 소리']], cur.doneTone, (v) => {
    set('doneTone', v as Appearance['doneTone']);
    if (v === 'short') playDoneTone();
  }));

  // 글꼴 및 색상 쪽
  const hexCommits: (() => boolean)[] = [];
  const colorRow = (label: string, get: () => string, put: (hex: string) => void, withNone: boolean, extra?: HTMLElement): void => {
    const row = add('font', makeRow(label));
    const button = el('button', 'color-btn');
    button.type = 'button';
    button.setAttribute('aria-label', `${label} 색 고르기`);
    button.setAttribute('aria-expanded', 'false');
    const paint = (): void => {
      const hex = get();
      button.style.setProperty('--sw', hex === '' ? 'transparent' : `#${hex}`);
      button.classList.toggle('none', hex === '');
      for (const sw of picker.querySelectorAll<HTMLElement>('.swatch')) sw.setAttribute('aria-checked', String(sw.dataset.color === hex));
    };
    const picker = el('div', 'srow-picker');
    picker.hidden = true;
    const swatches = el('div', 'swatches');
    swatches.setAttribute('role', 'radiogroup');
    swatches.setAttribute('aria-label', label);
    for (const color of withNone ? ['', ...PALETTE] : PALETTE) {
      const sw = el('button', color === '' ? 'swatch none' : 'swatch');
      sw.type = 'button';
      sw.setAttribute('role', 'radio');
      sw.setAttribute('aria-label', color === '' ? '없음' : `#${color}`);
      sw.dataset.color = color;
      if (color !== '') sw.style.setProperty('--sw', `#${color}`);
      sw.addEventListener('click', () => {
        put(color);
        hex.value = '';
        row.error('');
        paint();
      });
      swatches.append(sw);
    }
    const hexLabel = el('label', 'srow-hex');
    const hex = el('input', 'hex');
    hex.type = 'text';
    hex.placeholder = 'RRGGBB';
    hex.maxLength = 8;
    hex.setAttribute('autocomplete', 'off');
    // 적은 값을 반영한다. 비어 있으면 할 일이 없고, 잘못되면 오류를 보이고 false를 돌려준다.
    const commitHex = (): boolean => {
      const value = hex.value.trim().replace(/^#/, '').toUpperCase();
      if (value === '') return true;
      if (!/^[0-9A-F]{6}$/.test(value)) {
        row.error(HEX_ERROR);
        return false;
      }
      row.error('');
      put(value);
      hex.value = '';
      paint();
      return true;
    };
    hexCommits.push(() => {
      if (commitHex()) return true;
      showPage('font'); // 닫기 전에 잘못 적은 칸을 보여 준다
      picker.hidden = false;
      hex.focus();
      return false;
    });
    hex.addEventListener('change', commitHex);
    hexLabel.append(el('span', 'srow-hex-label', '직접 입력'), hex);
    picker.append(swatches, hexLabel);
    button.addEventListener('click', () => {
      picker.hidden = !picker.hidden;
      button.setAttribute('aria-expanded', String(!picker.hidden));
    });
    row.ctl.append(button);
    if (extra) row.ctl.append(extra);
    row.root.append(picker);
    paint();
  };
  const fontRow = (label: string, key: 'calendarFont' | 'memoFont', min: number, max: number): void => {
    const size = selectInput(`${label} 크기`, numberOptions(min, max, 'px'), String(cur[key].size), (v) => set(key, { ...cur[key], size: Number(v) }));
    colorRow(label, () => cur[key].color, (color) => set(key, { ...cur[key], color }), false, size);
  };
  fontRow('캘린더 글꼴(날짜·요일) 색과 크기', 'calendarFont', 11, 20);
  fontRow('편집 내용의 글꼴 크기 및 색상', 'memoFont', 11, 22);
  const plainColor = (label: string, key: 'calendarBg' | 'restBg' | 'todayBorder' | 'titleButton' | 'holidayInk' | 'lunarInk'): void =>
    colorRow(label, () => cur[key], (hex) => set(key, hex), NONE_COLOR.has(key));
  plainColor('캘린더 배경', 'calendarBg');
  plainColor('휴일 배경색', 'restBg');
  plainColor('오늘의 테두리', 'todayBorder');
  plainColor('제목 표시줄 버튼 색상', 'titleButton');
  plainColor('휴일 텍스트 색상', 'holidayInk');
  plainColor('음력 텍스트 색상', 'lunarInk');
  const transparency = add('font', makeRow('투명도'));
  const transparencyValue = el('span', 'srow-value', `${cur.transparency}%`);
  transparency.ctl.append(
    el('span', 'srow-end', '단색'),
    rangeInput('투명도', 0, 100, 5, cur.transparency, (v) => set('transparency', v), (v) => (transparencyValue.textContent = `${v}%`)),
    el('span', 'srow-end', '완전 투명'),
    transparencyValue,
  );

  // 고급 쪽
  add('advanced', makeRow('시작 요일')).ctl.append(selectInput('시작 요일', DAYS.map((d, i) => [String(i), d]), String(cur.weekStart), (v) => set('weekStart', Number(v))));
  add('advanced', makeRow('첫번째 주')).ctl.append(selectInput('첫번째 주', [['jan1', '1월 1일이 든 주'], ['iso', 'ISO 방식']], cur.firstWeek, (v) => set('firstWeek', v as Appearance['firstWeek'])));
  toggleRow('advanced', '쉬는날 표시', 'showRestDays');
  const rest = add('advanced', makeRow('쉬는날'));
  const restGroup = el('div', 'srow-choices');
  SHORT_DAYS.forEach((name, day) => {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = cur.restDays.includes(day);
    box.addEventListener('change', () => {
      const days = new Set(cur.restDays);
      if (box.checked) days.add(day);
      else days.delete(day);
      set('restDays', [...days].sort((a, b) => a - b));
    });
    const wrap = el('label', 'srow-choice');
    wrap.append(box, document.createTextNode(name));
    restGroup.append(wrap);
  });
  rest.ctl.append(restGroup);

  // 시스템 설정(메인 프로세스가 저장한다). 요청은 한 줄로 세워 보내 응답이 뒤바뀌지 않게 한다.
  const bridge = props.bridge;
  let queue: Promise<void> = Promise.resolve();
  const hotkeyRow = (page: SettingsPage, label: string, field: 'hideHotkey' | 'contentHotkey', stateKey: 'hide' | 'content') => {
    const row = add(page, makeRow(label));
    const input = el('input', 'hotkey');
    input.type = 'text';
    input.readOnly = true;
    input.placeholder = '새 단축키를 누르세요';
    input.setAttribute('aria-label', label);
    const toggle = switchInput(`${label} 켜기`, false, () => send());
    row.ctl.append(input, toggle);
    // 응답이 오면 칸과 스위치는 늘 돌려받은 값으로 맞춘다. 요청이 던지면 마지막으로 받은 값으로 되돌린다.
    let good: Hotkey = { accelerator: '', enabled: false };
    let latest = 0;
    const show = (h: Hotkey): void => {
      input.value = h.accelerator;
      toggle.checked = h.enabled;
    };
    const load = (h: Hotkey): void => {
      good = h;
      show(h);
      input.disabled = false;
      toggle.disabled = false;
    };
    const send = (): void => {
      if (!bridge) return;
      const requested = { accelerator: input.value, enabled: toggle.checked };
      const mine = ++latest;
      queue = queue.then(async () => {
        try {
          const next = await bridge.setSystem({ [field]: requested });
          if (destroyed) return;
          good = next.settings[field];
          if (mine !== latest) return; // 더 새 요청이 있으면 그 응답으로 맞춘다
          show(good);
          const state = next.hotkeys[stateKey];
          row.error(
            state === 'taken' ? '다른 프로그램이 이 단축키를 쓰고 있습니다. 다른 조합을 고르세요.'
              : state === 'invalid' || good.accelerator !== requested.accelerator ? INVALID_HOTKEY
                : good.enabled !== requested.enabled ? '적용하지 못했습니다.' : '',
          );
        } catch {
          if (destroyed || mine !== latest) return;
          show(good);
          row.error('적용하지 못했습니다.');
        }
      });
    };
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.stopPropagation(); // 받기만 그만둔다. 설정 화면은 닫지 않는다.
        e.preventDefault();
        sheet.focus();
        return;
      }
      if (MODIFIER_KEYS.has(e.key) || e.key === 'Tab') return; // 수식키만 누른 것과 이동 키는 그대로 둔다
      e.preventDefault();
      const accelerator = acceleratorFromKey(e);
      if (accelerator === null) {
        row.error(INVALID_HOTKEY); // 받을 수 없는 조합(Ctrl이나 Alt가 없음, Alt+F4, Windows 키 등)
        return;
      }
      input.value = accelerator;
      send();
    });
    if (!bridge) {
      input.disabled = true;
      toggle.disabled = true;
      row.help(BROWSER_ONLY);
    }
    return { row, input, toggle, load };
  };
  const hide = hotkeyRow('advanced', '캘린더 숨기기 단축키', 'hideHotkey', 'hide');
  const content = hotkeyRow('advanced', '내용 표시 및 숨기기 단축키', 'contentHotkey', 'content');
  const startRow = add('advanced', makeRow('Windows 시작 시 실행'));
  const start = switchInput('Windows 시작 시 실행', false, (on) => {
    if (!bridge) return;
    queue = queue.then(async () => {
      try {
        const next = await bridge.setSystem({ startWithWindows: on });
        if (destroyed) return;
        const applied = next.settings.startWithWindows === true;
        start.checked = applied;
        startRow.error(applied === on ? '' : '적용하지 못했습니다.');
      } catch {
        if (destroyed) return;
        start.checked = !on;
        startRow.error('적용하지 못했습니다.');
      }
    });
  });
  start.disabled = true;
  startRow.ctl.append(start);
  if (!bridge) startRow.help(BROWSER_ONLY);
  else {
    void bridge.getSystem().then(
      (state) => {
        if (destroyed) return;
        for (const [h, saved] of [[hide, state.settings.hideHotkey], [content, state.settings.contentHotkey]] as const) {
          h.load(saved);
        }
        start.checked = state.canStartWithWindows && state.settings.startWithWindows === true;
        start.disabled = !state.canStartWithWindows;
        startRow.help(state.canStartWithWindows ? '' : '개발 실행에서는 바꿀 수 없습니다. 꾸린 앱에서 바꿉니다.');
      },
      () => {
        if (!destroyed) startRow.error('시스템 설정을 읽지 못했습니다.');
      },
    );
    for (const h of [hide, content]) {
      h.input.disabled = true;
      h.toggle.disabled = true;
    }
  }

  // 쪽과 탭
  const account = accountSection(props.account);
  const panels = new Map<SettingsPage, HTMLElement>();
  const tabs = new Map<SettingsPage, HTMLButtonElement>();
  for (const { id, name } of PAGES) {
    const tabButton = el('button', 'desk-tab', name);
    tabButton.type = 'button';
    tabButton.id = `settings-tab-${id}`;
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-controls', `settings-panel-${id}`);
    tabButton.addEventListener('click', () => showPage(id));
    tabs.set(id, tabButton);
    const panel = el('div', 'desk-panel');
    panel.id = `settings-panel-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabButton.id);
    if (id === 'account') panel.append(account.el);
    else panel.append(...rows[id]);
    panels.set(id, panel);
  }
  let shown: SettingsPage = props.page ?? 'calendar';
  function showPage(page: SettingsPage): void {
    shown = page;
    for (const { id } of PAGES) {
      const on = id === page;
      const tabButton = tabs.get(id)!;
      tabButton.setAttribute('aria-selected', String(on));
      tabButton.tabIndex = on ? 0 : -1;
      panels.get(id)!.hidden = !on;
    }
  }
  tablist.append(...tabs.values());
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const at = PAGES.findIndex((p) => p.id === shown);
    const next = PAGES[(at + (e.key === 'ArrowRight' ? 1 : PAGES.length - 1)) % PAGES.length].id;
    e.preventDefault();
    showPage(next);
    tabs.get(next)!.focus();
  });
  showPage(shown);
  sheet.append(tablist, notice, ...panels.values());

  const closeBtn = sheet.querySelector<HTMLButtonElement>('.textbtn.end')!;
  // 적고 아직 반영하지 않은 16진수 값은 닫기 전에 반영한다. 잘못된 값이 있으면 닫지 않고 오류를 보인다.
  const requestClose = (): void => {
    if (hexCommits.map((commit) => commit()).every(Boolean)) props.onClose();
  };
  closeBtn.addEventListener('click', requestClose);
  scrim.addEventListener('click', requestClose);
  sheet.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops = [...sheet.querySelectorAll<HTMLElement>('button, input, select')].filter(
      (x) => !(x as HTMLButtonElement).disabled && !x.closest('[hidden]') && x.tabIndex >= 0,
    );
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  root.append(scrim, sheet);
  document.documentElement.classList.add('sheet-open');
  sheet.focus();
  const drag = makeDraggable(sheet, sheet.querySelector<HTMLElement>('.sheet-bar')!, settingsMemory);

  return {
    showPage,
    setManageUsers: account.setManageUsers,
    destroy() {
      destroyed = true;
      drag.destroy();
      document.documentElement.classList.remove('sheet-open');
      scrim.remove();
      sheet.remove();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    },
  };
}
