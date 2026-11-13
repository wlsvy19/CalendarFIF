# CalendarFIF

PC(Windows)와 아이폰에서 날짜별 메모를 양방향으로 동기화하는 개인용 달력이다. 사용자가 쓰던 바탕화면 달력 DesktopCal을 대체한다.

이 파일은 어느 계정, 어느 세션에서 열어도 같은 내용을 알고 시작하도록 둔 공통 지식이다. 계정마다 메모리와 대화 기록이 따로이므로, 여러 세션이 함께 알아야 할 내용은 여기와 `docs/`에 적는다.

## 먼저 읽을 것

| 문서 | 내용 |
|---|---|
| `docs/superpowers/specs/2026-11-13-calendar-sync-design.md` | 설계. 사용자가 승인했다. 무엇을 왜 만드는지, 데이터 모델, 병합 규칙, 단계 구분. |
| `docs/superpowers/plans/2026-11-13-phase1-sync-web-import.md` | ① 단계 구현 계획. 작업 13개와 테스트 코드. |
| `docs/superpowers/coordination.md` | 두 세션이 동시에 일할 때의 작업 분담과 합치는 방법. |
| `docs/superpowers/specs/assets/iphone-webapp-mockup.html` | 사용자가 본 아이폰 화면 시안(예시 데이터). |
| `docs/superpowers/phase1-results.md` | ① 단계 결과. 확인된 것, 진행하면서 정한 것, 미뤄 둔 것. |
| `README.md` | 실행 방법, 배포, DesktopCal 기록 가져오기와 따라가기 사용법. |
| `docs/firebase-setup.md` | Firebase 프로젝트를 처음 만드는 순서(화면별). |

## 지금 상태 (2026-11-13)

- ① 단계가 끝났다. 웹앱이 배포되어 있고, DesktopCal 기록 789일을 옮겼고, 사용자가 PC와 아이폰에서 확인했다.
- 이 폴더는 사용자의 실제 Firebase 프로젝트에 연결되어 있다. 프로젝트 ID와 설정값은 `.env.local`과 `.firebaserc`에 있고 git에는 없다.
- 사용자는 PC에서 DesktopCal을 계속 쓰면서 따라가기(`npm run import -- --follow`)로 CalendarFIF에 넘긴다.
- 다음은 ② 단계(아이폰 위젯)다. 사용자가 순서를 바꾸자고 하면 ③(PC 바탕화면 앱)을 먼저 한다. 어느 단계든 브레인스토밍과 화면 시안부터 시작하고 계획을 따로 세운다.

## 사용자가 정한 것

- 무조건 무료다. 유료 요금제, 유료 계정, 결제 수단 등록이 필요한 방법은 쓰지 않는다.
- PC와 아이폰 두 기기만 연동한다. 양방향이다.
- 아이폰에서는 홈 화면 위젯으로 본다(② 단계, Scriptable).
- 기존 DesktopCal 기록을 그대로 다 옮긴다.
- CalendarFIF가 충분히 쓸 만해질 때까지 PC에서는 DesktopCal을 계속 쓰고, 그때 전환한다. 듀얼 모니터에서 CalendarFIF는 DesktopCal 반대쪽 화면에 띄운다.
- PC의 최종 모습은 브라우저 창이 아니라 DesktopCal처럼 바탕화면에 붙어 뜨는 달력이다. 배경은 투명해서 바탕화면 그림이 비쳐 보인다(2026-11-13). 브라우저 화면은 ③ 단계 전까지 쓰는 임시 화면이다.
- DesktopCal을 분석해서 만든다. 사용자는 REA로 분석하기를 원한다. 이 PC의 REA는 정밀 분석 엔진(Ghidra 또는 IDA)이 설정되어 있지 않아 실행 파일의 PE 검사까지만 된다. 지금까지의 분석은 DesktopCal 폴더의 데이터 파일과 스크립트, 화면 정의 파일을 읽은 것이다. 창을 바탕화면에 붙이고 투명하게 그리는 방식은 ③ 단계의 첫 작업에서 분석한다.
- Firebase는 써 본 적이 없다. 사용자가 콘솔(Firebase 관리 웹사이트)이나 명령줄에서 직접 해야 하는 일은 누를 버튼까지 단계별로 안내한다. Supabase로 바꾸는 것은 2026-11-13에 검토했고 Firebase를 그대로 쓴다(이유는 설계 4절).
- 단계는 ① 동기화 + 웹앱 + DesktopCal 가져오기 → ② 아이폰 위젯 → ③ PC 바탕화면 앱 순서다.
- 달력 메모는 일정 같은 내용이라 민감하지 않다고 사용자가 확인했다(2026-11-13). 그래도 아래 "하지 않는 것"은 지킨다.
- Claude Code를 회사 계정과 개인 계정(Claude Pro) 두 개로 쓴다. 개인 계정은 사용량이 적어서 토큰을 아끼는 것이 목적이다. 무거운 작업은 회사 계정 세션이, 가볍고 범위가 분명한 작업은 개인 계정 세션이 맡는다. 분담과 아끼는 방법은 `docs/superpowers/coordination.md`에 있다.

