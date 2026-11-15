# 메모 편집 도구, 알림, 카운트다운, 셀 설정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편집 화면을 DesktopCal의 메모 편집 창처럼(완료, 배경, 알림, 카운트다운 도구 단추) 바꾸고, 알림과 카운트다운을 만들어 웹앱, PC 앱, 위젯이 같이 쓰게 하고, 웹앱 설정에 `셀` 묶음을 만든다.

**Architecture:** 알림과 카운트다운은 달 문서 밖의 새 문서 `users/{uid}/data/events`에 둔다. 반복과 울릴 때는 `src/core/events.ts`의 순수 함수가 계산한다. 웹앱과 PC 앱의 화면은 `src/web/eventsStore.ts`로 문서를 구독하고 보내지 않은 변경을 브라우저 저장소에 둔다. 울리기는 화면의 `alarmClock`이 하고, PC 앱은 메인 프로세스가 맨 위의 작은 창을 띄우며, 아이폰은 Scriptable 위젯 스크립트가 기기 알림을 예약한다.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 5(+ happy-dom), Firebase JS SDK 13, firebase-tools 15 에뮬레이터, Electron 45, Scriptable(위젯). UI 프레임워크는 쓰지 않는다.

**Spec:** `docs/superpowers/specs/2026-11-15-memo-tools-design.md`. DesktopCal 조사 기록은 `build/desktopcal-memo-research.md`(git 밖, 이 폴더에만 있다).

## Global Constraints

- 화면 문구는 한국어다. 코드의 식별자는 영어, 주석은 이 저장소의 다른 파일처럼 한국어로 쓴다.
- 비용 0원. Firebase Spark만. Cloud Functions, 유료 서비스, 새 계정이 필요한 서버를 쓰지 않는다.
- 달 문서(`users/{uid}/months/{YYYY-MM}`)의 형식과 병합 규칙, `src/core/merge.ts`, 기존 `src/sync/*.ts`는 고치지 않는다. 새 파일은 더해도 된다. `src/web/ui/pager.ts`도 고치지 않는다(2026-11-15에 부드럽게 맞춘 것이다).
- 브랜치는 `memo-tools`. `git add`는 경로를 적어서 한다. `.mcp.json`은 커밋하지 않는다. 커밋 메시지는 이 저장소의 형식(`feat: ...` 한국어 한 줄과 본문)이고 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 이 폴더는 사용자의 실제 Firebase 프로젝트에 연결돼 있다. 실행자는 `npm run deploy`, `npm run build`, `npm run import`, `npm run dev`, `npm run desktop`, `npm run desktop:pack`, `firebase deploy`, `firebase use`를 실행하지 않고 `release/` 아래의 실행 파일을 띄우지 않는다. 쓸 수 있는 명령: `npm test`, `npx vitest run ...`, `npx tsc --noEmit`, `npm run test:emu`, `npm run test:touch`, `npm run test:users`, `npm run desktop:smoke`(`CALFIF_SMOKE`로 장면 고르기), `npm run widget:build`, `npm run widget:preview`, `npx tsx scripts/...`. 포트를 쓰는 명령(에뮬레이터, 개발 서버, `desktop:smoke`, `test:touch`, `test:users`)은 한 번에 하나만 돌린다.
- DesktopCal의 파일, 프로세스, 창, 서버를 건드리지 않는다. DesktopCal의 코드, 그림, 소리를 가져다 쓰지 않는다. 사용자의 앱(`CalendarFIF.exe`), 탐색기를 끄거나 건드리지 않는다. 화면을 캡처하지 않는다(PC 앱 시험이 자기 창을 찍는 것은 지금처럼 된다).
- 테스트 자료는 지어낸 것만 쓴다. 사용자의 이메일, 프로젝트 ID, API 키, UID를 파일, 테스트, 로그, 커밋 메시지에 적지 않는다(`demo-calfif`, `owner-test-uid`, `test@example.com`만).
- 이 계획의 예와 설치된 도구의 문법이 다르면 설치된 패키지의 타입 정의를 따른다. 테스트의 단언은 뜻을 바꾸지 않는 최소한의 수정만 하고 보고서에 적는다.
- 날짜 열쇠는 `'YYYY-MM-DD'`, 시각은 `'HH:MM'`(24시간, 두 자리)이다. 울릴 때는 기기의 지역 시각으로 계산한다(`new Date(y, m - 1, d, hh, mm)`).
- 손가락으로 넘기기의 부드러움을 지킨다: 달력이 다시 그리는 일은 쪽 서명(`calendar.ts`의 `drawPage`)을 거친다. 알림·카운트다운이 바뀌지 않았으면 쪽을 다시 만들지 않는다.

## Review Focus

1. 옛 앱(PC 0.6.0, 옛 위젯)과 새 앱이 같이 돌 때: 옛 앱은 `data/events`를 모르고 달 문서만 쓴다. 달 문서와 알림 문서가 서로를 지우지 않아야 한다.
2. 항목 하나를 고쳐 쓸 때 옛 칸이 남지 않아야 한다(반복 끝을 지웠는데 `until`이 남는 것). 쓰기는 `mergeFields`로 항목 전체를 바꾼다(Task 2).
3. 아이폰 Safari에서 편집 화면의 도구 단추와 시트가 글자판과 겹치지 않고, 끌어 닫기와 바깥 누르기가 지금처럼 동작해야 한다(Task 5, 6, 11).
4. 같은 알림이 한 기기에서 두 번 울리지 않아야 한다(다시 열기, 잠자기 뒤, 여러 탭)(Task 8).
5. 반복의 끝(`count`, `until`)과 없는 날(31일, 2월 29일, 없는 음력 날)이 계산과 표시와 예약에서 같아야 한다(Task 1을 모두가 쓴다).

---

### Task 1: 알림·카운트다운 자료와 반복 계산

**Files:**
- Create: `src/core/events.ts`
- Test: `src/core/events.test.ts`

**Interfaces:**
- Consumes: `addDays(dateKey, n)`(`src/core/layout.ts`), `lunarDate(dateKey)`, `solarOfLunar(year, month, day, leap?)`(`src/core/lunar.ts`), `holidayLabel(dateKey)`(`src/core/holidays.ts`, 공휴일이 아니면 `''`).
- Produces (모두 `src/core/events.ts`에서 export):
  ```ts
  export type RepeatFreq = 'none' | 'daily' | 'workday' | 'weekly' | 'monthly' | 'yearly' | 'lunarYearly';
  export type RepeatRule = { freq: RepeatFreq; until?: string; count?: number };
  export type CountdownKind = 'basic' | 'birthday' | 'anniversary' | 'holiday' | 'exam';
  export const ADVANCE_DAYS: readonly number[]; // [0, 1, 2, 3, 5, 7]
  export type AlarmRecord = { type: 'alarm'; date: string; text: string; done: boolean; repeat: RepeatRule; time: string; advance: number[]; editedAt: number; editedBy: string };
  export type CountdownRecord = { type: 'countdown'; date: string; text: string; done: boolean; repeat: RepeatRule; kind: CountdownKind; showBottom: boolean; editedAt: number; editedBy: string };
  export type EventRecord = AlarmRecord | CountdownRecord;
  export type EventMap = Record<string, EventRecord>;
  export function isEventId(id: string): boolean; // /^[A-Za-z0-9]{1,40}$/
  export function newEventId(random?: () => number): string; // 20자 [A-Za-z0-9], 기본은 crypto.getRandomValues
  export function parseEventRecord(raw: unknown): EventRecord | null;
  export function parseEventMap(raw: unknown): EventMap;
  export function occurrences(rec: EventRecord, from: string, to: string): string[];
  export type AlarmTrigger = { key: string; id: string; at: Date; occurrence: string; advance: number; time: string; text: string };
  export function alarmTriggers(id: string, rec: EventRecord, from: Date, to: Date): AlarmTrigger[];
  export function allAlarmTriggers(items: EventMap, from: Date, to: Date): AlarmTrigger[];
  export type CountdownStatus = { date: string; days: number; age: number | null };
  export function countdownStatus(rec: CountdownRecord, today: string): CountdownStatus | null;
  export type DayEventLine = { id: string; type: 'alarm' | 'countdown'; text: string; time: string; kind: CountdownKind | null; done: boolean };
  export function eventsByDate(items: EventMap, from: string, to: string): Map<string, DayEventLine[]>;
  export type CountdownChip = { id: string; text: string; kind: CountdownKind; date: string; days: number; age: number | null };
  export function countdownChips(items: EventMap, today: string): CountdownChip[];
  export function countdownLabel(days: number): string;
  export const REPEAT_LABELS: Record<RepeatFreq, string>;
  export const COUNTDOWN_KIND_LABELS: Record<CountdownKind, string>;
  export const ADVANCE_LABELS: Record<number, string>;
  ```

