import { afterEach, expect, it, vi } from 'vitest';
import type { EventRecord } from '../../core/events';
import { mountEventSheet, SCRIPTABLE_SCHEDULE_URL, type EventSheetProps } from './eventSheet';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(over: Partial<EventSheetProps> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const handle = mountEventSheet(root, {
    type: 'alarm',
    dateKey: '2026-11-20',
    defaultText: '',
    now: () => new Date(2026, 10, 15, 10, 7),
    iosHint: false,
    onSave,
    onDelete,
    onClose,
    ...over,
  });
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === label)!;
  const type = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { root, q, button, type, onSave, onDelete, onClose, handle };
}

const alarmRec: EventRecord = {
  type: 'alarm', date: '2026-11-20', text: '약', done: true, repeat: { freq: 'weekly', count: 4 },
  time: '08:30', advance: [0, 1], editedAt: 5, editedBy: 'x',
};

it('새 알림의 기본 시각은 오늘이면 지금+15분을 15분 단위로 내린 것, 다른 날이면 09:00', () => {
  const today = mount({ dateKey: '2026-11-15' });
  expect(today.q<HTMLInputElement>('input[type="time"]').value).toBe('10:15'); // 10:07 + 15 = 10:22 -> 10:15
  const late = mount({ dateKey: '2026-11-15', now: () => new Date(2026, 10, 15, 23, 50) });
  expect(late.q<HTMLInputElement>('input[type="time"]').value).toBe('23:45');
  const other = mount({ dateKey: '2026-11-16' });
  expect(other.q<HTMLInputElement>('input[type="time"]').value).toBe('09:00');
  expect(other.root.querySelector('h3')!.textContent).toBe('새 알림');
});

it('글이 비면 메모 첫 줄을 쓰고 둘 다 없으면 저장하지 않는다', () => {
  const none = mount();
  none.button('저장').click();
  expect(none.onSave).not.toHaveBeenCalled();
  expect(none.root.textContent).toContain('글을 적어 주세요');
  expect(none.onClose).not.toHaveBeenCalled();
  const dflt = mount({ defaultText: '회의' });
  dflt.button('저장').click();
  expect(dflt.onSave).toHaveBeenCalledTimes(1);
  const [id, rec] = dflt.onSave.mock.calls[0];
  expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  expect(rec).toMatchObject({ type: 'alarm', date: '2026-11-20', text: '회의', done: false, time: '09:00', advance: [0], repeat: { freq: 'none' }, editedAt: 0, editedBy: '' });
  expect(dflt.onClose).toHaveBeenCalledTimes(1);
  const typed = mount({ defaultText: '회의' });
  typed.type(typed.q<HTMLInputElement>('input.ev-text'), '  병원  ');
  typed.button('저장').click();
  expect(typed.onSave.mock.calls[0][1].text).toBe('병원');
});

