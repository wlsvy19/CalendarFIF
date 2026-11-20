/**
 * PC 앱: 창이 앞에 온 뒤에 글 칸에 한글 입력기(IME)가 다시 붙게 한다.
 *
 * 2026-11-20 사용자: "pc버전에서 메모 작성하려고 하는데 한영키 가 안먹어. 영어 밖에 안써져".
 * 달력 창은 평소에 활성화되지 않는 창(focusable: false)이다. 날짜를 두 번 누르면 편집 화면이 열리면서 메모 칸에 먼저 초점이 가고,
 * 그 뒤에 메인이 창을 활성화한다(Interactivity → setInteractive). 시험 실행에서 잰 것(smoke.ts의 imeProbe, Windows 11, Microsoft 한국어 IME):
 * 창이 활성화되기 전에 초점을 받은 글 칸은 창이 앞에 온 뒤에도 한/영 키가 듣지 않았다(페이지에 HangulMode 키가 그대로 왔다).
 * blur()와 focus()를 다시 해도 그대로였고, 다른 입력 칸에 초점을 줬다가 돌아오면 들었다. 활성화된 뒤에 처음 초점을 받은 칸은 처음부터 들었다.
 * 그래서 창이 앞에 오면(메인의 focus 사건 → refocusText 명령. 화면에는 창의 focus 사건이 오지 않았다: 글 칸이 이미 초점을 갖고 있어서)
 * 초점이 글 칸에 있을 때 숨은 입력 칸에 잠깐 초점을 줬다가 돌아온다. 커서 자리와 스크롤은 그대로 둔다.
 */
const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'tel', '']);

function isTextField(el: Element | null): el is HTMLTextAreaElement | HTMLInputElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  return el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type) && !el.readOnly && !el.disabled;
}

/** 글 칸의 초점을 숨은 입력 칸을 거쳐 되돌린다. 한 일이 있으면 true. */
export function bounceFocus(doc: Document = document): boolean {
  const el = doc.activeElement;
  if (!isTextField(el)) return false;
  const { selectionStart, selectionEnd, selectionDirection, scrollTop } = el;
  const proxy = doc.createElement('input');
  proxy.type = 'text';
  proxy.className = 'ime-bounce';
  proxy.tabIndex = -1;
  proxy.setAttribute('aria-hidden', 'true');
  proxy.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  doc.body.append(proxy);
  proxy.focus({ preventScroll: true });
  el.focus({ preventScroll: true });
  proxy.remove();
  try {
    if (selectionStart !== null && selectionEnd !== null) el.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
  } catch {
    // 커서 자리를 둘 수 없는 칸이다.
  }
  el.scrollTop = scrollTop;
  return true;
}

/** 메인이 "입력을 받는 창이 앞에 왔다"(refocusText)고 알리면 부른다. 한 횟수는 <html data-ime-bounce>에 적는다(시험 실행이 읽는다). */
let bounced = 0;
export function refocusText(doc: Document = document): void {
  if (bounceFocus(doc)) doc.documentElement.dataset.imeBounce = String((bounced += 1));
}
