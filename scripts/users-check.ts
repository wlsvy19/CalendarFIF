// 관리자의 사용자 추가 흐름을 실제 브라우저(헤드리스 Edge)에서 사람이 하듯 눌러 가며 확인한다.
// 에뮬레이터와 씨앗 자료가 필요하다: 관리자 test@example.com / test-password, 사용자 user@example.com / user-password.
// 단추는 화면에 보이는 가운데를 실제 터치로 누른다(Input.dispatchTouchEvent의 탭). 가려졌거나 화면 밖이면 누르지 못한 것으로 친다.
// 마우스 누름(Input.dispatchMouseEvent)은 폰 흉내 아래에서 터치로 바뀌기만 하고 클릭이 되지 않으며 명령이 돌아오지 않는다(2026-11-14 확인).
// 칸은 초점을 준 뒤 Input.insertText로 적는다. 단계 사이에 시트를 닫을 때만 요소의 click()을 쓴다. 앱의 함수는 부르지 않는다.
// 편집 중에 중지되는 단계(17)는 관리자의 변경을 에뮬레이터의 관리자 경로(REST, Bearer owner)로 쓴다. 사용 중지 단추 자체는 7단계에서 본다.
// 사용법: npx tsx scripts/users-check.ts --url <주소> [--with-vite]
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { emulatePhone, launchEdge, PHONE, startVite, type Cdp } from './cdp';

const ADMIN = { email: 'test@example.com', password: 'test-password' };
const USER = { email: 'user@example.com', password: 'user-password' };
const MEMO = '새 사용자의 메모';
const HOLD_MEMO = '중지되는 동안 적은 메모';
const STEPS = 19;
const FIRESTORE = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085'}/v1/projects/demo-calfif/databases/(default)/documents`;
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 페이지마다 먼저 심어 두는 찾기 도구. 앱의 코드는 건드리지 않는다.
const HELPERS = `window.__uc = {
  open: (cls) => document.querySelector('.sheet' + cls + ':not([inert])'),
  byText: (root, sel, text) => root ? [...root.querySelectorAll(sel)].find((e) => e.textContent.trim() === text) || null : null,
  row: (email) => [...document.querySelectorAll('.sheet.users:not([inert]) .user-row')].find((li) => li.querySelector('.user-email').textContent === email) || null,
  // 누를 자리: 요소를 화면에 들이고 가운데 점을 돌려준다. 그 점에 다른 것이 덮여 있으면 누를 수 없다.
  spot: (el) => {
    if (!el) return { miss: '없음' };
    if (el.disabled) return { miss: '꺼짐' };
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { miss: '크기 없음' };
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { miss: '화면 밖' };
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== el && !el.contains(hit))) return { miss: '가려짐: ' + (hit ? hit.tagName.toLowerCase() + '.' + String(hit.className) : '없음') };
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  },
  // 다음 클릭이 그 요소(누르는 순간에 다시 찾은 것)에 닿는지 지켜본다. 목록이 다시 그려져도 같은 자리의 새 단추를 찾는다.
  arm: (find) => {
    window.__ucOff?.();
    window.__ucClicked = false;
    const on = (e) => {
      const el = find();
      if (el && (e.target === el || el.contains(e.target))) {
        window.__ucClicked = true;
        document.removeEventListener('click', on, true);
      }
    };
    document.addEventListener('click', on, true);
    window.__ucOff = () => document.removeEventListener('click', on, true);
  },
};`;

type Result = { name: string; ok: boolean; seen: string };

/** 에뮬레이터의 관리자 경로로 이메일의 access 문서 id(= uid)를 찾는다. */
async function accessUid(email: string): Promise<string | null> {
  const res = await fetch(`${FIRESTORE}/access?pageSize=300`, { headers: OWNER });
  if (!res.ok) return null;
  const body = (await res.json()) as { documents?: { name: string; fields?: { email?: { stringValue?: string } } }[] };
  const found = body.documents?.find((d) => d.fields?.email?.stringValue === email);
  return found ? (found.name.split('/').pop() ?? null) : null;
}

