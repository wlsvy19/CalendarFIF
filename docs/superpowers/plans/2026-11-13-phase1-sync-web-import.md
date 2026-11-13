# CalendarFIF ① 단계: 동기화 코어, 웹앱, DesktopCal 가져오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC 브라우저와 아이폰 Safari에서 날짜별 메모, 완료 표시, 배경색을 양방향으로 동기화하는 웹앱과, DesktopCal 기록을 옮기고 따라가는 명령줄 도구를 만든다.

**Architecture:** 모든 규칙은 순수 함수로 된 코어(`src/core`: 날짜, 글, 색, 병합)에 둔다. 동기화 엔진(`src/sync`)은 편집을 기기 안 대기열에 넣고 달 문서 단위 트랜잭션으로 올리며, 저장소는 `MonthStore` 인터페이스 뒤에 둔다. 웹앱(`src/web`)은 Firebase 전체 SDK 어댑터와 실시간 구독을 쓰고, 가져오기 도구(`src/importer`)는 같은 병합 규칙과 Firestore Lite 어댑터를 쓴다.

**Tech Stack:** TypeScript 7, Node 24, Vite 8, Vitest 5(+ happy-dom), Firebase JS SDK 13(Firestore, Auth, Hosting), firebase-tools 15 에뮬레이터(Java 21 이상 필요), `node:sqlite`, tsx, vite-plugin-pwa 2. UI 프레임워크는 쓰지 않는다.

**Spec:** `docs/superpowers/specs/2026-11-13-calendar-sync-design.md`. 이 계획은 그 문서 9절의 ① 단계다. 화면 시안은 `docs/superpowers/specs/assets/iphone-webapp-mockup.html`(예시 데이터)이다.

## Global Constraints

- 비용 0원. Firebase 무료 요금제(Spark)만 쓴다. 결제 수단이 필요한 기능(Cloud Functions 등)을 쓰지 않는다.
- DesktopCal의 서버에 접속하지 않는다. 그 프로그램의 코드나 이미지를 가져다 쓰지 않는다. 읽는 것은 사용자 PC의 `calendar.db`뿐이다.
- `calendar.db` 원본에는 쓰지 않고 잠그지도 않는다. 파일을 복사해 복사본만 연다.
- 사용자의 `calendar.db`, 상태 파일, 로그인 정보, 실제 메모 내용을 저장소, 테스트 자료, 로그에 넣지 않는다. 테스트 자료는 지어낸 것만 쓴다. 로그에는 날짜와 건수만 적는다.
- 문서 경로는 `users/{uid}/months/{YYYY-MM}`이다. `days`의 키는 두 자리 날짜(`"01"`~`"31"`)다.
- `text`: 줄바꿈은 `\n`. 줄 끝 공백과 앞뒤 빈 줄은 저장하지 않는다. 가운데 빈 줄은 남긴다. 줄이 `[+]`로 시작하면 완료한 줄이다.
- `color`: 빈 문자열 또는 `#` 없는 대문자 RGB 16진수 6자리.
- `editedAt`: epoch 밀리초. `editedBy`: 짧은 기기 이름(`pc`, `iphone`, `import`).
- 내용도 배경색도 없는 날짜는 키를 지운다.
- 한 주는 일요일에 시작한다. 화면 문구는 한국어다. 밝은 화면과 어두운 화면, 좁은 화면(아이폰)과 넓은 화면(PC)을 모두 지원한다.
- 주소 뒤 `#YYYY-MM-DD`는 그 날짜의 편집 화면을 연다.
- 목표치: 다른 기기 반영 5초 이내, 따라가기 반영 1분 이내.
- 에뮬레이터 포트: Firestore 8085, Auth 9095. 에뮬레이터 프로젝트 ID는 `demo-calfif`, 시험용 소유자 uid는 `owner-test-uid`다.
- 브랜치는 `phase-1-sync-core`. `git add`는 경로를 적어서 한다. `.mcp.json`은 사용자 파일이므로 커밋하지 않는다. 커밋 메시지 끝에는 실행 세션의 지침에 있는 `Co-Authored-By` 줄을 붙인다.
- 도구 버전은 2026-11-13에 npm에서 확인한 최신이다(firebase 13.3, firebase-tools 15.36, vite 8.3, vitest 5.1, typescript 7.0). 이 계획의 설정 예와 설치된 버전의 문법이 다르면 설치된 버전의 타입 정의를 따른다.
- 테스트 코드는 이 계획에 적힌 대로 쓴다. 설치된 도구 버전 때문에 문법이나 타입 오류가 나면 단언의 뜻을 바꾸지 않는 최소한의 수정만 하고 보고서에 적는다.

## Review Focus

- 올리는 도중 연결이 끊기거나 트랜잭션이 실패한다 → 편집이 대기열에 남고 다음 기회에 올라간다. 사라지거나 두 번 들어가지 않는다. (Task 3)
- 같은 브라우저에서 탭 두 개가 같은 대기열을 쓴다 → 한 탭의 편집이 다른 탭의 저장 때문에 지워지지 않는다. (Task 3)
- 대기열 저장소가 깨졌거나 쓸 수 없다 → 앱이 열리고, 깨진 내용은 따로 보관하고, 사용자에게 알린다. (Task 3, Task 9)
- 잘못된 바로가기 주소(`#2026-02-30`, `#abc`)와 달 경계(12월에서 1월, 윤년 2월, 6주짜리 달) → 달력 화면으로 가거나 올바르게 그린다. (Task 1, Task 8)
- 가져오는 중에 DesktopCal이 파일을 쓰고 있거나, 복사본이 깨졌거나, 행 형식이 이상하거나, 올리다 끊긴다 → 깨진 자료를 올리지 않고, 건너뛴 행을 보고하고, 다시 돌리면 이어서 끝난다. (Task 10, Task 11)

## File Structure

| 경로 | 책임 |
|---|---|
| `src/core/types.ts` | 공용 타입 |
| `src/core/dates.ts` | 달·날짜 키, 달력 칸 계산 |
| `src/core/text.ts` | 글 다듬기, 줄과 완료 표시 |
| `src/core/color.ts` | 색 형식, 22색 팔레트 |
| `src/core/merge.ts` | 병합 규칙(설계 7절) |
| `src/sync/outbox.ts` | 기기 안 대기열 |
| `src/sync/engine.ts` | `MonthStore` 인터페이스, 올리기 |
| `src/sync/view.ts` | 서버 값 + 대기 편집 → 화면 값 |
| `src/sync/firestoreStore.ts` | 전체 SDK 어댑터, 실시간 구독 |
| `src/sync/testing.ts` | 테스트용 가짜 저장소와 도우미 |
| `src/web/*` | 웹앱(초기화, 상태, 주소, 화면) |
| `src/importer/*` | DesktopCal 읽기, 변환, 올리기, 따라가기, 명령줄 |
| `scripts/*` | 규칙 파일 생성, 에뮬레이터 실행, JDK 준비, 시험 계정 |
| `firestore.rules.template`, `firebase.json` | 보안 규칙 원본, Firebase 설정 |
| `tests/emulator/*` | 에뮬레이터가 필요한 테스트 |

단위 테스트는 대상 파일 옆에 `*.test.ts`로 둔다.

## 실행 메모

- 실행을 시작할 때 사용자에게 Task 13 Step 1(Firebase 프로젝트 준비)을 먼저 부탁한다. 개발은 에뮬레이터로 하므로 기다리지 않고 Task 1부터 진행한다.
- 프로젝트가 준비되면 Task 8의 마지막 확인 단계에서 회사 네트워크의 실시간 연결을 먼저 확인한다.
- "화면 확인" 단계는 실행자가 브라우저나 헤드리스 Edge 스크린샷으로 직접 보고 판단한다. 아이폰 확인은 Task 13에서 사용자가 한다.
- 임시 폴더에 둔 파일은 세션 도중 지워질 수 있다. 다시 필요한 것은 저장소 안(`.tools/`, `build/`)에 둔다.

---

### Task 1: 프로젝트 뼈대와 기본 규칙(날짜, 글, 색)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/core/types.ts`, `src/core/dates.ts`, `src/core/text.ts`, `src/core/color.ts`
- Test: `src/core/dates.test.ts`, `src/core/text.test.ts`, `src/core/color.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:

```ts
// src/core/types.ts (이 내용 그대로)
export type DayValue = { text: string; color: string };
export type DayRecord = { text: string; color: string; editedAt: number; editedBy: string };
export type MonthDoc = { days: Record<string, DayRecord> };
export type PendingEdit = { monthId: string; day: string; base: DayValue; next: DayValue; editedAt: number; sent?: true };   // sent: 올리기가 이 편집을 읽었다(Task 3 검토 반영)
export type DayChange = DayRecord | 'delete';
export const EMPTY_DAY: DayValue = { text: '', color: '' };

// src/core/dates.ts
export type GridCell = { dateKey: string; monthId: string; day: string; dayOfMonth: number; dow: number; inMonth: boolean };
export function monthIdOf(year: number, monthIndex: number): string;
export function dateKeyOf(monthId: string, day: string): string;
export function splitDateKey(dateKey: string): { monthId: string; day: string } | null;
export function shiftMonth(monthId: string, delta: number): string;
export function buildMonthGrid(monthId: string): GridCell[];
export function todayKey(now?: Date): string;

// src/core/text.ts
export function normalizeText(raw: string): string;
export function splitLines(text: string): string[];
export function parseLine(line: string): { done: boolean; text: string };
export function setLineDone(line: string, done: boolean): string;
export function toggleDoneInRange(text: string, selStart: number, selEnd: number): { text: string; selStart: number; selEnd: number };

// src/core/color.ts
export const PALETTE: readonly string[];
export function isColor(value: string): boolean;
export function normalizeColor(raw: string): string;
```

- [ ] **Step 1: 뼈대 만들기**

`package.json`: `"name": "calendarfif"`, `"private": true`, `"type": "module"`, scripts는 `"test": "vitest run --project unit --project dom"`, `"typecheck": "tsc --noEmit"`.

```bash
npm install firebase
npm install -D typescript vitest happy-dom tsx vite
```

npm이 설치 스크립트 승인 경고(`allow-scripts`)를 내도 그대로 진행한다.

`tsconfig.json`: `strict`, `noEmit`, 번들러 방식 모듈 해석, `target` ES2022, `lib`에 DOM 포함, `include`는 `src`, `scripts`, `tests`, 설정 파일.

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'], exclude: ['src/web/**'] } },
      { test: { name: 'dom', environment: 'happy-dom', include: ['src/web/**/*.test.ts'] } },
      { test: { name: 'emulator', environment: 'node', include: ['tests/emulator/**/*.test.ts'], testTimeout: 20000, fileParallelism: false } },
    ],
  },
});
```

`.gitignore`: `node_modules/`, `dist/`, `build/`, `.tools/`, `.superpowers/`, `.env.local`, `.firebaserc`, `.firebase/`, `*.log`, `*.db`, `coverage/`.

`.env.example`:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FORCE_LONG_POLLING=
OWNER_UID=
```

- [ ] **Step 2: `src/core/types.ts`를 위 Interfaces 내용 그대로 쓴다**

- [ ] **Step 3: 실패하는 테스트 쓰기**

```ts
// src/core/dates.test.ts
import { describe, expect, it } from 'vitest';
import { buildMonthGrid, dateKeyOf, monthIdOf, shiftMonth, splitDateKey, todayKey } from './dates';

describe('dates', () => {
  it('달과 날짜 키를 만든다', () => {
    expect(monthIdOf(2026, 10)).toBe('2026-11');
    expect(dateKeyOf('2026-11', '13')).toBe('2026-11-13');
    expect(todayKey(new Date(2026, 10, 13, 23, 59))).toBe('2026-11-13');
  });
  it('실제로 있는 날짜만 받아들인다', () => {
    expect(splitDateKey('2026-11-13')).toEqual({ monthId: '2026-11', day: '13' });
    expect(splitDateKey('2028-02-29')).toEqual({ monthId: '2028-02', day: '29' });
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', '2026-11-13x', 'abc', '']) {
      expect(splitDateKey(bad)).toBeNull();
    }
  });
  it('해를 넘겨 달을 옮긴다', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('일요일부터 시작하는 주 단위 칸을 만든다', () => {
    const nov = buildMonthGrid('2026-11');
    expect(nov).toHaveLength(35);
    expect(nov[0]).toMatchObject({ dateKey: '2026-11-01', day: '01', dayOfMonth: 1, dow: 0, inMonth: true });
    expect(nov[34]).toMatchObject({ dateKey: '2026-12-05', monthId: '2026-12', dow: 6, inMonth: false });
    expect(buildMonthGrid('2026-08')).toHaveLength(42);
    expect(buildMonthGrid('2026-08')[0]).toMatchObject({ dateKey: '2026-07-26', inMonth: false });
    expect(buildMonthGrid('2026-02')).toHaveLength(28);
  });
});
```

```ts
// src/core/text.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeText, parseLine, setLineDone, splitLines, toggleDoneInRange } from './text';

