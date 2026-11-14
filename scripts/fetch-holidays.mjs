// 공공데이터포털의 「한국천문연구원_특일 정보」에서 공휴일을 받아 holidays.json 하나를 만든다.
// GitHub Actions(.github/workflows/holidays.yml)가 하루에 한 번 돌리고, 만든 파일을 holiday-data 가지에 올린다.
//
// 쓰는 법: node scripts/fetch-holidays.mjs --out <파일> [--previous <지난 파일>]
// 인증키는 환경 변수 DATA_GO_KR_KEY에서 읽는다. 키는 출력에 쓰지 않고, 오류 글에 섞여도 가린다.
// 의존성이 없는 Node(20 이상) 스크립트다. 순수한 부분을 내보내 시험한다(scripts/fetch-holidays.test.ts, 형은 fetch-holidays.d.mts).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const ROWS = 50; // 한 달의 공휴일은 이보다 훨씬 적다
const PAUSE_MS = 200; // 요청 사이에 쉬는 시간
const TIMEOUT_MS = 20_000;
const NAME_MAX = 30;
const KST_OFFSET_MS = 9 * 3_600_000;

// 인증키 쪽의 문제: 다시 물어도 같은 답이 온다. 첫 요청이 이것이면 남은 요청을 하지 않는다.
// 등록되지 않은 키, 키 없음, 활용 기간 만료, 서비스 접근 거부, 등록되지 않은 IP, 하루 사용 한도 초과.
const KEY_PROBLEMS = [
  'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', 'SERVICE_KEY_IS_NULL', 'DEADLINE_HAS_EXPIRED_ERROR', 'SERVICE_ACCESS_DENIED_ERROR',
  'UNREGISTERED_IP_ERROR', 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
];
const KEY_REASON_CODES = ['20', '22', '30', '31', '32'];

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const pad2 = (n) => String(n).padStart(2, '0');
const text = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** 키에 %가 있으면 이미 인코딩한 키(공공데이터포털의 Encoding 키)로 보고 그대로, 아니면 인코딩한다. */
export function encodeKey(key) {
  return key.includes('%') ? key : encodeURIComponent(key);
}

/** 그해 그달의 특일 정보(공휴일)를 묻는 주소. 키가 들어 있으므로 출력하지 않는다. */
export function requestUrl(year, month, key) {
  return `${API_URL}?solYear=${year}&solMonth=${pad2(month)}&numOfRows=${ROWS}&_type=json&ServiceKey=${encodeKey(key)}`;
}

/** 글 속의 키(그대로의 꼴, 인코딩한 꼴, 풀어 쓴 꼴)를 ***로 바꾼다. 긴 꼴부터 바꾼다. */
export function maskKey(message, key) {
  let decoded = key;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    // 풀 수 없는 키는 그대로의 꼴만 가린다.
  }
  const forms = [...new Set([key, encodeKey(key), encodeURIComponent(key), decoded])].filter((f) => f !== '').sort((a, b) => b.length - a.length);
  let out = String(message);
  for (const form of forms) out = out.split(form).join('***');
  return out;
}

/** 한국 시각(UTC+9)의 해. */
export function koreaYear(nowMs) {
  return new Date(nowMs + KST_OFFSET_MS).getUTCFullYear();
}

/** YYYYMMDD(숫자나 글)를 그해 그달의 실제 날짜 YYYY-MM-DD로. 아니면 null. */
function dateOf(locdate, year, month) {
  const raw = text(locdate);
  if (!/^\d{8}$/.test(raw)) return null;
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (!date.startsWith(`${year}-${pad2(month)}-`)) return null;
  const ms = Date.UTC(year, month - 1, Number(raw.slice(6, 8)));
  return new Date(ms).toISOString().slice(0, 10) === date ? date : null;
}

/** 이름: 앞뒤 공백을 떼고 30자까지. 비면 null. */
function nameOf(value) {
  if (typeof value !== 'string') return null;
  const name = Array.from(value.trim()).slice(0, NAME_MAX).join('');
  return name === '' ? null : name;
}

