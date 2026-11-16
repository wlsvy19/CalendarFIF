import { describe, expect, it, vi } from 'vitest';
import type { Config } from './api';
import { makeFakeHost, type FakeAnswer, type FakeHost, type FakeOptions, type FakeRequest } from './fakeHost';
import { LIB_END, LIB_NAME, MAX_LOAD_FAILS, MAX_UNFINISHED, SKIP_AFTER_ERROR_MS, checkForUpdate, isNewer, loadCachedLib, readUpdateState, runWithUpdate, updateLine, versionKey } from './update';

const BASE = '0.9.0 (2026-11-16)';
const NEW = '0.9.1 (2026-11-20)';
const FIXED = '0.9.2 (2026-11-21)';
const cfg: Config = { projectId: 'demo-calfif', apiKey: 'demo-key', appUrl: 'https://example.test', version: BASE };
const LIB_PATH = `/docs/${LIB_NAME}.js`;
const STATE_PATH = '/docs/calendarfif-update.json';
const HOUR = 3_600_000;
const MIN = 60_000;
const at = (ms = 0) => new Date(Date.UTC(2026, 10, 20, 0, 0, 0) + ms);
const T0 = at().getTime();
const NONE = { version: '', checkedAt: 0, triedAt: 0, unfinished: {}, skipUntil: {}, badVersion: '', loadFails: 0, note: '', libNote: '' };

/** 지어낸 위젯 코드: 돌리면 받은 설정을 위젯 자리에 적어 둔다. body를 주면 그것을 run의 몸통으로, top을 주면 맨 위에서 돌린다. */
const libCode = (version: string, body = 'host.Script.setWidget({ ran: cfg.version, base: cfg.baseVersion, handedOver: cfg.handedOver });', top = ''): string =>
  `${top}module.exports = { version: ${JSON.stringify(version)}, run: async (host, cfg) => { ${body} } };\n${LIB_END}\n`;
const THROWS = 'throw new Error("새 버전의 잘못");';
const HANGS = 'await new Promise(() => {});';

type Server = { version?: string; code?: string; chars?: number; versionStatus?: number; offline?: boolean };
function server(s: Server): (req: FakeRequest) => FakeAnswer {
  return (req) => {
    if (s.offline) throw new Error('연결할 수 없다');
    const code = s.code ?? libCode(s.version ?? NEW);
    if (req.url.includes('/widget/version.json')) return { status: s.versionStatus ?? 200, body: { version: s.version ?? NEW, chars: s.chars ?? code.length } };
    if (req.url.includes(`/widget/${LIB_NAME}.js`)) return { body: code };
    throw new Error(`모르는 주소: ${req.url}`);
  };
}
const make = (s: Server, o: FakeOptions = {}): FakeHost => makeFakeHost({ handler: server(s), ...o });
const urls = (h: FakeHost): string[] => h.state.requests.map((r) => r.url.replace('https://example.test', '').replace(/\?.*$/, ''));
/** 방금 확인을 마친 상태로 받아 둔 것. */
const cached = (version = NEW, state: Record<string, unknown> = {}, code = libCode(version)): Record<string, string> => ({
  [LIB_PATH]: code,
  [STATE_PATH]: JSON.stringify({ ...NONE, version, checkedAt: T0, triedAt: T0, ...state }),
});
/** 확인한 지 한 시간 된 상태(세 시간이 안 됐으므로 보통은 다시 묻지 않는다). */
const HOUR_AGO = { checkedAt: T0 - HOUR, triedAt: T0 - HOUR };
const self = () => vi.fn(async () => {});

