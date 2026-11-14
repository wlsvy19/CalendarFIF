// fetch-holidays.mjs의 형. 스크립트는 의존성 없는 Node로 돌리고, 시험(TypeScript)은 이 형으로 부른다.

export type Day = { date: string; name: string };
export type HolidayFile = { version: 1; updatedAt: string; years: Record<string, { days: Day[] }> };
export type PreviousFile = { version: 1; updatedAt: string | null; years: Record<string, { days: Day[] }> };
export type MonthResult = { ok: true; days: Day[] } | { ok: false; reason: string; keyProblem: boolean };
export type YearResult = { ok: true; days: Day[] } | { ok: false; reason: string };
export type TextAnswer = { status: number; text: string };
export type FetchText = (url: string) => Promise<TextAnswer>;
export type Files = { read(path: string): string | null; write(path: string, text: string): void; append(path: string, text: string): void };
export type MainDeps = {
  argv: string[];
  env: Record<string, string | undefined>;
  fetchText?: FetchText;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  files?: Files;
  log?: (line: string) => void;
  error?: (line: string) => void;
};

export const API_URL: string;
export function encodeKey(key: string): string;
export function requestUrl(year: number, month: number, key: string): string;
export function maskKey(message: string, key: string): string;
export function koreaYear(nowMs: number): number;
export function parseMonthResponse(status: number, raw: string, year: number, month: number): MonthResult;
export function fetchYears(
  years: number[],
  deps: { key: string; fetchText: FetchText; sleep: (ms: number) => Promise<void> },
): Promise<{ years: Record<string, YearResult>; fatal: string | null }>;
export function parsePrevious(raw: string): PreviousFile | null;
export function buildOutput(input: {
  fetched: Record<string, YearResult>;
  previous: PreviousFile | HolidayFile | null;
  currentYear: number;
  now: Date;
}): { file: HolidayFile | null; lines: string[]; changed: boolean };
export function serialize(file: HolidayFile): string;
export function main(deps: MainDeps): Promise<number>;
