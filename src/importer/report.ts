import { todayKey } from '../core/dates';
import type { ConvertStats, ConvertedDay } from './convert';
import type { VerifyResult } from './upload';

/** 건수만 담는다. 메모 내용은 넣지 않는다. */
export function previewReport(stats: ConvertStats, days: Map<string, ConvertedDay>): string {
  const years = new Map<string, number>();
  for (const dateKey of days.keys()) {
    const year = dateKey.slice(0, 4);
    years.set(year, (years.get(year) ?? 0) + 1);
  }
  const yearLine = [...years.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, count]) => `${year}년 ${count}`)
    .join(', ');
  const colorLines = stats.colors.length === 0 ? ['  없음'] : stats.colors.map((c) => `  ${c.stored} → ${c.rgb}  ${c.count}일`);
  const editedTimes = [...days.values()].map((d) => d.editedAt).filter((t) => t > 0);
  const editedRange =
    editedTimes.length === 0
      ? '없음'
      : `${todayKey(new Date(Math.min(...editedTimes)))} ~ ${todayKey(new Date(Math.max(...editedTimes)))}`;
  return [
    'DesktopCal 가져오기 미리보기',
    `전체 행: ${stats.rows}`,
    `옮길 날짜: ${stats.converted}`,
    `빈 칸이라 건너뜀: ${stats.skippedEmpty}`,
    `형식이 맞지 않아 건너뜀: ${stats.skippedBadKey}`,
    `색 값이 이상해 배경 없음으로 처리: ${stats.badColors}`,
    `글자색 태그를 뗀 곳: ${stats.fontTags}`,
    `연도별: ${yearLine || '없음'}`,
    `수정 시각 범위: ${editedRange}`,
    '색 변환:',
    ...colorLines,
  ].join('\n');
}

/** 날짜 하나의 내용. 화면에만 쓴다. */
export function dayReport(dateKey: string, day: ConvertedDay | undefined): string {
  if (!day) return `${dateKey}  옮길 내용 없음`;
  const header = `${dateKey}  ${day.value.color ? `배경색 ${day.value.color}` : '배경색 없음'}`;
  return day.value.text === '' ? header : `${header}\n${day.value.text}`;
}

const MAX_LISTED_DATES = 30;

function dateList(dates: string[]): string {
  const listed = dates.slice(0, MAX_LISTED_DATES).join(', ');
  return dates.length > MAX_LISTED_DATES ? `${listed} 외 ${dates.length - MAX_LISTED_DATES}일` : listed;
}

/** 건수와 날짜만 담는다. 메모 내용은 넣지 않는다. */
export function verifyReport(result: VerifyResult): string {
  const lines = [`원본 날짜 ${result.source} / 클라우드와 같음 ${result.same} / 다름 ${result.different} / 클라우드에 없음 ${result.missing}`];
  if (result.differentDates.length > 0) lines.push(`다른 날짜: ${dateList(result.differentDates)}`);
  if (result.missingDates.length > 0) lines.push(`클라우드에 없는 날짜: ${dateList(result.missingDates)}`);
  return lines.join('\n');
}