describe('버전 견주기', () => {
  it('버전과 만든 날을 수로 읽는다. 그런 꼴이 아니면 null', () => {
    expect([versionKey('0.9.0 (2026-11-16)'), versionKey('1.10.2'), versionKey(''), versionKey(undefined), versionKey('v1'), versionKey('0.9 (2026-11-16)'), versionKey('1.0.0-rc.1')])
      .toEqual([[0, 9, 0, 20261116], [1, 10, 2, 0], null, null, null, null, null]);
  });
  it('번호가 크면 새 것이고, 번호가 같으면 만든 날이 늦은 쪽이 새 것이다', () => {
    expect([isNewer('0.9.1 (2026-11-16)', '0.9.0 (2026-11-20)'), isNewer('0.10.0 (2026-11-16)', '0.9.9 (2026-11-16)'), isNewer('0.9.0 (2026-11-17)', '0.9.0 (2026-11-16)')]).toEqual([true, true, true]);
    expect([isNewer(BASE, BASE), isNewer('0.8.9 (2026-12-01)', BASE), isNewer('', BASE), isNewer(NEW, undefined), isNewer('글', '글')]).toEqual([false, false, false, false, false]);
  });
});

describe('새 버전 확인', () => {
  it('새 버전이 있으면 위젯 코드를 받아 보관하고 적어 둔다. 앞의 것에 대해 적어 둔 것은 지운다', async () => {
    const h = make({}, { files: { [STATE_PATH]: JSON.stringify({ ...NONE, unfinished: { 'large|': 2 }, skipUntil: { 'large|': T0 + 10 }, badVersion: '0.9.0 (2026-11-18)', loadFails: 2, note: '연결할 수 없다', libNote: '옛 문제' }) } });
    const state = await checkForUpdate(h, cfg, at());
    expect(h.state.requests.map((r) => r.url)).toEqual([
      `https://example.test/widget/version.json?t=${T0}`,
      `https://example.test/widget/${LIB_NAME}.js?v=${encodeURIComponent(NEW)}`,
    ]);
    expect(h.state.files.get(LIB_PATH)).toBe(libCode(NEW));
    expect(state).toEqual({ ...NONE, version: NEW, checkedAt: T0, triedAt: T0 });
    expect(readUpdateState(h)).toEqual(state);
  });
  it('웹앱 주소 끝에 빗금이 있어도 같은 주소로 받는다', async () => {
    const h = make({});
    await checkForUpdate(h, { ...cfg, appUrl: 'https://example.test//' }, at());
    expect(urls(h)).toEqual(['/widget/version.json', `/widget/${LIB_NAME}.js`]);
  });
  it('붙여 넣은 것이나 받아 둔 것과 같거나 옛 버전이면 받지 않는다(옛 버전을 다시 배포해도 되돌아가지 않는다)', async () => {
    const same = make({ version: BASE });
    expect([(await checkForUpdate(same, cfg, at())).version, urls(same)]).toEqual(['', ['/widget/version.json']]);
    const have = make({ version: NEW }, { files: cached(NEW, { checkedAt: 0, triedAt: 0 }) });
    expect([(await checkForUpdate(have, cfg, at())).version, urls(have)]).toEqual([NEW, ['/widget/version.json']]);
    const older = make({ version: '0.8.3 (2026-11-16)' }, { files: cached(NEW, { checkedAt: 0, triedAt: 0 }) });
    expect([(await checkForUpdate(older, cfg, at())).version, older.state.files.get(LIB_PATH)]).toEqual([NEW, libCode(NEW)]);
  });
  it('위젯으로 돌 때는 확인한 지 세 시간 안이면 묻지 않고, 지나면 다시 묻는다. 앱 안에서는 늘 묻는다', async () => {
    const h = make({ version: BASE });
    await checkForUpdate(h, cfg, at());
    await checkForUpdate(h, cfg, at(3 * HOUR - 1));
    expect(urls(h)).toHaveLength(1);
    await checkForUpdate(h, cfg, at(3 * HOUR));
    expect(urls(h)).toHaveLength(2);
    const app = make({ version: BASE }, { runsInApp: true });
    await checkForUpdate(app, cfg, at());
    await checkForUpdate(app, cfg, at(1000));
    expect(urls(app)).toHaveLength(2);
  });
  it('확인을 앞당겨도(checkedAt 0) 물은 지 30분 안이면 묻지 않는다', async () => {
    const h = make({ version: BASE }, { files: { [STATE_PATH]: JSON.stringify({ ...NONE, triedAt: T0 }) } });
    await checkForUpdate(h, cfg, at(30 * MIN - 1));
    expect(urls(h)).toHaveLength(0);
    await checkForUpdate(h, cfg, at(30 * MIN));
    expect(urls(h)).toHaveLength(1);
  });
  it('확인하지 못하면 까닭을 적고 30분 뒤에 다시 한다. 받아 둔 것은 그대로이고, 확인이 되면 까닭을 지운다', async () => {
    const old = '0.9.1 (2026-11-18)';
    let offline = true;
    const h = makeFakeHost({ handler: (req) => server({ offline, version: old })(req), files: cached(old, { checkedAt: 0, triedAt: 0, libNote: '받아 둔 것의 문제' }) });
    expect(await checkForUpdate(h, cfg, at())).toEqual({ ...NONE, version: old, triedAt: T0, note: '연결할 수 없다', libNote: '받아 둔 것의 문제' });
    await checkForUpdate(h, cfg, at(30 * MIN - 1));
    expect(h.state.requests).toHaveLength(1);
    offline = false;
    expect(await checkForUpdate(h, cfg, at(30 * MIN))).toMatchObject({ version: old, checkedAt: T0 + 30 * MIN, note: '', libNote: '받아 둔 것의 문제' });
    expect(h.state.files.get(LIB_PATH)).toBe(libCode(old));
  });
  it('묻기 전에 물은 때를 적어 둔다: 받다가 위젯이 꺼져도 다음에 그릴 때 또 받지 않는다', async () => {
    let seen = '';
    const h = makeFakeHost({ handler: () => { seen = h.state.files.get(STATE_PATH) ?? ''; throw new Error('여기서 꺼졌다고 치자'); } });
    await checkForUpdate(h, cfg, at());
    expect(JSON.parse(seen)).toMatchObject({ triedAt: T0, checkedAt: 0 });
  });
  it('버전 파일이 없거나 꼴이 다르면 받지 않는다', async () => {
    const missing = make({ versionStatus: 404 });
    expect((await checkForUpdate(missing, cfg, at())).note).toBe('받지 못했다(404)');
    const odd = makeFakeHost({ handler: () => ({ body: { version: '새 것', chars: 3 } }) });
    expect([(await checkForUpdate(odd, cfg, at())).note, odd.state.files.has(LIB_PATH)]).toEqual(['버전 파일을 읽지 못했다', false]);
    const page = makeFakeHost({ handler: () => ({ body: '<!doctype html>' }) });
    expect((await checkForUpdate(page, cfg, at())).version).toBe('');
  });
  it('받다가 끊겼거나 끝 줄이 없는 파일은 보관하지 않는다', async () => {
    const length = libCode(NEW).length;
    const short = make({ chars: length + 10 });
    expect([(await checkForUpdate(short, cfg, at())).note, short.state.files.has(LIB_PATH)]).toEqual([`받은 ${NEW}이 온전하지 않다(${length}/${length + 10}자)`, false]);
    const cut = make({ code: 'module.exports = {};' });
    expect([(await checkForUpdate(cut, cfg, at())).version, cut.state.files.has(LIB_PATH)]).toEqual(['', false]);
  });
  it('파일을 쓰지 못해도 던지지 않는다', async () => {
    const h = make({});
    vi.spyOn(h.FileManager.local(), 'writeString').mockImplementation(() => { throw new Error('쓸 수 없다'); });
    expect((await checkForUpdate(h, cfg, at())).note).toBe('쓸 수 없다');
  });
});

