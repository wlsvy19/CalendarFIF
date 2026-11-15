import { afterEach, expect, it, vi } from 'vitest';
import { playTone } from '../tones';
import type { DayValue } from '../../core/types';
import { mountEditor } from './editor';
import { swipeDown } from './fakeSwipe';
import type { EventMap, EventRecord } from '../../core/events';

vi.mock('../tones', () => ({ playTone: vi.fn() }));

// 열어 둔 채 끝난 색 상자가 document에 건 키 처리가 다음 시험의 Esc를 가로채지 않게 바깥을 눌러 닫는다.
afterEach(() => {
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
});

function mount(value: DayValue, extra: Record<string, unknown> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSave = vi.fn();
  const onCancel = vi.fn();
  mountEditor(root, { dateKey: '2026-11-13', value, onSave, onCancel, ...extra });
  const area = root.querySelector<HTMLTextAreaElement>('textarea')!;
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
  /** 배경 도구를 눌러 색 상자를 열고 color를 고른다. */
  const pick = (color: string) => {
    root.querySelector<HTMLElement>('button.tool.color')!.click();
    root.querySelector<HTMLElement>(`[role="radio"][data-color="${color}"]`)!.click();
  };
  return { root, area, button, onSave, onCancel, pick };
}

const alarm = (date: string, text: string, time: string): EventRecord => ({
  type: 'alarm', date, text, done: false, repeat: { freq: 'none' }, time, advance: [0], editedAt: 1, editedBy: 'u',
});
const countdown = (date: string, text: string): EventRecord => ({
  type: 'countdown', date, text, done: false, repeat: { freq: 'none' }, kind: 'basic', showBottom: true, editedAt: 1, editedBy: 'u',
});
/** 메모리 안의 EventsView와 save/remove. */
function eventsProp(initial: EventMap = {}) {
  let items = { ...initial };
  const listeners = new Set<() => void>();
  const fire = () => listeners.forEach((fn) => fn());
  const view = {
    items: () => items,
    version: () => 0,
    onChange: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const save = vi.fn((id: string, rec: EventRecord) => {
    items = { ...items, [id]: rec };
    fire();
  });
  const remove = vi.fn((id: string) => {
    const { [id]: _gone, ...rest } = items;
    items = rest;
    fire();
  });
  return { view, save, remove, iosHint: false, now: () => new Date(2026, 10, 13, 12, 0) };
}

it('날짜와 저장된 값을 보여 준다', () => {
  const { root, area } = mount({ text: 'a\n[+]b', color: 'F12424' });
  expect(root.textContent).toContain('11월 13일 금요일');
  expect(area.value).toBe('a\n[+]b');
  expect(root.querySelector('.swatches, .donebtn')).toBeNull();
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(0); // 색 상자는 누를 때 뜬다
  root.querySelector<HTMLElement>('button.tool.color')!.click();
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(23);
  expect(root.querySelector('[role="radio"][aria-checked="true"]')!.getAttribute('data-color')).toBe('F12424');
});
it('팔레트에 없는 색은 단추를 하나 더 둔다', () => {
  const { root } = mount({ text: '', color: 'FF0000' });
  root.querySelector<HTMLElement>('button.tool.color')!.click();
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(24);
  expect(root.querySelector('[role="radio"][aria-checked="true"]')!.getAttribute('data-color')).toBe('FF0000');
});
it('커서가 있는 줄의 완료 표시를 바꾼다', () => {
  const { area, root } = mount({ text: 'a\n[+]b', color: '' });
  area.setSelectionRange(0, 0);
  root.querySelector<HTMLElement>('button.tool.done')!.click();
  expect(area.value).toBe('[+]a\n[+]b');
});
it('완료는 지금 줄을 [+]로 바꾸고 doneTone이 short면 소리를 낸다', () => {
  vi.mocked(playTone).mockClear();
  const quiet = mount({ text: 'a', color: '' }, { doneTone: 'none' });
  quiet.root.querySelector<HTMLElement>('button.tool.done')!.click();
  expect(quiet.area.value).toBe('[+]a');
  expect(playTone).not.toHaveBeenCalled();
  const loud = mount({ text: 'a', color: '' }, { doneTone: 'short' });
  loud.root.querySelector<HTMLElement>('button.tool.done')!.click();
  expect(loud.area.value).toBe('[+]a');
  expect(playTone).toHaveBeenCalledWith('done');
});
it('도구 단추 넷이 있고 알림과 카운트다운은 events가 없으면 숨는다', () => {
  const plain = mount({ text: '', color: '' });
  const tools = plain.root.querySelector('.editor-tools')!;
  expect(tools.getAttribute('role')).toBe('toolbar');
  expect(tools.getAttribute('aria-label')).toBe('편집 도구');
  expect([...tools.querySelectorAll('button.tool')].map((b) => b.textContent!.trim())).toEqual(['완료', '배경', '알림', '카운트다운']);
  expect(tools.querySelector<HTMLElement>('.alarm')!.hidden).toBe(true);
  expect(tools.querySelector<HTMLElement>('.countdown')!.hidden).toBe(true);
  expect(tools.querySelector<HTMLElement>('.done')!.hidden).toBe(false);
  const full = mount({ text: '', color: '' }, { events: eventsProp() });
  expect(full.root.querySelector<HTMLElement>('button.tool.alarm')!.hidden).toBe(false);
  expect(full.root.querySelector<HTMLElement>('button.tool.countdown')!.hidden).toBe(false);
});
it('events가 없으면 알림·카운트다운 단추와 띠가 없다', () => {
  const { root } = mount({ text: '', color: '' });
  expect(root.querySelector<HTMLElement>('.ev-strip')!.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>('button.tool.alarm')!.hidden).toBe(true);
  root.querySelector<HTMLElement>('button.tool.alarm')!.click();
  expect(root.querySelector('.event-sheet')).toBeNull();
});
it('그날의 알림과 카운트다운이 띠에 칩으로 보이고 누르면 시트가 열린다', () => {
  const ev = eventsProp({ a1: alarm('2026-11-13', '약', '09:30'), c1: countdown('2026-11-13', '시험'), other: alarm('2026-11-14', '다른날', '10:00') });
  const { root } = mount({ text: '', color: '' }, { events: ev });
  const chips = [...root.querySelectorAll<HTMLElement>('.ev-strip button.ev-chip')];
  expect(root.querySelector<HTMLElement>('.ev-strip')!.hidden).toBe(false);
  expect(chips.map((c) => c.textContent)).toEqual(['09:30 약', '시험 오늘']);
  chips[0].click();
  const sheet = root.querySelector('.event-sheet')!;
  expect(sheet.querySelector('h3')!.textContent).toBe('알림 편집');
  expect(sheet.querySelector<HTMLInputElement>('input.ev-text')!.value).toBe('약');
  expect(sheet.closest('.sheet:not(.event-sheet)')).toBeNull(); // 편집 화면 안이 아니라 root에 뜬다
});
it('알림을 저장하면 save가 불리고 띠가 다시 그려진다', () => {
  const ev = eventsProp();
  const { root, area } = mount({ text: '', color: '' }, { events: ev });
  area.value = '병원' + String.fromCharCode(10) + '둘째 줄';
  root.querySelector<HTMLElement>('button.tool.alarm')!.click();
  const text = root.querySelector<HTMLInputElement>('.event-sheet input.ev-text')!;
  expect(text.value).toBe('');
  const save = [...root.querySelectorAll<HTMLElement>('.event-sheet button')].find((b) => b.textContent === '저장')!;
  save.click(); // 비면 메모 첫 줄
  expect(ev.save).toHaveBeenCalledTimes(1);
  expect(ev.save.mock.calls[0][1]).toMatchObject({ type: 'alarm', date: '2026-11-13', text: '병원' });
  expect(root.querySelector('.event-sheet')).toBeNull();
  const chips = [...root.querySelectorAll('.ev-strip button.ev-chip')];
  expect(chips).toHaveLength(1);
  expect(chips[0].textContent).toMatch(/^\d\d:\d\d 병원$/);
  expect(document.activeElement).toBe(area);
});
it('편집 화면을 취소해도 저장한 알림은 남는다(save가 이미 불렸다)', () => {
  const ev = eventsProp();
  const { root, area, button, onCancel } = mount({ text: '', color: '' }, { events: ev });
  area.value = 'x';
  root.querySelector<HTMLElement>('button.tool.countdown')!.click();
  const sheet = root.querySelector('.event-sheet')!;
  sheet.querySelector<HTMLInputElement>('input.ev-text')!.value = '디데이';
  [...sheet.querySelectorAll('button')].find((b) => b.textContent === '저장')!.click();
  expect(ev.save).toHaveBeenCalledTimes(1);
  button('취소').click();
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(ev.save).toHaveBeenCalledTimes(1);
  expect(Object.keys(ev.view.items())).toHaveLength(1);
});
it('시트가 닫히면 넓은 창에서는 메모 칸에, 폰에서는 편집 화면 시트에 초점이 간다', () => {
  const close = (root: HTMLElement) => {
    root.querySelector<HTMLElement>('button.tool.alarm')!.click();
    [...root.querySelectorAll<HTMLElement>('.event-sheet button')].find((b) => b.textContent === '취소')!.click();
  };
  const wide = mount({ text: '', color: '' }, { events: eventsProp() });
  close(wide.root);
  expect(document.activeElement).toBe(wide.area);
  vi.stubGlobal('innerWidth', 600);
  try {
    const narrow = mount({ text: '', color: '' }, { events: eventsProp() });
    close(narrow.root);
    expect(document.activeElement).not.toBe(narrow.area);
    expect(document.activeElement).toBe(narrow.root.querySelector('.sheet:not(.event-sheet)'));
  } finally {
    vi.unstubAllGlobals();
  }
});
it('시트가 열려 있을 때 Esc는 시트만 닫고 편집 화면은 닫지 않는다', () => {
  const { root, onCancel } = mount({ text: '', color: '' }, { events: eventsProp() });
  root.querySelector<HTMLElement>('button.tool.alarm')!.click();
  root.querySelector('.event-sheet input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(root.querySelector('.event-sheet')).toBeNull();
  expect(onCancel).not.toHaveBeenCalled();
});
it('배경을 눌러 색을 고르면 메모 칸 바탕과 점이 그 색이 되고 저장에 들어간다', () => {
  const { root, area, pick, button, onSave } = mount({ text: 'x', color: '' });
  const dot = root.querySelector<HTMLElement>('button.tool.color .dot')!;
  expect(area.dataset.color).toBeUndefined();
  pick('009300');
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(0); // 고르면 상자가 닫힌다
  expect(area.dataset.color).toBe('009300');
  expect(area.style.getPropertyValue('--day-color')).toBe('#009300');
  expect(dot.style.getPropertyValue('--sw')).toBe('#009300');
  button('저장').click();
  expect(onSave).toHaveBeenCalledWith({ text: 'x', color: '009300' });
});
it('색만 바꿔도 바깥 누르기로 닫히지 않는다', () => {
  const { root, pick, onCancel } = mount({ text: 'a', color: '' });
  pick('009300');
  root.querySelector<HTMLElement>('.scrim')!.click();
  expect(onCancel).not.toHaveBeenCalled();
});
it('색 상자가 열린 동안 Esc는 상자만 닫고 편집 화면은 닫지 않는다', () => {
  const { root, onCancel } = mount({ text: 'a', color: '' });
  root.querySelector<HTMLElement>('button.tool.color')!.click();
  root.querySelector<HTMLElement>('[role="radio"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(0);
  expect(onCancel).not.toHaveBeenCalled();
});
it('저장하면 다듬은 글과 고른 색을 넘긴다', () => {
  const { area, button, onSave, onCancel, pick } = mount({ text: '', color: '' });
  area.value = 'x  \r\n\r\n';
  pick('009300');
  button('저장').click();
  expect(onSave).toHaveBeenCalledWith({ text: 'x', color: '009300' });
  expect(onCancel).not.toHaveBeenCalled();
});
it('취소와 Esc는 저장하지 않는다', () => {
  const first = mount({ text: 'a', color: '' });
  first.area.value = 'changed';
  first.button('취소').click();
  expect(first.onCancel).toHaveBeenCalledTimes(1);
  expect(first.onSave).not.toHaveBeenCalled();
  const second = mount({ text: 'a', color: '' });
  second.area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(second.onCancel).toHaveBeenCalledTimes(1);
});
it('저장과 취소는 한 번만 전달된다', () => {
  const saved = mount({ text: 'a', color: '' });
  saved.button('저장').click();
  saved.button('저장').click();
  saved.button('취소').click();
  expect(saved.onSave).toHaveBeenCalledTimes(1);
  expect(saved.onCancel).not.toHaveBeenCalled();
  const cancelled = mount({ text: 'a', color: '' });
  cancelled.area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  cancelled.button('취소').click();
  cancelled.button('저장').click();
  expect(cancelled.onCancel).toHaveBeenCalledTimes(1);
  expect(cancelled.onSave).not.toHaveBeenCalled();
});
it('한글 조합 중에는 Esc와 Ctrl+Enter를 무시한다', () => {
  const { area, onSave, onCancel } = mount({ text: 'a', color: '' });
  area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
  area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, isComposing: true }));
  expect(onCancel).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});