it('미리 알림은 다섯 개까지만 고른다', () => {
  const m = mount({ defaultText: 'a' });
  const boxes = [...m.root.querySelectorAll<HTMLElement>('.advance [role="checkbox"]')];
  expect(boxes.map((b) => b.textContent)).toEqual(['당일', '하루 전', '이틀 전', '사흘 전', '5일 전', '일주일 전']);
  expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
  for (const b of boxes.slice(1)) b.click();
  expect(boxes.filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(5);
  expect(boxes[5].getAttribute('aria-checked')).toBe('false');
  m.button('저장').click();
  expect(m.onSave.mock.calls[0][1].advance).toEqual([0, 1, 2, 3, 5]);
  const none = mount({ defaultText: 'a' });
  none.root.querySelector<HTMLElement>('.advance [role="checkbox"]')!.click();
  none.button('저장').click();
  expect(none.onSave).not.toHaveBeenCalled();
  expect(none.root.textContent).toContain('하나 이상 고르세요');
});

it('반복과 끝을 고르면 rule에 들어가고 반복 없음이면 끝이 없다', () => {
  const m = mount({ defaultText: 'a' });
  const end = m.q('.ev-end');
  expect(end.hidden).toBe(true);
  expect([...m.q<HTMLSelectElement>('select.ev-repeat').options].map((o) => o.textContent)).toEqual(['안 함', '매일', '근무일', '매주', '매달', '매년', '음력 매년']);
  m.type(m.q<HTMLSelectElement>('select.ev-repeat'), 'weekly');
  expect(end.hidden).toBe(false);
  expect([...end.querySelectorAll('[role="radio"]')].map((b) => b.textContent)).toEqual(['계속', '날짜까지', '횟수']);
  m.button('횟수').click();
  m.type(m.q<HTMLInputElement>('input.ev-count'), '3');
  m.button('저장').click();
  expect(m.onSave.mock.calls[0][1].repeat).toEqual({ freq: 'weekly', count: 3 });

  const u = mount({ defaultText: 'a' });
  u.type(u.q<HTMLSelectElement>('select.ev-repeat'), 'daily');
  u.button('날짜까지').click();
  u.type(u.q<HTMLInputElement>('input.ev-until'), '2026-11-19'); // 그날 이전
  u.button('저장').click();
  expect(u.onSave).not.toHaveBeenCalled();
  u.type(u.q<HTMLInputElement>('input.ev-until'), '2026-12-01');
  u.button('저장').click();
  expect(u.onSave.mock.calls[0][1].repeat).toEqual({ freq: 'daily', until: '2026-12-01' });

  const bad = mount({ defaultText: 'a' });
  bad.type(bad.q<HTMLSelectElement>('select.ev-repeat'), 'daily');
  bad.button('횟수').click();
  bad.type(bad.q<HTMLInputElement>('input.ev-count'), '0');
  bad.button('저장').click();
  expect(bad.onSave).not.toHaveBeenCalled();

  const back = mount({ defaultText: 'a' });
  back.type(back.q<HTMLSelectElement>('select.ev-repeat'), 'daily');
  back.button('횟수').click();
  back.type(back.q<HTMLSelectElement>('select.ev-repeat'), 'none');
  back.button('저장').click();
  expect(back.onSave.mock.calls[0][1].repeat).toEqual({ freq: 'none' });
});

it('고치기면 값이 채워지고 삭제가 보인다', () => {
  const m = mount({ id: 'abc123', record: alarmRec, dateKey: '2026-11-27' });
  expect(m.root.querySelector('h3')!.textContent).toBe('알림 편집');
  expect(m.q<HTMLInputElement>('input.ev-text').value).toBe('약');
  expect(m.q<HTMLInputElement>('input[type="time"]').value).toBe('08:30');
  expect(m.q<HTMLSelectElement>('select.ev-repeat').value).toBe('weekly');
  expect(m.q<HTMLInputElement>('input.ev-count').value).toBe('4');
  expect(m.q<HTMLInputElement>('input.ev-done').checked).toBe(true);
  m.button('저장').click();
  const [id, rec] = m.onSave.mock.calls[0];
  expect(id).toBe('abc123');
  expect(rec).toMatchObject({ date: '2026-11-20', text: '약', done: true, advance: [0, 1], repeat: { freq: 'weekly', count: 4 } }); // 기준 날짜는 그대로
  const d = mount({ id: 'abc123', record: alarmRec });
  d.button('삭제').click();
  expect(d.onDelete).toHaveBeenCalledWith('abc123');
  expect(d.onClose).toHaveBeenCalledTimes(1);
  expect(mount().root.textContent).not.toContain('삭제');
});

it('카운트다운 시트: 글, 유형, 반복, 달력 아래에 표시', () => {
  const m = mount({ type: 'countdown', defaultText: '시험' });
  expect(m.root.querySelector('h3')!.textContent).toBe('새 카운트다운');
  expect(m.q('input[type="time"]')).toBeNull();
  expect([...m.q<HTMLSelectElement>('select.ev-kind').options].map((o) => o.textContent)).toEqual(['기본', '생일', '기념일', '명절', '시험']);
  expect([...m.q<HTMLSelectElement>('select.ev-repeat').options].map((o) => o.textContent)).toEqual(['안 함', '매년', '음력 매년']);
  expect(m.q<HTMLInputElement>('input.ev-bottom').checked).toBe(true);
  m.q<HTMLInputElement>('input.ev-bottom').click();
  m.button('저장').click();
  expect(m.onSave.mock.calls[0][1]).toMatchObject({ type: 'countdown', kind: 'basic', showBottom: false, repeat: { freq: 'none' }, text: '시험' });
});

it('생일을 고르면 반복이 매년이 된다(사용자가 바꾸지 않았을 때)', () => {
  const m = mount({ type: 'countdown', defaultText: 'a' });
  const repeat = m.q<HTMLSelectElement>('select.ev-repeat');
  m.type(m.q<HTMLSelectElement>('select.ev-kind'), 'birthday');
  expect(repeat.value).toBe('yearly');
  m.type(m.q<HTMLSelectElement>('select.ev-kind'), 'exam');
  expect(repeat.value).toBe('none');
  m.type(repeat, 'lunarYearly');
  m.type(m.q<HTMLSelectElement>('select.ev-kind'), 'anniversary');
  expect(repeat.value).toBe('lunarYearly'); // 사용자가 고른 반복은 유형을 바꿔도 지킨다
  m.button('저장').click();
  expect(m.onSave.mock.calls[0][1]).toMatchObject({ kind: 'anniversary', repeat: { freq: 'lunarYearly' } });
});

it('아이폰 안내는 iosHint일 때만', () => {
  const off = mount({ iosHint: false });
  expect(off.root.querySelector('a')).toBeNull();
  const on = mount({ iosHint: true });
  const a = on.root.querySelector<HTMLAnchorElement>('a')!;
  expect(a.textContent).toBe('지금 예약');
  expect(a.getAttribute('href')).toBe(SCRIPTABLE_SCHEDULE_URL);
  expect(on.root.textContent).toContain('아이폰 알림은 Scriptable 위젯 스크립트가 예약합니다');
  expect(mount({ type: 'countdown', iosHint: true }).root.querySelector('a')).toBeNull();
});

it('Esc와 바깥 누르기로 닫히고, 고친 것이 있으면 바깥 누르기는 닫지 않는다', () => {
  const m = mount();
  m.q('.event-scrim').click();
  expect(m.onClose).toHaveBeenCalledTimes(1);
  const edited = mount();
  edited.type(edited.q<HTMLInputElement>('input.ev-text'), 'x');
  edited.q('.event-scrim').click();
  expect(edited.onClose).not.toHaveBeenCalled();
  const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  edited.q('input.ev-text').dispatchEvent(esc);
  expect(edited.onClose).toHaveBeenCalledTimes(1);
  expect(edited.onSave).not.toHaveBeenCalled();
});
