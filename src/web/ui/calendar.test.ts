import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayValue } from '../../core/types';
import type { SyncStatus } from '../../sync/engine';
import type { CalendarStore } from '../state';
import { shiftMonth } from '../../core/dates';
import { setOfficialHolidays } from '../../core/holidays';
import { DEFAULT_APPEARANCE, WEB_APPEARANCE, type Appearance } from '../appearance';
import { displayLines, mountCalendar, visibleLines, type WebLook } from './calendar';

function fakeStore(days: Record<string, DayValue>) {
  let month = '2026-11';
  return {
    current: () => month,
    show: vi.fn((m: string) => { month = m; }),
    days: (m: string) => (m === '2026-11' ? days : {}),
    onChange: () => () => {},
    readProblem: () => null,
  } as unknown as CalendarStore & { show: ReturnType<typeof vi.fn> };
}
function mount(days: Record<string, DayValue> = {}, status: SyncStatus = { state: 'synced', pending: 0 }) {
  const root = document.createElement('div');
  const store = fakeStore(days);
  const onOpenDay = vi.fn();
  mountCalendar(root, { store, status: { status: () => status, subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn() });
  return { root, store, onOpenDay };
}
// 달력의 칸은 지금 쪽(.grid.current)의 칸이다. 웹 달력은 양옆 쪽도 붙여 둔다.
const cell = (root: HTMLElement, key: string) => root.querySelector<HTMLElement>(`.grid.current .cell[data-key="${key}"]`)!;
const cells = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.grid.current .cell')];

it('칸에 들어가는 만큼만 줄을 보여 준다', () => {
  expect(visibleLines(['a', 'b'], 3)).toEqual({ shown: ['a', 'b'], more: 0 });
  expect(visibleLines(['a', 'b', 'c', 'd'], 3)).toEqual({ shown: ['a', 'b'], more: 2 });
  expect(visibleLines(['a', 'b', 'c'], 1)).toEqual({ shown: [], more: 3 });
});
it('한 달을 그린다', () => {
  const { root } = mount({ '13': { text: '회의\n[+]장보기', color: 'F12424' } });
  expect(cells(root)).toHaveLength(35);
  expect(root.textContent).toContain('2026년');
  expect(root.textContent).toContain('11월');
  expect(root.textContent).toContain('동기화됨');
  const day = cell(root, '2026-11-13');
  expect(day.classList.contains('today')).toBe(true);
  expect(day.dataset.color).toBe('F12424');
  expect(day.style.getPropertyValue('--day-color')).toBe('#F12424');
  const lines = [...day.querySelectorAll('.ln')];
  expect(lines.map((el) => el.textContent)).toEqual(['회의', '장보기']);
  expect(lines[1].classList.contains('done')).toBe(true);
  expect(cell(root, '2026-11-01').classList.contains('sun')).toBe(true);
  expect(cell(root, '2026-11-07').classList.contains('sat')).toBe(true);
  expect(cell(root, '2026-12-05').classList.contains('other')).toBe(true);
});
it('달을 넘기고, 날짜를 누르면 알린다', () => {
  // 쪽은 지금 달과 양옆 달이고, 그 쪽들이 걸친 달 중 지금 달의 앞뒤 한 달 밖의 것을 더해서 구독한다.
  // 11월: 10월(9/27~10/31), 11월(11/1~12/5), 12월(11/29~1/2) 쪽
  const { root, store, onOpenDay } = mount();
  expect(store.show).toHaveBeenLastCalledWith('2026-11', ['2026-09', '2027-01']);
  // 폭이 없으면(happy-dom) 단추는 바로 넘긴다. 12월: 11월, 12월, 2027년 1월(12/27~2/6) 쪽
  root.querySelector<HTMLElement>('[aria-label="다음 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-12', ['2026-10', '2027-02']); // 한 번 더 넘길 달(앞뒤 두 달)도 받는다
  // 2027년 1월: 12월, 1월, 2월(1/31~3/6) 쪽
  root.querySelector<HTMLElement>('[aria-label="다음 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2027-01', ['2026-11', '2027-03']);
  root.querySelector<HTMLElement>('[aria-label="이전 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-12', ['2026-10', '2027-02']); // 한 번 더 넘길 달(앞뒤 두 달)도 받는다
  [...root.querySelectorAll('button')].find((b) => b.textContent === '오늘')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-11', ['2026-09', '2027-01']);
  cell(root, '2026-11-20').click();
  expect(onOpenDay).toHaveBeenCalledWith('2026-11-20');
});
it('대기 중이면 건수를 보여 준다', () => {
  expect(mount({}, { state: 'waiting', pending: 2 }).root.textContent).toContain('오프라인 (대기 2건)');
});
it('읽기 문제를 보여 주고, 연결이 끊기거나 이어지면 상태를 다시 그린다', () => {
  const problem = mount();
  (problem.store as unknown as { readProblem: () => string | null }).readProblem = () => 'denied';
  window.dispatchEvent(new Event('offline'));
  expect(problem.root.querySelector('.sync-text')!.textContent).toBe('권한이 없어 읽지 못했습니다');

  const { root } = mount();
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  expect(root.querySelector('.sync-text')!.textContent).toBe('오프라인');
  onLine.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  expect(root.querySelector('.sync-text')!.textContent).toBe('동기화됨');
  onLine.mockRestore();
});
describe('날짜가 바뀌면', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('자정이 지나면 오늘 표시를 옮긴다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 23, 59, 50));
    const midnight = new Date(2026, 10, 14).getTime();
    const root = document.createElement('div');
    const handle = mountCalendar(root, {
      store: fakeStore({}),
      status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} },
      today: () => (Date.now() < midnight ? '2026-11-13' : '2026-11-14'),
      onOpenDay: vi.fn(),
      onOpenSettings: vi.fn(),
    });
    expect(cell(root, '2026-11-13').classList.contains('today')).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(cell(root, '2026-11-14').classList.contains('today')).toBe(true);
    expect(cell(root, '2026-11-13').classList.contains('today')).toBe(false);
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('다시 보이게 될 때 날짜가 바뀌었으면 다시 그린다', () => {
    let today = '2026-11-13';
    const root = document.createElement('div');
    const handle = mountCalendar(root, {
      store: fakeStore({}),
      status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} },
      today: () => today,
      onOpenDay: vi.fn(),
      onOpenSettings: vi.fn(),
    });
    today = '2026-11-14';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cell(root, '2026-11-14').classList.contains('today')).toBe(true);
    const calendar = root.firstElementChild as HTMLElement;
    handle.destroy();
    today = '2026-11-15';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cell(calendar, '2026-11-15').classList.contains('today')).toBe(false);
  });
});
describe('달 넘기기', () => {
  function scrollMount(desktop = false) {
    const root = document.createElement('div');
    const store = fakeStore({});
    const onOpenDay = vi.fn();
    mountCalendar(
      root,
      {
        store,
        status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} },
        today: () => '2026-11-13',
        onOpenDay,
        onOpenSettings: vi.fn(),
        ...(desktop ? { appearance: { ...DEFAULT_APPEARANCE, layout: 'month' as const }, desktop: { onDayMenu: vi.fn(), onOpenMenu: vi.fn() } } : {}),
      },
      { reducedMotion: () => false, pager: { width: () => 400 } },
    );
    const pager = root.querySelector<HTMLElement>('.pager')!;
    const scroll = (left: number) => {
      pager.scrollLeft = left;
      pager.dispatchEvent(new Event('scroll'));
    };
    const title = () => root.querySelector('.month')!.textContent;
    return { root, store, onOpenDay, pager, scroll, title };
  }
  it('반을 넘게 스크롤하면 제목이 다음 달이 되고 그 쪽들의 달을 구독한다', () => {
    const { pager, store, scroll, title } = scrollMount();
    expect(pager.scrollLeft).toBe(1200 * 400);
    scroll(1200 * 400 + 150);
    expect([title(), store.show.mock.lastCall]).toEqual(['11월', ['2026-11', ['2026-09', '2027-01']]]);
    scroll(1200 * 400 + 201);
    expect([title(), store.show.mock.lastCall]).toEqual(['12월', ['2026-12', ['2026-10', '2027-02']]]);
  });
  it('지금 쪽의 칸을 누르면 그 날을 열고, 옆 쪽의 칸은 열지 않는다', () => {
    const { root, onOpenDay } = scrollMount();
    cell(root, '2026-11-20').click();
    // happy-dom은 inert를 눌린 자리 찾기에 쓰지 않으므로 옆 쪽의 칸에 바로 click을 보낸다.
    root.querySelector<HTMLElement>('.grid[inert] .cell[data-key="2026-10-15"]')!.click();
    expect(onOpenDay.mock.calls).toEqual([['2026-11-20']]);
  });
  it('웹 달력은 세 쪽을, PC 달력은 한 쪽을 붙인다', () => {
    const web = scrollMount().root;
    expect([web.querySelectorAll('.grid').length, web.querySelectorAll('.grid.current').length, web.querySelectorAll('.grid[inert]').length]).toEqual([3, 1, 2]);
    const pc = scrollMount(true).root;
    expect([pc.querySelectorAll('.slot').length, pc.querySelectorAll('.grid').length, pc.querySelectorAll('.grid.current').length, pc.querySelector<HTMLElement>('.pager')!.scrollLeft]).toEqual([1, 1, 1, 0]);
  });
  it('다음 달 단추는 부드럽게 스크롤하고, 스크롤이 반을 넘어야 제목이 바뀐다', () => {
    const { root, pager, store, scroll, title } = scrollMount();
    const scrollTo = vi.spyOn(pager, 'scrollTo').mockImplementation(() => {});
    store.show.mockClear();
    root.querySelector<HTMLElement>('[aria-label="다음 달"]')!.click();
    expect(scrollTo.mock.calls).toEqual([[{ left: 1201 * 400, behavior: 'smooth' }]]);
    expect([title(), store.show.mock.calls.length]).toEqual(['11월', 0]);
    scroll(1200 * 400 + 120);
    expect(title()).toBe('11월');
    scroll(1200 * 400 + 260);
    scroll(1201 * 400);
    expect([title(), store.show.mock.calls]).toEqual(['12월', [['2026-12', ['2026-10', '2027-02']]]]);
  });
});

