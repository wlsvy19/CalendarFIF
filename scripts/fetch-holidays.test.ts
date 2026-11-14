import { describe, expect, it } from 'vitest';
import {
  API_URL, buildOutput, encodeKey, fetchYears, koreaYear, main, maskKey, parseMonthResponse, parsePrevious, requestUrl, serialize,
  type Day, type HolidayFile, type MainDeps, type TextAnswer,
} from './fetch-holidays.mjs';

// 시험 자료는 모두 지어낸 것이다. 인증키도 실제 키가 아니다.
const KEY = 'test-key+/=';
const ENCODED = encodeURIComponent(KEY);

const item = (locdate: number | string, dateName: string, isHoliday = 'Y', seq = 1) => ({ dateKind: '01', dateName, isHoliday, locdate, seq });
/** 특일 정보가 JSON으로 주는 정상 답. 항목이 하나면 item이 배열이 아니고, 없으면 items가 빈 글이다. */
function okBody(items: object[]): string {
  const packed = items.length === 0 ? '' : { item: items.length === 1 ? items[0] : items };
  return JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { items: packed, numOfRows: 50, pageNo: 1, totalCount: items.length } } });
}
const ok = (items: object[]): TextAnswer => ({ status: 200, text: okBody(items) });
const keyErrorJson = (msg = 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', code = '30') =>
  JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE ERROR', returnAuthMsg: msg, returnReasonCode: code } } });
const keyErrorXml = (msg = 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', code = '30') =>
  `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>${msg}</returnAuthMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

// 지어낸 공휴일 표. 해마다 달마다 이 표의 것을 돌려주는 가짜 서버를 만든다.
const TABLE: Record<string, string> = {
  '2026-01-01': '1월1일', '2026-02-16': '설날', '2026-02-17': '설날', '2026-02-18': '설날', '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)',
  '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-06-03': '전국동시지방선거', '2026-06-06': '현충일', '2026-08-15': '광복절',
  '2026-09-25': '추석', '2026-10-03': '개천절', '2026-10-09': '한글날', '2026-12-25': '기독탄신일',
  '2027-01-01': '1월1일', '2027-02-07': '설날', '2027-05-05': '어린이날', '2027-12-25': '기독탄신일',
};
const monthOf = (url: string) => {
  const q = new URL(url).searchParams;
  return { year: Number(q.get('solYear')), month: Number(q.get('solMonth')) };
};
/** 표의 것을 주는 가짜 서버. override가 답을 주면 그것을 쓴다. */
function server(override?: (year: number, month: number, call: number) => TextAnswer | undefined) {
  const urls: string[] = [];
  const fetchText = async (url: string): Promise<TextAnswer> => {
    urls.push(url);
    const { year, month } = monthOf(url);
    const special = override?.(year, month, urls.length);
    if (special) return special;
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const items = Object.entries(TABLE).filter(([d]) => d.startsWith(prefix)).map(([d, n], i) => item(Number(d.replaceAll('-', '')), n, 'Y', i + 1));
    return ok(items);
  };
  return { urls, fetchText };
}
const noSleep = async () => {};
const days = (year: string): Day[] => Object.entries(TABLE).filter(([d]) => d.startsWith(`${year}-`)).map(([date, name]) => ({ date, name }));

describe('요청 주소와 인증키', () => {
  it('키에 %가 없으면 인코딩하고, 있으면 그대로 쓴다', () => {
    expect(encodeKey(KEY)).toBe(ENCODED);
    expect(encodeKey(ENCODED)).toBe(ENCODED);
  });

  it('달마다 한 번 묻는다: solYear, 두 자리 solMonth, 50줄, JSON', () => {
    const url = requestUrl(2026, 3, KEY);
    expect(url.startsWith(`${API_URL}?`)).toBe(true);
    const q = new URL(url).searchParams;
    expect([q.get('solYear'), q.get('solMonth'), q.get('numOfRows'), q.get('_type'), q.get('ServiceKey')]).toEqual(['2026', '03', '50', 'json', KEY]);
    expect(url).toContain(`ServiceKey=${ENCODED}`);
  });

  it('글 속의 키를 가린다(인코딩한 꼴도)', () => {
    expect(maskKey(`a ${KEY} b ${ENCODED} c`, KEY)).toBe('a *** b *** c');
    expect(maskKey(`주소 ${requestUrl(2026, 1, KEY)}`, KEY)).not.toContain('test-key');
    expect(maskKey('그대로', '')).toBe('그대로');
  });

  it('한국 시각의 해', () => {
    expect(koreaYear(Date.UTC(2026, 11, 31, 14, 59, 59))).toBe(2026);
    expect(koreaYear(Date.UTC(2026, 11, 31, 15, 0, 0))).toBe(2027);
  });
});

describe('parseMonthResponse: 한 달의 답', () => {
  it('공휴일인 것만 날짜와 이름으로', () => {
    const answer = okBody([item(20260301, '삼일절'), item(20260302, '대체공휴일(삼일절)', 'Y', 2), item(20260315, '어떤 기념일', 'N', 3)]);
    expect(parseMonthResponse(200, answer, 2026, 3)).toEqual({ ok: true, days: [{ date: '2026-03-01', name: '삼일절' }, { date: '2026-03-02', name: '대체공휴일(삼일절)' }] });
  });

  it('항목이 하나면 item이 객체다', () => {
    expect(parseMonthResponse(200, okBody([item(20261225, '기독탄신일')]), 2026, 12)).toEqual({ ok: true, days: [{ date: '2026-12-25', name: '기독탄신일' }] });
  });

  it('공휴일이 없는 달은 items가 빈 글이고 성공이다', () => {
    expect(parseMonthResponse(200, okBody([]), 2026, 4)).toEqual({ ok: true, days: [] });
  });

  it('날짜가 글이어도 읽고, 그 달이 아니거나 없는 날짜는 버린다', () => {
    const answer = okBody([item('20260505', '어린이날'), item(20260230, '없는 날'), item(20270505, '다른 해'), item(20260605, '다른 달'), item(2026055, '모양이 다른 날')]);
    expect(parseMonthResponse(200, answer, 2026, 5)).toEqual({ ok: true, days: [{ date: '2026-05-05', name: '어린이날' }] });
  });

  it('이름은 앞뒤 공백을 떼고 30자까지 자르며, 빈 이름은 버린다', () => {
    const long = '가'.repeat(35);
    const answer = okBody([item(20260101, ' 1월1일 '), item(20260102, long), item(20260103, '  '), item(20260104, 7 as unknown as string)]);
    expect(parseMonthResponse(200, answer, 2026, 1)).toEqual({ ok: true, days: [{ date: '2026-01-01', name: '1월1일' }, { date: '2026-01-02', name: '가'.repeat(30) }] });
  });

  it('인증키 오류(JSON, XML)는 실패이고 키 문제다', () => {
    for (const text of [keyErrorJson(), keyErrorXml()]) {
      const r = parseMonthResponse(200, text, 2026, 1);
      expect(r).toMatchObject({ ok: false, keyProblem: true });
      expect(r.ok ? '' : r.reason).toContain('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
    }
    for (const [msg, code] of [['DEADLINE_HAS_EXPIRED_ERROR', '31'], ['LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', '22'], ['SERVICE_KEY_IS_NULL', '30']]) {
      expect(parseMonthResponse(200, keyErrorJson(msg, code), 2026, 1)).toMatchObject({ ok: false, keyProblem: true });
    }
  });

  it('그 밖의 오류는 실패이지만 키 문제가 아니다', () => {
    const app = JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE ERROR', returnAuthMsg: 'APPLICATION_ERROR', returnReasonCode: '1' } } });
    expect(parseMonthResponse(200, app, 2026, 1)).toMatchObject({ ok: false, keyProblem: false, reason: expect.stringContaining('APPLICATION_ERROR') });
    const result = JSON.stringify({ response: { header: { resultCode: '99', resultMsg: 'UNKNOWN ERROR' }, body: {} } });
    expect(parseMonthResponse(200, result, 2026, 1)).toMatchObject({ ok: false, keyProblem: false, reason: expect.stringContaining('99') });
    expect(parseMonthResponse(500, 'Internal Server Error', 2026, 1)).toMatchObject({ ok: false, keyProblem: false, reason: expect.stringContaining('500') });
    expect(parseMonthResponse(200, '<html>점검 중</html>', 2026, 1)).toMatchObject({ ok: false, keyProblem: false });
    expect(parseMonthResponse(200, JSON.stringify({ response: { header: { resultCode: '00' } } }), 2026, 1)).toMatchObject({ ok: false, keyProblem: false });
    expect(parseMonthResponse(200, JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: 'x' } } } }), 2026, 1)).toMatchObject({ ok: false });
  });

  it('HTTP 401과 403은 키 문제다', () => {
    expect(parseMonthResponse(401, 'Unauthorized', 2026, 1)).toMatchObject({ ok: false, keyProblem: true, reason: expect.stringContaining('401') });
    expect(parseMonthResponse(403, 'Forbidden', 2026, 1)).toMatchObject({ ok: false, keyProblem: true });
  });

  it('HTTP 오류여도 본문에 오류 이름이 있으면 그것을 알린다', () => {
    expect(parseMonthResponse(500, keyErrorXml('SERVICE_ACCESS_DENIED_ERROR', '20'), 2026, 1)).toMatchObject({ ok: false, keyProblem: true, reason: expect.stringContaining('SERVICE_ACCESS_DENIED_ERROR') });
  });
});

describe('fetchYears: 해마다 열두 달을 차례로 묻는다', () => {
  it('두 해 24번을 차례로, 사이마다 잠깐 쉬며 묻는다', async () => {
    const s = server();
    const pauses: number[] = [];
    const r = await fetchYears([2026, 2027], { key: KEY, fetchText: s.fetchText, sleep: async (ms) => void pauses.push(ms) });
    expect(s.urls.map(monthOf)).toEqual([2026, 2027].flatMap((year) => Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }))));
    expect(pauses).toEqual(Array(23).fill(200));
    expect(r.fatal).toBeNull();
    expect(r.years).toEqual({ 2026: { ok: true, days: days('2026') }, 2027: { ok: true, days: days('2027') } });
  });

  it('한 달이라도 실패하면 그해는 실패다(남은 달은 묻지 않고 다음 해로 간다)', async () => {
    const s = server((year, month) => (year === 2026 && month === 5 ? { status: 500, text: 'Internal Server Error' } : undefined));
    const r = await fetchYears([2026, 2027], { key: KEY, fetchText: s.fetchText, sleep: noSleep });
    expect(r.years[2026]).toMatchObject({ ok: false, reason: expect.stringContaining('5월') });
    expect(r.years[2027]).toEqual({ ok: true, days: days('2027') });
    expect(s.urls).toHaveLength(5 + 12);
  });

  it('첫 요청이 키 문제로 실패하면 바로 그만둔다', async () => {
    const s = server(() => ({ status: 200, text: keyErrorXml() }));
    const r = await fetchYears([2026, 2027], { key: KEY, fetchText: s.fetchText, sleep: noSleep });
    expect(s.urls).toHaveLength(1);
    expect(r.fatal).toContain('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
  });

  it('첫 요청이 키 문제가 아닌 까닭으로 실패하면 계속한다', async () => {
    const s = server((_y, _m, call) => (call === 1 ? { status: 503, text: '' } : undefined));
    const r = await fetchYears([2026, 2027], { key: KEY, fetchText: s.fetchText, sleep: noSleep });
    expect(r.fatal).toBeNull();
    expect(r.years[2026].ok).toBe(false);
    expect(r.years[2027].ok).toBe(true);
  });

  it('연결 오류의 글에 키가 있어도 가린다', async () => {
    const fetchText = async (url: string): Promise<TextAnswer> => {
      throw new Error(`fetch failed: ${url}`);
    };
    const r = await fetchYears([2026], { key: KEY, fetchText, sleep: noSleep });
    const reason = r.years[2026].ok ? '' : r.years[2026].reason;
    expect(reason).toContain('연결');
    expect(reason).not.toContain('test-key');
    expect(reason).not.toContain(ENCODED);
  });
});

describe('buildOutput: 올릴 파일', () => {
  const now = new Date('2026-11-14T18:23:05.000Z');
  const previous: HolidayFile = {
    version: 1,
    updatedAt: '2026-11-13T18:23:04.000Z',
    years: { 2025: { days: [{ date: '2025-01-01', name: '1월1일' }] }, 2026: { days: days('2026') }, 2027: { days: [{ date: '2027-01-01', name: '1월1일' }] } },
  };

  it('받은 해를 날짜와 이름 순으로, 같은 것은 한 번만', () => {
    const mixed = [{ date: '2026-02-17', name: '설날' }, { date: '2026-01-01', name: '1월1일' }, { date: '2026-06-03', name: '임시공휴일' }, { date: '2026-06-03', name: '대통령선거일' }, { date: '2026-01-01', name: '1월1일' }];
    const { file } = buildOutput({ fetched: { 2026: { ok: true, days: mixed }, 2027: { ok: true, days: days('2027') } }, previous: null, currentYear: 2026, now });
    expect(file).toEqual({
      version: 1,
      updatedAt: '2026-11-14T18:23:05.000Z',
      years: {
        2026: { days: [{ date: '2026-01-01', name: '1월1일' }, { date: '2026-02-17', name: '설날' }, { date: '2026-06-03', name: '대통령선거일' }, { date: '2026-06-03', name: '임시공휴일' }] },
        2027: { days: days('2027') },
      },
    });
  });

  it('받지 못한 해와 공휴일이 하나도 없는 해는 지난 자료를 그대로 두고, 지난해의 것은 뺀다', () => {
    const { file, lines } = buildOutput({ fetched: { 2026: { ok: true, days: [] }, 2027: { ok: false, reason: '5월: HTTP 500' } }, previous, currentYear: 2026, now });
    expect(file).toBeNull(); // 둘 다 쓸 수 없으면 쓰지 않는다
    expect(lines.join('\n')).toContain('HTTP 500');
    const next = buildOutput({ fetched: { 2026: { ok: true, days: days('2026').slice(0, 3) }, 2027: { ok: false, reason: '5월: HTTP 500' } }, previous, currentYear: 2026, now });
    expect(Object.keys(next.file!.years)).toEqual(['2026', '2027']);
    expect(next.file!.years[2027]).toEqual(previous.years[2027]);
    expect(next.file!.years[2026].days).toHaveLength(3);
    expect(next.lines.join('\n')).toMatch(/2027년.*지난 자료/);
  });

  it('지난 자료도 없으면 그해를 뺀다', () => {
    const { file, lines } = buildOutput({ fetched: { 2026: { ok: true, days: days('2026') }, 2027: { ok: true, days: [] } }, previous: null, currentYear: 2026, now });
    expect(Object.keys(file!.years)).toEqual(['2026']);
    expect(lines.join('\n')).toMatch(/2027년.*뺀다/);
  });

  it('내용이 같으면 updatedAt을 그대로 두어 같은 파일이 된다', () => {
    const same = { ...previous, years: { 2026: previous.years[2026], 2027: previous.years[2027] } };
    const { file, changed } = buildOutput({ fetched: { 2026: { ok: true, days: days('2026') }, 2027: { ok: true, days: [{ date: '2027-01-01', name: '1월1일' }] } }, previous: same, currentYear: 2026, now });
    expect(changed).toBe(false);
    expect(serialize(file!)).toBe(serialize(same));
  });

  it('내용이 바뀌면 updatedAt을 새로 적는다(지난해를 뺀 것도 바뀐 것이다)', () => {
    const { file, changed } = buildOutput({ fetched: { 2026: { ok: true, days: days('2026') }, 2027: { ok: true, days: [{ date: '2027-01-01', name: '1월1일' }] } }, previous, currentYear: 2026, now });
    expect(changed).toBe(true);
    expect(file!.updatedAt).toBe('2026-11-14T18:23:05.000Z');
    expect(Object.keys(file!.years)).toEqual(['2026', '2027']);
  });
});

describe('parsePrevious와 serialize', () => {
  it('지난 파일을 읽고, 잘못된 해는 빼고, 모르는 칸은 버린다', () => {
    const text = JSON.stringify({ version: 1, updatedAt: '2026-11-13T18:23:04.000Z', years: { 2026: { complete: true, days: days('2026') }, 2027: { days: [{ date: '2027-02-30', name: 'x' }] }, 27: { days: [] } } });
    expect(parsePrevious(text)).toEqual({ version: 1, updatedAt: '2026-11-13T18:23:04.000Z', years: { 2026: { days: days('2026') } } });
  });

  it('읽을 수 없으면 null', () => {
    for (const text of ['', '{', 'null', '[]', '{"version":2,"years":{}}', '{"version":1}']) expect(parsePrevious(text)).toBeNull();
  });

  it('두 칸 들여쓰기와 마지막 줄바꿈', () => {
    const text = serialize({ version: 1, updatedAt: 'T', years: { 2026: { days: [{ date: '2026-01-01', name: '1월1일' }] } } });
    expect(text).toBe('{\n  "version": 1,\n  "updatedAt": "T",\n  "years": {\n    "2026": {\n      "days": [\n        {\n          "date": "2026-01-01",\n          "name": "1월1일"\n        }\n      ]\n    }\n  }\n}\n');
  });
});

describe('main: 명령줄', () => {
  function harness(opts: { key?: string; files?: Record<string, string>; fetchText?: (url: string) => Promise<TextAnswer>; argv?: string[]; githubOutput?: boolean } = {}) {
    const files = new Map(Object.entries(opts.files ?? {}));
    const logs: string[] = [];
    const s = server();
    const fetchText = opts.fetchText ?? s.fetchText;
    const calls: string[] = [];
    const deps: MainDeps = {
      argv: opts.argv ?? ['--out', '/out/holidays.json', '--previous', '/in/previous.json'],
      env: { ...(opts.key === undefined ? {} : { DATA_GO_KR_KEY: opts.key }), ...(opts.githubOutput === false ? {} : { GITHUB_OUTPUT: '/gh/output' }) },
      fetchText: async (url) => {
        calls.push(url);
        return fetchText(url);
      },
      sleep: noSleep,
      now: () => new Date('2026-11-14T18:23:05.000Z'),
      files: {
        read: (path) => files.get(path) ?? null,
        write: (path, text) => void files.set(path, text),
        append: (path, text) => void files.set(path, (files.get(path) ?? '') + text),
      },
      log: (line) => void logs.push(line),
      error: (line) => void logs.push(line),
    };
    return { deps, files, logs, calls };
  }

  it('키가 없으면 건너뛰었다고 한 줄 알리고, 아무것도 쓰지 않고 성공한다', async () => {
    for (const key of [undefined, '', '  ']) {
      const h = harness({ key });
      expect(await main(h.deps)).toBe(0);
      expect(h.calls).toEqual([]);
      expect(h.logs).toHaveLength(1);
      expect(h.logs[0]).toContain('DATA_GO_KR_KEY');
      expect(h.files.has('/out/holidays.json')).toBe(false);
      expect(h.files.get('/gh/output')).toBe('skipped=true\n');
    }
  });

  it('GITHUB_OUTPUT이 없어도 건너뛴다', async () => {
    const h = harness({ githubOutput: false });
    expect(await main(h.deps)).toBe(0);
    expect([...h.files.keys()]).toEqual([]);
  });

  it('받아서 쓰고 요약을 알린다. 출력 어디에도 키가 없다', async () => {
    const h = harness({ key: KEY });
    expect(await main(h.deps)).toBe(0);
    expect(h.calls).toHaveLength(24);
    const written = JSON.parse(h.files.get('/out/holidays.json')!) as HolidayFile;
    expect(written).toEqual({ version: 1, updatedAt: '2026-11-14T18:23:05.000Z', years: { 2026: { days: days('2026') }, 2027: { days: days('2027') } } });
    expect(h.files.get('/out/holidays.json')!.endsWith('}\n')).toBe(true);
    expect(h.files.get('/gh/output')).toBe('skipped=false\n');
    const all = h.logs.join('\n');
    expect(all).toMatch(/2026년.*15일/);
    expect(all).not.toContain('test-key');
    expect(all).not.toContain(ENCODED);
  });

  it('지난 파일과 내용이 같으면 같은 바이트로 쓴다', async () => {
    const before = harness({ key: KEY });
    await main(before.deps);
    const previous = before.files.get('/out/holidays.json')!.replace('2026-11-14T18:23:05.000Z', '2026-11-10T18:23:05.000Z');
    const h = harness({ key: KEY, files: { '/in/previous.json': previous } });
    expect(await main(h.deps)).toBe(0);
    expect(h.files.get('/out/holidays.json')).toBe(previous);
  });

  it('한 해를 받지 못하면 지난 파일의 그해를 쓴다', async () => {
    const previous = serialize({ version: 1, updatedAt: '2026-11-13T18:23:04.000Z', years: { 2027: { days: [{ date: '2027-01-01', name: '1월1일' }] } } });
    const s = server((year, month) => (year === 2027 && month === 3 ? { status: 200, text: keyErrorJson('APPLICATION_ERROR', '1') } : undefined));
    const h = harness({ key: KEY, files: { '/in/previous.json': previous }, fetchText: s.fetchText });
    expect(await main(h.deps)).toBe(0);
    const written = JSON.parse(h.files.get('/out/holidays.json')!) as HolidayFile;
    expect(written.years[2027]).toEqual({ days: [{ date: '2027-01-01', name: '1월1일' }] });
    expect(written.years[2026]).toEqual({ days: days('2026') });
    expect(h.logs.join('\n')).toMatch(/2027년.*3월.*APPLICATION_ERROR/);
  });

  it('모든 해를 받지 못하면 쓰지 않고 실패한다', async () => {
    const h = harness({ key: KEY, fetchText: async () => ({ status: 503, text: '' }) });
    expect(await main(h.deps)).toBe(1);
    expect(h.files.has('/out/holidays.json')).toBe(false);
    expect(h.files.get('/gh/output')).toBe('skipped=false\n');
  });

  it('첫 요청이 키 문제면 한 번만 묻고 쓰지 않고 실패한다', async () => {
    const h = harness({ key: KEY, files: { '/in/previous.json': serialize({ version: 1, updatedAt: 'T', years: { 2026: { days: days('2026') } } }) }, fetchText: async () => ({ status: 200, text: keyErrorXml() }) });
    expect(await main(h.deps)).toBe(1);
    expect(h.calls).toHaveLength(1);
    expect(h.files.has('/out/holidays.json')).toBe(false);
    expect(h.logs.join('\n')).toContain('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
    expect(h.logs.join('\n')).not.toContain('test-key');
  });

  it('지난 파일이 없거나 깨졌으면 없는 것으로 본다', async () => {
    const h = harness({ key: KEY, files: { '/in/previous.json': '{' } });
    expect(await main(h.deps)).toBe(0);
    expect(h.files.has('/out/holidays.json')).toBe(true);
  });

  it('--out이 없으면 쓰는 법을 알리고 실패한다', async () => {
    const h = harness({ key: KEY, argv: [] });
    expect(await main(h.deps)).toBe(2);
    expect(h.calls).toEqual([]);
    expect(h.logs.join('\n')).toContain('--out');
  });
});
