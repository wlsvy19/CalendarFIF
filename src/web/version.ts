// 빌드할 때 vite.config.ts가 package.json의 version을 넣는다. 넣지 않은 실행(단위 테스트)에서는 빈 글이다.
declare const __APP_VERSION__: string | undefined;

/** 이 웹앱(또는 PC 앱 화면)의 버전. 설정의 맨 아래에 보인다. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
