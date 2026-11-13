// 관리자의 사용자 추가 흐름을 실제 브라우저(헤드리스 Edge)에서 사람이 하듯 눌러 가며 확인한다.
// 에뮬레이터와 씨앗 자료가 필요하다: 관리자 test@example.com / test-password, 사용자 user@example.com / user-password.
// 단추는 요소의 click()으로 누르고 칸은 값을 넣은 뒤 input 이벤트를 보낸다. 앱의 함수는 부르지 않는다.
// 사용법: npx tsx scripts/users-check.ts --url <주소> [--with-vite]
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { emulatePhone, launchEdge, PHONE, startVite, type Cdp } from './cdp';

const ADMIN = { email: 'test@example.com', password: 'test-password' };
const USER = { email: 'user@example.com', password: 'user-password' };
const MEMO = '새 사용자의 메모';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 페이지마다 먼저 심어 두는 찾기 도구. 앱의 코드는 건드리지 않는다.
const HELPERS = `window.__uc = {
  open: (cls) => document.querySelector('.sheet' + cls + ':not([inert])'),
  byText: (root, sel, text) => root ? [...root.querySelectorAll(sel)].find((e) => e.textContent.trim() === text) || null : null,
  row: (email) => [...document.querySelectorAll('.sheet.users:not([inert]) .user-row')].find((li) => li.querySelector('.user-email').textContent === email) || null,
  fill: (el, value) => {
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  press: (el) => { if (!el || el.disabled) return false; el.click(); return true; },
};`;

type Result = { name: string; ok: boolean; seen: string };