규칙(테스트가 모두 확인한다):
- `parseEventRecord`: `type`이 둘 중 하나, `date`가 실제 날짜, `text`가 1~200자 문자열(앞뒤 공백은 잘라서 셈), `done` 불(없으면 false), `repeat.freq`가 일곱 중 하나(없으면 `none`), `until`은 실제 날짜일 때만, `count`는 1~99999의 정수일 때만 남긴다. 알림은 `time`이 `'HH:MM'`(00:00~23:59), `advance`는 `ADVANCE_DAYS`에 든 것만 중복 없이 오름차순으로, 비면 `[0]`, 5개를 넘으면 앞의 5개. 카운트다운은 `kind`(모르면 `basic`), `showBottom`(없으면 true). `editedAt`은 유한한 수(아니면 0), `editedBy`는 문자열(아니면 `''`). 그 밖의 칸은 버린다. 틀리면 `null`.
- `parseEventMap(raw)`: 객체의 각 항목을 `isEventId`와 `parseEventRecord`로 거르고 통과한 것만.
- `occurrences(rec, from, to)`: `from`~`to`(포함), `rec.date` 이전은 없다. 오름차순.
  - `none`: `rec.date`.
  - `daily`: 매일. `workday`: 월~금이고 `holidayLabel(d) === ''`인 날(첫 날 `rec.date`가 근무일이 아니어도 그 뒤의 근무일부터 센다). `weekly`: `rec.date`와 같은 요일. `monthly`: 같은 날짜(그날이 없는 달은 건너뛰고 세지 않는다). `yearly`: 같은 월일(2월 29일은 윤년에만). `lunarYearly`: `lunarDate(rec.date)`의 음력 월일을 해마다 평달로 `solarOfLunar`(윤달에 만든 것도 평달로; 그해에 그날이 없거나 표 밖이면 건너뛰고 세지 않는다).
  - `count`: 처음 걸린 날부터 센 횟수까지. `until`: 그날까지(포함). 둘 다 있으면 먼저 끝나는 쪽.
  - 범위가 길어도 빨라야 한다: `from` 이전을 하루씩 걷지 말고, 셀 필요가 없으면(`count` 없음) 바로 `from` 근처로 건너뛴다. `workday`에 `count`가 있으면 `rec.date`부터 걷되 100년을 넘지 않는다.
- `alarmTriggers(id, rec, from, to)`: 카운트다운이거나 `done`이면 `[]`. 걸리는 날 D(`occurrences(rec, ymd(from)+0, ymd(to)+7일)`)와 `advance`의 a마다 `D - a일`의 `time`(지역 시각)이 `from <= at < to`인 것. `key = \`${id}@${D}@${a}\``, `text = rec.text`.
- `allAlarmTriggers`: 모든 항목의 것을 `at`, 같으면 `key` 오름차순.
- `countdownStatus(rec, today)`: `repeat.freq === 'none'`이면 `{ date: rec.date, days: rec.date - today(일수, 지났으면 음수) }`. 반복이면 `occurrences(rec, today, addDays(today, 800))`의 첫 날(없으면 `null`), `days >= 0`. `age`: `kind === 'birthday'`이고 반복이 `yearly`면 그날의 해 - `rec.date`의 해, `lunarYearly`면 음력 해의 차, 그 밖은 `null`.
- `eventsByDate(items, from, to)`: 날짜마다 그날 걸린 항목의 줄. 알림이 먼저(`time`, 같으면 `text` 순), 그다음 카운트다운(`text` 순). 알림의 `time`은 `rec.time`, 카운트다운은 `''`, `kind`는 카운트다운만. 걸린 것이 없는 날짜는 넣지 않는다.
- `countdownChips(items, today)`: `type === 'countdown' && showBottom && !done`이고 `countdownStatus`가 `null`이 아닌 것. 순서: `days >= 0`인 것을 `days` 오름차순, 그다음 `days < 0`인 것을 `days` 내림차순(최근에 지난 것 먼저), 같으면 `text` 순.
- `countdownLabel(days)`: `0` → `'오늘'`, 양수 → `'${days}일 남음'`, 음수 → `'${-days}일 지남'`.
- `REPEAT_LABELS`: none `안 함`, daily `매일`, workday `근무일`, weekly `매주`, monthly `매달`, yearly `매년`, lunarYearly `음력 매년`. `COUNTDOWN_KIND_LABELS`: basic `기본`, birthday `생일`, anniversary `기념일`, holiday `명절`, exam `시험`. `ADVANCE_LABELS`: 0 `당일`, 1 `하루 전`, 2 `이틀 전`, 3 `사흘 전`, 5 `5일 전`, 7 `일주일 전`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `src/core/events.test.ts`에 적어도 다음 이름과 단언:
  - `parseEventRecord는 형식이 맞는 알림과 카운트다운만 받고 기본값을 채운다`: 빈 `advance` → `[0]`, `[7,0,0,4]` → `[0,7]`, 201자 글 → `null`, `time: '24:00'` → `null`, 모르는 칸은 결과에 없다.
  - `매달 31일은 31일이 없는 달을 건너뛰고 횟수에 세지 않는다`: `{date:'2026-01-31', repeat:{freq:'monthly', count:3}}`의 `2026-01-01~2026-12-31` → `['2026-01-31','2026-03-31','2026-05-31']`.
  - `매년 2월 29일은 윤년에만`: `2024-02-29`의 2024~2032 → `['2024-02-29','2028-02-29','2032-02-29']`.
  - `근무일은 주말과 공휴일을 빼고`: `2026-09-21`부터 `2026-09-30`까지 → 추석 연휴(9/24~9/26)와 주말을 뺀 날들(테스트는 `holidayLabel`이 그날 공휴일인지로 기대값을 만든다).
  - `음력 매년은 그해의 양력 날로 오고 until을 지킨다`: `lunarDate`와 `solarOfLunar`로 만든 기대값.
  - `알림의 미리 알림은 그날 그 시각에 울린다`: `{date:'2026-11-20', time:'09:30', advance:[0,1]}`의 `2026-11-18T00:00`~`2026-11-21T00:00` → `at`이 `2026-11-19 09:30`과 `2026-11-20 09:30`, `key`는 `id@2026-11-20@1`, `id@2026-11-20@0`.
  - `완료한 알림과 카운트다운은 울리지 않는다`.
  - `반복 없는 카운트다운은 지난 날을 음수로, 매년 생일은 다음 생일과 나이를`: `{date:'1983-03-02', kind:'birthday', repeat:{freq:'yearly'}}`, today `2026-11-15` → `{date:'2027-03-02', days:107, age:44}`.
  - `달력 아래 줄은 다가오는 것 먼저 가까운 순, 지난 것은 최근 순, 숨김과 완료는 빠진다`.
  - `countdownLabel은 오늘, N일 남음, N일 지남`.
  - `날짜별 줄은 알림을 시각 순으로 먼저, 카운트다운을 뒤에`.
  - `범위가 몇십 년이어도 빨리 끝난다`: `daily`, `rec.date` 1950년, `from/to` 2026년의 한 달 → 50ms 안(대략 확인용, `performance.now()`로).
