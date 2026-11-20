/**
 * PC 앱: 달력이 마우스를 바탕화면으로 흘려보내는 동안(2026-11-20 사용자: DesktopCal처럼 달력 위에서 끌면 바탕화면의 선택 상자가 생겨야 한다)
 * 날짜 칸의 두 번 누르기와 오른쪽 누르기를 알아챈다. mouseHook.ts(저수준 마우스 훅)가 단추 사건마다 부른다.
 *
 * - 왼쪽 단추는 그대로 바탕화면에 간다(끌기와 선택 상자는 바탕화면이 한다). 두 번째 누름이 Windows의 두 번 누르기 시간과 거리 안이면 'open'을 낸다.
 * - 오른쪽 단추는 날짜 칸 위에서 눌렀으면 누름과 뗌을 삼키고(바탕화면의 메뉴가 뜨지 않게) 뗄 때 'menu'를 낸다.
 *   삼킨 누름의 뗌은 어디서 떼든 삼킨다(바탕화면이 짝 없는 뗌을 받지 않게).
 * eligible: 그 자리가 달력의 날짜 칸이고 그 아래가 바탕화면인지(훅이 정한다).
 */
export type DeskButton = 'ldown' | 'lup' | 'rdown' | 'rup';
export type DeskEmit = { kind: 'open' | 'menu'; x: number; y: number };
export type DeskDecision = { swallow: boolean; emit?: DeskEmit };
export type DoubleClickRule = { time: number; width: number; height: number };

export function createClickTracker(rule: DoubleClickRule) {
  let lastDown: { t: number; x: number; y: number } | null = null;
  let rightHeld = false;
  return (button: DeskButton, x: number, y: number, time: number, eligible: boolean): DeskDecision => {
    switch (button) {
      case 'ldown': {
        if (!eligible) {
          lastDown = null;
          return { swallow: false };
        }
        const prev = lastDown;
        // GetTickCount 시각은 49일마다 한 바퀴 돈다. 부호 없는 차이로 잰다.
        if (prev && ((time - prev.t) >>> 0) <= rule.time && Math.abs(x - prev.x) <= rule.width / 2 && Math.abs(y - prev.y) <= rule.height / 2) {
          lastDown = null;
          return { swallow: false, emit: { kind: 'open', x, y } };
        }
        lastDown = { t: time, x, y };
        return { swallow: false };
      }
      case 'lup':
        return { swallow: false };
      case 'rdown':
        if (!eligible) return { swallow: false };
        rightHeld = true;
        lastDown = null;
        return { swallow: true };
      case 'rup':
        if (!rightHeld) return { swallow: false };
        rightHeld = false;
        return { swallow: true, emit: { kind: 'menu', x, y } };
    }
  };
}
