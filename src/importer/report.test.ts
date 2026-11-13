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
  expect(verifyReport({ source: 3, same: 1, different: 1, missing: 1, differentDates: ['2026-11-14'], missingDates: ['2026-12-01'] }))
    .toBe('원본 날짜 3 / 클라우드와 같음 1 / 다름 1 / 클라우드에 없음 1\n다른 날짜: 2026-11-14\n클라우드에 없는 날짜: 2026-12-01');
  expect(verifyReport({ source: 2, same: 2, different: 0, missing: 0, differentDates: [], missingDates: [] }))
    .toBe('원본 날짜 2 / 클라우드와 같음 2 / 다름 0 / 클라우드에 없음 0');
});
it('날짜가 30개를 넘으면 앞의 30개와 나머지 수만 적는다', () => {
  const dates = Array.from({ length: 35 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  const report = verifyReport({ source: 35, same: 0, different: 0, missing: 35, differentDates: [], missingDates: dates });
  expect(report.split('\n')).toEqual([
    '원본 날짜 35 / 클라우드와 같음 0 / 다름 0 / 클라우드에 없음 35',
    `클라우드에 없는 날짜: ${dates.slice(0, 30).join(', ')} 외 5일`,
  ]);
});
it('미리보기에 수정 시각 범위를 로컬 날짜로 적는다', () => {
  const localDate = (stime: number) => {
    const d = new Date(stime * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const ranged = convertRows([
    { key: 'dkcal_mdays_20240101', content: 'a', bgcolor: '', stime: 1790000000 },
    { key: 'dkcal_mdays_20240102', content: 'b', bgcolor: '', stime: 1700000000 },
    { key: 'dkcal_mdays_20240103', content: 'c', bgcolor: '', stime: null },
  ]);
  const lines = previewReport(ranged.stats, ranged.days).split('\n');
  expect(lines[lines.findIndex((l) => l.startsWith('연도별: ')) + 1]).toBe(`수정 시각 범위: ${localDate(1700000000)} ~ ${localDate(1790000000)}`);
  const none = convertRows([{ key: 'dkcal_mdays_20240103', content: 'c', bgcolor: '', stime: null }]);
  expect(previewReport(none.stats, none.days)).toContain('수정 시각 범위: 없음');
});