describe('text', () => {
  it('줄 끝 공백과 앞뒤 빈 줄을 없애고 가운데 빈 줄은 남긴다', () => {
    expect(normalizeText('a  \r\nb\t\r\n\r\n')).toBe('a\nb');
    expect(normalizeText('\n\n a\n\nb\n')).toBe(' a\n\nb');
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
  it('[+]로 시작하는 줄은 완료한 줄이다', () => {
    expect(parseLine('[+]장보기')).toEqual({ done: true, text: '장보기' });
    expect(parseLine('  [+]x')).toEqual({ done: true, text: 'x' });
    expect(parseLine('a[+]b')).toEqual({ done: false, text: 'a[+]b' });
    expect(setLineDone('장보기', true)).toBe('[+]장보기');
    expect(setLineDone('[+]장보기', false)).toBe('장보기');
    expect(setLineDone('[+]a', true)).toBe('[+]a');
  });
  it('선택한 줄들의 완료 표시를 바꾼다', () => {
    expect(toggleDoneInRange('a\nb\nc', 2, 2).text).toBe('a\n[+]b\nc');
    expect(toggleDoneInRange('a\n[+]b\nc', 0, 6).text).toBe('[+]a\n[+]b\nc');
    expect(toggleDoneInRange('[+]a\n[+]b', 0, 9).text).toBe('a\nb');
    expect(toggleDoneInRange('a\nb', 3, 3)).toEqual({ text: 'a\n[+]b', selStart: 6, selEnd: 6 });
  });
});
```

`toggleDoneInRange`의 규칙: 선택 범위가 걸친 줄 중 하나라도 미완료면 전부 완료로, 전부 완료면 전부 해제한다. 선택 위치는 같은 글자를 가리키도록 옮긴다.

```ts
// src/core/color.test.ts
import { expect, it } from 'vitest';
import { PALETTE, isColor, normalizeColor } from './color';

it('팔레트는 DesktopCal과 같은 22색이다', () => {
  expect(PALETTE).toEqual([
    'FF9595', 'F9BC0B', 'FBF078', 'CBFB91', 'B5CEF6', 'D7B1F9', 'E6C9A8',
    '282828', 'F12424', 'FF6821', 'F5D107', '009300', '3737F4', '4A0081', '61D2BA',
    '65C444', '90949D', 'FFD9E9', 'FAE3CE', 'CDF0EB', 'D9E8FF', 'D4CDF0',
  ]);
});
it('색은 빈 값이거나 대문자 6자리다', () => {
  expect(normalizeColor('#f12424')).toBe('F12424');
  expect(normalizeColor('')).toBe('');
  expect(normalizeColor('red')).toBe('');
  expect(isColor('F12424')).toBe(true);
  expect(isColor('')).toBe(true);
  expect(isColor('f12424')).toBe(false);
});
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run --project unit src/core`
Expected: FAIL. `./dates`, `./text`, `./color` 모듈을 찾지 못한다.

- [ ] **Step 5: `dates.ts`, `text.ts`, `color.ts`를 Interfaces의 시그니처대로 구현한다**

날짜 계산은 기기 현지 시각의 `Date`로 한다.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run --project unit src/core && npx tsc --noEmit`
Expected: 테스트 전부 PASS, 타입 오류 없음.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/core
git commit -m "feat: 프로젝트 뼈대와 날짜·글·색 기본 규칙"
```

---

### Task 2: 병합 규칙

**Files:**
- Create: `src/core/merge.ts`
- Test: `src/core/merge.test.ts`

**Interfaces:**
- Consumes: Task 1의 `DayValue`, `DayRecord`, `PendingEdit`, `DayChange`, `splitLines`
- Produces:

```ts
export function mergeText(base: string, mine: string, server: string): string;
export function mergeColor(base: string, mine: string, server: string, mineEditedAt: number, serverEditedAt: number): string;
/** null: 쓰지 않는다. 'delete': 날짜 키를 지운다. DayRecord: 이 값을 쓴다. */
export function resolveEdit(edit: PendingEdit, server: DayRecord | null, editedBy: string): DayChange | null;
```

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/core/merge.test.ts
import { describe, expect, it } from 'vitest';
import type { DayRecord, DayValue, PendingEdit } from './types';
import { mergeColor, mergeText, resolveEdit } from './merge';

const v = (text: string, color = ''): DayValue => ({ text, color });
const r = (text: string, color = '', editedAt = 5, editedBy = 'pc'): DayRecord => ({ text, color, editedAt, editedBy });
const E = (base: DayValue, next: DayValue, editedAt = 100): PendingEdit => ({ monthId: '2026-11', day: '13', base, next, editedAt });

describe('mergeText', () => {
  it.each([
    ['설계 문서의 예', 'A\nB', 'A\nB\nC', 'A\nB2', 'A\nB2\nC'],
    ['나만 고침', 'A', 'A\nX', 'A', 'A\nX'],
    ['서버만 고침', 'A', 'A', 'A\nY', 'A\nY'],
    ['양쪽이 다른 줄을 추가', 'A', 'A\nX', 'A\nY', 'A\nX\nY'],
    ['양쪽이 같은 줄을 추가', 'A', 'A\nX', 'A\nX', 'A\nX'],
    ['내가 지운 줄은 지워진다', 'A\nB\nC', 'A\nC', 'A\nB\nC\nD', 'A\nC\nD'],
    ['내가 지운 줄을 서버가 고쳤으면 서버 것이 남는다', 'A\nB', 'A', 'A\nB2', 'A\nB2'],
    ['같은 줄을 다르게 고치면 둘 다 남는다', 'A\nB', 'A\nB1', 'A\nB2', 'A\nB1\nB2'],
    ['같은 글의 줄은 개수로 센다', 'X\nX', 'X', 'X\nX\nY', 'X\nY'],
    ['빈 날짜에 양쪽이 적음', '', 'M', 'S', 'S\nM'],
    ['내가 다 지움', 'A\nB', '', 'A\nB\nC', 'C'],
    ['완료 표시와 글 수정이 겹침', 'A', '[+]A', 'A2', 'A2\n[+]A'],
    ['연달아 추가한 줄은 순서를 지킨다', 'A', 'A\nX\nY', 'A\nZ', 'A\nX\nY\nZ'],
  ])('%s', (_name, base, mine, server, expected) => {
    expect(mergeText(base, mine, server)).toBe(expected);
  });
});

describe('mergeColor', () => {
  it.each([
    ['나만 바꿈(시계와 무관)', '', 'F12424', '', 100, 999, 'F12424'],
    ['서버만 바꿈', '', '', '009300', 999, 100, '009300'],
    ['둘 다 바꿈, 내가 나중', '', 'F12424', '009300', 200, 100, 'F12424'],
    ['둘 다 바꿈, 서버가 나중', '', 'F12424', '009300', 100, 200, '009300'],
    ['둘 다 바꿈, 같은 시각이면 서버', '', 'F12424', '009300', 100, 100, '009300'],
  ])('%s', (_name, base, mine, server, mineAt, serverAt, expected) => {
    expect(mergeColor(base, mine, server, mineAt, serverAt)).toBe(expected);
  });
});

describe('resolveEdit', () => {
  it('서버가 이미 같은 값이면 쓰지 않는다', () => {
    expect(resolveEdit(E(v('A'), v('B')), r('B'), 'iphone')).toBeNull();
  });
  it('서버가 base와 같으면 next를 쓴다', () => {
    expect(resolveEdit(E(v('A'), v('B')), r('A'), 'iphone')).toEqual({ text: 'B', color: '', editedAt: 100, editedBy: 'iphone' });
    expect(resolveEdit(E(v(''), v('B')), null, 'pc')).toEqual({ text: 'B', color: '', editedAt: 100, editedBy: 'pc' });
  });
  it('달라졌으면 합치고 editedAt은 큰 쪽을 쓴다', () => {
    expect(resolveEdit(E(v('A\nB'), v('A\nB\nC'), 100), r('A\nB2', '', 300), 'iphone'))
      .toEqual({ text: 'A\nB2\nC', color: '', editedAt: 300, editedBy: 'iphone' });
  });
  it('한쪽은 배경색만, 다른 쪽은 메모만 고치면 둘 다 남는다', () => {
    expect(resolveEdit(E(v('A'), v('A', 'F12424'), 100), r('A\nB', '', 300), 'iphone'))
      .toEqual({ text: 'A\nB', color: 'F12424', editedAt: 300, editedBy: 'iphone' });
  });
  it('합친 결과가 서버와 같으면 쓰지 않는다', () => {
    expect(resolveEdit(E(v('A\nB'), v('A')), r('A\nC'), 'pc')).toBeNull();
  });
  it('내용과 색이 모두 비면 날짜를 지운다', () => {
    expect(resolveEdit(E(v('A', 'F12424'), v('', '')), r('A', 'F12424'), 'pc')).toBe('delete');
    expect(resolveEdit(E(v('A'), v('')), null, 'pc')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project unit src/core/merge.test.ts`
Expected: FAIL. `./merge` 모듈을 찾지 못한다.

- [ ] **Step 3: `src/core/merge.ts` 구현**

`mergeText`의 절차(시그니처와 테스트만으로 정해지지 않는 부분):

1. `mine`이 `base`와 같으면 `server`를, `server`가 `base`와 같으면 `mine`을 그대로 돌려준다.
2. 줄 목록 `B`, `M`, `S`를 만든다. 결과는 `S`의 사본에서 시작한다.
3. 내가 지운 줄 = `B`에서 `M`을 뺀 것(개수 기준). 각 줄을 결과에서 맨 앞에 나오는 것 하나만 지운다. 결과에 없으면 넘어간다.
4. 내가 추가한 줄 = `M`에서 `B`를 뺀 것(개수 기준)을 `M`에 나온 순서대로 본다. 서버가 추가한 줄(`S`에서 `B`를 뺀 것)에 같은 줄이 남아 있으면 그것을 하나 소진하고 넣지 않는다. 아니면 넣는다. 넣을 자리는 `M`에서 그 줄 바로 앞 줄이 결과에 있으면 그 줄(맨 앞에 나오는 것)의 바로 뒤, 없으면 맨 끝이다.
5. 결과를 `\n`으로 잇는다.

`mergeColor`: `mine`이 `base`와 같으면 `server`. `server`가 `base`와 같으면 `mine`. 둘 다 바뀌었으면 `mineEditedAt > serverEditedAt`일 때만 `mine`.

`resolveEdit`: 서버 값 `S`는 `server`가 없으면 `EMPTY_DAY`이고 시각은 0이다. `S`가 `next`와 같으면 `null`. `S`가 `base`와 같으면 `next`와 `edit.editedAt`. 그 밖에는 위 두 함수로 합치고 시각은 둘 중 큰 값. 합친 값이 `S`와 같으면 `null`. 글과 색이 모두 비면 `'delete'`.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --project unit src/core/merge.test.ts`
Expected: PASS (24개).

- [ ] **Step 5: Commit**

```bash
git add src/core/merge.ts src/core/merge.test.ts
git commit -m "feat: 줄 단위 메모 병합과 배경색 병합 규칙"
```

---

### Task 3: 대기열, 동기화 엔진, 화면 값 합성

**Files:**
- Create: `src/sync/outbox.ts`, `src/sync/engine.ts`, `src/sync/view.ts`, `src/sync/testing.ts`
- Test: `src/sync/outbox.test.ts`, `src/sync/engine.test.ts`, `src/sync/view.test.ts`

**Interfaces:**
- Consumes: Task 1의 타입과 `normalizeText`, `normalizeColor`. Task 2의 `resolveEdit`.
- Produces:

```ts
// src/sync/outbox.ts
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export class Outbox {
  constructor(storage: KeyValueStore, uid: string);      // 저장 키: `calfif.outbox.${uid}`
  readonly persistent: boolean;                           // 저장소에 쓸 수 없으면 false
  readonly corruptDetected: boolean;                      // 생성자가 저장소를 한 번 읽으므로 만들자마자 알 수 있다
  list(): PendingEdit[];                                  // 매번 저장소에서 새로 읽는다
  put(edit: PendingEdit): PendingEdit[];                  // 새 목록을 돌려준다
  markSent(monthId: string): PendingEdit[];               // 그 달의 편집에 sent 표시를 하고, 그 달의 편집을 대기열 순서로 돌려준다
  remove(sent: PendingEdit[]): PendingEdit[];             // sent 표시가 있고 monthId, day, editedAt이 같은 것만 지운다
}

// src/sync/engine.ts
export interface MonthStore {
  transactMonth(monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>): Promise<void>;
}
export type SyncStatus = { state: 'synced' | 'sending' | 'waiting'; pending: number };
export class SyncEngine {
  constructor(deps: { store: MonthStore; outbox: Outbox; editedBy: string; now?: () => number });
  saveEdit(monthId: string, day: string, base: DayValue, next: DayValue): void;
  flush(): Promise<void>;
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
}

// src/sync/view.ts
export function applyPending(monthId: string, server: MonthDoc | null, pending: PendingEdit[], editedBy: string): Record<string, DayValue>;

// src/sync/testing.ts (테스트 전용)
export class MemoryStorage implements KeyValueStore { data: Map<string, string>; failWrites: boolean }
export class FakeMonthStore implements MonthStore {
  constructor(docs?: Record<string, MonthDoc>);
  docs: Map<string, MonthDoc>;
  calls: string[];                       // transactMonth가 불린 monthId 순서
  failMonths: Set<string>;               // 이 달은 실패한다
  hold?: Promise<void>;                  // 있으면 decide를 부르기 전에 기다린다
  beforeSecondDecide?: () => void;       // 있으면 decide를 한 번 부르고 버린 뒤, 이것을 실행하고 다시 불러 적용한다
}
export const val: (text: string, color?: string) => DayValue;
export const rec: (text: string, color?: string, editedAt?: number, editedBy?: string) => DayRecord;   // 기본 editedAt 1, editedBy 'x'
export const edit: (monthId: string, day: string, baseText: string, nextText: string, editedAt?: number) => PendingEdit;   // 색은 '', 기본 editedAt 100
```

엔진의 동작:

- `saveEdit`는 `next`를 `normalizeText`, `normalizeColor`로 다듬는다. `base`와 같으면 아무것도 하지 않는다. 다르면 대기열에 넣고 `flush`를 시작한다.
- `put`의 합치기: 같은 `monthId`와 `day`의 마지막 항목이 아직 `sent`가 아니면 그 항목의 `base`는 두고 `next`와 `editedAt`만 바꾼다. 바꾼 뒤 `next`가 `base`와 같으면 항목을 뺀다. 그런 항목이 없거나 마지막 항목이 `sent`이면 새 편집을 자기 `base` 그대로 뒤에 붙인다. 올리기가 이미 읽은 편집은 서버에 들어갔을 수 있어서, 그 `base`로 합치면 되돌린 편집이 사라진다(Task 3 검토 반영).
- `flush`는 대기열이 빌 때까지 달 단위로 올린다. 달마다 `transactMonth`를 한 번 부른다. `decide`는 불릴 때마다 `markSent`로 그 달의 대기 편집을 새로 읽고, `src/core/merge.ts`의 `resolveEdits(edits, days, editedBy)`로 바꿀 값을 만든다. `resolveEdits`는 같은 날짜의 편집을 대기열 순서대로 이어서 적용한다(앞 편집의 결과가 다음 편집의 서버 값이 된다). `applyPending`도 같은 함수를 쓴다. 성공하면 마지막 `decide`에서 읽은 편집을 `remove`한다. 어떤 달이 실패하면 그 달은 두고 다른 달을 계속한다. 한 바퀴를 돌아도 더 보낸 것이 없으면 끝낸다.
- 동시에 불린 `flush`는 같은 실행을 함께 기다린다.
- `flush`는 마이크로태스크 한 번 뒤에 대기열을 읽기 시작한다. 같은 틱에 이어진 `saveEdit`들을 한 번에 묶기 위해서다.
- 상태: 올리는 동안 `sending`. 끝났을 때 대기열이 비었으면 `synced`, 남았으면 `waiting`.
- `Outbox`는 내용을 메모리에 캐시하지 않는다. 읽기와 쓰기 때마다 저장소를 본다. JSON이 깨져 있거나 배열의 항목 형식이 맞지 않으면 원문을 `${키}.corrupt.${시각}`에 옮기고 빈 목록으로 시작한다. 저장소 쓰기가 실패하면 그때부터 메모리 목록을 쓰고 `persistent`를 `false`로 둔다.

- [ ] **Step 1: `src/sync/testing.ts`를 Interfaces대로 쓴다**

- [ ] **Step 2: 실패하는 테스트 쓰기**

```ts
// src/sync/outbox.test.ts
import { expect, it } from 'vitest';
import { Outbox } from './outbox';
import { MemoryStorage, edit } from './testing';

const KEY = 'calfif.outbox.u1';

it('같은 날짜의 편집은 base를 두고 next와 editedAt만 바꾼다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  o.put(edit('2026-11', '13', 'A', 'A\nB', 100));
  o.put(edit('2026-11', '13', 'ignored', 'A\nB\nC', 200));
  expect(o.list()).toEqual([edit('2026-11', '13', 'A', 'A\nB\nC', 200)]);
});
it('base로 되돌린 편집은 대기열에서 빠진다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  o.put(edit('2026-11', '13', 'A', 'B', 100));
  o.put(edit('2026-11', '13', 'B', 'A', 200));
  expect(o.list()).toEqual([]);
});
it('탭 두 개가 같은 저장소를 써도 서로의 편집을 지우지 않는다', () => {
  const s = new MemoryStorage();
  const a = new Outbox(s, 'u1');
  const b = new Outbox(s, 'u1');
  a.put(edit('2026-11', '13', '', 'X'));
  b.put(edit('2026-11', '14', '', 'Y'));
  expect(a.list().map((e) => e.day)).toEqual(['13', '14']);
});
it('보낸 뒤 바뀌지 않은 편집만 지운다', () => {
  const o = new Outbox(new MemoryStorage(), 'u1');
  const sent = o.put(edit('2026-11', '13', 'A', 'B', 100));
  o.put(edit('2026-11', '13', 'A', 'C', 200));
  o.remove(sent);
  expect(o.list()).toEqual([edit('2026-11', '13', 'A', 'C', 200)]);
});
it('깨진 내용은 따로 보관하고 빈 대기열로 시작한다', () => {
  const s = new MemoryStorage();
  s.setItem(KEY, '{oops');
  const o = new Outbox(s, 'u1');
  expect(o.list()).toEqual([]);
  expect(o.corruptDetected).toBe(true);
  expect([...s.data].some(([k, value]) => k.startsWith(`${KEY}.corrupt.`) && value === '{oops')).toBe(true);
});
it('저장소에 쓸 수 없으면 메모리에 두고 알린다', () => {
  const s = new MemoryStorage();
  s.failWrites = true;
  const o = new Outbox(s, 'u1');
  o.put(edit('2026-11', '13', '', 'X'));
  expect(o.list()).toHaveLength(1);
  expect(o.persistent).toBe(false);
});
```

```ts
// src/sync/engine.test.ts
import { expect, it, vi } from 'vitest';
import type { MonthDoc } from '../core/types';
import { SyncEngine } from './engine';
import { Outbox } from './outbox';
import { FakeMonthStore, MemoryStorage, rec, val } from './testing';

