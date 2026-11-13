import { solarOfLunar } from './lunar';

const DAY_MS = 86_400_000;

const FIXED: Record<string, string> = {
  '01-01': '신정',
  '03-01': '3.1절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
};

const lunarTables = new Map<number, Map<string, string>>();

function shiftKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function lunarTable(year: number): Map<string, string> {
  let table = lunarTables.get(year);
  if (table) return table;
  table = new Map();
  const around = (key: string | null, name: string): void => {
    if (!key) return;
    table!.set(shiftKey(key, -1), `${name} 연휴`);
    table!.set(shiftKey(key, 1), `${name} 연휴`);
    table!.set(key, name);
  };
  around(solarOfLunar(year, 1, 1), '설날');
  const buddha = solarOfLunar(year, 4, 8);
  if (buddha) table.set(buddha, '부처님오신날');
  around(solarOfLunar(year, 8, 15), '추석');
  lunarTables.set(year, table);
  return table;
}

export function holidayNames(dateKey: string): string[] {
  const names: string[] = [];
  const fixed = FIXED[dateKey.slice(5)];
  if (fixed) names.push(fixed);
  const lunar = lunarTable(Number(dateKey.slice(0, 4))).get(dateKey);
  if (lunar) names.push(lunar);
  return names;
}

export function holidayLabel(dateKey: string): string {
  return holidayNames(dateKey).join('·');
}
