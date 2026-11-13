# CalendarFIF ③ 단계: PC 바탕화면 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹앱 화면을 투명한 Electron 창에 담아 Windows 바탕화면에 붙이고, DesktopCal의 설정 대부분과 트레이·전역 단축키·자동 실행을 갖춘 PC 앱을 만든다. 아이폰 웹앱의 달 넘기기를 손가락을 따라 움직이게 고친다.

**Architecture:** 화면은 웹앱 코드(`src/web`)를 `--mode desktop`으로 빌드해 `app://calfif/`에서 읽고, 동기화(`src/sync`, `src/core`)는 그대로 쓴다. 메인 프로세스(`src/desktop`)는 Electron·Win32를 부르는 얇은 모듈과, 그 모듈이 부르는 순수 함수(배치, 공휴일, 설정 검사, 창 자리, 단축키, 메뉴)로 나눈다. 눈으로 볼 수 없는 창 동작은 `CALFIF_SMOKE` 시험 실행이 상태를 JSON으로 적어 확인한다.

**Tech Stack:** TypeScript 7, Node 24, Vite 8, Vitest 5(+ happy-dom), Firebase JS SDK 13, firebase-tools 15 에뮬레이터, Electron 45(이 PC에서 실험한 45.3.1), koffi 3(실험한 3.3.8), @electron/packager. UI 프레임워크는 쓰지 않는다.

**Spec:** `docs/superpowers/specs/2026-11-13-pc-desktop-app-design.md`. 데이터 모델과 동기화 규칙은 `docs/superpowers/specs/2026-11-13-calendar-sync-design.md` 6, 7절, 웹앱은 8.1절. 실험 기록 `.superpowers/sdd/phase3-prep/notes.md`와 DesktopCal 설정 목록 `.superpowers/sdd/phase3-prep/desktopcal-settings.md`는 git 밖, 이 폴더에만 있다.

## Global Constraints

**① 단계에서 이어지는 것**
- 비용 0원. Firebase 무료 요금제(Spark)만 쓴다. 결제 수단이 필요한 기능(Cloud Functions 등)을 쓰지 않는다.
- DesktopCal의 서버에 접속하지 않는다. 그 프로그램의 코드나 이미지를 가져다 쓰지 않는다.
- 사용자의 `calendar.db`, 상태 파일, 로그인 정보, 실제 메모 내용을 저장소, 테스트 자료, 로그에 넣지 않는다. 테스트 자료는 지어낸 것만 쓴다.
- 문서 형식(`users/{uid}/months/{YYYY-MM}`, `text`, `color`, `editedAt`, `editedBy`)과 동기화·병합 규칙(설계 6, 7절)을 바꾸지 않는다. `src/core/merge.ts`, `src/sync/*`는 고치지 않는다. PC 앱의 `editedBy`는 `pc`다(`deviceLabel`).
- 화면 문구는 한국어다. 주소 뒤 `#YYYY-MM-DD`는 그 날짜의 편집 화면을 연다(PC 앱도 같다). 목표치: 다른 기기 반영 5초 이내.
- 에뮬레이터 포트: Firestore 8085, Auth 9095. 에뮬레이터 프로젝트 ID는 `demo-calfif`, 시험용 소유자 uid는 `owner-test-uid`다.
- 브랜치는 `phase-3-desktop-app`. `git add`는 경로를 적어서 한다. `.mcp.json`은 사용자 파일이므로 커밋하지 않는다. 커밋 메시지 끝에는 실행 세션의 지침에 있는 `Co-Authored-By` 줄을 붙인다.
- 이 계획의 설정 예와 설치된 버전의 문법이 다르면 설치된 버전의 타입 정의를 따른다(예: Vite 8의 `build.rolldownOptions`).
- 테스트 코드는 이 계획에 적힌 대로 쓴다. 설치된 도구 버전 때문에 문법이나 타입 오류가 나면 단언의 뜻을 바꾸지 않는 최소한의 수정만 하고 보고서에 적는다.

**사용자의 프로젝트와 PC를 지키는 것**
- 이 폴더는 사용자의 실제 Firebase 프로젝트에 연결돼 있다(`.env.local`, `.firebaserc`). 실행자는 `npm run deploy`, `npm run import`, `npm run dev`, `npm run build`, `npm run desktop`, `npm run desktop:pack`, `firebase deploy`, `firebase use`를 실행하지 않고 `release/` 아래의 실행 파일을 띄우지 않는다. 에뮬레이터 쪽 명령(`dev:emu`, `dev:desktop-emu`, `desktop:smoke`, `desktop:pack:emu`, `desktop:pack:check`, `test:emu`)만 쓴다.
- DesktopCal의 파일, 프로세스, 창을 건드리지 않는다(읽기, 메시지 보내기, 끄기 모두). 탐색기를 다시 시작하지 않는다. 탐색기 재시작은 앱이 자기 창을 없애는 것으로 흉내 낸다(Task 6).
- 화면을 찍지 않는다. 그림은 `webContents.capturePage()`(앱 자기 창의 화소)와 `scripts/shot.ts`(헤드리스 Edge 안의 페이지)로만 만든다. 화면은 잠겨 있다고 보고, 잠금을 풀거나 막지 않는다.
- Windows의 전원, 잠금, 시작 프로그램 설정을 바꾸지 않는다. "Windows 시작 시 실행"은 꾸린 앱의 실제 실행에서만 건다. 개발 실행과 시험 실행은 `app.setLoginItemSettings`를 부르지 않는다(Task 6 `resolveRuntime`, Task 8 `startupAction`).
- 시험·에뮬레이터 실행은 저장소 안의 프로필(`build/desktop-smoke/profile`, `build/desktop-emu/profile`)을 쓴다. `%APPDATA%\CalendarFIF`는 사용자의 실제 실행만 쓴다. 앱이 등록한 전역 단축키는 끝날 때 모두 푼다.

**의존성**
- 새 의존성은 무료 오픈소스인 `electron`(devDependencies), `koffi`(dependencies), `@electron/packager`(devDependencies)뿐이다.
- npm 11은 설치 스크립트를 막는다. Electron 실행 파일은 `npm run desktop:setup`(`node node_modules/electron/install.js`)으로 받는다. koffi는 설치 스크립트 없이 동작한다. 워크트리마다 `npm install`과 `npm run desktop:setup`을 따로 한다.

**Electron 보안**
- 모든 창: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, 그리고 `app.enableSandbox()`. preload는 `window.calfifDesktop`에 `src/desktop/api.ts`의 `CalfifDesktop` 함수 여덟 개만 내놓는다. `ipcRenderer`나 IPC 이벤트 객체를 화면에 넘기지 않는다.
- 화면은 `app://calfif/`에서만 읽는다. 원격 페이지, 원격 스크립트, iframe을 읽지 않는다. `will-navigate`와 `will-redirect`는 `app://calfif/`가 아니면 막고, 새 창(`setWindowOpenHandler`)과 `<webview>`는 거부하고, 권한 요청은 모두 거절한다. `app://` 응답에는 Task 6의 `CSP`를 붙인다.
- IPC 처리기는 보낸 프레임의 주소가 `app://calfif/`인지 보고(`isAppUrl`), `src/desktop/ipc.ts`의 검사를 통과한 인자만 쓴다. 틀린 요청은 무시한다.
- 데스크톱 빌드의 Firebase Auth는 팝업·리디렉트 처리기 없이 만든다(Task 5). Auth 도메인의 페이지를 읽지 않기 위해서다.

**화면과 설정**
- 설정은 기기별이고 동기화하지 않는다. 달력 모양은 화면의 `localStorage` 키 `calfif.appearance`, 창과 시스템은 프로필 폴더의 `settings.json`에 둔다.
- 웹앱(아이폰, 브라우저)의 모습과 동작은 Task 1의 달 넘기기 말고는 바뀌지 않는다. 웹앱은 늘 `WEB_APPEARANCE`(전체 월, 일요일 시작)로 그린다.
- 화면 문구는 이 계획에 적힌 그대로 쓴다. 설계 8절 표와 9절의 이름은 글자 그대로다.

## Review Focus

- 바탕화면 달력을 클릭, 더블클릭, 오른쪽 클릭하거나 메뉴를 열고 닫는다. DesktopCal이 다른 모니터에 함께 떠 있다 → 달력이 다른 창 앞에 남지 않는다. 입력 중(편집·설정·로그인)·위치 조정·맨 위에 보기가 아니면 맨 아래로 돌아가고, 바탕화면에 붙은 다른 창(DesktopCal)과 맨 아래 자리를 다투지 않는다. (Task 6 `isAtBottom`, `shouldKeepBottom`, attach 시험 실행)
- 활성화되지 않는 창의 편집 화면에서 한글을 입력한다 → 더블클릭하면 창이 입력을 받고 메모 칸에 커서가 간다. 조합 중의 Esc와 Ctrl+Enter는 조합만 끝낸다. 입력기 후보 창이 뜨거나 다른 곳을 눌러 창이 포커스를 잃어도 편집 화면이 닫히거나 창이 내려가지 않는다. (Task 5 `Interactivity`와 편집 화면 테스트, Task 6 `shouldKeepBottom`)
- 탐색기가 다시 시작된다 → Progman이 다시 생긴 뒤 몇 초 안에 달력이 같은 자리에 다시 붙고 로그인과 오프라인 캐시가 남는다. 앱이 스스로 끝낼 때는 다시 만들지 않는다. (Task 6 `Reattacher`, attach 시험 실행의 `recreated`)
- 저장한 자리가 있는 모니터를 빼거나 해상도가 바뀐다 → 남은 모니터의 작업 영역 안에 기본 크기로 뜨고, 다시 꽂으면 그 구성에서 저장한 자리로 돌아간다. 어떤 경우에도 화면 밖으로 완전히 나가지 않는다. (Task 7 `resolveBounds`, `clampBounds`)
- `settings.json`이 깨졌거나 예전 형식이다, `calfif.appearance`가 깨졌다 → 앱이 뜬다. 맞는 칸은 살리고 틀린 칸만 기본값으로 두며, 깨진 `settings.json`은 `settings.json.corrupt`로 보관한다. (Task 7 `loadDesktopSettings`, Task 2 `parseAppearance`)

## File Structure

| 경로 | 책임 |
|---|---|
| `src/web/ui/swipe.ts` | 달 넘기기 손가락 계산(순수) |
| `src/core/layout.ts`, `lunar.ts`, `holidays.ts`, `accelerator.ts` | 배치·주 번호, 음력, 공휴일, 단축키 문자열(순수) |
| `src/web/appearance.ts`, `src/web/desktop.css` | 달력 모양 설정(기본값, 검사, 저장, CSS 변수)과 `:root.desk` 아래의 투명한 화면 |
| `src/web/desktop/*` | 화면 쪽 PC 기능: 다리와 가짜 다리, 입력 받기, 칸 메뉴, 소리, 위치 조정, 설정 쪽 |
| `src/desktop/api.ts` | 메인과 화면이 같이 쓰는 다리 타입과 IPC 채널 이름 |
| `src/desktop/{runtime,protocol,policy,ipc,bounds,settings,hotkeys,menu,startup}.ts` | 메인 프로세스의 순수 규칙. `electron`과 `koffi`를 가져오지 않는다 |
| `src/desktop/{main,window,win32,tray,preload,smoke}.ts` | Electron·Win32를 부르는 얇은 모듈(시험 실행과 타입 검사로 확인) |
| `vite.desktop.config.ts`, `scripts/desktop-run.ts`, `scripts/pack-*.ts` | 메인·preload 묶기, 빌드와 실행과 시험 실행 확인, 꾸리기 |

테스트 위치: `src/core`, `src/desktop`, `scripts`의 `*.test.ts`는 지금 설정의 `unit` 프로젝트(node, `src/**/*.test.ts`에서 `src/web/**`만 뺀다)에 이미 들어가고 `src/web/**`는 `dom` 프로젝트(happy-dom)다. `vitest.config.ts`는 바꾸지 않는다. node에서 `import 'electron'`은 실행 파일 경로 문자열일 뿐이므로 테스트하는 모듈은 `electron`과 `koffi`를 가져오지 않는다.

## 실행 메모

- 시작할 때 이 계획을 어느 계정, 어느 폴더가 진행하는지 `docs/superpowers/coordination.md`에 적는다. 진행 기록은 `.superpowers/sdd/2026-11-13-phase3-desktop-app/progress.md`(git 밖)에 남긴다.
- Task 1은 나머지와 무관하게 웹앱에 들어간다. 다시 배포해야 아이폰에 보이고, 배포는 사용자가 한다. 에뮬레이터에는 Java 21 이상이 필요하다(없으면 `npx tsx scripts/jdk.ts`).
- 테스트 코드에는 `vitest`(`describe`, `it`, `expect`, `vi`, `afterEach` 중 쓰는 것)와 시험 대상 모듈(테스트 파일 이름에서 `.test`를 뺀 것)을 가져오는 줄을 적지 않았다. 쓰는 이름을 그대로 가져온다. 그 밖의 곳에서 가져오는 것만 적었다.
- 명령은 Git Bash 문법이다. PowerShell에서는 `CALFIF_SMOKE=bounds npm run desktop:smoke` 대신 `$env:CALFIF_SMOKE='bounds'; npm run desktop:smoke`.
- 시험 실행(`npm run desktop:smoke`)은 에뮬레이터를 띄우고 예시 데이터를 넣고, 에뮬레이터용 화면과 메인을 빌드해 지운 프로필로 Electron을 띄운다. 앱은 `CALFIF_SMOKE`의 시나리오를 하고 `build/desktop-smoke/<시나리오>.json`에 `{ scenario, ok, failures, ... }`를 적고 끝난다. `failures`가 비어 있지 않거나 90초 안에 끝나지 않으면 명령이 1로 끝난다. 각 Task의 Expected는 그 JSON의 값이다. 창 크기 비교는 화면 배율이 100%가 아니면 ±2px까지 같다고 본다.
- "화면 확인"은 `npm run dev:emu`나 `npm run dev:desktop-emu`를 백그라운드로 띄우고 `scripts/shot.ts`로 `http://localhost:5173/?autologin=1`을 찍어 실행자가 직접 보고 판단한다. 바탕화면 대신 `--eval "document.documentElement.style.background='#3B6E8F'"`로 단색 바탕을 깐다. 끝나면 띄운 프로세스를 끈다.
- 실제 바탕화면에서의 모습, 아이폰에서의 손맛, 한글 입력기 후보 창의 자리, Win+D, 재부팅 뒤 자동 실행은 사용자가 확인한다(Task 10 Step 7).

---

### Task 1: 아이폰에서 달 넘기기를 손가락에 붙인다

**Files:**
- Create: `src/web/ui/swipe.ts`, `src/web/ui/swipe.test.ts`
- Modify: `src/web/ui/calendar.ts`, `src/web/ui/calendar.test.ts`, `src/web/styles.css`

**Interfaces:**
- Consumes: `buildMonthGrid`, `shiftMonth`(`src/core/dates.ts`), `CalendarStore`의 `current`, `show`, `days`.
- Produces:
```ts
// src/web/ui/swipe.ts
export const SWIPE = { slopPx: 8, commitRatio: 0.2, flickPxPerMs: 0.5, windowMs: 100, durationMs: 200 } as const;
export type Sample = { x: number; t: number };
export function lockAxis(dx: number, dy: number): 'x' | 'y' | null; // 둘 다 8px 이하면 null, |dx|>|dy|면 'x', 아니면 'y'
export function velocity(samples: Sample[]): number;              // 마지막 표본과, 그보다 100ms 안쪽의 가장 오래된 표본 사이의 px/ms
export function swipeOutcome(dx: number, width: number, vx: number): -1 | 0 | 1; // 1 = 다음 달(왼쪽으로 끌었다)
export function dragOffset(dx: number, width: number): number;    // [-width, width]로 자른다
// src/web/ui/calendar.ts: mountCalendar에 세 번째 인자를 더한다
export type CalendarEnv = { frame?(cb: () => void): void; reducedMotion?(): boolean; now?(): number };
```

