import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS } from '../prefs';
import { mountEditor } from './editor';
import { mountSettings } from './settings';
import {
  attachSwipeToClose,
  canScrollUp,
  decideDistance,
  eventTime,
  mayClaim,
  onTitleBar,
  releaseVelocity,
  shouldClose,
  type FirstMove,
} from './sheetSwipe';

afterEach(() => {
  // 끈 뒤에 남는 click 막기를 치운다(새 손가락이 닿으면 그만둔다).
  window.dispatchEvent(new TouchEvent('touchstart'));
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('desk');
  document.body.replaceChildren();
});

describe('놓았을 때 닫을지', () => {
  it('시트 높이의 30%(많아야 160px)보다 내려왔으면 닫는다', () => {
    expect(shouldClose(161, 0, 800)).toBe(true);
    expect(shouldClose(160, 0, 800)).toBe(false);
    expect(shouldClose(91, 0, 300)).toBe(true);
    expect(shouldClose(89, 0, 300)).toBe(false);
    expect(shouldClose(150, 0, 0)).toBe(false); // 높이를 모르면 160px로 본다
  });
  it('24px보다 내려온 채 0.5px/ms보다 빠르게 아래로 놓으면 닫는다', () => {
    expect(shouldClose(30, 0.6, 800)).toBe(true);
    expect(shouldClose(24, 2, 800)).toBe(false);
    expect(shouldClose(100, 0.5, 800)).toBe(false);
    expect(shouldClose(100, -1, 800)).toBe(false);
  });
});

describe('놓을 때의 속도', () => {
  it('마지막 100ms 동안 움직인 거리로 잰다', () => {
    const samples = [0, 10, 20, 30, 40, 50].map((i) => ({ t: 1000 + i * 2, y: 100 + i * 2 })); // 1px/ms
    expect(releaseVelocity(samples, 1100)).toBeCloseTo(1, 1);
    const old = [{ t: 0, y: 0 }, { t: 500, y: 300 }, ...samples];
    expect(releaseVelocity(old, 1100)).toBeCloseTo(1, 1); // 100ms보다 앞의 것은 보지 않는다
  });
  it('멈췄다가 떼면 0에 가깝고, 표본이 모자라면 0이다', () => {
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 10, y: 40 }], 200)).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 10, y: 12 }], 100)).toBeLessThan(0.15);
    expect(releaseVelocity([{ t: 0, y: 0 }], 5)).toBe(0);
    expect(releaseVelocity([], 5)).toBe(0);
  });
  it('위로 움직이며 떼면 음수다', () => {
    expect(releaseVelocity([{ t: 0, y: 100 }, { t: 20, y: 60 }], 25)).toBeLessThan(0);
  });
  it('시각은 이벤트가 일어난 때(timeStamp)로 재고, timeStamp가 다른 기준이면 지금 시각을 쓴다', () => {
    const at = (timeStamp: number) => ({ timeStamp }) as Event;
    expect(eventTime(at(5000), 5040)).toBe(5000);
    expect(eventTime(at(0), 5040)).toBe(5040);
    expect(eventTime(at(1.79e12), 5040)).toBe(5040); // 1970년부터의 ms
    expect(eventTime(at(Number.NaN), 5040)).toBe(5040);
  });
});