- [ ] **Step 2: 돌려 실패를 본다** — `npx vitest run src/core/events.test.ts` → 모듈이 없어 실패.
- [ ] **Step 3: 구현한다** — 날짜 차이는 UTC 기준 일수(`Date.UTC`)로 셈해 서머타임과 상관없게 한다.
- [ ] **Step 4: 통과를 본다** — 같은 명령, 그리고 `npx tsc --noEmit`.
- [ ] **Step 5: 커밋** — `git add src/core/events.ts src/core/events.test.ts` → `feat: 알림과 카운트다운의 자료와 반복 계산을 더한다`.

---

### Task 2: 알림 문서의 동기화와 보안 규칙

**Files:**
- Create: `src/sync/eventsDoc.ts`, `src/sync/eventsDoc.test.ts`, `src/sync/firestoreEvents.ts`, `src/web/eventsStore.ts`, `src/web/eventsStore.test.ts`
- Modify: `firestore.rules.template`, `tests/emulator/rules.test.ts`

**Interfaces:**
- Consumes: Task 1의 `EventRecord`, `EventMap`, `parseEventMap`, `isEventId`. `KeyValueStore`(`src/sync/outbox.ts`).
- Produces:
  ```ts
  // src/sync/eventsDoc.ts
  export type EventChange = EventRecord | 'delete';
  export function parseEventsDoc(data: unknown): EventMap; // data.items를 parseEventMap
  export function buildEventsWrite(changes: Record<string, EventChange>, sentinels: { deleteField(): unknown; serverTimestamp(): unknown }): { data: { items: Record<string, unknown>; updatedAt: unknown }; fields: string[][] } | null;
  // fields는 mergeFields로 쓸 경로들: 항목마다 ['items', id], 끝에 ['updatedAt']. 바꿀 것이 없으면 null.
  // src/sync/firestoreEvents.ts
  export class FirestoreEventsSource implements EventsSource {
    constructor(db: Firestore, uid: string); // 문서: doc(db, 'users', uid, 'data', 'events')
    subscribe(onData: (items: EventMap) => void, onError: (e: unknown) => void): () => void; // 문서가 없으면 {}
    write(changes: Record<string, EventChange>): Promise<void>; // setDoc(ref, data, { mergeFields: fields.map((p) => new FieldPath(...p)) })
  }
  // src/web/eventsStore.ts
  export type EventsSource = { subscribe(onData: (items: EventMap) => void, onError: (e: unknown) => void): () => void; write(changes: Record<string, EventChange>): Promise<void> };
  export type EventsView = { items(): EventMap; version(): number; onChange(fn: () => void): () => void };
  export class EventsStore implements EventsView {
    constructor(opts: { source: EventsSource; storage: KeyValueStore; uid: string; editedBy: string; now?: () => number; online?: () => boolean });
    items(): EventMap; version(): number; loaded(): boolean;
    onChange(fn: () => void): () => void;
    save(id: string, rec: EventRecord): void; // editedAt = now(), editedBy를 채워 보내지 않은 변경에 넣고 보낸다
    remove(id: string): void;
    flush(): Promise<void>;
    destroy(): void;
  }
  ```
- 보내지 않은 변경은 저장소 열쇠 `calfif.eventsPending.<uid>`에 `{ [id]: { change: EventRecord | 'delete', editedAt: number } }` JSON으로 둔다. 읽지 못하면 비운 것으로 본다.
- `items()` = 서버 값 위에 보내지 않은 변경(삭제는 뺀다). 서버 스냅숏이 오면 보내지 않은 변경 중 서버가 따라잡은 것(저장: 서버의 그 항목 `editedAt >= 변경의 editedAt`; 삭제: 서버에 그 항목이 없음)을 지운다. 서버의 그 항목이 변경보다 새것이면(`editedAt`이 더 큼) 변경을 버린다.
- `flush()`: 보내지 않은 변경을 한 번에 `write`한다. 실패하면 남기고, `window`의 `online` 이벤트와 30초 타이머로 다시 한다(있는 동안만). 동시에 두 번 보내지 않는다.
- `items()`나 보내지 않은 변경이 바뀔 때마다 `version`을 올리고 듣는 쪽을 부른다.

보안 규칙(`firestore.rules.template`의 달 문서 규칙 아래):
```
    // 알림과 카운트다운: 문서 하나(events). 달 문서와 같은 사람만.
    match /users/{uid}/data/{docId} {
      allow read, write: if signedIn()
        && request.auth.uid == uid
        && docId == 'events'
        && (uid == '__OWNER_UID__' || isActive(uid));
    }
```

- [ ] **Step 1: 실패하는 테스트**
  - `src/sync/eventsDoc.test.ts`: `buildEventsWrite는 항목마다 mergeFields 경로를 만들고 삭제는 deleteField로`, `바꿀 것이 없으면 null`, `parseEventsDoc은 형식이 틀린 항목을 버린다`.
  - `src/web/eventsStore.test.ts`(가짜 source와 메모리 저장소): `저장하면 바로 items에 보이고 저장소에 남고 보낸다`, `서버가 따라잡으면 보내지 않은 변경을 지운다`, `서버의 더 새 값이 이긴다`, `보내기에 실패하면 남겼다가 online에 다시 보낸다`, `다시 열면 저장소의 보내지 않은 변경을 이어서 보낸다`, `삭제는 서버에서 사라지면 끝난다`, `바뀔 때마다 version이 오르고 알린다`.
  - `tests/emulator/rules.test.ts`: `소유자는 자기 events 문서를 읽고 쓴다`, `events 말고 다른 data 문서는 못 쓴다`, `허가된 사용자는 자기 events만, 중지된 사용자는 못 쓴다`, `다른 계정의 events는 못 읽는다`(이 파일의 기존 도우미를 쓴다).
- [ ] **Step 2: 실패를 본다** — `npx vitest run src/sync/eventsDoc.test.ts src/web/eventsStore.test.ts`, `npm run test:emu`.
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과를 본다** — 같은 명령들과 `npx tsc --noEmit`, `npm test`. 에뮬레이터 시험(`npm run test:emu`)은 `build/firestore.rules`를 시험용 UID로 덮어쓴다(괜찮다).
- [ ] **Step 5: 커밋** — `feat: 알림과 카운트다운 문서를 동기화하고 보안 규칙에 더한다`.

---

### Task 3: 소리와 설정 칸

**Files:**
- Create: `src/web/tones.ts`, `src/web/tones.test.ts`
- Modify: `src/web/desktop/tone.ts`(새 모듈을 쓰게), `src/web/desktop/tone.test.ts`, `src/web/prefs.ts`, `src/web/prefs.test.ts`, `src/web/appearance.ts`, `src/web/appearance.test.ts`, `src/web/styles.css`(`.grid`의 간격을 `var(--cell-gap, 1px)`로)

