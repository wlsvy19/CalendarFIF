import { PALETTE } from '../../core/color';
import { todayKey } from '../../core/dates';
import { countdownLabel, countdownStatus, eventsByDate, newEventId, type EventRecord } from '../../core/events';
import { normalizeText, toggleDoneInRange } from '../../core/text';
import type { DayValue } from '../../core/types';
import type { EventsView } from '../eventsStore';
import { playTone } from '../tones';
import { mountEventSheet } from './eventSheet';
import { mountPalette } from './palette';
import { dismiss } from './sheetMotion';
import { attachSwipeToClose } from './sheetSwipe';

const SVG = (body: string): string =>
  `<svg class="tool-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  done: SVG('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>'),
  color: SVG('<path d="M12 3c4.5 5 6.5 8 6.5 11a6.5 6.5 0 0 1-13 0C5.5 11 7.5 8 12 3z"/>'),
  alarm: SVG('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>'),
  countdown: SVG('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2.5h6"/>'),
};

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const WIDE_PX = 880;
/** 폰에서 메모 칸이 초점을 놓은 뒤(글자판의 완료) 저장하고 닫기까지 기다리는 시간. 그 사이 눌린 취소·저장이 먼저다. */
export const KEYBOARD_DONE_MS = 100;
/** 날짜를 누를 때 글자판을 미리 띄우는 숨은 입력 칸의 class(main.ts의 raiseKeyboard). */
export const KEYBOARD_PROXY_CLASS = 'kbd-proxy';

function titleOf(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setFullYear(year);
  return `${month}월 ${day}일 ${WEEKDAY_NAMES[date.getDay()]}요일`;
}

export type EditorHandle = {
  destroy(): void;
  /** 아래로 끌어 닫기와 같이 닫는다: 고친 것이 있으면 저장(onSave)하고 없으면 취소(onCancel)한다. */
  close(): void;
  /** 편집 화면 위에 알림·카운트다운 시트가 열려 있는가(그 시트에 적던 것이 있을 수 있다). */
  eventSheetOpen(): boolean;
};

/** The part of window.visualViewport the editor uses. */
export type VisualViewportLike = {
  height: number;
  offsetTop: number;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
};

export function mountEditor(
  root: HTMLElement,
  props: {
    dateKey: string;
    value: DayValue;
    /** 제목 아래에 적을 그날의 음력과 공휴일 이름. 빈 글은 적지 않는다. */
    note?: { lunar: string; holiday: string; season?: string };
    /** 완료를 누를 때 소리. */
    doneTone?: 'none' | 'short';
    /**
     * 알림과 카운트다운. 없으면 그 도구 단추와 띠를 숨긴다. 시트의 저장과 삭제는 메모의 저장·취소와 따로 바로 끝난다.
     * flush: 저장한 것을 서버가 받을 때까지 기다린다(아이폰의 지금 예약). 받지 못하면 거절한다.
     */
    events?: { view: EventsView; save(id: string, rec: EventRecord): void; remove(id: string): void; flush?(): Promise<void>; iosHint: boolean | 'push'; now?: () => Date };
    onSave(next: DayValue): void;
    onCancel(): void;
    /**
     * 편집 화면을 그대로 둔 채 지금 값을 저장한다. 화면이 가려질 때(앱을 나갈 때) 고친 것이 있으면 부른다:
     * 편집 화면을 닫지 않고 앱을 나가면 고친 것이 저장되지 않고, 위젯에서 연 화면은 다시 열 때 사라진다.
     * 그 뒤에 취소하면 처음 값을 이것으로 다시 넘겨 되돌린다. 없으면 가려져도 저장하지 않는다.
     */
    onKeep?(next: DayValue): void;
  },
  env?: { visualViewport?: VisualViewportLike | null; focusText?: boolean; attachDrag?: (sheet: HTMLElement, handle: HTMLElement) => { destroy(): void } },
): EditorHandle {
  const viewport = env?.visualViewport === undefined ? (window.visualViewport ?? null) : env.visualViewport;
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'sheetTitle');
  sheet.tabIndex = -1;
  sheet.innerHTML = `
    <div class="sheet-bar">
      <button type="button" class="textbtn start">취소</button>
      <div class="sheet-title">
        <h3 id="sheetTitle"></h3>
        <p class="sheet-note" hidden></p>
      </div>
      <button type="button" class="textbtn end">저장</button>
    </div>
    <div class="ev-strip" hidden></div>
    <div class="field grow">
      <textarea class="memo-input" id="memoInput" aria-label="메모" placeholder="한 줄에 하나씩 적으세요"></textarea>
    </div>
    <div class="editor-tools" role="toolbar" aria-label="편집 도구">
      <button type="button" class="tool done">${ICONS.done}<span>완료</span></button>
      <button type="button" class="tool color">${ICONS.color}<span>배경</span><span class="dot" aria-hidden="true"></span></button>
      <button type="button" class="tool alarm" hidden>${ICONS.alarm}<span>알림</span></button>
      <button type="button" class="tool countdown" hidden>${ICONS.countdown}<span>카운트다운</span></button>
    </div>`;
  sheet.querySelector('h3')!.textContent = titleOf(props.dateKey);
  const noteEl = sheet.querySelector<HTMLElement>('.sheet-note')!;
  for (const [className, text] of [['note-lunar', props.note?.lunar ?? ''], ['note-season', props.note?.season ?? ''], ['note-holiday', props.note?.holiday ?? '']]) {
    if (text === '') continue;
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    noteEl.append(span);
    noteEl.hidden = false;
  }
  const area = sheet.querySelector<HTMLTextAreaElement>('textarea')!;
  const cancelBtn = sheet.querySelector<HTMLButtonElement>('.textbtn.start')!;
  const saveBtn = sheet.querySelector<HTMLButtonElement>('.textbtn.end')!;
  const doneBtn = sheet.querySelector<HTMLButtonElement>('.tool.done')!;
  const colorBtn = sheet.querySelector<HTMLButtonElement>('.tool.color')!;
  const alarmBtn = sheet.querySelector<HTMLButtonElement>('.tool.alarm')!;
  const countdownBtn = sheet.querySelector<HTMLButtonElement>('.tool.countdown')!;
  const dot = colorBtn.querySelector<HTMLElement>('.dot')!;
  area.value = props.value.text;

  let color = props.value.color;
  // 고른 색을 메모 칸 바탕(칸과 같은 --day-color 섞기)과 배경 단추의 점에 칠한다.
  const paintColor = (): void => {
    if (color === '') {
      delete area.dataset.color;
      area.style.removeProperty('--day-color');
      dot.style.removeProperty('--sw');
      dot.classList.add('none');
    } else {
      area.dataset.color = color;
      area.style.setProperty('--day-color', `#${color}`);
      dot.style.setProperty('--sw', `#${color}`);
      dot.classList.remove('none');
    }
  };
  paintColor();
  const events = props.events;
  alarmBtn.hidden = !events;
  countdownBtn.hidden = !events;
  const strip = sheet.querySelector<HTMLElement>('.ev-strip')!;
  const nowOf = (): Date => events?.now?.() ?? new Date();
  let eventSheet: { destroy(): void } | null = null;
  let eventSaved = false; // 열려 있는 알림 시트에서 저장을 했다
  const openEventSheet = (type: 'alarm' | 'countdown', id?: string): void => {
    if (!events || eventSheet) return;
    eventSheet = mountEventSheet(root, {
      type,
      dateKey: props.dateKey,
      id,
      record: id ? events.view.items()[id] : undefined,
      // 메모의 첫 줄을 미리 넣지 않는다(2026-11-15: 사용자가 지우라고 했다). 글은 직접 적는다.
      defaultText: '',
      now: nowOf,
      iosHint: events.iosHint,
      onSave: (eid, rec) => {
        events.save(eid, rec);
        eventSaved = true;
      },
      onDelete: (eid) => {
        events.remove(eid);
        eventSaved = false; // 저장한 뒤 지웠으면(지금 예약 뒤의 삭제) 남은 것이 없으므로 편집 화면에 남는다
      },
      flush: events.flush ? () => events.flush!() : undefined,
      onClose: () => {
        eventSheet = null;
        // 알림이나 카운트다운을 저장했으면 편집 화면으로 돌아오지 않고 달력으로 나간다(2026-11-16 사용자: "알람도 하나의 메모니까,
        // 메모 안 뜨고 캘린더 보이는 곳으로 나가게"). 적던 메모가 있으면 같이 저장한다(아래로 끌어 닫을 때와 같다).
        // 취소하거나 지웠을 때는 전처럼 편집 화면에 남는다.
        if (eventSaved) {
          eventSaved = false;
          if (changed()) save();
          else cancel();
          return;
        }
        // 폰에서는 열 때와 같이 시트에 초점을 둔다. 메모 칸에 두면 닫을 때마다 글자판이 올라온다.
        if (env?.focusText || window.innerWidth >= WIDE_PX) area.focus({ preventScroll: true });
        else sheet.focus({ preventScroll: true });
      },
    }, { visualViewport: viewport });
  };
  // 그날의 알림과 카운트다운을 칩으로 보인다. 칩을 누르면 그 항목의 시트가 열린다.
  const drawStrip = (): void => {
    if (!events) return;
    const items = events.view.items();
    const lines = eventsByDate(items, props.dateKey, props.dateKey).get(props.dateKey) ?? [];
    strip.replaceChildren();
    const today = todayKey(nowOf());
    for (const line of lines) {
      const chip = document.createElement('button');
      chip.type = 'button';
      // 앞의 작은 그림(종, 모래시계, 케이크)은 달력 칸의 줄과 같다(styles.css의 .ev-chip::before).
      chip.className = `ev-chip ${line.type}${line.kind === 'birthday' ? ' birthday' : ''}${line.done ? ' done' : ''}`;
      chip.dataset.id = line.id;
      let label = line.type === 'alarm' ? `${line.time} ${line.text}` : line.text;
      const rec = items[line.id];
      if (rec?.type === 'countdown') {
        const st = countdownStatus(rec, today);
        if (st) label += ` ${countdownLabel(st.days)}`;
      }
      chip.textContent = label;
      chip.addEventListener('click', () => openEventSheet(line.type, line.id));
      strip.append(chip);
    }
    strip.hidden = lines.length === 0;
  };
  drawStrip();
  const stopEvents = events?.view.onChange(drawStrip);
  alarmBtn.addEventListener('click', () => openEventSheet('alarm'));
  countdownBtn.addEventListener('click', () => openEventSheet('countdown'));

  let palette: { destroy(): void } | null = null;
  const closePalette = (focusBack: boolean): void => {
    if (!palette) return;
    palette.destroy();
    palette = null;
    colorBtn.setAttribute('aria-expanded', 'false');
    if (focusBack) colorBtn.focus({ preventScroll: true });
  };
  colorBtn.setAttribute('aria-haspopup', 'true');
  colorBtn.setAttribute('aria-expanded', 'false');
  colorBtn.addEventListener('click', () => {
    if (palette) {
      closePalette(false);
      return;
    }
    const colors = ['', ...PALETTE];
    if (color !== '' && !PALETTE.includes(color)) colors.push(color);
    colorBtn.setAttribute('aria-expanded', 'true');
    palette = mountPalette(colorBtn, {
      colors,
      current: color,
      onPick: (c) => {
        color = c;
        paintColor();
      },
      onClose: (by) => closePalette(by !== 'outside'),
    });
  });

  // 저장과 취소는 합쳐서 한 번만 전달한다. 화면이 닫히기 전에 같은 입력이 다시 와도 무시한다.
  let finished = false;
  const save = (): void => {
    if (finished) return;
    finished = true;
    props.onSave({ text: normalizeText(area.value), color });
  };
  const cancel = (): void => {
    if (finished) return;
    finished = true;
    // 가려질 때 저장해 둔 것이 있으면 처음 값으로 되돌린다. 취소는 연 뒤에 고친 것을 모두 버리는 것이다.
    if (kept && (kept.text !== props.value.text || kept.color !== props.value.color)) props.onKeep?.(props.value);
    props.onCancel();
  };
  // 화면이 가려질 때(앱을 나가거나 다른 앱으로 갈 때) 고친 것을 저장해 둔다. 편집 화면은 그대로다.
  let kept: DayValue | null = null;
  const keepIfHidden = (): void => {
    if (finished || !props.onKeep || document.visibilityState !== 'hidden') return;
    if (!kept && !changed()) return; // 고친 것이 없다
    const now: DayValue = { text: normalizeText(area.value), color };
    const last = kept ?? props.value;
    if (now.text === last.text && now.color === last.color) return;
    kept = now;
    props.onKeep(now);
  };
  document.addEventListener('visibilitychange', keepIfHidden);
  const changed = (): boolean => area.value !== props.value.text || color !== props.value.color;
  doneBtn.addEventListener('click', () => {
    const r = toggleDoneInRange(area.value, area.selectionStart, area.selectionEnd);
    area.value = r.text;
    area.setSelectionRange(r.selStart, r.selEnd);
    area.focus();
    if (props.doneTone === 'short') playTone('done');
  });
  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', cancel);
  // 바깥을 눌러 닫는 것은 고친 것이 없을 때만이다. 적던 글이 실수로 사라지지 않게 한다.
  scrim.addEventListener('click', () => {
    if (!changed()) cancel();
  });
  sheet.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 한글 조합 중의 Esc와 Ctrl+Enter는 조합을 끝내는 키다
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops = [...sheet.querySelectorAll<HTMLElement>('button, textarea')].filter((el) => el.tabIndex >= 0 && !el.closest('[hidden]'));
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

  // 아이폰 Safari는 화상 키보드가 열려도 화면 단위(dvh)가 바뀌지 않는다. 보이는 영역을 CSS 변수로 넘겨
  // 좁은 화면에서 시트의 아래 끝이 보이는 영역의 아래 끝에 오게 한다.
  const followViewport = (): void => {
    if (!viewport) return;
    sheet.style.setProperty('--vv-height', `${viewport.height}px`);
    sheet.style.setProperty('--vv-top', `${viewport.offsetTop}px`);
  };
  followViewport();
  viewport?.addEventListener('resize', followViewport);
  viewport?.addEventListener('scroll', followViewport);

  root.append(scrim, sheet);
  document.documentElement.classList.add('sheet-open');
  const drag = env?.attachDrag?.(sheet, sheet.querySelector<HTMLElement>('.sheet-bar')!);
  // 폰 화면에서 아래로 끌어 닫으면 고친 것이 있을 때 저장한다. 적던 글을 잃는 것이 원치 않은 저장보다 나쁘다. 버리려면 취소를 누른다.
  // 알림 상자에서 다른 날짜를 누를 때도(close) 같다.
  const closeKeeping = (): void => (changed() ? save() : cancel());
  const swipe = attachSwipeToClose(sheet, scrim, { onClose: closeKeeping });
  // 열면 메모 칸의 글 끝에 커서를 둔다(2026-11-18 사용자: "포커스가 글 끝에 딱 있으면 좋겠어 그 입력하는 키보드 바로 딱 나오면서").
  // 폰에서 글자판이 바로 올라오는 것은 날짜를 누른 그 순간에 main.ts가 숨은 입력 칸에 초점을 줘 두었기 때문이다(iOS는 누르는 동작 밖에서
  // 준 초점에는 글자판을 띄우지 않고, 이미 떠 있으면 다른 칸으로 옮겨 준다). 폰에서는 화면이 밀리지 않게 한다.
  area.focus({ preventScroll: true });
  area.setSelectionRange(area.value.length, area.value.length);
  area.scrollTop = area.scrollHeight;

  // 폰: 글자판의 "완료"를 누르면 저장하고 달력으로 나간다(2026-11-19 사용자: "키패드 나오잖아. 완료 누르면 바로 저장 되서 캘린더 보이게 하고 싶어").
  // 글자판의 완료는 메모 칸의 초점을 어디로도 옮기지 않고 놓는다(relatedTarget이 없다). 알림·카운트다운 시트와 색 고르기는 초점을 그쪽으로
  // 옮기므로 여기에 걸리지 않는다. 잠깐 기다렸다가, 그 사이 취소나 저장이 눌렸거나 초점이 글 칸으로 돌아왔거나 앱을 나갔으면 하지 않는다.
  // 닫으면 글자판과 편집 화면이 함께 내려간다(글자판만 내려가면 편집 화면이 그 뒤에 한 번에 늘어나 매끄럽지 않았다).
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  const onAreaBlur = (e: FocusEvent): void => {
    if (e.relatedTarget !== null || finished || eventSheet !== null) return;
    if (env?.focusText || window.innerWidth >= WIDE_PX || document.documentElement.classList.contains('desk')) return;
    if (doneTimer !== null) clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      doneTimer = null;
      const active = document.activeElement;
      if (finished || eventSheet !== null || document.visibilityState !== 'visible') return;
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) return;
      closeKeeping();
    }, KEYBOARD_DONE_MS);
  };
  area.addEventListener('blur', onAreaBlur);

  return {
    close: closeKeeping,
    eventSheetOpen: () => eventSheet !== null,
    destroy() {
      area.removeEventListener('blur', onAreaBlur);
      if (doneTimer !== null) clearTimeout(doneTimer);
      document.removeEventListener('visibilitychange', keepIfHidden);
      palette?.destroy();
      palette = null;
      stopEvents?.();
      eventSheet?.destroy();
      eventSheet = null;
      viewport?.removeEventListener('resize', followViewport);
      viewport?.removeEventListener('scroll', followViewport);
      document.documentElement.classList.remove('sheet-open');
      drag?.destroy();
      swipe.destroy();
      dismiss(scrim, sheet);
      // 날짜를 누를 때 글자판을 띄우려고 초점을 줬던 숨은 칸(main.ts)으로는 돌려주지 않는다: 닫은 뒤에 글자판이 다시 뜬다.
      if (previouslyFocused?.isConnected && !previouslyFocused.classList.contains(KEYBOARD_PROXY_CLASS)) previouslyFocused.focus({ preventScroll: true });
    },
  };
}