describe('받아 둔 코드 읽기', () => {
  it('붙여 넣은 것보다 새 것이면 importModule로 읽는다', () => {
    const lib = loadCachedLib(make({}, { files: cached() }), cfg);
    expect([lib?.version, typeof lib?.run]).toEqual([NEW, 'function']);
  });
  it('importModule이 안 되거나 없으면 파일의 글로 읽는다', () => {
    expect(loadCachedLib(make({}, { files: cached(), failImport: true }), cfg)?.version).toBe(NEW);
    const none = make({}, { files: cached() });
    delete none.importModule;
    expect(loadCachedLib(none, cfg)?.version).toBe(NEW);
  });
  it('받아 둔 것이 없거나 새 것이 아니면 쓰지 않는다(적어 둔 것은 그대로다)', () => {
    expect(loadCachedLib(make({}), cfg)).toBeNull();
    for (const version of [BASE, '0.8.3 (2026-11-16)']) {
      const h = make({}, { files: cached(version) });
      expect([loadCachedLib(h, cfg), readUpdateState(h).version]).toEqual([null, version]);
    }
  });
  it('읽지 못하면 받아 둔 것을 버리고 까닭을 적고 확인을 앞당긴다. 다음 확인 때 다시 받는다', async () => {
    // 파일이 없다, 파일이 깨졌다, 적어 둔 버전과 파일의 버전이 다르다(쓰다가 끊긴 경우).
    const broken: Record<string, string>[] = [
      { [STATE_PATH]: cached()[STATE_PATH] },
      { ...cached(), [LIB_PATH]: 'module.exports = {' },
      { ...cached(), [LIB_PATH]: libCode(FIXED) },
    ];
    for (const files of broken) {
      const h = make({}, { files });
      expect(loadCachedLib(h, cfg)).toBeNull();
      expect(readUpdateState(h)).toMatchObject({ version: '', checkedAt: 0, triedAt: T0, badVersion: NEW, loadFails: 1 });
      expect(readUpdateState(h).libNote).toContain(`받아 둔 ${NEW}을 쓰지 못했다(`);
      // 물은 지 30분이 지나면(세 시간을 기다리지 않고) 같은 버전을 다시 받는다.
      expect((await checkForUpdate(h, cfg, at(30 * MIN))).version).toBe(NEW);
      expect(loadCachedLib(h, cfg)?.version).toBe(NEW);
    }
  });
  it('적어 둔 파일이 깨져 있으면 처음부터 다시 한다', () => {
    const h = make({}, { files: { [STATE_PATH]: '{', [LIB_PATH]: libCode(NEW) } });
    expect([readUpdateState(h), loadCachedLib(h, cfg)]).toEqual([NONE, null]);
    const odd = make({}, { files: { [STATE_PATH]: JSON.stringify({ version: 3, checkedAt: -5, triedAt: '어제', unfinished: { a: 2, b: 'x', c: -1 }, skipUntil: null, note: 7 }) } });
    expect(readUpdateState(odd)).toEqual({ ...NONE, unfinished: { a: 2 } });
    // 열쇠가 많으면 뒤쪽(새로 적은 쪽)의 스무 개만 남긴다.
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, n) => [`k${n}`, n + 1]));
    const crowded = make({}, { files: { [STATE_PATH]: JSON.stringify({ ...NONE, unfinished: many }) } });
    expect(Object.keys(readUpdateState(crowded).unfinished)).toEqual(Array.from({ length: 20 }, (_, n) => `k${n + 5}`));
  });
  it(`같은 버전을 ${MAX_LOAD_FAILS}번 잇달아 읽지 못하면 더 새 것이 나올 때까지 받지 않는다`, async () => {
    // 받을 때는 온전해 보이지만(글자 수와 끝 줄이 맞다) 읽으면 오류가 나는 코드.
    const unreadable = `throw new Error("이 아이폰에서는 읽히지 않는다");\n${LIB_END}\n`;
    let current: Server = { version: NEW, code: unreadable };
    const h = makeFakeHost({ handler: (req) => server(current)(req) });
    await checkForUpdate(h, cfg, at());
    expect([loadCachedLib(h, cfg), readUpdateState(h)]).toMatchObject([null, { version: '', badVersion: NEW, loadFails: 1, checkedAt: 0 }]);
    // 한 번은 다시 받아 본다(받다가 깨진 것일 수 있다).
    await checkForUpdate(h, cfg, at(30 * MIN));
    expect(readUpdateState(h).version).toBe(NEW);
    expect([loadCachedLib(h, cfg), readUpdateState(h)]).toMatchObject([null, { version: '', badVersion: NEW, loadFails: 2, checkedAt: T0 + 30 * MIN }]);
    // 그 뒤로는 같은 버전을 받지 않는다. 까닭은 남아 있다.
    await checkForUpdate(h, cfg, at(4 * HOUR));
    expect(urls(h)).toEqual(['/widget/version.json', `/widget/${LIB_NAME}.js`, '/widget/version.json', `/widget/${LIB_NAME}.js`, '/widget/version.json']);
    expect(readUpdateState(h).libNote).toContain(`받아 둔 ${NEW}을 쓰지 못했다(`);
    // 더 새 것이 나오면 받아서 쓴다.
    current = { version: FIXED };
    await checkForUpdate(h, cfg, at(8 * HOUR));
    expect([loadCachedLib(h, cfg)?.version, readUpdateState(h)]).toMatchObject([FIXED, { version: FIXED, badVersion: '', loadFails: 0, libNote: '' }]);
  });
});

