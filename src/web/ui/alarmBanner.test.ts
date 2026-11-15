import { afterEach, expect, it, vi } from 'vitest';
import type { AlarmTrigger } from '../../core/events';
import { metaText, showAlarmBanner } from './alarmBanner';

afterEach(() => { document.body.replaceChildren(); });

const trig = (over: Partial<AlarmTrigger>): AlarmTrigger => ({
  key: 'a@2026-11-20@0', id: 'a', at: new Date(2026, 10, 20, 9, 0), occurrence: '2026-11-20', advance: 0, time: '09:00', text: '약 먹기', ...over,
});
const mount = () => {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
};

it('울린 것들을 보이고 확인으로 닫힌다', () => {
  const root = mount();
  showAlarmBanner(root, [trig({}), trig({ key: 'b', advance: 1, occurrence: '2026-11-21', time: '08:30', text: '회의' })], vi.fn(), () => new Date(2026, 10, 20, 9, 0));
  const banner = root.querySelector('.alarm-banner')!;
  expect(banner.getAttribute('role')).toBe('alertdialog');
  expect(banner.getAttribute('aria-live')).toBe('assertive');
  const rows = [...banner.querySelectorAll('.alarm-item')].map((r) => [r.querySelector('.alarm-text')!.textContent, r.querySelector('.alarm-meta')!.textContent]);
  expect(rows).toEqual([['약 먹기', '오늘 09:00'], ['회의', '하루 전 알림 · 11월 21일 (토) 08:30']]);
  [...banner.querySelectorAll('button')].find((b) => b.textContent === '확인')!.click();
  expect(root.querySelector('.alarm-banner')).toBeNull();
});

it('떠 있으면 더한다', () => {
  const root = mount();
  showAlarmBanner(root, [trig({})], vi.fn());
  showAlarmBanner(root, [trig({ key: 'b', text: '둘째' })], vi.fn());
  expect(root.querySelectorAll('.alarm-banner')).toHaveLength(1);
  expect(root.querySelectorAll('.alarm-item')).toHaveLength(2);
});

it('글을 누르면 그 날짜로', () => {
  const root = mount();
  const onOpen = vi.fn();
  showAlarmBanner(root, [trig({ occurrence: '2026-11-22', advance: 2 })], onOpen);
  root.querySelector<HTMLElement>('.alarm-item')!.click();
  expect(onOpen).toHaveBeenCalledWith('2026-11-22');
});

it('누른 줄은 치우고 남은 줄이 없으면 상자도 닫힌다', () => {
  const root = mount();
  const onOpen = vi.fn();
  showAlarmBanner(root, [trig({}), trig({ key: 'b', occurrence: '2026-11-21', text: '둘째' })], onOpen);
  root.querySelectorAll<HTMLElement>('.alarm-item')[0].click();
  expect(root.querySelectorAll('.alarm-item')).toHaveLength(1);
  expect(root.querySelector('.alarm-banner')).not.toBeNull();
  root.querySelector<HTMLElement>('.alarm-item')!.click();
  expect(root.querySelector('.alarm-banner')).toBeNull();
  expect(onOpen).toHaveBeenCalledTimes(2);
});

it('아래 줄: 오늘이 아니면 날짜와 요일, 미리 알림이면 며칠 전', () => {
  expect(metaText(trig({}), '2026-11-20')).toBe('오늘 09:00');
  expect(metaText(trig({}), '2026-11-19')).toBe('11월 20일 (금) 09:00');
  expect(metaText(trig({ advance: 7, occurrence: '2026-11-27' }), '2026-11-20')).toBe('일주일 전 알림 · 11월 27일 (금) 09:00');
});
