// 알림 보내는 스크립트 묶음의 시작점. scripts/build-push.ts가 iife(CalendarFIFPush)로 묶고 Apps Script가 부를 함수들을 붙인다.
export { setup, tick } from './gas';
