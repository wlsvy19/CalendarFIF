import { expect, it } from 'vitest';
import { alarmPopupHtml, alarmWindowOptions, planAlarmPopup, sanitizeAlarmItems, TONE_QUIET_MS } from './alarmPopup';

const item = { time: '09:30', text: '약 먹기', date: '2026-11-20', advance: 0 };

it('글을 이스케이프하고 항목마다 시각과 글을 넣는다', () => {
  const html = alarmPopupHtml([item, { ...item, time: '18:00', text: `<b>"a" & 'b'</b>` }], 'none');
  expect(html).toContain('<title>CalendarFIF 알림</title>');
  expect(html).toContain('<b>09:30</b>');
  expect(html).toContain('<b>18:00</b>');
  expect(html).toContain('약 먹기');
  expect(html).toContain('&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
  expect(html).not.toContain('<b>"a"');
  expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  expect(html).toContain('window.close()');
  expect(html).toContain('확인');
});

it('잘못된 항목은 버리고 20개까지', () => {
  const bad = [null, 3, { ...item, time: '9:30' }, { ...item, text: '' }, { ...item, text: 'x'.repeat(201) }, { ...item, date: '2026-13-40' }, { ...item, advance: 4 }, { ...item, time: '24:00' }];
  expect(sanitizeAlarmItems([...bad, item])).toEqual([item]);
  expect(sanitizeAlarmItems('x')).toEqual([]);
  expect(sanitizeAlarmItems(Array.from({ length: 30 }, () => item))).toHaveLength(20);
});

it('소리가 none이면 소리 코드를 넣지 않는다', () => {
  expect(alarmPopupHtml([item], 'none')).not.toContain('AudioContext');
  expect(alarmPopupHtml([item], 'chime')).toContain('AudioContext');
  expect(alarmPopupHtml([item], 'bell')).toContain('2640');
});

it('미리 알림은 웹앱과 같은 말(하루 전 등)과 그 날짜로 적고, 당일은 적지 않는다', () => {
  const notes = (advance: number) => /<span class="note">([^<]*)<\/span>/.exec(alarmPopupHtml([{ ...item, advance }], 'none'))?.[1] ?? null;
  expect([0, 1, 2, 3, 5, 7].map(notes)).toEqual([null, '하루 전 · 11월 20일', '이틀 전 · 11월 20일', '사흘 전 · 11월 20일', '5일 전 · 11월 20일', '일주일 전 · 11월 20일']);
  expect(alarmPopupHtml([{ ...item, advance: 1 }], 'none')).not.toContain('일 뒤');
});

it('꾸린 앱의 알림 창은 달력 창처럼 개발자 도구를 막는다', () => {
  const packaged = alarmWindowOptions(200, true);
  expect(packaged.webPreferences).toMatchObject({ devTools: false, sandbox: true, contextIsolation: true, nodeIntegration: false });
  expect(alarmWindowOptions(200, false).webPreferences?.devTools).toBe(true);
  expect(packaged).toMatchObject({ width: 340, height: 200, frame: false, alwaysOnTop: true, resizable: false, show: false, title: 'CalendarFIF 알림' });
});

it('떠 있는 창에는 합치고 몇 초 안에 소리를 냈으면 다시 내지 않는다', () => {
  const a = { ...item, text: '가' };
  const b = { ...item, text: '나' };
  const fresh = planAlarmPopup(null, [a], 'chime', 1000);
  expect(fresh).toEqual({ reuse: false, items: [a], tone: 'chime' });
  const soon = planAlarmPopup({ closing: false, shown: [a], toneAt: 1000 }, [b], 'chime', 1000 + TONE_QUIET_MS - 1);
  expect(soon).toEqual({ reuse: true, items: [a, b], tone: 'none' });
  const later = planAlarmPopup({ closing: false, shown: [a], toneAt: 1000 }, [b], 'bell', 1000 + TONE_QUIET_MS);
  expect(later).toEqual({ reuse: true, items: [a, b], tone: 'bell' });
  expect(planAlarmPopup({ closing: false, shown: [a], toneAt: null }, [b], 'chime', 1000).tone).toBe('chime');
});

it('확인을 눌러 닫히는 창에는 합치지 않고 새 창을 연다(그 알림을 잃지 않는다)', () => {
  const a = { ...item, text: '가' };
  const b = { ...item, text: '나' };
  expect(planAlarmPopup({ closing: true, shown: [a], toneAt: 1000 }, [b], 'chime', 1500)).toEqual({ reuse: false, items: [b], tone: 'chime' });
});

it('20개를 넘게 쌓이면 최근 것 20개를 남긴다', () => {
  const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ ...item, text: `알림 ${from + i}` }));
  const plan = planAlarmPopup({ closing: false, shown: many(1, 15), toneAt: null }, many(16, 10), 'none', 0);
  expect(plan.items).toHaveLength(20);
  expect([plan.items[0].text, plan.items[19].text]).toEqual(['알림 6', '알림 25']);
  expect(planAlarmPopup(null, many(1, 25), 'none', 0).items.map((i) => i.text).slice(0, 1)).toEqual(['알림 6']);
});