async function run(cdp: Cdp, url: string): Promise<Result[]> {
  const base = new URL(url);
  const now = new Date();
  const monthId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const newUser = { email: `new-${Date.now()}@example.com`, password: 'first-password' };
  const results: Result[] = [];
  const record = (name: string, ok: boolean, seen: string): void => {
    results.push({ name, ok, seen });
    console.log(`${ok ? '통과' : '실패'}: ${name} (${seen})`);
  };
  const js = <T>(expression: string) => cdp.evaluate<T>(expression);
  /** 식이 참인 값을 돌려줄 때까지 기다린다. 시간 안에 안 되면 null. 페이지가 바뀌는 중의 오류는 아직 아닌 것으로 본다. */
  async function waitFor<T>(expression: string, timeoutMs = 10000): Promise<T | null> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const value = await js<T>(expression).catch(() => null);
      if (value) return value;
      if (Date.now() > end) return null;
      await sleep(100);
    }
  }
  const press = (element: string) => js<boolean>(`__uc.press(${element})`);
  const fill = (element: string, value: string) => js<boolean>(`__uc.fill(${element}, ${JSON.stringify(value)})`);
  const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
  const sheet = (cls: string) => `__uc.open(${JSON.stringify(cls)})`;
  const button = (root: string, text: string) => `__uc.byText(${root}, 'button', ${JSON.stringify(text)})`;
  const row = (email: string) => `__uc.row(${JSON.stringify(email)})`;
  const badge = (email: string) => js<string | null>(`${row(email)}?.querySelector('.user-badge').textContent ?? null`);
  const memoLines = () => js<number>("document.querySelectorAll('.grid.current .ln').length");
  const cellText = (day: string) =>
    js<string>(`document.querySelector('.grid.current .cell[data-key="${monthId}-${day}"] .memo')?.textContent ?? ''`);
  const LOGIN_FORM = "!!document.querySelector('form.login-card')";
  const CALENDAR = "!!document.querySelector('.calendar .grid.current .cell') && !document.querySelector('.blocked-text')";
  const NO_SHEET = "!document.querySelector('.sheet') && location.hash.replace('#', '') === ''";

  async function load(target: string): Promise<void> {
    await cdp.send('Page.navigate', { url: target });
  }
  async function openSettings(): Promise<boolean> {
    if (!(await press(q('.calendar [aria-label="설정"]')))) return false;
    return (await waitFor<boolean>(`!!${sheet('.settings')}`)) === true;
  }
  async function closeSheet(cls: string): Promise<boolean> {
    await press(`${sheet(cls)}?.querySelector('.sheet-bar .textbtn.end')`);
    return (await waitFor<boolean>(NO_SHEET, 5000)) === true;
  }
  /** 로그인 화면이 될 때까지 로그아웃한다: 안내의 로그아웃, 또는 설정의 로그아웃. */
  async function signOut(): Promise<boolean> {
    if (await js<boolean>(LOGIN_FORM)) return true;
    if (!(await press(button(q('.login-card'), '로그아웃')))) {
      if (await js<boolean>(`!!${sheet('')}`)) await closeSheet('');
      if (!(await openSettings())) return false;
      await press(`${sheet('.settings')}.querySelector('.signout')`);
    }
    return (await waitFor<boolean>(LOGIN_FORM)) === true;
  }
  /** 로그인 폼에 적고 누른다. 로그인 폼이 나올 때까지 기다린다. */
  async function submitLogin(account: { email: string; password: string }): Promise<boolean> {
    if (!(await signOut())) return false;
    await fill(q('form.login-card input[type="email"]'), account.email);
    await fill(q('form.login-card input[type="password"]'), account.password);
    return press(q('form.login-card button[type="submit"]'));
  }
  async function logIn(account: { email: string; password: string }): Promise<boolean> {
    if (!(await submitLogin(account))) return false;
    return (await waitFor<boolean>(CALENDAR, 15000)) === true;
  }
  /** 설정을 열어 "사용자 관리"가 보일 때까지 다시 연다. 접근 상태는 달력보다 조금 늦게 온다. */
  async function openSettingsAsAdmin(timeoutMs = 10000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (!(await openSettings())) return false;
      if (await js<boolean>(`!!${button(sheet('.settings'), '사용자 관리')}`)) return true;
      await closeSheet('.settings');
      if (Date.now() > end) return false;
      await sleep(300);
    }
  }
  /** 사용자 관리 시트의 추가 양식에 적고 누른 뒤, 결과 문구를 돌려준다. */
  async function add(email: string, password: string): Promise<string> {
    const form = `${sheet('.users')}.querySelector('.users-add')`;
    await fill(`${form}.querySelector('input[name="email"]')`, email);
    await fill(`${form}.querySelector('input[name="password"]')`, password);
    if (!(await press(`${form}.querySelector('button[type="submit"]')`))) return '(추가 단추를 누르지 못했다)';
    await waitFor<boolean>(`!${form}.querySelector('button[type="submit"]').disabled`, 15000);
    return js<string>(`${sheet('.users')}.querySelector('.users-status').textContent`);
  }
  /** 비밀번호 변경 양식에 적고 누른 뒤, 결과 문구를 돌려준다. */
  async function changePassword(current: string, next: string): Promise<string> {
    const form = `${sheet('.settings')}.querySelector('.account-pw-form')`;
    if (!(await js<boolean>(`!!${form}`)) && !(await press(button(sheet('.settings'), '비밀번호 변경')))) return '(양식을 열지 못했다)';
    await fill(`${form}.querySelector('input[name="current"]')`, current);
    await fill(`${form}.querySelector('input[name="next"]')`, next);
    await js(`${form}.querySelector('.settings-note').textContent = ''`);
    if (!(await press(`${form}.querySelector('button[type="submit"]')`))) return '(바꾸기 단추를 누르지 못했다)';
    return (await waitFor<string>(`${form}?.querySelector('.settings-note').textContent`, 15000)) ?? '(문구 없음)';
  }

  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });
  await emulatePhone(cdp);
  // 지난 실행의 로그인과 오프라인 사본이 남지 않게 이 주소의 저장소를 비우고 시작한다.
  await cdp.send('Storage.clearDataForOrigin', { origin: base.origin, storageTypes: 'indexeddb,local_storage,service_workers,cache_storage' });
  await load(base.href);
  if (!(await waitFor<boolean>(LOGIN_FORM, 30000))) throw new Error('로그인 화면이 뜨지 않았다');

  // 1
  const loggedIn = await logIn(ADMIN);
  const adminLines = loggedIn ? await waitFor<number>("document.querySelectorAll('.grid.current .ln').length", 10000) : null;
  record('1. 관리자로 로그인하면 달력이 뜬다', loggedIn, loggedIn ? `달력 있음, 예시 메모 ${adminLines ?? 0}줄` : '달력이 뜨지 않았다');

  // 2
  const adminSettings = await openSettingsAsAdmin();
  const adminEmail = adminSettings ? await js<string>(`${sheet('.settings')}.querySelector('.settings-email').textContent`) : '';
  record(
    '2. 설정의 계정은 test@example.com이고 "사용자 관리"가 있다',
    adminSettings && adminEmail === ADMIN.email,
    adminSettings ? `계정 ${adminEmail}, 사용자 관리 있음` : '사용자 관리가 나오지 않았다',
  );

  // 3
  await press(button(sheet('.settings'), '사용자 관리'));
  const listed = await waitFor<boolean>(`!!${row(ADMIN.email)} && !!${row(USER.email)} && !${sheet('.settings')}`);
  const adminRow = await js<{ badge: string; buttons: number } | null>(
    `(() => { const r = ${row(ADMIN.email)}; return r && { badge: r.querySelector('.user-badge').textContent, buttons: r.querySelectorAll('button').length }; })()`,
  );
  const userBadge = await badge(USER.email);
  record(
    '3. 사용자 관리에 관리자 줄(관리자, 단추 없음)과 user@example.com(사용 중)이 있다',
    listed === true && adminRow?.badge === '관리자' && adminRow.buttons === 0 && userBadge === '사용 중' && (await js<string>('location.hash')) === '#users',
    `관리자 줄 ${adminRow ? `${adminRow.badge}, 단추 ${adminRow.buttons}개` : '없음'}, user@example.com ${userBadge ?? '없음'}, 주소 ${await js<string>('location.hash')}`,
  );

  // 4
  const added = await add(newUser.email, newUser.password);
  const newBadge = await waitFor<string>(`${row(newUser.email)}?.querySelector('.user-badge').textContent`);
  record('4. 새 이메일과 first-password로 추가하면 "추가했습니다."와 사용 중인 줄이 보인다', added === '추가했습니다.' && newBadge === '사용 중', `문구 "${added}", 새 줄 ${newBadge ?? '없음'}`);

  // 5
  const backToCalendar = await closeSheet('.users');
  await sleep(300); // 닫은 뒤 설정이 다시 열리지 않는지 본다
  const stayed = await js<boolean>(`${NO_SHEET} && ${CALENDAR}`);
  const stillAdmin = (await openSettings()) ? await js<string>(`${sheet('.settings')}.querySelector('.settings-email').textContent`) : '';
  record(
    '5. 사용자 관리를 닫으면 달력으로 돌아가고, 설정의 계정은 그대로 test@example.com이다',
    backToCalendar && stayed && stillAdmin === ADMIN.email,
    `닫은 뒤 ${stayed ? '달력' : '달력 아님'}, 계정 ${stillAdmin || '없음'}`,
  );

  // 6
  await press(button(sheet('.settings'), '사용자 관리'));
  await waitFor<boolean>(`!!${row(newUser.email)}`);
  const wrong = await add(newUser.email, 'wrong-password');
  const short = await add(newUser.email, 'abcde');
  record(
    '6. 같은 이메일에 틀린 비밀번호, 5자 비밀번호는 알맞은 문구로 거절된다',
    wrong === '이미 있는 이메일입니다. 그 계정의 비밀번호를 넣으면 다시 등록합니다.' && short === '비밀번호는 8자 이상이어야 합니다.',
    `틀린 비밀번호 "${wrong}", 5자 "${short}"`,
  );

  // 7
  await press(`${row(USER.email)}?.querySelector('[data-act="toggle"]')`);
  const stopped = await waitFor<string>(`${row(USER.email)}?.querySelector('.user-badge').textContent === '중지됨' && '중지됨'`);
  record('7. user@example.com을 사용 중지하면 중지됨이 된다', stopped === '중지됨', `표시 ${stopped ?? (await badge(USER.email)) ?? '없음'}`);

  // 8
  await press(`${row(USER.email)}?.querySelector('[data-act="remove"]')`);
  const armed = await js<string | null>(`${row(USER.email)}?.querySelector('[data-act="remove"]').textContent ?? null`);
  record('8. 지우기를 한 번 누르면 "정말 지우기"로 바뀐다(누르지 않는다)', armed === '정말 지우기', `단추 ${armed ?? '없음'}`);
  await closeSheet('.users');

  // 9
  const newIn = await logIn(newUser);
  const day = `${monthId}-15`;
  await press(q(`.grid.current .cell[data-key="${day}"]`));
  const editorOpen = (await waitFor<boolean>(`!!${sheet(':not(.settings):not(.users)')}?.querySelector('textarea')`)) === true;
  const linesBefore = await memoLines();
  await fill(`${sheet(':not(.settings):not(.users)')}.querySelector('textarea')`, MEMO);
  await press(`${sheet(':not(.settings):not(.users)')}.querySelector('.textbtn.end')`);
  const shown = await waitFor<boolean>(`document.querySelector('.grid.current .cell[data-key="${day}"] .memo')?.textContent === ${JSON.stringify(MEMO)}`);
  const synced = await waitFor<boolean>("document.querySelector('.sync-text')?.textContent === '동기화됨'");
  await cdp.send('Page.reload');
  await waitFor<boolean>(CALENDAR, 15000);
  const afterReload = await waitFor<string>(`(() => { const t = document.querySelector('.grid.current .cell[data-key="${day}"] .memo')?.textContent; return t === ${JSON.stringify(MEMO)} && t; })()`);
  const linesAfter = await memoLines();
  record(
    '9. 새 사용자는 빈 달력으로 시작하고, 쓴 메모가 칸에 보이며 다시 읽어도 남아 있다',
    newIn && editorOpen && linesBefore === 0 && shown === true && synced === true && afterReload === MEMO && linesAfter === 1,
    `로그인 ${newIn ? '됨' : '안 됨'}, 메모 전 ${linesBefore}줄, 저장 뒤 ${shown ? '칸에 보임' : '칸에 없음'}, ${synced ? '동기화됨' : '동기화 안 됨'}, 다시 읽은 뒤 "${afterReload || (await cellText('15'))}" (모두 ${linesAfter}줄)`,
  );

  // 10
  const userSettings = await openSettings();
  const manageShown = userSettings && (await js<boolean>(`!!${button(sheet('.settings'), '사용자 관리')}`));
  const wrongCurrent = userSettings ? await changePassword('not-my-password', 'second-password') : '';
  const changed = userSettings ? await changePassword(newUser.password, 'second-password') : '';
  record(
    '10. 새 사용자의 설정에는 사용자 관리가 없고, 비밀번호 변경은 틀린 지금 비밀번호를 거절하고 맞으면 바꾼다',
    userSettings && !manageShown && wrongCurrent === '지금 비밀번호가 맞지 않습니다.' && changed === '비밀번호를 바꿨습니다.',
    `사용자 관리 ${manageShown ? '있음' : '없음'}, 틀린 지금 비밀번호 "${wrongCurrent}", 맞는 것 "${changed}"`,
  );

  // 11
  const secondIn = await logIn({ email: newUser.email, password: 'second-password' });
  record('11. 새 사용자가 second-password로 로그인한다', secondIn, secondIn ? '달력 있음' : '달력이 뜨지 않았다');

  // 12
  const blockedSubmitted = await submitLogin(USER);
  const notice = blockedSubmitted ? await waitFor<string>("document.querySelector('.blocked-text')?.textContent", 15000) : null;
  const calendarGone = await js<boolean>("!document.querySelector('.calendar')");
  const noticeOut = notice ? (await press(button(q('.login-card'), '로그아웃'))) && (await waitFor<boolean>(LOGIN_FORM)) === true : false;
  record(
    '12. 중지된 user@example.com은 달력 대신 중지 안내를 보고, 로그아웃하면 로그인 화면으로 간다',
    notice === '관리자가 이 계정의 사용을 중지했습니다.' && calendarGone && noticeOut,
    `안내 "${notice ?? '없음'}", 달력 ${calendarGone ? '없음' : '있음'}, 로그아웃 뒤 ${noticeOut ? '로그인 화면' : '로그인 화면 아님'}`,
  );

  // 13
  await signOut();
  const alertText = () => js<string>("document.querySelector('form.login-card [role=\"alert\"]').textContent");
  await fill(q('form.login-card input[type="email"]'), '');
  await press(q('form.login-card .login-forgot'));
  const emptyAsk = await alertText();
  await fill(q('form.login-card input[type="email"]'), USER.email);
  await press(q('form.login-card .login-forgot'));
  const sent = await waitFor<string>(`(() => { const t = document.querySelector('form.login-card [role="alert"]').textContent; return t !== ${JSON.stringify(emptyAsk)} && t; })()`);
  record(
    '13. "비밀번호를 잊었습니다"는 이메일이 비면 먼저 적으라고 하고, 적으면 재설정 메일을 보낸다',
    emptyAsk === '이메일을 먼저 적으세요.' && sent === '재설정 메일을 보냈습니다. 메일함을 확인하세요.',
    `빈 이메일 "${emptyAsk}", user@example.com "${sent ?? '(문구 없음)'}"`,
  );

  // 14: 관리자는 주소로 새로 열어도(확인 중에서 관리자로) 시트가 열린다. 새 사용자는 연 채로 있는 페이지에서 주소를 바꿔도 열리지 않는다.
  const adminAgain = await logIn(ADMIN);
  await load('about:blank');
  await load(new URL('#users', base).href);
  const adminSheet = adminAgain && (await waitFor<boolean>(`!!${row(ADMIN.email)}`, 15000)) === true;
  await closeSheet('.users');
  const userAgain = await logIn({ email: newUser.email, password: 'second-password' });
  await load(new URL('#users', base).href);
  const left = userAgain && (await waitFor<boolean>(NO_SHEET, 10000)) === true;
  await sleep(500); // 늦게 열리지 않는지 본다
  const userSheet = await js<boolean>("!!document.querySelector('.sheet.users')");
  const userCalendar = await js<boolean>(CALENDAR);
  record(
    '14. 주소 #users는 관리자에게 사용자 관리를 열고, 새 사용자에게는 열지 않고 달력을 보인다',
    adminSheet && left && !userSheet && userCalendar,
    `관리자 ${adminSheet ? '시트 열림' : '시트 없음'}, 새 사용자 ${userSheet ? '시트 열림' : '시트 없음'}, ${userCalendar ? '달력' : '달력 아님'}, 주소 "${await js<string>('location.hash')}"`,
  );

  // 15
  const adminLast = await logIn(ADMIN);
  const sample = adminLast ? await waitFor<string>(`document.querySelector('.grid.current .cell[data-key="${monthId}-09"] .memo')?.textContent`) : null;
  const adminLinesNow = await memoLines();
  const leaked = await js<boolean>(`[...document.querySelectorAll('.grid.current .ln')].some((l) => l.textContent === ${JSON.stringify(MEMO)})`);
  record(
    '15. 관리자의 달에는 예시 메모가 그대로 있고 새 사용자의 메모는 없다',
    adminLast && sample === '운동 7시' && adminLinesNow === adminLines && !leaked,
    `9일 "${sample ?? ''}", 메모 ${adminLinesNow}줄(처음 ${adminLines ?? 0}줄), 새 사용자의 메모 ${leaked ? '보임' : '안 보임'}`,
  );
  return results;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { url: { type: 'string' }, 'with-vite': { type: 'boolean', default: false } } });
  if (!values.url) {
    console.error('사용법: tsx scripts/users-check.ts --url <주소> [--with-vite]');
    process.exit(1);
  }
  const vite = values['with-vite'] ? await startVite() : null;
  const { cdp, kill } = await launchEdge({
    headless: true,
    profileDir: resolve('.tools', 'edge-profile-users'),
    args: [`--window-size=${PHONE.width},${PHONE.height}`],
  });
  let passed = false;
  try {
    const results = await run(cdp, values.url);
    passed = results.length === 15 && results.every((x) => x.ok);
  } catch (e) {
    console.error(`실패: 확인을 끝내지 못했다 (${(e as Error).message})`);
  } finally {
    cdp.close();
    kill();
    vite?.stop();
  }
  process.exit(passed ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