describe('돌리기', () => {
  it('받아 둔 것이 없으면 붙여 넣은 것으로 그린 뒤에 새 버전을 받아 두고, 다음에는 그것으로 돈다', async () => {
    const h = make({});
    const mine = vi.fn(async () => { expect(h.state.requests).toHaveLength(0); }); // 그리기가 확인보다 먼저다
    await runWithUpdate(h, cfg, () => at(), mine);
    expect([mine.mock.calls.length, h.state.setWidgets, urls(h)]).toEqual([1, [], ['/widget/version.json', `/widget/${LIB_NAME}.js`]]);
    const again = self();
    await runWithUpdate(h, cfg, () => at(MIN), again);
    expect([again.mock.calls.length, h.state.setWidgets]).toEqual([0, [{ ran: NEW, base: BASE, handedOver: true }]]);
    expect(h.state.requests).toHaveLength(2); // 방금 확인했으므로 다시 묻지 않는다
    expect(readUpdateState(h).unfinished).toEqual({});
  });
  it('Scriptable 앱 안에서는 먼저 확인하고 바로 새 것으로 돈다', async () => {
    const h = make({}, { runsInApp: true });
    const mine = self();
    await runWithUpdate(h, cfg, () => at(), mine);
    expect([mine.mock.calls.length, h.state.setWidgets, h.state.requests.length]).toEqual([0, [{ ran: NEW, base: BASE, handedOver: true }], 2]);
  });
  it('넘겨받은 쪽, 버전을 모르는 스크립트, https가 아닌 주소의 스크립트는 업데이트 없이 돈다', async () => {
    for (const c of [{ ...cfg, handedOver: true }, { ...cfg, version: undefined }, { ...cfg, version: '시험' }, { ...cfg, appUrl: '' }, { ...cfg, appUrl: 'http://example.test' }]) {
      const h = make({}, { files: cached() });
      const mine = self();
      await runWithUpdate(h, c, () => at(), mine);
      expect([mine.mock.calls.length, h.state.requests.length, h.state.setWidgets.length]).toEqual([1, 0, 0]);
    }
  });
  it('받아 둔 코드를 읽지 못하면 붙여 넣은 것으로 그리고, 세 시간을 기다리지 않고 다시 받는다', async () => {
    const h = make({ version: NEW }, { files: cached(NEW, HOUR_AGO, 'throw new Error("깨짐")') });
    const mine = self();
    await runWithUpdate(h, cfg, () => at(), mine);
    expect([mine.mock.calls.length, h.state.setWidgets.length]).toEqual([1, 0]);
    expect([urls(h), readUpdateState(h).version, h.state.files.get(LIB_PATH)]).toEqual([['/widget/version.json', `/widget/${LIB_NAME}.js`], NEW, libCode(NEW)]);
    expect(readUpdateState(h).unfinished).toEqual({});
  });
  it('받아 둔 코드가 오류를 내면 그 자리에서 붙여 넣은 것으로 그리고, 고친 것이 나왔는지 바로 확인한다', async () => {
    const h = make({ version: FIXED }, { files: cached(NEW, HOUR_AGO, libCode(NEW, THROWS)) });
    const mine = self();
    await runWithUpdate(h, cfg, () => at(), mine);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(readUpdateState(h)).toEqual({ ...NONE, version: FIXED, checkedAt: T0, triedAt: T0 });
    // 다음에는 고친 것으로 돈다.
    const next = self();
    await runWithUpdate(h, cfg, () => at(MIN), next);
    expect([next.mock.calls.length, h.state.setWidgets]).toEqual([0, [{ ran: FIXED, base: BASE, handedOver: true }]]);
  });
  it('오류를 낸 것보다 새 것이 아직 없으면 한 시간 동안은 넘기지 않고 붙여 넣은 것으로만 그린다', async () => {
    const counting = libCode(NEW, `host.Script.setWidget("tried"); ${THROWS}`);
    const h = make({ version: NEW }, { files: cached(NEW, HOUR_AGO, counting) });
    const runs = async (ms: number) => { const mine = self(); await runWithUpdate(h, cfg, () => at(ms), mine); return mine.mock.calls.length; };
    expect([await runs(0), h.state.setWidgets.length]).toEqual([1, 1]);
    expect(readUpdateState(h)).toMatchObject({ version: NEW, skipUntil: { '|': T0 + SKIP_AFTER_ERROR_MS }, libNote: `받아 둔 ${NEW}이 오류를 냈다: 새 버전의 잘못` });
    // 쉬는 동안: 받아 둔 코드를 돌리지 않는다(위젯이 두 번 그려지지 않는다).
    expect([await runs(20 * MIN), await runs(SKIP_AFTER_ERROR_MS - 1), h.state.setWidgets.length]).toEqual([1, 1, 1]);
    // 한 시간이 지나면 다시 해 본다.
    expect([await runs(SKIP_AFTER_ERROR_MS), h.state.setWidgets.length]).toEqual([1, 2]);
    // 물은 것은 30분에 한 번을 넘지 않는다.
    expect(h.state.requests.length).toBeLessThanOrEqual(3);
  });
  it('시계가 뒤로 가도 한 시간을 넘겨 쉬지 않는다', async () => {
    const h = make({ version: NEW }, { files: cached(NEW, { skipUntil: { '|': T0 + 10 * HOUR } }) });
    const mine = self();
    await runWithUpdate(h, cfg, () => at(), mine);
    expect([mine.mock.calls.length, h.state.setWidgets.length]).toEqual([0, 1]);
  });
  it(`받아 둔 코드로 넘긴 위젯 실행이 ${MAX_UNFINISHED}번 잇달아 끝나지 못하면 한 번은 붙여 넣은 것으로 돌고 바로 확인한다`, async () => {
    // 끝나지 않는 새 버전: 아이폰이 위젯을 끄는 것을 흉내 내려고 기다리지 않고 버린다.
    const h = make({ version: FIXED }, { widgetFamily: 'large', files: cached(NEW, HOUR_AGO, libCode(NEW, HANGS)) });
    for (let n = 1; n <= MAX_UNFINISHED; n += 1) {
      const mine = self();
      void runWithUpdate(h, cfg, () => at(n * MIN), mine);
      await Promise.resolve();
      expect([mine.mock.calls.length, readUpdateState(h).unfinished, h.state.requests.length]).toEqual([0, { 'large|': n }, 0]);
    }
    const mine = self();
    await runWithUpdate(h, cfg, () => at(10 * MIN), mine);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(readUpdateState(h)).toEqual({ ...NONE, version: FIXED, checkedAt: T0 + 10 * MIN, triedAt: T0 + 10 * MIN });
    expect(urls(h)).toEqual(['/widget/version.json', `/widget/${LIB_NAME}.js`]);
  });
  it('읽는 도중에 멈추는 코드도 센다: 읽기 전에 적어 둔다', async () => {
    let seen: unknown = null;
    const h = make({ version: NEW }, { widgetFamily: 'medium', files: cached(NEW, {}, libCode(NEW, undefined, 'globalThis.__calfifSeen();\n')) });
    (globalThis as Record<string, unknown>).__calfifSeen = () => { seen = readUpdateState(h).unfinished; };
    try {
      await runWithUpdate(h, cfg, () => at(), self());
    } finally {
      delete (globalThis as Record<string, unknown>).__calfifSeen;
    }
    expect([seen, readUpdateState(h).unfinished]).toEqual([{ 'medium|': 1 }, {}]);
  });
  it('끝나지 못한 수는 위젯마다(크기와 매개변수) 따로 센다. 다른 위젯이 잘 끝나도 지워지지 않는다', async () => {
    const stuck = { 'large|image dark': MAX_UNFINISHED };
    const files = cached(NEW, { unfinished: stuck });
    const small = make({ version: NEW }, { widgetFamily: 'small', files });
    await runWithUpdate(small, cfg, () => at(), self());
    expect([small.state.setWidgets.length, readUpdateState(small).unfinished]).toEqual([1, stuck]);
    // 그 큰 위젯의 차례: 붙여 넣은 것으로 돌고, 자기 수만 지운다.
    const large = make({ version: NEW }, { widgetFamily: 'large', widgetParameter: 'image dark', files: cached(NEW, { unfinished: { ...stuck, 'small|': 1 } }) });
    const mine = self();
    await runWithUpdate(large, cfg, () => at(), mine);
    expect([mine.mock.calls.length, large.state.setWidgets.length, readUpdateState(large).unfinished]).toEqual([1, 0, { 'small|': 1 }]);
    expect(readUpdateState(large).libNote).toBe(`받아 둔 ${NEW}이 ${MAX_UNFINISHED}번 잇달아 끝나지 못해 붙여 넣은 것으로 돌았다`);
  });
  it('끝나지 못한 수는 잘 끝난 실행이 지우고, 앱 안의 실행은 세지도 지우지도 않는다', async () => {
    const h = make({ version: NEW }, { widgetFamily: 'large', files: cached(NEW, { unfinished: { 'large|': MAX_UNFINISHED - 1 } }) });
    await runWithUpdate(h, cfg, () => at(), self());
    expect([readUpdateState(h).unfinished, h.state.setWidgets.length]).toEqual([{}, 1]);
    const stuck = { '|': MAX_UNFINISHED };
    const app = make({ version: NEW }, { runsInApp: true, files: cached(NEW, { unfinished: stuck }) });
    await runWithUpdate(app, cfg, () => at(), self());
    expect([app.state.setWidgets.length, readUpdateState(app).unfinished]).toEqual([1, stuck]);
    const failing = make({ version: NEW }, { runsInApp: true, files: cached(NEW, { unfinished: stuck }, libCode(NEW, THROWS)) });
    const mine = self();
    await runWithUpdate(failing, cfg, () => at(), mine);
    expect([mine.mock.calls.length, readUpdateState(failing).unfinished]).toEqual([1, stuck]);
  });
  it('쉬는 것도 위젯마다 따로다: 한 위젯에서만 오류를 내는 버전은 그 위젯만 붙여 넣은 것으로 돌고, 앱 안의 실행도 따로 본다', async () => {
    const onlySmall = libCode(NEW, 'if (host.config.widgetFamily === "small") throw new Error("작은 위젯의 잘못"); host.Script.setWidget("new");');
    const files = cached(NEW, {}, onlySmall);
    const small = make({ version: NEW }, { widgetFamily: 'small', files });
    const mine = self();
    await runWithUpdate(small, cfg, () => at(), mine);
    expect([mine.mock.calls.length, readUpdateState(small).skipUntil]).toEqual([1, { 'small|': T0 + SKIP_AFTER_ERROR_MS }]);
    // 같은 적어 둔 것으로 큰 위젯과 앱을 돌린다: 쉬지 않고 새 것으로 돈다.
    const resting = { ...files, [STATE_PATH]: small.state.files.get(STATE_PATH)! };
    for (const o of [{ widgetFamily: 'large' }, { runsInApp: true }]) {
      const h = make({ version: NEW }, { ...o, files: resting });
      const base = self();
      await runWithUpdate(h, cfg, () => at(MIN), base);
      expect([base.mock.calls.length, h.state.setWidgets]).toEqual([0, ['new']]);
    }
    // 그 작은 위젯은 한 시간 동안 붙여 넣은 것으로만 돈다.
    const again = make({ version: NEW }, { widgetFamily: 'small', files: resting });
    const base = self();
    await runWithUpdate(again, cfg, () => at(MIN), base);
    expect([base.mock.calls.length, again.state.setWidgets]).toEqual([1, []]);
  });
  it('연결이 안 돼도 그린다', async () => {
    const h = make({ offline: true });
    const mine = self();
    await runWithUpdate(h, cfg, () => at(), mine);
    expect([mine.mock.calls.length, readUpdateState(h).note]).toEqual([1, '연결할 수 없다']);
  });
  it('붙여 넣은 스크립트를 더 새 것으로 바꾸면 받아 둔 옛 것은 쓰지 않는다', async () => {
    const h = make({ version: NEW }, { files: cached() });
    const mine = self();
    await runWithUpdate(h, { ...cfg, version: '0.9.2 (2026-11-22)' }, () => at(), mine);
    expect([mine.mock.calls.length, h.state.setWidgets.length]).toEqual([1, 0]);
  });
  it('적어 둔 파일을 읽고 쓸 수 없어도 붙여 넣은 것으로 그린다', async () => {
    const h = make({});
    const fm = h.FileManager.local();
    vi.spyOn(fm, 'readString').mockImplementation(() => { throw new Error('읽을 수 없다'); });
    vi.spyOn(fm, 'fileExists').mockImplementation(() => { throw new Error('볼 수 없다'); });
    vi.spyOn(fm, 'writeString').mockImplementation(() => { throw new Error('쓸 수 없다'); });
    const mine = self();
    await runWithUpdate(h, cfg, () => at(), mine);
    expect(mine).toHaveBeenCalledTimes(1);
  });
});

describe('메뉴의 한 줄', () => {
  it('스스로 받는다고 알리고, 넘겨받았으면 붙여 넣은 버전을, 문제가 있었으면 그 까닭을 적는다', () => {
    const h = make({});
    expect(updateLine(h, cfg)).toBe('새 버전이 나오면 스스로 받습니다.');
    expect(updateLine(h, { ...cfg, version: NEW, handedOver: true, baseVersion: BASE })).toBe(`자동으로 받은 버전입니다(붙여 넣은 스크립트는 ${BASE}).`);
    const failed = make({}, { files: { [STATE_PATH]: JSON.stringify({ ...NONE, triedAt: 1, note: '연결할 수 없다', libNote: `받아 둔 ${NEW}이 오류를 냈다: 잘못` }) } });
    expect(updateLine(failed, cfg)).toBe(`새 버전이 나오면 스스로 받습니다. 마지막 확인: 연결할 수 없다 받아 둔 ${NEW}이 오류를 냈다: 잘못`);
    expect(updateLine(h, { ...cfg, version: undefined })).toBe('');
  });
});