**Interfaces:**
- Produces:
  ```ts
  // src/web/tones.ts
  export type ToneName = 'done' | 'chime' | 'bell';
  export type ToneContext = Pick<AudioContext, 'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'resume' | 'state'>;
  export function playTone(name: ToneName, make?: () => ToneContext): void; // 같은 AudioContext 하나를 다시 쓴다. 실패하면 조용히
  export function unlockAudio(make?: () => ToneContext): void; // 사용자가 누를 때 불러 아이폰의 소리를 연다(resume)
  // src/web/prefs.ts (Prefs에 더함, version은 1 그대로)
  export type CellGap = 'narrow' | 'normal' | 'wide';     // 1px, 2px, 4px
  export type LineSpacing = 'tight' | 'normal' | 'loose';  // MEMO_METRICS의 줄 높이 × 0.9, × 1, × 1.15 (반올림)
  export type AlarmTone = 'none' | 'chime' | 'bell';
  // Prefs += { cellGap: CellGap; lineSpacing: LineSpacing; showAlarmTime: boolean; doneTone: 'none' | 'short'; alarmTone: AlarmTone }
  // DEFAULT_PREFS += { cellGap: 'narrow', lineSpacing: 'normal', showAlarmTime: true, doneTone: 'none', alarmTone: 'chime' }
  export const CELL_GAP_PX: Record<CellGap, number>;            // narrow 1, normal 2, wide 4
  export const LINE_SPACING_FACTOR: Record<LineSpacing, number>; // tight 0.9, normal 1, loose 1.15
  // applyPrefs가 <html>에 --cell-gap: <px>px 를 건다
  // prefsAppearance(p)는 showAlarmTime, alarmTone, doneTone(p.doneTone)도 넘긴다
  // src/web/appearance.ts (Appearance에 더함)
  // showAlarmTime: boolean (기본 true), alarmTone: AlarmTone (기본 'chime')
  ```
- `done` 소리는 지금 `tone.ts`의 소리(880Hz 사인, 0.12초)와 같다. `chime`: 세 음(예: 880, 1175, 1568Hz를 0.18초씩), `bell`: 배음이 있는 종소리(1~1.5초 감쇠). 소리 크기는 지금처럼 작게(0.15 안팎).
- `playDoneTone()`은 `playTone('done')`을 부르는 얇은 함수로 남긴다(PC 앱의 기존 호출이 그대로 돈다).

- [ ] **Step 1: 실패하는 테스트** — `tones.test.ts`: `세 소리가 가짜 AudioContext로 오실레이터를 만든다`, `만들기가 실패해도 던지지 않는다`, `unlockAudio는 멈춘 컨텍스트를 resume한다`. `prefs.test.ts`: 새 칸의 기본값과 틀린 값의 되돌림, `applyPrefs가 --cell-gap을 건다`, `prefsAppearance가 showAlarmTime과 alarmTone과 doneTone을 넘긴다`. `appearance.test.ts`: 새 칸의 기본과 되돌림.
- [ ] **Step 2: 실패를 본다** — `npx vitest run src/web/tones.test.ts src/web/prefs.test.ts src/web/appearance.test.ts src/web/desktop/tone.test.ts`.
- [ ] **Step 3: 구현한다.** `Appearance`를 받는 다른 곳(PC 설정, 저장)이 타입 검사를 통과하게 맞춘다.
- [ ] **Step 4: 통과** — 같은 명령, `npx tsc --noEmit`, `npm test`.
- [ ] **Step 5: 커밋** — `feat: 효과음 모듈과 셀 설정 칸을 더한다`.

---

### Task 4: 달력 칸의 알림·카운트다운 줄과 달력 아래 줄

**Files:**
- Modify: `src/web/ui/calendar.ts`, `src/web/ui/calendar.test.ts`, `src/web/styles.css`, `src/web/desktop.css`

**Interfaces:**
- Consumes: Task 1의 `eventsByDate`, `countdownChips`, `countdownLabel`, `DayEventLine`, `CountdownChip`. Task 2의 `EventsView`. Task 3의 `LINE_SPACING_FACTOR`, `Appearance.showAlarmTime`.
- Produces:
  ```ts
  // CalendarDeps에 더함
  events?: EventsView;
  // WebLook에 더함
  export type WebLook = { memoSize: MemoSize; lineSpacing?: LineSpacing };
  ```
- 칸 그리기(`fillGrid`): 그 쪽의 첫 칸~끝 칸 날짜로 `eventsByDate`를 한 번 부르고, 칸마다 그날의 줄을 메모 줄 앞에 둔다. 줄은 메모 줄과 같은 `span.ln`에 `ev alarm` 또는 `ev countdown`(생일이면 `birthday`도) 클래스를 더하고, 완료면 `done`. 알림 글은 `appearance.showAlarmTime`이면 `"09:30 회의"`, 아니면 `"회의"`. 표시(종, 모래시계, 케이크)는 CSS의 `::before`(인라인 SVG를 `mask`나 배경으로)로 그린다. 줄 수 제한(`visibleLines`)은 알림·카운트다운 줄과 메모 줄을 합친 목록에 건다. 줄 머리(번호, 점)는 메모 줄에만 붙인다.
- 쪽 서명(`drawPage`의 `signature`)에 `deps.events?.version() ?? 0`을 넣는다. `deps.events.onChange`가 오면 `redraw()`와 아래 줄 다시 그리기를 한다(쪽 다시 그리기는 `pager.refresh()`가 손가락으로 넘기는 동안 미룬다). `destroy`에서 끊는다.
- 웹 모양의 메모 줄 높이는 `MEMO_METRICS`의 `line`에 `LINE_SPACING_FACTOR[web.lineSpacing ?? 'normal']`을 곱해 반올림한다(글자 크기는 그대로). 
- 달력 아래 줄: 달력 섹션(`el`) 안 pager 다음에 `div.cd-bar`(role `list`). `countdownChips(items, today)`가 비면 `hidden`. 칩마다 `button.cd-chip`(role `listitem` 안에): 글, 생일 나이가 있으면 `(44살)`, 그리고 `countdownLabel(days)`. 누르면 `deps.onOpenDay(chip.date)`. PC 앱(`deps.desktop`)도 같은 줄을 둔다(클릭이 아니라 두 번 누르기로 연다: 지금 칸과 같은 규칙). 오늘이 바뀌면(자정, 다시 보일 때) 다시 그린다.
- CSS: 폰에서 아래 줄은 한 줄 높이로 옆으로 스크롤한다(`overflow-x: auto`, 스크롤바 숨김). 쪽 높이가 줄어들므로 칸 높이 재기는 기존 `ResizeObserver`가 맡는다.

- [ ] **Step 1: 실패하는 테스트** (`calendar.test.ts`, 가짜 `EventsView`):
  - `그날의 알림과 카운트다운이 메모 줄 앞에 나온다`(알림 시각 순, 카운트다운 뒤, 메모 앞).
  - `알림 시각 표시를 끄면 시각 없이 글만`.
  - `완료한 알림은 취소선 클래스`.
  - `알림 자료가 바뀌면 그 쪽을 다시 그리고, 그대로면 다시 그리지 않는다`(칸 요소의 같음으로).
  - `달력 아래 줄은 다가오는 카운트다운을 가까운 순으로, 없으면 숨긴다`, `칩을 누르면 그 날짜를 연다`.
  - `줄 간격 넓게는 메모 줄 높이를 1.15배로`(`--memo-line` 값).
