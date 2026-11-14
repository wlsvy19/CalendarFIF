import { dismiss } from './sheetMotion';
import { attachSwipeToClose } from './sheetSwipe';

/**
 * 제목줄과 닫기 단추가 있는 시트를 root에 붙인다. 가림막과 Escape로도 닫히고, 폰 화면에서는 아래로 끌어도 닫힌다. Tab은 시트 안에서만 돈다.
 * 시트가 열릴 때 초점은 시트로 가고, destroy 때 전에 있던 곳으로 돌아간다. onClose는 한 번만 부른다.
 */
export function openSheet(
  root: HTMLElement,
  opts: { className: string; titleId: string; title: string; onClose(): void },
): { sheet: HTMLElement; destroy(): void } {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = `sheet ${opts.className}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', opts.titleId);
  sheet.tabIndex = -1;
  sheet.innerHTML = `
    <div class="sheet-bar">
      <span></span>
      <h3></h3>
      <button type="button" class="textbtn end">닫기</button>
    </div>`;
  const heading = sheet.querySelector('h3')!;
  heading.id = opts.titleId;
  heading.textContent = opts.title;

  let finished = false;
  const close = (): void => {
    if (finished) return;
    finished = true;
    opts.onClose();
  };
  sheet.querySelector('.textbtn.end')!.addEventListener('click', close);
  scrim.addEventListener('click', close);
  sheet.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops = [...sheet.querySelectorAll<HTMLElement>('button, input')].filter(
      (el) => !el.hidden && !(el as HTMLButtonElement).disabled && !el.closest('[hidden]'),
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

  root.append(scrim, sheet);
  document.documentElement.classList.add('sheet-open');
  const swipe = attachSwipeToClose(sheet, scrim, { onClose: close });
  sheet.focus();

  return {
    sheet,
    destroy() {
      document.documentElement.classList.remove('sheet-open');
      swipe.destroy();
      dismiss(scrim, sheet);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    },
  };
}