it('바깥을 누르면 고친 것이 없을 때만 닫는다', () => {
  const typed = mount({ text: 'a', color: '' });
  typed.area.value = 'a\nb';
  typed.root.querySelector<HTMLElement>('.scrim')!.click();
  expect(typed.onCancel).not.toHaveBeenCalled();
  const recoloured = mount({ text: 'a', color: '' });
  recoloured.pick('009300');
  recoloured.root.querySelector<HTMLElement>('.scrim')!.click();
  expect(recoloured.onCancel).not.toHaveBeenCalled();
  const untouched = mount({ text: 'a', color: 'F12424' });
  untouched.root.querySelector<HTMLElement>('.scrim')!.click();
  expect(untouched.onCancel).toHaveBeenCalledTimes(1);
});
it('폰 화면에서 아래로 끌어 닫으면 고친 것이 있을 때 저장하고 없으면 취소한다', () => {
  const untouched = mount({ text: 'a', color: 'F12424' });
  swipeDown(untouched.root.querySelector('.sheet-bar h3')!);
  expect(untouched.onCancel).toHaveBeenCalledTimes(1);
  expect(untouched.onSave).not.toHaveBeenCalled();
  const typed = mount({ text: 'a', color: '' });
  typed.area.value = 'a\nb  ';
  swipeDown(typed.root.querySelector('.sheet-bar h3')!);
  expect(typed.onSave).toHaveBeenCalledWith({ text: 'a\nb', color: '' });
  expect(typed.onCancel).not.toHaveBeenCalled();
  const recoloured = mount({ text: 'a', color: '' });
  recoloured.pick('009300');
  swipeDown(recoloured.area);
  expect(recoloured.onSave).toHaveBeenCalledWith({ text: 'a', color: '009300' });
});
it('끌어 닫은 뒤에 저장 단추가 눌려도 한 번만 전달된다', () => {
  const { root, area, button, onSave, onCancel } = mount({ text: '', color: '' });
  area.value = 'x';
  swipeDown(root.querySelector('.sheet-bar h3')!);
  button('저장').click();
  button('취소').click();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});
