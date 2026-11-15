import { todayKey } from '../../core/dates';
import {
  ADVANCE_DAYS,
  ADVANCE_LABELS,
  COUNTDOWN_KIND_LABELS,
  newEventId,
  REPEAT_LABELS,
  type CountdownKind,
  type EventRecord,
  type RepeatFreq,
  type RepeatRule,
} from '../../core/events';
import { dismiss } from './sheetMotion';

// 알림과 카운트다운을 만들고 고치는 시트. 편집 화면 위에 뜨고, 저장과 삭제는 메모의 저장·취소와 따로 바로 끝난다.

export const SCRIPTABLE_SCHEDULE_URL = 'scriptable:///run/CalendarFIF?schedule=1';

export type EventSheetProps = {
  type: 'alarm' | 'countdown';
  dateKey: string;
  /** 있으면 고치기. */
  id?: string;
  record?: EventRecord;
  /** 메모의 첫 줄([+] 뗀 것), 없으면 ''. */
  defaultText: string;
  now: () => Date;
  /** 아이폰이면 Scriptable 안내와 '지금 예약' 단추. */
  iosHint: boolean;
  /** editedAt/editedBy는 받는 쪽이 채운다(0, ''로 넘긴다). */
  onSave(id: string, rec: EventRecord): void;
  onDelete(id: string): void;
  onClose(): void;
  /** 저장한 것을 서버가 받을 때까지 기다린다(지금 예약). 받지 못하면 거절한다. 없으면 기다리지 않는다. */
  flush?(): Promise<void>;
};

type EndMode = 'forever' | 'until' | 'count';

const pad2 = (n: number): string => String(n).padStart(2, '0');
const ALARM_REPEATS: RepeatFreq[] = ['none', 'daily', 'workday', 'weekly', 'monthly', 'yearly', 'lunarYearly'];
const COUNTDOWN_REPEATS: RepeatFreq[] = ['none', 'yearly', 'lunarYearly'];
const KINDS = Object.keys(COUNTDOWN_KIND_LABELS) as CountdownKind[];
const YEARLY_KINDS: CountdownKind[] = ['birthday', 'anniversary', 'holiday'];
const MAX_ADVANCE = 5;
/** 지금 예약: 서버가 받기를 이만큼 기다린다. */
const SCHEDULE_WAIT_MS = 4000;
/** 삭제를 한 번 누른 뒤 이만큼 안에 다시 누르면 지운다. */
const DELETE_CONFIRM_MS = 4000;

/**
 * 새 알림의 기본 시각. 그날이 오늘이면 지금+15분을 15분 단위로 내린 시각(23:59가 끝)이고, 그것이 지금보다 늦지 않으면
 * (밤 23:59) 09:00이다. 다른 날이면 09:00.
 */
