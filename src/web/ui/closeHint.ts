/**
 * 위젯에서 연 달력에서 고친 뒤 Scriptable의 Close를 누르라는 말풍선.
 *
 * 2026-11-18 사용자: "Close를 눌러야 반영되는거롤 지금 됐짢아. 근데 까먹을 수 있짢아. 그때 Close 에 말풍선같은거 나오면서
 * '눌러야 저장 됩니다!' 이렇게 나오게 해줘". 0.9.27부터 위젯에서 연 달력은 저장해도 닫히지 않고, Close를 누를 때 위젯에 한 번에 반영된다.
 * Close 단추는 Scriptable이 웹 화면 위의 왼쪽 위에 그리는 것이라 웹앱이 거기에 붙일 수 없다. 그래서 웹 화면의 맨 위 왼쪽에서
 * 위(Close)를 가리키는 말풍선을 띄운다. 메모나 알림을 저장하면 뜨고, 누르면 다음 저장 때까지 숨는다. 편집 화면이 떠 있는 동안은 CSS가 숨긴다.
 *
 * 자리: 왼쪽 위에 겹쳐 두었더니 년도를 가렸고("년도 가리니까 위치 옮겨줘"), 오른쪽으로 옮겼더니 Close와 멀어 엉뚱한 곳을 가리켰다
 * (2026-11-19 사용자의 사진: "위치가 이상하잖아"). 그래서 말풍선이 떠 있는 동안 <html>에 close-hint-on을 걸어 달력 머리를 그만큼
 * 내리고, 그 빈자리에 Close 바로 밑으로 둔다(styles.css). 달력은 높이가 바뀌면 칸 크기를 다시 잰다(calendar.ts의 heightWatch).
 */
export const CLOSE_HINT_TEXT = '눌러야 저장됩니다!'; // 2026-11-19 사용자: "'눌러야 저장됩니다' 라고 만 해", "끝에 ! 붙이고"
export const CLOSE_HINT_ON = 'close-hint-on';

export type CloseHint = { show(): void; hide(): void; destroy(): void };

export function mountCloseHint(root: HTMLElement): CloseHint {
  const el = document.createElement('div');
  el.className = 'close-hint';
  el.setAttribute('role', 'status');
  el.textContent = CLOSE_HINT_TEXT;
  const set = (on: boolean): void => {
    el.hidden = !on;
    document.documentElement.classList.toggle(CLOSE_HINT_ON, on);
  };
  set(false);
  el.addEventListener('click', () => set(false));
  root.append(el);
  return {
    show: () => set(true),
    hide: () => set(false),
    destroy() {
      set(false);
      el.remove();
    },
  };
}