it('PC 앱(html.desk)에서는 끌어도 닫히지 않는다', () => {
  document.documentElement.classList.add('desk');
  const { root, onCancel } = mount({ text: '', color: '' });
  swipeDown(root.querySelector('.sheet-bar h3')!);
  expect(onCancel).not.toHaveBeenCalled();
  expect(root.querySelector<HTMLElement>('.sheet')!.style.transform).toBe('');
  document.documentElement.classList.remove('desk');
});
it('보이는 영역의 높이와 위치를 편집 화면에 넘긴다', () => {
  const listeners = new Map<string, Set<() => void>>();
  const viewport = {
    height: 500,
    offsetTop: 0,
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
  };
  const fire = (type: string) => { for (const fn of listeners.get(type) ?? []) fn(); };
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountEditor(root, { dateKey: '2026-11-13', value: { text: '', color: '' }, onSave: vi.fn(), onCancel: vi.fn() }, { visualViewport: viewport });
  const sheet = root.querySelector<HTMLElement>('.sheet')!;
  expect(sheet.style.getPropertyValue('--vv-height')).toBe('500px');
  expect(sheet.style.getPropertyValue('--vv-top')).toBe('0px');
  viewport.height = 300;
  fire('resize');
  expect(sheet.style.getPropertyValue('--vv-height')).toBe('300px');
  viewport.offsetTop = 40;
  fire('scroll');
  expect(sheet.style.getPropertyValue('--vv-top')).toBe('40px');
  handle.destroy();
  expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
});
it('PC 앱에서는 창이 좁아도 메모 칸에 바로 입력한다', () => {
  vi.stubGlobal('innerWidth', 600);
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountEditor(root, { dateKey: '2026-11-13', value: { text: '가', color: '' }, onSave: vi.fn(), onCancel: vi.fn() }, { visualViewport: null, focusText: true });
  expect(document.activeElement).toBe(root.querySelector('textarea'));
  handle.destroy();
  vi.unstubAllGlobals();
});
it('끌기 연결 함수를 받았을 때만(PC 앱) 시트와 제목 줄을 넘겨 부르고, destroy에서 끝낸다', () => {
  const { root } = mount({ text: '', color: '' });
  expect(root.querySelector('.sheet-bar')!.classList.contains('drag-handle')).toBe(false);
  const pc = document.createElement('div');
  document.body.append(pc);
  const end = vi.fn();
  const attachDrag = vi.fn(() => ({ destroy: end }));
  const handle = mountEditor(pc, { dateKey: '2026-11-13', value: { text: '', color: '' }, onSave: () => {}, onCancel: () => {} }, { attachDrag });
  expect(attachDrag).toHaveBeenCalledWith(pc.querySelector('.sheet'), pc.querySelector('.sheet-bar'));
  handle.destroy();
  expect(end).toHaveBeenCalled();
});