describe('첫 움직임에서 시트가 가질지', () => {
  function tree() {
    const sheet = document.createElement('div');
    sheet.innerHTML = '<div class="bar"><button>닫기</button></div><div class="list"><p>내용</p></div><textarea></textarea><input type="text"><input type="range">';
    document.body.append(sheet);
    const q = (s: string) => sheet.querySelector<HTMLElement>(s)!;
    return { sheet, q };
  }
  const base = (target: Element, sheet: Element, more: Partial<FirstMove> = {}): FirstMove => ({
    dx: 0,
    dy: 8,
    elapsedMs: 50,
    cancelable: true,
    fingers: 1,
    target,
    sheet,
    ...more,
  });

  it('아래쪽이고 세로가 더 크며 위로 스크롤할 것이 없으면 가진다', () => {
    const { sheet, q } = tree();
    expect(mayClaim(base(q('button'), sheet))).toBe(true);
    expect(mayClaim(base(q('p'), sheet, { dx: 5, dy: 6 }))).toBe(true);
  });
  it('위쪽이거나 옆쪽이면 가지지 않는다', () => {
    const { sheet, q } = tree();
    expect(mayClaim(base(q('p'), sheet, { dy: -8 }))).toBe(false);
    expect(mayClaim(base(q('p'), sheet, { dx: 8, dy: 8 }))).toBe(false);
    expect(mayClaim(base(q('p'), sheet, { dx: -9, dy: 4 }))).toBe(false);
  });
  it('손가락 밑에서 시트까지 위로 스크롤할 것이 남았으면 가지지 않는다', () => {
    const { sheet, q } = tree();
    q('.list').scrollTop = 40;
    expect(canScrollUp(q('p'), sheet)).toBe(true);
    expect(mayClaim(base(q('p'), sheet))).toBe(false);
    expect(mayClaim(base(q('button'), sheet))).toBe(true); // 스크롤된 목록 밖
    q('textarea').scrollTop = 20;
    expect(mayClaim(base(q('textarea'), sheet))).toBe(false);
    q('.list').scrollTop = 0;
    sheet.scrollTop = 10; // 시트 자신이 스크롤 상자(설정)
    expect(mayClaim(base(q('button'), sheet))).toBe(false);
    sheet.scrollTop = 0;
    q('textarea').scrollTop = 0;
    expect(canScrollUp(q('textarea'), sheet)).toBe(false);
  });
  it('막을 수 없는 움직임, 두 손가락, 범위 막대는 가지지 않는다', () => {
    const { sheet, q } = tree();
    expect(mayClaim(base(q('p'), sheet, { cancelable: false }))).toBe(false);
    expect(mayClaim(base(q('p'), sheet, { fingers: 2 }))).toBe(false);
    expect(mayClaim(base(q('input[type="range"]'), sheet))).toBe(false);
  });
  it('글 칸은 350ms 안에 움직이기 시작해야 가진다(늦으면 길게 누르기)', () => {
    const { sheet, q } = tree();
    expect(mayClaim(base(q('textarea'), sheet, { elapsedMs: 300 }))).toBe(true);
    expect(mayClaim(base(q('textarea'), sheet, { elapsedMs: 400 }))).toBe(false);
    expect(mayClaim(base(q('input[type="text"]'), sheet, { elapsedMs: 400 }))).toBe(false);
    expect(mayClaim(base(q('p'), sheet, { elapsedMs: 400 }))).toBe(true);
  });
  it('제목 줄(.sheet-bar)에서 시작했으면 시트가 스크롤되어 있어도 가진다. 그 밖은 그대로 스크롤에 맡긴다', () => {
    const sheet = document.createElement('div');
    sheet.innerHTML = '<div class="sheet-bar"><span></span><h3>설정</h3><button>닫기</button></div><p class="list">내용</p>';
    document.body.append(sheet);
    const q = (s: string) => sheet.querySelector<HTMLElement>(s)!;
    sheet.scrollTop = 120;
    expect(onTitleBar(q('h3'), sheet)).toBe(true);
    expect(onTitleBar(q('.sheet-bar'), sheet)).toBe(true);
    expect(onTitleBar(q('.list'), sheet)).toBe(false);
    expect(mayClaim(base(q('h3'), sheet))).toBe(true);
    expect(mayClaim(base(q('.sheet-bar span'), sheet))).toBe(true);
    expect(mayClaim(base(q('.sheet-bar button'), sheet))).toBe(true);
    expect(mayClaim(base(q('.list'), sheet))).toBe(false);
    expect(mayClaim(base(q('h3'), sheet, { dy: -8 }))).toBe(false); // 방향 조건은 그대로다
  });
});

