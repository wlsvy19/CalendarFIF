import { PALETTE } from '../../core/color';
import { normalizeText, toggleDoneInRange } from '../../core/text';
import type { DayValue } from '../../core/types';

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const WIDE_PX = 880;

function titleOf(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setFullYear(year);
  return `${month}월 ${day}일 ${WEEKDAY_NAMES[date.getDay()]}요일`;
}

export function mountEditor(
  root: HTMLElement,
  props: {
    dateKey: string;
    value: DayValue;
    onSave(next: DayValue): void;
    onCancel(): void;
  },
): { destroy(): void } {
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
      <h3 id="sheetTitle"></h3>
      <button type="button" class="textbtn end">저장</button>
    </div>
    <div class="field">
      <span class="field-label" id="colorLabel">배경색</span>
      <div class="swatches" role="radiogroup" aria-labelledby="colorLabel"></div>
    </div>
    <div class="field grow">
      <div class="field-head">
        <label class="field-label" for="memoInput">메모</label>
        <button type="button" class="donebtn">완료 표시</button>
      </div>
      <textarea class="memo-input" id="memoInput" placeholder="한 줄에 하나씩 적으세요"></textarea>
    </div>`;
  sheet.querySelector('h3')!.textContent = titleOf(props.dateKey);
  const swatches = sheet.querySelector<HTMLElement>('.swatches')!;
  const area = sheet.querySelector<HTMLTextAreaElement>('textarea')!;
  const cancelBtn = sheet.querySelector<HTMLButtonElement>('.textbtn.start')!;
  const saveBtn = sheet.querySelector<HTMLButtonElement>('.textbtn.end')!;
  const doneBtn = sheet.querySelector<HTMLButtonElement>('.donebtn')!;
  area.value = props.value.text;

  let color = props.value.color;
  const colors = ['', ...PALETTE];
  if (color !== '' && !PALETTE.includes(color)) colors.push(color);
  for (const c of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = c === '' ? 'swatch none' : 'swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c === '' ? '없음' : `#${c}`);
    b.title = c === '' ? '없음' : `#${c}`;
    b.dataset.color = c;
    if (c !== '') b.style.setProperty('--sw', `#${c}`);
    swatches.append(b);
  }
  const swatchList = [...swatches.children] as HTMLElement[];
  function paintSwatches(): void {
    for (const b of swatchList) {
      const on = b.dataset.color === color;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  paintSwatches();

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
  swatches.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.swatch');
    if (!b) return;
    color = b.dataset.color ?? '';
    paintSwatches();
  });
  swatches.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = swatchList.findIndex((b) => b.dataset.color === color);
    const next = swatchList[(i + step + swatchList.length) % swatchList.length];
    color = next.dataset.color ?? '';
    paintSwatches();
    next.focus();
  });
  doneBtn.addEventListener('click', () => {
    const r = toggleDoneInRange(area.value, area.selectionStart, area.selectionEnd);
    area.value = r.text;
    area.setSelectionRange(r.selStart, r.selEnd);
    area.focus();
  });
  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', cancel);
  scrim.addEventListener('click', cancel);
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
    const stops = [...sheet.querySelectorAll<HTMLElement>('button, textarea')].filter((el) => el.tabIndex >= 0);
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
  if (window.innerWidth >= WIDE_PX) {
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  } else {
    sheet.focus();
  }

  return {
    destroy() {
      document.documentElement.classList.remove('sheet-open');
      scrim.remove();
      sheet.remove();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    },
  };
}