/** 오류 답(JSON의 OpenAPI_ServiceResponse 또는 같은 이름의 XML)에서 오류 이름과 코드를 꺼낸다. 없으면 null. */
function serviceError(json, raw) {
  let header = null;
  if (isObject(json) && isObject(json.OpenAPI_ServiceResponse)) header = json.OpenAPI_ServiceResponse.cmmMsgHeader ?? {};
  else if (json === undefined && /<OpenAPI_ServiceResponse>|<cmmMsgHeader>/.test(raw)) {
    const tag = (name) => (new RegExp(`<${name}>([^<]*)</${name}>`).exec(raw)?.[1] ?? '').trim();
    header = { errMsg: tag('errMsg'), returnAuthMsg: tag('returnAuthMsg'), returnReasonCode: tag('returnReasonCode') };
  }
  if (header === null) return null;
  const h = isObject(header) ? header : {};
  const name = text(h.returnAuthMsg) || text(h.errMsg) || '알 수 없는 오류';
  const code = text(h.returnReasonCode);
  return { name, code };
}

/** XML로 온 보통 답의 결과 코드(_type=json이 듣지 않은 경우). */
function xmlResult(raw) {
  const code = /<resultCode>([^<]*)<\/resultCode>/.exec(raw)?.[1]?.trim();
  if (code === undefined) return null;
  return { code, msg: (/<resultMsg>([^<]*)<\/resultMsg>/.exec(raw)?.[1] ?? '').trim() };
}

const fail = (reason, keyProblem = false) => ({ ok: false, reason, keyProblem });

/**
 * 한 달의 답을 읽는다. 공휴일(isHoliday Y)만 { date, name }으로 돌려준다. 그 달이 아니거나 없는 날짜, 빈 이름은 버린다.
 * 공휴일이 없는 달은 items가 빈 글이고 성공이다. 오류 답, HTTP 오류, 00이 아닌 resultCode는 실패이고,
 * 인증키 쪽의 문제(keyProblem)인지 알린다.
 */
export function parseMonthResponse(status, raw, year, month) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  const error = serviceError(json, raw);
  if (error) {
    const keyProblem = KEY_PROBLEMS.includes(error.name) || KEY_REASON_CODES.includes(error.code);
    return fail(error.code ? `${error.name} (코드 ${error.code})` : error.name, keyProblem);
  }
  if (status < 200 || status >= 300) return fail(`HTTP ${status}`, status === 401 || status === 403);
  if (json === undefined) {
    const result = xmlResult(raw);
    if (result && result.code !== '00') return fail(`resultCode ${result.code}${result.msg ? ` ${result.msg}` : ''}`, KEY_REASON_CODES.includes(result.code));
    return fail('JSON이 아닌 답이 왔다');
  }
  const response = isObject(json) ? json.response : undefined;
  const header = isObject(response) && isObject(response.header) ? response.header : null;
  if (!header) return fail('답에 response.header가 없다');
  const code = text(header.resultCode);
  if (code !== '00') {
    const msg = text(header.resultMsg);
    return fail(`resultCode ${code || '(없음)'}${msg ? ` ${msg}` : ''}`, KEY_REASON_CODES.includes(code) || KEY_PROBLEMS.includes(msg));
  }
  const body = response.body;
  if (!isObject(body)) return fail('답에 body가 없다');
  const items = body.items;
  let list;
  if (items === '' || items === undefined || items === null) list = [];
  else if (!isObject(items)) return fail('답의 items 모양이 다르다');
  else if (items.item === undefined || items.item === null || items.item === '') list = [];
  else if (Array.isArray(items.item)) list = items.item;
  else if (isObject(items.item)) list = [items.item];
  else return fail('답의 item 모양이 다르다');

  const days = [];
  for (const entry of list) {
    if (!isObject(entry) || entry.isHoliday !== 'Y') continue;
    const date = dateOf(entry.locdate, year, month);
    const name = nameOf(entry.dateName);
    if (date && name) days.push({ date, name });
  }
  return { ok: true, days };
}

