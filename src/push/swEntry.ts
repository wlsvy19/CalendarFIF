import { installPushHandlers, type SwScope } from './sw';

// public/push-sw.js의 시작점. 서비스 워커의 전역(self)에 푸시 처리를 붙인다.
installPushHandlers(self as unknown as SwScope);