describe('누가 가질지 정하는 거리', () => {
  it('누르면 동작하는 것(또는 그 안) 위에서 닿았으면 8px, 아니면 3px이다', () => {
    const sheet = document.createElement('div');
    sheet.innerHTML = `
      <div class="sheet-bar"><button><span class="in">취소</span></button><h3>제목</h3></div>
      <label class="pref-row"><span class="name">음력</span><input class="switch" type="checkbox" role="switch"></label>
      <span class="field-label">메모</span><textarea></textarea><input type="text"><select><option>a</option></select>
      <details><summary>방법</summary><p class="para">글</p></details>
      <a href="#x">링크</a><a class="plain">이름만</a>
      <div role="radio" class="r"></div><div role="button" class="rb"></div><div contenteditable class="ce"></div>
      <p class="gap">빈 곳</p>`;
    document.body.append(sheet);
    const at = (s: string) => decideDistance(sheet.querySelector(s)!, sheet);
    for (const s of ['button', '.in', '.switch', '.name', 'textarea', 'input[type="text"]', 'select', 'summary', 'a[href]', '.r', '.rb', '.ce']) expect([s, at(s)]).toEqual([s, 8]);
    for (const s of ['h3', '.sheet-bar', '.field-label', '.para', '.plain', '.gap']) expect([s, at(s)]).toEqual([s, 3]);
    expect(decideDistance(sheet, sheet)).toBe(3);
  });
  it('시트 바깥의 조상은 보지 않는다', () => {
    const outer = document.createElement('button');
    const sheet = document.createElement('div');
    sheet.innerHTML = '<p>글</p>';
    outer.append(sheet);
    document.body.append(outer);
    expect(decideDistance(sheet.querySelector('p')!, sheet)).toBe(3);
  });
});

/** 손가락 하나. 움직일 때마다 시계를 step만큼 보낸다. */
function finger(target: Element, clock: { t: number }, id = 1) {
  let x = 100;
  let y = 100;
  const point = () => new Touch({ identifier: id, target, clientX: x, clientY: y });
  const fire = (type: string, touches: Touch[], changed: Touch[], cancelable = true) => {
    const e = new TouchEvent(type, { bubbles: true, cancelable, touches, changedTouches: changed });
    target.dispatchEvent(e);
    return e;
  };
  return {
    down(atX = 100, atY = 100) {
      x = atX;
      y = atY;
      const p = point();
      return fire('touchstart', [p], [p]);
    },
    move(dy: number, opts: { dx?: number; step?: number; cancelable?: boolean } = {}) {
      clock.t += opts.step ?? 16;
      x += opts.dx ?? 0;
      y += dy;
      const p = point();
      return fire('touchmove', [p], [p], opts.cancelable ?? true);
    },
    /** dy를 n번에 나눠 움직인다. */
    drag(dy: number, n: number, step = 16) {
      const events: TouchEvent[] = [];
      for (let i = 0; i < n; i++) events.push(this.move(dy / n, { step }));
      return events;
    },
    wait(ms: number) {
      clock.t += ms;
    },
    up() {
      return fire('touchend', [], [point()]);
    },
    cancel() {
      return fire('touchcancel', [], [point()]);
    },
  };
}

function setup(opts: { phone?: boolean; reduced?: boolean; env?: false } = {}) {
  const scrim = document.createElement('div');
  const sheet = document.createElement('div');
  sheet.innerHTML = '<div class="bar"><button type="button">닫기</button><h3>제목</h3></div><div class="list"><p>내용</p></div><textarea></textarea>';
  document.body.append(scrim, sheet);
  Object.defineProperty(sheet, 'offsetHeight', { value: 800, configurable: true });
  const onClose = vi.fn();
  const clock = { t: 1000 };
  const swipe = attachSwipeToClose(
    sheet,
    scrim,
    { onClose },
    opts.env === false ? undefined : { phone: () => opts.phone ?? true, reducedMotion: () => opts.reduced ?? true, now: () => clock.t },
  );
  const at = (s: string) => finger(sheet.querySelector(s)!, clock);
  const offset = () => sheet.style.transform;
  return { scrim, sheet, onClose, swipe, clock, at, offset };
}