async function fetchMonth(year, month, key, fetchText) {
  let answer;
  try {
    answer = await fetchText(requestUrl(year, month, key));
  } catch (e) {
    const cause = e instanceof Error && isObject(e.cause) && typeof e.cause.code === 'string' ? `, ${e.cause.code}` : '';
    return fail(maskKey(`연결 오류 (${e instanceof Error ? e.message : String(e)}${cause})`, key));
  }
  const result = parseMonthResponse(answer.status, answer.text, year, month);
  return result.ok ? result : { ...result, reason: maskKey(result.reason, key) };
}

/**
 * 해마다 열두 달을 차례로 묻는다(요청 사이에 잠깐 쉰다). 열두 달이 모두 성공해야 그해를 받은 것으로 본다.
 * 한 달이 실패하면 그해의 남은 달은 묻지 않는다. 맨 첫 요청이 인증키 문제로 실패하면 바로 그만두고 fatal에 까닭을 적는다.
 */
export async function fetchYears(years, { key, fetchText, sleep }) {
  const out = {};
  let first = true;
  for (const year of years) {
    const days = [];
    let failure = null;
    for (let month = 1; month <= 12 && failure === null; month += 1) {
      if (!first) await sleep(PAUSE_MS);
      const result = await fetchMonth(year, month, key, fetchText);
      if (first && !result.ok && result.keyProblem) return { years: out, fatal: result.reason };
      first = false;
      if (result.ok) days.push(...result.days);
      else failure = `${month}월: ${result.reason}`;
    }
    out[year] = failure === null ? { ok: true, days } : { ok: false, reason: failure };
  }
  return { years: out, fatal: null };
}

