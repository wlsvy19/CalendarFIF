export const PALETTE: readonly string[] = [
  'FF9595', 'F9BC0B', 'FBF078', 'CBFB91', 'B5CEF6', 'D7B1F9', 'E6C9A8',
  '282828', 'F12424', 'FF6821', 'F5D107', '009300', '3737F4', '4A0081', '61D2BA',
  '65C444', '90949D', 'FFD9E9', 'FAE3CE', 'CDF0EB', 'D9E8FF', 'D4CDF0',
];

export function isColor(value: string): boolean {
  return value === '' || /^[0-9A-F]{6}$/.test(value);
}

export function normalizeColor(raw: string): string {
  const candidate = raw.trim().replace(/^#/, '').toUpperCase();
  return isColor(candidate) ? candidate : '';
}
