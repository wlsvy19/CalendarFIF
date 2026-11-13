export type GridCell = { dateKey: string; monthId: string; day: string; dayOfMonth: number; dow: number; inMonth: boolean };

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function monthIdOf(year: number, monthIndex: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(monthIndex + 1)}`;
}

export function dateKeyOf(monthId: string, day: string): string {
  return `${monthId}-${day}`;
}

export function splitDateKey(dateKey: string): { monthId: string; day: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dayNum = Number(m[3]);
  const d = new Date(year, month - 1, dayNum);
  d.setFullYear(year);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== dayNum) return null;
  return { monthId: `${m[1]}-${m[2]}`, day: m[3] };
}

function parseMonthId(monthId: string): { year: number; monthIndex: number } {
  const [y, m] = monthId.split('-');
  return { year: Number(y), monthIndex: Number(m) - 1 };
}

export function shiftMonth(monthId: string, delta: number): string {
  const { year, monthIndex } = parseMonthId(monthId);
  const total = year * 12 + monthIndex + delta;
  return monthIdOf(Math.floor(total / 12), ((total % 12) + 12) % 12);
}

export function buildMonthGrid(monthId: string): GridCell[] {
  const { year, monthIndex } = parseMonthId(monthId);
  const firstDow = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const cells: GridCell[] = [];
  for (let i = 0; i < cellCount; i++) {
    const d = new Date(year, monthIndex, 1 - firstDow + i);
    const cellMonthId = monthIdOf(d.getFullYear(), d.getMonth());
    const day = pad2(d.getDate());
    cells.push({
      dateKey: dateKeyOf(cellMonthId, day),
      monthId: cellMonthId,
      day,
      dayOfMonth: d.getDate(),
      dow: d.getDay(),
      inMonth: cellMonthId === monthId,
    });
  }
  return cells;
}

export function todayKey(now: Date = new Date()): string {
  return dateKeyOf(monthIdOf(now.getFullYear(), now.getMonth()), pad2(now.getDate()));
}
