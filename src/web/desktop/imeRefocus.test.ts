// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { bounceFocus, refocusText } from './imeRefocus';

describe('PC 앱: 창이 앞에 올 때 글 칸의 초점을 다시 주기(한/영 키)', () => {
  afterEach(() => document.body.replaceChildren());

  it('글 칸이면 숨은 칸을 거쳐 같은 칸으로 돌아오고 커서 자리를 지킨다', () => {
    const t = document.createElement('textarea');
    t.value = '회의 준비';
    document.body.append(t);
    t.focus();
    t.setSelectionRange(2, 2);
    const seen: string[] = [];
    t.addEventListener('blur', (e) => seen.push(`blur:${(e.relatedTarget as Element | null)?.className ?? ''}`));
    t.addEventListener('focus', () => seen.push('focus'));
    expect(bounceFocus()).toBe(true);
    expect([document.activeElement === t, t.selectionStart, t.selectionEnd, document.querySelector('.ime-bounce'), seen]).toEqual([true, 2, 2, null, ['blur:ime-bounce', 'focus']]);
  });
  it('글 칸이 아니거나 읽기만 하는 칸이면 하지 않는다', () => {
    const b = document.createElement('button');
    const ro = document.createElement('textarea');
    ro.readOnly = true;
    const pw = document.createElement('input');
    pw.type = 'password';
    document.body.append(b, ro, pw);
    const results = [b, ro, pw].map((el) => {
      el.focus();
      return bounceFocus();
    });
    expect(results).toEqual([false, false, false]);
  });
  it('메인의 알림으로 다시 주고 횟수를 적는다', () => {
    const t = document.createElement('textarea');
    document.body.append(t);
    t.focus();
    refocusText();
    expect([document.activeElement === t, Number(document.documentElement.dataset.imeBounce) >= 1]).toEqual([true, true]);
  });
});