## 하지 않는 것

- DesktopCal의 데이터 파일(`%APPDATA%\CalendarTask\Db\calendar.db`) 원본에 쓰거나 잠그지 않는다. 복사본만 읽는다.
- 사용자의 실제 메모, `calendar.db`, 상태 파일, 로그인 정보를 저장소, 테스트 자료, 로그에 넣지 않는다. 테스트 자료는 지어낸 것만 쓴다.
- DesktopCal의 서버에 접속하지 않고, 그 프로그램의 코드나 이미지를 가져다 쓰지 않는다.
- `.mcp.json`은 사용자 파일이다. 커밋하지 않는다. `git add`는 경로를 적어서 한다.
- 사용자가 시키지 않으면 실제 프로젝트에 닿는 명령을 실행하지 않는다. `npm run deploy`, `npm run import -- --upload`, `npm run import -- --follow`, 그리고 실제 프로젝트에 붙는 `npm run dev`가 그렇다. 에뮬레이터 명령(`npm run dev:emu`, `npm run test:emu`)은 실제 프로젝트에 닿지 않는다.
- 사용자의 로그인 비밀번호를 묻거나 받지 않는다. 비밀번호가 필요한 명령(가져오기의 올리기와 따라가기)은 사용자가 자기 PowerShell 창에서 실행한다.

## 세션을 시작할 때

1. 사용자에게는 한국어로 답한다.
2. 지금 있는 폴더가 어느 워크트리이고 어느 브랜치인지 확인한다(`git worktree list`, `git branch --show-current`).
3. `docs/superpowers/coordination.md`에서 이 폴더가 맡은 작업을 확인한다. 다른 폴더가 맡은 작업은 하지 않는다.
4. `git log --oneline -10`, `git status --short`를 본다. 진행 중인 계획의 진행 기록(`.superpowers/sdd/<계획 이름>/progress.md`, git에 올라가지 않는다)이 이 폴더에 있으면 그 마지막 줄도 본다. ① 단계의 진행 기록은 끝나면서 지웠고, 내용은 `docs/superpowers/phase1-results.md`에 옮겨 적었다.
5. 한 폴더에서는 한 세션만 계획을 진행한다. 최근 커밋이나 커밋 안 된 변경, 진행 기록의 새 줄로 보아 다른 세션이 이 폴더에서 진행 중이면 계획을 건드리지 않고 사용자에게 알린다.
6. 멈췄다가 다시 깨어난 세션도 2~5번을 다시 한다. 멈춘 사이에 다른 세션이 이어 갔을 수 있다.

## 개발 환경

- Windows 11, Node 24, npm 11. 도구는 TypeScript 7, Vite 8, Vitest 5, Firebase JS SDK 13, firebase-tools 15다. 알고 있는 것보다 새 버전일 수 있으니 문법이 다르면 설치된 패키지의 타입 정의를 본다.
- 워크트리마다 `npm install`을 따로 한다.
- 단위 테스트: `npm test`. 타입 검사: `npx tsc --noEmit`.
- 에뮬레이터 테스트: `npm run test:emu`. Firebase 에뮬레이터는 Java 21 이상이 필요한데 이 PC의 기본 Java는 17이다. `npx tsx scripts/jdk.ts`가 JDK 21을 그 폴더의 `.tools/`에 내려받는다.
- 개발과 테스트는 에뮬레이터로 한다. `.env.emulator`의 값이 `.env.local`보다 우선하고, 에뮬레이터 명령은 프로젝트를 `demo-calfif`로 지정한다.
- 배포는 `npm run deploy`로만 한다. 이 명령이 웹앱과 보안 규칙을 매번 새로 만든다. `npm run test:emu`와 `npm run dev:emu`는 `build/firestore.rules`를 시험용 UID로 덮어쓴다.
- 아이폰에서의 동작은 이 PC에서 볼 수 없다. 사용자가 직접 확인한다.
- 임시 폴더의 파일은 세션 도중 지워질 수 있다. 다시 필요한 것은 저장소 안의 `.tools/`나 `build/`(둘 다 git에 올라가지 않는다)에 둔다.
