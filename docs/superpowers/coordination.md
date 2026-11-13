# 두 세션 작업 분담

사용자는 Claude Code를 두 계정(회사, 개인)으로 쓰고, 두 세션에 이 저장소의 작업을 동시에 시킨다. 두 세션은 서로 메시지를 주고받지 못한다. 이 문서와 git 커밋으로만 맞춘다.

## 원칙

1. 폴더(워크트리) 하나에는 세션 하나만 계획을 진행한다.
2. 다른 세션의 폴더에 있는 파일을 고치지 않는다. 상대의 진행 상황은 `git log --oneline <상대 브랜치>`로 본다.
3. 자기 트랙의 작업만 한다. 계획 문서에 작업이 더 남아 있어도 다른 트랙의 작업은 시작하지 않는다.
4. 이 문서를 바꿔야 하면 사용자에게 먼저 알린다. 두 세션이 같은 내용을 보아야 하기 때문이다.

## 트랙

| 트랙 | 폴더 | 브랜치 | 맡은 작업 |
|---|---|---|---|
| A (웹앱) | `C:\sw\CalendarFIF` | `phase-1-sync-core` | Task 1~9, 그리고 합친 뒤의 Task 13 |
| B (가져오기) | `C:\sw\CalendarFIF\.claude\worktrees\importer` | `phase-1-importer` | Task 10~12 |

작업 번호는 `docs/superpowers/plans/2026-11-13-phase1-sync-web-import.md`의 번호다.

2026-11-13에 이 문서를 쓸 때의 상태: 트랙 A가 Task 1~4를 끝냈다(`ba43513`). 트랙 B의 브랜치는 그 커밋에서 갈라졌다.

## 트랙 B가 트랙 A에서 받아야 하는 것

- Task 10(DesktopCal 변환과 파일 읽기)은 Task 1의 코드만 쓴다. 바로 시작할 수 있다.
- Task 11(올리기)은 Task 5가 만드는 `src/sync/monthDoc.ts`(`parseMonthDoc`, `buildMonthPatch`)가 필요하다. 트랙 A가 Task 5를 커밋하면 트랙 B가 자기 폴더에서 `git merge phase-1-sync-core`로 가져온다.
- Task 12는 Task 10과 11만 쓴다.

## 합치는 방법

1. 트랙 B가 Task 12까지 끝내면, 먼저 자기 폴더에서 `git merge phase-1-sync-core`를 한다. 충돌은 트랙 B가 자기 폴더에서 푼다.
2. 충돌이 날 만한 곳은 `package.json`의 `scripts`다. 트랙 A는 `dev`, `build`, `dev:emu`, `deploy`를, 트랙 B는 `import`를 추가한다. 양쪽 줄을 모두 남긴다. `package-lock.json`이 충돌하면 한쪽을 고른 뒤 `npm install`로 다시 맞춘다.
3. 병합 뒤 트랙 B가 `npm install`, `npm test`, `npm run test:emu`, `npx tsc --noEmit`을 돌려 전부 통과하는지 확인하고 커밋한다.
4. 사용자가 트랙 A 세션에 알린다. 트랙 A는 작업 하나를 끝낸 뒤(커밋 안 된 변경이 없을 때) 자기 폴더에서 `git merge phase-1-importer`를 한다.
5. Task 13(실제 Firebase 프로젝트 연결, 배포, 기존 기록 올리기)은 두 트랙이 합쳐진 뒤 트랙 A 폴더에서 한다.

## 진행 기록

- 각 폴더의 `.superpowers/sdd/2026-11-13-phase1-sync-web-import/progress.md`가 그 트랙의 진행 기록이다. git에 올라가지 않고 폴더마다 따로다.
- 사용량 한도로 멈출 때는 멈춘 지점을 진행 기록에 적는다. 이어받는 세션은 같은 폴더에서 그 기록과 `git log`를 보고 이어 간다.
- 멈췄던 세션이 다시 깨어나면 먼저 `git log`와 진행 기록을 다시 본다. 그 사이 다른 세션이 이어 갔으면 계획을 건드리지 않는다.

## 사용자가 세션에 전할 말

트랙 A 세션에:

> `shared-docs` 브랜치를 병합해서 `CLAUDE.md`와 `docs/superpowers/coordination.md`를 받아. 너는 트랙 A야. Task 9까지만 진행하고 Task 10~12는 하지 마. 그건 다른 세션이 워크트리에서 해.

트랙 B 세션에(폴더 `C:\sw\CalendarFIF\.claude\worktrees\importer`에서 시작):

> `docs/superpowers/coordination.md`를 읽고 트랙 B를 진행해.
