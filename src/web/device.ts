export function deviceLabel(userAgent: string): 'iphone' | 'pc' {
  return /iPhone|iPad/.test(userAgent) ? 'iphone' : 'pc';
}

/** iOS 기기인가(아이패드가 데스크톱 표시로 열린 것 포함). 알림을 홈 화면 앱에서만 쓸 수 있다는 안내에 쓴다. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (maxTouchPoints > 1 && /Macintosh/.test(userAgent));
}