- [ ] **Step 2: 실패를 본다** — `npx vitest run src/web/ui/calendar.test.ts`.
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과** — 같은 명령, `npx tsc --noEmit`, `npm test`.
- [ ] **Step 5: 커밋** — `feat: 달력 칸에 알림과 카운트다운을 적고 달력 아래에 남은 날을 보인다`.

---

### Task 5: 편집 화면의 도구 단추와 배경 색 상자

**Files:**
- Create: `src/web/ui/palette.ts`, `src/web/ui/palette.test.ts`
- Modify: `src/web/ui/editor.ts`, `src/web/ui/editor.test.ts`, `src/web/styles.css`, `src/web/desktop.css`, `scripts/touch-check.ts`(편집 화면의 배경색 고르기 확인), `src/web/main.ts`(편집 완료 알람)

**Interfaces:**
- Consumes: `PALETTE`(`src/core/color.ts`), Task 3의 `playTone`.
- Produces:
  ```ts
  // src/web/ui/palette.ts
  export function mountPalette(anchor: HTMLElement, opts: { colors: string[]; current: string; onPick(color: string): void; onClose(): void }): { el: HTMLElement; destroy(): void };
  // colors의 ''는 "없음". role="radiogroup" 안의 button.swatch(role radio, aria-checked, data-color). 방향키로 옮기고 Enter/Space로 고른다.
  // 고르면 onPick 뒤 onClose. 바깥을 누르거나(pointerdown) Esc면 onClose. anchor 위에(공간이 없으면 아래에) 띄운다.
  // src/web/ui/editor.ts의 props에 더함
  doneTone?: 'none' | 'short';             // 완료를 누를 때 소리
  toolbar?: { onAlarm?(): void; onCountdown?(): void }; // Task 6이 채운다. 없으면 그 단추를 숨긴다
  ```
- 편집 화면의 새 구조(시트 안, 위에서 아래로): `.sheet-bar`(취소, 제목과 음력·공휴일, 저장 — 지금 그대로), `.ev-strip`(빈 상자, `hidden`; Task 6이 채운다), `.field.grow`(`textarea.memo-input`, 바탕에 고른 색: 칸과 같은 방식의 `--day-color`를 시트 바탕에 섞은 색), `.editor-tools`(`role="toolbar"`, `aria-label="편집 도구"`): `button.tool.done`(`완료`), `button.tool.color`(`배경`, 안에 지금 색의 점 `span.dot`), `button.tool.alarm`(`알림`), `button.tool.countdown`(`카운트다운`). 단추마다 작은 아이콘(인라인 SVG)과 글을 둔다.
- 지금의 `배경색` 줄(`.swatches`)과 `완료 표시` 단추(`.donebtn`)는 없앤다. `완료`는 지금 `donebtn`이 하던 일(`toggleDoneInRange`)을 하고, `doneTone === 'short'`이면 `playTone('done')`.
- `배경`을 누르면 `mountPalette(colorButton, { colors: ['', ...PALETTE, (목록 밖의 지금 색)], ... })`. 고르면 `color`가 바뀌고 메모 칸 바탕과 점이 바뀐다. 상자가 열린 동안 시트의 끌어 닫기는 상자 위에서 시작되지 않는다(상자는 시트 안에 붙인다).
- 저장, 취소, 바깥 누르기, Esc, Ctrl+Enter, Tab 돌기, 끌어 닫기, 보이는 영역 따라가기, 처음 초점은 지금과 같다. 바뀐 것이 있는지(`changed`)는 글과 색으로 본다.
- `main.ts`: 편집 화면에 `doneTone: prefs?.doneTone ?? appearance?.doneTone`을 넘긴다. 저장할 때 PC 앱이 내던 `playDoneTone()`은 지금처럼 둔다(편집 화면 안의 완료 소리와 다르다).
- `scripts/touch-check.ts`: 지금 `.sheet .swatch`를 바로 누르는 확인을, `배경` 단추를 누르고 뜬 상자의 색을 누르는 것으로 바꾼다. 확인하는 것(고른 색이 저장되어 칸에 칠해진다)은 그대로.

- [ ] **Step 1: 실패하는 테스트** — `palette.test.ts`: `지금 색이 표시되고 누르면 고른 뒤 닫힌다`, `방향키와 Enter로 고른다`, `바깥을 누르거나 Esc면 닫기만`. `editor.test.ts`: 기존 테스트 중 `.swatch`/`.donebtn`을 쓰는 것을 새 구조로 고치고 더한다 — `도구 단추 넷이 있고 알림과 카운트다운은 toolbar가 없으면 숨는다`, `배경을 눌러 색을 고르면 메모 칸 바탕과 점이 그 색이 되고 저장에 들어간다`, `완료는 지금 줄을 [+]로 바꾸고 doneTone이 short면 소리를 낸다`(playTone을 가짜로), `색만 바꿔도 바깥 누르기로 닫히지 않는다`.
- [ ] **Step 2: 실패를 본다** — `npx vitest run src/web/ui/palette.test.ts src/web/ui/editor.test.ts`.
- [ ] **Step 3: 구현한다.** 폰에서 글자판이 열려도 도구 줄이 보이도록 시트의 아래 끝에 둔다(지금 시트가 `--vv-height`를 따른다).
- [ ] **Step 4: 통과** — 같은 명령, `npx tsc --noEmit`, `npm test`, `npm run test:touch`(32줄 모두 통과; 실패하면 원인을 고친다. 이 PC의 Windows 애니메이션 효과가 꺼져 있어 부드러운 스크롤은 시험이 켠다).
- [ ] **Step 5: 커밋** — `feat: 편집 화면을 도구 단추와 배경 색 상자로 바꾼다`.

---

### Task 6: 알림과 카운트다운 시트

**Files:**
- Create: `src/web/ui/eventSheet.ts`, `src/web/ui/eventSheet.test.ts`
- Modify: `src/web/ui/editor.ts`, `src/web/ui/editor.test.ts`, `src/web/styles.css`, `src/web/desktop.css`

**Interfaces:**
- Consumes: Task 1의 모든 자료형과 라벨, `newEventId`, `eventsByDate`, `countdownStatus`, `countdownLabel`. Task 2의 `EventsView`. Task 5의 편집 화면 구조(`.ev-strip`, `toolbar`).
- Produces:
  ```ts
  // src/web/ui/eventSheet.ts
  export type EventSheetProps = {
    type: 'alarm' | 'countdown';
    dateKey: string;
    id?: string;              // 있으면 고치기
    record?: EventRecord;
    defaultText: string;      // 메모의 첫 줄([+] 뗀 것), 없으면 ''
    now: () => Date;
    iosHint: boolean;         // 아이폰이면 Scriptable 안내와 '지금 예약' 단추
    onSave(id: string, rec: EventRecord): void; // editedAt/editedBy는 받는 쪽이 채운다(0, ''로 넘긴다)
    onDelete(id: string): void;
    onClose(): void;
  };
  export function mountEventSheet(root: HTMLElement, props: EventSheetProps): { destroy(): void };
  export const SCRIPTABLE_SCHEDULE_URL = 'scriptable:///run/CalendarFIF?schedule=1';
  // src/web/ui/editor.ts의 props에 더함
  events?: { view: EventsView; save(id: string, rec: EventRecord): void; remove(id: string): void; iosHint: boolean; now?: () => Date };
  ```