function setup(docs: Record<string, MonthDoc> = {}) {
  const store = new FakeMonthStore(docs);
  const outbox = new Outbox(new MemoryStorage(), 'u1');
  let t = 1000;
  const engine = new SyncEngine({ store, outbox, editedBy: 'pc', now: () => t });
  return { store, outbox, engine, setNow: (n: number) => { t = n; } };
}

it('글을 다듬고, 바뀐 것이 없으면 아무것도 하지 않는다', async () => {
  const { store, outbox, engine } = setup();
  engine.saveEdit('2026-11', '13', val('A'), val('A  \r\n'));
  await engine.flush();
  expect(outbox.list()).toEqual([]);
  expect(store.calls).toEqual([]);
});
it('올리면 서버에 기록되고 대기열이 빈다', async () => {
  const { store, outbox, engine } = setup();
  const states: string[] = [];
  engine.subscribe((s) => states.push(s.state));
  engine.saveEdit('2026-11', '13', val(''), val('A', '#f12424'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13']).toEqual({ text: 'A', color: 'F12424', editedAt: 1000, editedBy: 'pc' });
  expect(outbox.list()).toEqual([]);
  expect(states).toContain('sending');
  expect(engine.status()).toEqual({ state: 'synced', pending: 0 });
});
it('달마다 트랜잭션을 한 번만 쓴다', async () => {
  const { store, engine } = setup();
  engine.saveEdit('2026-11', '13', val(''), val('A'));
  engine.saveEdit('2026-11', '14', val(''), val('B'));
  engine.saveEdit('2026-12', '01', val(''), val('C'));
  await Promise.all([engine.flush(), engine.flush()]);
  expect([...store.calls].sort()).toEqual(['2026-11', '2026-12']);
});
it('올리다 실패한 편집은 남고 다음에 다시 올라간다', async () => {
  const { store, outbox, engine } = setup({ '2026-12': { days: { '01': rec('A') } } });
  store.failMonths.add('2026-12');
  engine.saveEdit('2026-11', '13', val(''), val('X'));
  engine.saveEdit('2026-12', '01', val('A'), val('A\nB'));
  await engine.flush();
  expect(outbox.list().map((e) => e.monthId)).toEqual(['2026-12']);
  expect(engine.status()).toEqual({ state: 'waiting', pending: 1 });
  store.failMonths.clear();
  await engine.flush();
  expect(store.docs.get('2026-12')!.days['01'].text).toBe('A\nB');
  expect(engine.status()).toEqual({ state: 'synced', pending: 0 });
});
it('트랜잭션이 다시 실행되면 마지막 서버 값 기준으로 쓴다', async () => {
  const { store, engine } = setup({ '2026-11': { days: { '13': rec('A\nB') } } });
  store.beforeSecondDecide = () => { store.docs.set('2026-11', { days: { '13': rec('A\nB2', '', 300) } }); };
  engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB\nC'));
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB2\nC');
});
it('올리는 도중에 같은 날짜를 또 고쳐도 줄이 겹치지 않는다', async () => {
  const { store, engine, setNow } = setup({ '2026-11': { days: { '13': rec('A') } } });
  let release!: () => void;
  store.hold = new Promise<void>((resolve) => { release = resolve; });
  engine.saveEdit('2026-11', '13', val('A'), val('A\nB'));
  await vi.waitFor(() => expect(store.calls).toEqual(['2026-11']));   // 첫 올리기가 진행 중인 상태
  setNow(2000);
  engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB\nC'));
  store.hold = undefined;
  release();
  await engine.flush();
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A\nB\nC');
  expect(engine.status().pending).toBe(0);
});
```

```ts
// src/sync/view.test.ts
import { expect, it } from 'vitest';
import { applyPending } from './view';
import { edit, rec } from './testing';

it('서버 값에 대기 편집을 얹어 보여 준다', () => {
  const server = { days: { '13': rec('A'), '14': rec('Z', 'F12424') } };
  const pending = [edit('2026-11', '13', 'A', 'A\nB'), edit('2026-12', '01', '', 'other')];
  expect(applyPending('2026-11', server, pending, 'pc')).toEqual({
    '13': { text: 'A\nB', color: '' },
    '14': { text: 'Z', color: 'F12424' },
  });
});
it('서버 문서가 없어도 대기 편집은 보인다', () => {
  expect(applyPending('2026-11', null, [edit('2026-11', '13', '', 'X')], 'pc')).toEqual({ '13': { text: 'X', color: '' } });
});
it('지우는 편집이면 그 날짜가 빠진다', () => {
  expect(applyPending('2026-11', { days: { '13': rec('A') } }, [edit('2026-11', '13', 'A', '')], 'pc')).toEqual({});
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run --project unit src/sync`
Expected: FAIL. `./outbox`, `./engine`, `./view` 모듈을 찾지 못한다.

- [ ] **Step 4: `outbox.ts`, `engine.ts`, `view.ts`를 Interfaces와 "엔진의 동작"대로 구현한다**

`applyPending`은 서버의 각 날짜를 `{text, color}`로 옮긴 뒤, 그 달의 대기 편집마다 `resolveEdit` 결과를 적용한다(`null`이면 그대로, `'delete'`면 뺀다).

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run --project unit src/sync && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음.

- [ ] **Step 6: Commit**

```bash
git add src/sync
git commit -m "feat: 대기열과 동기화 엔진"
```

---

### Task 4: 보안 규칙과 에뮬레이터

**Files:**
- Create: `firestore.rules.template`, `firebase.json`, `scripts/build-rules.ts`, `scripts/jdk.ts`, `scripts/emu.ts`, `tests/emulator/env.ts`
- Modify: `package.json` (scripts, devDependencies)
- Test: `scripts/build-rules.test.ts`, `scripts/jdk.test.ts`, `tests/emulator/rules.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:

```ts
// scripts/build-rules.ts
export function buildRules(template: string, ownerUid: string): string;    // uid는 /^[A-Za-z0-9_-]{1,128}$/ 여야 한다(시험용 uid `owner-test-uid`에 `-`가 있다). 아니면 throw
// 명령줄: tsx scripts/build-rules.ts [--uid <uid>]  → build/firestore.rules. --uid가 없으면 .env.local의 OWNER_UID
//   --uid 없이 실행했는데 OWNER_UID가 비었거나 'owner-test-uid'이면 파일을 만들지 않고 이유를 알린 뒤 종료 코드 1로 끝난다(배포용 보호)

// scripts/jdk.ts
export function findJdkBin(toolsDir: string): string | null;                // `${toolsDir}/jdk-21/*/bin`에 java 실행 파일이 있으면 그 경로
// 명령줄: tsx scripts/jdk.ts  → 없으면 내려받아 .tools/jdk-21에 푼다

// scripts/emu.ts
// 명령줄: tsx scripts/emu.ts "<명령>"
//   시스템의 java가 21 이상이면 그대로, 아니면 findJdkBin('.tools')의 경로를 PATH 앞에 둔다.
//   둘 다 없으면 `npx tsx scripts/jdk.ts`를 먼저 실행하라고 알리고 종료 코드 1로 끝난다.
//   firebase emulators:exec --only firestore,auth --project demo-calfif "<명령>" 을 실행하고 그 종료 코드로 끝난다

// tests/emulator/env.ts
export const OWNER = 'owner-test-uid';
export function createEnv(): Promise<RulesTestEnvironment>;                  // 규칙은 buildRules(template, OWNER)
export function ownerDb(env: RulesTestEnvironment): Firestore;               // 호출할 때마다 새 기기
export function otherDb(env: RulesTestEnvironment): Firestore;               // uid 'someone-else'
export function anonDb(env: RulesTestEnvironment): Firestore;
```

`package.json` scripts 추가: `"rules:build": "tsx scripts/build-rules.ts"`, `"emu": "tsx scripts/emu.ts"`, `"test:emu": "tsx scripts/build-rules.ts --uid owner-test-uid && tsx scripts/emu.ts \"vitest run --project emulator\""`.

배경: firebase-tools 15는 Java 21 이상을 요구한다. 이 PC의 기본 Java는 17이고, 2026-11-13에 Java 17로는 에뮬레이터가 거부되고 Java 25로는 Firestore와 Auth 에뮬레이터가 뜨는 것을 확인했다. `scripts/jdk.ts`는 `https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip`(2026-11-13 접속 확인)을 내려받아 `.tools/jdk-21/`에 푼다. 압축은 Windows의 `tar -xf`로 푼다. curl로 받을 때는 `--ssl-no-revoke`를 붙인다.

- [ ] **Step 1: 도구 설치와 JDK 준비**

```bash
npm install -D firebase-tools @firebase/rules-unit-testing
```

`scripts/jdk.ts`를 쓰고 실행한다.

Run: `npx tsx scripts/jdk.ts`
Expected: `.tools/jdk-21/` 아래에 JDK가 풀리고, 찾은 `bin` 경로와 `java -version` 결과(21로 시작)가 출력된다.

- [ ] **Step 2: 실패하는 테스트 쓰기**

```ts
// scripts/build-rules.test.ts
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildRules } from './build-rules';

const template = readFileSync('firestore.rules.template', 'utf8');

it('uid를 규칙에 넣는다', () => {
  const rules = buildRules(template, 'abc123');
  expect(rules).toContain("'abc123'");
  expect(rules).not.toContain('__OWNER_UID__');
});
it('빈 uid나 이상한 uid는 거부한다', () => {
  expect(() => buildRules(template, '')).toThrow();
  expect(() => buildRules(template, "a' || true || '")).toThrow();
});
```

```ts
// scripts/jdk.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { findJdkBin } from './jdk';

it('풀어 둔 JDK의 bin 폴더를 찾는다', () => {
  const tools = mkdtempSync(join(tmpdir(), 'calfif-tools-'));
  expect(findJdkBin(tools)).toBeNull();
  const bin = join(tools, 'jdk-21', 'jdk-21.0.13+11', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'java.exe'), '');
  expect(findJdkBin(tools)).toBe(bin);
});
```

```ts
// tests/emulator/rules.test.ts
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import { OWNER, anonDb, createEnv, otherDb, ownerDb } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

const month = `users/${OWNER}/months/2026-11`;

it('소유자는 자기 달 문서를 읽고 쓴다', async () => {
  const db = ownerDb(env);
  await assertSucceeds(setDoc(doc(db, month), { days: {} }));
  await assertSucceeds(getDoc(doc(db, month)));
});
it('다른 계정은 소유자의 문서도 자기 문서도 쓰지 못한다', async () => {
  const db = otherDb(env);
  await assertFails(getDoc(doc(db, month)));
  await assertFails(setDoc(doc(db, 'users/someone-else/months/2026-11'), { days: {} }));
});
it('로그인하지 않으면 읽지 못한다', async () => {
  await assertFails(getDoc(doc(anonDb(env), month)));
});
it('달 형식이 아니거나 다른 경로면 소유자도 쓰지 못한다', async () => {
  const db = ownerDb(env);
  await assertFails(setDoc(doc(db, `users/${OWNER}/months/nov`), { days: {} }));
  await assertFails(setDoc(doc(db, `users/${OWNER}/notes/x`), { a: 1 }));
  await assertFails(getDoc(doc(db, 'other/x')));
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run --project unit scripts`
Expected: FAIL. `./build-rules` 모듈과 `firestore.rules.template` 파일이 없다.

- [ ] **Step 4: 규칙과 스크립트 작성**

`firestore.rules.template`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/months/{monthId} {
      allow read, write: if request.auth != null
        && request.auth.uid == uid
        && uid == '__OWNER_UID__'
        && monthId.matches('^[0-9]{4}-[0-9]{2}$');
    }
  }
}
```

`firebase.json`: `firestore.rules`는 `build/firestore.rules`. `hosting.public`은 `dist`. 에뮬레이터는 firestore 8085, auth 9095, UI는 끈다.

`scripts/build-rules.ts`, `scripts/emu.ts`, `tests/emulator/env.ts`를 Interfaces대로 쓴다. `createEnv`는 `initializeTestEnvironment`에 `projectId: 'demo-calfif'`와 규칙 본문을 직접 넘기고, 호스트와 포트는 환경 변수 `FIRESTORE_EMULATOR_HOST`에서 읽는다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run --project unit scripts && npm run test:emu`
Expected: 단위 테스트 PASS. 에뮬레이터가 뜨고 `rules.test.ts`의 4개가 PASS한 뒤 에뮬레이터가 내려간다.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules.template firebase.json scripts tests/emulator package.json package-lock.json
git commit -m "feat: 소유자 한 명만 허용하는 보안 규칙과 에뮬레이터 실행 스크립트"
```

---

### Task 5: Firestore 어댑터와 두 기기 동기화 시험

**Files:**
- Create: `src/sync/monthDoc.ts`, `src/sync/firestoreStore.ts`
- Test: `src/sync/monthDoc.test.ts`, `tests/emulator/firestoreStore.test.ts`, `tests/emulator/twoDevices.test.ts`

**Interfaces:**
- Consumes: Task 3의 `MonthStore`, `SyncEngine`, `Outbox`, `MemoryStorage`, `rec`, `val`. Task 4의 `createEnv`, `ownerDb`, `OWNER`.
- Produces:

```ts
// src/sync/monthDoc.ts (Firebase를 가져오지 않는 순수 함수. 가져오기 도구도 쓴다)
export function parseMonthDoc(data: unknown): MonthDoc;     // 형식이 맞지 않는 날짜는 버리고, 빠진 필드는 '' 또는 0으로 채운다
/** 달 문서에 병합해 쓸 내용을 만든다. 바꿀 것이 없으면 null. 'delete'는 sentinels.deleteField()로 바뀐다. */
export function buildMonthPatch(
  changes: Record<string, DayChange>,
  sentinels: { deleteField(): unknown; serverTimestamp(): unknown },
): { days: Record<string, unknown>; updatedAt: unknown } | null;

// src/sync/firestoreStore.ts
import type { DocumentReference, Firestore } from 'firebase/firestore';

export function monthDocRef(db: Firestore, uid: string, monthId: string): DocumentReference;
export class FirestoreMonthStore implements MonthStore {
  constructor(db: Firestore, uid: string);
  transactMonth(monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>): Promise<void>;
  subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void): () => void;
}
```

`transactMonth`는 `runTransaction` 안에서 문서를 읽고 `decide`를 부른다. 쓸 내용은 `buildMonthPatch`로 만든다. `null`이면 쓰지 않는다. 있으면 `set(..., { merge: true })`로 쓴다. 이렇게 하면 `days`의 해당 날짜만 바뀌고 `updatedAt`에 서버 시각이 들어간다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/sync/monthDoc.test.ts
import { expect, it } from 'vitest';
import { buildMonthPatch } from './monthDoc';
import { rec } from './testing';

const sentinels = { deleteField: () => 'DEL', serverTimestamp: () => 'NOW' };

it('바꿀 것이 없으면 null이다', () => {
  expect(buildMonthPatch({}, sentinels)).toBeNull();
});
it('쓸 날짜와 지울 날짜를 한 번에 담는다', () => {
  expect(buildMonthPatch({ '13': rec('A', 'F12424', 100, 'pc'), '14': 'delete' }, sentinels)).toEqual({
    days: { '13': { text: 'A', color: 'F12424', editedAt: 100, editedBy: 'pc' }, '14': 'DEL' },
    updatedAt: 'NOW',
  });
});
```

```ts
// tests/emulator/firestoreStore.test.ts
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { MonthDoc } from '../../src/core/types';
import { FirestoreMonthStore, monthDocRef } from '../../src/sync/firestoreStore';
import { parseMonthDoc } from '../../src/sync/monthDoc';
import { rec } from '../../src/sync/testing';
import { OWNER, createEnv, ownerDb } from './env';

let env: RulesTestEnvironment;
let db: Firestore;
let store: FirestoreMonthStore;
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => {
  await env.clearFirestore();
  db = ownerDb(env);
  store = new FirestoreMonthStore(db, OWNER);
});
afterAll(async () => { await env.cleanup(); });

const snap = (monthId: string) => getDoc(monthDocRef(db, OWNER, monthId));

it('없는 달 문서에 날짜를 쓰면 문서가 생긴다', async () => {
  await store.transactMonth('2026-11', (server) => {
    expect(server).toBeNull();
    return { '13': rec('A', 'F12424', 100, 'pc') };
  });
  const data = (await snap('2026-11')).data()!;
  expect(data.days['13']).toEqual({ text: 'A', color: 'F12424', editedAt: 100, editedBy: 'pc' });
  expect(data.updatedAt).toBeDefined();
});
it('delete는 그 날짜만 지운다', async () => {
  await store.transactMonth('2026-11', () => ({ '13': rec('A'), '14': rec('B') }));
  await store.transactMonth('2026-11', (server) => {
    expect(Object.keys(server!.days).sort()).toEqual(['13', '14']);
    return { '13': 'delete' };
  });
  expect(Object.keys((await snap('2026-11')).data()!.days)).toEqual(['14']);
});
it('바꿀 것이 없으면 문서를 만들지 않는다', async () => {
  await store.transactMonth('2026-11', () => ({}));
  expect((await snap('2026-11')).exists()).toBe(false);
});
it('형식이 다른 문서도 읽는다', () => {
  expect(parseMonthDoc(undefined)).toEqual({ days: {} });
  expect(parseMonthDoc({ days: { '13': { text: 'A' }, '14': 'x' } }))
    .toEqual({ days: { '13': { text: 'A', color: '', editedAt: 0, editedBy: '' } } });
});
it('다른 기기가 쓴 내용이 5초 안에 구독자에게 온다', async () => {
  const other = new FirestoreMonthStore(ownerDb(env), OWNER);
  const seen: (MonthDoc | null)[] = [];
  const stop = store.subscribeMonth('2026-11', (doc) => seen.push(doc));
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  expect(seen[0]).toBeNull();
  const started = Date.now();
  await other.transactMonth('2026-11', () => ({ '13': rec('A') }));
  await vi.waitFor(() => expect(seen.at(-1)?.days['13']?.text).toBe('A'), { timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
  stop();
});
```

```ts
// tests/emulator/twoDevices.test.ts
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { DayChange, MonthDoc } from '../../src/core/types';
import { SyncEngine, type MonthStore } from '../../src/sync/engine';
import { FirestoreMonthStore } from '../../src/sync/firestoreStore';
import { Outbox } from '../../src/sync/outbox';
import { MemoryStorage, rec, val } from '../../src/sync/testing';
import { OWNER, createEnv, ownerDb } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => { env = await createEnv(); });
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

function device(name: string) {
  const real = new FirestoreMonthStore(ownerDb(env), OWNER);
  const net = { online: true };
  const store: MonthStore = {
    transactMonth: (monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>) =>
      net.online ? real.transactMonth(monthId, decide) : Promise.reject(new Error('offline')),
  };
  const engine = new SyncEngine({ store, outbox: new Outbox(new MemoryStorage(), OWNER), editedBy: name });
  return { real, net, engine };
}

it('오프라인에서 추가한 줄과 다른 기기의 수정이 합쳐진다', async () => {
  const pc = device('pc');
  const phone = device('iphone');
  await pc.real.transactMonth('2026-11', () => ({ '13': rec('A\nB', '', 1, 'pc') }));

  phone.net.online = false;
  phone.engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB\nC'));
  await phone.engine.flush();
  expect(phone.engine.status()).toEqual({ state: 'waiting', pending: 1 });

  pc.engine.saveEdit('2026-11', '13', val('A\nB'), val('A\nB2'));
  await pc.engine.flush();

  phone.net.online = true;
  await phone.engine.flush();

  let final: MonthDoc | null = null;
  await pc.real.transactMonth('2026-11', (server) => { final = server; return {}; });
  expect(final!.days['13'].text).toBe('A\nB2\nC');
  expect(phone.engine.status()).toEqual({ state: 'synced', pending: 0 });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project unit src/sync/monthDoc.test.ts; npm run test:emu`
Expected: 둘 다 FAIL. `src/sync/firestoreStore`, `src/sync/monthDoc` 모듈을 찾지 못한다.

- [ ] **Step 3: `src/sync/monthDoc.ts`와 `src/sync/firestoreStore.ts`를 Interfaces대로 구현한다**

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --project unit src/sync && npm run test:emu && npx tsc --noEmit`
Expected: 단위 테스트와 `rules`, `firestoreStore`, `twoDevices` 전부 PASS. 타입 오류 없음.

- [ ] **Step 5: Commit**

```bash
git add src/sync/monthDoc.ts src/sync/monthDoc.test.ts src/sync/firestoreStore.ts tests/emulator
git commit -m "feat: Firestore 달 문서 어댑터와 두 기기 동기화 시험"
```

---

### Task 6: 웹앱 뼈대와 로그인

**Files:**
- Create: `index.html`, `vite.config.ts`, `.env.emulator`, `scripts/seed-emulator.ts`, `scripts/shot.ts`
- Create: `src/web/main.ts`, `src/web/firebase.ts`, `src/web/app.ts`, `src/web/device.ts`, `src/web/autoFlush.ts`, `src/web/ui/login.ts`, `src/web/styles.css`
- Modify: `package.json` (scripts)
- Test: `src/web/device.test.ts`, `src/web/autoFlush.test.ts`, `src/web/ui/login.test.ts`, `src/web/app.test.ts`

**Interfaces:**
- Consumes: Task 3의 `SyncEngine`, `Outbox`. Task 5의 `FirestoreMonthStore`.
- Produces:

```ts
// src/web/device.ts
export function deviceLabel(userAgent: string): 'iphone' | 'pc';             // iPhone 또는 iPad면 'iphone'

// src/web/firebase.ts
export type FirebaseHandles = { auth: Auth; db: Firestore };
export function initFirebase(env: Record<string, string | undefined>): FirebaseHandles;

// src/web/autoFlush.ts
export function startAutoFlush(engine: { flush(): Promise<void>; status(): SyncStatus }, target: EventTarget, doc: { visibilityState: string }, retryMs?: number): () => void;

// src/web/ui/login.ts
export function loginErrorMessage(code: string): string;
export function mountLogin(root: HTMLElement, props: { signIn(email: string, password: string): Promise<void> }): { destroy(): void };

// src/web/app.ts
export type Session = { uid: string; email: string };
export type AppDeps = {
  root: HTMLElement;
  onAuthChange(listener: (session: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  mountMain(root: HTMLElement, session: Session): { destroy(): void };       // Task 7에서 달력을 건다
};
export function createApp(deps: AppDeps): { destroy(): void };
```

정해 둔 값:

- `initFirebase`: 앱 설정은 `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`에서 읽는다. Firestore는 기기 안 영구 캐시(여러 탭 지원)와 롱폴링 자동 감지를 켠다. `VITE_FORCE_LONG_POLLING`이 `1`이면 롱폴링을 강제한다. `VITE_USE_EMULATOR`가 `1`이면 Firestore `127.0.0.1:8085`, Auth `http://127.0.0.1:9095` 에뮬레이터에 붙는다.
- `.env.emulator`: `VITE_USE_EMULATOR=1`, `VITE_FIREBASE_PROJECT_ID=demo-calfif`, 나머지 키는 `demo`.
- `scripts/seed-emulator.ts`: Auth 에뮬레이터에 uid `owner-test-uid`, 이메일 `test@example.com`, 비밀번호 `test-password` 계정을 만든다. 이미 있으면 넘어간다.
- 화면 확인용 자동 로그인: `VITE_USE_EMULATOR`가 `1`이고 주소에 `?autologin=1`이 있으면 `main.ts`가 위 시험 계정으로 로그인한다. 에뮬레이터 모드가 아니면 이 주소 인자를 무시한다.
- `scripts/shot.ts`: 화면 확인용 스크린샷 도구다. 헤드리스 Edge(`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`)를 원격 디버깅 포트로 띄우고 DevTools 프로토콜로 조작한다(Node 내장 `WebSocket` 사용, 추가 패키지 없음). 사용법: `npx tsx scripts/shot.ts --url <주소> --out <png 경로> [--size 402x874] [--scheme light|dark] [--wait 3000] [--eval "<페이지에서 실행할 JS>"]`. 화면 크기와 `prefers-color-scheme`을 맞추고, 주소를 열고, `--wait` 밀리초 기다린 뒤(`--eval`이 있으면 실행하고 500ms 더 기다린 뒤) PNG를 저장하고 Edge를 끈다. Edge 프로필은 `.tools/edge-profile`에 둔다. 스크린샷은 `build/shots/`에 저장한다.
- `package.json` scripts: `"dev": "vite"`, `"build": "tsc --noEmit && vite build"`, `"dev:emu": "tsx scripts/build-rules.ts --uid owner-test-uid && tsx scripts/emu.ts \"tsx scripts/seed-emulator.ts && vite --mode emulator\""`.
- `startAutoFlush`: 시작할 때 `flush`를 한 번 부른다(앱을 열 때 올리기). `target`의 `online` 이벤트와 `visibilitychange`(보이게 될 때)에서 `flush`를 부른다. `retryMs`(기본 15000)마다 대기 건수가 있으면 `flush`를 부른다. 돌려주는 함수는 전부 해제한다.
- 로그인 오류 문구:

| 코드 | 문구 |
|---|---|
| `auth/invalid-credential`, `auth/wrong-password`, `auth/user-not-found`, `auth/invalid-email` | 이메일 또는 비밀번호가 맞지 않습니다. |
| `auth/network-request-failed` | 네트워크에 연결할 수 없습니다. |
| `auth/too-many-requests` | 시도가 너무 많습니다. 잠시 뒤 다시 해 주세요. |
| 그 밖 | 로그인하지 못했습니다. (`<코드>`) |

- `styles.css`의 색·글꼴 토큰과 치수는 시안 파일의 `:root` 블록과 `.app`, `.grid`, `.cell`, `.sheet` 규칙에서 가져온다. 시안의 아이폰 테두리(`.device`, `.statusbar`, `.island`, `.homebar`)와 설명 글은 가져오지 않는다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/web/device.test.ts
import { expect, it } from 'vitest';
import { deviceLabel } from './device';

it('아이폰과 PC를 구분한다', () => {
  expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('iphone');
  expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0')).toBe('pc');
});
```

```ts
// src/web/autoFlush.test.ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startAutoFlush } from './autoFlush';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('시작할 때, 온라인으로 돌아올 때, 화면이 다시 보일 때, 대기 건이 있을 때 올린다', () => {
  let pending = 0;
  const engine = { flush: vi.fn(async () => {}), status: () => ({ state: 'waiting' as const, pending }) };
  const target = new EventTarget();
  const doc = { visibilityState: 'hidden' };
  const stop = startAutoFlush(engine, target, doc, 15000);
  expect(engine.flush).toHaveBeenCalledTimes(1);

  target.dispatchEvent(new Event('online'));
  expect(engine.flush).toHaveBeenCalledTimes(2);
  target.dispatchEvent(new Event('visibilitychange'));
  expect(engine.flush).toHaveBeenCalledTimes(2);
  doc.visibilityState = 'visible';
  target.dispatchEvent(new Event('visibilitychange'));
  expect(engine.flush).toHaveBeenCalledTimes(3);

  vi.advanceTimersByTime(15000);
  expect(engine.flush).toHaveBeenCalledTimes(3);
  pending = 1;
  vi.advanceTimersByTime(15000);
  expect(engine.flush).toHaveBeenCalledTimes(4);

  stop();
  target.dispatchEvent(new Event('online'));
  vi.advanceTimersByTime(60000);
  expect(engine.flush).toHaveBeenCalledTimes(4);
});
```

```ts
// src/web/ui/login.test.ts
import { expect, it, vi } from 'vitest';
import { loginErrorMessage, mountLogin } from './login';

const fill = (root: HTMLElement, email: string, password: string) => {
  root.querySelector<HTMLInputElement>('input[type="email"]')!.value = email;
  root.querySelector<HTMLInputElement>('input[type="password"]')!.value = password;
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
};

it('오류 코드를 한국어 문구로 바꾼다', () => {
  expect(loginErrorMessage('auth/invalid-credential')).toBe('이메일 또는 비밀번호가 맞지 않습니다.');
  expect(loginErrorMessage('auth/network-request-failed')).toBe('네트워크에 연결할 수 없습니다.');
  expect(loginErrorMessage('auth/too-many-requests')).toBe('시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.');
  expect(loginErrorMessage('auth/other')).toBe('로그인하지 못했습니다. (auth/other)');
});
it('입력한 값으로 로그인을 부르고, 실패하면 문구를 보여 준다', async () => {
  const root = document.createElement('div');
  const signIn = vi.fn().mockRejectedValue({ code: 'auth/invalid-credential' });
  mountLogin(root, { signIn });
  fill(root, 'me@example.com', 'pw');
  expect(signIn).toHaveBeenCalledWith('me@example.com', 'pw');
  expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')!.textContent).toBe('이메일 또는 비밀번호가 맞지 않습니다.'));
  expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
});
```

```ts
// src/web/app.test.ts
import { expect, it, vi } from 'vitest';
import { createApp, type Session } from './app';

it('로그인 상태에 따라 로그인 화면과 본 화면을 바꾼다', () => {
  const root = document.createElement('div');
  let emit!: (session: Session | null) => void;
  const destroyMain = vi.fn();
  const mountMain = vi.fn((el: HTMLElement) => { el.textContent = 'main'; return { destroy: destroyMain }; });
  createApp({ root, onAuthChange: (listener) => { emit = listener; return () => {}; }, signIn: vi.fn(), signOut: vi.fn(), mountMain });

  emit(null);
  expect(root.querySelector('form')).not.toBeNull();
  emit({ uid: 'u1', email: 'me@example.com' });
  expect(mountMain).toHaveBeenCalledTimes(1);
  expect(root.querySelector('form')).toBeNull();
  emit(null);
  expect(destroyMain).toHaveBeenCalledTimes(1);
  expect(root.querySelector('form')).not.toBeNull();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project dom`
Expected: FAIL. `./device`, `./autoFlush`, `./login`, `./app` 모듈을 찾지 못한다.

- [ ] **Step 3: 구현**

Interfaces와 "정해 둔 값"대로 쓴다. `index.html`은 `lang="ko"`, `viewport-fit=cover` 뷰포트, `#app` 루트, `src/web/main.ts` 모듈 스크립트를 갖는다. `main.ts`는 `initFirebase(import.meta.env)`로 초기화하고, `onAuthStateChanged`를 `onAuthChange`에, `signInWithEmailAndPassword`와 `signOut`을 넘겨 `createApp`을 부른다. 이 Task에서 `mountMain`은 이메일과 로그아웃 버튼만 보이는 임시 화면이다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --project dom && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음.

- [ ] **Step 5: 에뮬레이터로 화면 확인**

Run: `npm run dev:emu`를 백그라운드로 띄우고, `scripts/shot.ts`로 `http://localhost:5173/`과 `http://localhost:5173/?autologin=1`을 402x874, 밝은 화면과 어두운 화면으로 찍어 PNG를 열어 본다. 끝나면 띄운 프로세스를 끈다.
Expected: 첫 주소는 로그인 화면이다(이메일 칸, 비밀번호 칸, 로그인 버튼). 둘째 주소는 임시 화면이고 `test@example.com`이 보인다. 글자가 잘리거나 겹치지 않는다.

- [ ] **Step 6: Commit**

```bash
git add index.html vite.config.ts .env.emulator scripts/seed-emulator.ts scripts/shot.ts src/web package.json package-lock.json
git commit -m "feat: 웹앱 뼈대와 이메일 로그인"
```

---

### Task 7: 달력 화면

**Files:**
- Create: `src/web/state.ts`, `src/web/ui/calendar.ts`, `src/web/ui/status.ts`
- Modify: `src/web/main.ts`, `src/web/styles.css`
- Test: `src/web/state.test.ts`, `src/web/ui/calendar.test.ts`, `src/web/ui/status.test.ts`

**Interfaces:**
- Consumes: Task 1의 `buildMonthGrid`, `shiftMonth`, `todayKey`, `parseLine`, `splitLines`. Task 3의 `applyPending`, `Outbox`, `SyncEngine`, `SyncStatus`. Task 5의 `FirestoreMonthStore.subscribeMonth`.
- Produces:

```ts
// src/web/state.ts
export type MonthSource = { subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void): () => void };
export class CalendarStore {
  constructor(deps: { source: MonthSource; outbox: Outbox; editedBy: string; initialMonth: string });
  current(): string;
  show(monthId: string): void;                        // 그 달과 앞뒤 달을 구독하고 나머지는 해제한다
  days(monthId: string): Record<string, DayValue>;    // applyPending(서버 값, 대기 편집)
  refresh(): void;                                    // 대기열이 바뀌었을 때 부른다
  onChange(listener: () => void): () => void;
  destroy(): void;
}

// src/web/ui/status.ts
export function statusText(status: SyncStatus): string;

// src/web/ui/calendar.ts
export function visibleLines(lines: string[], maxLines: number): { shown: string[]; more: number };
export function mountCalendar(root: HTMLElement, deps: {
  store: CalendarStore;
  status: { status(): SyncStatus; subscribe(listener: (s: SyncStatus) => void): () => void };
  today(): string;                                    // 'YYYY-MM-DD'
  onOpenDay(dateKey: string): void;
  onOpenSettings(): void;
}): { destroy(): void };
```

정해 둔 값:

- 상태 문구: `synced` → `동기화됨`, `sending` → `올리는 중`, `waiting` → `오프라인 (대기 n건)`.
- `visibleLines`: 줄 수가 `maxLines` 이하이면 전부 보이고 `more`는 0. 넘으면 앞의 `maxLines - 1`줄만 보이고 나머지 개수가 `more`다.
- 칸에 들어가는 줄 수는 칸 높이를 재서 정한다. 높이가 0으로 재지면(테스트 환경처럼 배치가 없을 때) 줄 수를 제한하지 않는다.
- 칸의 DOM: 칸은 `button.cell`이고 `data-key`에 날짜 키를 둔다. 일요일은 `sun`, 토요일은 `sat`, 다른 달 날짜는 `other`, 오늘은 `today` 클래스를 갖는다. 배경색이 있으면 `data-color`에 값을 두고 CSS 변수 `--day-color`에 `#RRGGBB`를 준다. 메모 줄은 `.ln`이고 완료한 줄은 `.ln.done`이며 `[+]` 없이 글만 보인다. 넘친 줄 수는 `.ln.more`에 `+n`으로 적는다.
- 배경색은 `color-mix`로 표면색과 섞어 옅게 깐다. 섞는 비율은 밝은 화면 38%, 어두운 화면 45%에서 시작해 글자가 읽히는지 화면으로 확인하고 조정한다.
- 머리글: 연도(`2026년`), 달(`11월`), 상태 문구, `오늘` 버튼, 이전 달과 다음 달 버튼(`aria-label`은 `이전 달`, `다음 달`), 설정 버튼(`aria-label`은 `설정`).
- 좌우로 44px 넘게 밀면 달을 넘긴다. 세로 움직임이 더 크면 넘기지 않는다.
- 좁은 화면(880px 미만)은 시안과 같다. 넓은 화면은 달력이 창 전체를 채우고 칸 글자는 13px, 줄 높이는 17px이다.
- `main.ts`는 로그인 뒤 `FirestoreMonthStore`, `Outbox(localStorage, uid)`, `SyncEngine`, `CalendarStore`를 만들고 `startAutoFlush`를 건다. 다른 탭이 대기열을 바꾸면(`storage` 이벤트) `store.refresh()`를 부른다. 엔진 상태가 바뀔 때도 `store.refresh()`를 부른다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/web/ui/status.test.ts
import { expect, it } from 'vitest';
import { statusText } from './status';

it('동기화 상태를 문구로 바꾼다', () => {
  expect(statusText({ state: 'synced', pending: 0 })).toBe('동기화됨');
  expect(statusText({ state: 'sending', pending: 1 })).toBe('올리는 중');
  expect(statusText({ state: 'waiting', pending: 2 })).toBe('오프라인 (대기 2건)');
});
```

```ts
// src/web/state.test.ts
import { expect, it, vi } from 'vitest';
import type { MonthDoc } from '../core/types';
import { Outbox } from '../sync/outbox';
import { MemoryStorage, edit, rec } from '../sync/testing';
import { CalendarStore } from './state';

function fakeSource() {
  const listeners = new Map<string, (doc: MonthDoc | null) => void>();
  return {
    listeners,
    subscribeMonth(monthId: string, listener: (doc: MonthDoc | null) => void) {
      listeners.set(monthId, listener);
      return () => { listeners.delete(monthId); };
    },
  };
}

it('보는 달과 앞뒤 달만 구독한다', () => {
  const source = fakeSource();
  const store = new CalendarStore({ source, outbox: new Outbox(new MemoryStorage(), 'u1'), editedBy: 'pc', initialMonth: '2026-11' });
  expect([...source.listeners.keys()].sort()).toEqual(['2026-10', '2026-11', '2026-12']);
  store.show('2026-12');
  expect(store.current()).toBe('2026-12');
  expect([...source.listeners.keys()].sort()).toEqual(['2026-11', '2026-12', '2027-01']);
});
it('서버 값에 대기 편집을 얹고, 바뀌면 알린다', () => {
  const source = fakeSource();
  const outbox = new Outbox(new MemoryStorage(), 'u1');
  const store = new CalendarStore({ source, outbox, editedBy: 'pc', initialMonth: '2026-11' });
  const changed = vi.fn();
  store.onChange(changed);
  source.listeners.get('2026-11')!({ days: { '13': rec('A') } });
  expect(changed).toHaveBeenCalledTimes(1);
  outbox.put(edit('2026-11', '13', 'A', 'A\nB'));
  store.refresh();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(store.days('2026-11')).toEqual({ '13': { text: 'A\nB', color: '' } });
  expect(store.days('2026-10')).toEqual({});
});
```

```ts
// src/web/ui/calendar.test.ts
import { expect, it, vi } from 'vitest';
import type { DayValue } from '../../core/types';
import type { SyncStatus } from '../../sync/engine';
import type { CalendarStore } from '../state';
import { mountCalendar, visibleLines } from './calendar';

function fakeStore(days: Record<string, DayValue>) {
  let month = '2026-11';
  return {
    current: () => month,
    show: vi.fn((m: string) => { month = m; }),
    days: (m: string) => (m === '2026-11' ? days : {}),
    onChange: () => () => {},
  } as unknown as CalendarStore & { show: ReturnType<typeof vi.fn> };
}
function mount(days: Record<string, DayValue> = {}, status: SyncStatus = { state: 'synced', pending: 0 }) {
  const root = document.createElement('div');
  const store = fakeStore(days);
  const onOpenDay = vi.fn();
  mountCalendar(root, { store, status: { status: () => status, subscribe: () => () => {} }, today: () => '2026-11-13', onOpenDay, onOpenSettings: vi.fn() });
  return { root, store, onOpenDay };
}
const cell = (root: HTMLElement, key: string) => root.querySelector<HTMLElement>(`.cell[data-key="${key}"]`)!;

it('칸에 들어가는 만큼만 줄을 보여 준다', () => {
  expect(visibleLines(['a', 'b'], 3)).toEqual({ shown: ['a', 'b'], more: 0 });
  expect(visibleLines(['a', 'b', 'c', 'd'], 3)).toEqual({ shown: ['a', 'b'], more: 2 });
  expect(visibleLines(['a', 'b', 'c'], 1)).toEqual({ shown: [], more: 3 });
});
it('한 달을 그린다', () => {
  const { root } = mount({ '13': { text: '회의\n[+]장보기', color: 'F12424' } });
  expect(root.querySelectorAll('.cell')).toHaveLength(35);
  expect(root.textContent).toContain('2026년');
  expect(root.textContent).toContain('11월');
  expect(root.textContent).toContain('동기화됨');
  const day = cell(root, '2026-11-13');
  expect(day.classList.contains('today')).toBe(true);
  expect(day.dataset.color).toBe('F12424');
  expect(day.style.getPropertyValue('--day-color')).toBe('#F12424');
  const lines = [...day.querySelectorAll('.ln')];
  expect(lines.map((el) => el.textContent)).toEqual(['회의', '장보기']);
  expect(lines[1].classList.contains('done')).toBe(true);
  expect(cell(root, '2026-11-01').classList.contains('sun')).toBe(true);
  expect(cell(root, '2026-11-07').classList.contains('sat')).toBe(true);
  expect(cell(root, '2026-12-05').classList.contains('other')).toBe(true);
});
it('달을 넘기고, 날짜를 누르면 알린다', () => {
  const { root, store, onOpenDay } = mount();
  root.querySelector<HTMLElement>('[aria-label="다음 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-12');
  root.querySelector<HTMLElement>('[aria-label="다음 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2027-01');
  root.querySelector<HTMLElement>('[aria-label="이전 달"]')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-12');
  [...root.querySelectorAll('button')].find((b) => b.textContent === '오늘')!.click();
  expect(store.show).toHaveBeenLastCalledWith('2026-11');
  cell(root, '2026-11-20').click();
  expect(onOpenDay).toHaveBeenCalledWith('2026-11-20');
});
it('대기 중이면 건수를 보여 준다', () => {
  expect(mount({}, { state: 'waiting', pending: 2 }).root.textContent).toContain('오프라인 (대기 2건)');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project dom src/web/state.test.ts src/web/ui`
Expected: FAIL. `./state`, `./calendar`, `./status` 모듈을 찾지 못한다.

- [ ] **Step 3: 구현**

Interfaces와 "정해 둔 값"대로 쓴다. 칸에 몇 줄이 들어가는지는 칸 높이를 재서 정하고(시안의 `render` 함수 방식), 창 크기가 바뀌면 다시 그린다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --project dom && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음.

- [ ] **Step 5: 에뮬레이터로 화면 확인**

Run: `npm run dev:emu`를 백그라운드로 띄우고 `scripts/shot.ts`로 `http://localhost:5173/?autologin=1`을 402x874와 1440x900, 밝은 화면과 어두운 화면으로 찍어 본다. `--eval`로 다음 달 버튼을 눌러 한 장 더 찍는다. 끝나면 띄운 프로세스를 끈다.
Expected: 이번 달이 한 화면에 들어온다. 오늘 날짜가 강조된다. 달을 넘길 수 있다. 가로 스크롤이 생기지 않는다. 밝은 화면과 어두운 화면 모두 글자가 읽힌다.

- [ ] **Step 6: Commit**

```bash
git add src/web
git commit -m "feat: 달력 화면과 실시간 구독"
```

---

### Task 8: 날짜 편집과 바로가기 주소

**Files:**
- Create: `src/web/router.ts`, `src/web/ui/editor.ts`
- Modify: `src/web/main.ts`, `src/web/styles.css`
- Test: `src/web/router.test.ts`, `src/web/ui/editor.test.ts`

**Interfaces:**
- Consumes: Task 1의 `splitDateKey`, `normalizeText`, `toggleDoneInRange`, `PALETTE`. Task 3의 `SyncEngine.saveEdit`. Task 7의 `CalendarStore`.
- Produces:

```ts
// src/web/router.ts
export type Route = { name: 'calendar' } | { name: 'day'; dateKey: string } | { name: 'settings' };
export function parseHash(hash: string): Route;
export function hashFor(route: Route): string;        // 'calendar' → '', 'day' → '#2026-11-13', 'settings' → '#settings'

// src/web/ui/editor.ts
export function mountEditor(root: HTMLElement, props: {
  dateKey: string;
  value: DayValue;
  onSave(next: DayValue): void;
  onCancel(): void;
}): { destroy(): void };
```

정해 둔 값:

- 편집 화면 구성: 제목(`11월 13일 금요일`), `취소` 버튼, `저장` 버튼, 배경색 줄, `완료 표시` 버튼, 메모 입력 칸(`textarea`).
- 배경색 줄은 `role="radiogroup"`이고 단추는 `role="radio"`다. 첫 단추는 `없음`(`data-color=""`), 이어서 `PALETTE` 22색이다. 지금 값이 팔레트에 없는 색이면 그 색 단추를 맨 뒤에 하나 더 둔다. 고른 단추는 `aria-checked="true"`다.
- 메모 입력 칸에는 저장된 글을 그대로 보여 준다. 완료한 줄은 `[+]`가 붙은 채로 보인다. `완료 표시` 버튼은 `toggleDoneInRange`로 커서가 있는 줄(선택 범위가 걸친 줄 전부)을 바꾸고 커서 위치를 지킨다.
- `저장`은 `{ text: normalizeText(입력값), color }`로 `onSave`를 부른다. `취소`, 바깥 누르기, Esc는 `onCancel`을 부른다. Ctrl+Enter(맥은 Cmd+Enter)는 저장이다.
- 좁은 화면에서는 화면을 덮는 시트로, 넓은 화면에서는 가운데 대화상자(폭 480px)로 뜬다. 입력 칸 글자는 16px 이상이다(아이폰이 화면을 확대하지 않게).
- `main.ts`의 연결: 날짜를 누르면 `location.hash`를 `#날짜`로 바꾼다. 주소가 `day`이면 그 달을 `store.show`하고 편집 화면을 연다. 편집 화면을 열 때의 값이 `base`다. 저장하면 `engine.saveEdit(monthId, day, base, next)`를 부르고 `store.refresh()` 뒤 주소를 달력으로 되돌린다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/web/router.test.ts
import { expect, it } from 'vitest';
import { hashFor, parseHash } from './router';

it('주소를 화면으로 바꾼다', () => {
  expect(parseHash('#2026-11-13')).toEqual({ name: 'day', dateKey: '2026-11-13' });
  expect(parseHash('#settings')).toEqual({ name: 'settings' });
  for (const hash of ['', '#', '#abc', '#2026-02-30', '#2026-11-13/extra']) {
    expect(parseHash(hash)).toEqual({ name: 'calendar' });
  }
});
it('화면을 주소로 바꾼다', () => {
  expect(hashFor({ name: 'day', dateKey: '2026-11-13' })).toBe('#2026-11-13');
  expect(hashFor({ name: 'settings' })).toBe('#settings');
  expect(hashFor({ name: 'calendar' })).toBe('');
});
```

```ts
// src/web/ui/editor.test.ts
import { expect, it, vi } from 'vitest';
import type { DayValue } from '../../core/types';
import { mountEditor } from './editor';

function mount(value: DayValue) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSave = vi.fn();
  const onCancel = vi.fn();
  mountEditor(root, { dateKey: '2026-11-13', value, onSave, onCancel });
  const area = root.querySelector<HTMLTextAreaElement>('textarea')!;
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
  return { root, area, button, onSave, onCancel };
}

it('날짜와 저장된 값을 보여 준다', () => {
  const { root, area } = mount({ text: 'a\n[+]b', color: 'F12424' });
  expect(root.textContent).toContain('11월 13일 금요일');
  expect(area.value).toBe('a\n[+]b');
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(23);
  expect(root.querySelector('[role="radio"][aria-checked="true"]')!.getAttribute('data-color')).toBe('F12424');
});
it('팔레트에 없는 색은 단추를 하나 더 둔다', () => {
  const { root } = mount({ text: '', color: 'FF0000' });
  expect(root.querySelectorAll('[role="radio"]')).toHaveLength(24);
  expect(root.querySelector('[role="radio"][aria-checked="true"]')!.getAttribute('data-color')).toBe('FF0000');
});
it('커서가 있는 줄의 완료 표시를 바꾼다', () => {
  const { area, button } = mount({ text: 'a\n[+]b', color: '' });
  area.setSelectionRange(0, 0);
  button('완료 표시').click();
  expect(area.value).toBe('[+]a\n[+]b');
});
it('저장하면 다듬은 글과 고른 색을 넘긴다', () => {
  const { root, area, button, onSave, onCancel } = mount({ text: '', color: '' });
  area.value = 'x  \r\n\r\n';
  root.querySelector<HTMLElement>('[role="radio"][data-color="009300"]')!.click();
  button('저장').click();
  expect(onSave).toHaveBeenCalledWith({ text: 'x', color: '009300' });
  expect(onCancel).not.toHaveBeenCalled();
});
it('취소와 Esc는 저장하지 않는다', () => {
  const first = mount({ text: 'a', color: '' });
  first.area.value = 'changed';
  first.button('취소').click();
  expect(first.onCancel).toHaveBeenCalledTimes(1);
  expect(first.onSave).not.toHaveBeenCalled();
  const second = mount({ text: 'a', color: '' });
  second.area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(second.onCancel).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project dom src/web/router.test.ts src/web/ui/editor.test.ts`
Expected: FAIL. `./router`, `./editor` 모듈을 찾지 못한다.

- [ ] **Step 3: 구현하고 `main.ts`에 연결한다**

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --project dom && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음.

- [ ] **Step 5: 에뮬레이터로 두 창 확인**

Run: `npm run dev:emu`를 백그라운드로 띄운다. `scripts/shot.ts`의 `--eval`로 한 페이지에서 날짜를 열어 메모와 배경색, 완료 표시를 저장하게 한 뒤, 새로 연 페이지(`?autologin=1`)의 스크린샷에서 같은 내용이 보이는지 확인한다. `?autologin=1#2026-11-20`과 `?autologin=1#2026-02-30`도 찍는다. 끝나면 띄운 프로세스를 끈다.
Expected: 한 창에서 메모와 배경색을 저장하면 다른 창의 같은 날짜가 5초 안에 바뀐다. 완료 표시를 켠 줄은 달력에서 취소선으로 보인다. 주소에 `#2026-11-20`을 붙여 열면 그 날짜의 편집 화면이 뜬다. `#2026-02-30`은 달력으로 간다.

- [ ] **Step 6: 실제 프로젝트로 회사 네트워크 확인(사용자의 Firebase 프로젝트가 준비됐을 때만)**

`.env.local`을 채우고 `npx firebase use --add`로 프로젝트를 고른 뒤 규칙만 먼저 배포한다.

Run: `npx tsx scripts/build-rules.ts && npx firebase deploy --only firestore:rules && npm run dev`
Expected: 브라우저 창 두 개로 로그인해 한 창에서 저장하면 다른 창이 5초 안에 바뀐다. 바뀌지 않으면 `.env.local`에 `VITE_FORCE_LONG_POLLING=1`을 넣고 다시 확인한다. 프로젝트가 아직 없으면 이 단계는 Task 13 Step 4에서 한다.

- [ ] **Step 7: Commit**

```bash
git add src/web
git commit -m "feat: 날짜 편집 화면과 바로가기 주소"
```

---

### Task 9: 설정 화면, 오프라인 실행, 빌드

**Files:**
- Create: `src/web/ui/settings.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/apple-touch-icon.png`, `scripts/make-icons.ts`
- Modify: `vite.config.ts`, `index.html`, `src/web/main.ts`, `src/web/styles.css`, `package.json`
- Test: `src/web/ui/settings.test.ts`

**Interfaces:**
- Consumes: Task 3의 `Outbox`(`persistent`, `corruptDetected`), `SyncStatus`. Task 6의 `Session`.
- Produces:

```ts
// src/web/ui/settings.ts
export function mountSettings(root: HTMLElement, props: {
  email: string;
  pending: number;
  storageOk: boolean;          // outbox.persistent
  corruptFound: boolean;       // outbox.corruptDetected
  onSignOut(): void;
  onClose(): void;
}): { destroy(): void };
```

정해 둔 값:

- 설정 화면: 로그인한 이메일, `대기 중인 편집 n건`, `로그아웃` 버튼, `닫기` 버튼. 위젯 설치 안내 자리에 `아이폰 위젯은 다음 단계에서 추가됩니다.`를 적는다.
- `storageOk`가 `false`면 `이 브라우저에서는 대기 중인 편집을 저장할 수 없습니다. 연결이 끊긴 채로 창을 닫으면 편집이 사라집니다.`를 보여 준다.
- `corruptFound`가 `true`면 `대기 중이던 편집 기록이 깨져 있어 따로 보관했습니다.`를 보여 준다.
- 대기 건수가 있을 때 `로그아웃`을 누르면 바로 나가지 않고 `아직 올리지 못한 편집이 n건 있습니다. 로그아웃하면 이 기기에 남습니다.`와 `그래도 로그아웃` 버튼을 보여 준다.
- 오프라인 실행: `vite-plugin-pwa`의 서비스 워커 자동 생성으로 앱 파일을 미리 저장해, 연결이 없어도 앱이 열리게 한다. 새 버전은 다음에 열 때 적용한다. 웹앱 이름은 `CalendarFIF`, 표시 방식은 `standalone`, 언어는 `ko`다.
- 아이콘: `scripts/make-icons.ts`가 파란 바탕(`#2550D0`)에 흰 글자 `F`를 그린 HTML을 헤드리스 Edge(`msedge --headless --screenshot`)로 찍어 192, 512, 180px PNG를 만든다. 결과 PNG를 커밋한다. Edge는 이 PC의 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`에 있다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/web/ui/settings.test.ts
import { expect, it, vi } from 'vitest';
import { mountSettings } from './settings';

function mount(overrides: Partial<Parameters<typeof mountSettings>[1]> = {}) {
  const root = document.createElement('div');
  const onSignOut = vi.fn();
  mountSettings(root, { email: 'me@example.com', pending: 0, storageOk: true, corruptFound: false, onSignOut, onClose: vi.fn(), ...overrides });
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
  return { root, button, onSignOut };
}

it('계정과 대기 건수를 보여 주고 로그아웃한다', () => {
  const { root, button, onSignOut } = mount();
  expect(root.textContent).toContain('me@example.com');
  expect(root.textContent).toContain('대기 중인 편집 0건');
  button('로그아웃').click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('올리지 못한 편집이 있으면 한 번 더 묻는다', () => {
  const { root, button, onSignOut } = mount({ pending: 2 });
  button('로그아웃').click();
  expect(onSignOut).not.toHaveBeenCalled();
  expect(root.textContent).toContain('아직 올리지 못한 편집이 2건 있습니다.');
  button('그래도 로그아웃').click();
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
it('저장소 문제를 알린다', () => {
  expect(mount({ storageOk: false }).root.textContent).toContain('이 브라우저에서는 대기 중인 편집을 저장할 수 없습니다.');
  expect(mount({ corruptFound: true }).root.textContent).toContain('대기 중이던 편집 기록이 깨져 있어 따로 보관했습니다.');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project dom src/web/ui/settings.test.ts`
Expected: FAIL. `./settings` 모듈을 찾지 못한다.

- [ ] **Step 3: 구현**

`settings.ts`를 쓰고 `main.ts`에서 `#settings` 주소에 연결한다. `npm install -D vite-plugin-pwa` 후 `vite.config.ts`에 설정을 넣는다. `scripts/make-icons.ts`를 쓰고 실행해 아이콘을 만든다. `index.html`에 `apple-touch-icon` 링크와 `theme-color`를 넣는다.

- [ ] **Step 4: 통과 확인**

Run: `npm test && npm run build`
Expected: 단위·DOM 테스트 전부 PASS. `dist/`에 `index.html`, 서비스 워커 파일, 웹앱 매니페스트, 아이콘이 생긴다.

- [ ] **Step 5: 화면 확인**

Run: `npm run dev:emu`를 백그라운드로 띄우고 `scripts/shot.ts`로 폭 402px과 1440px, 밝은 화면과 어두운 화면에서 로그인, 달력, 편집(`#2026-11-20`), 설정(`#settings`)을 찍어 본다. 끝나면 띄운 프로세스를 끈다.
Expected: 글자가 잘리거나 겹치지 않는다. 가로 스크롤이 없다. 22색 팔레트가 편집 화면 안에 다 들어온다. 배경색이 깔린 칸의 글자가 읽힌다.

- [ ] **Step 6: Commit**

```bash
git add src/web vite.config.ts index.html public scripts/make-icons.ts package.json package-lock.json
git commit -m "feat: 설정 화면과 오프라인 실행"
```

---

### Task 10: DesktopCal 변환과 파일 읽기

**Files:**
- Create: `src/importer/convert.ts`, `src/importer/source.ts`, `src/importer/testing.ts`
- Test: `src/importer/convert.test.ts`, `src/importer/source.test.ts`

**Interfaces:**
- Consumes: Task 1의 `DayValue`, `normalizeText`, `splitDateKey`
- Produces:

```ts
// src/importer/convert.ts
export type SourceRow = { key: string; content: string | null; bgcolor: string | null; stime: number | null };
export type ConvertedDay = { dateKey: string; value: DayValue; editedAt: number };
export type ConvertStats = {
  rows: number; converted: number; skippedEmpty: number; skippedBadKey: number; badColors: number; fontTags: number;
  colors: { stored: string; rgb: string; count: number }[];        // 저장 값 그대로(대소문자 포함)별 집계, count 내림차순
};
export function parseItemKey(key: string): string | null;            // 'dkcal_mdays_20261113' → '2026-11-13'
export function bgrToRgb(stored: string): string | null;             // 잘못된 값이면 null
export function decodeContent(raw: string): { text: string; fontTags: number };
export function convertRows(rows: SourceRow[]): { days: Map<string, ConvertedDay>; stats: ConvertStats };

// src/importer/source.ts
export class SourceMissingError extends Error {}
export class SourceBusyError extends Error {}
export class SourceCorruptError extends Error {}
export function defaultDbPath(env: Record<string, string | undefined>): string;     // `${APPDATA}\CalendarTask\Db\calendar.db`
export function readSourceRows(dbPath: string, opts?: { retries?: number; retryDelayMs?: number }): Promise<SourceRow[]>;

// src/importer/testing.ts (테스트 전용)
export function makeSourceDb(dir: string, rows: SourceRow[]): string;   // DesktopCal과 같은 item_table을 가진 calendar.db를 만들고 경로를 돌려준다
```

변환 규칙(설계 부록 A):

- 키는 `dkcal_mdays_` 뒤에 8자리 날짜다. 실제로 없는 날짜면 `null`.
- 색: 빈 값은 빈 값. 1~6자리 16진수면 앞을 0으로 채워 6자리로 만들고 두 자리씩 순서를 뒤집어 대문자로 만든다. 그 밖은 `null`. `convertRows`는 `null`을 배경 없음으로 바꾸고 `badColors`를 센다.
- 본문: `\r\n`을 `\n`으로 바꾼다. `<font ...>`과 `</font>` 태그를 떼고 여는 태그 개수를 `fontTags`로 센다. 그다음 `&lt;` `&gt;` `&quot;` 세 가지만 원래 글자로 바꾼다. 마지막에 `normalizeText`를 적용한다.
- `editedAt`은 `stime × 1000`. `stime`이 없으면 0.
- 글도 색도 없는 행은 건너뛰고 `skippedEmpty`를 센다.

파일 읽기 규칙:

- 원본을 열지 않는다. `${dbPath}-journal` 파일이 있으면 `retryDelayMs`(기본 1000) 기다렸다가 다시 본다. `retries`(기본 5)번을 넘기면 `SourceBusyError`.
- 원본을 임시 폴더로 복사하고 복사본을 읽기 전용으로 연다. `PRAGMA quick_check` 결과가 `ok`가 아니거나 열 수 없으면 다시 복사한다. 재시도를 넘기면 `SourceCorruptError`.
- `select it_unique_id, it_content, it_bgcolor, it_stime from item_table`로 읽는다.
- 끝나면(실패해도) 임시 복사본을 지운다. 원본이 없으면 `SourceMissingError`.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/importer/convert.test.ts
import { describe, expect, it } from 'vitest';
import { bgrToRgb, convertRows, decodeContent, parseItemKey } from './convert';

describe('DesktopCal 변환', () => {
  it('키에서 날짜를 읽는다', () => {
    expect(parseItemKey('dkcal_mdays_20261113')).toBe('2026-11-13');
    expect(parseItemKey('dkcal_mdays_20260230')).toBeNull();
    expect(parseItemKey('something_else')).toBeNull();
  });
  it.each([
    ['', ''], ['ff', 'FF0000'], ['0000FF', 'FF0000'], ['2424F1', 'F12424'], ['2424f1', 'F12424'],
    ['2aa5', 'A52A00'], ['009300', '009300'], ['78F0FB', 'FBF078'], ['81004A', '4A0081'], ['9595FF', 'FF9595'],
  ])('색 %s → %s', (stored, rgb) => {
    expect(bgrToRgb(stored)).toBe(rgb);
  });
  it('색이 아닌 값은 null이다', () => {
    expect(bgrToRgb('zz')).toBeNull();
    expect(bgrToRgb('1234567')).toBeNull();
  });
  it('본문은 세 가지 표기만 되돌린다', () => {
    expect(decodeContent('a\r\nb &lt;- c &gt; d &quot;e&quot; &amp;')).toEqual({ text: 'a\nb <- c > d "e" &amp;', fontTags: 0 });
    expect(decodeContent('[+]done  \r\n')).toEqual({ text: '[+]done', fontTags: 0 });
    expect(decodeContent('<font color=#ff0000>x</font>\r\ny')).toEqual({ text: 'x\ny', fontTags: 1 });
  });
  it('행을 날짜별 값으로 바꾸고 건너뛴 것을 센다', () => {
    const { days, stats } = convertRows([
      { key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '2424F1', stime: 100 },
      { key: 'dkcal_mdays_20261114', content: '', bgcolor: '', stime: 5 },
      { key: 'dkcal_mdays_20270102', content: null, bgcolor: 'ff', stime: null },
      { key: 'bad', content: 'x', bgcolor: '', stime: 1 },
      { key: 'dkcal_mdays_20261115', content: 'x', bgcolor: 'zz', stime: 7 },
    ]);
    expect([...days.keys()]).toEqual(['2026-11-13', '2027-01-02', '2026-11-15']);
    expect(days.get('2026-11-13')).toEqual({ dateKey: '2026-11-13', value: { text: 'a', color: 'F12424' }, editedAt: 100000 });
    expect(days.get('2027-01-02')).toEqual({ dateKey: '2027-01-02', value: { text: '', color: 'FF0000' }, editedAt: 0 });
    expect(days.get('2026-11-15')!.value).toEqual({ text: 'x', color: '' });
    expect(stats).toMatchObject({ rows: 5, converted: 3, skippedEmpty: 1, skippedBadKey: 1, badColors: 1, fontTags: 0 });
    expect(stats.colors).toEqual([
      { stored: '2424F1', rgb: 'F12424', count: 1 },
      { stored: 'ff', rgb: 'FF0000', count: 1 },
    ]);
  });
});
```

```ts
// src/importer/source.test.ts
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { SourceBusyError, SourceCorruptError, SourceMissingError, defaultDbPath, readSourceRows } from './source';
import { makeSourceDb } from './testing';

const ROWS = [{ key: 'dkcal_mdays_20261113', content: 'a\r\nb', bgcolor: '2424F1', stime: 100 }];
const fresh = () => mkdtempSync(join(tmpdir(), 'calfif-src-'));
const quick = { retries: 2, retryDelayMs: 10 };

it('기본 위치는 APPDATA 아래다', () => {
  expect(defaultDbPath({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toBe('C:\\Users\\me\\AppData\\Roaming\\CalendarTask\\Db\\calendar.db');
});
it('복사본에서 읽고 원본과 그 폴더는 그대로 둔다', async () => {
  const db = makeSourceDb(fresh(), ROWS);
  const before = { bytes: readFileSync(db), mtime: statSync(db).mtimeMs, files: readdirSync(dirname(db)) };
  expect(await readSourceRows(db, quick)).toEqual(ROWS);
  expect(readFileSync(db).equals(before.bytes)).toBe(true);
  expect(statSync(db).mtimeMs).toBe(before.mtime);
  expect(readdirSync(dirname(db))).toEqual(before.files);
});
it('쓰는 중이면 기다리고, 끝나지 않으면 그만둔다', async () => {
  const db = makeSourceDb(fresh(), ROWS);
  writeFileSync(`${db}-journal`, 'x');
  setTimeout(() => rmSync(`${db}-journal`), 15);
  expect(await readSourceRows(db, { retries: 5, retryDelayMs: 10 })).toEqual(ROWS);
  writeFileSync(`${db}-journal`, 'x');
  await expect(readSourceRows(db, quick)).rejects.toBeInstanceOf(SourceBusyError);
});
it('없는 파일과 깨진 파일을 구분해 알린다', async () => {
  const dir = fresh();
  await expect(readSourceRows(join(dir, 'calendar.db'), quick)).rejects.toBeInstanceOf(SourceMissingError);
  writeFileSync(join(dir, 'calendar.db'), 'this is not a database');
  await expect(readSourceRows(join(dir, 'calendar.db'), quick)).rejects.toBeInstanceOf(SourceCorruptError);
  expect(existsSync(join(dir, 'calendar.db'))).toBe(true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project unit src/importer`
Expected: FAIL. `./convert`, `./source`, `./testing` 모듈을 찾지 못한다.

- [ ] **Step 3: 구현**

`testing.ts`의 `makeSourceDb`는 `node:sqlite`로 `item_table(it_id integer primary key, it_unique_id text, it_content text, it_bgcolor text, it_stime integer)`를 만들고 행을 넣는다. `convert.ts`와 `source.ts`는 위 규칙대로 쓴다. SQLite는 `node:sqlite`의 `DatabaseSync`를 쓴다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --project unit src/importer && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음.

- [ ] **Step 5: Commit**

```bash
git add src/importer
git commit -m "feat: DesktopCal 기록 변환과 안전한 파일 읽기"
```

---

### Task 11: 가져오기 계획, 상태 파일, 올리기, 대조

**Files:**
- Create: `src/importer/plan.ts`, `src/importer/stateFile.ts`, `src/importer/liteStore.ts`, `src/importer/upload.ts`
- Test: `src/importer/plan.test.ts`, `src/importer/stateFile.test.ts`, `src/importer/upload.test.ts`, `tests/emulator/importer.test.ts`

**Interfaces:**
- Consumes: Task 2의 `resolveEdit`. Task 3의 `MonthStore`, `FakeMonthStore`, `rec`. Task 5의 `parseMonthDoc`(`src/sync/monthDoc.ts`). Task 10의 `ConvertedDay`.
- Produces:

```ts
// src/importer/plan.ts
export type ImportEdit = PendingEdit & { hasBase: boolean };
export function planEdits(current: Map<string, ConvertedDay>, state: Record<string, DayValue> | null, now: number): ImportEdit[];

// src/importer/stateFile.ts
export class ImportStateCorruptError extends Error {}
export type ImportStateFile = { projectId: string; uid: string; days: Record<string, DayValue> };
export function defaultStatePath(env: Record<string, string | undefined>): string;   // `${LOCALAPPDATA}\CalendarFIF\import-state.json`
export function loadState(path: string, projectId: string, uid: string): Record<string, DayValue> | null;   // 없거나 프로젝트·계정이 다르면 null
export function saveState(path: string, file: ImportStateFile): void;                // 임시 파일에 쓰고 이름을 바꾼다

// src/importer/upload.ts
export function decideImport(edits: ImportEdit[], server: MonthDoc | null): Record<string, DayChange>;
export function uploadEdits(store: MonthStore, edits: ImportEdit[], onMonthDone: (monthId: string, done: ImportEdit[]) => void): Promise<{ months: number; days: number }>;
export type VerifyResult = { source: number; same: number; different: number; missing: number };
export function verifyAgainstCloud(store: { getMonth(monthId: string): Promise<MonthDoc | null> }, days: Map<string, ConvertedDay>): Promise<VerifyResult>;

// src/importer/liteStore.ts  (firebase/firestore/lite 사용)
export class LiteMonthStore implements MonthStore {
  constructor(db: import('firebase/firestore/lite').Firestore, uid: string);
  transactMonth(monthId: string, decide: (server: MonthDoc | null) => Record<string, DayChange>): Promise<void>;
  getMonth(monthId: string): Promise<MonthDoc | null>;
}
```

규칙:

- `planEdits`: 지금 값이 상태 파일의 값과 같으면 편집을 만들지 않는다. 다르면 `base`는 상태 파일의 값(없으면 빈 값), `next`는 지금 값, `editedAt`은 DesktopCal의 수정 시각, `hasBase`는 상태 파일에 그 날짜가 있었는지다. 상태 파일에는 있는데 지금은 없는 날짜는 `next`가 빈 값이고 `editedAt`은 `now`인 편집으로 만든다.
- `decideImport`: `hasBase`가 `true`면 `resolveEdit(edit, 서버 값, 'import')`. `false`면 이렇게 한다. 서버에 그 날짜가 없으면 `next`를 쓴다(`next`가 빈 값이면 쓰지 않는다). 서버 값이 `next`와 같으면 쓰지 않는다. 다르면 서버의 `editedAt`이 `edit.editedAt`보다 이를 때만 `next`로 덮어쓴다.
- `uploadEdits`: 편집 목록에 처음 나온 순서대로 달마다 `transactMonth`를 한 번 부르고, 성공한 달마다 `onMonthDone`을 부른다. 실패하면 그 자리에서 오류를 던진다. 돌려주는 `months`는 성공한 달 수, `days`는 그 달들에 넘긴 편집 수다(실제로 쓴 수가 아니다).
- `verifyAgainstCloud`: 원본의 각 날짜에 대해 클라우드 값이 같으면 `same`, 다르면 `different`, 없으면 `missing`.
- 상태 파일이 JSON으로 읽히지 않으면 `ImportStateCorruptError`.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/importer/plan.test.ts
import { expect, it } from 'vitest';
import type { ConvertedDay } from './convert';
import { planEdits } from './plan';

const day = (dateKey: string, text: string, color = '', editedAt = 100): [string, ConvertedDay] =>
  [dateKey, { dateKey, value: { text, color }, editedAt }];

it('상태 파일이 없으면 모든 날짜가 base 없는 편집이다', () => {
  expect(planEdits(new Map([day('2026-11-13', 'A', 'F12424')]), null, 999)).toEqual([
    { monthId: '2026-11', day: '13', base: { text: '', color: '' }, next: { text: 'A', color: 'F12424' }, editedAt: 100, hasBase: false },
  ]);
});
it('지난번과 달라진 날짜만 편집으로 만든다', () => {
  const state = { '2026-11-13': { text: 'A', color: '' }, '2026-11-14': { text: 'B', color: '' }, '2026-11-15': { text: 'gone', color: '' } };
  const current = new Map([day('2026-11-13', 'A'), day('2026-11-14', 'B\nC', '', 200)]);
  expect(planEdits(current, state, 999)).toEqual([
    { monthId: '2026-11', day: '14', base: { text: 'B', color: '' }, next: { text: 'B\nC', color: '' }, editedAt: 200, hasBase: true },
    { monthId: '2026-11', day: '15', base: { text: 'gone', color: '' }, next: { text: '', color: '' }, editedAt: 999, hasBase: true },
  ]);
});
```

```ts
// src/importer/stateFile.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ImportStateCorruptError, defaultStatePath, loadState, saveState } from './stateFile';

const path = () => join(mkdtempSync(join(tmpdir(), 'calfif-state-')), 'sub', 'import-state.json');

it('저장한 상태를 같은 프로젝트와 계정으로만 읽는다', () => {
  const p = path();
  expect(loadState(p, 'proj', 'u1')).toBeNull();
  saveState(p, { projectId: 'proj', uid: 'u1', days: { '2026-11-13': { text: 'A', color: '' } } });
  expect(loadState(p, 'proj', 'u1')).toEqual({ '2026-11-13': { text: 'A', color: '' } });
  expect(loadState(p, 'proj', 'other')).toBeNull();
  expect(loadState(p, 'other-proj', 'u1')).toBeNull();
});
it('깨진 상태 파일은 오류로 알린다', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'calfif-state-')), 'import-state.json');
  writeFileSync(p, '{oops');
  expect(() => loadState(p, 'proj', 'u1')).toThrow(ImportStateCorruptError);
});
it('기본 위치는 LOCALAPPDATA 아래다', () => {
  expect(defaultStatePath({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' })).toBe('C:\\Users\\me\\AppData\\Local\\CalendarFIF\\import-state.json');
});
```

```ts
// src/importer/upload.test.ts
import { expect, it, vi } from 'vitest';
import type { DayValue } from '../core/types';
import { FakeMonthStore, rec } from '../sync/testing';
import type { ConvertedDay } from './convert';
import type { ImportEdit } from './plan';
import { decideImport, uploadEdits, verifyAgainstCloud } from './upload';

const v = (text: string, color = ''): DayValue => ({ text, color });
const ie = (day: string, base: DayValue, next: DayValue, editedAt: number, hasBase: boolean, monthId = '2026-11'): ImportEdit =>
  ({ monthId, day, base, next, editedAt, hasBase });

it('지난번 값이 있으면 병합 규칙으로 올린다', () => {
  const server = { days: { '13': rec('A\nP', '', 500, 'iphone') } };
  expect(decideImport([ie('13', v('A'), v('A\nB'), 300, true)], server))
    .toEqual({ '13': { text: 'A\nB\nP', color: '', editedAt: 500, editedBy: 'import' } });
});
it('지난번 값이 없으면 수정 시각이 더 늦을 때만 덮어쓴다', () => {
  const fresh = [ie('13', v(''), v('A'), 300, false)];
  expect(decideImport(fresh, null)).toEqual({ '13': { text: 'A', color: '', editedAt: 300, editedBy: 'import' } });
  expect(decideImport(fresh, { days: { '13': rec('A', '', 1) } })).toEqual({});
  expect(decideImport(fresh, { days: { '13': rec('old', '', 200) } })).toEqual({ '13': { text: 'A', color: '', editedAt: 300, editedBy: 'import' } });
  expect(decideImport(fresh, { days: { '13': rec('newer', '', 400) } })).toEqual({});
});
it('달마다 한 번씩 올리고, 끊기면 다시 돌려 이어서 끝낸다', async () => {
  const store = new FakeMonthStore();
  const edits = [ie('13', v(''), v('A'), 1, false), ie('14', v(''), v('B'), 1, false), ie('01', v(''), v('C'), 1, false, '2026-12')];
  const done = vi.fn();
  store.failMonths.add('2026-12');
  await expect(uploadEdits(store, edits, done)).rejects.toThrow();
  expect(done).toHaveBeenCalledTimes(1);
  expect(done.mock.calls[0][0]).toBe('2026-11');
  store.failMonths.clear();
  expect(await uploadEdits(store, edits, done)).toEqual({ months: 2, days: 3 });
  expect(store.docs.get('2026-11')!.days['13'].text).toBe('A');
  expect(store.docs.get('2026-12')!.days['01'].text).toBe('C');
});
it('원본과 클라우드를 날짜별로 대조한다', async () => {
  const days = new Map<string, ConvertedDay>([
    ['2026-11-13', { dateKey: '2026-11-13', value: v('A'), editedAt: 1 }],
    ['2026-11-14', { dateKey: '2026-11-14', value: v('B'), editedAt: 1 }],
    ['2026-12-01', { dateKey: '2026-12-01', value: v('C'), editedAt: 1 }],
  ]);
  const docs: Record<string, { days: Record<string, ReturnType<typeof rec>> }> = { '2026-11': { days: { '13': rec('A'), '14': rec('B\nextra') } } };
  const store = { getMonth: async (monthId: string) => docs[monthId] ?? null };
  expect(await verifyAgainstCloud(store, days)).toEqual({ source: 3, same: 1, different: 1, missing: 1 });
});
```

```ts
// tests/emulator/importer.test.ts
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore/lite';
import { expect, it } from 'vitest';
import { LiteMonthStore } from '../../src/importer/liteStore';
import { rec } from '../../src/sync/testing';
import { OWNER } from './env';

it('Lite 어댑터로 달 문서를 쓰고 읽는다', async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  const db = getFirestore(initializeApp({ projectId: 'demo-calfif' }, `lite-${Date.now()}`));
  connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: OWNER } });
  const store = new LiteMonthStore(db, OWNER);
  const monthId = '2031-01';
  await store.transactMonth(monthId, () => ({ '13': rec('A', 'F12424', 100, 'import'), '14': rec('B') }));
  await store.transactMonth(monthId, () => ({ '14': 'delete' }));
  expect(await store.getMonth(monthId)).toEqual({ days: { '13': { text: 'A', color: 'F12424', editedAt: 100, editedBy: 'import' } } });
  expect(await store.getMonth('2031-02')).toBeNull();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project unit src/importer`
Expected: FAIL. `./plan`, `./stateFile`, `./upload` 모듈을 찾지 못한다.

- [ ] **Step 3: 구현**

네 파일을 Interfaces와 규칙대로 쓴다. `LiteMonthStore`는 읽은 문서를 `parseMonthDoc`으로 바꾸고, 쓸 내용을 `buildMonthPatch`(`src/sync/monthDoc.ts`)로 만들어 `set(..., { merge: true })`로 쓴다. Lite SDK의 `deleteField`와 `serverTimestamp`를 넘긴다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --project unit src/importer && npm run test:emu && npx tsc --noEmit`
Expected: 전부 PASS, 타입 오류 없음.

- [ ] **Step 5: Commit**

```bash
git add src/importer tests/emulator/importer.test.ts
git commit -m "feat: 가져오기 계획, 상태 파일, 올리기와 대조"
```

---

### Task 12: 명령줄과 따라가기

**Files:**
- Create: `src/importer/report.ts`, `src/importer/follow.ts`, `src/importer/cli.ts`
- Modify: `package.json` (scripts)
- Test: `src/importer/report.test.ts`, `src/importer/follow.test.ts`, `src/importer/cli.test.ts`

**Interfaces:**
- Consumes: Task 10의 `readSourceRows`, `convertRows`, `defaultDbPath`, 오류 클래스, `makeSourceDb`. Task 11의 `planEdits`, `loadState`, `saveState`, `defaultStatePath`, `uploadEdits`, `verifyAgainstCloud`, `LiteMonthStore`.
- Produces:

```ts
// src/importer/report.ts
export function previewReport(stats: ConvertStats, days: Map<string, ConvertedDay>): string;
export function dayReport(dateKey: string, day: ConvertedDay | undefined): string;
export function verifyReport(result: VerifyResult): string;

// src/importer/follow.ts
export function createFollower(opts: {
  dbPath: string;
  runOnce(): Promise<void>;
  debounceMs?: number;                       // 기본 2000
  pollMs?: number;                           // 기본 30000
  watchDir?(dir: string, onEvent: (fileName: string | null) => void): { close(): void };   // 기본은 fs.watch
  fingerprint?(): string;                    // 기본은 파일 크기와 수정 시각
  log?(line: string): void;
}): { start(): void; stop(): void };

// src/importer/cli.ts
export class UsageError extends Error {}
export type CliOptions = { mode: 'preview' | 'upload' | 'follow'; dbPath: string; statePath: string; show: string[]; yes: boolean };
export function parseArgs(argv: string[], env: Record<string, string | undefined>): CliOptions;
export type CliDeps = {
  out(line: string): void;
  connect(): Promise<{ projectId: string; uid: string; store: LiteMonthStore }>;   // .env.local 설정으로 로그인
  confirm(question: string): Promise<boolean>;
  now(): number;
};
export function main(argv: string[], env: Record<string, string | undefined>, deps: CliDeps): Promise<number>;   // 종료 코드
```

정해 둔 값:

- 인자: `--preview`(기본), `--upload`, `--follow`, `--db <경로>`, `--state <경로>`, `--show <YYYY-MM-DD>`(여러 번), `--yes`. 모드를 둘 이상 주거나, 모르는 인자거나, `--show`의 날짜가 잘못되면 `UsageError`.
- `package.json` scripts: `"import": "tsx src/importer/cli.ts"`. 파일을 직접 실행했을 때만 `main`을 부른다.
- 실제 `connect`: `.env.local`의 `VITE_FIREBASE_*`로 앱을 만들고, 환경 변수 `CALFIF_EMAIL`과 `CALFIF_PASSWORD`가 있으면 그것으로, 없으면 물어서(비밀번호는 화면에 보이지 않게) 로그인한다. 비밀번호는 저장하지 않는다.
- 미리보기 보고서의 줄:

```
DesktopCal 가져오기 미리보기
전체 행: 5
옮길 날짜: 3
빈 칸이라 건너뜀: 1
형식이 맞지 않아 건너뜀: 1
색 값이 이상해 배경 없음으로 처리: 1
글자색 태그를 뗀 곳: 0
연도별: 2026년 2, 2027년 1
색 변환:
  2424F1 → F12424  1일
  ff → FF0000  1일
```

- `dayReport`: 첫 줄은 `2026-11-13  배경색 F12424`(없으면 `배경색 없음`), 이어서 메모 줄. 그 날짜가 없으면 `2026-11-13  옮길 내용 없음`. 이 출력은 화면에만 쓴다.
- 대조 보고서: `원본 날짜 3 / 클라우드와 같음 1 / 다름 1 / 클라우드에 없음 1`.
- `main`의 흐름: 미리보기는 네트워크 없이 읽기, 변환, 보고서, `--show` 날짜 출력까지 한다. 올리기는 미리보기 보고서를 보여 주고 `--yes`가 없으면 `클라우드에 올릴까요?`를 물은 뒤, 계획을 세워 올리고, 달이 끝날 때마다 상태 파일을 저장하고, 대조 보고서를 출력한다. 따라가기는 올리기를 한 번 한 뒤 `createFollower`로 계속 돈다. 따라가기의 각 회차는 `HH:MM:SS 바뀐 날짜 n일을 올렸습니다.`만 적는다.
- 오류 문구와 종료 코드 1: 파일 없음은 `DesktopCal 데이터 파일을 찾지 못했습니다: <경로>`, 쓰는 중은 `DesktopCal이 파일을 쓰는 중입니다. 잠시 뒤 다시 실행해 주세요.`, 깨짐은 `복사한 파일을 읽을 수 없습니다. 다시 실행해 주세요.` 인자 오류는 문구와 사용법을 출력하고 종료 코드 2.
- 따라가기: 폴더 감시 이벤트가 오면 `debounceMs` 뒤에 `runOnce`를 한 번 부른다. 실행 중에 이벤트가 또 오면 끝난 뒤 한 번 더 부른다. `pollMs`마다 `fingerprint`가 지난 실행 때와 다르면 부른다. `runOnce`가 실패하면 `log`에 적고 계속 돈다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

```ts
// src/importer/report.test.ts
import { expect, it } from 'vitest';
import { convertRows } from './convert';
import { dayReport, previewReport, verifyReport } from './report';

const { days, stats } = convertRows([
  { key: 'dkcal_mdays_20261113', content: 'a\r\n[+]b', bgcolor: '2424F1', stime: 100 },
  { key: 'dkcal_mdays_20261114', content: '', bgcolor: '', stime: 5 },
  { key: 'dkcal_mdays_20270102', content: null, bgcolor: 'ff', stime: null },
  { key: 'bad', content: 'x', bgcolor: '', stime: 1 },
  { key: 'dkcal_mdays_20261115', content: 'x', bgcolor: 'zz', stime: 7 },
]);

it('미리보기 보고서에 건수와 색 변환표가 있다', () => {
  const report = previewReport(stats, days);
  for (const line of [
    'DesktopCal 가져오기 미리보기', '전체 행: 5', '옮길 날짜: 3', '빈 칸이라 건너뜀: 1', '형식이 맞지 않아 건너뜀: 1',
    '색 값이 이상해 배경 없음으로 처리: 1', '글자색 태그를 뗀 곳: 0', '연도별: 2026년 2, 2027년 1',
    '  2424F1 → F12424  1일', '  ff → FF0000  1일',
  ]) expect(report).toContain(line);
  expect(report).not.toContain('[+]b');
});
it('날짜 하나의 내용과 대조 결과를 글로 만든다', () => {
  expect(dayReport('2026-11-13', days.get('2026-11-13'))).toBe('2026-11-13  배경색 F12424\na\n[+]b');
  expect(dayReport('2026-11-20', undefined)).toBe('2026-11-20  옮길 내용 없음');
  expect(verifyReport({ source: 3, same: 1, different: 1, missing: 1 })).toBe('원본 날짜 3 / 클라우드와 같음 1 / 다름 1 / 클라우드에 없음 1');
});
```

```ts
// src/importer/follow.test.ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFollower } from './follow';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(runOnce: () => Promise<void>) {
  let emit!: (fileName: string | null) => void;
  const close = vi.fn();
  let print = 'v1';
  const log = vi.fn();
  const follower = createFollower({
    dbPath: 'C:\\x\\Db\\calendar.db', runOnce, debounceMs: 2000, pollMs: 30000, log,
    watchDir: (_dir, onEvent) => { emit = onEvent; return { close }; },
    fingerprint: () => print,
  });
  follower.start();
  return { follower, emit: (name: string | null) => emit(name), close, log, setPrint: (p: string) => { print = p; } };
}

it('이벤트가 몰려 와도 한 번만 돈다', async () => {
  const runOnce = vi.fn(async () => {});
  const { emit } = setup(runOnce);
  emit('calendar.db'); emit('calendar.db-journal'); emit('calendar.db');
  await vi.advanceTimersByTimeAsync(1999);
  expect(runOnce).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(runOnce).toHaveBeenCalledTimes(1);
});
it('도는 중에 온 이벤트는 끝난 뒤 한 번 더 돈다', async () => {
  let finish!: () => void;
  const runOnce = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { emit } = setup(runOnce);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  expect(runOnce).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(runOnce).toHaveBeenCalledTimes(2);
});
it('이벤트가 없어도 파일이 바뀌었으면 돈다', async () => {
  const runOnce = vi.fn(async () => {});
  const { setPrint } = setup(runOnce);
  await vi.advanceTimersByTimeAsync(30000);
  expect(runOnce).not.toHaveBeenCalled();
  setPrint('v2');
  await vi.advanceTimersByTimeAsync(30000);
  expect(runOnce).toHaveBeenCalledTimes(1);
});
it('실패해도 계속 돌고, 멈추면 더 돌지 않는다', async () => {
  const runOnce = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
  const { follower, emit, close, log } = setup(runOnce);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(2000);
  expect(runOnce).toHaveBeenCalledTimes(2);
  follower.stop();
  expect(close).toHaveBeenCalledTimes(1);
  emit('calendar.db');
  await vi.advanceTimersByTimeAsync(60000);
  expect(runOnce).toHaveBeenCalledTimes(2);
});
```

```ts
// src/importer/cli.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { UsageError, main, parseArgs, type CliDeps } from './cli';
import { makeSourceDb } from './testing';

const env = { APPDATA: 'C:\\A', LOCALAPPDATA: 'C:\\L' };

it('인자를 읽는다', () => {
  expect(parseArgs([], env)).toEqual({ mode: 'preview', dbPath: 'C:\\A\\CalendarTask\\Db\\calendar.db', statePath: 'C:\\L\\CalendarFIF\\import-state.json', show: [], yes: false });
  expect(parseArgs(['--upload', '--yes', '--db', 'D:\\x.db', '--state', 'D:\\s.json'], env)).toMatchObject({ mode: 'upload', yes: true, dbPath: 'D:\\x.db', statePath: 'D:\\s.json' });
  expect(parseArgs(['--follow'], env).mode).toBe('follow');
  expect(parseArgs(['--show', '2026-11-13', '--show', '2026-11-14'], env).show).toEqual(['2026-11-13', '2026-11-14']);
});
it('잘못된 인자는 사용법 오류다', () => {
  for (const argv of [['--upload', '--follow'], ['--what'], ['--show', '2026-02-30'], ['--db']]) {
    expect(() => parseArgs(argv, env)).toThrow(UsageError);
  }
});

function deps(overrides: Partial<CliDeps> = {}) {
  const lines: string[] = [];
  const connect = vi.fn();
  const d: CliDeps = { out: (line) => lines.push(line), connect, confirm: async () => true, now: () => 1, ...overrides };
  return { d, lines, connect };
}

it('미리보기는 로그인 없이 보고서를 출력한다', async () => {
  const db = makeSourceDb(mkdtempSync(join(tmpdir(), 'calfif-cli-')), [{ key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '2424F1', stime: 100 }]);
  const { d, lines, connect } = deps();
  expect(await main(['--preview', '--db', db, '--show', '2026-11-13'], env, d)).toBe(0);
  expect(connect).not.toHaveBeenCalled();
  expect(lines.join('\n')).toContain('옮길 날짜: 1');
  expect(lines.join('\n')).toContain('2026-11-13  배경색 F12424');
});
it('파일이 없으면 알리고 1로 끝난다', async () => {
  const { d, lines } = deps();
  expect(await main(['--db', 'C:\\nope\\calendar.db'], env, d)).toBe(1);
  expect(lines.join('\n')).toContain('DesktopCal 데이터 파일을 찾지 못했습니다: C:\\nope\\calendar.db');
});
it('올리기를 거절하면 로그인하지 않는다', async () => {
  const db = makeSourceDb(mkdtempSync(join(tmpdir(), 'calfif-cli-')), [{ key: 'dkcal_mdays_20261113', content: 'a', bgcolor: '', stime: 100 }]);
  const { d, connect } = deps({ confirm: async () => false });
  expect(await main(['--upload', '--db', db], env, d)).toBe(0);
  expect(connect).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project unit src/importer`
Expected: FAIL. `./report`, `./follow`, `./cli` 모듈을 찾지 못한다.

- [ ] **Step 3: 구현**

Interfaces와 "정해 둔 값"대로 쓴다.

- [ ] **Step 4: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: 전부 PASS, 타입 오류 없음.

- [ ] **Step 5: 실제 파일로 미리보기 확인(올리지 않음)**

Run: `npm run import -- --preview`
Expected: 사용자 PC의 DesktopCal 파일에서 읽은 보고서가 나온다. 전체 행은 845 이상, 건너뛴 형식 오류는 0, 색 변환표에 `2424F1 → F12424`가 있다. DesktopCal 폴더에 새 파일이 생기지 않는다. 출력을 파일로 저장하지 않는다.

- [ ] **Step 6: Commit**

```bash
git add src/importer package.json
git commit -m "feat: 가져오기 명령줄과 따라가기"
```

---

### Task 13: 실제 프로젝트 연결, 배포, 완료 기준 확인

**Files:**
- Create: `README.md`
- Modify: `package.json` (scripts)
- 만들되 커밋하지 않는 것: `.env.local`, `.firebaserc`, `build/firestore.rules`

**Interfaces:**
- Consumes: 앞의 모든 Task
- Produces: 배포된 웹앱, 옮겨진 기록, `README.md`의 실행 방법

`package.json` scripts 추가: `"deploy": "npm run build && tsx scripts/build-rules.ts && firebase deploy --only hosting,firestore:rules"`. `build-rules.ts`는 Task 4에서 만든 대로, `OWNER_UID`가 비었거나 `owner-test-uid`이면 배포용 규칙을 만들지 않고 오류로 끝난다.

- [ ] **Step 1: 사용자에게 Firebase 프로젝트 준비를 부탁한다(사용자 작업)**

화면별 안내를 드리고 아래 값을 받는다. 회사 네트워크에서 콘솔이 열리지 않으면 아이폰이나 집에서 한다.

1. https://console.firebase.google.com 에서 개인 Google 계정으로 프로젝트를 만든다. 애널리틱스는 끈다. 요금제는 무료(Spark) 그대로 둔다.
2. Firestore Database를 만든다. 위치는 `asia-northeast3 (Seoul)`, 프로덕션 모드.
3. Authentication에서 이메일/비밀번호 로그인을 켠다. 사용자 탭에서 계정을 하나 추가하고 그 UID를 복사한다.
4. 프로젝트 설정에서 웹 앱을 등록하고 설정값(apiKey, authDomain, projectId, appId)을 복사한다.
5. 이 PC에서 `! npx firebase login`으로 로그인한다.

- [ ] **Step 2: 설정값을 넣고 무료 한도를 다시 확인한다**

`.env.local`에 네 설정값과 `OWNER_UID`를 넣는다. `npx firebase use --add`로 프로젝트를 고른다. Firebase 공개 요금표에서 Firestore 무료 한도(하루 읽기, 쓰기, 저장 용량)와 호스팅 무료 한도를 확인해 `README.md`에 날짜와 함께 적는다.

Expected: 한도가 설계 문서 11절의 값(하루 읽기 5만, 쓰기 2만)보다 줄지 않았다. 줄었으면 사용자에게 알리고 멈춘다.

- [ ] **Step 3: 배포**

Run: `npm run deploy`
Expected: 규칙과 호스팅이 배포되고 `https://<프로젝트 ID>.web.app` 주소가 출력된다.

- [ ] **Step 4: PC에서 실시간 연결 확인**

배포 주소를 PC 브라우저 창 두 개로 열고 로그인한다. 한 창에서 저장한다.
Expected: 다른 창이 5초 안에 바뀐다. 바뀌지 않으면 `.env.local`에 `VITE_FORCE_LONG_POLLING=1`을 넣고 다시 배포해 확인한다.

- [ ] **Step 5: 기존 기록 미리보기를 사용자와 확인한다**

Run: `npm run import -- --preview --show <사용자가 고른 날짜> --show <다른 날짜>`
Expected: 사용자가 고른 날짜들의 배경색과 메모가 DesktopCal 화면과 같다고 사용자가 확인한다. 다르면 올리지 않고 멈춘다.

- [ ] **Step 6: 올리기**

Run: `npm run import -- --upload`
Expected: 대조 보고서에서 `원본 날짜`와 `클라우드와 같음`의 수가 같고 `다름`과 `클라우드에 없음`이 0이다. 웹앱에 기존 기록이 보인다.

- [ ] **Step 7: 따라가기 확인**

Run: `npm run import -- --follow`를 켜 둔 채로 사용자가 DesktopCal에서 날짜 하나를 고친다.
Expected: 1분 안에 웹앱의 같은 날짜가 바뀐다. 터미널에는 시각과 건수만 찍힌다.

- [ ] **Step 8: 아이폰 확인(사용자 작업)**

사용자가 아이폰 Safari로 배포 주소를 열고 로그인한다.
Expected: 달력이 한 화면에 보인다. 아이폰에서 메모, 완료 표시, 배경색을 고치면 PC 브라우저에 5초 안에 보인다. PC에서 고치면 아이폰에 5초 안에 보인다. 비행기 모드에서 고친 내용이 `오프라인 (대기 1건)`으로 보이다가 연결되면 올라간다. 비행기 모드에서 주소를 다시 열어도 앱이 뜬다.

- [ ] **Step 9: `README.md` 쓰기**

내용: 무엇을 하는 저장소인지 세 줄, 실행 방법(`npm run dev:emu`, `npm test`, `npm run test:emu`, `npm run deploy`), 가져오기와 따라가기 사용법, 전환 기간에 지킬 점(따라가기는 DesktopCal에서 CalendarFIF로 한 방향이고, 아이폰에서 고친 내용은 DesktopCal에 나타나지 않는다), 확인한 무료 한도와 날짜.

- [ ] **Step 10: 전체 확인과 Commit**

Run: `npm test && npm run test:emu && npx tsc --noEmit && git status --short`
Expected: 전부 PASS. `git status`에 `.env.local`, `.firebaserc`, `build/`, `.tools/`, `*.db`가 나타나지 않는다.

```bash
git add README.md package.json
git commit -m "docs: 실행 방법과 가져오기 사용법"
```