function mountA(a: Partial<Appearance>, today = '2026-11-13') {
  const root = document.createElement('div');
  const store = fakeStore({ '13': { text: '[+]끝낸 일\n회의\n[+]장보기\n운동', color: '' } });
  store.show(today.slice(0, 7)); // main.ts처럼 저장소는 오늘의 달에서 시작한다
  mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => today, onOpenDay: vi.fn(), onOpenSettings: vi.fn(), appearance: { ...DEFAULT_APPEARANCE, ...a } });
  return root;
}
const has = (el: Element, c: string) => el.classList.contains(c);
describe('화면 설정', () => {
  it('변동 월은 지난 주 한 줄과 앞으로 네 줄이고 흐린 칸이 없다. 단일 행과 시작 요일', () => {
    const root = mountA({});
    const shown = cells(root);
    expect([shown.length, shown[0].dataset.key, root.querySelector('.cell.other'), root.querySelector('[aria-label="다음"]') !== null]).toEqual([35, '2026-11-01', null, true]);
    expect(cells(mountA({ layout: 'week' }))).toHaveLength(7);
    expect([...mountA({ layout: 'days' }).querySelectorAll('.dow span')].map((s) => s.textContent)).toEqual(['금', '토', '일', '월', '화', '수', '목']);
    const mon = mountA({ layout: 'month', weekStart: 1 });
    expect([cells(mon).length, mon.querySelector('.dow span')!.textContent]).toEqual([42, '월']);
  });
  it('주 번호, 공휴일, 음력, 쉬는날', () => {
    expect([...mountA({ weekNumbers: true }).querySelectorAll('.grid.current .wk')].map((w) => w.textContent)).toEqual(['45', '46', '47', '48', '49']);
    const root = mountA({ layout: 'month', lunar: true }, '2026-12-10');
    const xmas = cell(root, '2026-12-25');
    expect([has(xmas, 'holiday'), has(xmas, 'rest'), xmas.querySelector('.hname')!.textContent, xmas.querySelector('.lunar')!.textContent]).toEqual([true, true, '성탄절', '음 11.17']);
    expect([has(cell(root, '2026-12-06'), 'rest'), has(cell(root, '2026-12-07'), 'rest')]).toEqual([true, false]);
    const off = mountA({ layout: 'month', holidays: false, showRestDays: false }, '2026-12-10');
    expect([off.querySelector('.hname'), off.querySelector('.cell.rest')]).toEqual([null, null]);
  });
  it('완료한 줄 숨기기와 맨 아래로 보내기, 줄 머리, 그림자, 월 간격, 제목 줄', () => {
    expect(displayLines('[+]A\nB\n\n[+]C\nD', { showDone: true, doneToBottom: true })).toEqual([{ text: 'B', done: false }, { text: 'D', done: false }, { text: 'A', done: true }, { text: 'C', done: true }]);
    expect(displayLines('[+]A\nB', { showDone: false, doneToBottom: false })).toEqual([{ text: 'B', done: false }]);
    const root = mountA({ showDone: false, bullet: 'number' });
    expect([...cell(root, '2026-11-13').querySelectorAll('.ln')].map((l) => l.textContent)).toEqual(['회의', '운동']);
    const cal = root.querySelector<HTMLElement>('.calendar')!;
    expect([cal.dataset.bullet, has(cal, 'shadow'), has(cal, 'month-gap')]).toEqual(['number', true, true]);
    expect([[...cell(root, '2026-12-01').classList].filter((c) => c.startsWith('m-')), has(cell(root, '2026-11-01'), 'm-top')]).toEqual([['m-top', 'm-left'], false]);
    const off = mountA({ shadow: false, titleBar: false }).querySelector<HTMLElement>('.calendar')!;
    expect([has(off, 'shadow'), off.querySelector<HTMLElement>('.app-head')!.hidden]).toEqual([false, true]);
  });
});
describe('웹(아이폰 화면)의 음력과 공휴일', () => {
  function mountWeb(today: string, days: Record<string, DayValue> = {}) {
    const root = document.createElement('div');
    const month = today.slice(0, 7);
    const store = { current: () => month, show: vi.fn(), days: (m: string) => (m === month ? days : {}), onChange: () => () => {}, readProblem: () => null } as unknown as CalendarStore;
    mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => today, onOpenDay: vi.fn(), onOpenSettings: vi.fn() });
    return root;
  }
  const texts = (el: Element, selector: string) => [...el.querySelectorAll(selector)].map((x) => x.textContent);
  afterEach(() => vi.restoreAllMocks());

  it('칸마다 음력을 짧게 적고, 공휴일과 대체공휴일은 빨간 날로 표시하고 이름을 적는다', () => {
    const root = mountWeb('2026-10-01');
    const of = (key: string) => {
      const c = cell(root, key);
      return [has(c, 'holiday'), texts(c, '.hname'), texts(c, '.lunar')];
    };
    // 10/3 개천절(토), 10/5 그 대체공휴일(월), 10/6 평일, 10/9 한글날
    expect([of('2026-10-03'), of('2026-10-05'), of('2026-10-06'), of('2026-10-09')]).toEqual([
      [true, ['개천절'], ['8.23']],
      [true, ['대체공휴일'], ['8.25']],
      [false, [], ['8.26']],
      [true, ['한글날'], ['8.29']],
    ]);
  });
  it('윤달은 윤을 붙이고, 음력 표 밖의 해는 음력을 적지 않는다', () => {
    expect(texts(cell(mountWeb('2025-07-25'), '2025-07-25'), '.lunar')).toEqual(['윤6.1']);
    const far = mountWeb('2060-08-15');
    expect([texts(cell(far, '2060-08-15'), '.lunar'), texts(cell(far, '2060-08-15'), '.hname')]).toEqual([[], ['광복절']]);
  });
  it('음력이 칸보다 넓으면 그 쪽의 음력을 모두 좁은 꼴로 바꾸고, 그래도 넘치는 칸은 숨긴다(앞쪽이 잘린 채 보이지 않게)', () => {
    // 가짜 폭: 음력 상자는 boxWidth, 글은 글자마다 5.5(좁은 꼴에서는 4.5)다.
    const fake = (boxWidth: number): void => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { width: this.classList.contains('lunar') ? boxWidth : 0 } as DOMRect;
      });
      vi.spyOn(document, 'createRange').mockImplementation(() => {
        let el: Element | null = null;
        return {
          selectNodeContents: (node: Element) => void (el = node),
          getBoundingClientRect: () => ({ width: (el?.textContent?.length ?? 0) * (el?.closest('.lunar-tight') ? 4.5 : 5.5) }) as DOMRect,
        } as unknown as Range;
      });
    };
    const state = (root: HTMLElement) => {
      const grid = root.querySelector<HTMLElement>('.grid.current')!;
      return [has(grid, 'lunar-tight'), texts(grid, '.lunar.hidden')];
    };
    // 넉넉한 칸: 그대로다.
    fake(40);
    expect(state(mountWeb('2026-11-13'))).toEqual([false, []]);
    vi.restoreAllMocks();
    // 다섯 글자('10.15')가 넘치는 칸: 좁은 꼴이면 모두 들어간다.
    fake(25);
    expect(state(mountWeb('2026-11-13'))).toEqual([true, []]);
    vi.restoreAllMocks();
    // 더 좁은 칸: 좁은 꼴로도 다섯 글자는 넘쳐서 숨기고, 네 글자는 보인다. 2026년 11월의 쪽은 음력 9.22부터 10.27까지다.
    fake(20);
    const [tight, hidden] = state(mountWeb('2026-11-13')) as [boolean, string[]];
    expect([tight, hidden[0], hidden.at(-1), hidden.length, hidden.every((t) => t.length === 5)]).toEqual([true, '10.10', '10.27', 18, true]);
  });
  it('공휴일 이름이 한 줄을 쓰므로 그 칸은 메모를 한 줄 덜 보여 준다', () => {
    // 넓은 화면(happy-dom의 기본 폭): 줄 높이 17, 숫자 자리 30, 이름 줄 16. 칸 높이 115면 평일 5줄, 공휴일 4줄이다.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(115);
    const six = { text: ['a', 'b', 'c', 'd', 'e', 'f'].join('\n'), color: '' };
    const root = mountWeb('2026-10-01', { '05': six, '06': six });
    expect([texts(cell(root, '2026-10-05'), '.ln'), texts(cell(root, '2026-10-06'), '.ln')]).toEqual([
      ['a', 'b', 'c', '+3'],
      ['a', 'b', 'c', 'd', '+2'],
    ]);
  });
});
describe('웹앱의 설정(모양은 웹, 동작은 설정)', () => {
  const eight = { text: ['[+]a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n'), color: '' };
  function mountPrefs(a: Partial<Appearance>, web: WebLook = { memoSize: 'medium' }) {
    const root = document.createElement('div');
    const store = fakeStore({ '13': eight });
    const handle = mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay: vi.fn(), onOpenSettings: vi.fn(), appearance: { ...WEB_APPEARANCE, ...a }, web });
    return { root, handle, cal: root.querySelector<HTMLElement>('.calendar')! };
  }
  const lines = (root: HTMLElement) => [...cell(root, '2026-11-13').querySelectorAll('.ln')].map((l) => l.textContent);
  afterEach(() => vi.restoreAllMocks());

  it('설정을 줘도 웹 모양이다: 음력은 짧게 적고 PC 앱의 색 변수를 걸지 않는다', () => {
    const { root, cal } = mountPrefs({});
    expect([cell(root, '2026-11-13').querySelector('.lunar')!.textContent, cal.style.getPropertyValue('--desk-cal-ink'), cells(root).length]).toEqual(['10.5', '', 35]);
  });
  it('시작 요일, 주 번호, 음력과 공휴일 끄기, 완료한 줄, 줄 머리 기호를 따른다', () => {
    const { root, cal } = mountPrefs({ weekStart: 1, weekNumbers: true, lunar: false, holidays: false, showDone: false, bullet: 'dot' });
    expect([root.querySelector('.dow span:nth-child(2)')!.textContent, root.querySelectorAll('.grid.current .wk').length > 0, root.querySelector('.lunar'), cal.dataset.bullet]).toEqual(['월', true, null, 'dot']);
    expect(lines(root)).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(lines(mountPrefs({ doneToBottom: true }).root).at(-1)).toBe('a');
  });
  it('글자 크기에 따라 줄 높이와 보이는 줄 수가 달라진다', () => {
    // 넓은 화면(happy-dom의 기본 폭)에서 칸 높이 115: 작게는 줄 높이 15라 5줄, 크게는 20이라 4줄이 들어간다.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(115);
    const small = mountPrefs({}, { memoSize: 'small' });
    const large = mountPrefs({}, { memoSize: 'large' });
    expect([small.cal.style.getPropertyValue('--memo-size'), small.cal.style.getPropertyValue('--memo-line'), lines(small.root)]).toEqual(['12px', '15px', ['a', 'b', 'c', 'd', '+4']]);
    expect([large.cal.style.getPropertyValue('--memo-size'), large.cal.style.getPropertyValue('--memo-line'), lines(large.root)]).toEqual(['15px', '20px', ['a', 'b', 'c', '+5']]);
  });
  it('열어 둔 채로 설정과 글자 크기를 바꾼다', () => {
    const { root, handle, cal } = mountPrefs({});
    handle.setAppearance({ ...WEB_APPEARANCE, lunar: false, weekStart: 1 }, { memoSize: 'large' });
    expect([root.querySelector('.lunar'), root.querySelector('.dow span')!.textContent, cal.style.getPropertyValue('--memo-size'), cal.style.getPropertyValue('--desk-cal-ink')]).toEqual([null, '월', '15px', '']);
    // 글자 크기를 주지 않으면 그대로 둔다.
    handle.setAppearance({ ...WEB_APPEARANCE, lunar: true });
    expect([cell(root, '2026-11-13').querySelector('.lunar')!.textContent, cal.style.getPropertyValue('--memo-size')]).toEqual(['10.5', '15px']);
  });
});
describe('구독과 날짜 열기', () => {
  function mountS(a: Partial<Appearance> | undefined) {
    const root = document.createElement('div');
    let month = '2026-11';
    const subscribed = new Set<string>();
    const store = {
      current: () => month,
      show: vi.fn((m: string, also: string[] = []) => {
        month = m;
        subscribed.clear();
        for (const x of [shiftMonth(m, -1), m, shiftMonth(m, 1), ...also]) subscribed.add(x);
      }),
      covers: (m: string) => subscribed.has(m),
      days: () => ({}),
      onChange: () => () => {},
      readProblem: () => null,
    } as unknown as CalendarStore & { show: ReturnType<typeof vi.fn> };
    store.show('2026-11');
    store.show.mockClear();
    const handle = mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay: vi.fn(), onOpenSettings: vi.fn(), appearance: a && { ...DEFAULT_APPEARANCE, ...a } });
    return { root, store, handle, subscribed };
  }
  const title = (root: HTMLElement) => root.querySelector('.month')!.textContent;
  // 8주 쪽: 지금 쪽 11/8~1/2, 앞 쪽 9/13~11/7, 뒤 쪽 1/3~2/27
  it('여러 달에 걸친 쪽은 앞뒤 한 달 밖의 달을 더해서 구독한다', () => {
    const { store } = mountS({ layout: 'floating', maxRows: 8, pastWeeks: 0 });
    expect(store.show).toHaveBeenLastCalledWith('2026-11', ['2026-09', '2027-01', '2027-02']);
  });
  it('쪽이 바뀌면 앞 쪽이 더한 달을 정리한다', () => {
    const { handle, subscribed } = mountS({ layout: 'floating', maxRows: 8, pastWeeks: 0 });
    expect(subscribed.has('2027-02')).toBe(true);
    // 전체 월: 10월(9/27~10/31), 11월(11/1~12/5), 12월(11/29~1/2) 쪽. 2027-02는 어느 쪽에도 없다.
    handle.setAppearance({ ...DEFAULT_APPEARANCE, layout: 'month' });
    expect([...subscribed].sort()).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
  });
  it('전체 월은 다른 달의 날짜를 열면 그 달로 넘어간다', () => {
    const { root, store, handle } = mountS(undefined);
    store.show.mockClear();
    handle.showMonth('2026-12');
    expect([store.current(), title(root)]).toEqual(['2026-12', '12월']);
    expect(store.show.mock.calls).toEqual([['2026-12', ['2026-10', '2027-02']]]); // 한 번, 앞뒤 두 달과 함께
  });
  it('전체 월에서 보이는 달의 날짜를 열면 쪽을 다시 그리지 않는다', () => {
    const { root, store, handle } = mountS(undefined);
    const day = cell(root, '2026-11-20');
    store.show.mockClear();
    handle.showMonth('2026-11'); // 여는 쪽(main.ts)이 이어서 store.refresh()로 다시 그린다
    expect([cell(root, '2026-11-20'), store.show.mock.calls.length, title(root)]).toEqual([day, 0, '11월']);
  });
  it('다른 배치는 보이는 쪽에 있는 날짜를 열어도 쪽을 바꾸지 않는다', () => {
    const { root, store, handle } = mountS({ layout: 'floating' });
    handle.showMonth('2026-12'); // 쪽은 11월 1일부터 12월 5일까지
    expect([store.current(), title(root)]).toEqual(['2026-11', '11월']);
    handle.showMonth('2027-06');
    expect([store.current(), title(root)]).toEqual(['2027-06', '6월']);
  });
});
it('PC 앱에서는 두 번 눌러야 열고, 오른쪽 클릭은 칸 메뉴, 메뉴 단추는 앱 메뉴', () => {
  const root = document.createElement('div');
  const onOpenDay = vi.fn(), onDayMenu = vi.fn(), onOpenMenu = vi.fn();
  mountCalendar(root, { store: fakeStore({}), status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn(), appearance: DEFAULT_APPEARANCE, desktop: { onDayMenu, onOpenMenu } });
  const day = cell(root, '2026-11-20');
  day.click();
  expect(onOpenDay).not.toHaveBeenCalled();
  day.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(onOpenDay).toHaveBeenCalledWith('2026-11-20');
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
  day.dispatchEvent(ev);
  expect([ev.defaultPrevented, onDayMenu.mock.calls[0], root.querySelector('[aria-label="설정"]')]).toEqual([true, ['2026-11-20', { x: 40, y: 50 }], null]);
  root.querySelector('[aria-label="메뉴"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 600, clientY: 20 }));
  expect(onOpenMenu).toHaveBeenCalledWith({ x: 600, y: 20 });
});
it('덮여 있지 않은 달을 열면 쪽의 여분 달도 구독한다', () => {
  const root = document.createElement('div');
  let month = '2026-11';
  const subscribed = new Set<string>();
  const store = {
    current: () => month,
    show: vi.fn((m: string, also: string[] = []) => {
      month = m;
      subscribed.clear();
      for (const x of [shiftMonth(m, -1), m, shiftMonth(m, 1), ...also]) subscribed.add(x);
    }),
    covers: (m: string) => subscribed.has(m),
    days: () => ({}),
    onChange: () => () => {},
    readProblem: () => null,
  } as unknown as CalendarStore & { show: ReturnType<typeof vi.fn> };
  const handle = mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay: vi.fn(), onOpenSettings: vi.fn(), appearance: { ...DEFAULT_APPEARANCE, layout: 'floating', maxRows: 8, pastWeeks: 0 } });
  handle.showMonth('2027-06');
  // 오늘의 달: 쪽은 오늘 주부터 시작해 2027-01까지 가고, 옆 쪽은 9/13~11/7과 1/3~2/27이다.
  handle.showMonth('2026-11');
  expect([store.show.mock.lastCall, subscribed.has('2027-01')]).toEqual([['2026-11', ['2026-09', '2027-01', '2027-02']], true]);
});

