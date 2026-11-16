import { expect, it, vi } from 'vitest';
import { ACCENTS, DEFAULT_PREFS, type Prefs } from '../prefs';
import { prefsSection } from './prefsSection';
import { playTone } from '../tones';

vi.mock('../tones', () => ({ playTone: vi.fn() }));

function mount(prefs: Prefs = DEFAULT_PREFS) {
  const onChange = vi.fn();
  const el = prefsSection({ prefs, onChange });
  document.body.replaceChildren(el);
  const group = (labelId: string): HTMLElement => el.querySelector<HTMLElement>(`[aria-labelledby="${labelId}"]`)!;
  const radios = (labelId: string): HTMLButtonElement[] => [...group(labelId).querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const checked = (labelId: string): string | undefined => radios(labelId).find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.value;
  const switchOf = (name: string): HTMLInputElement =>
    [...el.querySelectorAll<HTMLLabelElement>('label.pref-row')].find((l) => l.querySelector('.pref-name')!.textContent === name)!.querySelector('input')!;
  const last = (): Prefs => onChange.mock.lastCall![0] as Prefs;
  return { el, onChange, group, radios, checked, switchOf, last };
}

it('칸은 화면, 달력, 메모, 셀 넷이고 지금 설정을 보여 준다', () => {
  const m = mount({ ...DEFAULT_PREFS, theme: 'dark', accent: 'gold', lunar: false, weekStart: 1, memoSize: 'large', bullet: 'dot' });
  expect([...m.el.querySelectorAll('.field-label')].map((l) => l.textContent)).toEqual(['화면', '달력', '메모', '셀']);
  expect([...m.el.querySelectorAll('.pref-name')].map((l) => l.textContent)).toEqual(['밝기', '색상', '음력', '절기와 복날', '공휴일', '주 번호', '한 주의 시작', '글자 크기', '줄 머리', '셀 간격', '줄 간격', '완료된 작업 표시', '완료 작업 맨 아래로', '알림 시각 표시', '편집 완료 알람', '리마인드 알람']);
  expect([m.checked('prefTheme'), m.checked('prefAccent'), m.checked('prefWeekStart'), m.checked('prefMemoSize'), m.checked('prefBullet')]).toEqual(['dark', 'gold', '1', 'large', 'dot']);
  expect([m.switchOf('음력').checked, m.switchOf('공휴일').checked, m.switchOf('주 번호').checked, m.switchOf('완료된 작업 표시').checked, m.switchOf('완료 작업 맨 아래로').checked]).toEqual([false, true, false, true, false]);
  expect(m.radios('prefTheme').map((b) => b.textContent)).toEqual(['자동', '밝게', '어둡게']);
  // 고른 단추 하나만 Tab을 받는다.
  expect(m.radios('prefTheme').map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
});

it('고르면 바로 새 설정을 준다. 바꾼 것들이 쌓인다', () => {
  const m = mount();
  m.radios('prefTheme')[2].click();
  expect(m.last()).toEqual({ ...DEFAULT_PREFS, theme: 'dark' });
  m.switchOf('음력').click();
  expect(m.last()).toEqual({ ...DEFAULT_PREFS, theme: 'dark', lunar: false });
  m.switchOf('절기와 복날').click();
  expect(m.last()).toEqual({ ...DEFAULT_PREFS, theme: 'dark', lunar: false, solarTerms: false });
  m.switchOf('절기와 복날').click();
  m.radios('prefWeekStart')[1].click();
  m.radios('prefMemoSize')[0].click();
  m.radios('prefBullet')[1].click();
  m.switchOf('주 번호').click();
  expect(m.last()).toEqual({ ...DEFAULT_PREFS, theme: 'dark', lunar: false, weekStart: 1, memoSize: 'small', bullet: 'number', weekNumbers: true });
  expect(m.checked('prefTheme')).toBe('dark');
  // 이미 고른 것을 다시 누르면 알리지 않는다.
  const calls = m.onChange.mock.calls.length;
  m.radios('prefTheme')[2].click();
  expect(m.onChange.mock.calls.length).toBe(calls);
});

it('색상은 여덟 가지이고 이름이 붙어 있다. 누르면 그 색으로 바꾼다', () => {
  const m = mount();
  const swatches = m.radios('prefAccent');
  expect(swatches.map((b) => b.getAttribute('aria-label'))).toEqual(['파랑', '분홍', '금색', '보라', '연두', '주황', '노랑', '하늘']);
  expect(swatches.every((b) => b.classList.contains('swatch') && b.textContent === '')).toBe(true);
  expect([swatches[1].style.getPropertyValue('--sw-light'), swatches[1].style.getPropertyValue('--sw-dark')]).toEqual([ACCENTS.pink.light, ACCENTS.pink.dark]);
  swatches[7].click();
  expect([m.last().accent, m.checked('prefAccent')]).toEqual(['sky', 'sky']);
});

it('화살표 키로 옆의 것을 고르고 초점도 따라간다(끝에서 처음으로 돈다)', () => {
  const m = mount();
  const [auto, light, dark] = m.radios('prefTheme');
  auto.focus();
  auto.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect([m.last().theme, document.activeElement]).toEqual(['light', light]);
  light.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  dark.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect([m.last().theme, document.activeElement]).toEqual(['auto', auto]);
  auto.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  expect(m.last().theme).toBe('dark');
});

it('목록에 없는 시작 요일이 저장되어 있으면 아무것도 고르지 않은 채로 보인다', () => {
  const m = mount({ ...DEFAULT_PREFS, weekStart: 3 });
  expect([m.checked('prefWeekStart'), m.radios('prefWeekStart').map((b) => b.tabIndex)]).toEqual([undefined, [0, -1]]);
});

it('셀 묶음에 여덟 칸이 이 순서로 있다', () => {
  const m = mount({ ...DEFAULT_PREFS, cellGap: 'wide', lineSpacing: 'tight', doneTone: 'short', alarmTone: 'bell', showAlarmTime: false });
  const cell = [...m.el.querySelectorAll('.field')].find((f) => f.querySelector('.field-label')!.textContent === '셀')!;
  expect([...cell.querySelectorAll('.pref-name')].map((l) => l.textContent)).toEqual(['줄 머리', '셀 간격', '줄 간격', '완료된 작업 표시', '완료 작업 맨 아래로', '알림 시각 표시', '편집 완료 알람', '리마인드 알람']);
  expect(m.radios('prefCellGap').map((b) => b.textContent)).toEqual(['좁게', '보통', '넓게']);
  expect(m.radios('prefLineSpacing').map((b) => b.textContent)).toEqual(['좁게', '보통', '넓게']);
  expect(m.radios('prefDoneTone').map((b) => b.textContent)).toEqual(['없음', '짧은 소리']);
  expect(m.radios('prefAlarmTone').map((b) => b.textContent)).toEqual(['없음', '차임', '벨']);
  expect([m.checked('prefCellGap'), m.checked('prefLineSpacing'), m.checked('prefDoneTone'), m.checked('prefAlarmTone'), m.switchOf('알림 시각 표시').checked]).toEqual(['wide', 'tight', 'short', 'bell', false]);
});

it('셀 간격을 넓게로 바꾸면 onChange에 cellGap: wide', () => {
  const m = mount();
  m.radios('prefCellGap')[2].click();
  expect(m.last()).toEqual({ ...DEFAULT_PREFS, cellGap: 'wide' });
  m.radios('prefLineSpacing')[0].click();
  expect(m.last().lineSpacing).toBe('tight');
  m.switchOf('알림 시각 표시').click();
  expect(m.last().showAlarmTime).toBe(!DEFAULT_PREFS.showAlarmTime);
});

it('리마인드 알람을 벨로 바꾸면 벨 소리를 한 번 낸다. 없음은 소리가 없다', () => {
  vi.mocked(playTone).mockClear();
  const m = mount();
  m.radios('prefAlarmTone')[2].click();
  expect([m.last().alarmTone, vi.mocked(playTone).mock.calls]).toEqual(['bell', [['bell']]]);
  m.radios('prefAlarmTone')[0].click();
  m.radios('prefDoneTone')[1].click();
  expect(vi.mocked(playTone).mock.calls).toEqual([['bell'], ['done']]);
  m.radios('prefDoneTone')[0].click();
  expect(vi.mocked(playTone).mock.calls).toHaveLength(2);
});