- 알림 시트(`div.sheet.event-sheet`, `role="dialog"`, 편집 화면 위에 뜬다; 제목 `새 알림`/`알림 편집`): 글(`input`, 비어 있으면 저장할 때 `defaultText`, 그것도 없으면 "글을 적어 주세요"를 보이고 저장하지 않는다), 시각(`input type="time"`, 새것의 기본: 그 날짜가 오늘이면 지금+15분을 15분 단위로 내린 시각(23:45를 넘으면 23:45), 아니면 `09:00`), 미리 알림(체크 단추 여섯, 1~5개, 기본 당일; 하나도 안 고르면 저장할 때 "하나 이상 고르세요"), 반복(`select`, `REPEAT_LABELS` 순서), 끝(`계속`/`날짜까지`/`횟수`, 반복이 `none`이면 숨김; 날짜는 `input type="date"`로 `dateKey` 이후, 횟수는 1~99999), 완료(체크). 단추: `삭제`(고치기일 때만), `취소`, `저장`. 아이폰이면 아래에 "아이폰 알림은 Scriptable 위젯 스크립트가 예약합니다. 위젯이 새로 그려질 때 예약되고, 바로 하려면 누르세요." 와 `지금 예약`(`<a href=SCRIPTABLE_SCHEDULE_URL>`).
- 카운트다운 시트(제목 `새 카운트다운`/`카운트다운 편집`): 글, 유형(`COUNTDOWN_KIND_LABELS` 다섯), 반복(`안 함`, `매년`, `음력 매년`; 새것은 생일·기념일·명절이면 `매년`, 아니면 `안 함`; 유형을 바꾸면 사용자가 반복을 건드리지 않았을 때만 따라 바꾼다), 끝(알림과 같음), `달력 아래에 표시`(스위치, 기본 켬), 완료. 단추는 같다.
- 시트는 Esc와 바깥(그 시트의 덮개) 누르기로 닫히고(고친 것이 있으면 바깥 누르기는 닫지 않는다), Tab이 시트 안에서 돈다. 아래로 끌어 닫기는 붙이지 않는다(편집 화면의 끌어 닫기와 겹치지 않게). 닫히면 편집 화면의 메모 칸으로 초점을 돌린다.
- 편집 화면: `props.events`가 있으면 `toolbar`의 `알림`/`카운트다운`을 보이고 새 시트를 연다(`id = newEventId()`). `.ev-strip`에는 `eventsByDate(view.items(), dateKey, dateKey)`의 줄을 칩(`button.ev-chip`)으로 보인다: 알림은 `09:30 글`, 카운트다운은 `글` + `countdownStatus`로 `countdownLabel`(반복 없는 것은 그날과 오늘의 차이). 완료는 취소선. 칩을 누르면 그 항목의 시트를 연다. 편집 화면이 열려 있는 동안 `view.onChange`로 띠를 다시 그리고, 닫힐 때 끊는다. 시트의 저장/삭제는 `props.events.save/remove`를 부르고 바로 끝난다(메모의 저장·취소와 따로).

- [ ] **Step 1: 실패하는 테스트** — `eventSheet.test.ts`: `새 알림의 기본 시각은 오늘이면 지금+15분을 15분 단위로 내린 것, 다른 날이면 09:00`, `글이 비면 메모 첫 줄을 쓰고 둘 다 없으면 저장하지 않는다`, `미리 알림은 다섯 개까지만 고른다`, `반복과 끝을 고르면 rule에 들어가고 반복 없음이면 끝이 없다`, `고치기면 값이 채워지고 삭제가 보인다`, `생일을 고르면 반복이 매년이 된다(사용자가 바꾸지 않았을 때)`, `아이폰 안내는 iosHint일 때만`. `editor.test.ts`: `그날의 알림과 카운트다운이 띠에 칩으로 보이고 누르면 시트가 열린다`, `알림을 저장하면 save가 불리고 띠가 다시 그려진다`, `편집 화면을 취소해도 저장한 알림은 남는다(save가 이미 불렸다)`, `events가 없으면 알림·카운트다운 단추와 띠가 없다`.
- [ ] **Step 2: 실패를 본다** — `npx vitest run src/web/ui/eventSheet.test.ts src/web/ui/editor.test.ts`.
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과** — 같은 명령, `npx tsc --noEmit`, `npm test`.
- [ ] **Step 5: 커밋** — `feat: 편집 화면에서 알림과 카운트다운을 만들고 고친다`.

---

### Task 7: 설정의 셀 묶음

**Files:**
- Modify: `src/web/ui/prefsSection.ts`, `src/web/ui/prefsSection.test.ts`, `src/web/ui/settings.ts`(필요하면), `src/web/desktop/settingsPages.ts`, `src/web/desktop/settingsPages.test.ts`

**Interfaces:**
- Consumes: Task 3의 `Prefs`의 새 칸, `playTone`, `Appearance.showAlarmTime`, `Appearance.alarmTone`.
- 웹앱: 설정에 `셀` 묶음을 만들고(지금 묶음들과 같은 모양) 차례로 둔다: `줄 머리`(지금 `보기`에서 옮김), `셀 간격`(좁게/보통/넓게), `줄 간격`(좁게/보통/넓게), `완료된 작업 표시`(옮김), `완료 작업 맨 아래로`(옮김), `알림 시각 표시`, `편집 완료 알람`(없음/짧은 소리), `리마인드 알람`(없음/차임/벨). 소리 칸을 바꾸면 고른 소리를 한 번 낸다(`playTone`). 칸의 이름과 값은 기존 `label.pref-row`/선택 단추 방식을 따른다(실제 터치 확인이 그 구조를 찾는다).
- PC 앱: `셀` 쪽에 `알림 시각 표시`(켜고 끄기, `showAlarmTime`)와 `리마인드 알람`(없음/차임/벨, 바꾸면 한 번 소리)을 더한다.

- [ ] **Step 1: 실패하는 테스트** — `prefsSection.test.ts`: `셀 묶음에 여덟 칸이 이 순서로 있다`, `셀 간격을 넓게로 바꾸면 onChange에 cellGap: wide`, `리마인드 알람을 벨로 바꾸면 벨 소리를 한 번 낸다`, 옮긴 칸의 기존 테스트가 새 자리에서 통과. `settingsPages.test.ts`: `셀 쪽에 알림 시각 표시와 리마인드 알람이 있다`.
- [ ] **Step 2: 실패를 본다.**
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과** — 같은 명령, `npx tsc --noEmit`, `npm test`.
- [ ] **Step 5: 커밋** — `feat: 웹앱 설정에 셀 묶음을 만들고 PC 셀 쪽에 알림 칸을 더한다`.

---

### Task 8: 알림 시계와 화면 안 알림, 그리고 연결

**Files:**
- Create: `src/web/alarmClock.ts`, `src/web/alarmClock.test.ts`, `src/web/ui/alarmBanner.ts`, `src/web/ui/alarmBanner.test.ts`
- Modify: `src/web/main.ts`, `src/web/styles.css`

**Interfaces:**
- Consumes: Task 1의 `allAlarmTriggers`, `AlarmTrigger`. Task 2의 `EventsStore`, `FirestoreEventsSource`. Task 3의 `playTone`, `unlockAudio`. Task 4의 `CalendarDeps.events`. Task 6의 `EditorProps.events`.
- Produces:
  ```ts
  // src/web/alarmClock.ts
  export const FIRED_KEY = 'calfif.alarmsFired';
  export function startAlarmClock(deps: {
    view: EventsView;
    storage: KeyValueStore;
    now?: () => number;
    onRing(triggers: AlarmTrigger[]): void; // 한 번에 울릴 것들(보통 하나)
    setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void;
    doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  }): { stop(): void; check(): void };
  // src/web/ui/alarmBanner.ts
  export function showAlarmBanner(root: HTMLElement, triggers: AlarmTrigger[], onOpen: (dateKey: string) => void): { destroy(): void };
  ```
