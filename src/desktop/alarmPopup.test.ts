import { expect, it } from 'vitest';
import { alarmPopupHtml, sanitizeAlarmItems } from './alarmPopup';

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