describe('년도와 월 고르기', () => {
  function pickMount(opts: { desktop?: boolean; layout?: Appearance['layout'] } = {}) {
    const root = document.createElement('div');
    document.body.append(root);
    const store = fakeStore({});
    const onOpenDay = vi.fn();
    const appearance = opts.desktop || opts.layout ? { ...DEFAULT_APPEARANCE, layout: opts.layout ?? ('month' as const) } : undefined;
    const handle = mountCalendar(
      root,
      {
        store,
        status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} },
        today: () => '2026-11-13',
        onOpenDay,
        onOpenSettings: vi.fn(),
        ...(appearance ? { appearance } : {}),
        ...(opts.desktop ? { desktop: { onDayMenu: vi.fn(), onOpenMenu: vi.fn() } } : {}),
      },
      { reducedMotion: () => false, pager: { width: () => 400 } },
    );
    const yearBtn = root.querySelector<HTMLButtonElement>('.year')!;
    const monthBtn = root.querySelector<HTMLButtonElement>('.month .title-btn')!;
    const head = () => `${root.querySelector('.year')!.textContent} ${root.querySelector('.month')!.textContent}`;
    const item = (text: string) => [...root.querySelectorAll<HTMLButtonElement>('.datepick-item')].find((b) => b.textContent === text)!;
    return { root, store, onOpenDay, handle, yearBtn, monthBtn, head, item };
  }
  afterEach(() => document.body.replaceChildren());

  it('년도와 월은 고르는 상자를 여는 단추이고, 글자는 그대로 2026년과 11월이다', () => {
    const { yearBtn, monthBtn, head } = pickMount();
    expect(head()).toBe('2026년 11월');
    expect([yearBtn.tagName, yearBtn.getAttribute('aria-haspopup'), yearBtn.getAttribute('aria-expanded'), yearBtn.title]).toEqual(['BUTTON', 'dialog', 'false', '연도 선택']);
    expect([monthBtn.closest('h2') !== null, monthBtn.getAttribute('aria-haspopup'), monthBtn.title]).toEqual([true, 'dialog', '월 선택']);
  });
  it('년도를 누르고 고르면 같은 달의 그해로 바로 가고 상자가 닫힌다', () => {
    const { root, yearBtn, head, item, store } = pickMount();
    yearBtn.click();
    expect([root.querySelector('.datepick')!.getAttribute('aria-label'), yearBtn.getAttribute('aria-expanded'), item('2026').getAttribute('aria-current')]).toEqual(['연도 선택', 'true', 'true']);
    // 상자가 열린 동안 뒤의 달력은 inert다
    expect(root.querySelector('.calendar')!.hasAttribute('inert')).toBe(true);
    item('2030').click();
    expect([head(), root.querySelector('.datepick'), yearBtn.getAttribute('aria-expanded'), store.show.mock.lastCall![0], root.querySelector('.calendar')!.hasAttribute('inert')]).toEqual(['2030년 11월', null, 'false', '2030-11', false]);
  });
  it('월을 누르고 고르면 같은 해의 그달로 가고, 오늘이 든 달로 돌아오면 오늘에 선다', () => {
    const { monthBtn, head, item, store } = pickMount();
    monthBtn.click();
    item('3월').click();
    expect([head(), store.show.mock.lastCall![0]]).toEqual(['2026년 3월', '2026-03']);
    monthBtn.click();
    item('11월').click();
    expect(head()).toBe('2026년 11월');
  });
  it('바깥을 누르면 닫히기만 하고, 다른 쪽으로 넘어가면 닫히며 초점은 누른 단추로 돌아온다', () => {
    const { root, yearBtn, head, onOpenDay } = pickMount();
    yearBtn.click();
    expect(document.activeElement?.classList.contains('datepick-item')).toBe(true);
    root.querySelector<HTMLElement>('.datepick-scrim')!.click();
    expect([root.querySelector('.datepick'), head(), onOpenDay.mock.calls.length, document.activeElement]).toEqual([null, '2026년 11월', 0, yearBtn]);
    yearBtn.click();
    root.querySelector<HTMLButtonElement>('[aria-label="다음 달"]')!.click(); // 덮개가 막고 있지 않은 경로(키보드 등)로 쪽이 바뀌는 경우
    const pager = root.querySelector<HTMLElement>('.pager')!;
    pager.scrollLeft = 1201 * 400;
    pager.dispatchEvent(new Event('scroll'));
    expect(root.querySelector('.datepick')).toBeNull();
  });
  it('PC 앱에서도 같고, 변동 월 배치에서는 그달의 1일이 든 주부터 보인다', () => {
    const desk = pickMount({ desktop: true });
    desk.monthBtn.click();
    desk.item('1월').click();
    expect(desk.head()).toBe('2026년 1월');
    desk.yearBtn.click();
    desk.item('2027').click();
    expect(desk.head()).toBe('2027년 1월');
    const floating = pickMount({ layout: 'floating' });
    floating.monthBtn.click();
    floating.item('2월').click();
    expect([floating.head(), floating.root.querySelector('.grid.current .cell')!.getAttribute('data-key')]).toEqual(['2026년 2월', '2026-01-25']);
    // 주 배치에서 그달의 가운데를 보다가 지금 달을 다시 고르면 그달의 처음(오늘이 든 달이면 오늘)으로 간다
    const week = pickMount({ layout: 'week' });
    const weekPager = week.root.querySelector<HTMLElement>('.pager')!;
    weekPager.scrollLeft = 1201 * 400; // 다음 주로 넘긴다(브라우저의 스크롤 대신 위치와 scroll 이벤트로)
    weekPager.dispatchEvent(new Event('scroll'));
    const firstBefore = week.root.querySelector('.grid.current .cell')!.getAttribute('data-key');
    week.monthBtn.click();
    week.item('11월').click();
    expect([firstBefore, week.head(), week.root.querySelector('.grid.current .cell')!.getAttribute('data-key')]).toEqual(['2026-11-15', '2026년 11월', '2026-11-08']);
  });
  it('달력을 내리면 열린 상자도 치운다', () => {
    const { root, yearBtn, handle } = pickMount();
    yearBtn.click();
    handle.destroy();
    expect([root.querySelector('.datepick'), root.querySelector('.datepick-scrim')]).toEqual([null, null]);
  });
});

