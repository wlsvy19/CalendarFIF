import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_YEAR, MIN_YEAR, mountDatePick, pickPosition, yearPageStart, type DatePickProps } from './datePick';

afterEach(() => {
  document.body.replaceChildren();
});

function open(over: Partial<DatePickProps> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onPick = vi.fn();
  const onClose = vi.fn();
  const handle = mountDatePick(root, { kind: 'year', year: 2026, month: 11, today: '2026-11-15', anchor: { left: 16, top: 40, bottom: 60 }, onPick, onClose, ...over });
  const items = () => [...root.querySelectorAll<HTMLButtonElement>('.datepick-item')];
  const texts = () => items().map((b) => b.textContent);
  const button = (text: string) => items().find((b) => b.textContent === text)!;
  const step = (aria: string) => root.querySelector<HTMLButtonElement>(`.datepick-step[aria-label="${aria}"]`)!;
  return { root, handle, onPick, onClose, items, texts, button, step };
}
const key = (el: Element, k: string, shift = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));

it('12년 쪽은 1900년부터 12년씩 나뉜다', () => {
  expect([yearPageStart(1900), yearPageStart(1911), yearPageStart(1912), yearPageStart(2026), yearPageStart(2031), yearPageStart(2032), yearPageStart(2100)]).toEqual([1900, 1900, 1912, 2020, 2020, 2032, 2092]);
  // 범위 밖은 끝 쪽으로
  expect([yearPageStart(1800), yearPageStart(2500)]).toEqual([1900, 2092]);
});

it('상자는 누른 곳 아래 왼쪽에 놓고, 화면 밖으로 나가지 않게 당기며, 아래가 모자라면 위로 올린다', () => {
  const view = { width: 402, height: 874 };
  expect(pickPosition({ left: 16, top: 40, bottom: 60 }, { width: 288, height: 220 }, view)).toEqual({ left: 16, top: 66 });
  expect(pickPosition({ left: 300, top: 40, bottom: 60 }, { width: 288, height: 220 }, view)).toEqual({ left: 106, top: 66 });
  expect(pickPosition({ left: 2, top: 40, bottom: 60 }, { width: 288, height: 220 }, view)).toEqual({ left: 8, top: 66 });
  expect(pickPosition({ left: 16, top: 800, bottom: 820 }, { width: 288, height: 220 }, view)).toEqual({ left: 16, top: 574 });
  // 위도 아래도 모자라면 화면 아래 끝에 맞춘다
  expect(pickPosition({ left: 16, top: 100, bottom: 120 }, { width: 288, height: 220 }, { width: 402, height: 300 })).toEqual({ left: 16, top: 72 });
});

describe('년도', () => {
  it('지금 해가 든 12년을 보여 주고, 지금 해는 골라 둔 것으로, 올해는 따로 표시한다', () => {
    const { root, texts, button } = open({ year: 2029, today: '2026-11-15' });
    expect(root.querySelector('.datepick')!.getAttribute('aria-label')).toBe('연도 선택');
    expect(root.querySelector('.datepick-label')!.textContent).toBe('2020 – 2031');
    expect(texts()).toEqual(['2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030', '2031']);
    expect([button('2029').getAttribute('aria-current'), button('2026').classList.contains('now'), button('2027').getAttribute('aria-current')]).toEqual(['true', true, null]);
    expect(document.activeElement).toBe(button('2029'));
  });
  it('고르면 그해와 지금 달을 알리고 닫는다. 지금 해를 골라도 알린다(그달의 처음으로 가려는 것일 수 있다)', () => {
    const a = open();
    a.button('2030').click();
    expect([a.onPick.mock.calls, a.onClose.mock.calls.length]).toEqual([[[2030, 11]], 1]);
    a.handle.destroy();
    const b = open();
    b.button('2026').click();
    expect([b.onPick.mock.calls, b.onClose.mock.calls.length]).toEqual([[[2026, 11]], 1]);
  });
  it('끝 쪽에 닿아 누른 단추가 꺼지면 초점을 칸으로 옮긴다(상자 밖으로 빠지지 않게)', () => {
    const { step, button } = open({ year: 1915 });
    step('이전 12년').focus();
    step('이전 12년').click();
    expect([step('이전 12년').disabled, document.activeElement]).toEqual([true, button('1900')]);
    const last = open({ year: 2085 });
    last.step('다음 12년').focus();
    last.step('다음 12년').click();
    expect([last.step('다음 12년').disabled, document.activeElement]).toEqual([true, last.button('2092')]);
  });
  it('앞뒤 단추로 12년씩 넘기고, 1900년과 2100년에서 멈춘다', () => {
    const { root, texts, step } = open({ year: 1905 });
    expect([texts()[0], step('이전 12년').disabled, step('다음 12년').disabled]).toEqual(['1900', true, false]);
    step('다음 12년').click();
    expect(texts()[0]).toBe('1912');
    const last = open({ year: 2099 });
    expect([last.texts()[0], last.step('다음 12년').disabled]).toEqual(['2092', true]);
    // 2100년 뒤의 칸은 누를 수 없다
    expect(last.items().filter((b) => b.disabled).map((b) => b.textContent)).toEqual(['2101', '2102', '2103']);
    expect(root.querySelectorAll('.datepick')).toHaveLength(1);
    expect([MIN_YEAR, MAX_YEAR]).toEqual([1900, 2100]);
  });
});

