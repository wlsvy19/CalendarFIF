/**
 * pointerdown(down)이 뒤이어 만들 click 하나를 삼킨다: 그 click은 아무 데도 닿지 않는다. 그 click이 오거나, 다른 곳의 click이
 * 먼저 오거나(키보드로 누른 단추 등), 새로 누르거나, 누르기가 취소되거나(스크롤), 키를 누르면 그만둔다.
 * 그래서 다른 누르기의 click은 삼키지 않는다.
 */
function swallowClickOf(down: Event): void {
  const target = down.target instanceof Node ? down.target : null;
  const stop = (): void => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointercancel', stop, true);
    document.removeEventListener('keydown', stop, true);
  };
  function onClick(e: Event): void {
    stop();
    const t = e.target instanceof Node ? e.target : null;
    if (!target || !t || !(t === target || t.contains(target))) return; // 다른 누르기의 click
    e.preventDefault();
    e.stopPropagation();
  }
  function onDown(e: Event): void {
    if (e !== down) stop();
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointercancel', stop, true);
  document.addEventListener('keydown', stop, true);
}

/**
 * 배경 색 상자. 단추(anchor) 위에 뜨고(공간이 없으면 아래), 시트 안에 붙는다. 그래서 시트의 끌어 닫기와 가림막 누르기가
 * 이 상자와 섞이지 않는다. colors의 ''는 "없음"이다. 고르면 onPick 뒤 onClose, 바깥을 누르거나 Esc면 onClose만 부른다.
 * 바깥을 처음 누르면 상자만 닫힌다: 그 누르기는 밑의 가림막(편집 화면 닫기)이나 다른 단추에 닿지 않는다.
 */
export function mountPalette(
  anchor: HTMLElement,
  opts: { colors: string[]; current: string; onPick(color: string): void; onClose(by?: 'outside'): void },
): { el: HTMLElement; destroy(): void } {
  const el = document.createElement('div');
  el.className = 'palette';
  el.setAttribute('role', 'radiogroup');
  el.setAttribute('aria-label', '배경색');
  for (const c of opts.colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = c === '' ? 'swatch none' : 'swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c === '' ? '없음' : `#${c}`);
    b.title = c === '' ? '없음' : `#${c}`;
    b.dataset.color = c;
    if (c !== '') b.style.setProperty('--sw', `#${c}`);
    b.setAttribute('aria-checked', String(c === opts.current));
    b.tabIndex = c === opts.current ? 0 : -1;
    el.append(b);
  }
  const swatches = [...el.children] as HTMLElement[];
  if (!swatches.some((b) => b.tabIndex === 0) && swatches[0]) swatches[0].tabIndex = 0;

  let destroyed = false;
  const pick = (c: string): void => {
    if (destroyed) return;
    opts.onPick(c);
    opts.onClose();
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.swatch');
    if (b) pick(b.dataset.color ?? '');
  });
  let spaceOn: HTMLElement | null = null;
  el.addEventListener('keyup', (e) => {
    if (e.key !== ' ') return;
    e.preventDefault(); // 뒤따르는 click을 막는다
    const b = spaceOn;
    spaceOn = null;
    if (b && e.target === b) pick(b.dataset.color ?? '');
  });
  el.addEventListener('keydown', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.swatch');
    if (!b) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(b.dataset.color ?? '');
      return;
    }
    // Space는 뗄 때 고른다. 누를 때 고르면 초점이 옮겨간 뒤 브라우저가 만드는 click(Safari)이 상자를 다시 열 수 있다.
    if (e.key === ' ') {
      e.preventDefault();
      spaceOn = b;
      return;
    }
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = swatches[(swatches.indexOf(b) + step + swatches.length) % swatches.length];
    for (const s of swatches) s.tabIndex = s === next ? 0 : -1;
    next.focus();
  });

  // 바깥을 누르면 닫는다. 그 누르기의 click은 삼킨다(아이폰에서 닫힌 상자 밑의 가림막이 편집 화면을 닫지 않게).
  // 단추(anchor)를 다시 누르는 것은 부른 쪽이 여닫기로 처리한다.
  const onOutside = (e: Event): void => {
    const t = e.target as Node | null;
    if (t && (el.contains(t) || anchor.contains(t))) return;
    swallowClickOf(e);
    opts.onClose('outside');
  };
  // Esc는 상자만 닫는다. 시트까지 가면 편집 화면이 닫히므로 여기서 멈춘다.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    opts.onClose();
  };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);

  const host = anchor.closest<HTMLElement>('.sheet') ?? document.body;
  host.append(el);
  // 단추 위에 놓는다. 위에 공간이 모자라면 아래에 놓는다.
  const h = host.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  const left = Math.max(8, Math.min(a.left - h.left, h.width - width - 8));
  el.style.left = `${left}px`;
  const above = a.top - h.top >= el.offsetHeight + 12;
  if (above) el.style.bottom = `${h.bottom - a.top + 8}px`;
  else el.style.top = `${a.bottom - h.top + 8}px`;
  (swatches.find((b) => b.tabIndex === 0) ?? swatches[0])?.focus({ preventScroll: true });

  return {
    el,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      el.remove();
    },
  };
}