- `alarmClock`: `check()`는 `allAlarmTriggers(view.items(), now-10분, now+1분)` 중 `at <= now`이고 울린 적 없는 것을 울린다(울린 이름을 `FIRED_KEY`에 `{ key: firedAtMillis }`로 적고, 30일 넘은 것은 지운다; 저장소를 읽지 못하면 이 실행 동안 메모리로만 기억). 그다음 울릴 때(`allAlarmTriggers(now, now+2일)`의 첫 것)까지 타이머를 건다(최대 1분; 1분마다 다시 `check`). `view.onChange`, `visibilitychange`(보일 때)에도 `check`. 다른 탭이 이미 울린 것은 저장소를 다시 읽어 거른다.
- `alarmBanner`: 화면 위쪽의 `div.alarm-banner`(`role="alertdialog"`, `aria-live="assertive"`): 울린 것마다 `시각 · 글`(미리 알림이면 `하루 전` 등 `ADVANCE_LABELS`를 앞에), 글을 누르면 `onOpen(occurrence)`, `확인`을 누르면 닫힌다. 이미 떠 있으면 거기에 더한다.
- `main.ts`의 `mountCalendarScreen`:
  - `const events = new EventsStore({ source: new FirestoreEventsSource(db, session.uid), storage: storage.store, uid: session.uid, editedBy })`; `destroy`에서 `events.destroy()`.
  - `mountCalendar`에 `events`, 편집 화면에 `events: { view: events, save: (id, rec) => events.save(id, rec), remove: (id) => events.remove(id), iosHint: isIos(), now: () => new Date() }`(`isIos`: `/iPhone|iPad|iPod/.test(navigator.userAgent)` 또는 iPadOS의 `navigator.maxTouchPoints > 1 && /Macintosh/`).
  - 알림 시계: 웹앱은 `onRing`에서 `showAlarmBanner(root, triggers, openDay)`와 `prefs.alarmTone !== 'none'`이면 `playTone(prefs.alarmTone)`. PC 앱(`DESKTOP`)은 `bridge?.showAlarms(...)`(Task 9가 만든다; 이 Task에서는 `DESKTOP`이면 배너를 띄우는 것으로 두고 Task 9가 바꾼다).
  - 웹앱은 처음 `pointerdown`에 `unlockAudio()`(한 번).

- [ ] **Step 1: 실패하는 테스트** — `alarmClock.test.ts`(가짜 타이머, 메모리 저장소): `시각이 되면 울리고 다시 check해도 두 번 울리지 않는다`, `10분 넘게 지난 것은 울리지 않는다`, `다시 시작해도 저장소에 적힌 것은 울리지 않는다`, `자료가 바뀌면 다음 타이머를 다시 건다`, `30일 넘은 기록은 지운다`, `저장소가 던져도 메모리로 기억한다`. `alarmBanner.test.ts`: `울린 것들을 보이고 확인으로 닫힌다`, `떠 있으면 더한다`, `글을 누르면 그 날짜로`.
- [ ] **Step 2: 실패를 본다.**
- [ ] **Step 3: 구현한다.** `main.ts`의 연결은 `npx tsc --noEmit`과 `npm run test:touch`(앱이 그대로 뜨는지)로 확인한다.
- [ ] **Step 4: 통과** — 같은 명령, `npm test`, `npm run test:touch`, `npm run test:users`.
- [ ] **Step 5: 커밋** — `feat: 알림을 울리는 시계와 화면 안 알림을 붙인다`.

---

### Task 9: PC 앱의 알림 창

**Files:**
- Create: `src/desktop/alarmPopup.ts`, `src/desktop/alarmPopup.test.ts`, `src/desktop/alarmWindow.ts`
- Modify: `src/desktop/api.ts`, `src/desktop/preload.ts`, `src/desktop/ipc.ts`, `src/desktop/ipc.test.ts`, `src/desktop/main.ts`(또는 IPC를 받는 곳), `src/web/desktop/bridge.ts`, `src/web/desktop/fakeBridge.ts`, `src/web/main.ts`, `src/desktop/smoke.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/desktop/api.ts
  CH.alarm = 'calfif:alarm'
  export type AlarmPopupItem = { time: string; text: string; date: string; advance: number };
  // CalfifDesktop에 더함
  showAlarms(items: AlarmPopupItem[], tone: 'none' | 'chime' | 'bell'): void; // send CH.alarm
  // src/desktop/alarmPopup.ts (순수)
  export function sanitizeAlarmItems(input: unknown): AlarmPopupItem[]; // 배열, 최대 20개, time 'HH:MM', text 1~200자, date 날짜 열쇠, advance ADVANCE_DAYS 중 하나
  export function alarmPopupHtml(items: AlarmPopupItem[], tone: 'none' | 'chime' | 'bell'): string;
  // src/desktop/alarmWindow.ts (Electron)
  export function showAlarmWindow(items: AlarmPopupItem[], tone: 'none' | 'chime' | 'bell'): void;
  ```
- 메인은 `CH.alarm`을 받으면 `sanitizeAlarmItems`로 거른 뒤 `showAlarmWindow`. 창: `BrowserWindow`(테두리 없음, `alwaysOnTop: true`, `resizable: false`, `skipTaskbar: false`, `show: false`, 폭 340, 높이는 항목 수에 맞게 최대 420, `webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' }`), 주 모니터 작업 영역의 오른쪽 아래(16px 띄움)에 `showInactive()`. 내용은 `alarmPopupHtml`을 `data:text/html;charset=utf-8,`로 연다. 이미 떠 있으면 항목을 합쳐(최대 20) 다시 연다. HTML은 글을 모두 이스케이프한다(`& < > " '`), CSP `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`, 제목 `CalendarFIF 알림`, 항목마다 시각(굵게)과 글, `확인` 단추는 `window.close()`. 열릴 때 `tone`이 `none`이 아니면 WebAudio로 Task 3과 같은 소리를 낸다(HTML 안에 짧게 다시 쓴다; 모듈을 불러오지 않는다).
- 달력 창의 순서 처리(`window.ts`의 `keepBottom` 등)와 `win32.ts`는 고치지 않는다. 알림 창은 그 처리의 대상이 아니다.
- 화면(`src/web/main.ts`): `DESKTOP`이면 `onRing`에서 `bridge.showAlarms(triggers의 { time, text, date: occurrence, advance }, appearance.alarmTone)`, 배너는 띄우지 않는다.
- `smoke.ts`: 장면 `alarm`을 더한다. 에뮬레이터 자료에 지금+5초에 울리는 알림을 하나 넣고(지어낸 글 `시험 알림`), 15초 안에 알림 창이 뜨는지(창 목록과 그 창의 글), `확인`을 누르면 닫히는지 확인해 상태 파일에 적는다. 다른 장면의 동작은 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트** — `alarmPopup.test.ts`: `글을 이스케이프하고 항목마다 시각과 글을 넣는다`, `잘못된 항목은 버리고 20개까지`, `소리가 none이면 소리 코드를 넣지 않는다`. `ipc.test.ts`: `alarm 채널을 받으면 거른 항목으로 창을 부른다`(기존 방식대로 주입).
- [ ] **Step 2: 실패를 본다.**
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과** — 같은 명령, `npx tsc --noEmit`, `npm test`, `CALFIF_SMOKE=alarm npm run desktop:smoke`(상태 파일 `build/desktop-smoke/alarm.json`의 `ok: true`), `npm run desktop:smoke`(attach, `nestedNativeCalls` 0), `CALFIF_SMOKE=e2e npm run desktop:smoke`.
- [ ] **Step 5: 커밋** — `feat: PC 앱이 알림 시각에 맨 위에 작은 창을 띄운다`.

