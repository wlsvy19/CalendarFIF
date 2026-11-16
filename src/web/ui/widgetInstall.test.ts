import { afterEach, expect, it, vi } from 'vitest';
import { fillPlaceholders, widgetSection, type WidgetConfig, type WidgetInstallDeps } from './widgetInstall';

const config: WidgetConfig = { projectId: 'demo-calfif', apiKey: 'fake-key', appUrl: 'https://example.test', holidayUrl: 'https://example.com/holidays.json' };
const script = 'const c = { projectId: "__PROJECT_ID__", apiKey: "__API_KEY__", appUrl: "__APP_URL__", holidayUrl: "__HOLIDAY_URL__" };';

afterEach(() => document.body.replaceChildren());

it('자리 표시 넷을 채운다', () => {
  expect(fillPlaceholders(script, config)).toBe('const c = { projectId: "demo-calfif", apiKey: "fake-key", appUrl: "https://example.test", holidayUrl: "https://example.com/holidays.json" };');
});
it('공휴일 자료 주소는 비어도 된다(빈 글로 채운다)', () => {
  expect(fillPlaceholders(script, { ...config, holidayUrl: '' })).toBe('const c = { projectId: "demo-calfif", apiKey: "fake-key", appUrl: "https://example.test", holidayUrl: "" };');
  expect(() => fillPlaceholders(script.replace('__HOLIDAY_URL__', ''), config)).toThrow('__HOLIDAY_URL__');
  expect(() => fillPlaceholders(script, { ...config, holidayUrl: '', appUrl: '' })).toThrow('appUrl');
});
it('값 안의 따옴표와 역슬래시는 글자열 안에서 안전하게 쓴다', () => {
  const tricky = { ...config, apiKey: 'a"b\\c$&' };
  const out = fillPlaceholders(script, tricky);
  expect(out).toContain('apiKey: "a\\"b\\\\c$&"');
  expect(new Function(`${out}; return c;`)().apiKey).toBe('a"b\\c$&');
});
it("줄바꿈과 따옴표, 달러 기호 묶음도 그대로 들어가고 결과는 여전히 글로 읽힌다", () => {
  const tricky = { projectId: 'a\nb', apiKey: "x$'y$`z$&w$1", appUrl: 'https://example.test/$`', holidayUrl: 'https://example.com/"h\\$&' };
  const out = fillPlaceholders(script, tricky);
  expect(out).not.toContain('a\nb'); // 줄바꿈은 \n 두 글자로 들어간다
  expect(new Function(`${out}; return c;`)()).toEqual(tricky);
});
it('자리 표시가 없거나 둘이거나 값이 비면 오류를 던진다', () => {
  expect(() => fillPlaceholders(script.replace('__API_KEY__', 'x'), config)).toThrow();
  expect(() => fillPlaceholders(`${script} "__APP_URL__"`, config)).toThrow();
  expect(() => fillPlaceholders(script, { ...config, projectId: '' })).toThrow();
});

