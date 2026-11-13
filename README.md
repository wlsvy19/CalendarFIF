# CalendarFIF

Windows PC와 아이폰에서 날짜별 메모와 날짜 배경색을 양방향으로 동기화하는 개인용 달력이다. 바탕화면 달력 DesktopCal을 대체한다. 지금 이 저장소는 ① 단계(동기화 핵심, 웹앱, DesktopCal 가져오기)이고, 아이폰 위젯과 PC 바탕화면 앱은 나중에 만든다.

## 처음 준비

1. `npm install`을 실행한다.
2. Firebase 프로젝트를 만든다. 순서는 [docs/firebase-setup.md](docs/firebase-setup.md)를 따른다.
3. `.env.example`을 `.env.local`로 복사하고 `VITE_FIREBASE_*` 네 값과 `OWNER_UID`를 채운다. `.env.local`은 커밋하지 않는다. 비밀번호는 어떤 파일에도 적지 않는다.
4. `VITE_FORCE_LONG_POLLING=1`은 실시간 연결이 되지 않는 네트워크에서 쓴다. 다른 기기의 변경이 몇 초 안에 오지 않을 때 켠다.

## 개발과 테스트

| 명령 | 하는 일 |
|---|---|
| `npm run dev:emu` | 에뮬레이터에 예시 데이터를 넣고 로컬 앱을 띄운다. |
| `npm test` | 단위 테스트를 돌린다. |
| `npx tsc --noEmit` | 타입을 검사한다. |
| `npm run test:emu` | 에뮬레이터로 규칙과 동기화 테스트를 돌린다. |

에뮬레이터에는 Java 21 이상이 필요하다. PC의 Java가 더 낮으면 `npx tsx scripts/jdk.ts`가 JDK 21을 `.tools/`에 내려받는다.

## 배포

처음 한 번은 저장소 폴더에서 `npx firebase use --add`를 실행해 목록에서 내 프로젝트를 고르고, 별칭을 물으면 `default`를 입력한다. 이 단계가 커밋하지 않는 `.firebaserc`를 만든다. 먼저 `npx firebase login`을 해 두어야 한다([docs/firebase-setup.md](docs/firebase-setup.md) 5단계).

`npm run deploy`는 웹앱을 빌드하고, `OWNER_UID`로 보안 규칙을 만들고, 호스팅과 규칙을 배포한다. 배포가 끝나면 앱은 `https://<프로젝트 ID>.web.app`에 있다.

- 배포는 이 명령으로만 한다. 다른 명령이 `dist/`와 `build/firestore.rules`에 에뮬레이터용 빌드와 시험용 UID를 남겨 둘 수 있기 때문이다.
- `OWNER_UID`가 비어 있거나 시험용 UID이면 규칙 빌드가 오류로 멈춘다.

## DesktopCal 기록 가져오기

| 명령 | 하는 일 |
|---|---|
| `npm run import -- --preview` | 읽고 변환한 결과만 보여 준다. 클라우드에 접속하지 않는다(기본). |
| `npm run import -- --preview --show <YYYY-MM-DD>` | 그 날짜의 변환 결과를 화면에 보여 준다. 여러 번 줄 수 있다. |
| `npm run import -- --upload` | 바뀐 날짜를 클라우드에 올리고 대조한다. 먼저 `클라우드에 올릴까요? (y/N)`를 묻고, `--yes`를 붙이면 묻지 않는다. |
| `npm run import -- --follow` | 올린 뒤 DesktopCal 파일을 지켜보며 바뀔 때마다 올린다. 끝내려면 Ctrl+C를 누른다. 올리기 전에 같은 질문을 하고, `--yes`로 건너뛴다. |

- 가져오기는 DesktopCal 데이터 파일(`%APPDATA%\CalendarTask\Db\calendar.db`)의 복사본만 읽고, 원본에는 쓰지 않는다.
- 내 PowerShell이나 Windows 터미널에서 실행한다. 비밀번호를 가려서 입력받고(`CALFIF_EMAIL`, `CALFIF_PASSWORD` 환경 변수가 있으면 그 값을 쓴다), `--show`는 메모 내용을 화면에 출력한다.
- 첫 `--upload`는 웹앱이나 아이폰에서 아무것도 고치기 전에 한다. 상태 파일이 없는 첫 가져오기에서는 양쪽에 있고 내용이 다른 날짜를 합치지 않고 나중에 고친 쪽으로 정한다.
- 미리 보기에서 `수정 시각 범위`가 달력을 실제로 쓴 연도와 맞는지 확인한다.
- `--upload` 뒤 대조 줄이 `다름 0`, `클라우드에 없음 0`이어야 한다. 아니면 보고서에 해당 날짜가 나온다.
- `--upload`가 오류로 멈추면 DesktopCal에서 그 날짜들을 고치기 전에 바로 다시 실행한다.
- 상태 파일 `%LOCALAPPDATA%\CalendarFIF\import-state.json`은 지난번에 가져온 내용을 기억한다. 지우지 않는다. 지우면 줄 단위 병합이 날짜 전체에서 나중에 고친 쪽을 택하는 방식으로 바뀐다.
- 지난번에 가져온 날짜가 DesktopCal에서 한꺼번에 사라지면 클라우드에서 지우지 않고 멈춘다. `--upload --allow-deletes`로 한 번 확인해 준다. 수동 `--upload`는 사라진 날짜가 10일 이상이면서 지난번 가져온 날짜의 10%를 넘을 때 멈추고, `--follow`는 비율과 상관없이 10일 이상이면 멈춘다. 두 경우 모두 지난번 가져온 날짜가 3일 이상인데 전부 사라져도 멈춘다.

## 전환 기간에 지킬 점

PC에서 DesktopCal을 아직 주로 쓰는 동안 `--follow`는 DesktopCal에서 CalendarFIF 쪽으로만 복사한다. 아이폰이나 웹앱에서 고친 내용은 DesktopCal에 나타나지 않는다. 양쪽에서 같은 날을 고치면 CalendarFIF에서 줄 단위로 합쳐진다.

전환하는 날에는 follow가 마지막 변경까지 올렸는지 확인하고, DesktopCal을 끝내 자동 시작에서 뺀 뒤 follow를 멈춘다.

## 아이폰에서 쓰기

Safari에서 주소를 열고 로그인한 뒤 공유 버튼으로 홈 화면에 추가한다. 홈 화면 앱은 Safari와 로그인 상태를 따로 가지므로 한 번 더 로그인한다. 연결이 끊긴 동안 고친 내용은 `오프라인 (대기 n건)`으로 표시되고 연결이 돌아오면 올라간다.

## 무료 한도 (2026-11-13 확인)

Spark 요금제는 결제 수단이 필요 없다.

- Firestore: 저장 1 GiB, 하루 읽기 50,000회, 쓰기 20,000회, 삭제 20,000회, 나가는 전송 월 10 GiB, 프로젝트당 무료 데이터베이스 1개. 하루 한도는 태평양 시간 자정 무렵에 초기화된다.
- Hosting: 저장 10 GB, 하루 전송 360 MB.
- Authentication: 월간 활성 사용자 50,000명.

한 사람의 달력은 이 한도의 아주 작은 부분만 쓴다. 출처는 `https://firebase.google.com/pricing`과 `https://firebase.google.com/docs/firestore/quotas`다.

## 문서

- [설계](docs/superpowers/specs/2026-11-13-calendar-sync-design.md)
- [① 단계 계획](docs/superpowers/plans/2026-11-13-phase1-sync-web-import.md)
- [Firebase 프로젝트 준비](docs/firebase-setup.md)