describe('끌어 내려 닫기', () => {
  it('끄는 동안 시트가 6px 뒤부터 손가락과 같은 만큼 따라오고, 위로는 0에서 멈춘다', () => {
    const { at, offset, scrim } = setup();
    const f = at('h3');
    f.down();
    const first = f.move(4);
    expect(first.defaultPrevented).toBe(true);
    expect(offset()).toBe('translate3d(0, 0px, 0)');
    f.move(6);
    expect(offset()).toBe('translate3d(0, 4px, 0)');
    f.move(100);
    expect(offset()).toBe('translate3d(0, 104px, 0)');
    expect(Number(scrim.style.opacity)).toBeCloseTo(1 - 0.85 * (104 / 800), 2);
    f.move(-200);
    expect(offset()).toBe('translate3d(0, 0px, 0)');
  });
  it('많이 끌어 놓으면 onClose를 한 번만 부르고, 그 뒤의 손짓은 닫지 않는다', () => {
    const { at, onClose, offset } = setup();
    const f = at('h3');
    f.down();
    f.drag(200, 10, 50); // 천천히
    f.wait(150);
    const end = f.up();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(end.defaultPrevented).toBe(true); // 끈 손가락의 click을 막는다
    expect(offset()).toBe(''); // 부른 쪽이 치우지 않았으므로 제자리로 돌려 놓았다
    const g = at('h3');
    g.down();
    g.drag(300, 10);
    g.up();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('조금만 끌고 멈췄다 놓으면 닫지 않고 제자리로 돌아간다', () => {
    const { at, onClose, offset, scrim } = setup();
    const f = at('h3');
    f.down();
    f.drag(40, 4, 40);
    f.wait(150);
    f.up();
    expect(onClose).not.toHaveBeenCalled();
    expect(offset()).toBe('');
    expect(scrim.style.opacity).toBe('');
  });
  it('짧아도 빠르게 아래로 튕기면 닫는다. 24px이 안 되면 닫지 않는다', () => {
    const quick = setup();
    const f = quick.at('h3');
    f.down();
    f.drag(48, 4, 8);
    f.up();
    expect(quick.onClose).toHaveBeenCalledTimes(1);
    document.body.replaceChildren();
    const tiny = setup();
    const g = tiny.at('h3');
    g.down();
    g.drag(28, 4, 8); // 시트는 22px
    g.up();
    expect(tiny.onClose).not.toHaveBeenCalled();
  });
  it('위로 먼저 움직인 손짓은 브라우저에 맡기고, 같은 손짓에서 다시 잡지 않는다', () => {
    const { at, onClose, offset } = setup();
    const f = at('p');
    f.down();
    expect(f.move(-10).defaultPrevented).toBe(false);
    expect(f.move(250).defaultPrevented).toBe(false);
    f.up();
    expect(offset()).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('닿을 때의 작은 떨림(3px 미만)으로는 정하지 않는다', () => {
    const { at, offset } = setup();
    const f = at('p');
    f.down();
    expect(f.move(-1).defaultPrevented).toBe(false);
    expect(f.move(1).defaultPrevented).toBe(false);
    expect(f.move(10).defaultPrevented).toBe(true);
    expect(offset()).toBe('translate3d(0, 0px, 0)');
    f.move(5);
    expect(offset()).toBe('translate3d(0, 5px, 0)');
  });
  it('첫 움직임이 이미 멀리서 오면(Chromium은 처음 몇 px을 보내지 않는다) 튀지 않고 거기서부터 따라온다', () => {
    const { at, offset } = setup();
    const f = at('h3');
    f.down();
    f.move(20);
    expect(offset()).toBe('translate3d(0, 0px, 0)');
    f.move(10);
    expect(offset()).toBe('translate3d(0, 10px, 0)');
  });
  it('스크롤이 내려가 있는 목록이나 글 칸에서 아래로 끌면 스크롤하게 둔다', () => {
    const { at, sheet, onClose, offset } = setup();
    sheet.querySelector<HTMLElement>('.list')!.scrollTop = 80;
    const f = at('p');
    f.down();
    expect(f.move(20).defaultPrevented).toBe(false);
    f.drag(300, 10);
    f.up();
    sheet.querySelector('textarea')!.scrollTop = 30;
    const g = at('textarea');
    g.down();
    expect(g.move(20).defaultPrevented).toBe(false);
    g.up();
    expect(offset()).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('글 칸을 길게 누른 뒤 움직이면 브라우저에 맡긴다', () => {
    const { at, offset } = setup();
    const f = at('textarea');
    f.down();
    f.wait(500);
    expect(f.move(20).defaultPrevented).toBe(false);
    expect(offset()).toBe('');
  });
  it('touchcancel이면 제자리로 돌아간다', () => {
    const { at, onClose, offset } = setup();
    const f = at('h3');
    f.down();
    f.drag(300, 10, 50);
    f.cancel();
    expect(offset()).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('두 번째 손가락이 닿으면 정하기 전의 손짓은 브라우저에 맡긴다', () => {
    const { at, sheet, offset } = setup();
    const f = at('h3');
    f.down();
    const second = new Touch({ identifier: 2, target: sheet, clientX: 200, clientY: 300 });
    const first = new Touch({ identifier: 1, target: sheet, clientX: 100, clientY: 100 });
    sheet.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [first, second], changedTouches: [second] }));
    expect(f.move(30).defaultPrevented).toBe(false);
    expect(offset()).toBe('');
  });
});

describe('click 막기', () => {
  it('끈 손가락의 click(손가락이 만든 것)은 먹고, 그 뒤의 누르기는 그대로 둔다', () => {
    const { at, sheet } = setup();
    const clicked = vi.fn();
    const button = sheet.querySelector('button')!;
    button.addEventListener('click', clicked);
    const f = at('button');
    f.down();
    f.drag(40, 4, 40);
    f.wait(150);
    expect(f.up().defaultPrevented).toBe(true);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(clicked).not.toHaveBeenCalled();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });
  it('새 손가락이 닿거나 400ms가 지나면 막기를 그만둔다', () => {
    vi.useFakeTimers();
    try {
      const { at, sheet } = setup();
      const clicked = vi.fn();
      const button = sheet.querySelector('button')!;
      button.addEventListener('click', clicked);
      const f = at('button');
      f.down();
      f.drag(40, 4, 40);
      f.up();
      vi.advanceTimersByTime(400);
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(clicked).toHaveBeenCalledTimes(1);
      const g = at('button');
      g.down();
      g.drag(40, 4, 40);
      g.up();
      window.dispatchEvent(new TouchEvent('touchstart'));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(clicked).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('실제 시트에서의 누르기', () => {
  // iOS Safari는 막은(preventDefault) touchmove가 하나라도 있으면 그 손가락에 click을 주지 않는다. 그래서 click을 직접 보내 보지
  // 않고, 손가락이 낸 touchmove와 touchend가 막히지 않았는지를 본다.
  const phone = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 879.98px)' }));
  function editorSheet(): HTMLElement {
    phone();
    const root = document.createElement('div');
    document.body.append(root);
    mountEditor(root, { dateKey: '2026-11-13', value: { text: 'a', color: '' }, onSave: vi.fn(), onCancel: vi.fn() });
    return root.querySelector<HTMLElement>('.sheet')!;
  }
  function settingsSheet(): HTMLElement {
    phone();
    const root = document.createElement('div');
    document.body.append(root);
    mountSettings(root, {
      email: 'me@example.com',
      pending: 0,
      storageOk: true,
      corruptFound: false,
      onSignOut: vi.fn(),
      onClose: vi.fn(),
      prefs: { value: DEFAULT_PREFS, onChange: vi.fn() },
    });
    return root.querySelector<HTMLElement>('.sheet')!;
  }
  /** target에서 닿아 (dx, dy)까지 두 번에 나눠 움직이고 뗀다. 막혔는지를 [첫 움직임, 둘째 움직임, 뗌] 순서로 돌려준다. */
  function drift(target: Element, dx: number, dy: number): boolean[] {
    const f = finger(target, { t: 0 });
    f.down();
    const moves = [f.move(dy / 2, { dx: dx / 2 }), f.move(dy / 2, { dx: dx / 2 })];
    const end = f.up();
    return [...moves, end].map((e) => e.defaultPrevented);
  }
  const DRIFTS = [
    [1, 3],
    [0, 5],
    [2, 7],
  ] as const;
  function controls(): Array<[string, Element]> {
    const editor = editorSheet();
    const settings = settingsSheet();
    return [
      ['저장', editor.querySelector('.textbtn.end')!],
      ['배경 도구 단추', editor.querySelector('button.tool.color')!],
      ['메모 칸', editor.querySelector('textarea')!],
      ['설정 스위치', settings.querySelector('label.pref-row input.switch')!],
    ];
  }

  it('누르면 동작하는 것 위에서는 7px까지 굴러도 touchmove와 touchend를 막지 않는다', () => {
    const seen: string[] = [];
    for (const [name, el] of controls()) {
      for (const [dx, dy] of DRIFTS) seen.push(`${name} (${dx},${dy}): ${drift(el, dx, dy).join(',')}`);
      expect((el.closest('.sheet') as HTMLElement).style.transform).toBe('');
    }
    expect(seen).toEqual(controls().flatMap(([name]) => DRIFTS.map(([dx, dy]) => `${name} (${dx},${dy}): false,false,false`)));
  });
  it('같은 움직임도 제목 글자(누르는 것이 아닌 곳) 위에서는 3px에서 시트가 가진다', () => {
    const titles = [editorSheet().querySelector('h3')!, settingsSheet().querySelector('h3')!];
    for (const h3 of titles) {
      expect(drift(h3, 1, 3)).toEqual([false, true, false]);
      expect(drift(h3, 0, 5)).toEqual([false, true, false]);
      expect(drift(h3, 2, 7)).toEqual([true, true, false]); // 첫 움직임(1, 3.5)에서 이미 3px을 넘는다
    }
  });
  it('누르는 것 위에서도 8px을 넘게 아래로 끌면 시트가 가진다', () => {
    for (const [name, el] of controls()) expect([name, drift(el, 0, 9)]).toEqual([name, [false, true, false]]);
  });
  it('시트가 스크롤되어 있으면 제목 줄에서 끈 것만 가지고 목록에서 끈 것은 스크롤에 맡긴다', () => {
    const settings = settingsSheet();
    settings.scrollTop = 120;
    expect(drift(settings.querySelector('.sheet-bar h3')!, 0, 10)).toEqual([true, true, false]);
    expect(drift(settings.querySelector('.sheet-bar .textbtn.end')!, 0, 10)).toEqual([false, true, false]); // 닫기 단추: 8px
    expect(drift(settings.querySelector('.settings-email')!, 0, 10)).toEqual([false, false, false]);
    expect(drift(settings.querySelector('label.pref-row input.switch')!, 0, 10)).toEqual([false, false, false]);
  });
});

describe('끝을 듣지 못한 손가락', () => {
  it('같은 번호로 새로 닿으면(changedTouches에 있다) 끌던 것을 제자리로 돌리고 새 손짓으로 시작한다', () => {
    const { at, offset, onClose } = setup();
    const f = at('h3');
    f.down();
    f.drag(100, 5); // 뗀 것을 듣지 못했다
    expect(offset()).toBe('translate3d(0, 80px, 0)');
    const g = at('h3');
    g.down(100, 400);
    expect(offset()).toBe('');
    g.move(10);
    expect(offset()).toBe('translate3d(0, 0px, 0)'); // 새로 닿은 곳(400)에서 잰다
    g.move(10);
    expect(offset()).toBe('translate3d(0, 10px, 0)');
    g.up();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('정말로 하나 더 닿은 손가락(touches에만 있다)이면 첫 손가락을 계속 따라간다', () => {
    const { at, sheet, offset } = setup();
    const f = at('h3');
    f.down();
    f.drag(100, 5);
    const first = new Touch({ identifier: 1, target: sheet, clientX: 100, clientY: 200 });
    const second = new Touch({ identifier: 2, target: sheet, clientX: 200, clientY: 300 });
    sheet.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [first, second], changedTouches: [second] }));
    expect(offset()).toBe('translate3d(0, 80px, 0)');
    f.move(10);
    expect(offset()).toBe('translate3d(0, 90px, 0)');
  });
});

describe('폰 배치가 아닐 때', () => {
  it('phone()이 false면 아무것도 하지 않는다', () => {
    const { at, onClose, offset } = setup({ phone: false });
    const f = at('h3');
    f.down();
    expect(f.move(20).defaultPrevented).toBe(false);
    f.drag(300, 5);
    expect(f.up().defaultPrevented).toBe(false);
    expect(offset()).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });
  const NARROW = '(max-width: 879.98px)';
  const stubMedia = (narrow: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === NARROW ? narrow : false }));
  it('기본 판단: 넓은 화면이거나 <html>에 desk가 있으면 아무것도 하지 않고, 좁은 화면이면 따라간다', () => {
    for (const [narrow, desk, moves] of [
      [false, false, false],
      [true, true, false],
      [true, false, true],
    ] as const) {
      stubMedia(narrow);
      document.documentElement.classList.toggle('desk', desk);
      const { at, sheet } = setup({ env: false });
      const f = at('h3');
      f.down();
      f.move(30);
      expect(sheet.style.transform !== '').toBe(moves);
      f.up();
      document.body.replaceChildren();
    }
  });
});

describe('움직임', () => {
  it('들어오는 중이거나 돌아가는 중에 잡으면 그 자리에서 멈추고 거기서 이어 간다', () => {
    const { at, sheet, scrim, offset } = setup({ reduced: false });
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel, finished: new Promise(() => {}) }));
    Object.assign(sheet, { animate });
    Object.assign(scrim, { animate });
    const f = at('h3');
    f.down();
    f.drag(40, 4, 40);
    f.wait(150);
    f.up(); // 제자리로 돌아가기 시작한다
    expect(animate).toHaveBeenCalledTimes(2);
    expect((animate.mock.calls[0] as unknown[])[0]).toEqual([{ transform: 'translate3d(0, 30px, 0)' }, { transform: 'translate3d(0, 0, 0)' }]);
    expect((animate.mock.calls[0] as unknown[])[1]).toMatchObject({ duration: 220, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    const real = window.getComputedStyle.bind(window);
    vi.stubGlobal('getComputedStyle', (el: Element) =>
      el === sheet ? { transform: 'matrix(1, 0, 0, 1, 0, 20)' } : el === scrim ? { opacity: '0.9' } : real(el),
    );
    const g = at('h3');
    g.down();
    g.move(4);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(sheet.style.animation).toBe('none');
    expect(scrim.style.animation).toBe('none');
    expect(offset()).toBe('translate3d(0, 20px, 0)');
    g.move(10);
    expect(offset()).toBe('translate3d(0, 28px, 0)');
  });
  it('움직임 줄이기에서는 돌아가는 움직임 없이 바로 제자리다', () => {
    const { at, sheet, offset } = setup({ reduced: true });
    const animate = vi.fn();
    Object.assign(sheet, { animate });
    const f = at('h3');
    f.down();
    f.drag(40, 4, 40);
    f.wait(150);
    f.up();
    expect(animate).not.toHaveBeenCalled();
    expect(offset()).toBe('');
  });
  it('끄는 중에 destroy하면 끌던 자리를 남기고 더는 듣지 않는다', () => {
    const { at, swipe, offset, onClose } = setup();
    const f = at('h3');
    f.down();
    f.drag(100, 5);
    swipe.destroy();
    expect(offset()).toBe('translate3d(0, 80px, 0)'); // dismiss가 여기서 내려간다
    f.drag(200, 5);
    f.up();
    expect(offset()).toBe('translate3d(0, 80px, 0)');
    expect(onClose).not.toHaveBeenCalled();
  });
});