describe('다시 그리기를 줄인다', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setOfficialHolidays(null);
  });
  function emitterMount() {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100); // 칸 높이를 잰 것으로 친다
    const months = new Map<string, Record<string, DayValue>>();
    const listeners = new Set<() => void>();
    const store = {
      current: () => '2026-11',
      show: vi.fn(),
      days: (m: string) => months.get(m) ?? {},
      onChange: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      readProblem: () => null,
    } as unknown as CalendarStore;
    const root = document.createElement('div');
    document.body.append(root);
    const handle = mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay: vi.fn(), onOpenSettings: vi.fn() }, { pager: { width: () => 400 } });
    const emit = () => listeners.forEach((fn) => fn());
    // 세 쪽(10월, 11월, 12월)에서 각 쪽의 첫 칸. 다시 그리면 새 요소로 바뀐다.
    const firsts = () => [...root.querySelectorAll<HTMLElement>('.grid')].map((g) => g.querySelector('.cell'));
    return { root, months, emit, firsts, handle };
  }

  it('내용이 그대로면 다시 그리라는 알림이 와도 쪽을 다시 만들지 않고, 바뀐 달이 보이는 쪽만 다시 그린다', () => {
    const { months, emit, firsts } = emitterMount();
    const before = firsts();
    emit();
    expect(firsts()).toEqual(before); // 같은 요소 그대로
    expect(firsts().every((c, i) => c === before[i])).toBe(true);
    // 2027년 1월은 12월 쪽의 끝(1월 1~2일)에만 보인다
    months.set('2027-01', { '01': { text: '새해', color: '' } });
    emit();
    const after = firsts();
    expect([after[0] === before[0], after[1] === before[1], after[2] === before[2]]).toEqual([true, true, false]);
  });
  it('공휴일 자료가 바뀌거나 창 크기가 바뀌면 모든 쪽을 다시 그린다', () => {
    const { emit, firsts } = emitterMount();
    const before = firsts();
    setOfficialHolidays({ 2026: { days: [{ date: '2026-11-20', name: '임시공휴일' }] } });
    emit();
    const afterHolidays = firsts();
    expect(afterHolidays.some((c, i) => c === before[i])).toBe(false);
    window.dispatchEvent(new Event('resize'));
    expect(firsts().some((c, i) => c === afterHolidays[i])).toBe(false);
  });
  it('달력의 높이만 바뀌어도(창 크기 알림 없이) 칸 크기를 다시 재서 그린다', () => {
    let observe: ((entries: unknown[]) => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: (entries: unknown[]) => void) {
          observe = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      let pagerHeight = 500;
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('pager') ? pagerHeight : 100;
      });
      const months = new Map<string, Record<string, DayValue>>();
      const store = { current: () => '2026-11', show: vi.fn(), days: (m: string) => months.get(m) ?? {}, onChange: () => () => {}, readProblem: () => null } as unknown as CalendarStore;
      const root = document.createElement('div');
      document.body.append(root);
      mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay: vi.fn(), onOpenSettings: vi.fn() }, { pager: { width: () => 400 } });
      const firsts = () => [...root.querySelectorAll<HTMLElement>('.grid')].map((g) => g.querySelector('.cell'));
      observe!([]); // 처음 알림은 높이를 적어 두기만 한다
      const before = firsts();
      observe!([]);
      expect(firsts().every((c, i) => c === before[i])).toBe(true); // 높이가 같으면 그대로
      pagerHeight = 460;
      observe!([]);
      expect(firsts().some((c, i) => c === before[i])).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