function defaultTime(dateKey: string, now: Date): string {
  if (dateKey !== todayKey(now)) return '09:00';
  const current = now.getHours() * 60 + now.getMinutes();
  const minutes = Math.min(23 * 60 + 59, Math.floor((current + 15) / 15) * 15);
  if (minutes <= current) return '09:00';
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** 약속이 ms 안에 끝나면 true, 거절되거나 늦으면 false. */
function settlesWithin(work: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    work.then(
      () => { clearTimeout(timer); resolve(true); },
      () => { clearTimeout(timer); resolve(false); },
    );
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function labelled(label: string, control: HTMLElement, className = 'ev-row'): HTMLElement {
  const row = el('label', className);
  row.append(el('span', 'ev-name', label), control);
  return row;
}

function selectOf(className: string, options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const s = el('select', `ev-input ${className}`);
  for (const o of options) {
    const opt = el('option', '', o.label);
    opt.value = o.value;
    s.append(opt);
  }
  s.value = value;
  return s;
}

function switchOf(className: string, checked: boolean): HTMLInputElement {
  const input = el('input', `switch ${className}`);
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  return input;
}

/** window.visualViewport 가운데 쓰는 부분(편집 화면과 같다). */
export type VisualViewportLike = {
  height: number;
  offsetTop: number;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
};

export function mountEventSheet(root: HTMLElement, props: EventSheetProps, env?: { visualViewport?: VisualViewportLike | null }): { destroy(): void } {
  const viewport = env?.visualViewport === undefined ? (window.visualViewport ?? null) : env.visualViewport;
  const isAlarm = props.type === 'alarm';
  const rec = props.record;
  const id = props.id ?? newEventId();
  let editing = props.id !== undefined; // 지금 예약으로 저장하면 그 뒤로는 있는 항목이다
  const baseDate = rec?.date ?? props.dateKey; // 반복 항목의 기준 날짜는 고쳐도 그대로다
  const alarm = rec?.type === 'alarm' ? rec : null;
  const countdown = rec?.type === 'countdown' ? rec : null;

  const scrim = el('div', 'scrim event-scrim');
  const sheet = el('div', 'sheet event-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'eventSheetTitle');
  sheet.tabIndex = -1;

  const bar = el('div', 'sheet-bar');
  const cancelBtn = el('button', 'textbtn start', '취소');
  cancelBtn.type = 'button';
  const title = el('div', 'sheet-title');
  const h3 = el('h3', '', isAlarm ? (editing ? '알림 편집' : '새 알림') : (editing ? '카운트다운 편집' : '새 카운트다운'));
  h3.id = 'eventSheetTitle';
  title.append(h3);
  const saveBtn = el('button', 'textbtn end', '저장');
  saveBtn.type = 'button';
  bar.append(cancelBtn, title, saveBtn);

  const body = el('div', 'ev-body');

  // 글
  const text = el('input', 'ev-input ev-text');
  text.type = 'text';
  text.maxLength = 200;
  text.placeholder = props.defaultText || (isAlarm ? '무엇을 알릴까요' : '무엇까지 셀까요');
  text.setAttribute('enterkeyhint', 'done');
  text.value = rec?.text ?? '';
  body.append(labelled('글', text));

  // 알림: 시각과 미리 알림
  let time: HTMLInputElement | null = null;
  const advance = new Set<number>(alarm ? alarm.advance : [0]);
  const advanceBoxes: HTMLButtonElement[] = [];
  if (isAlarm) {
    time = el('input', 'ev-input');
    time.type = 'time';
    time.value = alarm?.time ?? defaultTime(props.dateKey, props.now());
    body.append(labelled('시각', time));
    const group = el('div', 'ev-advance advance');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '미리 알림');
    for (const days of ADVANCE_DAYS) {
      const b = el('button', 'ev-check', ADVANCE_LABELS[days]);
      b.type = 'button';
      b.setAttribute('role', 'checkbox');
      b.dataset.days = String(days);
      b.addEventListener('click', () => {
        if (advance.has(days)) advance.delete(days);
        else if (advance.size < MAX_ADVANCE) advance.add(days);
        paintAdvance();
      });
      advanceBoxes.push(b);
      group.append(b);
    }
    const paintAdvance = (): void => {
      for (const b of advanceBoxes) b.setAttribute('aria-checked', String(advance.has(Number(b.dataset.days))));
    };
    paintAdvance();
    const row = el('div', 'ev-row stack');
    row.append(el('span', 'ev-name', '미리 알림'), group);
    body.append(row);
  }

  // 카운트다운: 유형
  let kind: HTMLSelectElement | null = null;
  const repeatOptions = (isAlarm ? ALARM_REPEATS : COUNTDOWN_REPEATS).map((f) => ({ value: f, label: REPEAT_LABELS[f] }));
  let repeatTouched = editing;
  if (!isAlarm) {
    kind = selectOf('ev-kind', KINDS.map((k) => ({ value: k, label: COUNTDOWN_KIND_LABELS[k] })), countdown?.kind ?? 'basic');
    body.append(labelled('유형', kind));
  }

  // 반복
  const initialFreq: RepeatFreq = rec?.repeat.freq ?? (!isAlarm && kind && YEARLY_KINDS.includes(kind.value as CountdownKind) ? 'yearly' : 'none');
  const repeat = selectOf('ev-repeat', repeatOptions, initialFreq);
  body.append(labelled('반복', repeat));
  repeat.addEventListener('change', () => {
    repeatTouched = true;
    paintEnd();
  });
  kind?.addEventListener('change', () => {
    if (repeatTouched) return;
    repeat.value = YEARLY_KINDS.includes(kind!.value as CountdownKind) ? 'yearly' : 'none';
    paintEnd();
  });

  // 끝
  let endMode: EndMode = rec?.repeat.until ? 'until' : rec?.repeat.count ? 'count' : 'forever';
  const endRow = el('div', 'ev-row stack ev-end');
  const endModes: { value: EndMode; label: string }[] = [
    { value: 'forever', label: '계속' },
    { value: 'until', label: '날짜까지' },
    { value: 'count', label: '횟수' },
  ];
  const endGroup = el('div', 'segmented');
  endGroup.setAttribute('role', 'radiogroup');
  endGroup.setAttribute('aria-label', '끝');
  const endButtons = endModes.map((m) => {
    const b = el('button', '', m.label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      endMode = m.value;
      paintEnd();
    });
    endGroup.append(b);
    return b;
  });
  const until = el('input', 'ev-input ev-until');
  until.type = 'date';
  until.min = baseDate;
  until.value = rec?.repeat.until ?? '';
  until.setAttribute('aria-label', '끝 날짜');
  const count = el('input', 'ev-input ev-count');
  count.type = 'number';
  count.inputMode = 'numeric';
  count.min = '1';
  count.max = '99999';
  count.value = rec?.repeat.count ? String(rec.repeat.count) : '';
  count.placeholder = '횟수';
  count.setAttribute('aria-label', '횟수');
  endRow.append(el('span', 'ev-name', '끝'), endGroup, until, count);
  body.append(endRow);
  const paintEnd = (): void => {
    endRow.hidden = repeat.value === 'none';
    endButtons.forEach((b, i) => {
      const on = endModes[i].value === endMode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    until.hidden = endMode !== 'until';
    count.hidden = endMode !== 'count';
  };
  paintEnd();

  // 달력 아래에 표시(카운트다운)
  let bottom: HTMLInputElement | null = null;
  if (!isAlarm) {
    bottom = switchOf('ev-bottom', countdown?.showBottom ?? true);
    body.append(labelled('달력 아래에 표시', bottom, 'ev-row ev-switch'));
  }

  // 완료
  const done = switchOf('ev-done', rec?.done ?? false);
  body.append(labelled('완료', done, 'ev-row ev-switch'));

  const error = el('p', 'ev-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  body.append(error);

  let hintText: HTMLElement | null = null;
  let scheduleBtn: HTMLButtonElement | null = null;
  if (isAlarm && props.iosHint) {
    hintText = el('span', 'ev-hint-text', '아이폰 알림은 Scriptable 위젯 스크립트가 예약합니다. 위젯이 새로 그려질 때 예약되고, 바로 하려면 누르세요. ');
    scheduleBtn = el('button', 'ev-link ev-schedule', '지금 예약');
    scheduleBtn.type = 'button';
    const now = scheduleBtn;
    now.addEventListener('click', () => void scheduleNow(now));
    const hint = el('p', 'ev-hint');
    hint.append(hintText, now);
    body.append(hint);
  }

  const actions = el('div', 'ev-actions');
  let disarmDelete = (): void => {};
  let showDelete = (): void => {};
  {
    const del = el('button', 'settings-btn danger ev-delete', '삭제');
    del.type = 'button';
    showDelete = () => { if (!del.isConnected) actions.append(del); };
    // 반복하는 항목은 통째로 지워지므로 두 번 눌러야 지운다. 4초가 지나거나 다른 것을 하면 처음으로 돌아간다.
    let armed: ReturnType<typeof setTimeout> | null = null;
    disarmDelete = (): void => {
      if (armed === null) return;
      clearTimeout(armed);
      armed = null;
      del.textContent = '삭제';
      del.classList.remove('armed');
    };
    del.addEventListener('click', () => {
      if (armed === null) {
        armed = setTimeout(disarmDelete, DELETE_CONFIRM_MS);
        del.textContent = '한 번 더 누르면 삭제';
        del.classList.add('armed');
        return;
      }
      disarmDelete();
      props.onDelete(id);
      close();
    });
    const other = (e: Event): void => {
      if (!(e.target instanceof Node && del.contains(e.target))) disarmDelete();
    };
    for (const type of ['pointerdown', 'keydown', 'input', 'change']) sheet.addEventListener(type, other, true);
    scrim.addEventListener('pointerdown', () => disarmDelete());
    if (editing) actions.append(del);
  }
  body.append(actions);

  sheet.append(bar, body);

  const snapshot = (): string =>
    JSON.stringify([text.value, time?.value, [...advance].sort(), kind?.value, repeat.value, endMode, until.value, count.value, bottom?.checked, done.checked]);
  const initial = snapshot();

  const fail = (message: string): null => {
    error.textContent = message;
    error.hidden = false;
    return null;
  };

  /** 화면의 값으로 기록을 만든다. 틀린 곳이 있으면 알리고 null. editedAt/editedBy는 받는 쪽이 채운다(0, ''). */
  const build = (): EventRecord | null => {
    let t = text.value.trim();
    if (t === '') t = props.defaultText.trim().slice(0, 200);
    if (t === '') return fail('글을 적어 주세요');
    const freq = repeat.value as RepeatFreq;
    // 저장된 항목에 until과 count가 함께 있어도 화면의 끝은 하나뿐이라 고른 하나만 저장한다.
    const rule: RepeatRule = { freq };
    if (freq !== 'none') {
      if (endMode === 'until') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(until.value)) return fail('끝 날짜를 고르세요');
        if (until.value < baseDate) return fail('끝 날짜는 그날 이후여야 합니다');
        rule.until = until.value;
      } else if (endMode === 'count') {
        const n = Number(count.value);
        if (!Number.isInteger(n) || n < 1 || n > 99999) return fail('횟수는 1부터 99999 사이의 정수입니다');
        rule.count = n;
      }
    }
    if (isAlarm) {
      if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value)) return fail('시각을 고르세요');
      if (advance.size < 1) return fail('미리 알림을 하나 이상 고르세요');
      return {
        type: 'alarm', date: baseDate, text: t, done: done.checked, repeat: rule,
        time: time.value, advance: [...advance].sort((a, b) => a - b), editedAt: 0, editedBy: '',
      };
    }
    return {
      type: 'countdown', date: baseDate, text: t, done: done.checked, repeat: rule,
      kind: kind!.value as CountdownKind, showBottom: bottom!.checked, editedAt: 0, editedBy: '',
    };
  };

  const save = (): void => {
    const rec = build();
    if (!rec) return;
    props.onSave(id, rec);
    close();
  };

  // 지금 예약은 두 번 누른다. 첫 번째는 저장하고 서버가 받은 것을 확인한다(Scriptable은 서버의 문서를 읽어 예약한다).
  // 확인되면 단추가 진짜 링크로 바뀐다. iOS는 서버를 기다린 뒤의 주소 이동을 사용자의 누르기로 보지 않아 막을 수 있어서, 링크를
  // 눌러야 연다. 받지 못하면(연결 없음, 4초 넘게 걸림) 시트를 두고 다시 누르게 한다. 저장한 알림은 이 기기에 남아 연결되면 올라간다.
  const markSaved = (): void => {
    editing = true;
    h3.textContent = isAlarm ? '알림 편집' : '카운트다운 편집';
    showDelete();
  };
  let scheduling = false;
  const scheduleNow = async (button: HTMLButtonElement): Promise<void> => {
    if (scheduling) return;
    const rec = build();
    if (!rec) return;
    props.onSave(id, rec);
    markSaved();
    scheduling = true;
    error.hidden = true;
    button.disabled = true;
    button.textContent = '보내는 중…';
    const flush = props.flush;
    const ok = flush ? await settlesWithin(Promise.resolve().then(() => flush()), SCHEDULE_WAIT_MS) : true;
    scheduling = false;
    if (destroyed) return; // 기다리는 동안 닫혔다
    button.disabled = false;
    button.textContent = '지금 예약';
    if (!ok) {
      fail('저장했습니다. 연결된 뒤에 다시 누르세요');
      return;
    }
    // 진짜 링크: 기본 이동은 그대로 두고, 이동이 시작된 뒤 다음 틱에 시트를 닫는다.
    const link = el('a', 'ev-link ev-schedule', 'Scriptable 열기');
    link.href = SCRIPTABLE_SCHEDULE_URL;
    link.addEventListener('click', () => { setTimeout(close, 0); });
    button.replaceWith(link);
    if (hintText) hintText.textContent = '저장했습니다. 눌러서 바로 예약하세요. ';
  };
  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', () => close());
  // 바깥을 눌러 닫는 것은 고친 것이 없을 때만이다(편집 화면과 같다).
  scrim.addEventListener('click', () => {
    if (snapshot() === initial) close();
  });
  // 이 시트의 키는 아래 편집 화면으로 새지 않는다(Esc가 편집 화면까지 취소하지 않게).
  sheet.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') {
      e.preventDefault();
      save();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops = [...sheet.querySelectorAll<HTMLElement>('button, input, select, a[href]')].filter(
      (x) => x.tabIndex >= 0 && !(x as HTMLInputElement).disabled && !x.closest('[hidden]') && !x.hidden,
    );
    if (stops.length === 0) return;
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

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    disarmDelete();
    viewport?.removeEventListener('resize', followViewport);
    viewport?.removeEventListener('scroll', followViewport);
    dismiss(scrim, sheet);
  };
  const close = (): void => {
    if (destroyed) return;
    destroy();
    props.onClose();
  };

  // 아이폰 Safari는 글자판이 열려도 화면 단위가 바뀌지 않는다. 보이는 영역을 CSS 변수로 넘겨 시트가 글자판 위에 앉게 한다.
  const followViewport = (): void => {
    if (!viewport) return;
    sheet.style.setProperty('--vv-height', `${viewport.height}px`);
    sheet.style.setProperty('--vv-top', `${viewport.offsetTop}px`);
    sheet.style.setProperty('--vv-bottom', `${Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)}px`);
  };
  followViewport();
  viewport?.addEventListener('resize', followViewport);
  viewport?.addEventListener('scroll', followViewport);

  root.append(scrim, sheet);
  // 시트 자신에 초점을 둔다. 뒤의 메모 칸에 초점이 남아 Tab이 시트 밖으로 새지 않게 하고, 글자판이 저절로 뜨지 않게 한다.
  sheet.focus({ preventScroll: true });

  return { destroy };
}