it('제목 아래에 그날의 음력과 공휴일 이름을 적는다. 둘 다 없으면 줄을 숨긴다', () => {
  const noteOf = (note?: { lunar: string; holiday: string }) => {
    const root = document.createElement('div');
    document.body.append(root);
    mountEditor(root, { dateKey: '2026-10-05', value: { text: '', color: '' }, note, onSave: vi.fn(), onCancel: vi.fn() });
    const el = root.querySelector<HTMLElement>('.sheet-note')!;
    return [el.hidden, [...el.children].map((c) => [c.className, c.textContent])];
  };
  expect(noteOf({ lunar: '음력 8월 25일', holiday: '대체공휴일' })).toEqual([false, [['note-lunar', '음력 8월 25일'], ['note-holiday', '대체공휴일']]]);
  expect(noteOf({ lunar: '', holiday: '대체공휴일' })).toEqual([false, [['note-holiday', '대체공휴일']]]);
  expect(noteOf({ lunar: '음력 8월 25일', holiday: '' })).toEqual([false, [['note-lunar', '음력 8월 25일']]]);
  expect(noteOf({ lunar: '', holiday: '' })).toEqual([true, []]);
  expect(noteOf()).toEqual([true, []]);
});
it('Space로 색을 골라도 상자가 다시 열리지 않는다', () => {
  const { root, area } = mount({ text: 'a', color: '' });
  const colorBtn = root.querySelector<HTMLElement>('button.tool.color')!;
  colorBtn.click();
  const sw = root.querySelector<HTMLElement>('[role="radio"][data-color="009300"]')!;
  sw.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  sw.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  expect(area.dataset.color).toBe('009300');
  colorBtn.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(0);
});
it('색 상자가 열린 채 어두운 바깥을 누르면 상자만 닫히고, 한 번 더 누르면 (고친 것이 없으므로) 편집 화면이 닫힌다', () => {
  const { root, onCancel } = mount({ text: 'a', color: '' });
  root.querySelector<HTMLElement>('button.tool.color')!.click();
  const scrim = root.querySelector<HTMLElement>('.scrim')!;
  const tap = (el: HTMLElement) => {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.click();
  };
  tap(scrim);
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(0);
  expect(onCancel).not.toHaveBeenCalled();
  tap(scrim);
  expect(onCancel).toHaveBeenCalledTimes(1);
});
it('색 상자가 열린 채 다른 도구 단추를 누르면 그 누르기는 상자만 닫는다', () => {
  const { root, area } = mount({ text: 'a', color: '' });
  area.setSelectionRange(0, 0);
  root.querySelector<HTMLElement>('button.tool.color')!.click();
  const done = root.querySelector<HTMLElement>('button.tool.done')!;
  done.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  done.click();
  expect([root.querySelectorAll('[role="radio"]').length, area.value]).toEqual([0, 'a']);
  done.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  done.click();
  expect(area.value).toBe('[+]a');
});
it('close는 끌어 닫기처럼 고친 것이 있으면 저장하고 없으면 취소한다', () => {
  const untouched = document.createElement('div');
  document.body.append(untouched);
  const a = { onSave: vi.fn(), onCancel: vi.fn() };
  mountEditor(untouched, { dateKey: '2026-11-13', value: { text: 'a', color: '' }, ...a }).close();
  expect([a.onSave.mock.calls.length, a.onCancel.mock.calls.length]).toEqual([0, 1]);
  const typed = document.createElement('div');
  document.body.append(typed);
  const b = { onSave: vi.fn(), onCancel: vi.fn() };
  const handle = mountEditor(typed, { dateKey: '2026-11-13', value: { text: 'a', color: '' }, ...b });
  typed.querySelector('textarea')!.value = 'a\nb  ';
  handle.close();
  handle.close(); // 한 번만 전달된다
  expect(b.onSave.mock.calls).toEqual([[{ text: 'a\nb', color: '' }]]);
  expect(b.onCancel).not.toHaveBeenCalled();
});
it('eventSheetOpen은 알림·카운트다운 시트가 열려 있는 동안만 참이다', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountEditor(root, { dateKey: '2026-11-13', value: { text: '', color: '' }, events: eventsProp(), onSave: vi.fn(), onCancel: vi.fn() });
  expect(handle.eventSheetOpen()).toBe(false);
  root.querySelector<HTMLElement>('button.tool.alarm')!.click();
  expect(handle.eventSheetOpen()).toBe(true);
  [...root.querySelectorAll<HTMLElement>('.event-sheet button')].find((b) => b.textContent === '취소')!.click();
  expect(handle.eventSheetOpen()).toBe(false);
  handle.destroy();
});
it('아이폰의 지금 예약은 저장한 뒤 events.flush로 서버가 받기를 기다린다', async () => {
  const ev = { ...eventsProp(), iosHint: true, flush: vi.fn(() => new Promise<void>(() => {})) };
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountEditor(root, { dateKey: '2026-11-13', value: { text: '병원', color: '' }, events: ev, onSave: vi.fn(), onCancel: vi.fn() });
  root.querySelector<HTMLElement>('button.tool.alarm')!.click();
  root.querySelector<HTMLElement>('.event-sheet .ev-schedule')!.click();
  expect(ev.save).toHaveBeenCalledTimes(1);
  expect(ev.save.mock.calls[0][1]).toMatchObject({ type: 'alarm', text: '병원' });
  await vi.waitFor(() => expect(ev.flush).toHaveBeenCalledTimes(1));
  expect(ev.save.mock.invocationCallOrder[0]).toBeLessThan(ev.flush.mock.invocationCallOrder[0]);
  expect(root.querySelector<HTMLButtonElement>('.event-sheet .ev-schedule')!.disabled).toBe(true); // 기다리는 중
  handle.destroy(); // 닫히면 기다리던 것이 끝나도 아무것도 열지 않는다
});
it('바깥을 눌러 색 상자를 닫을 때는 초점을 배경 단추로 옮기지 않는다', () => {
  const { root, area } = mount({ text: 'a', color: '' });
  root.querySelector<HTMLElement>('button.tool.color')!.click();
  area.focus();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(0);
  expect(document.activeElement).toBe(area);
});
