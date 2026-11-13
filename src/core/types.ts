export type DayValue = { text: string; color: string };
export type DayRecord = { text: string; color: string; editedAt: number; editedBy: string };
export type MonthDoc = { days: Record<string, DayRecord> };
export type PendingEdit = { monthId: string; day: string; base: DayValue; next: DayValue; editedAt: number; sent?: true };
export type DayChange = DayRecord | 'delete';
export const EMPTY_DAY: DayValue = { text: '', color: '' };