function mount(overrides: Partial<WidgetInstallDeps> = {}) {
  let resolveLoad!: (s: string) => void;
  let rejectLoad!: (e: Error) => void;
  const load = vi.fn(() => new Promise<string>((res, rej) => ((resolveLoad = res), (rejectLoad = rej))));
  const copy = vi.fn(async () => {});
  const el = widgetSection({ load, config, copy, ...overrides });
  document.body.append(el);
  return {
    el,
    load,
    copy,
    resolveLoad: (s = script) => resolveLoad(s),
    rejectLoad: () => rejectLoad(new Error('x')),
    button: el.querySelector<HTMLButtonElement>('button.settings-btn')!,
    status: el.querySelector<HTMLElement>('[role="status"]')!,
    area: el.querySelector<HTMLTextAreaElement>('textarea.widget-script')!,
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

it('읽는 동안 단추는 꺼져 있고 다 읽으면 켜진다', async () => {
  const m = mount();
  expect(m.el.querySelector('.field-label')!.textContent).toBe('위젯');
  expect(m.button.textContent).toBe('위젯 스크립트 복사');
  expect(m.button.disabled).toBe(true);
  expect(m.status.textContent).toBe('불러오는 중');
  expect(m.load).toHaveBeenCalledTimes(1);
  m.resolveLoad();
  await settle();
  expect(m.button.disabled).toBe(false);
  expect(m.status.textContent).toBe('');
  expect(m.area.hidden).toBe(true);
});
it('누르면 채운 글을 복사하고 알린다', async () => {
  const m = mount();
  m.resolveLoad();
  await settle();
  m.button.click();
  await settle();
  expect(m.copy).toHaveBeenCalledWith(fillPlaceholders(script, config));
  expect(m.status.textContent).toBe('복사했습니다. Scriptable에 붙여 넣으세요.');
  expect(m.area.hidden).toBe(true);
});
it('복사가 막히면 글 상자를 보이고 전체를 고른다', async () => {
  const m = mount({ copy: vi.fn(() => Promise.reject(new Error('denied'))) });
  m.resolveLoad();
  await settle();
  m.button.click();
  await settle();
  const filled = fillPlaceholders(script, config);
  expect(m.area.hidden).toBe(false);
  expect(m.area.value).toBe(filled);
  expect(m.area.selectionStart).toBe(0);
  expect(m.area.selectionEnd).toBe(filled.length);
  expect(m.status.textContent).toBe('복사하지 못했습니다. 아래 글을 길게 눌러 전체 선택한 뒤 복사하세요.');
});
it('복사가 막히면 setSelectionRange로도 전체를 고른다(아이폰은 select()가 안 먹는다)', async () => {
  const m = mount({ copy: vi.fn(() => Promise.reject(new Error('denied'))) });
  const spy = vi.spyOn(m.area, 'setSelectionRange');
  m.resolveLoad();
  await settle();
  m.button.click();
  await settle();
  expect(spy).toHaveBeenCalledWith(0, fillPlaceholders(script, config).length);
});
it('읽지 못하거나 자리 표시가 맞지 않으면 준비하지 못했다고 하고 단추는 꺼 둔다', async () => {
  const a = mount();
  a.rejectLoad();
  await settle();
  expect(a.status.textContent).toBe('스크립트를 준비하지 못했습니다.');
  expect(a.button.disabled).toBe(true);
  const b = mount();
  b.resolveLoad('자리 표시 없음');
  await settle();
  expect(b.status.textContent).toBe('스크립트를 준비하지 못했습니다.');
  expect(b.button.disabled).toBe(true);
});
it('설치 방법 여섯 단계가 순서대로 있다', () => {
  const m = mount();
  expect(m.el.querySelector('details.widget-steps summary')!.textContent).toBe('설치 방법');
  const steps = [...m.el.querySelectorAll('ol > li')].map((li) => li.textContent);
  expect(steps).toHaveLength(6);
  expect(steps[0]).toBe('App Store에서 Scriptable을 설치합니다(무료).');
  expect(steps[2]).toBe('Scriptable을 열고 오른쪽 위 +를 눌러 새 스크립트를 만든 뒤 붙여 넣습니다. 이름을 CalendarFIF로 바꿉니다.');
  expect(steps[4]).toBe('홈 화면의 빈 곳을 길게 누른 뒤 왼쪽 위의 "편집" → "위젯 추가"(예전 iOS에서는 +)를 눌러 Scriptable의 큰 위젯을 추가합니다.');
  expect(steps[5]).toBe('추가한 위젯을 길게 눌러 "위젯 편집"에서 Script를 CalendarFIF로 고릅니다.');
  const notes = [...m.el.querySelectorAll('details > p.settings-note')].map((p) => p.textContent);
  expect(notes).toEqual([
    '한 번 붙여 넣으면 그 뒤로는 위젯이 스스로 새 버전을 받습니다(세 시간에 한 번 확인합니다). 바로 받으려면 Scriptable에서 CalendarFIF를 한 번 실행합니다. 0.9.0보다 앞의 스크립트를 쓰고 있다면 이번 한 번만 다시 붙여 넣으세요.',
    '위젯은 아이폰이 정한 때(보통 15~60분마다)에 새로 그려집니다. 위젯을 누르면 Scriptable을 거쳐 Safari에서 달력이 열립니다(iOS에서는 위젯이 홈 화면 앱을 바로 열 수 없습니다). 주소창 없이 보려면 홈 화면의 CalendarFIF 아이콘을 누르세요.',
    '오류가 나오거나, 비어 보이거나, 모양이 어긋나 보이면 "위젯 편집"의 Parameter에 image dark 또는 image light를 적으면 그림 방식으로 그립니다.',
  ]);
});
