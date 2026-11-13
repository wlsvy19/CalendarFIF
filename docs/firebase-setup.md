# Firebase 프로젝트 준비

CalendarFIF를 실제로 쓰려면 Firebase 프로젝트가 하나 있어야 한다. 이 문서는 그 프로젝트를 처음 만드는 사람이 화면을 따라가며 할 수 있게 적은 것이다. 한 번만 하면 되고 10분쯤 걸린다.

메뉴 경로는 2026-11-13에 Firebase 공식 문서에서 확인했다. 콘솔은 자주 바뀌고, 화면 글자는 계정 언어에 따라 한국어나 영어로 나온다. 표현이 조금 다르면 괄호 안의 영어 이름을 기준으로 찾는다.

어느 화면에서도 카드 등록이나 요금제 업그레이드(Blaze)는 필요 없다. 무료 요금제(Spark)는 결제 수단 없이 쓴다. 그런 화면이 나오면 진행하지 않는다.

## 1단계: 프로젝트 만들기

1. https://console.firebase.google.com 을 열고 개인 Google 계정으로 로그인한다. 오른쪽 위 프로필 사진으로 어느 계정인지 확인한다.
2. **프로젝트 만들기**(Create a project 또는 Add project)를 누른다.
3. 프로젝트 이름을 입력한다. 예: `calendarfif`
4. 이름 아래에 프로젝트 ID가 자동으로 생긴다(예: `calendarfif-3f2a1`). 이 ID가 웹앱 주소(`https://프로젝트ID.web.app`)가 되고 나중에 바꿀 수 없다. 바꾸고 싶으면 지금 연필 모양 **수정**(Edit) 아이콘을 눌러 고친다. 주소에 그대로 드러나므로 이름이나 전화번호는 넣지 않는다.
5. 약관 동의가 나오면 체크하고 **계속**(Continue)을 누른다.
6. AI 지원(Gemini in Firebase)을 켤지 묻는 화면에서는 끈 채로 **계속**을 누른다.
7. Google 애널리틱스 화면에서는 스위치를 끄고 **프로젝트 만들기**(Create project)를 누른다.
8. 준비됐다는 화면이 나오면 **계속**을 누른다.

## 2단계: Firestore 데이터베이스 만들기

1. 왼쪽 메뉴에서 **데이터베이스 및 스토리지**(Databases & Storage) → **Firestore**를 누른다.
2. **데이터베이스 만들기**(Create database)를 누른다.
3. 에디션(Edition)을 고르라는 화면이 나오면 **Standard**를 고른다. 데이터베이스 ID는 `(default)` 그대로 둔다. 무료 한도는 프로젝트마다 데이터베이스 하나에만 적용되고, 앱은 기본 데이터베이스를 쓴다.
4. 위치(Location)는 `asia-northeast3 (Seoul)`을 고른다. 한번 정하면 바꿀 수 없다.
5. 보안 규칙은 **프로덕션 모드**(Production mode)를 고른다. 테스트 모드는 누구나 읽고 쓸 수 있는 상태라 고르지 않는다. 본인 계정만 읽고 쓰게 하는 규칙은 `npm run deploy`가 올린다.
6. **만들기**(Create)를 누른다. 빈 데이터베이스 화면이 나오면 끝이다.

## 3단계: 로그인 켜고 계정 만들기

1. 왼쪽 메뉴에서 **보안**(Security) → **Authentication**을 누른다.
2. **시작하기**(Get started) 버튼이 보이면 누른다.
3. **로그인 방법**(Sign-in method) 탭에서 **이메일/비밀번호**(Email/Password)를 누른다.
4. 첫 번째 스위치 **사용 설정**(Enable)만 켠다. 두 번째 "이메일 링크(비밀번호 없는 로그인)"는 끈 채로 두고 **저장**(Save)을 누른다.
5. **사용자**(Users) 탭에서 **사용자 추가**(Add user)를 누른다.
6. 이메일과 비밀번호를 입력하고 **사용자 추가**를 누른다.
   - 이메일은 로그인 아이디로 쓴다. 확인 메일은 가지 않는다.
   - 비밀번호는 6자 이상이어야 한다. 다른 곳에서 쓰지 않는 긴 것으로 정한다. PC와 아이폰에서 이 이메일과 비밀번호로 로그인한다.
7. 목록에 생긴 줄에서 **사용자 UID**(User UID) 값을 복사한다. 영문과 숫자가 섞인 28자쯤 되는 글자다. 보안 규칙이 이 UID 하나에만 읽기와 쓰기를 허락한다.

## 4단계: 웹 앱 등록하고 설정값 복사

1. 왼쪽 위 **프로젝트 개요**(Project Overview)를 누르고, 화면 가운데의 웹 아이콘 `</>`을 누른다.
   - 안 보이면 프로젝트 개요 옆 톱니바퀴 → **프로젝트 설정**(Project settings) → **일반**(General) 탭 맨 아래 **내 앱**(Your apps)에 있다.
2. 앱 닉네임을 입력한다. 예: `CalendarFIF 웹`
3. "Firebase 호스팅도 설정"(Also set up Firebase Hosting) 체크박스는 체크하지 않는다.
4. **앱 등록**(Register app)을 누른다.
5. 화면에 `const firebaseConfig = { ... }` 코드가 나온다. 그 안의 `apiKey`, `authDomain`, `projectId`, `appId` 네 값을 복사한다.
6. **콘솔로 이동**(Continue to console)을 누른다.

이 네 값은 웹앱 코드에 그대로 들어가는 공개 값이다. 데이터는 3단계의 로그인과 보안 규칙이 지킨다.

## 5단계: 이 PC에서 Firebase 명령줄 도구에 로그인

배포에 필요하다. 도중에 질문에 답해야 하므로 PowerShell 창에서 직접 실행한다.

1. PowerShell 창을 새로 연다.
2. `cd C:\sw\CalendarFIF`
3. `npx firebase login`
4. 질문이 두 번 나온다. 둘 다 `n`을 입력하면 된다.
   - `Enable Gemini in Firebase features?`
   - `Allow Firebase to collect CLI and Emulator Suite usage and error reporting information?`
5. 브라우저가 열리면 1단계에서 쓴 Google 계정을 고르고 **허용**(Allow)을 누른다. 프로젝트를 만든 계정과 같아야 한다.
6. PowerShell에 `Success! Logged in as ...`가 나오면 끝이다.

`npx firebase projects:list`에 1단계에서 만든 프로젝트가 보이면 로그인한 계정이 맞는 것이다.

## 끝난 뒤

저장소 폴더의 `.env.local`에 설정값 네 개와 `OWNER_UID`(3단계의 UID)를 넣고 `npm run deploy`로 배포한다. `.env.local`은 git에 올라가지 않는다. 비밀번호는 어느 파일에도 적지 않는다.
