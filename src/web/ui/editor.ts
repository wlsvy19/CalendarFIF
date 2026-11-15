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
    note?: { lunar: string; holiday: string };
    /** 완료를 누를 때 소리. */
    doneTone?: 'none' | 'short';
    /**
     * 알림과 카운트다운. 없으면 그 도구 단추와 띠를 숨긴다. 시트의 저장과 삭제는 메모의 저장·취소와 따로 바로 끝난다.
     * flush: 저장한 것을 서버가 받을 때까지 기다린다(아이폰의 지금 예약). 받지 못하면 거절한다.
     */
    events?: { view: EventsView; save(id: string, rec: EventRecord): void; remove(id: string): void; flush?(): Promise<void>; iosHint: boolean; now?: () => Date };
    onSave(next: DayValue): void;
    onCancel(): void;
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
  for (const [className, text] of [['note-lunar', props.note?.lunar ?? ''], ['note-holiday', props.note?.holiday ?? '']]) {
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
  const openEventSheet = (type: 'alarm' | 'countdown', id?: string): void => {
    if (!events || eventSheet) return;
    const firstLine = area.value.split(/\r?\n/).map((l) => l.replace(/^\[\+\]/, '').trim()).find((l) => l !== '') ?? '';
    eventSheet = mountEventSheet(root, {
      type,
      dateKey: props.dateKey,
      id,
      record: id ? events.view.items()[id] : undefined,
      defaultText: id ? '' : firstLine,
      now: nowOf,
      iosHint: events.iosHint,
      onSave: (eid, rec) => events.save(eid, rec),
      onDelete: (eid) => events.remove(eid),
      flush: events.flush ? () => events.flush!() : undefined,
      onClose: () => {
        eventSheet = null;
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
      chip.className = `ev-chip ${line.type}${line.done ? ' done' : ''}`;
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
    props.onCancel();
  };
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
  if (env?.focusText || window.innerWidth >= WIDE_PX) {
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  } else {
    sheet.focus();
  }

  return {
    close: closeKeeping,
    eventSheetOpen: () => eventSheet !== null,
    destroy() {
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
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    },
  };
}
