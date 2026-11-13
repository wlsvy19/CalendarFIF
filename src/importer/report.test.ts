import { expect, it } from 'vitest';
import { convertRows } from './convert';
import { dayReport, previewReport, verifyReport } from './report';

const { days, stats } = convertRows([
  { key: 'dkcal_mdays_20261113', content: 'a\r\n[+]b', bgcolor: '2424F1', stime: 100 },
  { key: 'dkcal_mdays_20261114', content: '', bgcolor: '', stime: 5 },
  { key: 'dkcal_mdays_20270102', content: null, bgcolor: 'ff', stime: null },
  { key: 'bad', content: 'x', bgcolor: '', stime: 1 },
  { key: 'dkcal_mdays_20261115', content: 'x', bgcolor: 'zz', stime: 7 },
]);

it('미리보기 보고서에 건수와 색 변환표가 있다', () => {
  const report = previewReport(stats, days);
  for (const line of [
    'DesktopCal 가져오기 미리보기', '전체 행: 5', '옮길 날짜: 3', '빈 칸이라 건너뜀: 1', '형식이 맞지 않아 건너뜀: 1',
    '색 값이 이상해 배경 없음으로 처리: 1', '글자색 태그를 뗀 곳: 0', '연도별: 2026년 2, 2027년 1',
    '  2424F1 → F12424  1일', '  ff → FF0000  1일',
  ]) expect(report).toContain(line);
  expect(report).not.toContain('[+]b');
});
it('날짜 하나의 내용과 대조 결과를 글로 만든다', () => {
  expect(dayReport('2026-11-13', days.get('2026-11-13'))).toBe('2026-11-13  배경색 F12424\na\n[+]b');
  expect(dayReport('2026-11-20', undefined)).toBe('2026-11-20  옮길 내용 없음');
  expect(verifyReport({ source: 3, same: 1, different: 1, missing: 1 })).toBe('원본 날짜 3 / 클라우드와 같음 1 / 다름 1 / 클라우드에 없음 1');
});
