export type LunarDate = { month: number; day: number; leap: boolean };

const DAY_MS = 86_400_000;
// 음력 형식기는 처음 쓸 때 만들어 둔다. 웹 번들도 이 모듈을 읽지만 아이폰 화면은 음력을 쓰지 않으므로 만들지 않는다.
let dangi: Intl.DateTimeFormat | null = null;
function dangiFormat(): Intl.DateTimeFormat {
  dangi ??= new Intl.DateTimeFormat('en-US-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  return dangi;
}

function utcOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function keyOfUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function lunarOfUtc(ms: number): LunarDate {
  const parts = dangiFormat().formatToParts(new Date(ms));
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return { month: parseInt(month, 10), day: parseInt(day, 10), leap: month.endsWith('bis') };
}

export function lunarDate(dateKey: string): LunarDate {
  return lunarOfUtc(utcOf(dateKey));
}

export function lunarLabel(dateKey: string): string {
  const { month, day, leap } = lunarDate(dateKey);
  return `음 ${leap ? '윤' : ''}${month}.${day}`;
}

export function solarOfLunar(year: number, month: number, day: number): string | null {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  for (let ms = start; ms < end; ms += DAY_MS) {
    const l = lunarOfUtc(ms);
    if (!l.leap && l.month === month && l.day === day) return keyOfUtc(ms);
  }
  return null;
}