/** 날짜, 이름 순으로 늘어놓고 같은 것은 하나만 둔다. */
function tidy(days) {
  const seen = new Set();
  const out = [];
  for (const d of days) {
    const id = `${d.date}\n${d.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ date: d.date, name: d.name });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** 지난 파일을 읽는다. 쓸 수 없는 해는 빼고 날짜와 이름만 남긴다. 파일이 깨졌으면 null. */
export function parsePrevious(raw) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(json) || json.version !== 1 || !isObject(json.years)) return null;
  const years = {};
  for (const [year, value] of Object.entries(json.years)) {
    if (!/^\d{4}$/.test(year) || !isObject(value) || !Array.isArray(value.days)) continue;
    const days = [];
    let good = true;
    for (const d of value.days) {
      const ok = isObject(d) && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date);
      const date = ok ? dateOf(d.date.replaceAll('-', ''), Number(year), Number(d.date.slice(5, 7))) : null;
      const name = ok ? nameOf(d.name) : null;
      if (!date || !name) {
        good = false;
        break;
      }
      days.push({ date, name });
    }
    if (good) years[year] = { days };
  }
  return { version: 1, updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : null, years };
}

/**
 * 올릴 파일을 만든다. 받은 해는 받은 것으로, 받지 못했거나 공휴일이 하나도 없는 해는 지난 파일의 그해로(없으면 뺀다).
 * 지난 파일의 지난해(올해보다 앞)는 뺀다. 받은 해가 하나도 없으면 file은 null이다.
 * years가 지난 파일과 같으면 updatedAt도 그대로 두어 파일이 바이트까지 같게 한다.
 */
export function buildOutput({ fetched, previous, currentYear, now }) {
  const years = {};
  const lines = [];
  let usable = false;
  for (const [year, value] of Object.entries(previous?.years ?? {})) {
    if (Number(year) >= currentYear && !(year in fetched)) years[year] = value;
  }
  for (const year of Object.keys(fetched).sort()) {
    const result = fetched[year];
    if (result.ok && result.days.length > 0) {
      years[year] = { days: tidy(result.days) };
      usable = true;
      lines.push(`${year}년: 공휴일 ${years[year].days.length}일을 받았다.`);
      continue;
    }
    const why = result.ok ? '공휴일이 하나도 없다' : result.reason;
    const kept = previous?.years?.[year];
    if (kept) {
      years[year] = kept;
      lines.push(`${year}년: 받지 못해(${why}) 지난 자료의 ${kept.days.length}일을 그대로 둔다.`);
    } else {
      lines.push(`${year}년: 받지 못했고(${why}) 지난 자료도 없어 뺀다.`);
    }
  }
  if (!usable) return { file: null, lines, changed: false };
  const ordered = Object.fromEntries(Object.keys(years).sort().map((y) => [y, years[y]]));
  const same = previous !== null && previous !== undefined && JSON.stringify(ordered) === JSON.stringify(previous.years);
  const updatedAt = same && previous.updatedAt ? previous.updatedAt : now.toISOString();
  return { file: { version: 1, updatedAt, years: ordered }, lines, changed: !same };
}

/** 두 칸 들여쓰기에 마지막 줄바꿈. */
export function serialize(file) {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function parseArgs(argv) {
  const args = { out: null, previous: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = argv[++i] ?? null;
    else if (argv[i] === '--previous') args.previous = argv[++i] ?? null;
  }
  return args;
}

async function httpText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: response.status, text: await response.text() };
}

const realFiles = {
  read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
  write: (path, data) => writeFileSync(path, data, 'utf8'),
  append: (path, data) => appendFileSync(path, data, 'utf8'),
};

/** 명령줄의 몸통. 끝낼 코드를 돌려준다(0 성공, 1 받지 못함, 2 쓰는 법이 틀림). */
export async function main({
  argv, env, fetchText = httpText, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date(),
  files = realFiles, log = console.log, error = console.error,
}) {
  const args = parseArgs(argv);
  if (!args.out) {
    error('쓰는 법: node scripts/fetch-holidays.mjs --out <파일> [--previous <지난 파일>]');
    return 2;
  }
  const key = (env.DATA_GO_KR_KEY ?? '').trim();
  const report = (skipped) => {
    if (env.GITHUB_OUTPUT) files.append(env.GITHUB_OUTPUT, `skipped=${skipped}\n`);
  };
  if (key === '') {
    log('DATA_GO_KR_KEY 비밀값이 설정되지 않아 공휴일 자료 받기를 건너뛴다.');
    report(true);
    return 0;
  }
  try {
    let previous = null;
    if (args.previous) {
      const raw = files.read(args.previous);
      if (raw !== null) {
        previous = parsePrevious(raw);
        if (previous === null) log('지난 파일을 읽을 수 없어 없는 것으로 본다.');
      }
    }
    const at = now();
    const currentYear = koreaYear(at.getTime());
    const years = [currentYear, currentYear + 1];
    log(`${years.join(', ')}년의 특일 정보를 달마다 받는다.`);
    const { years: fetched, fatal } = await fetchYears(years, { key, fetchText, sleep });
    if (fatal !== null) {
      error(`첫 요청이 인증키 문제로 실패해 그만둔다: ${fatal}`);
      error('공공데이터포털의 마이페이지에서 인증키와 활용 기간을 확인한다. 새로 받은 키는 쓸 수 있기까지 한 시간쯤 걸릴 수 있다.');
      return 1;
    }
    const { file, lines, changed } = buildOutput({ fetched, previous, currentYear, now: at });
    for (const line of lines) log(line);
    if (file === null) {
      error('받은 해가 없어 파일을 쓰지 않는다.');
      return 1;
    }
    files.write(args.out, serialize(file));
    log(`파일을 썼다(${previous === null ? '지난 자료 없음' : changed ? '지난 자료와 다르다' : '지난 자료와 같다'}).`);
    return 0;
  } finally {
    report(false);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      const key = (process.env.DATA_GO_KR_KEY ?? '').trim();
      const message = e instanceof Error ? e.stack ?? e.message : String(e);
      console.error(key ? maskKey(message, key) : message);
      process.exitCode = 1;
    },
  );
}
