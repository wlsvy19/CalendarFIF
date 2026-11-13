import { expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '../appearance';
import { FakeBridge } from './fakeBridge';
import { mountDesktopSettings } from './settingsPages';

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const bridge = new FakeBridge();
  const onAppearance = vi.fn();
  mountDesktopSettings(root, { appearance: DEFAULT_APPEARANCE, onAppearance, bridge, onClose: vi.fn(),
    account: { email: 'test@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut: vi.fn() } });
  return { root, bridge, onAppearance };
}
const tab = (root: HTMLElement, name: string) => [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!;
const row = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLElement>('.srow')].find((r) => r.querySelector('.srow-label')?.textContent === label)!;
const labels = (root: HTMLElement) => [...root.querySelectorAll('[role="tabpanel"]:not([hidden]) .srow-label')].map((l) => l.textContent);
const change = (el: HTMLInputElement | HTMLSelectElement, value: string, type = 'change') => { el.value = value; el.dispatchEvent(new Event(type, { bubbles: true })); };

it('다섯 쪽과 설계 8절의 문구', () => {
  const { root } = mount();
  expect([...root.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['캘린더', '셀', '글꼴 및 색상', '고급', '계정']);
  expect(labels(root)).toEqual(['배치', '최대 행', '지나간 주 표시', '월 간격', '주 번호', '그림자', '제목 표시줄 표시', '공휴일', '음력']);
  tab(root, '셀').click();
  expect(labels(root)).toEqual(['줄 머리', '셀 간격', '줄 간격', '완료 작업 자동으로 맨 아래 줄로 이동', '완료된 작업 표시', '편집 완료 알람']);
  tab(root, '글꼴 및 색상').click();
  expect(labels(root)).toEqual(['캘린더 글꼴(날짜·요일) 색과 크기', '편집 내용의 글꼴 크기 및 색상', '캘린더 배경', '휴일 배경색', '오늘의 테두리', '제목 표시줄 버튼 색상', '휴일 텍스트 색상', '음력 텍스트 색상', '투명도']);
  tab(root, '고급').click();
  expect(labels(root)).toEqual(['시작 요일', '첫번째 주', '쉬는날 표시', '쉬는날', '캘린더 숨기기 단축키', '내용 표시 및 숨기기 단축키', 'Windows 시작 시 실행']);
});
it('바꾸면 바로 알리고, 색은 22색과 없음(배경과 테두리만), 16진수 직접 입력', () => {
  const { root, onAppearance } = mount();
  change(row(root, '최대 행').querySelector('select')!, '7');
  expect(onAppearance).toHaveBeenLastCalledWith({ ...DEFAULT_APPEARANCE, maxRows: 7 });
  tab(root, '글꼴 및 색상').click();
  change(row(root, '투명도').querySelector<HTMLInputElement>('input[type="range"]')!, '30', 'input');
  expect([onAppearance.mock.lastCall![0], row(root, '투명도').textContent!.includes('30%')]).toEqual([{ ...DEFAULT_APPEARANCE, maxRows: 7, transparency: 30 }, true]);
  const bg = row(root, '캘린더 배경');
  bg.querySelector<HTMLElement>('.color-btn')!.click();
  expect(bg.querySelectorAll('.swatch')).toHaveLength(23);
  change(bg.querySelector<HTMLInputElement>('input.hex')!, '#12ab9f');
  expect(onAppearance.mock.lastCall![0].calendarBg).toBe('12AB9F');
  const calls = onAppearance.mock.calls.length;
  change(bg.querySelector<HTMLInputElement>('input.hex')!, 'zz');
  expect([bg.textContent!.includes('16진수 6자리로 적어 주세요.'), onAppearance.mock.calls.length]).toEqual([true, calls]);
  const ink = row(root, '휴일 텍스트 색상');
  ink.querySelector<HTMLElement>('.color-btn')!.click();
  expect(ink.querySelectorAll('.swatch')).toHaveLength(22);
});
it('단축키는 누른 조합을 받고, 다른 프로그램이 쓰면 알린다. 개발 실행에서는 자동 실행을 바꿀 수 없다', async () => {
  const { root, bridge } = mount();
  bridge.taken.add('Ctrl+Alt+J');
  tab(root, '고급').click();
  const r = row(root, '캘린더 숨기기 단축키');
  await vi.waitFor(() => expect(r.querySelector<HTMLInputElement>('input.hotkey')!.value).toBe('Ctrl+Alt+H'));
  r.querySelector('input.hotkey')!.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', ctrlKey: true, altKey: true, bubbles: true }));
  r.querySelector<HTMLInputElement>('input[role="switch"]')!.click();
  await vi.waitFor(() => expect(r.textContent).toContain('다른 프로그램이 이 단축키를 쓰고 있습니다. 다른 조합을 고르세요.'));
  expect(bridge.calls).toContainEqual(['setSystem', { hideHotkey: { accelerator: 'Ctrl+Alt+J', enabled: true } }]);
  const start = row(root, 'Windows 시작 시 실행');
  await vi.waitFor(() => expect(start.querySelector<HTMLInputElement>('input[role="switch"]')!.disabled).toBe(true));
  expect(start.textContent).toContain('개발 실행에서는 바꿀 수 없습니다. 꾸린 앱에서 바꿉니다.');
});

const SAVE_FAILED = '이 기기에 저장하지 못했습니다. 지금 화면에만 적용됩니다.';
it('저장하지 못해도 값은 화면에 남고, 저장하지 못했다고 알린다', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const onAppearance = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  mountDesktopSettings(root, { appearance: DEFAULT_APPEARANCE, onAppearance, bridge: null, onClose: vi.fn(),
    account: { email: 'a@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut: vi.fn() } });
  const select = row(root, '최대 행').querySelector('select')!;
  change(select, '6');
  expect([select.value, root.textContent!.includes(SAVE_FAILED)]).toEqual(['6', true]);
  change(select, '7');
  expect(root.textContent!.includes(SAVE_FAILED)).toBe(false);
});
it('지나간 주 표시와 최대 행은 변동 월에서만 쓴다', () => {
  const { root } = mount();
  const rows = () => [row(root, '최대 행'), row(root, '지나간 주 표시')].map((r) => r.querySelector('select')!.disabled);
  expect(rows()).toEqual([false, false]);
  const radio = (name: string) => [...row(root, '배치').querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.parentElement!.textContent === name)!;
  radio('전체 월').click();
  expect(rows()).toEqual([true, true]);
  expect(row(root, '최대 행').textContent).toContain('변동 월에서만 씁니다.');
});
it('다리가 없는 브라우저에서는 단축키와 자동 실행을 바꿀 수 없다', () => {
  const root = document.createElement('div');
  document.body.append(root);
  mountDesktopSettings(root, { appearance: DEFAULT_APPEARANCE, onAppearance: vi.fn(), bridge: null, onClose: vi.fn(),
    account: { email: 'a@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut: vi.fn() } });
  for (const name of ['캘린더 숨기기 단축키', '내용 표시 및 숨기기 단축키', 'Windows 시작 시 실행']) {
    const r = row(root, name);
    expect([[...r.querySelectorAll('input')].every((i) => i.disabled), r.textContent!.includes('바탕화면 앱에서만 바꿀 수 있습니다.')]).toEqual([true, true]);
  }
});
it('자동 실행을 걸지 못하면 되돌리고 알린다', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  const bridge = new FakeBridge();
  bridge.system = { ...bridge.system, canStartWithWindows: true, settings: { ...bridge.system.settings, startWithWindows: false } };
  mountDesktopSettings(root, { appearance: DEFAULT_APPEARANCE, onAppearance: vi.fn(), bridge, onClose: vi.fn(),
    account: { email: 'a@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut: vi.fn() } });
  tab(root, '고급').click();
  const sw = row(root, 'Windows 시작 시 실행').querySelector<HTMLInputElement>('input[role="switch"]')!;
  await vi.waitFor(() => expect(sw.disabled).toBe(false));
  sw.click(); // FakeBridge는 요청대로 바꾼다
  await vi.waitFor(() => expect(bridge.calls).toContainEqual(['setSystem', { startWithWindows: true }]));
  await vi.waitFor(() => expect(sw.checked).toBe(true));
  const real = bridge.setSystem.bind(bridge);
  bridge.setSystem = async (patch) => ({ ...(await real(patch)), settings: { ...bridge.system.settings, startWithWindows: true } });
  sw.click();
  await vi.waitFor(() => expect(row(root, 'Windows 시작 시 실행').textContent).toContain('적용하지 못했습니다.'));
  expect(sw.checked).toBe(true);
});
it('Esc는 닫고, 단축키 칸 안의 Esc는 받기만 그만둔다', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const onClose = vi.fn();
  mountDesktopSettings(root, { appearance: DEFAULT_APPEARANCE, onAppearance: vi.fn(), bridge: new FakeBridge(), onClose,
    account: { email: 'a@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut: vi.fn() } });
  const esc = (el: Element, isComposing = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing, bubbles: true }));
  esc(root.querySelector('input.hotkey')!);
  expect(onClose).not.toHaveBeenCalled();
  esc(root.querySelector('.sheet')!, true);
  expect(onClose).not.toHaveBeenCalled();
  esc(root.querySelector('.sheet')!);
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('계정 쪽은 웹앱 설정 화면의 문구와 로그아웃 확인을 그대로 쓴다', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const onSignOut = vi.fn();
  mountDesktopSettings(root, { appearance: DEFAULT_APPEARANCE, onAppearance: vi.fn(), bridge: null, onClose: vi.fn(), page: 'account',
    account: { email: 'a@example.com', pending: 2, storageOk: true, corruptFound: false, onSignOut } });
  expect(labels(root)).toEqual([]);
  expect(root.querySelector('[role="tabpanel"]:not([hidden])')!.textContent).toContain('a@example.com');
  const button = (t: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === t)!;
  button('로그아웃').click();
  expect(onSignOut).not.toHaveBeenCalled();
  button('그래도 로그아웃').click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});

const INVALID = 'Ctrl 또는 Alt를 넣은 조합을 고르세요.';
const press = (el: Element, init: KeyboardEventInit) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
async function advancedRow(bridge = new FakeBridge()) {
  const root = document.createElement('div');
  document.body.append(root);
  mountDesktopSettings(root, { appearance: DEFAULT_APPEARANCE, onAppearance: vi.fn(), bridge, onClose: vi.fn(),
    account: { email: 'a@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut: vi.fn() } });
  tab(root, '고급').click();
  const r = row(root, '캘린더 숨기기 단축키');
  const input = r.querySelector<HTMLInputElement>('input.hotkey')!;
  const sw = r.querySelector<HTMLInputElement>('input[role="switch"]')!;
  await vi.waitFor(() => expect(input.disabled).toBe(false));
  return { r, input, sw, bridge };
}
it('받을 수 없는 조합을 누르면 알리고, 수식키만 누르면 아무 말도 하지 않는다', async () => {
  const { r, input, bridge } = await advancedRow();
  press(input, { code: 'ControlLeft', key: 'Control', ctrlKey: true });
  press(input, { code: 'ShiftLeft', key: 'Shift', shiftKey: true });
  expect(r.textContent).not.toContain(INVALID);
  press(input, { code: 'KeyJ', key: 'j' });
  expect(r.textContent).toContain(INVALID);
  press(input, { code: 'F4', key: 'F4', altKey: true });
  press(input, { code: 'KeyJ', key: 'j', metaKey: true, ctrlKey: true });
  expect([input.value, bridge.calls.some((c) => c[0] === 'setSystem')]).toEqual(['Ctrl+Alt+H', false]);
  press(input, { code: 'KeyJ', key: 'j', ctrlKey: true, altKey: true });
  await vi.waitFor(() => expect([input.value, r.textContent!.includes(INVALID)]).toEqual(['Ctrl+Alt+J', false]));
});
it('응답이 요청과 다르면 칸과 스위치를 응답대로 맞추고 알린다', async () => {
  const { r, input, sw, bridge } = await advancedRow();
  bridge.setSystem = async () => bridge.system; // 요청을 버리고 지금 상태를 돌려준다
  press(input, { code: 'KeyJ', key: 'j', ctrlKey: true, altKey: true });
  await vi.waitFor(() => expect([input.value, r.textContent!.includes(INVALID)]).toEqual(['Ctrl+Alt+H', true]));
  sw.click();
  await vi.waitFor(() => expect([sw.checked, r.textContent!.includes('적용하지 못했습니다.')]).toEqual([false, true]));
});
it('설정을 바꾸는 요청이 던지면 마지막으로 받은 값으로 되돌린다', async () => {
  const { r, input, sw, bridge } = await advancedRow();
  bridge.setSystem = async () => { throw new Error('끊김'); };
  press(input, { code: 'KeyJ', key: 'j', ctrlKey: true, altKey: true });
  sw.click();
  await vi.waitFor(() => expect(r.textContent).toContain('적용하지 못했습니다.'));
  expect([input.value, sw.checked]).toEqual(['Ctrl+Alt+H', false]);
});
it('닫기를 누르면 적고 아직 반영하지 않은 16진수 값을 반영하고, 잘못됐으면 닫지 않고 알린다', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const onAppearance = vi.fn();
  const onClose = vi.fn();
  mountDesktopSettings(root, { appearance: DEFAULT_APPEARANCE, onAppearance, bridge: null, onClose,
    account: { email: 'a@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut: vi.fn() } });
  tab(root, '글꼴 및 색상').click();
  const bg = row(root, '캘린더 배경');
  const hex = bg.querySelector<HTMLInputElement>('input.hex')!;
  const close = [...root.querySelectorAll('button')].find((b) => b.textContent === '닫기')!;
  hex.value = 'zz';
  close.click();
  expect([onClose.mock.calls.length, bg.textContent!.includes('16진수 6자리로 적어 주세요.')]).toEqual([0, true]);
  hex.value = '#00ff7f';
  close.click();
  expect(onAppearance.mock.lastCall![0].calendarBg).toBe('00FF7F');
  expect(onClose).toHaveBeenCalledTimes(1);
});