정해 둔 값:
- 넘기는 기준(설계 10절): `|dx| > width × 0.2`면 그쪽으로. 아니면 `|dx| ≥ 8`, `|vx| ≥ 0.5`이고 `vx`와 `dx`의 부호가 같을 때 그쪽으로. 그 밖에는 제자리.
- DOM은 `.pager > .track > .grid`. 끄는 방향이 정해지면 옆 달을 `.grid.peek`(`data-side`가 `next`면 오른쪽, `prev`면 왼쪽, `position: absolute`)으로 `.track` 안에 그리고, `.track.style.transform`을 정확히 `translate3d(${x}px, 0px, 0px)` 모양으로 쓴다. 방향이 바뀌면 `.peek`을 반대쪽 달로 다시 그린다.
- 손을 떼면 `transition`을 `transform 200ms ease-out`, 목표를 `-outcome × width`(제자리면 0)로 둔다. `transitionend`나 260ms 타이머 중 먼저 오는 쪽에서 `transition`과 `transform`을 빈 문자열로 돌리고 `.peek`을 지우며, 넘어갈 때만 `store.show(새 달)`과 다시 그리기를 한다.
- 레이아웃은 `pointerdown`에서 한 번만 읽는다(폭 = `pager.clientWidth || window.innerWidth`). 끄는 동안은 `env.frame`(기본 `requestAnimationFrame`) 안에서 `transform`만 쓰고, `.peek`의 칸 줄 수는 마지막으로 잰 값을 다시 쓴다.
- 방향이 `'x'`면 `setPointerCapture`를 시도한다(없거나 실패해도 계속). `'y'`면 그 끌기는 끝까지 무시한다. 시간은 `env.now`(기본 `performance.now`), 표본은 `pointerdown`, `pointermove`, `pointerup`에서 모은다.
- `env.reducedMotion()`(기본 `matchMedia('(prefers-reduced-motion: reduce)').matches`)이 참이면 따라 움직이지 않고 `.peek`도 없으며, 손을 떼는 순간 같은 기준으로 바로 넘긴다.
- 방향이 `'x'`로 정해진 끌기 뒤 300ms 안의 `click`은 날짜를 열지 않는다. `touch-action: pan-y`는 `.pager`로 옮긴다.

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// src/web/ui/swipe.test.ts
it('8px을 넘게 움직여야 방향을 정하고, 같으면 세로로 본다', () => {
  expect([lockAxis(5, 2), lockAxis(9, 3), lockAxis(-12, 11), lockAxis(3, 9), lockAxis(10, -10)]).toEqual([null, 'x', 'x', 'y', 'y']);
});
it('폭의 20%를 넘게 끌었거나 같은 쪽으로 빠르게 튕기면 넘긴다', () => {
  expect([swipeOutcome(-81, 400, 0), swipeOutcome(-80, 400, 0), swipeOutcome(90, 400, 0)]).toEqual([1, 0, -1]);
  expect([swipeOutcome(-30, 400, -0.6), swipeOutcome(-30, 400, 0.6), swipeOutcome(-5, 400, -2)]).toEqual([1, 0, 0]);
});
it('속도는 마지막 100ms의 움직임으로 재고, 끄는 거리는 폭을 넘지 않는다', () => {
  expect(velocity([{ x: 0, t: 0 }, { x: -30, t: 50 }, { x: -60, t: 100 }])).toBeCloseTo(-0.6);
  expect(velocity([{ x: 0, t: 0 }, { x: -100, t: 500 }, { x: -110, t: 600 }])).toBeCloseTo(-0.1);
  expect([velocity([{ x: 5, t: 10 }]), dragOffset(-500, 400), dragOffset(30, 400)]).toEqual([0, -400, 30]);
});
```
```ts
// src/web/ui/calendar.test.ts 끝에 추가 (fakeStore, cell은 이 파일의 것)
describe('달 넘기기', () => {
  afterEach(() => { vi.useRealTimers(); });
  function swipeMount(reduced = false) {
    let t = 0;
    const root = document.createElement('div');
    const store = fakeStore({});
    const onOpenDay = vi.fn();
    mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn() },
      { frame: (cb) => cb(), reducedMotion: () => reduced, now: () => t });
    const pager = root.querySelector<HTMLElement>('.pager')!;
    const fire = (type: string, x: number, y: number, at: number) => {
      t = at;
      pager.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    };
    return { root, store, onOpenDay, fire, track: root.querySelector<HTMLElement>('.track')! };
  }
  it('끄는 동안 손가락을 따라 움직이고, 20%를 넘게 끌고 놓으면 200ms 미끄러진 뒤 넘어간다', () => {
    vi.useFakeTimers();
    const { root, store, track, fire } = swipeMount(); // 폭은 window.innerWidth = 1024
    fire('pointerdown', 600, 300, 0);
    fire('pointermove', 550, 302, 30);
    expect(track.style.transform).toBe('translate3d(-50px, 0px, 0px)');
    const peek = root.querySelector<HTMLElement>('.grid.peek')!;
    expect([peek.dataset.side, peek.querySelector('.cell[data-key="2026-12-01"]') !== null]).toEqual(['next', true]);
    fire('pointermove', 390, 300, 800);
    fire('pointerup', 390, 300, 1000);
    expect([track.style.transform, track.style.transition.includes('200ms')]).toEqual(['translate3d(-1024px, 0px, 0px)', true]);
    expect(store.show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(store.show).toHaveBeenLastCalledWith('2026-12');
    expect([track.style.transform, root.querySelector('.grid.peek')]).toEqual(['', null]);
  });
  it('세로로 움직이면 넘기지 않는다', () => {
    const { root, store, track, fire } = swipeMount();
    fire('pointerdown', 500, 300, 0);
    fire('pointermove', 505, 380, 30);
    fire('pointerup', 505, 420, 60);
    expect([track.style.transform, root.querySelector('.grid.peek'), store.show.mock.calls.length]).toEqual(['', null, 0]);
  });
  it('동작 줄이기가 켜져 있으면 따라 움직이지 않고 손을 떼는 순간 넘기며, 그 뒤의 click은 날짜를 열지 않는다', () => {
    const { root, store, onOpenDay, track, fire } = swipeMount(true);
    fire('pointerdown', 600, 300, 0);
    fire('pointermove', 300, 300, 100);
    expect(track.style.transform).toBe('');
    fire('pointerup', 300, 300, 200);
    expect(store.show).toHaveBeenLastCalledWith('2026-12');
    cell(root, '2026-12-10').click();
    expect(onOpenDay).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run --project dom src/web/ui` → FAIL(`./swipe`가 없고 `.pager`가 없다).
- [ ] **Step 3: 구현** — "정해 둔 값"대로 쓴다. 지금의 `render()`에서 "격자 요소 하나에 한 달의 칸을 채우는 함수"를 떼어 내 본 격자와 `.peek`이 같이 쓴다.
- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` → PASS, 타입 오류 없음.
- [ ] **Step 5: 화면 확인** — `npm run dev:emu`를 띄우고 402x874로 두 장 찍는다. 두 번째는 `--eval`로 `.pager`에 `pointerdown`(300,400)과 `pointermove`(180,404) `PointerEvent`만 보내고 놓지 않는다. Expected: 이번 달이 왼쪽으로 120px 밀리고 다음 달 칸이 오른쪽에서 들어와 있다. 가로 스크롤이 없다.
- [ ] **Step 6: Commit**
```bash
git add src/web/ui/swipe.ts src/web/ui/swipe.test.ts src/web/ui/calendar.ts src/web/ui/calendar.test.ts src/web/styles.css
git commit -m "feat: 달 넘기기가 손가락을 따라 움직인다"
```

---

### Task 2: 달력 모양 설정과 배치 계산

**Files:**
- Create: `src/core/layout.ts`, `src/core/layout.test.ts`, `src/web/appearance.ts`, `src/web/appearance.test.ts`

**Interfaces:**
- Consumes: `GridCell`, `monthIdOf`, `buildMonthGrid`(`src/core/dates.ts`), `KeyValueStore`(`src/sync/outbox.ts`).
- Produces:
```ts
// src/core/layout.ts
export type Layout = 'floating' | 'month' | 'week' | 'days'; // 변동 월, 전체 월, 고정 단일 행, 변동 단일 행
export type WeekRule = 'jan1' | 'iso';                        // 1월 1일이 든 주, ISO 방식
export type PageOptions = { layout: Layout; maxRows: number; pastWeeks: number; weekStart: number; firstWeek: WeekRule };
export type Page = { anchor: string; title: string; weekdays: number[]; rows: { week: number; cells: GridCell[] }[] };
export function addDays(dateKey: string, n: number): string;
export function startOfWeek(dateKey: string, weekStart: number): string;
export function weekNumber(rowStart: string, weekStart: number, rule: WeekRule): number;
export function buildPage(opts: PageOptions, anchor: string): Page;
export function stepPage(opts: PageOptions, anchor: string, delta: number): string;
export function pageMonths(page: Page): string[]; // 쪽에 보이는 달, 오름차순
// src/web/appearance.ts
export type Bullet = 'none' | 'number' | 'dot';
export type FontSetting = { color: string; size: number };
export type Appearance = {
  version: 1; layout: Layout; maxRows: number; pastWeeks: number; monthGap: boolean; weekNumbers: boolean;
  shadow: boolean; titleBar: boolean; holidays: boolean; lunar: boolean; bullet: Bullet; cellGap: number;
  lineSpacing: number; doneToBottom: boolean; showDone: boolean; doneTone: 'none' | 'short';
  calendarFont: FontSetting; memoFont: FontSetting; calendarBg: string; restBg: string; todayBorder: string;
  titleButton: string; holidayInk: string; lunarInk: string; transparency: number; weekStart: number;
  firstWeek: WeekRule; showRestDays: boolean; restDays: number[];
};
export const APPEARANCE_KEY = 'calfif.appearance';
export const DEFAULT_APPEARANCE: Appearance;
export const WEB_APPEARANCE: Appearance; // { ...DEFAULT_APPEARANCE, layout: 'month', holidays: false, monthGap: false, shadow: false }
export function parseAppearance(raw: unknown): Appearance;
export function loadAppearance(store: KeyValueStore): Appearance;
export function saveAppearance(store: KeyValueStore, a: Appearance): void;
export function pageOptions(a: Appearance): PageOptions;
```

정해 둔 값:
- 날짜 계산은 `Date.UTC`로 한다(지역 시간대에 흔들리지 않게).
- `buildPage`: `month`는 기준 날짜가 든 달의 1일이 든 주부터 마지막 날이 든 주까지이고 그 달 날짜만 `inMonth`. `floating`은 `startOfWeek(anchor)`에서 `min(pastWeeks, maxRows − 1)`주 앞부터 `maxRows`줄. `week`는 `startOfWeek(anchor)`부터, `days`는 `anchor`부터 한 줄. `month` 밖의 배치는 모든 칸이 `inMonth`. `title`은 기준 날짜의 `YYYY-MM`, `weekdays`는 첫 줄 일곱 칸의 요일, 줄의 `week`는 `weekNumber(startOfWeek(그 줄 첫 날), weekStart, firstWeek)`.
- `weekNumber`: `jan1`은 그 줄 마지막 날이 속한 해의 1월 1일이 든 주가 1주, `iso`는 그 줄 넷째 날이 속한 해의 1월 4일이 든 주가 1주(월요일 시작이면 ISO 8601과 같다).
- `stepPage`: `month`는 `delta`달 옮긴 달의 1일, `floating`은 `maxRows × 7 × delta`일, `week`와 `days`는 `7 × delta`일.
- `parseAppearance`: 객체가 아니면 기본값. 아는 칸만 읽는다. 범위 있는 정수(최대 행 2~8, 지나간 주 0~3, 셀 간격 0~12, 캘린더 글꼴 11~20, 편집 내용 글꼴 11~22, 투명도 0~100)는 범위로 자르고, 줄 간격은 1.0~2.0으로 자른 뒤 0.05 단위로 반올림한다. 숫자가 아니면 기본값. 고르는 값(배치, 줄 머리, 알람, 첫번째 주, 시작 요일 0~6)은 목록 밖이면 기본값. 색은 `#`을 떼고 대문자로 바꾼 16진수 6자리만 받고, 빈 문자열(없음)은 `calendarBg`, `restBg`, `todayBorder`만 받는다. `restDays`는 0~6 정수를 중복 없이 정렬한다. `version`이 없거나 달라도 같은 규칙으로 읽어 `version: 1`로 돌려준다. `loadAppearance`는 값이 없거나 JSON이 깨졌으면 기본값.

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// src/core/layout.test.ts
import { buildMonthGrid } from './dates';

const opts = (o: Partial<PageOptions> = {}): PageOptions => ({ layout: 'floating', maxRows: 5, pastWeeks: 1, weekStart: 0, firstWeek: 'jan1', ...o });
const keys = (page: Page) => page.rows.flatMap((r) => r.cells.map((c) => c.dateKey));
const ends = (page: Page) => [keys(page)[0], keys(page).at(-1)];

it('날짜를 더하고 주의 시작을 찾는다', () => {
  expect([addDays('2026-12-30', 3), addDays('2026-03-01', -1)]).toEqual(['2027-01-02', '2026-02-28']);
  expect([startOfWeek('2026-11-13', 0), startOfWeek('2026-11-13', 1), startOfWeek('2026-11-08', 0)]).toEqual(['2026-11-08', '2026-11-09', '2026-11-08']);
});
it('전체 월은 웹앱의 달력과 같고 시작 요일을 따른다', () => {
  const sun = buildPage(opts({ layout: 'month' }), '2026-11-13');
  expect(keys(sun)).toEqual(buildMonthGrid('2026-11').map((c) => c.dateKey));
  expect([sun.title, sun.weekdays]).toEqual(['2026-11', [0, 1, 2, 3, 4, 5, 6]]);
  const mon = buildPage(opts({ layout: 'month', weekStart: 1 }), '2026-11-13');
  expect([mon.rows.length, ends(mon), mon.weekdays, mon.rows[0].cells[0].inMonth]).toEqual([6, ['2026-10-26', '2026-12-06'], [1, 2, 3, 4, 5, 6, 0], false]);
});
it('변동 월은 오늘이 든 주 앞에 지나간 주를 두고 정해진 줄 수만큼, 단일 행은 이번 주 또는 오늘부터 7일', () => {
  const page = buildPage(opts(), '2026-11-13');
  expect([page.rows.length, ends(page), page.rows.every((r) => r.cells.every((c) => c.inMonth))]).toEqual([5, ['2026-11-01', '2026-12-05'], true]);
  const clamped = buildPage(opts({ maxRows: 2, pastWeeks: 3 }), '2026-11-13');
  expect([clamped.rows.length, keys(clamped)[0]]).toEqual([2, '2026-11-01']);
  expect(ends(buildPage(opts({ layout: 'week' }), '2026-11-13'))).toEqual(['2026-11-08', '2026-11-14']);
  const days = buildPage(opts({ layout: 'days' }), '2026-11-13');
  expect([ends(days), days.weekdays]).toEqual([['2026-11-13', '2026-11-19'], [5, 6, 0, 1, 2, 3, 4]]);
});
it('주 번호: 1월 1일이 든 주, 또는 ISO 방식', () => {
  expect([weekNumber('2026-11-08', 0, 'jan1'), weekNumber('2026-12-27', 0, 'jan1'), weekNumber('2026-12-20', 0, 'jan1')]).toEqual([46, 1, 52]);
  expect([weekNumber('2026-11-08', 0, 'iso'), weekNumber('2026-12-28', 1, 'iso'), weekNumber('2027-01-04', 1, 'iso')]).toEqual([45, 53, 1]);
  expect(buildPage(opts(), '2026-11-13').rows.map((r) => r.week)).toEqual([45, 46, 47, 48, 49]);
});
it('한 쪽씩 넘기고, 쪽에 보이는 달을 모두 알려 준다', () => {
  expect([stepPage(opts({ layout: 'month' }), '2026-11-13', 1), stepPage(opts({ layout: 'month' }), '2026-01-31', -1), stepPage(opts(), '2026-11-13', 1)]).toEqual(['2026-12-01', '2025-12-01', '2026-12-18']);
  expect([stepPage(opts({ layout: 'week' }), '2026-11-13', -1), stepPage(opts({ layout: 'days' }), '2026-11-13', 1)]).toEqual(['2026-11-06', '2026-11-20']);
  expect(keys(buildPage(opts(), '2026-12-18'))[0]).toBe('2026-12-06'); // 이번 쪽의 끝(12-05) 바로 다음
  expect(pageMonths(buildPage(opts({ maxRows: 8, pastWeeks: 0 }), '2026-01-31'))).toEqual(['2026-01', '2026-02', '2026-03']);
  expect(pageMonths(buildPage(opts({ layout: 'week' }), '2026-11-13'))).toEqual(['2026-11']);
});
```
```ts
// src/web/appearance.test.ts
import { MemoryStorage } from '../sync/testing';

it('기본값은 설계 8절의 표와 같다', () => {
  expect(DEFAULT_APPEARANCE).toEqual({
    version: 1, layout: 'floating', maxRows: 5, pastWeeks: 1, monthGap: true, weekNumbers: false, shadow: true,
    titleBar: true, holidays: true, lunar: false, bullet: 'none', cellGap: 4, lineSpacing: 1.35, doneToBottom: false,
    showDone: true, doneTone: 'none', calendarFont: { color: 'FFFFFF', size: 13 }, memoFont: { color: 'FFFFFF', size: 14 },
    calendarBg: '141820', restBg: '3A1F24', todayBorder: '6AA6FF', titleButton: 'FFFFFF', holidayInk: 'FF6B6B',
    lunarInk: '9FB3C8', transparency: 60, weekStart: 0, firstWeek: 'jan1', showRestDays: true, restDays: [0, 6],
  });
  expect(WEB_APPEARANCE).toEqual({ ...DEFAULT_APPEARANCE, layout: 'month', holidays: false, monthGap: false, shadow: false });
});
it('범위 밖은 범위 안으로, 목록 밖과 틀린 형식은 기본값으로, 색은 대문자 6자리로', () => {
  const a = parseAppearance({ version: 1, maxRows: 12, pastWeeks: -1, cellGap: 30, lineSpacing: 1.333, transparency: 101, weekStart: 7, layout: 'spiral', bullet: 'dot', calendarFont: { color: 'ff0000', size: 40 }, memoFont: 'big' });
  expect([a.maxRows, a.pastWeeks, a.cellGap, a.lineSpacing, a.transparency, a.weekStart, a.layout, a.bullet]).toEqual([8, 0, 12, 1.35, 100, 0, 'floating', 'dot']);
  expect([a.calendarFont, a.memoFont]).toEqual([{ color: 'FF0000', size: 20 }, { color: 'FFFFFF', size: 14 }]);
  const b = parseAppearance({ calendarBg: '', todayBorder: '#6aa6ff', holidayInk: '', lunarInk: 'xyz', restDays: [6, 0, 0, 9] });
  expect([b.calendarBg, b.todayBorder, b.holidayInk, b.lunarInk, b.restDays]).toEqual(['', '6AA6FF', 'FF6B6B', '9FB3C8', [0, 6]]);
});
it('깨졌거나 예전 형식의 저장 값에서도 열린다', () => {
  expect(parseAppearance('garbage')).toEqual(DEFAULT_APPEARANCE);
  expect(parseAppearance({ maxRows: 3, unknown: 1 })).toEqual({ ...DEFAULT_APPEARANCE, maxRows: 3 });
  const store = new MemoryStorage();
  store.setItem(APPEARANCE_KEY, '{not json');
  expect(loadAppearance(store)).toEqual(DEFAULT_APPEARANCE);
  saveAppearance(store, { ...DEFAULT_APPEARANCE, lunar: true });
  expect(loadAppearance(store).lunar).toBe(true);
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/core/layout.test.ts src/web/appearance.test.ts` → FAIL(`./layout`, `./appearance`가 없다).
- [ ] **Step 3: 구현** — Interfaces와 "정해 둔 값"대로 쓴다. `pageOptions(a)`는 `a`의 다섯 칸을 옮긴다.
- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` → PASS, 타입 오류 없음.
- [ ] **Step 5: Commit**
```bash
git add src/core/layout.ts src/core/layout.test.ts src/web/appearance.ts src/web/appearance.test.ts
git commit -m "feat: 달력 모양 설정과 네 가지 배치 계산"
```

---

### Task 3: 대한민국 공휴일과 음력

**Files:**
- Create: `src/core/lunar.ts`, `src/core/lunar.test.ts`, `src/core/holidays.ts`, `src/core/holidays.test.ts`

**Interfaces:**
- Produces:
```ts
// src/core/lunar.ts
export type LunarDate = { month: number; day: number; leap: boolean };
export function lunarDate(dateKey: string): LunarDate;
export function lunarLabel(dateKey: string): string;                                  // '음 10.5', 윤달은 '음 윤6.1'
export function solarOfLunar(year: number, month: number, day: number): string | null; // 그 양력 해에서 윤달이 아닌 음력 날짜
// src/core/holidays.ts
export function holidayNames(dateKey: string): string[]; // 고정 공휴일 먼저, 음력 공휴일 다음
export function holidayLabel(dateKey: string): string;   // 이름을 '·'로 잇는다. 없으면 ''
```

정해 둔 값:
- 음력은 하나만 만든 `new Intl.DateTimeFormat('en-US-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })`의 `formatToParts`로 읽고 날짜는 `Date.UTC`로 만든다. 윤달은 `month`가 `'6bis'`처럼 `bis`로 끝난다(Node 24에서 확인함, Chromium도 같은 ICU 달력이다).
- 고정 공휴일(설계 8절): 1/1 `신정`, 3/1 `3.1절`, 5/5 `어린이날`, 6/6 `현충일`, 8/15 `광복절`, 10/3 `개천절`, 10/9 `한글날`, 12/25 `성탄절`. 음력: 1/1 `설날`과 그 앞뒤 날 `설날 연휴`, 4/8 `부처님오신날`, 8/15 `추석`과 그 앞뒤 날 `추석 연휴`. 대체공휴일과 선거일은 넣지 않는다.
- `solarOfLunar`는 그해 1월 1일부터 하루씩 찾는다. 공휴일 표는 해마다 한 번 만들어 둔다.

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// src/core/lunar.test.ts
it('양력 날짜의 음력 날짜와 윤달', () => {
  expect([lunarDate('2026-11-13'), lunarDate('2025-07-25')]).toEqual([{ month: 10, day: 5, leap: false }, { month: 6, day: 1, leap: true }]);
  expect([lunarLabel('2026-11-13'), lunarLabel('2025-07-25')]).toEqual(['음 10.5', '음 윤6.1']);
});
it('그해의 음력 날짜를 양력으로 찾는다(윤달은 건너뛴다)', () => {
  expect([solarOfLunar(2026, 1, 1), solarOfLunar(2026, 4, 8), solarOfLunar(2026, 8, 15), solarOfLunar(2028, 1, 1), solarOfLunar(2025, 6, 1)])
    .toEqual(['2026-02-17', '2026-05-24', '2026-09-25', '2028-01-27', '2025-06-25']);
});
```
```ts
// src/core/holidays.test.ts
const names = (...keys: string[]) => keys.map((k) => holidayNames(k));
it('날짜가 고정된 공휴일', () => {
  expect(names('2026-01-01', '2026-03-01', '2026-05-05', '2026-06-06', '2026-08-15', '2026-10-03', '2026-10-09', '2026-12-25', '2026-11-13'))
    .toEqual([['신정'], ['3.1절'], ['어린이날'], ['현충일'], ['광복절'], ['개천절'], ['한글날'], ['성탄절'], []]);
});
it('음력으로 정해지는 설날 연휴, 부처님오신날, 추석 연휴', () => {
  expect(names('2026-02-16', '2026-02-17', '2026-02-18', '2026-05-24')).toEqual([['설날 연휴'], ['설날'], ['설날 연휴'], ['부처님오신날']]);
  expect(names('2026-09-24', '2026-09-25', '2026-09-26')).toEqual([['추석 연휴'], ['추석'], ['추석 연휴']]);
  expect(names('2027-02-06', '2027-02-07', '2027-02-08')).toEqual([['설날 연휴'], ['설날'], ['설날 연휴']]);
});
it('대체공휴일은 넣지 않고, 겹치면 둘 다 보여 준다', () => {
  expect(names('2027-02-09', '2028-10-03')).toEqual([[], ['개천절', '추석']]);
  expect([holidayLabel('2028-10-03'), holidayLabel('2026-11-13')]).toEqual(['개천절·추석', '']);
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run --project unit src/core/lunar.test.ts src/core/holidays.test.ts` → FAIL(모듈이 없다).
- [ ] **Step 3: 구현** — Interfaces와 "정해 둔 값"대로 쓴다.
- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` → PASS, 타입 오류 없음.
- [ ] **Step 5: Commit**
```bash
git add src/core/lunar.ts src/core/lunar.test.ts src/core/holidays.ts src/core/holidays.test.ts
git commit -m "feat: 대한민국 공휴일과 음력 날짜"
```

---

### Task 4: 설정을 따르는 달력 그리기

**Files:**
- Modify: `src/web/ui/calendar.ts`, `src/web/ui/calendar.test.ts`, `src/web/appearance.ts`, `src/web/appearance.test.ts`, `src/web/state.ts`, `src/web/state.test.ts`, `src/web/main.ts`, `src/web/styles.css`

**Interfaces:**
- Consumes: Task 2의 `buildPage`, `stepPage`, `pageMonths`, `pageOptions`, `Appearance`, `DEFAULT_APPEARANCE`, `WEB_APPEARANCE`. Task 3의 `holidayNames`, `holidayLabel`, `lunarLabel`. Task 1의 `CalendarEnv`.
- Produces:
```ts
// src/web/appearance.ts
export function appearanceVars(a: Appearance): Record<string, string>;
export function applyAppearance(el: HTMLElement, a: Appearance): void; // appearanceVars를 el.style.setProperty로
// src/web/state.ts (CalendarStore)
show(monthId: string, also?: string[]): void; // 앞뒤 달과 also의 달까지 구독하고 나머지는 해제한다
covers(monthId: string): boolean;             // 지금 구독 중인가
// src/web/ui/calendar.ts
export function displayLines(text: string, opts: { showDone: boolean; doneToBottom: boolean }): { text: string; done: boolean }[];
export type CalendarDeps = { /* 지금의 deps 그대로 */ appearance?: Appearance };
export type CalendarHandle = { destroy(): void; setAppearance(a: Appearance): void; goToday(): void };
export function mountCalendar(root: HTMLElement, deps: CalendarDeps, env?: CalendarEnv): CalendarHandle;
```

정해 둔 값:
- `deps.appearance`가 없으면 `WEB_APPEARANCE`로 그리고 CSS 변수를 쓰지 않는다. 웹앱의 모습과 지금의 테스트는 그대로다.
- 달력은 기준 날짜(`anchor`)를 갖고 `buildPage(pageOptions(a), anchor)`로 그린다. 처음 기준 날짜는 `store.current()`가 오늘의 달이면 오늘, 아니면 그 달 1일. 쪽이 바뀔 때(이전, 다음, 넘기기, 오늘) `store.show(쪽.title, 쪽의 달 중 title±1 밖의 달)`을 부르고 더할 달이 없으면 인자 하나로 부른다. 처음 그릴 때와 설정이 바뀔 때는 더할 달이 있을 때만 부른다. 그릴 때 `store.current()`가 기준 날짜의 달과 다르면(바로가기 주소로 다른 달을 열었다) 기준 날짜를 그 달 1일로 옮긴다. 날짜가 바뀌었을 때 기준 날짜가 어제였으면 오늘로 옮긴다.
- 머리: `전체 월`은 `이전 달`/`다음 달`, 다른 배치는 `이전`/`다음`(`aria-label`). 제목은 `title`의 연·월, 요일 줄은 `weekdays` 순서. `titleBar`가 꺼지면 `.app-head`에 `hidden`. 이전·다음·넘기기는 `stepPage(…, ±1)`(넘기기의 `.peek`도 그 쪽), `오늘`과 `goToday()`는 기준 날짜를 오늘로.
- 칸: 날짜 머리 `span.head` 안에 `.num`, 공휴일 켬이면 `.hname`(`holidayLabel`), 음력 켬이면 `.lunar`(`lunarLabel`). 웹에서 `.head`는 `display: contents`. 공휴일 켬이고 공휴일이면 `holiday`. 그것이거나 `showRestDays`이고 `restDays`의 요일이면 `rest`. 그 달 1~7일이면서 첫 줄이 아니면 `m-top`, 1일이면서 첫 칸이 아니면 `m-left`.
- 루트 `.calendar`: `shadow`, `month-gap` 클래스와 `data-bullet`. 주 번호 켬이면 각 줄 앞에 `.wk` 칸(줄의 `week`)을 두고 격자를 8열로, 요일 줄 앞에 빈 칸.
- 메모 줄은 `displayLines`: 빈 줄을 빼고, `showDone`이 꺼지면 완료 줄을 빼고, `doneToBottom`이면 안 끝낸 줄 다음에 끝낸 줄(각자 순서 유지).
- 줄 높이: 웹은 지금처럼(넓으면 17, 좁으면 13), 설정이 있으면 `Math.round(memoFont.size × lineSpacing)`. 칸 머리 높이는 첫 칸의 `.head`를 재서 뺀다.
- `appearanceVars`: 색(`--desk-cal-ink`, `--desk-memo-ink`, `--desk-today`, `--desk-btn`, `--desk-holiday-ink`, `--desk-lunar-ink`)은 `#RRGGBB`이고 없음이면 `transparent`. 크기는 `13px` 꼴, `--desk-line`은 숫자 문자열, `--desk-gap`은 `4px` 꼴. 칸 배경 두 가지는 `alpha = Math.round(100 − transparency) / 100`으로 `rgba(r, g, b, alpha)`(없음이면 `transparent`). `--desk-day-pct`(날짜 배경색의 진하기)는 `max(0.5, alpha)`의 백분율.
- `main.ts`의 `syncRoute`는 `store.covers(monthId)`가 아닐 때만 `store.show(monthId)`를 부른다(보이는 쪽의 구독을 지키기 위해서다).

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// src/web/state.test.ts 끝에 추가
it('더 필요한 달도 구독하고, 구독 중인지 알려 준다', () => {
  const source = fakeSource();
  const store = new CalendarStore({ source, outbox: new Outbox(new MemoryStorage(), 'u1'), editedBy: 'pc', initialMonth: '2026-01' });
  store.show('2026-01', ['2026-03']);
  expect([...source.listeners.keys()].sort()).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
  expect(store.covers('2026-03')).toBe(true);
  store.show('2026-01');
  expect(store.covers('2026-03')).toBe(false);
});
```
```ts
// src/web/appearance.test.ts 끝에 추가 (import에 appearanceVars)
it('설정을 CSS 변수로 바꾼다', () => {
  expect(appearanceVars(DEFAULT_APPEARANCE)).toEqual({
    '--desk-cal-ink': '#FFFFFF', '--desk-cal-size': '13px', '--desk-memo-ink': '#FFFFFF', '--desk-memo-size': '14px',
    '--desk-line': '1.35', '--desk-gap': '4px', '--desk-cell-bg': 'rgba(20, 24, 32, 0.4)', '--desk-rest-bg': 'rgba(58, 31, 36, 0.4)',
    '--desk-today': '#6AA6FF', '--desk-btn': '#FFFFFF', '--desk-holiday-ink': '#FF6B6B', '--desk-lunar-ink': '#9FB3C8', '--desk-day-pct': '50%',
  });
  const v = appearanceVars({ ...DEFAULT_APPEARANCE, transparency: 30, calendarBg: '', todayBorder: '' });
  expect([v['--desk-cell-bg'], v['--desk-rest-bg'], v['--desk-today'], v['--desk-day-pct']]).toEqual(['transparent', 'rgba(58, 31, 36, 0.7)', 'transparent', '70%']);
});
```
```ts
// src/web/ui/calendar.test.ts 끝에 추가 (import에 displayLines, DEFAULT_APPEARANCE, Appearance)
function mountA(a: Partial<Appearance>, today = '2026-11-13') {
  const root = document.createElement('div');
  const store = fakeStore({ '13': { text: '[+]끝낸 일\n회의\n[+]장보기\n운동', color: '' } });
  store.show(today.slice(0, 7)); // main.ts처럼 저장소는 오늘의 달에서 시작한다
  mountCalendar(root, { store, status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => today, onOpenDay: vi.fn(), onOpenSettings: vi.fn(), appearance: { ...DEFAULT_APPEARANCE, ...a } });
  return root;
}
const has = (el: Element, c: string) => el.classList.contains(c);
describe('화면 설정', () => {
  it('변동 월은 지난 주 한 줄과 앞으로 네 줄이고 흐린 칸이 없다. 단일 행과 시작 요일', () => {
    const root = mountA({});
    const cells = [...root.querySelectorAll<HTMLElement>('.cell')];
    expect([cells.length, cells[0].dataset.key, root.querySelector('.cell.other'), root.querySelector('[aria-label="다음"]') !== null]).toEqual([35, '2026-11-01', null, true]);
    expect(mountA({ layout: 'week' }).querySelectorAll('.cell')).toHaveLength(7);
    expect([...mountA({ layout: 'days' }).querySelectorAll('.dow span')].map((s) => s.textContent)).toEqual(['금', '토', '일', '월', '화', '수', '목']);
    const mon = mountA({ layout: 'month', weekStart: 1 });
    expect([mon.querySelectorAll('.cell').length, mon.querySelector('.dow span')!.textContent]).toEqual([42, '월']);
  });
  it('주 번호, 공휴일, 음력, 쉬는날', () => {
    expect([...mountA({ weekNumbers: true }).querySelectorAll('.wk')].map((w) => w.textContent)).toEqual(['45', '46', '47', '48', '49']);
    const root = mountA({ layout: 'month', lunar: true }, '2026-12-10');
    const xmas = cell(root, '2026-12-25');
    expect([has(xmas, 'holiday'), has(xmas, 'rest'), xmas.querySelector('.hname')!.textContent, xmas.querySelector('.lunar')!.textContent]).toEqual([true, true, '성탄절', '음 11.17']);
    expect([has(cell(root, '2026-12-06'), 'rest'), has(cell(root, '2026-12-07'), 'rest')]).toEqual([true, false]);
    const off = mountA({ layout: 'month', holidays: false, showRestDays: false }, '2026-12-10');
    expect([off.querySelector('.hname'), off.querySelector('.cell.rest')]).toEqual([null, null]);
  });
  it('완료한 줄 숨기기와 맨 아래로 보내기, 줄 머리, 그림자, 월 간격, 제목 줄', () => {
    expect(displayLines('[+]A\nB\n\n[+]C\nD', { showDone: true, doneToBottom: true })).toEqual([{ text: 'B', done: false }, { text: 'D', done: false }, { text: 'A', done: true }, { text: 'C', done: true }]);
    expect(displayLines('[+]A\nB', { showDone: false, doneToBottom: false })).toEqual([{ text: 'B', done: false }]);
    const root = mountA({ showDone: false, bullet: 'number' });
    expect([...cell(root, '2026-11-13').querySelectorAll('.ln')].map((l) => l.textContent)).toEqual(['회의', '운동']);
    const cal = root.querySelector<HTMLElement>('.calendar')!;
    expect([cal.dataset.bullet, has(cal, 'shadow'), has(cal, 'month-gap')]).toEqual(['number', true, true]);
    expect([[...cell(root, '2026-12-01').classList].filter((c) => c.startsWith('m-')), has(cell(root, '2026-11-01'), 'm-top')]).toEqual([['m-top', 'm-left'], false]);
    const off = mountA({ shadow: false, titleBar: false }).querySelector<HTMLElement>('.calendar')!;
    expect([has(off, 'shadow'), off.querySelector<HTMLElement>('.app-head')!.hidden]).toEqual([false, true]);
  });
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run --project dom src/web` → FAIL(`covers`, `appearanceVars`, `displayLines`가 없고 설정이 그리기에 반영되지 않는다).
- [ ] **Step 3: 구현** — Interfaces와 "정해 둔 값"대로 쓴다. `styles.css`에는 `.head`, `.wk`, 8열 격자만 더한다. 색과 투명도는 Task 5의 `desktop.css`가 변수로 쓴다.
- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` → PASS(Task 1까지의 달력 테스트 포함), 타입 오류 없음.
- [ ] **Step 5: 웹앱 회귀 확인** — `npm run dev:emu`를 띄우고 402x874와 1440x900, 밝은·어두운 화면으로 찍는다. Expected: ① 단계의 웹앱과 같은 모습(전체 월, 일요일 시작, 공휴일·음력 없음)이고 다음 달 버튼이 동작한다.
- [ ] **Step 6: Commit**
```bash
git add src/web/ui/calendar.ts src/web/ui/calendar.test.ts src/web/appearance.ts src/web/appearance.test.ts src/web/state.ts src/web/state.test.ts src/web/main.ts src/web/styles.css
git commit -m "feat: 달력이 배치, 주 번호, 공휴일, 음력, 줄 설정을 따른다"
```

---

### Task 5: PC용 화면 빌드(투명한 화면, 더블클릭 편집, 칸 메뉴)

**Files:**
- Create: `.env.desktop`, `.env.desktop-emu`, `src/desktop/api.ts`, `src/web/desktop.css`, `src/web/desktop/{bridge,fakeBridge,interactive,cellMenu,tone}.ts`, `src/web/desktop/{interactive,cellMenu,tone}.test.ts`
- Modify: `vite.config.ts`, `src/web/firebase.ts`, `src/web/main.ts`, `src/web/ui/calendar.ts`, `src/web/ui/calendar.test.ts`, `src/web/ui/editor.ts`, `src/web/ui/editor.test.ts`, `package.json`, `.gitignore`

**Interfaces:**
- Consumes: Task 4의 `mountCalendar`, `CalendarHandle.goToday`, `applyAppearance`, `loadAppearance`. `PALETTE`, `EMPTY_DAY`, `SyncEngine.saveEdit`.
- Produces:
```ts
// src/desktop/api.ts (화면은 타입만 쓰고, preload와 메인은 CH도 쓴다)
export const CH = { interactive: 'calfif:interactive', menu: 'calfif:menu', command: 'calfif:command', getSystem: 'calfif:get-system',
  setSystem: 'calfif:set-system', dragStart: 'calfif:drag-start', drag: 'calfif:drag', adjustDone: 'calfif:adjust-done' } as const;
export type Point = { x: number; y: number };
export type DragKind = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type Hotkey = { accelerator: string; enabled: boolean };
export type HotkeyState = 'ok' | 'off' | 'taken' | 'invalid';
export type SystemSettings = { hideHotkey: Hotkey; contentHotkey: Hotkey; startWithWindows: boolean | null };
export type SystemPatch = { hideHotkey?: Hotkey; contentHotkey?: Hotkey; startWithWindows?: boolean };
export type SystemState = { settings: SystemSettings; hotkeys: { hide: HotkeyState; content: HotkeyState }; canStartWithWindows: boolean };
export type SettingsPage = 'calendar' | 'cell' | 'font' | 'advanced' | 'account';
export type DesktopCommand = { type: 'today' } | { type: 'openSettings'; page?: SettingsPage } | { type: 'signOut' }
  | { type: 'contentHidden'; hidden: boolean } | { type: 'adjust'; active: boolean };
export interface CalfifDesktop {
  setInteractive(on: boolean): void;                    // send CH.interactive
  showMenu(at: Point): void;                            // send CH.menu (제목 줄 메뉴)
  onCommand(listener: (c: DesktopCommand) => void): () => void; // CH.command, 메인 → 화면
  getSystem(): Promise<SystemState>;                    // invoke CH.getSystem
  setSystem(patch: SystemPatch): Promise<SystemState>;  // invoke CH.setSystem
  dragStart(): void;                                    // send CH.dragStart
  drag(kind: DragKind, dx: number, dy: number): void;   // send CH.drag
  adjustDone(apply: boolean): void;                     // send CH.adjustDone
}
declare global { interface Window { calfifDesktop?: CalfifDesktop } }
// src/web/desktop/bridge.ts
export function getBridge(win?: Window): CalfifDesktop | null;
// src/web/desktop/fakeBridge.ts (테스트용, calls에 [함수 이름, ...인자])
export class FakeBridge implements CalfifDesktop { calls: unknown[][]; taken: Set<string>; system: SystemState; emit(c: DesktopCommand): void; /* + CalfifDesktop */ }
// src/web/desktop/interactive.ts
export type InteractiveReason = 'editor' | 'settings' | 'login';
export class Interactivity { constructor(send: (on: boolean) => void); begin(r: InteractiveReason): void; end(r: InteractiveReason): void; active(): boolean }
// src/web/desktop/cellMenu.ts
export function menuPosition(at: Point, size: { width: number; height: number }, view: { width: number; height: number }): Point;
export function mountCellMenu(root: HTMLElement, props: { dateKey: string; at: Point; onEdit(): void; onColor(color: string): void; onToday(): void; onClose(): void }): { destroy(): void };
// src/web/desktop/tone.ts
export type ToneContext = Pick<AudioContext, 'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'close'>;
export function playDoneTone(make?: () => ToneContext): void; // 기본 new AudioContext(). 없거나 실패하면 조용히 넘어간다
// CalendarDeps에 더한다:   desktop?: { onDayMenu(dateKey: string, at: Point): void; onOpenMenu(at: Point): void }
// mountEditor의 env에 더한다: focusText?: boolean   (참이면 창 폭과 상관없이 메모 칸에 커서)
```

정해 둔 값:
- 빌드: `vite.config.ts`를 `defineConfig(({ mode }) => …)`로 바꾼다. `mode`가 `desktop`이나 `desktop-emu`면 VitePWA를 빼고(서비스 워커 없음), `build.outDir`을 `dist-desktop` / `dist-desktop-emu`로, `transformIndexHtml`로 `<html lang="ko">`를 `<html lang="ko" class="desk">`로 바꾼다(첫 화면부터 투명). 웹 모드는 그대로다. `.env.desktop`은 `VITE_DESKTOP=1`, `.env.desktop-emu`는 `.env.emulator`의 다섯 줄과 `VITE_DESKTOP=1`. `.gitignore`에 `dist-desktop/`, `dist-desktop-emu/`, `release/`. 스크립트 `"dev:desktop-emu": "tsx scripts/build-rules.ts --uid owner-test-uid && tsx scripts/emu.ts \"tsx scripts/seed-emulator.ts && vite --mode desktop-emu\""`.
- `initFirebase`: `VITE_DESKTOP === '1'`이면 `getAuth` 대신 `initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })`.
- `desktop.css`(`main.ts`가 가져오고 규칙은 모두 `:root.desk` 아래): 문서, `#app`, `.app`, `.grid`, `.login` 바탕은 투명. 칸은 `--desk-cell-bg`, 모서리 4px, 격자 `gap: var(--desk-gap)`. `.rest`는 `--desk-rest-bg`, `.rest .num`과 `.hname`은 `--desk-holiday-ink`. 날짜 배경색은 `color-mix(in srgb, var(--day-color) var(--desk-day-pct), transparent)`. 오늘은 `box-shadow: inset 0 0 0 2px var(--desk-today)`. 날짜·요일은 `--desk-cal-ink`/`--desk-cal-size`, 메모 줄은 `--desk-memo-ink`/`--desk-memo-size`, 줄 높이 `calc(var(--desk-memo-size) * var(--desk-line))`. `.lunar`는 `--desk-lunar-ink`로 날짜보다 2px 작게. 머리는 한 줄(`2026년 11월`, 이전·오늘·다음·메뉴 단추)이고 단추는 `--desk-btn`, 동기화 상태는 그 줄 오른쪽 끝에 작게(설계 7절). `.calendar.shadow`의 글자는 `text-shadow: 0 1px 2px rgba(0,0,0,.85)`. `data-bullet="number"`는 CSS 카운터로 `1. `, `"dot"`은 `• `(`.ln.more` 제외). `.month-gap .m-top { margin-top: 6px }`, `.m-left { margin-left: 6px }`. `:root.content-hidden .memo { visibility: hidden }`. 편집·설정 시트는 창 폭과 상관없이 가운데 상자(넓은 화면 규칙)이고, 창이 520px보다 좁으면 폭 `calc(100vw - 24px)`.
- 달력(`deps.desktop`가 있을 때): 한 번 클릭은 아무것도 하지 않고 `dblclick`이 `onOpenDay`. 칸의 `contextmenu`는 기본 메뉴를 막고 `onDayMenu(dateKey, { x: clientX, y: clientY })`. 설정 단추 대신 `aria-label="메뉴"` 단추가 `onOpenMenu({ x: clientX, y: clientY })`.
- 칸 메뉴: `.cellmenu[role="menu"]`에 `편집`, `배경색`, `오늘로`(`role="menuitem"`, `data-action`은 `edit`, `color`, `today`). `배경색`을 누르면 메뉴 안에 `.swatch` 23개(`없음` + `PALETTE`, `data-color`)가 펼쳐지고, 고르면 `onColor` 뒤 `onClose`. Esc와 바깥 `pointerdown`도 `onClose`. 자리는 `menuPosition`: 오른쪽·아래가 넘치면 창 끝에서 4px 안쪽으로 당기고, 4px보다 작게 하지 않는다.
- `main.ts`(데스크톱일 때): `getBridge()`와 `new Interactivity((on) => bridge?.setInteractive(on))`. 로그인 화면이 보이는 동안 `login`, 편집 화면은 `editor`, 설정 시트는 `settings`를 `begin`/`end`한다. 창이 포커스를 잃어도 아무것도 닫지 않는다. 편집 화면은 `focusText: true`. 칸 메뉴의 `편집`은 날짜 주소로 간다. `배경색`은 `engine.saveEdit(monthId, day, base, { text: base.text, color })`(`base = store.days(monthId)[day] ?? EMPTY_DAY`) 뒤 `store.refresh()`. `오늘로`는 `goToday()`. 저장할 때 `doneTone`이 `short`면 `playDoneTone()`. 모양은 `loadAppearance(openStorage().store)`로 읽어 `applyAppearance(document.documentElement, a)`. 명령: `today` → `goToday()`, `openSettings` → `location.hash = 'settings'`, `signOut` → 대기 0건이면 로그아웃, 아니면 설정을 연다, `contentHidden` → `<html>`의 `content-hidden` 클래스, `adjust` → Task 7까지 무시. 로그인 전에는 `today`, `openSettings`, `signOut`을 무시한다.
- 소리(`짧은 소리`): 사인파 880Hz, 이득 0.15, `currentTime`에 시작해 0.12초 뒤 멈추고, 끝나면 컨텍스트를 닫는다.
- `FakeBridge.setSystem`은 패치를 합치고 켠 단축키는 `taken`에 있으면 `taken`, 아니면 `ok`, 끈 것은 `off`로 돌려준다. 처음 `system`은 Task 7의 기본값(`Ctrl+Alt+H`, `Ctrl+Alt+F`, 둘 다 꺼짐, `startWithWindows: null`)과 `canStartWithWindows: false`.

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// src/web/ui/calendar.test.ts 끝에 추가
it('PC 앱에서는 두 번 눌러야 열고, 오른쪽 클릭은 칸 메뉴, 메뉴 단추는 앱 메뉴', () => {
  const root = document.createElement('div');
  const onOpenDay = vi.fn(), onDayMenu = vi.fn(), onOpenMenu = vi.fn();
  mountCalendar(root, { store: fakeStore({}), status: { status: () => ({ state: 'synced', pending: 0 }), subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn(), appearance: DEFAULT_APPEARANCE, desktop: { onDayMenu, onOpenMenu } });
  const day = cell(root, '2026-11-20');
  day.click();
  expect(onOpenDay).not.toHaveBeenCalled();
  day.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(onOpenDay).toHaveBeenCalledWith('2026-11-20');
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
  day.dispatchEvent(ev);
  expect([ev.defaultPrevented, onDayMenu.mock.calls[0], root.querySelector('[aria-label="설정"]')]).toEqual([true, ['2026-11-20', { x: 40, y: 50 }], null]);
  root.querySelector('[aria-label="메뉴"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 600, clientY: 20 }));
  expect(onOpenMenu).toHaveBeenCalledWith({ x: 600, y: 20 });
});
```
```ts
// src/web/ui/editor.test.ts 끝에 추가
it('PC 앱에서는 창이 좁아도 메모 칸에 바로 입력한다', () => {
  vi.stubGlobal('innerWidth', 600);
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountEditor(root, { dateKey: '2026-11-13', value: { text: '가', color: '' }, onSave: vi.fn(), onCancel: vi.fn() }, { visualViewport: null, focusText: true });
  expect(document.activeElement).toBe(root.querySelector('textarea'));
  handle.destroy();
  vi.unstubAllGlobals();
});
```
```ts
// src/web/desktop/interactive.test.ts
it('편집, 설정, 로그인 중 하나라도 열린 동안만 창이 입력을 받는다', () => {
  const sent: boolean[] = [];
  const i = new Interactivity((on) => sent.push(on));
  i.begin('editor'); i.begin('settings'); i.end('editor');
  expect([sent, i.active()]).toEqual([[true], true]);
  i.end('settings'); i.end('settings');
  expect([sent, i.active()]).toEqual([[true, false], false]);
});
```
```ts
// src/web/desktop/cellMenu.test.ts
import { PALETTE } from '../../core/color';

function open() {
  const root = document.createElement('div');
  document.body.append(root);
  const props = { dateKey: '2026-11-20', at: { x: 10, y: 10 }, onEdit: vi.fn(), onColor: vi.fn(), onToday: vi.fn(), onClose: vi.fn() };
  mountCellMenu(root, props);
  return { root, props };
}
it('창 밖으로 나가지 않게 자리를 잡는다', () => {
  const view = { width: 800, height: 600 };
  expect([menuPosition({ x: 100, y: 100 }, { width: 180, height: 120 }, view), menuPosition({ x: 750, y: 560 }, { width: 180, height: 120 }, view), menuPosition({ x: 10, y: 10 }, { width: 900, height: 120 }, view)])
    .toEqual([{ x: 100, y: 100 }, { x: 616, y: 476 }, { x: 4, y: 10 }]);
});
it('편집, 배경색, 오늘로. 배경색은 없음과 22색이고, Esc와 바깥 누르기로 닫힌다', () => {
  const { root, props } = open();
  const items = [...root.querySelectorAll<HTMLElement>('.cellmenu [role="menuitem"]')];
  expect(items.map((b) => b.textContent)).toEqual(['편집', '배경색', '오늘로']);
  items[1].click();
  const swatches = [...root.querySelectorAll<HTMLElement>('.cellmenu .swatch')];
  expect(swatches.map((s) => s.dataset.color)).toEqual(['', ...PALETTE]);
  swatches[9].click();
  expect([props.onColor.mock.calls, props.onClose.mock.calls.length]).toEqual([[['F12424']], 1]);
  const esc = open();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const outside = open();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect([esc.props.onClose.mock.calls.length > 0, outside.props.onClose.mock.calls.length > 0]).toEqual([true, true]);
});
```
```ts
// src/web/desktop/tone.test.ts
it('짧은 소리는 880Hz 사인파를 0.12초 낸다', () => {
  const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) };
  const gain = { gain: { value: 1 }, connect: vi.fn() };
  const ctx = { currentTime: 5, destination: {}, createOscillator: () => osc, createGain: () => gain, close: vi.fn() };
  playDoneTone(() => ctx as unknown as ToneContext);
  expect([osc.type, osc.frequency.value, gain.gain.value, osc.start.mock.calls[0], osc.stop.mock.calls[0]]).toEqual(['sine', 880, 0.15, [5], [5.12]]);
  osc.onended!();
  expect(ctx.close).toHaveBeenCalled();
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run --project dom src/web` → FAIL(`./interactive`, `./cellMenu`, `./tone`이 없고 달력과 편집 화면에 PC 동작이 없다).
- [ ] **Step 3: 구현** — Interfaces와 "정해 둔 값"대로 쓴다.
- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` → PASS, 타입 오류 없음.
- [ ] **Step 5: 빌드 확인** — `npx vite build --mode desktop-emu && node -e "const fs=require('fs');const h=fs.readFileSync('dist-desktop-emu/index.html','utf8');if(!h.includes('class=\"desk\"')||/registerSW|manifest/.test(h)||fs.existsSync('dist-desktop-emu/sw.js'))process.exit(1);console.log('ok')"`, 그리고 `npx vite build --mode emulator --outDir build/web-check && node -e "require('fs').existsSync('build/web-check/sw.js')||process.exit(1)"` → 첫 명령이 `ok`, 웹 빌드에는 `sw.js`가 그대로 있다.
- [ ] **Step 6: 화면 확인** — `npm run dev:desktop-emu`를 띄우고 찍는다. (a) 1260x992, 바탕 `#3B6E8F`. (b) 같은 크기, 바탕 `#E9E4DA`. (c) 620x560, 바탕 `#3B6E8F`, `--eval`로 `.cell.today`에 `dblclick`. (d) 1260x992, `.cell.today`에 `contextmenu`(clientX 1200, clientY 900) 뒤 `[data-action="color"]` 클릭. Expected: 칸 뒤로 바탕색이 비친다(60%). 두 바탕 모두 날짜와 메모가 읽힌다. 오늘 칸에 파란 테두리. 흰 바탕이 번쩍이지 않는다. (c)의 편집 화면은 창 안 가운데에 불투명하게 뜨고 메모 칸에 커서가 있다. (d)의 메뉴는 창 안에 있고 색 23개가 보인다.
- [ ] **Step 7: Commit**
```bash
git add .env.desktop .env.desktop-emu .gitignore package.json vite.config.ts src/desktop/api.ts src/web/desktop.css src/web/desktop src/web/firebase.ts src/web/main.ts src/web/ui/calendar.ts src/web/ui/calendar.test.ts src/web/ui/editor.ts src/web/ui/editor.test.ts
git commit -m "feat: PC용 화면 빌드, 더블클릭 편집, 칸 메뉴"
```

---

### Task 6: Electron 메인 프로세스와 바탕화면에 붙이기

**Files:**
- Create: `vite.desktop.config.ts`, `scripts/desktop-run.ts`, `src/desktop/{runtime,protocol,policy,ipc}.ts`와 각 `.test.ts`, `src/desktop/{win32,window,preload,smoke,main}.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: Task 5의 `CH`, `CalfifDesktop`, `Point`.
- Produces:
```ts
// src/desktop/runtime.ts
export type Scenario = 'attach' | 'bounds' | 'tray' | 'settings' | 'e2e';
export type Runtime = { rendererDir: string; profileDir: string; statusDir: string | null; smoke: Scenario | null; emulator: boolean; manageLoginItem: boolean };
export function resolveRuntime(p: { env: Record<string, string | undefined>; isPackaged: boolean; appPath: string; appData: string }): Runtime;
// src/desktop/protocol.ts
export const CSP: string;
export function isAppUrl(url: string | undefined): boolean;
export function resolveAppPath(url: string, root: string): string | null;
export function contentType(file: string): string;
export function registerAppProtocol(root: string): void; // 얇다: protocol.handle('app', …)에 CSP 머리를 붙인다
// src/desktop/policy.ts
export type BelowEntry = { hwnd: bigint; desktopOwned: boolean };
export function isAtBottom(below: BelowEntry[], progman: bigint): boolean;
export function shouldKeepBottom(s: { interactive: boolean; alwaysOnTop: boolean; adjusting: boolean; hidden: boolean }): boolean;
export class Reattacher { closed(byApp: boolean): void; ownerLost(): void; tick(progmanAlive: boolean): 'idle' | 'wait' | 'create' }
// src/desktop/ipc.ts
export function parseBool(v: unknown): boolean | null;
export function parsePoint(v: unknown): Point | null; // 유한수, |값| ≤ 100000, 다른 칸은 버린다
// src/desktop/win32.ts (얇다, koffi)
export type Hwnd = bigint;
export function findProgman(): Hwnd; // 없으면 0n
export function isWindow(h: Hwnd): boolean;
export function setOwner(h: Hwnd, owner: Hwnd): void;
export function getOwner(h: Hwnd): Hwnd;
export function getExStyle(h: Hwnd): number;
export function makeToolWindow(h: Hwnd): void; // WS_EX_TOOLWINDOW를 켜고 WS_EX_APPWINDOW를 끈다(Alt+Tab에서 빠진다)
export function sendToBottom(h: Hwnd): boolean;
export function windowsBelow(h: Hwnd, progman: Hwnd, limit?: number): BelowEntry[]; // GW_HWNDNEXT로 Progman까지(포함)
// src/desktop/window.ts (얇다)
export function keepBottom(): void; // "맨 아래 지키기". 뒤의 Task들이 부른다
```

정해 둔 값:
- `resolveRuntime`: 렌더러 폴더는 꾸린 앱이면 늘 `join(appPath, 'dist-desktop')`, 개발이면 `CALFIF_RENDERER_DIR`이 있으면 그것. 프로필은 `CALFIF_PROFILE_DIR`, 없으면 `join(appData, 'CalendarFIF')`. `CALFIF_SMOKE`는 시나리오 이름(`1`은 `attach`), 모르는 값이면 `CALFIF_SMOKE`가 들어간 오류. 시험 실행인데 `CALFIF_PROFILE_DIR`이 없으면 `CALFIF_PROFILE_DIR`이 들어간 오류. `statusDir`은 시험 실행일 때 `dirname(profileDir)`. `emulator`는 `CALFIF_EMU === '1'`. `manageLoginItem`은 `isPackaged && !smoke`.
- `CSP` = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: wss: http://127.0.0.1:8085 http://127.0.0.1:9095 ws://127.0.0.1:8085; frame-src 'none'; object-src 'none'; base-uri 'none'`.
- `resolveAppPath`: `app:`이고 호스트가 `calfif`일 때만. 경로를 디코드해 NUL이 있으면 거부, `/`는 `index.html`, 질의와 해시는 버린다. `resolve(root, '.' + 경로)`가 `root` 밖이면 `null`. `contentType`: `.html`, `.js`, `.css`, `.json`, `.webmanifest`는 `text/html`, `text/javascript`, `text/css`, `application/json`, `application/manifest+json`에 `; charset=utf-8`. `.png` `image/png`, `.svg` `image/svg+xml`, `.ico` `image/x-icon`, `.woff2` `font/woff2`, 그 밖은 `application/octet-stream`.
- `isAtBottom`: `progman`이 0이 아니면 아래 목록이 `progman`에 닿아야 하고 그 앞의 창이 모두 `desktopOwned`여야 참. 0이면 아래 목록이 비어야 참. `desktopOwned`는 소유자가 Progman이거나 Progman의 자식(`IsChild`)인 창이다(DesktopCal의 달력 창이 그렇다).
- `Reattacher`: `closed(true)`(앱이 닫았다) 뒤에는 `idle`. `closed(false)`나 `ownerLost()` 뒤에는 Progman이 없으면 `wait`, 생기면 한 번 `create`, 그 뒤 `idle`.
- koffi(실험에서 동작한 선언, `koffi.load('user32.dll')`, 처음 부를 때 읽는다): `intptr_t __stdcall FindWindowW(str16 cls, str16 title)`, `intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int index, intptr_t value)`, `intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int index)`, `intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t cmd)`, `int __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)`, 같은 꼴의 `int __stdcall IsWindow(intptr_t hWnd)`, `int __stdcall IsChild(intptr_t parent, intptr_t hWnd)`. 상수 `GWLP_HWNDPARENT -8`, `GWL_EXSTYLE -20`, `GW_HWNDNEXT 2`, `GW_OWNER 4`, `HWND_BOTTOM 1`, `SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE = 0x13`, `SWP_FRAMECHANGED 0x20`, `WS_EX_TOOLWINDOW 0x80`, `WS_EX_APPWINDOW 0x40000`. 창 핸들은 `win.getNativeWindowHandle().readBigInt64LE(0)`, 돌려받은 핸들은 `BigInt(…)`로 맞춘다.
- `main.ts` 순서: `resolveRuntime` → `app.setPath('userData', profileDir)` → `app.enableSandbox()` → `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])` → 시험 실행이면 `app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')` → `app.requestSingleInstanceLock()`이 거짓이면 끝낸다(잠금은 프로필 폴더마다 따로다) → `second-instance`에서 창을 보인다 → 준비되면 `registerAppProtocol`, 모든 `webContents`의 보안 규칙(Global Constraints), 권한 거절, IPC, 창, 시험 실행. `window-all-closed`로는 끝내지 않는다.
- 창(`window.ts`): `frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, show: false, focusable: false`, `webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false, devTools: !app.isPackaged }`. 자리는 Task 7 전까지 주 모니터 작업 영역 오른쪽의 900x700. 주소는 `app://calfif/index.html`, `emulator`면 `?autologin=1`.
- 붙이기(`ready-to-show`): Progman을 찾으면 `setOwner` → `makeToolWindow` → `showInactive()` → `sendToBottom`(모드 `owned`). 못 찾으면 `showInactive()`와 `sendToBottom`만 하고(모드 `bottom`, 설계 4절 C) 5초마다 Progman을 찾아 생기면 소유자를 바꾼다.
- 맨 아래 지키기(`keepBottom()`): `focus` 이벤트와 `hookWindowMessage(0x47 /* WM_WINDOWPOSCHANGED */)`에서 `shouldKeepBottom(상태)`이고 `!isAtBottom(windowsBelow(…))`일 때만 `setImmediate`로 `sendToBottom`. `CH.interactive`가 참이면 `setFocusable(true)`와 `focus()`, 거짓이면 `setFocusable(false)`와 맨 아래 지키기.
- 탐색기 재시작: 창의 `closed`(앱이 끝내는 중이 아니면 `closed(false)`)와, 5초마다 `isWindow(progman)`이 거짓이면 `ownerLost()`. 기다리는 동안 1초마다 `tick(findProgman() !== 0n)`, `create`면 창을 다시 만들어 붙인다.
- preload: `contextBridge.exposeInMainWorld('calfifDesktop', …)`. 여덟 함수는 각자 `CH`의 채널로 `send`나 `invoke`만 한다. `onCommand`는 `(_e, c) => listener(c)`로 감싸고 해제 함수를 돌려준다.
- `vite.desktop.config.ts`: `build.ssr`로 `src/desktop/main.ts`, `preload.ts`를 `build/desktop/main.cjs`, `preload.cjs`로 묶는다(형식 `cjs`, `electron`과 `koffi`는 외부, target `node22`).
- `scripts/desktop-run.ts [--emu] [--smoke] [--packaged <exe>]`: `--smoke`는 `--emu`를 포함하고 시나리오는 `CALFIF_SMOKE`(없으면 `attach`). `--packaged`가 없으면 `npx vite build --mode desktop-emu`(`--emu`가 없으면 `desktop`)와 `npx vite build -c vite.desktop.config.ts`를 하고 `createRequire(import.meta.url)('electron')`(실행 파일 경로)로 `.`을 띄운다. 환경: `CALFIF_RENDERER_DIR`, `CALFIF_EMU=1`(에뮬레이터), `CALFIF_PROFILE_DIR`(`build/desktop-emu/profile` 또는 `build/desktop-smoke/profile`), `CALFIF_SMOKE`. 경로는 모두 절대 경로다. `ELECTRON_RUN_AS_NODE`는 지우고, `--smoke`가 아니면 `CALFIF_SMOKE`도 지운다. 시험 실행은 프로필과 그 시나리오의 JSON을 먼저 지우고, 90초가 지나면 프로세스 트리를 끝내고, JSON을 출력하고, `failures`가 비었을 때만 0으로 끝난다.
- `package.json`: `"main": "build/desktop/main.cjs"`, `"desktop:setup": "node node_modules/electron/install.js"`, `"desktop": "tsx scripts/desktop-run.ts"`, `"desktop:emu": "tsx scripts/build-rules.ts --uid owner-test-uid && tsx scripts/emu.ts \"tsx scripts/seed-emulator.ts && tsx scripts/desktop-run.ts --emu\""`, `"desktop:smoke"`는 `desktop:emu`에서 끝의 `--emu`만 `--smoke`로.
- 시험 실행 공통(`smoke.ts`): 시나리오 함수가 `{ 필드, checks: Record<string, boolean> }`를 돌려주면 `{ scenario, ok, failures: 거짓인 check 이름, ...필드 }`를 `statusDir/<scenario>.json`에 쓰고 `app.quit()`. 45초 안에 끝나지 않으면 `failures: ['timeout']`. 화면은 `webContents.executeJavaScript`로 DOM을 읽어 기다린다. 그림은 `capturePage()`가 비지 않았을 때만 `build/shots/desktop-<scenario>.png`에 쓰고, 비면 `shot: null`(실패 아님).

- [ ] **Step 1: 설치** — `package.json`에 위 `main`과 스크립트를 넣고 `npm install koffi@^3.3.8`, `npm install -D electron@^45.3.1`, `npm run desktop:setup`. Expected: `node -e "console.log(require('electron'))"`가 찍는 `electron.exe` 경로에 파일이 있다.
- [ ] **Step 2: 실패하는 테스트 쓰기**
```ts
// src/desktop/runtime.test.ts
import { join } from 'node:path';

const base = { appPath: 'C:\\app', appData: 'C:\\Users\\u\\AppData\\Roaming' };
it('꾸린 앱은 앱 안의 화면과 %APPDATA%\\CalendarFIF를 쓰고 자동 실행을 관리한다', () => {
  expect(resolveRuntime({ ...base, env: { CALFIF_RENDERER_DIR: 'C:\\evil' }, isPackaged: true })).toEqual({
    rendererDir: join('C:\\app', 'dist-desktop'), profileDir: join(base.appData, 'CalendarFIF'), statusDir: null, smoke: null, emulator: false, manageLoginItem: true,
  });
});
it('개발 실행은 정해 준 폴더를 쓰고, 시험 실행은 따로 둔 프로필이 있어야 하며 꾸린 앱에서도 자동 실행을 건드리지 않는다', () => {
  expect(resolveRuntime({ ...base, isPackaged: false, env: { CALFIF_RENDERER_DIR: 'C:\\r', CALFIF_PROFILE_DIR: 'C:\\p\\profile', CALFIF_EMU: '1' } }))
    .toMatchObject({ rendererDir: 'C:\\r', profileDir: 'C:\\p\\profile', emulator: true, manageLoginItem: false, smoke: null });
  expect(() => resolveRuntime({ ...base, isPackaged: false, env: { CALFIF_SMOKE: 'attach' } })).toThrow('CALFIF_PROFILE_DIR');
  expect(() => resolveRuntime({ ...base, isPackaged: false, env: { CALFIF_SMOKE: 'dance', CALFIF_PROFILE_DIR: 'C:\\s\\profile' } })).toThrow('CALFIF_SMOKE');
  expect(resolveRuntime({ ...base, isPackaged: true, env: { CALFIF_SMOKE: '1', CALFIF_PROFILE_DIR: 'C:\\s\\profile' } })).toMatchObject({ smoke: 'attach', manageLoginItem: false, statusDir: 'C:\\s' });
});
```
```ts
// src/desktop/protocol.test.ts
import { join } from 'node:path';

it('app://calfif/ 아래, 렌더러 폴더 안의 파일만 내준다', () => {
  const r = 'C:\\r';
  expect([resolveAppPath('app://calfif/', r), resolveAppPath('app://calfif/index.html?autologin=1#2026-11-13', r), resolveAppPath('app://calfif/assets/index-abc.js', r)])
    .toEqual([join(r, 'index.html'), join(r, 'index.html'), join(r, 'assets', 'index-abc.js')]);
  for (const bad of ['app://calfif/..%5C..%5Csecret.txt', 'app://calfif/a%00.js', 'app://other/index.html', 'https://calfif/index.html']) expect(resolveAppPath(bad, r)).toBeNull();
});
it('앱 주소만 앱 주소로 보고, 형식과 보안 정책을 붙인다', () => {
  expect([isAppUrl('app://calfif/index.html#2026-11-13'), isAppUrl('https://example.invalid/'), isAppUrl('app://calfif.evil/'), isAppUrl('not a url'), isAppUrl(undefined)]).toEqual([true, false, false, false, false]);
  expect([contentType('x.js'), contentType('x.css'), contentType('x.png'), contentType('x.bin')]).toEqual(['text/javascript; charset=utf-8', 'text/css; charset=utf-8', 'image/png', 'application/octet-stream']);
  expect([CSP.includes("script-src 'self'"), CSP.includes("frame-src 'none'")]).toEqual([true, true]);
});
```
```ts
// src/desktop/policy.test.ts
const P = 100n, own = (hwnd: bigint) => ({ hwnd, desktopOwned: true }), other = (hwnd: bigint) => ({ hwnd, desktopOwned: false });
it('바탕화면에 붙은 창(DesktopCal 같은)들 말고는 아래에 아무것도 없어야 맨 아래다', () => {
  expect([isAtBottom([other(P)], P), isAtBottom([own(7n), other(P)], P), isAtBottom([other(8n), other(P)], P), isAtBottom([other(8n)], P), isAtBottom([], 0n), isAtBottom([other(8n)], 0n)])
    .toEqual([true, true, false, false, true, false]);
});
it('입력 중, 맨 위에 보기, 위치 조정, 숨김 중에는 맨 아래로 보내지 않는다', () => {
  const idle = { interactive: false, alwaysOnTop: false, adjusting: false, hidden: false };
  expect([idle, ...(['interactive', 'alwaysOnTop', 'adjusting', 'hidden'] as const).map((k) => ({ ...idle, [k]: true }))].map(shouldKeepBottom)).toEqual([true, false, false, false, false]);
});
it('예기치 않게 없어진 창만, Progman이 다시 생기면 한 번 다시 만든다', () => {
  const r = new Reattacher();
  r.closed(true);
  expect(r.tick(true)).toBe('idle');
  r.closed(false);
  expect([r.tick(false), r.tick(false), r.tick(true), r.tick(true)]).toEqual(['wait', 'wait', 'create', 'idle']);
  r.ownerLost();
  expect([r.tick(true), r.tick(true)]).toEqual(['create', 'idle']);
});
```
```ts
// src/desktop/ipc.test.ts
it('화면에서 온 값을 검사한다', () => {
  expect([parseBool(true), parseBool(false), parseBool('true')]).toEqual([true, false, null]);
  expect(parsePoint({ x: 10, y: 20.5, extra: 3 })).toEqual({ x: 10, y: 20.5 });
  expect([parsePoint({ x: Infinity, y: 0 }), parsePoint({ x: 1e6, y: 0 }), parsePoint([1, 2]), parsePoint(null)]).toEqual([null, null, null, null]);
});
```
- [ ] **Step 3: 실패 확인** — `npx vitest run --project unit src/desktop` → FAIL(모듈이 없다).
- [ ] **Step 4: 순수 모듈 구현, 통과 확인** — `npx vitest run --project unit src/desktop` → PASS.
- [ ] **Step 5: 얇은 모듈과 attach 시험 실행 구현** — "정해 둔 값"대로 쓴다. `attach`는 차례로: 화면을 15초까지 기다린다 → 아래 필드를 잰다 → `location.href = 'https://example.invalid/'`와 `window.open('https://example.invalid/')`을 시도한다 → `CH.interactive` 처리기를 `true`, `false`로 부른다 → `win.destroy()`로 창을 없애고 5초 안에 다시 붙은 창을 같은 방법으로 잰다 → `process.execPath`와 `process.argv.slice(1)`, 같은 환경으로 두 번째 실행을 띄워 종료 코드와 `second-instance` 알림을 본다.
- [ ] **Step 6: 확인** — `npm test && npx tsc --noEmit && npm run desktop:smoke` → 테스트 PASS, 타입 오류 없음, `build/desktop-smoke/attach.json`이 아래와 같다(`progman`, `owner`는 16진수 문자열로 함께 적고 비교하지 않는다).
```jsonc
{ "scenario": "attach", "ok": true, "failures": [], "mode": "owned", "ownerIsProgman": true, "atBottom": true,
  "toolWindow": true, "appWindow": false, "focusable": false, "visible": true, "rendered": "calendar",
  "bridgeKeys": ["adjustDone", "drag", "dragStart", "getSystem", "onCommand", "setInteractive", "setSystem", "showMenu"],
  "rendererGlobals": "undefined,undefined", "navigationBlocked": true, "popupBlocked": true,   // typeof require, typeof process
  "interactive": [true, false], "atBottomAfterInteractive": true, "recreated": true, "ownerIsProgmanAfterRecreate": true,
  "secondInstance": { "exitCode": 0, "notified": true }, "shot": "build/shots/desktop-attach.png" }  // 그림이 비면 null
```
- [ ] **Step 7: Commit**
```bash
git add package.json package-lock.json vite.desktop.config.ts scripts/desktop-run.ts src/desktop
git commit -m "feat: Electron 창을 바탕화면에 붙이고 탐색기 재시작 뒤 다시 붙인다"
```

---

### Task 7: 창의 자리와 크기, 모니터 구성마다 기억하기

**Files:**
- Create: `src/desktop/bounds.ts`, `src/desktop/bounds.test.ts`, `src/desktop/settings.ts`, `src/desktop/settings.test.ts`, `src/web/desktop/adjust.ts`, `src/web/desktop/adjust.test.ts`
- Modify: `src/desktop/ipc.ts`, `src/desktop/ipc.test.ts`, `src/desktop/window.ts`, `src/desktop/main.ts`, `src/desktop/smoke.ts`, `src/web/main.ts`, `src/web/desktop.css`

**Interfaces:**
- Consumes: Task 5의 `DragKind`, `Hotkey`, `CalfifDesktop`, `FakeBridge`. Task 6의 `Runtime.profileDir`, 맨 아래 지키기.
- Produces:
```ts
// src/desktop/bounds.ts
export type Rect = { x: number; y: number; width: number; height: number };
export type DisplayInfo = { bounds: Rect; workArea: Rect; primary: boolean };
export const MIN_SIZE = { width: 360, height: 240 };
export const KEEP_VISIBLE = 80;
export function layoutKey(displays: DisplayInfo[]): string;
export function defaultBounds(displays: DisplayInfo[]): Rect;
export function clampBounds(r: Rect, workAreas: Rect[]): Rect;
export function resolveBounds(saved: Record<string, Rect>, displays: DisplayInfo[]): Rect;
export function applyDrag(base: Rect, kind: DragKind, dx: number, dy: number, workAreas: Rect[]): Rect;
// src/desktop/settings.ts
export type DesktopSettings = { version: 1; bounds: Record<string, Rect>; contentHidden: boolean; alwaysOnTop: boolean; hideHotkey: Hotkey; contentHotkey: Hotkey; startWithWindows: boolean | null };
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings;
export function parseDesktopSettings(raw: unknown): DesktopSettings;
export function loadDesktopSettings(file: string): { settings: DesktopSettings; status: 'ok' | 'missing' | 'corrupt' | 'migrated' };
export function saveDesktopSettings(file: string, s: DesktopSettings): void;
// src/desktop/ipc.ts
export function parseDrag(kind: unknown, dx: unknown, dy: unknown): { kind: DragKind; dx: number; dy: number } | null; // |값| ≤ 100000
// src/web/desktop/adjust.ts
export function mountAdjust(root: HTMLElement, bridge: CalfifDesktop): { destroy(): void };
// src/desktop/window.ts (얇다)
export function startAdjust(): void; // 메뉴의 "위치 및 크기"(Task 8)와 시험 실행이 부른다
```

정해 둔 값:
- `layoutKey`: 모니터마다 `bounds`를 `x,y,WxH`로 적어 x, y 순으로 정렬해 `|`로 잇는다(설계 6절의 모니터 구성 문자열).
- `defaultBounds`(설계 6절): 주 모니터가 아닌 모니터가 있으면 정렬 순서의 첫째, 없으면 주 모니터. 그 작업 영역 `wa`에서 `w = round(wa.width × 0.65)`, `h = round(wa.height × 0.96)`, `m = floor((wa.height − h) / 2)`, `x = wa.x + wa.width − w − m`, `y = wa.y + m`.
- `clampBounds`: 크기를 `MIN_SIZE`와 대상 작업 영역 크기 사이로 자른다. 대상은 겹치는 넓이가 가장 큰 작업 영역, 겹치는 곳이 없으면 중심이 가장 가까운 작업 영역. `x`는 `[wa.x − width + 80, wa.x + wa.width − 80]`, `y`는 `[wa.y, wa.y + wa.height − 80]`(위쪽 적용·취소 줄이 화면 위로 나가지 않게).
- `resolveBounds`: 지금 구성의 키로 저장된 자리가 있으면 그것을 `clampBounds`, 없으면 `defaultBounds`. `applyDrag`: `move`는 옮기기, 가장자리·모서리는 반대쪽 변을 고정하고 크기를 바꾸되 `MIN_SIZE`를 지키고(그 축이 아닌 `dx`, `dy`는 버린다) 마지막에 `clampBounds`.
- `parseDesktopSettings`: 객체가 아니면 기본값. 아는 칸만 읽고 틀린 칸은 기본값. `bounds` 항목은 네 값이 유한한 정수, |x|와 |y| ≤ 100000, 폭과 높이 1 이상일 때만 남긴다. 단축키는 `accelerator`가 1~40자 문자열이고 `enabled`가 참거짓일 때만(뜻의 검사는 Task 8의 등록 때). `startWithWindows`는 `true`, `false`, `null`만. 이 파일이 Task 8의 칸까지 모두 정한다.
- `loadDesktopSettings`: 없으면 `missing`. JSON이 깨졌거나 객체가 아니면 원본을 `<file>.corrupt`로 옮기고 `corrupt`. `version`이 1이 아니거나 없으면 `migrated`. 어느 경우든 앱은 그 설정으로 뜬다. `saveDesktopSettings`는 폴더를 만들고 `<file>.tmp`에 쓴 뒤 이름을 바꾼다. 파일은 `join(profileDir, 'settings.json')`.
- 위치 조정(메인): `startAdjust()`는 지금 자리를 `before`로 두고 `adjusting = true`, `setAlwaysOnTop(true)`, 숨겨져 있으면 보이고, `{ type: 'adjust', active: true }`. `dragStart`에서 지금 자리를 `base`로, `drag`마다 `setBounds(applyDrag(base, …, 작업 영역들))`. `adjustDone(true)`는 `clampBounds`한 자리를 지금 구성의 키로 저장하고, `false`는 `before`로 돌린다. 끝나면 `adjusting = false`, `setAlwaysOnTop(settings.alwaysOnTop)`, 맨 아래 지키기, `{ type: 'adjust', active: false }`. 메뉴에서 여는 길은 Task 8.
- 화면 구성이 바뀌면(`display-added`, `display-removed`, `display-metrics-changed`) 500ms 모아 `setBounds(resolveBounds(…))`. 조정 중에는 하지 않는다. 창을 만들 때도 `resolveBounds`. `DisplayInfo`는 `screen.getAllDisplays()`에서 `primary: d.id === screen.getPrimaryDisplay().id`.
- 위치 조정(화면): `.adjust` 덮개(창 전체, 점선 테두리 `#6AA6FF`, 옅은 파란 바탕). 위쪽 줄에 `끌어서 옮기고, 가장자리를 끌어 크기를 바꿉니다.`와 단추 `적용`, `취소`. 가운데 `.adjust-move`와 가장자리 8px·모서리 16px의 `.adjust-handle[data-kind]` 여덟 개. `pointerdown`에서 `dragStart()`, 시작 `screenX/screenY`를 기억하고 포인터를 잡는다. `pointermove`마다 `drag(kind, screenX − 시작X, screenY − 시작Y)`. 이동과 놓기는 `.adjust`에서 듣는다. `적용` → `adjustDone(true)`, `취소` → `adjustDone(false)`. `main.ts`는 `adjust` 명령으로 덮개를 열고 닫는다.

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// src/desktop/bounds.test.ts
const one: DisplayInfo[] = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 }, primary: true }];
const two: DisplayInfo[] = [...one, { bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1040 }, primary: false }];
const wa = one.map((d) => d.workArea);
const r = { x: 100, y: 100, width: 800, height: 600 };

it('모니터 구성 문자열과 처음 보는 구성의 기본 자리(주 모니터가 아닌 모니터의 오른쪽, 폭 65%, 높이 96%)', () => {
  expect([layoutKey(one), layoutKey(two), layoutKey([...two].reverse())]).toEqual(['0,0,1920x1080', '-1920,0,1920x1080|0,0,1920x1080', '-1920,0,1920x1080|0,0,1920x1080']);
  expect([defaultBounds(one), defaultBounds(two)]).toEqual([{ x: 652, y: 20, width: 1248, height: 991 }, { x: -1269, y: 21, width: 1248, height: 998 }]);
});
it('화면 밖으로 완전히 나가지 않게 80px을 남기고 위쪽은 넘지 않는다', () => {
  expect([clampBounds(r, wa), clampBounds({ ...r, x: -5000 }, wa), clampBounds({ ...r, y: -300 }, wa), clampBounds({ ...r, y: 5000 }, wa)])
    .toEqual([r, { ...r, x: -720 }, { ...r, y: 0 }, { ...r, y: 952 }]);
  expect(clampBounds({ x: 0, y: 0, width: 3000, height: 100 }, wa)).toEqual({ x: 0, y: 0, width: 1920, height: 240 });
  expect(clampBounds({ ...r, x: -1500, y: 10 }, two.map((d) => d.workArea))).toEqual({ ...r, x: -1500, y: 10 });
});
it('모니터를 빼면 남은 모니터의 기본 자리로, 다시 꽂으면 그 구성의 자리로', () => {
  const saved = { [layoutKey(two)]: { ...r, x: -1500, y: 10 } };
  expect([resolveBounds(saved, two), resolveBounds(saved, one)]).toEqual([{ ...r, x: -1500, y: 10 }, defaultBounds(one)]);
});
it('끌어서 옮기고 가장자리로 크기를 바꾸되 최소 크기를 지킨다', () => {
  expect([applyDrag(r, 'move', 50, -20, wa), applyDrag(r, 'se', 100, 50, wa), applyDrag(r, 'nw', 600, 500, wa), applyDrag(r, 'w', -50, 999, wa), applyDrag(r, 'move', -5000, 0, wa)])
    .toEqual([{ x: 150, y: 80, width: 800, height: 600 }, { x: 100, y: 100, width: 900, height: 650 }, { x: 540, y: 460, width: 360, height: 240 }, { x: 50, y: 100, width: 850, height: 600 }, { ...r, x: -720 }]);
});
```
```ts
// src/desktop/settings.test.ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = () => mkdtempSync(join(tmpdir(), 'calfif-settings-'));
it('기본값, 그리고 맞는 칸은 살리고 틀린 칸만 기본값으로', () => {
  expect(DEFAULT_DESKTOP_SETTINGS).toEqual({ version: 1, bounds: {}, contentHidden: false, alwaysOnTop: false,
    hideHotkey: { accelerator: 'Ctrl+Alt+H', enabled: false }, contentHotkey: { accelerator: 'Ctrl+Alt+F', enabled: false }, startWithWindows: null });
  expect(parseDesktopSettings({ bounds: { k: { x: 1, y: 2, width: 800, height: 600 }, bad: { x: 'a' }, huge: { x: 1e9, y: 0, width: 1, height: 1 } },
    alwaysOnTop: 'yes', contentHidden: true, hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true }, contentHotkey: { accelerator: 5 }, startWithWindows: false, extra: 1 }))
    .toEqual({ ...DEFAULT_DESKTOP_SETTINGS, bounds: { k: { x: 1, y: 2, width: 800, height: 600 } }, contentHidden: true, hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true }, startWithWindows: false });
});
it('없으면 기본값, 깨졌으면 옆에 보관하고 기본값, 예전 형식은 읽어 들이고, 임시 파일을 거쳐 쓴다', () => {
  const file = join(tempDir(), 'settings.json');
  expect(loadDesktopSettings(file)).toEqual({ settings: DEFAULT_DESKTOP_SETTINGS, status: 'missing' });
  writeFileSync(file, '{"version":1,"bounds":');
  expect([loadDesktopSettings(file), readFileSync(`${file}.corrupt`, 'utf8')]).toEqual([{ settings: DEFAULT_DESKTOP_SETTINGS, status: 'corrupt' }, '{"version":1,"bounds":']);
  writeFileSync(file, JSON.stringify({ alwaysOnTop: true }));
  expect(loadDesktopSettings(file)).toEqual({ settings: { ...DEFAULT_DESKTOP_SETTINGS, alwaysOnTop: true }, status: 'migrated' });
  const nested = join(tempDir(), 'nested', 'settings.json');
  saveDesktopSettings(nested, { ...DEFAULT_DESKTOP_SETTINGS, contentHidden: true });
  expect([loadDesktopSettings(nested), existsSync(`${nested}.tmp`)]).toEqual([{ settings: { ...DEFAULT_DESKTOP_SETTINGS, contentHidden: true }, status: 'ok' }, false]);
});
```
```ts
// src/desktop/ipc.test.ts 끝에 추가 (import에 parseDrag)
it('끌기 값을 검사한다', () => {
  expect([parseDrag('se', 10, -5), parseDrag('up', 10, 0), parseDrag('move', NaN, 0), parseDrag('move', 200000, 0)]).toEqual([{ kind: 'se', dx: 10, dy: -5 }, null, null, null]);
});
```
```ts
// src/web/desktop/adjust.test.ts
import { FakeBridge } from './fakeBridge';

it('끈 거리를 처음 자리 기준으로 보내고, 적용과 취소를 알린다', () => {
  const root = document.createElement('div');
  const bridge = new FakeBridge();
  mountAdjust(root, bridge);
  const ev = (type: string, el: Element, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { screenX: x, screenY: y, pointerId: 1, bubbles: true }));
  const body = root.querySelector('.adjust-move')!, se = root.querySelector('.adjust-handle[data-kind="se"]')!;
  ev('pointerdown', body, 100, 100); ev('pointermove', body, 130, 90); ev('pointermove', body, 160, 95); ev('pointerup', body, 160, 95);
  ev('pointerdown', se, 500, 400); ev('pointermove', se, 520, 380);
  expect(bridge.calls).toEqual([['dragStart'], ['drag', 'move', 30, -10], ['drag', 'move', 60, -5], ['dragStart'], ['drag', 'se', 20, -20]]);
  expect([root.textContent!.includes('끌어서 옮기고, 가장자리를 끌어 크기를 바꿉니다.'), root.querySelectorAll('.adjust-handle').length]).toEqual([true, 8]);
  for (const label of ['적용', '취소']) [...root.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
  expect(bridge.calls.slice(-2)).toEqual([['adjustDone', true], ['adjustDone', false]]);
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/desktop src/web/desktop/adjust.test.ts` → FAIL(`./bounds`, `./settings`, `parseDrag`, `./adjust`가 없다).
- [ ] **Step 3: 구현** — Interfaces와 "정해 둔 값"대로 쓴다. 설정 파일이 `corrupt`였으면 콘솔에 그 사실만 적는다.
- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` → PASS, 타입 오류 없음.
- [ ] **Step 5: bounds 시험 실행** — `smoke.ts`의 `bounds`: ① 처음 자리 `initial` ② `startAdjust`, `dragStart`, `drag('move', -50000, 0)` 뒤 `offscreen` ③ `adjustDone(false)` 뒤 자리 ④ 다시 `startAdjust`, `dragStart`, `drag('se', -200, -100)`, `adjustDone(true)` 뒤 `applied` ⑤ `settings.json`의 `bounds[layoutKey]` ⑥ 그 파일을 `loadDesktopSettings`로 다시 읽어 `resolveBounds`한 값 ⑦ 조정 중과 끝난 뒤의 `isAlwaysOnTop()`. Run: `CALFIF_SMOKE=bounds npm run desktop:smoke`. Expected: `failures: []`. `initial`이 `defaultBounds(displays)`와 같다. `offscreen`이 어느 작업 영역과도 가로세로 80px 이상 겹친다. ③이 `initial`과 같다(`cancelRestored: true`). `applied.width`가 `initial.width − 200`. ⑤와 ⑥이 `applied`와 같다. ⑦이 `[true, false]`.
- [ ] **Step 6: Commit**
```bash
git add src/desktop src/web/desktop/adjust.ts src/web/desktop/adjust.test.ts src/web/main.ts src/web/desktop.css
git commit -m "feat: 창의 자리와 크기를 조정하고 모니터 구성마다 기억한다"
```

---

### Task 8: 트레이, 전역 단축키, 숨기기, 맨 위에 보기, 자동 실행

**Files:**
- Create: `src/core/accelerator.ts`, `src/desktop/{hotkeys,menu,startup,tray}.ts`, 그리고 `accelerator`, `hotkeys`, `menu`, `startup`의 `.test.ts`
- Modify: `src/desktop/ipc.ts`, `src/desktop/ipc.test.ts`, `src/desktop/main.ts`, `src/desktop/window.ts`, `src/desktop/smoke.ts`

**Interfaces:**
- Consumes: Task 5의 `SystemState`, `SystemPatch`, `HotkeyState`, `DesktopCommand`. Task 6의 `Runtime.manageLoginItem`, 맨 아래 지키기, `parsePoint`. Task 7의 `DesktopSettings`, `saveDesktopSettings`, `startAdjust`.
- Produces:
```ts
// src/core/accelerator.ts
export function normalizeAccelerator(raw: string): string | null;
export function acceleratorFromKey(e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string }): string | null;
// src/desktop/hotkeys.ts
export type Registrar = { register(accelerator: string, fn: () => void): boolean; unregister(accelerator: string): void };
export class HotkeyManager {
  constructor(reg: Registrar);
  apply(s: Pick<DesktopSettings, 'hideHotkey' | 'contentHotkey'>, actions: { hide(): void; content(): void }): { hide: HotkeyState; content: HotkeyState };
  dispose(): void;
}
// src/desktop/menu.ts
export type MenuState = { hidden: boolean; contentHidden: boolean; alwaysOnTop: boolean; startWithWindows: boolean | null; canStartWithWindows: boolean };
export type MenuAction = 'toggleHidden' | 'toggleContent' | 'toggleOnTop' | 'adjust' | 'settings' | 'toggleStart' | 'about' | 'quit' | 'today' | 'signOut';
export type MenuItemModel = { label: string; action: MenuAction; checked?: boolean; enabled?: boolean } | { separator: true };
export function menuModel(state: MenuState, where: 'tray' | 'title'): MenuItemModel[];
// src/desktop/startup.ts
export function startupAction(p: { manage: boolean; saved: boolean | null }): { register: boolean | null; save: boolean | null };
// src/desktop/ipc.ts
export function parseSystemPatch(v: unknown): SystemPatch | null;
```

정해 둔 값:
- `normalizeAccelerator`: `+`로 나눠 공백을 떼고 대소문자를 가리지 않는다. 수식키는 `Ctrl`, `Alt`, `Shift`를 이 순서로, 중복이면 거부. 키는 정확히 하나이고 `A`~`Z`, `0`~`9`, `F1`~`F24`. `Ctrl`이나 `Alt` 중 하나는 있어야 한다. `Super`/`Win`/`Meta`가 있거나 `Alt+F4`면 거부. `acceleratorFromKey`: `code`의 `KeyH` → `H`, `Digit7` → `7`, `F9` → `F9`. 수식키만 눌렀거나 `metaKey`면 `null`. 결과는 `normalizeAccelerator`를 거친다.
- `HotkeyManager.apply`: 지난번에 등록한 것을 먼저 푼다. 꺼진 것 `off`, 정규화가 안 되면 `invalid`, 등록이 거짓이면 `taken`(앞의 것과 같은 단축키여도), 참이면 `ok`. 실제 `Registrar`는 `globalShortcut.register(…) && globalShortcut.isRegistered(…)`. `will-quit`에서 `dispose()`와 `globalShortcut.unregisterAll()`.
- 메뉴 문구(설계 9절): 트레이 = `캘린더 숨기기`(숨겨져 있으면 `캘린더 보이기`), `내용 숨기기`(`내용 보이기`), `맨 위에 보기`(체크), 구분선, `위치 및 크기`, `설정`, `Windows 시작 시 실행`(체크는 `startWithWindows === true`, 쓸 수 있음은 `canStartWithWindows`), 구분선, `제품 정보`, `닫기`. 제목 줄 = `오늘로`, 구분선, 트레이의 `닫기` 앞까지, `로그아웃`, `닫기`.
- 동작: 숨기기 `win.hide()`, 보이기 `showInactive()`와 맨 아래 지키기. 숨김은 저장하지 않는다(다시 켜면 늘 보인다). 내용 숨기기는 `settings.contentHidden`을 바꿔 저장하고 `{ type: 'contentHidden', hidden }`, 화면이 새로 읽힐 때(`did-finish-load`)도 보낸다. 맨 위에 보기는 `setAlwaysOnTop(on)`과 저장, 끄면 맨 아래 지키기. `위치 및 크기` → `startAdjust()`. `설정` → 창을 보이고 `{ type: 'openSettings' }`. `오늘로` → `{ type: 'today' }`, `로그아웃` → `{ type: 'signOut' }`. `닫기` → 끝내는 중 표시 후 `app.quit()`.
- `제품 정보`: `dialog.showMessageBox({ type: 'info', title: '제품 정보', message: 'CalendarFIF ' + app.getVersion(), detail: 'PC와 아이폰의 날짜별 메모를 동기화하는 개인용 달력입니다.', buttons: ['확인'] })`.
- 트레이: 아이콘 `join(rendererDir, 'icons', 'icon-192.png')`을 16x16으로, 툴팁 `CalendarFIF`, 오른쪽 클릭은 `menuModel(…, 'tray')`, 왼쪽 클릭은 숨겨져 있으면 보이기. 상태가 바뀔 때마다 메뉴를 다시 만든다. 제목 줄 메뉴: `CH.menu`(`parsePoint`) → `Menu.popup({ window, x, y, callback })`, 닫히면 맨 아래 지키기.
- 자동 실행: 앱이 뜰 때 `startupAction({ manage: runtime.manageLoginItem, saved: settings.startWithWindows })`의 `register`가 있으면 `app.setLoginItemSettings({ openAtLogin: register })`, `save`가 있으면 저장(설계 8절 "꾸린 앱에서 켬"을 첫 실행에서 한 번). 켜고 끄기(메뉴, `CH.setSystem`)는 `manageLoginItem`일 때만 같은 호출을 하고 아니면 무시한다. `canStartWithWindows = manageLoginItem`. 상태의 `startWithWindows`는 관리할 수 있으면 `app.getLoginItemSettings().openAtLogin`, 아니면 저장 값. `setLoginItemSettings`는 한 함수로 감싸 부른 횟수를 세고, 모든 시나리오의 결과에 `loginItemCalls`로 적는다(시험 실행에서 0이 아니면 실패).
- `CH.getSystem`은 지금 `SystemState`. `CH.setSystem`은 `parseSystemPatch`를 통과한 패치를 저장하고 단축키를 다시 `apply`한 `SystemState`.

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// src/core/accelerator.test.ts
it('단축키를 한 가지 모양으로 적고, 쓸 수 없는 조합은 거른다', () => {
  expect(['ctrl+alt+h', ' Shift + Ctrl + f9 ', 'Alt+Ctrl+5'].map(normalizeAccelerator)).toEqual(['Ctrl+Alt+H', 'Ctrl+Shift+F9', 'Ctrl+Alt+5']);
  expect(['H', 'Shift+A', 'Ctrl+Alt', 'Ctrl+Alt+H+J', 'Alt+F4', 'Super+D', 'Ctrl+Ctrl+H', 'Ctrl+Alt+Delete'].map(normalizeAccelerator)).toEqual(Array(8).fill(null));
});
it('누른 키에서 단축키를 만든다', () => {
  const key = (code: string, m: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}) => acceleratorFromKey({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code, ...m });
  expect([key('KeyH', { ctrlKey: true, altKey: true }), key('Digit7', { ctrlKey: true, shiftKey: true }), key('F9', { altKey: true })]).toEqual(['Ctrl+Alt+H', 'Ctrl+Shift+7', 'Alt+F9']);
  expect([key('ControlLeft', { ctrlKey: true }), key('KeyH', { ctrlKey: true, metaKey: true }), key('KeyH')]).toEqual([null, null, null]);
});
```
```ts
// src/desktop/hotkeys.test.ts
function fakeRegistrar(taken: string[] = []) {
  const registered = new Map<string, () => void>();
  const reg: Registrar = {
    register: (acc, fn) => { if (taken.includes(acc) || registered.has(acc)) return false; registered.set(acc, fn); return true; },
    unregister: (acc) => { registered.delete(acc); },
  };
  return { reg, registered };
}
const hk = (accelerator: string, enabled = true) => ({ accelerator, enabled });
const acts = () => ({ hide: vi.fn(), content: vi.fn() });

it('켠 단축키만 등록하고, 누르면 할 일을 부른다', () => {
  const { reg, registered } = fakeRegistrar();
  const actions = acts();
  expect(new HotkeyManager(reg).apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F', false) }, actions)).toEqual({ hide: 'ok', content: 'off' });
  registered.get('Ctrl+Alt+H')!();
  expect(actions.hide).toHaveBeenCalledTimes(1);
});
it('다른 프로그램이 쓰면 taken, 이상하면 invalid이고 다른 하나는 그대로 동작한다', () => {
  const { reg, registered } = fakeRegistrar(['Ctrl+Alt+H']);
  const m = new HotkeyManager(reg);
  expect(m.apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F') }, acts())).toEqual({ hide: 'taken', content: 'ok' });
  expect([...registered.keys()]).toEqual(['Ctrl+Alt+F']);
  expect(m.apply({ hideHotkey: hk('H'), contentHotkey: hk('Ctrl+Alt+F') }, acts())).toEqual({ hide: 'invalid', content: 'ok' });
});
it('다시 적용하면 앞서 등록한 것을 풀고, 두 단축키가 같으면 뒤의 것은 taken, 끝낼 때 모두 푼다', () => {
  const { reg, registered } = fakeRegistrar();
  const m = new HotkeyManager(reg);
  m.apply({ hideHotkey: hk('Ctrl+Alt+H'), contentHotkey: hk('Ctrl+Alt+F') }, acts());
  expect(m.apply({ hideHotkey: hk('Ctrl+Alt+J'), contentHotkey: hk('Ctrl+Alt+J') }, acts())).toEqual({ hide: 'ok', content: 'taken' });
  expect([...registered.keys()]).toEqual(['Ctrl+Alt+J']);
  m.dispose();
  expect(registered.size).toBe(0);
});
```
```ts
// src/desktop/menu.test.ts
const state: MenuState = { hidden: false, contentHidden: false, alwaysOnTop: false, startWithWindows: true, canStartWithWindows: true };
const labels = (items: MenuItemModel[]) => items.map((i) => ('separator' in i ? '-' : i.label));
it('트레이 메뉴', () => {
  expect(labels(menuModel(state, 'tray'))).toEqual(['캘린더 숨기기', '내용 숨기기', '맨 위에 보기', '-', '위치 및 크기', '설정', 'Windows 시작 시 실행', '-', '제품 정보', '닫기']);
  const items = menuModel({ hidden: true, contentHidden: true, alwaysOnTop: true, startWithWindows: null, canStartWithWindows: false }, 'tray');
  expect(labels(items).slice(0, 2)).toEqual(['캘린더 보이기', '내용 보이기']);
  expect(items[2]).toMatchObject({ action: 'toggleOnTop', checked: true });
  expect(items.find((i) => 'action' in i && i.action === 'toggleStart')).toMatchObject({ checked: false, enabled: false });
});
it('제목 줄 메뉴에는 오늘로와 로그아웃이 더 있다', () => {
  expect(labels(menuModel(state, 'title'))).toEqual(['오늘로', '-', '캘린더 숨기기', '내용 숨기기', '맨 위에 보기', '-', '위치 및 크기', '설정', 'Windows 시작 시 실행', '-', '제품 정보', '로그아웃', '닫기']);
});
```
```ts
// src/desktop/startup.test.ts
it('자동 실행은 꾸린 앱의 첫 실행에서만 켜고, 개발과 시험 실행에서는 건드리지 않는다', () => {
  expect([startupAction({ manage: false, saved: null }), startupAction({ manage: true, saved: null }), startupAction({ manage: true, saved: false }), startupAction({ manage: true, saved: true })])
    .toEqual([{ register: null, save: null }, { register: true, save: true }, { register: null, save: null }, { register: null, save: null }]);
});
```
```ts
// src/desktop/ipc.test.ts 끝에 추가 (import에 parseSystemPatch)
it('설정 바꾸기 요청은 아는 칸만 받는다', () => {
  expect(parseSystemPatch({ hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true } })).toEqual({ hideHotkey: { accelerator: 'Ctrl+Alt+K', enabled: true } });
  expect(parseSystemPatch({ startWithWindows: true, other: 1 })).toEqual({ startWithWindows: true });
  expect([{ hideHotkey: { accelerator: 'x'.repeat(41), enabled: true } }, { startWithWindows: 'yes' }, null, []].map(parseSystemPatch)).toEqual([null, null, null, null]);
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run --project unit src/core/accelerator.test.ts src/desktop` → FAIL(모듈과 `parseSystemPatch`가 없다).
- [ ] **Step 3: 구현** — Interfaces와 "정해 둔 값"대로 쓴다.
- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` → PASS, 타입 오류 없음.
- [ ] **Step 5: tray 시험 실행** — `smoke.ts`의 `tray`: 트레이 메뉴 항목 이름(실제 `Menu`의 `items`), 숨기기와 보이기, 내용 숨기기 두 번(화면 `<html>`의 클래스와 저장 값), 맨 위에 보기 켜고 끄기, `setSystem`으로 `Ctrl+Alt+Shift+F9`, `Ctrl+Alt+Shift+F10`을 켜고 상태를 본 뒤 숨기기 단축키를 끄고 `globalShortcut.isRegistered('Ctrl+Alt+Shift+F9')`. Run: `CALFIF_SMOKE=tray npm run desktop:smoke`. Expected: `failures: []`, `trayCreated: true`, `trayMenu`가 menu 테스트의 트레이 목록과 같다, `startItem: { checked: false, enabled: false }`, `visible: [false, true]`, `contentHidden: [true, false]`, `contentHiddenSaved: true`, `alwaysOnTop: [true, false]`, `atBottomAfterOnTopOff: true`, `hotkeys: { hide: "ok", content: "ok" }`, `hideRegisteredAfterOff: false`, `loginItemCalls: 0`.
- [ ] **Step 6: Commit**
```bash
git add src/core/accelerator.ts src/core/accelerator.test.ts src/desktop
git commit -m "feat: 트레이 메뉴, 전역 단축키, 숨기기, 맨 위에 보기, 자동 실행"
```

---

### Task 9: 설정 화면(캘린더, 셀, 글꼴 및 색상, 고급, 계정)

**Files:**
- Create: `src/web/desktop/settingsPages.ts`, `src/web/desktop/settingsPages.test.ts`
- Modify: `src/web/ui/settings.ts`, `src/web/main.ts`, `src/web/desktop.css`, `src/desktop/smoke.ts`

**Interfaces:**
- Consumes: Task 2의 `Appearance`, `DEFAULT_APPEARANCE`, `saveAppearance`. Task 4의 `applyAppearance`, `CalendarHandle.setAppearance`. Task 5의 `CalfifDesktop`, `SystemState`, `SettingsPage`, `FakeBridge`, `Interactivity`, `playDoneTone`. Task 8의 `acceleratorFromKey`. `PALETTE`.
- Produces:
```ts
// src/web/ui/settings.ts: 지금의 계정, 동기화, 로그아웃 부분을 떼어 낸다. mountSettings는 이것을 쓰고 위젯 안내를 extra로 넘긴다
export type AccountProps = { email: string; pending: number; storageOk: boolean; corruptFound: boolean; onSignOut(): void };
export function accountSection(props: AccountProps, extra?: HTMLElement): HTMLElement; // extra는 로그아웃 위에 넣는다
// src/web/desktop/settingsPages.ts
export function mountDesktopSettings(root: HTMLElement, props: {
  appearance: Appearance; onAppearance(next: Appearance): void; bridge: CalfifDesktop | null;
  account: AccountProps; page?: SettingsPage; onClose(): void;
}): { destroy(): void; showPage(page: SettingsPage): void };
```

정해 둔 값:
- 시트 제목 `설정`, 단추 `닫기`. 탭(`role="tab"`) `캘린더`, `셀`, `글꼴 및 색상`, `고급`, `계정`, 내용은 `role="tabpanel"`이고 고르지 않은 쪽은 `hidden`. 줄은 `.srow`, 이름은 `.srow-label`(설계 8절 그대로). 켬/끔은 `input[type="checkbox"][role="switch"]`. 바꿀 때마다 `onAppearance({ ...지금, 그 칸 })`. Esc는 닫기(조합 중 제외), 단축키 칸 안의 Esc는 받기만 그만둔다.
- 캘린더: `배치`(라디오 `변동 월`, `전체 월`, `고정 단일 행`, `변동 단일 행`), `최대 행`(select 2~8), `지나간 주 표시`(select 0~3; 둘은 `변동 월`이 아니면 비활성이고 `변동 월에서만 씁니다.`), `월 간격`, `주 번호`, `그림자`, `제목 표시줄 표시`, `공휴일`(도움말 `대한민국 공휴일 이름을 칸에 표시합니다.`), `음력`(도움말 `칸에 음력 날짜를 표시합니다.`).
- 셀: `줄 머리`(라디오 `없음`, `번호`, `점`), `셀 간격`(select 0~12, 보기 `4px`), `줄 간격`(range 1~2, step 0.05, 값을 옆에 `1.35`), `완료 작업 자동으로 맨 아래 줄로 이동`, `완료된 작업 표시`, `편집 완료 알람`(select `없음`, `짧은 소리`; `짧은 소리`로 바꾸면 한 번 들려준다).
- 글꼴 및 색상: `캘린더 글꼴(날짜·요일)`(색 + select 11~20), `편집 내용의 글꼴 크기 및 색상`(색 + select 11~22), `캘린더 배경`, `휴일 배경색`, `오늘의 테두리`, `제목 표시줄 버튼 색상`, `휴일 텍스트 색상`, `음력 텍스트 색상`, `투명도`(range 0~100, step 5, 양 끝 `단색`, `완전 투명`, 값을 옆에 `60%`).
- 색 고르기(설계 8절: 22색, 없음, 직접 입력): 줄의 `.color-btn`(지금 색 견본)을 누르면 줄 아래에 `.swatch`가 펼쳐진다. `캘린더 배경`, `휴일 배경색`, `오늘의 테두리`는 `없음` + 22색, 나머지는 22색. 그 아래 `직접 입력` 칸 `input.hex`(placeholder `RRGGBB`): `change`에서 `#`을 떼고 대문자로 바꿔 6자리 16진수면 반영, 아니면 줄에 `16진수 6자리로 적어 주세요.`를 보이고 값은 그대로.
- 고급: `시작 요일`(select `일요일`~`토요일`), `첫번째 주`(select `1월 1일이 든 주`, `ISO 방식`), `쉬는날 표시`, `쉬는날`(체크 일곱 개 `일`~`토`), `캘린더 숨기기 단축키`, `내용 표시 및 숨기기 단축키`(각각 읽기 전용 `input.hotkey`(placeholder `새 단축키를 누르세요`) + 스위치), `Windows 시작 시 실행`(스위치).
- 단축키 칸: 처음에 `bridge.getSystem()`의 답으로 지금 단축키와 스위치를 채운다. `keydown`을 `acceleratorFromKey`로 바꿔 `null`이 아니면 칸에 적고 `bridge.setSystem({ hideHotkey 또는 contentHotkey: { accelerator, enabled: 지금 스위치 } })`. 스위치는 `enabled`를 바꿔 같은 호출. 결과가 `taken`이면 `다른 프로그램이 이 단축키를 쓰고 있습니다. 다른 조합을 고르세요.`, `invalid`면 `Ctrl 또는 Alt를 넣은 조합을 고르세요.`를 줄에 보인다.
- `Windows 시작 시 실행`: `canStartWithWindows`가 거짓이면 스위치를 끄고 비활성, `개발 실행에서는 바꿀 수 없습니다. 꾸린 앱에서 바꿉니다.`. `bridge`가 `null`(브라우저 개발 화면)이면 고급의 단축키와 자동 실행 줄을 모두 비활성으로 두고 `바탕화면 앱에서만 바꿀 수 있습니다.`.
- 계정: `accountSection(account)`. 웹앱 설정 화면의 문구, 순서, 로그아웃 확인 동작은 그대로다.
- `main.ts`(데스크톱): `#settings`에서 `mountDesktopSettings`를 열고, 바뀐 모양을 `saveAppearance`, `applyAppearance`, `calendar.setAppearance`로 바로 반영한다. `openSettings` 명령의 `page`를 따르고, `signOut` 명령은 대기 건수가 있으면 `account` 쪽을 연다.

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// src/web/desktop/settingsPages.test.ts
import { DEFAULT_APPEARANCE } from '../appearance';
import { FakeBridge } from './fakeBridge';

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
  expect(labels(root)).toEqual(['캘린더 글꼴(날짜·요일)', '편집 내용의 글꼴 크기 및 색상', '캘린더 배경', '휴일 배경색', '오늘의 테두리', '제목 표시줄 버튼 색상', '휴일 텍스트 색상', '음력 텍스트 색상', '투명도']);
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
```
- [ ] **Step 2: 실패 확인** — `npx vitest run --project dom src/web/desktop src/web/ui/settings.test.ts` → FAIL(`./settingsPages`가 없다. 기존 settings 테스트는 통과).
- [ ] **Step 3: 구현** — Interfaces와 "정해 둔 값"대로 쓴다.
- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` → PASS, 타입 오류 없음.
- [ ] **Step 5: 화면 확인** — `npm run dev:desktop-emu`를 띄우고 `http://localhost:5173/?autologin=1#settings`를 620x560과 1260x992, 바탕 `#3B6E8F`로 다섯 쪽을 `--eval`로 눌러 가며 찍는다. Expected: 시트가 창 안에 들어오고 내용이 세로로 스크롤되며 문구가 잘리지 않는다. 브라우저라서 고급의 단축키와 자동 실행 줄은 비활성이다.
- [ ] **Step 6: settings 시험 실행** — `smoke.ts`의 `settings`: `openSettings` 명령 → 시트를 기다림 → `isFocusable()` → `글꼴 및 색상`에서 투명도 30(`input` 이벤트) → `<html>`의 `--desk-cell-bg`와 `localStorage['calfif.appearance']` → `고급`의 단축키 칸에 Ctrl+Alt+Shift+F9 `keydown`과 스위치 클릭 → 메인의 단축키 상태 → 자동 실행 스위치의 `disabled` → `닫기` 뒤 `isFocusable()`과 맨 아래 여부. Run: `CALFIF_SMOKE=settings npm run desktop:smoke`. Expected: `failures: []`, `tabs`가 다섯 쪽 이름, `interactiveWhileOpen: true`, `cellBg: "rgba(20, 24, 32, 0.7)"`, `savedTransparency: 30`, `hotkey: { accelerator: "Ctrl+Alt+Shift+F9", state: "ok", registered: true }`, `startSwitchDisabled: true`, `interactiveAfterClose: false`, `atBottomAfterClose: true`.
- [ ] **Step 7: Commit**
```bash
git add src/web/desktop/settingsPages.ts src/web/desktop/settingsPages.test.ts src/web/ui/settings.ts src/web/main.ts src/web/desktop.css src/desktop/smoke.ts
git commit -m "feat: PC 앱 설정 화면(캘린더, 셀, 글꼴 및 색상, 고급, 계정)"
```

---

### Task 10: 꾸리기, 끝에서 끝까지 확인, 사용 안내

**Files:**
- Create: `scripts/pack-manifest.ts`, `scripts/pack-manifest.test.ts`, `scripts/pack-desktop.ts`
- Modify: `package.json`, `package-lock.json`, `scripts/desktop-run.ts`, `src/desktop/smoke.ts`, `README.md`

**Interfaces:**
- Consumes: Task 6의 `desktop-run.ts`, `resolveRuntime`(꾸린 앱은 `dist-desktop`을 읽는다), 모든 시나리오.
- Produces: `export function stageManifest(rootPkg: { version?: string; dependencies?: Record<string, string> }, koffiVersion: string): Record<string, unknown>;`(`scripts/pack-manifest.ts`)

정해 둔 값:
- `package.json`: `"version": "0.3.0"`, devDependencies에 `@electron/packager`, 스크립트 `"desktop:pack": "tsx scripts/pack-desktop.ts"`, `"desktop:pack:emu": "tsx scripts/pack-desktop.ts --emu"`, `"desktop:pack:check"`(`desktop:smoke`와 같고 끝만 `tsx scripts/desktop-run.ts --smoke --packaged build/release-emu/CalendarFIF-win32-x64/CalendarFIF.exe`).
- `pack-desktop.ts [--emu]`: 화면을 `desktop`(또는 `desktop-emu`) 모드로, 메인을 `vite.desktop.config.ts`로 빌드한다. `build/pack-stage/`를 비우고 `package.json`(= `stageManifest(루트, node_modules/koffi의 version)`), `desktop/`(= `build/desktop/*`), `dist-desktop/`(= 고른 화면 빌드), `node_modules/koffi/`를 복사한다. `@electron/packager`를 `{ dir: 'build/pack-stage', out: --emu ? 'build/release-emu' : 'release', name: 'CalendarFIF', platform: 'win32', arch: 'x64', electronVersion: node_modules/electron/package.json의 version, overwrite: true, prune: false, asar: false }`로 부른다. 서명과 설치 프로그램은 없다(설계 11절). 결과는 `release/CalendarFIF-win32-x64/CalendarFIF.exe`.
- `stageManifest` = `{ name: 'calendarfif', productName: 'CalendarFIF', version: rootPkg.version ?? '0.0.0', private: true, main: 'desktop/main.cjs', dependencies: { koffi: koffiVersion } }`.
- `desktop-run.ts --packaged <exe>`: 빌드하지 않고 그 실행 파일을 같은 환경 변수로 띄운다(`CALFIF_RENDERER_DIR`은 꾸린 앱이 무시한다).
- `e2e` 시나리오(설계 13절 "5초 안에"): 앱은 달력이 보이면 `build/desktop-smoke/e2e.json`에 `{ phase: 'ready' }`를 쓰고 250ms마다 `.cell.today`에 `원격 시험 메모`가 보이는지 본다. 보이면 `remoteSeen: true`를 쓰고, 칸 메뉴(`contextmenu` → `[data-action="color"]` → `.swatch[data-color="F12424"]`)로 오늘의 배경색을 바꾸고 `localEditDone: true`를 쓴다. `desktop-run.ts`는 `ready`를 보면 에뮬레이터 REST로 오늘 칸만(`updateMask.fieldPaths`에 ``days.`DD` ``) `{ text: '원격 시험 메모', color: '', editedAt: 지금, editedBy: 'iphone' }`을 쓰고, `remoteSeen`까지의 시간과, 그 뒤 그 칸의 `color`가 `F12424`가 될 때까지의 시간을 재서 `build/desktop-smoke/e2e-result.json`에 `{ remoteToDesktopMs, desktopToRemoteMs, ok }`(`ok`는 둘 다 5000 미만)를 쓰고 앱을 끝낸다.
- README에 "PC 바탕화면 앱" 절: 준비(`npm install`, `npm run desktop:setup`), 실행(`npm run desktop`), 꾸리기(`npm run desktop:pack`, 결과 폴더를 원하는 곳에 두고 `CalendarFIF.exe` 실행, 첫 실행에서 Windows 시작 시 실행이 켜진다), 회사 PC가 서명 없는 실행 파일을 막으면 `npm run desktop`을 바로가기로 쓰는 방법(설계 12절), 설정 위치(`%APPDATA%\CalendarFIF\settings.json`, 달력 모양은 앱 안), 트레이 메뉴와 단축키 기본값(`Ctrl+Alt+H`, `Ctrl+Alt+F`, 꺼짐), 지우는 방법(트레이의 Windows 시작 시 실행 끄기 → 닫기 → 폴더와 `%APPDATA%\CalendarFIF` 지우기), DesktopCal과 함께 쓰는 동안은 반대쪽 모니터에 둔다는 점. 개발 표에 `dev:desktop-emu`, `desktop:emu`, `desktop:smoke`, `desktop:pack:emu`, `desktop:pack:check`. 첫 문단의 "PC 바탕화면 앱은 나중에 만든다"를 고친다.

- [ ] **Step 1: 실패하는 테스트 쓰기**
```ts
// scripts/pack-manifest.test.ts
it('꾸리기용 package.json에는 koffi만 의존성으로 남긴다', () => {
  expect(stageManifest({ version: '0.3.0', dependencies: { firebase: '^13.3.0', koffi: '^3.3.8' } }, '3.3.8')).toEqual({
    name: 'calendarfif', productName: 'CalendarFIF', version: '0.3.0', private: true, main: 'desktop/main.cjs', dependencies: { koffi: '3.3.8' },
  });
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run --project unit scripts/pack-manifest.test.ts` → FAIL(모듈이 없다).
- [ ] **Step 3: 구현과 통과 확인** — `npm install -D @electron/packager` 뒤 "정해 둔 값"대로 쓴다. `npm test && npx tsc --noEmit` → PASS, 타입 오류 없음.
- [ ] **Step 4: 끝에서 끝까지(개발 실행)** — `CALFIF_SMOKE=e2e npm run desktop:smoke` → `build/desktop-smoke/e2e-result.json`의 `ok: true`, `remoteToDesktopMs`와 `desktopToRemoteMs`가 5000 미만.
- [ ] **Step 5: 꾸린 앱(에뮬레이터용) 확인** — `npm run desktop:pack:emu && npm run desktop:pack:check && CALFIF_SMOKE=e2e npm run desktop:pack:check` → `build/release-emu/CalendarFIF-win32-x64/CalendarFIF.exe`가 있다. 꾸린 앱의 `attach.json`이 Task 6과 같은 값이고 `e2e-result.json`도 `ok: true`다. 꾸린 앱이어도 시험 실행이므로 두 결과 모두 `loginItemCalls: 0`이다(Windows 시작 프로그램에 아무것도 등록하지 않았다).
- [ ] **Step 6: 전체 확인과 Commit** — `npm test && npx tsc --noEmit && npm run test:emu && for s in attach bounds tray settings; do CALFIF_SMOKE=$s npm run desktop:smoke || exit 1; done` → 모두 PASS.
```bash
git add package.json package-lock.json scripts/pack-manifest.ts scripts/pack-manifest.test.ts scripts/pack-desktop.ts scripts/desktop-run.ts src/desktop/smoke.ts README.md
git commit -m "feat: PC 앱 꾸리기와 끝에서 끝까지 확인, 사용 안내"
```
- [ ] **Step 7: 사용자에게 넘기기** — 실행자는 여기서 멈추고 사용자에게 다음을 부탁한다. ① `npm run desktop:pack`으로 실제 앱을 꾸리고 `CalendarFIF.exe`를 DesktopCal 반대쪽 모니터에서 띄워 로그인한다. ② 달력이 바탕화면에 붙어 다른 창 뒤에 있고, Win+D를 해도 남고, 작업 표시줄과 Alt+Tab에 없는지(D1). ③ 바탕화면 그림이 비치고 투명도를 바꿀 수 있는지(D2). ④ 여기서 고친 메모와 배경색이 아이폰에, 아이폰에서 고친 것이 5초 안에 여기에 보이는지(D3). ⑤ 위치 및 크기를 바꾸고 재부팅 뒤 같은 자리에 자동으로 뜨는지(D4, D5). ⑥ 트레이 메뉴, 숨기기, 내용 숨기기, 켠 단축키(D5). ⑦ 한글 입력기 후보 창의 자리(설계 12절). ⑧ 설정 네 쪽의 각 줄(D6). ⑨ 웹앱을 `npm run deploy`로 다시 배포하고 아이폰에서 달을 넘길 때 손가락을 따라오는지(D7).