/** 관리자가 사용 중지와 다시 허용에서 쓰는 것과 같은 칸(disabled)만 바꾼다. */
async function setDisabledAsOwner(uid: string, disabled: boolean): Promise<boolean> {
  const res = await fetch(`${FIRESTORE}/access/${uid}?updateMask.fieldPaths=disabled&currentDocument.exists=true`, {
    method: 'PATCH',
    headers: OWNER,
    body: JSON.stringify({ fields: { disabled: { booleanValue: disabled } } }),
  });
  return res.ok;
}

async function run(cdp: Cdp, url: string): Promise<Result[]> {
  const base = new URL(url);
  const now = new Date();
  const monthId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const newUser = { email: `new-${Date.now()}@example.com`, password: 'first-password' };
  const newUserLater = { email: newUser.email, password: 'second-password' };
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
  /** 문구가 기대한 것이 될 때까지 기다린다. 앱의 문구를 지우지 않는다. 안 되면 마지막에 본 문구를 돌려준다. */
  async function waitText(expression: string, expected: string, timeoutMs = 15000): Promise<string> {
    const end = Date.now() + timeoutMs;
    let seen: string | null = null;
    for (;;) {
      seen = await js<string | null>(expression).catch(() => null);
      if (seen === expected || Date.now() > end) return seen ?? '(문구 없음)';
      await sleep(100);
    }
  }
  /** 입력 명령이 돌아오지 않으면 확인 전체가 멈추므로 시간을 정해 둔다. */
  async function input(method: string, params: object): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error(`${method}가 5초 안에 돌아오지 않았다`)), 5000);
    });
    try {
      await Promise.race([cdp.send(method, params), late]);
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * 사람처럼 누른다: 요소를 화면에 들이고 자리가 멎을 때까지(시트가 미끄러지는 중이면) 기다린 뒤, 가운데를 실제 터치로 누르고 뗀다.
   * 꺼져 있거나 가려졌거나 화면 밖이면 누르지 않는다. 그 요소에 클릭이 닿았으면 true.
   */
  async function press(element: string, timeoutMs = 5000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    let previous = '';
    let miss = '';
    let spot: { x: number; y: number } | null = null;
    for (;;) {
      const s = await js<{ x: number; y: number } | { miss: string }>(`__uc.spot(${element})`).catch(() => ({ miss: '페이지가 바뀌는 중' }));
      if ('x' in s) {
        const key = `${s.x},${s.y}`;
        if (key === previous) {
          spot = s;
          break;
        }
        previous = key;
      } else {
        previous = '';
        miss = s.miss;
      }
      if (Date.now() > end) break;
      await sleep(80);
    }
    if (!spot) {
      console.log(`  (누르지 못했다: ${miss || '자리가 멎지 않았다'})`);
      return false;
    }
    await js(`__uc.arm(() => ${element})`);
    const { x, y } = spot;
    await input('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await input('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const clicked = (await waitFor<boolean>('window.__ucClicked === true', 2000)) === true;
    await js('window.__ucOff?.()').catch(() => {});
    if (!clicked) console.log('  (눌렀지만 그 요소에 클릭이 닿지 않았다)');
    return clicked;
  }
  /** 칸에 초점을 주고 있던 글을 고른 뒤 Input.insertText로 적는다(빈 글이면 지우기 키). 칸의 값이 적은 것과 같으면 true. */
  async function type(element: string, text: string): Promise<boolean> {
    const ready = await waitFor<boolean>(
      `(() => { const el = ${element}; if (!el || el.disabled) return false; el.scrollIntoView({ block: 'nearest' }); el.focus(); el.select(); return document.activeElement === el; })()`,
      5000,
    );
    if (!ready) return false;
    if (text === '') {
      await input('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await input('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    } else {
      await input('Input.insertText', { text });
    }
    return (await js<string | null>(`${element}?.value ?? null`)) === text;
  }
  /** 단계 사이에 시트를 닫을 때만 쓴다. */
  const clickEl = (element: string) => js<boolean>(`(() => { const el = ${element}; if (!el || el.disabled) return false; el.click(); return true; })()`);
  const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
  const sheet = (cls: string) => `__uc.open(${JSON.stringify(cls)})`;
  const button = (root: string, text: string) => `__uc.byText(${root}, 'button', ${JSON.stringify(text)})`;
  const row = (email: string) => `__uc.row(${JSON.stringify(email)})`;
  const rowButton = (email: string, act: string) => `${row(email)}?.querySelector('[data-act="${act}"]')`;
  const badge = (email: string) => js<string | null>(`${row(email)}?.querySelector('.user-badge').textContent ?? null`);
  const memoLines = () => js<number>("document.querySelectorAll('.grid.current .ln').length");
  const cell = (day: string) => q(`.grid.current .cell[data-key="${monthId}-${day}"]`);
  const cellText = (day: string) => js<string>(`${cell(day)}?.querySelector('.memo')?.textContent ?? ''`);
  const editor = sheet(':not(.settings):not(.users)');
  const usersStatus = `${sheet('.users')}?.querySelector('.users-status')?.textContent`;
  const NOTICE = "document.querySelector('.blocked-text')?.textContent";
  const LOGIN_FORM = "!!document.querySelector('form.login-card')";
  const CALENDAR = "!!document.querySelector('.calendar .grid.current .cell') && !document.querySelector('.blocked-text')";
  const NO_SHEET = "!document.querySelector('.sheet') && location.hash.replace('#', '') === ''";
  const SYNCED = "document.querySelector('.sync-text')?.textContent === '동기화됨'";
  const access = (state: string) => `document.documentElement.dataset.access === '${state}'`;
  const NONE_TEXT = '이 계정은 사용 허가를 받지 않았습니다. 관리자에게 문의하세요.';
  const BLOCKED_TEXT = '관리자가 이 계정의 사용을 중지했습니다.';

  async function load(target: string): Promise<void> {
    await cdp.send('Page.navigate', { url: target });
  }
  async function openSettings(): Promise<boolean> {
    if (!(await press(q('.calendar [aria-label="설정"]')))) return false;
    return (await waitFor<boolean>(`!!${sheet('.settings')}`)) === true;
  }
  async function closeSheet(cls: string): Promise<boolean> {
    await clickEl(`${sheet(cls)}?.querySelector('.sheet-bar .textbtn.end')`);
    return (await waitFor<boolean>(NO_SHEET, 5000)) === true;
  }
  /** 로그인 화면이 될 때까지 로그아웃한다: 안내의 로그아웃, 또는 설정의 로그아웃(대기 중인 편집이 있으면 "그래도 로그아웃"). */
  async function signOut(): Promise<boolean> {
    if (await js<boolean>(LOGIN_FORM)) return true;
    if (await js<boolean>(`!!${button(q('.login-card'), '로그아웃')}`)) {
      await press(button(q('.login-card'), '로그아웃'));
    } else {
      if (await js<boolean>(`!!${sheet('')}`)) await closeSheet('');
      if (!(await openSettings())) return false;
      await press(`${sheet('.settings')}.querySelector('.signout')`);
      if (await js<boolean>(`${sheet('.settings')}?.querySelector('.danger')?.hidden === false`)) await press(`${sheet('.settings')}.querySelector('.danger')`);
    }
    return (await waitFor<boolean>(LOGIN_FORM)) === true;
  }
  /** 로그인 폼에 적고 누른다. 로그인 폼이 나올 때까지 기다린다. */
  async function submitLogin(account: { email: string; password: string }): Promise<boolean> {
    if (!(await signOut())) return false;
    if (!(await type(q('form.login-card input[type="email"]'), account.email))) return false;
    if (!(await type(q('form.login-card input[type="password"]'), account.password))) return false;
    return press(q('form.login-card button[type="submit"]'));
  }
  async function logIn(account: { email: string; password: string }): Promise<boolean> {
    if (!(await submitLogin(account))) return false;
    return (await waitFor<boolean>(CALENDAR, 15000)) === true;
  }
  /** 사용자 관리 시트의 추가 양식에 적고 누른 뒤, 기대한 결과 문구를 기다린다. 본 문구를 돌려준다. */
  async function add(email: string, password: string, expected: string): Promise<string> {
    const form = `${sheet('.users')}?.querySelector('.users-add')`;
    if (!(await type(`${form}.querySelector('input[name="email"]')`, email))) return '(이메일 칸에 적지 못했다)';
    if (!(await type(`${form}.querySelector('input[name="password"]')`, password))) return '(비밀번호 칸에 적지 못했다)';
    if (!(await press(`${form}.querySelector('button[type="submit"]')`))) return '(추가 단추를 누르지 못했다)';
    return waitText(usersStatus, expected);
  }
  /** 비밀번호 변경 양식에 적고 누른 뒤, 기대한 결과 문구를 기다린다. 본 문구를 돌려준다. */
  async function changePassword(current: string, next: string, expected: string): Promise<string> {
    const form = `${sheet('.settings')}?.querySelector('.account-pw-form')`;
    if (!(await js<boolean>(`!!${form}`)) && !(await press(button(sheet('.settings'), '비밀번호 변경')))) return '(양식을 열지 못했다)';
    if (!(await type(`${form}.querySelector('input[name="current"]')`, current))) return '(지금 비밀번호 칸에 적지 못했다)';
    if (!(await type(`${form}.querySelector('input[name="next"]')`, next))) return '(새 비밀번호 칸에 적지 못했다)';
    if (!(await press(`${form}.querySelector('button[type="submit"]')`))) return '(바꾸기 단추를 누르지 못했다)';
    return waitText(`${form}?.querySelector('.settings-note')?.textContent`, expected);
  }
  /** 날짜 칸을 눌러 편집 화면을 열고 메모를 적는다. */
  async function writeMemo(day: string, text: string): Promise<boolean> {
    if (!(await press(cell(day)))) return false;
    if (!(await waitFor<boolean>(`!!${editor}?.querySelector('textarea')`))) return false;
    return type(`${editor}.querySelector('textarea')`, text);
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
  const adminKnown = (await waitFor<boolean>(access('admin'), 15000)) === true;
  const adminSettings = adminKnown && (await openSettings());
  const manageForAdmin = adminSettings && (await js<boolean>(`!!${button(sheet('.settings'), '사용자 관리')}`));
  const adminEmail = adminSettings ? await js<string>(`${sheet('.settings')}.querySelector('.settings-email').textContent`) : '';
  record(
    '2. 접근 상태가 관리자로 온 뒤 설정의 계정은 test@example.com이고 "사용자 관리"가 있다',
    adminKnown && adminSettings && manageForAdmin && adminEmail === ADMIN.email,
    `접근 상태 ${adminKnown ? 'admin' : '오지 않음'}, 계정 ${adminEmail || '없음'}, 사용자 관리 ${manageForAdmin ? '있음' : '없음'}`,
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
  const added = await add(newUser.email, newUser.password, '추가했습니다.');
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
  const EXISTS = '이미 있는 이메일입니다. 그 계정의 비밀번호를 넣으면 다시 등록합니다.';
  const SHORT = '비밀번호는 8자 이상이어야 합니다.';
  const wrong = await add(newUser.email, 'wrong-password', EXISTS);
  const short = await add(newUser.email, 'abcde', SHORT);
  record('6. 같은 이메일에 틀린 비밀번호, 5자 비밀번호는 알맞은 문구로 거절된다', wrong === EXISTS && short === SHORT, `틀린 비밀번호 "${wrong}", 5자 "${short}"`);

  // 7
  const toggled = await press(rowButton(USER.email, 'toggle'));
  const stopped = await waitFor<string>(`${row(USER.email)}?.querySelector('.user-badge').textContent === '중지됨' && '중지됨'`);
  record('7. user@example.com의 사용 중지를 누르면 중지됨이 된다', toggled && stopped === '중지됨', `표시 ${stopped ?? (await badge(USER.email)) ?? '없음'}`);

  // 8
  const resetPressed = await press(rowButton(USER.email, 'reset'));
  const resetText = resetPressed ? await waitText(usersStatus, `재설정 메일을 보냈습니다: ${USER.email}`) : '(누르지 못했다)';
  record('8. user@example.com 줄의 재설정 메일을 누르면 보냈다는 문구가 나온다', resetText === `재설정 메일을 보냈습니다: ${USER.email}`, `문구 "${resetText}"`);

  // 9
  await press(rowButton(USER.email, 'remove'));
  const armed = await waitFor<string>(`${rowButton(USER.email, 'remove')}?.textContent === '정말 지우기' && '정말 지우기'`, 3000);
  record('9. 지우기를 한 번 누르면 "정말 지우기"로 바뀐다(누르지 않는다)', armed === '정말 지우기', `단추 ${armed ?? (await js<string | null>(`${rowButton(USER.email, 'remove')}?.textContent ?? null`)) ?? '없음'}`);
  await closeSheet('.users');

  // 10
  const newIn = await logIn(newUser);
  const linesBefore = await memoLines();
  const written = newIn && (await writeMemo('15', MEMO));
  const saved = written && (await press(`${editor}.querySelector('.textbtn.end')`));
  const shown = await waitFor<boolean>(`${cell('15')}?.querySelector('.memo')?.textContent === ${JSON.stringify(MEMO)}`);
  const synced = await waitFor<boolean>(SYNCED);
  await cdp.send('Page.reload');
  await waitFor<boolean>(CALENDAR, 15000);
  const afterReload = await waitFor<string>(`(() => { const t = ${cell('15')}?.querySelector('.memo')?.textContent; return t === ${JSON.stringify(MEMO)} && t; })()`);
  const linesAfter = await memoLines();
  record(
    '10. 새 사용자는 빈 달력으로 시작하고, 쓴 메모가 칸에 보이며 다시 읽어도 남아 있다',
    newIn && written && saved && linesBefore === 0 && shown === true && synced === true && afterReload === MEMO && linesAfter === 1,
    `로그인 ${newIn ? '됨' : '안 됨'}, 메모 전 ${linesBefore}줄, 적기 ${written ? '됨' : '안 됨'}, 저장 ${saved ? '누름' : '못 누름'}, 저장 뒤 ${shown ? '칸에 보임' : '칸에 없음'}, ${synced ? '동기화됨' : '동기화 안 됨'}, 다시 읽은 뒤 "${afterReload || (await cellText('15'))}" (모두 ${linesAfter}줄)`,
  );

  // 11
  const userKnown = (await waitFor<boolean>(access('user'), 15000)) === true;
  const userSettings = userKnown && (await openSettings());
  const manageShown = userSettings && (await js<boolean>(`!!${button(sheet('.settings'), '사용자 관리')}`));
  const WRONG_CURRENT = '지금 비밀번호가 맞지 않습니다.';
  const CHANGED = '비밀번호를 바꿨습니다.';
  const wrongCurrent = userSettings ? await changePassword('not-my-password', newUserLater.password, WRONG_CURRENT) : '';
  const changed = userSettings ? await changePassword(newUser.password, newUserLater.password, CHANGED) : '';
  record(
    '11. 접근 상태가 사용자로 온 뒤 새 사용자의 설정에는 사용자 관리가 없고, 비밀번호 변경은 틀린 지금 비밀번호를 거절하고 맞으면 바꾼다',
    userKnown && userSettings && !manageShown && wrongCurrent === WRONG_CURRENT && changed === CHANGED,
    `접근 상태 ${userKnown ? 'user' : '오지 않음'}, 사용자 관리 ${manageShown ? '있음' : '없음'}, 틀린 지금 비밀번호 "${wrongCurrent}", 맞는 것 "${changed}"`,
  );

  // 12
  const secondIn = await logIn(newUserLater);
  record('12. 새 사용자가 second-password로 로그인한다', secondIn, secondIn ? '달력 있음' : '달력이 뜨지 않았다');

  // 13
  const blockedSubmitted = await submitLogin(USER);
  const notice = blockedSubmitted ? await waitText(NOTICE, BLOCKED_TEXT) : '(로그인하지 못했다)';
  const calendarGone = await js<boolean>("!document.querySelector('.calendar')");
  const noticeOut = notice === BLOCKED_TEXT && (await press(button(q('.login-card'), '로그아웃'))) && (await waitFor<boolean>(LOGIN_FORM)) === true;
  record(
    '13. 중지된 user@example.com은 달력 대신 중지 안내를 보고, 로그아웃을 누르면 로그인 화면으로 간다',
    notice === BLOCKED_TEXT && calendarGone && noticeOut,
    `안내 "${notice}", 달력 ${calendarGone ? '없음' : '있음'}, 로그아웃 뒤 ${noticeOut ? '로그인 화면' : '로그인 화면 아님'}`,
  );

  // 14
  await signOut();
  const ALERT = "document.querySelector('form.login-card [role=\"alert\"]')?.textContent";
  const ASK = '이메일을 먼저 적으세요.';
  const SENT = '재설정 메일을 보냈습니다. 메일함을 확인하세요.';
  await type(q('form.login-card input[type="email"]'), '');
  const emptyAsk = (await press(q('form.login-card .login-forgot'))) ? await waitText(ALERT, ASK, 5000) : '(누르지 못했다)';
  await type(q('form.login-card input[type="email"]'), USER.email);
  const sent = (await press(q('form.login-card .login-forgot'))) ? await waitText(ALERT, SENT) : '(누르지 못했다)';
  record(
    '14. "비밀번호를 잊었습니다"는 이메일이 비면 먼저 적으라고 하고, 적으면 재설정 메일을 보낸다',
    emptyAsk === ASK && sent === SENT,
    `빈 이메일 "${emptyAsk}", user@example.com "${sent}"`,
  );

  // 15: 관리자는 주소로 새로 열어도(확인 중에서 관리자로) 시트가 열린다. 새 사용자는 연 채로 있는 페이지에서 주소를 바꿔도 열리지 않는다.
  const adminAgain = await logIn(ADMIN);
  await load('about:blank');
  await load(new URL('#users', base).href);
  const adminSheet = adminAgain && (await waitFor<boolean>(`!!${row(ADMIN.email)}`, 15000)) === true;
  await closeSheet('.users');
  const userAgain = await logIn(newUserLater);
  await load(new URL('#users', base).href);
  const left = userAgain && (await waitFor<boolean>(NO_SHEET, 10000)) === true;
  await sleep(500); // 늦게 열리지 않는지 본다
  const userSheet = await js<boolean>("!!document.querySelector('.sheet.users')");
  const userCalendar = await js<boolean>(CALENDAR);
  record(
    '15. 주소 #users는 관리자에게 사용자 관리를 열고, 새 사용자에게는 열지 않고 달력을 보인다',
    adminSheet && left && !userSheet && userCalendar,
    `관리자 ${adminSheet ? '시트 열림' : '시트 없음'}, 새 사용자 ${userSheet ? '시트 열림' : '시트 없음'}, ${userCalendar ? '달력' : '달력 아님'}, 주소 "${await js<string>('location.hash')}"`,
  );

  // 16
  const adminLast = await logIn(ADMIN);
  const sample = adminLast ? await waitFor<string>(`${cell('09')}?.querySelector('.memo')?.textContent`) : null;
  const adminLinesNow = await memoLines();
  const leaked = await js<boolean>(`[...document.querySelectorAll('.grid.current .ln')].some((l) => l.textContent === ${JSON.stringify(MEMO)})`);
  record(
    '16. 관리자의 달에는 예시 메모가 그대로 있고 새 사용자의 메모는 없다',
    adminLast && sample === '운동 7시' && adminLinesNow === adminLines && !leaked,
    `9일 "${sample ?? ''}", 메모 ${adminLinesNow}줄(처음 ${adminLines ?? 0}줄), 새 사용자의 메모 ${leaked ? '보임' : '안 보임'}`,
  );

  // 17: 새 사용자가 메모를 적는 중에 관리자가 사용을 중지하고(관리자 경로), 저장한 뒤 다시 허용한다.
  const holdIn = (await logIn(newUserLater)) && (await waitFor<boolean>(access('user'), 15000)) === true;
  const holdUid = await accessUid(newUser.email);
  const outboxKey = `calfif.outbox.${holdUid}`;
  const holdWritten = holdIn && (await writeMemo('20', HOLD_MEMO));
  const disabledByAdmin = holdWritten && holdUid !== null && (await setDisabledAsOwner(holdUid, true));
  const blockedArrived = disabledByAdmin && (await waitFor<boolean>(access('blocked'), 15000)) === true;
  await sleep(500); // 안내로 바뀌지 않는지 본다
  const editorKept = await js<boolean>(`${editor}?.querySelector('textarea')?.value === ${JSON.stringify(HOLD_MEMO)} && !document.querySelector('.blocked-text')`);
  const holdSaved = editorKept && (await press(`${editor}.querySelector('.textbtn.end')`));
  const holdNotice = holdSaved ? await waitText(NOTICE, BLOCKED_TEXT) : '(저장하지 못했다)';
  const queued = await js<boolean>(`(localStorage.getItem(${JSON.stringify(outboxKey)}) ?? '').includes(${JSON.stringify(HOLD_MEMO)})`);
  const allowedAgain = holdUid !== null && (await setDisabledAsOwner(holdUid, false));
  const calendarBack = allowedAgain && (await waitFor<boolean>(`${CALENDAR} && ${access('user')}`, 15000)) === true;
  await cdp.send('Page.reload');
  await waitFor<boolean>(CALENDAR, 15000);
  const holdAfter = await waitFor<string>(`(() => { const t = ${cell('20')}?.querySelector('.memo')?.textContent; return t === ${JSON.stringify(HOLD_MEMO)} && t; })()`);
  const holdSynced = (await waitFor<boolean>(SYNCED)) === true;
  const outboxEmpty = await js<boolean>(`['[]', null].includes(localStorage.getItem(${JSON.stringify(outboxKey)}))`);
  record(
    '17. 메모를 적는 중에 중지되면 편집 화면이 그대로 있고, 저장하면 중지 안내가 나오며, 다시 허용된 뒤 다시 읽으면 그 메모가 올라가 있다',
    holdWritten && blockedArrived && editorKept && holdSaved && holdNotice === BLOCKED_TEXT && queued && calendarBack && holdAfter === HOLD_MEMO && holdSynced && outboxEmpty,
    `적기 ${holdWritten ? '됨' : '안 됨'}, 중지 ${disabledByAdmin ? '씀' : '못 씀'}, 접근 상태 ${blockedArrived ? 'blocked 옴' : '안 옴'}, 편집 화면 ${editorKept ? '그대로' : '사라짐'}, 저장 뒤 안내 "${holdNotice}", 대기열 ${queued ? '있음' : '없음'}, 다시 허용 뒤 ${calendarBack ? '달력' : '달력 아님'}, 다시 읽은 뒤 "${holdAfter || (await cellText('20'))}", ${holdSynced ? '동기화됨' : '동기화 안 됨'}, 대기열 ${outboxEmpty ? '비었음' : '남음'}`,
  );

  // 18
  const adminForRemove = (await logIn(ADMIN)) && (await waitFor<boolean>(access('admin'), 15000)) === true;
  const manageOpen = adminForRemove && (await openSettings()) && (await press(button(sheet('.settings'), '사용자 관리')));
  const rowThere = manageOpen && (await waitFor<boolean>(`!!${row(newUser.email)}`)) === true;
  const firstPress = rowThere && (await press(rowButton(newUser.email, 'remove')));
  const armedNew = firstPress && (await waitFor<boolean>(`${rowButton(newUser.email, 'remove')}?.textContent === '정말 지우기'`, 3000)) === true;
  const confirmPress = armedNew && (await press(rowButton(newUser.email, 'remove')));
  const REMOVED = '목록에서 지웠습니다. 로그인 계정과 그 사람의 메모는 남아 있습니다.';
  const removedText = confirmPress ? await waitText(usersStatus, REMOVED) : '(누르지 못했다)';
  const rowGone = (await waitFor<boolean>(`!${row(newUser.email)}`, 5000)) === true;
  record('18. 새 사용자 줄의 지우기를 두 번 누르면 지웠다는 문구가 나오고 줄이 없어진다', removedText === REMOVED && rowGone, `문구 "${removedText}", 줄 ${rowGone ? '없어짐' : '남음'}`);
  await closeSheet('.users');

  // 19
  const removedSubmitted = await submitLogin(newUserLater);
  const noneNotice = removedSubmitted ? await waitText(NOTICE, NONE_TEXT) : '(로그인하지 못했다)';
  const noneNoCalendar = await js<boolean>("!document.querySelector('.calendar')");
  const noneOut = noneNotice === NONE_TEXT && (await press(button(q('.login-card'), '로그아웃'))) && (await waitFor<boolean>(LOGIN_FORM)) === true;
  record(
    '19. 지운 사용자가 로그인하면 달력 대신 허가 없음 안내를 보고, 로그아웃할 수 있다',
    noneNotice === NONE_TEXT && noneNoCalendar && noneOut,
    `안내 "${noneNotice}", 달력 ${noneNoCalendar ? '없음' : '있음'}, 로그아웃 뒤 ${noneOut ? '로그인 화면' : '로그인 화면 아님'}`,
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
    passed = results.length === STEPS && results.every((x) => x.ok);
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
