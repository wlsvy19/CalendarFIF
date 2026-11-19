/**
 * 위젯에서 연 달력에서 고친 뒤 Scriptable의 Close를 누르라는 말풍선.
 *
 * 2026-11-18 사용자: "Close를 눌러야 반영되는거롤 지금 됐짢아. 근데 까먹을 수 있짢아. 그때 Close 에 말풍선같은거 나오면서
 * '눌러야 저장 됩니다!' 이렇게 나오게 해줘". 0.9.27부터 위젯에서 연 달력은 저장해도 닫히지 않고, Close를 누를 때 위젯에 한 번에 반영된다.
 * Close 단추는 Scriptable이 웹 화면 위(왼쪽 위)에 그리는 것이라 웹앱이 거기에 붙일 수 없다. 그래서 웹 화면의 맨 위에서
 * 왼쪽 위를 가리키는 말풍선을 띄운다(자리는 styles.css의 .close-hint: 년도를 가리지 않게 첫 줄의 오른쪽). 메모나 알림을 저장하면 뜨고, 누르면 다음 저장 때까지 숨는다. 편집 화면이 떠 있는 동안은 CSS가 숨긴다.
 */
export const CLOSE_HINT_TEXT = '눌러야 저장됩니다!'; // 2026-11-19 사용자: "'눌러야 저장됩니다' 라고 만 해", "끝에 ! 붙이고"

export type CloseHint = { show(): void; hide(): void; destroy(): void };

export function mountCloseHint(root: HTMLElement): CloseHint {
  const el = document.createElement('div');
  el.className = 'close-hint';
  el.setAttribute('role', 'status');
  el.hidden = true;
  el.textContent = CLOSE_HINT_TEXT;
  el.addEventListener('click', () => {
    el.hidden = true;
  });
  root.append(el);
  return {
    show() {
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    destroy() {
      el.remove();
    },
  };
}
