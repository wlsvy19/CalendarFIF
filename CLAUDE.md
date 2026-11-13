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

## 사용자가 정한 것

- 무조건 무료다. 유료 요금제, 유료 계정, 결제 수단 등록이 필요한 방법은 쓰지 않는다.
- PC와 아이폰 두 기기만 연동한다. 양방향이다.
- 아이폰에서는 홈 화면 위젯으로 본다(② 단계, Scriptable).
- 기존 DesktopCal 기록을 그대로 다 옮긴다.
- CalendarFIF가 충분히 쓸 만해질 때까지 PC에서는 DesktopCal을 계속 쓰고, 그때 전환한다. 듀얼 모니터에서 CalendarFIF는 DesktopCal 반대쪽 화면에 띄운다.
- 단계는 ① 동기화 + 웹앱 + DesktopCal 가져오기 → ② 아이폰 위젯 → ③ PC 바탕화면 앱 순서다.
- 달력 메모는 일정 같은 내용이라 민감하지 않다고 사용자가 확인했다(2026-11-13). 그래도 아래 "하지 않는 것"은 지킨다.
- Claude Code를 회사 계정과 개인 계정(Claude Pro) 두 개로 쓴다. 개인 계정은 사용량이 적어서 토큰을 아끼는 것이 목적이다. 무거운 작업은 회사 계정 세션이, 가볍고 범위가 분명한 작업은 개인 계정 세션이 맡는다. 분담과 아끼는 방법은 `docs/superpowers/coordination.md`에 있다.

## 하지 않는 것

- DesktopCal의 데이터 파일(`%APPDATA%\CalendarTask\Db\calendar.db`) 원본에 쓰거나 잠그지 않는다. 복사본만 읽는다.
- 사용자의 실제 메모, `calendar.db`, 상태 파일, 로그인 정보를 저장소, 테스트 자료, 로그에 넣지 않는다. 테스트 자료는 지어낸 것만 쓴다.
- DesktopCal의 서버에 접속하지 않고, 그 프로그램의 코드나 이미지를 가져다 쓰지 않는다.
- `.mcp.json`은 사용자 파일이다. 커밋하지 않는다. `git add`는 경로를 적어서 한다.

## 세션을 시작할 때

1. 사용자에게는 한국어로 답한다.
2. 지금 있는 폴더가 어느 워크트리이고 어느 브랜치인지 확인한다(`git worktree list`, `git branch --show-current`).
3. `docs/superpowers/coordination.md`에서 이 폴더가 맡은 작업을 확인한다. 다른 폴더가 맡은 작업은 하지 않는다.
4. `git log --oneline -10`, `git status --short`, 그리고 이 폴더의 진행 기록(`.superpowers/sdd/2026-11-13-phase1-sync-web-import/progress.md`, git에 올라가지 않는다)의 마지막 줄을 본다.
5. 한 폴더에서는 한 세션만 계획을 진행한다. 최근 커밋이나 커밋 안 된 변경, 진행 기록의 새 줄로 보아 다른 세션이 이 폴더에서 진행 중이면 계획을 건드리지 않고 사용자에게 알린다.
6. 멈췄다가 다시 깨어난 세션도 2~5번을 다시 한다. 멈춘 사이에 다른 세션이 이어 갔을 수 있다.

## 개발 환경

- Windows 11, Node 24, npm 11. 도구는 TypeScript 7, Vite 8, Vitest 5, Firebase JS SDK 13, firebase-tools 15다. 알고 있는 것보다 새 버전일 수 있으니 문법이 다르면 설치된 패키지의 타입 정의를 본다.
- 워크트리마다 `npm install`을 따로 한다.
- 단위 테스트: `npm test`. 타입 검사: `npx tsc --noEmit`.
- 에뮬레이터 테스트: `npm run test:emu`. Firebase 에뮬레이터는 Java 21 이상이 필요한데 이 PC의 기본 Java는 17이다. `npx tsx scripts/jdk.ts`가 JDK 21을 그 폴더의 `.tools/`에 내려받는다.
- 실제 Firebase 프로젝트 없이 에뮬레이터만으로 Task 12까지 개발한다. 실제 프로젝트 연결과 배포, 기존 기록 올리기(Task 13)는 사용자의 준비와 확인이 필요하다.
- 아이폰에서의 동작은 이 PC에서 볼 수 없다. 사용자가 직접 확인한다.
- 임시 폴더의 파일은 세션 도중 지워질 수 있다. 다시 필요한 것은 저장소 안의 `.tools/`나 `build/`(둘 다 git에 올라가지 않는다)에 둔다.