---

### Task 10: 위젯 스크립트의 아이폰 알림 예약

**Files:**
- Create: `src/widget/alarms.ts`, `src/widget/alarms.test.ts`
- Modify: `src/widget/api.ts`, `src/widget/api.test.ts`, `src/widget/host.ts`, `src/widget/main.ts`, `src/widget/main.test.ts`, `tests/emulator/widget.test.ts`(있으면 events 읽기 하나)

**Interfaces:**
- Consumes: Task 1의 `parseEventMap`, `allAlarmTriggers`, `ADVANCE_LABELS`.
- Produces:
  ```ts
  // src/widget/api.ts
  export function readEvents(config: Config, session: Session /* readMonth와 같은 것 */): Promise<EventMap>; // GET .../documents/users/{uid}/data/events, 404면 {}
  export function parseEventsDocument(doc: unknown): EventMap; // Firestore REST 값(mapValue 등)을 풀어 parseEventMap
  // src/widget/alarms.ts
  export const NOTIFY_PREFIX = 'calfif:';
  export type PlannedNotice = { id: string; title: string; body: string; at: Date; openURL: string };
  export function planNotices(items: EventMap, now: Date, appUrl: string, limit?: number): PlannedNotice[]; // now~now+7일, 가까운 순 최대 48(limit)
  export function reconcile(planned: PlannedNotice[], pendingIds: string[]): { remove: string[]; add: PlannedNotice[] }; // pendingIds 중 NOTIFY_PREFIX로 시작하고 planned에 없는 것은 remove, planned 중 pending에 없는 것은 add
  export async function scheduleAlarms(host: Host, items: EventMap, now: Date, appUrl: string): Promise<number>; // 예약한 뒤의 우리 예약 수
  ```
- 알림 이름: `${NOTIFY_PREFIX}${trigger.key}`. 제목: `CalendarFIF 알림`, 본문: `${time} ${text}`(미리 알림이면 앞에 `하루 전 · ` 등). `openURL`: `${appUrl}/#${occurrence}`. 소리는 Scriptable의 `'alert'`(없으면 기본). `threadIdentifier`는 `calfif-alarm`.
- `host.ts`에 Scriptable `Notification`의 쓰는 부분을 더한다: `new Notification()`, `identifier`, `title`, `body`, `sound`, `threadIdentifier`, `openURL`, `setTriggerDate(date)`, `schedule()`, static `allPending()`, `removePending(ids)`.
- `main.ts`: 로그인과 달 자료 읽기가 된 뒤(위젯과 앱 실행 모두), 알림 문서를 읽어 `scheduleAlarms`를 부른다. 읽기나 예약이 실패해도 위젯 그리기를 막지 않는다(던지지 않고 넘어간다). 마지막으로 읽은 알림 자료를 위젯 캐시 파일에 같이 두고, 읽지 못하면 그것으로 예약한다. 앱에서 연 메뉴의 제목 줄에 `알림 N개 예약됨`을 보인다. 주소 매개변수 `schedule=1`(`args.queryParameters.schedule`)로 열리면 예약만 하고 "알림 N개를 예약했습니다" 알림을 한 번 보인 뒤 끝낸다(메뉴를 띄우지 않는다).
- 위젯의 동작이 바뀌므로 `package.json`의 버전은 배포 때 0.7.0으로 올린다(이 Task에서는 올리지 않는다).

- [ ] **Step 1: 실패하는 테스트** — `alarms.test.ts`: `앞으로 7일의 울릴 때를 가까운 순으로 48개까지`, `완료한 것과 지난 것은 없다`, `reconcile은 우리 것만 지우고 없는 것만 더한다`, `scheduleAlarms는 가짜 Notification으로 지우고 예약한다`, `예약이 던져도 던지지 않는다`. `api.test.ts`: `parseEventsDocument가 REST 값을 풀고 틀린 항목을 버린다`, `readEvents의 404는 빈 것`. `main.test.ts`: `위젯 실행 뒤 알림을 예약한다`, `schedule=1이면 예약만 하고 끝낸다`, `알림 읽기가 실패해도 위젯을 그린다`.
- [ ] **Step 2: 실패를 본다.**
- [ ] **Step 3: 구현한다.**
- [ ] **Step 4: 통과** — 같은 명령, `npx tsc --noEmit`, `npm test`, `npm run widget:build`(스크립트가 만들어진다), `npm run test:emu`.
- [ ] **Step 5: 커밋** — `feat: 위젯 스크립트가 아이폰 알림을 예약한다`.

---

### Task 11: 실제 터치 확인 더하기

**Files:**
- Modify: `scripts/touch-check.ts`, `scripts/seed-emulator.ts`(지어낸 카운트다운 하나가 필요하면)

- 더할 확인(폰 크기 헤드리스 Edge, 에뮬레이터, 지어낸 자료):
  - `편집 화면의 알림 단추로 알림을 만들면 띠와 달력 칸에 보인다`(시각을 정하고 저장 → 띠의 칩, 그 날짜 칸의 `.ln.ev.alarm`).
  - `카운트다운을 만들면 달력 아래 줄에 N일 남음으로 보인다`.
  - `배경 상자에서 고른 색이 메모 칸 바탕에 보인다`(Task 5에서 바꾼 확인과 겹치면 하나로).
  - `알림 시트가 열린 동안 바깥을 눌러도 편집 화면은 그대로이고, 시트를 닫으면 메모 칸으로 돌아온다`.
  - `셀 설정의 셀 간격 넓게가 달력 칸 사이에 보인다`(`.grid`의 `gap`이 4px).
- 기존 확인은 모두 그대로 통과해야 한다(넘기는 동안 긴 작업 0개 포함).

- [ ] **Step 1: 확인을 더한다.**
- [ ] **Step 2: `npm run test:touch`를 돌려 모두 통과를 본다.** 실패하면 앱 쪽 원인을 찾아 고치고(고친 파일과 이유를 보고서에), 확인을 느슨하게 만들지 않는다.
- [ ] **Step 3: `npm run test:users`도 통과를 본다.**
- [ ] **Step 4: 커밋** — `test: 알림, 카운트다운, 배경 고르기, 셀 간격을 실제 터치로 확인한다`.

---

### Task 12: 문서

**Files:**
- Modify: `README.md`

- `README.md`에 절을 더한다(다른 절과 같은 말투): `편집 화면의 도구`(완료, 배경, 알림, 카운트다운), `알림`(웹앱이 열려 있을 때, PC 앱의 알림 창, 아이폰은 Scriptable이 예약한다는 것과 위젯 스크립트를 0.7.0으로 다시 복사해야 한다는 것, `지금 예약`, 위젯이 새로 그려지기 전에는 예약되지 않을 수 있다는 것, 기기마다 울린다는 것, 10분이 넘게 늦은 것은 울리지 않는다는 것), `카운트다운`(유형, 반복, 달력 아래 줄), `셀 설정`(웹앱 묶음과 PC 쪽). 실제 이메일, 프로젝트 ID, 주소를 적지 않는다.

- [ ] **Step 1: 쓴다.**
- [ ] **Step 2: 커밋** — `docs: 편집 도구, 알림, 카운트다운, 셀 설정 사용법을 적는다`.