describe('월', () => {
  it('지금 해의 1월~12월을 보여 주고, 지금 달은 골라 둔 것으로, 올해의 이번 달은 따로 표시한다', () => {
    const { root, texts, button } = open({ kind: 'month', year: 2026, month: 3, today: '2026-11-15' });
    expect([root.querySelector('.datepick')!.getAttribute('aria-label'), root.querySelector('.datepick-label')!.textContent, root.querySelectorAll('.datepick-step').length]).toEqual(['월 선택', '2026년', 0]);
    expect(texts()).toEqual(['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']);
    expect([button('3월').getAttribute('aria-current'), button('11월').classList.contains('now')]).toEqual(['true', true]);
    // 다른 해에서는 이번 달 표시가 없다
    expect(open({ kind: 'month', year: 2027, month: 3, today: '2026-11-15' }).root.querySelectorAll('.datepick-item.now')).toHaveLength(0);
  });
  it('고르면 지금 해와 그 달을 알리고 닫는다', () => {
    const { button, onPick, onClose } = open({ kind: 'month', year: 2026, month: 11 });
    button('5월').click();
    expect([onPick.mock.calls, onClose.mock.calls.length]).toEqual([[[2026, 5]], 1]);
  });
});

describe('닫기와 키보드', () => {
  it('바깥(덮개)을 누르거나 Esc를 누르거나 창을 떠나거나 크기가 바뀌면 닫는다. 닫기는 한 번만 알린다', () => {
    const a = open();
    a.root.querySelector<HTMLElement>('.datepick-scrim')!.click();
    a.root.querySelector<HTMLElement>('.datepick-scrim')!.click();
    expect(a.onClose).toHaveBeenCalledTimes(1);
    const b = open();
    key(b.button('2026'), 'Escape');
    expect(b.onClose).toHaveBeenCalledTimes(1);
    const c = open();
    window.dispatchEvent(new Event('blur'));
    expect(c.onClose.mock.calls.length).toBe(1);
    // 높이만 바뀌면(아이폰 Safari의 주소 막대) 닫지 않고, 폭이 바뀌면 닫는다.
    const d = open();
    const width = window.innerWidth;
    window.dispatchEvent(new Event('resize'));
    expect(d.onClose.mock.calls.length).toBe(0);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width + 100 });
    try {
      window.dispatchEvent(new Event('resize'));
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
    expect(d.onClose.mock.calls.length).toBe(1);
  });
  it('화살표로 칸을 옮긴다(위아래는 네 칸씩, 끝에서 멈춘다). Tab은 상자 안에서 돈다', () => {
    const { button, step } = open({ year: 2026 });
    key(button('2026'), 'ArrowRight');
    expect(document.activeElement).toBe(button('2027'));
    key(button('2027'), 'ArrowDown');
    expect(document.activeElement).toBe(button('2031'));
    key(button('2031'), 'ArrowDown');
    expect(document.activeElement).toBe(button('2031'));
    key(button('2031'), 'ArrowUp');
    key(button('2027'), 'ArrowUp');
    expect(document.activeElement).toBe(button('2023'));
    key(button('2023'), 'Tab');
    expect(document.activeElement).toBe(button('2023')); // 마지막이 아니면 브라우저가 옮긴다
    button('2031').focus();
    key(button('2031'), 'Tab');
    expect(document.activeElement).toBe(step('이전 12년'));
    key(step('이전 12년'), 'Tab', true);
    expect(document.activeElement).toBe(button('2031'));
  });
  it('destroy는 덮개와 상자를 치우고 창의 듣기를 뗀다', () => {
    const { root, handle, onClose } = open();
    handle.destroy();
    window.dispatchEvent(new Event('resize'));
    expect([root.querySelector('.datepick'), root.querySelector('.datepick-scrim'), onClose.mock.calls.length]).toEqual([null, null, 0]);
  });
});
