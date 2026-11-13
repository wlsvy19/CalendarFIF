export function deviceLabel(userAgent: string): 'iphone' | 'pc' {
  return /iPhone|iPad/.test(userAgent) ? 'iphone' : 'pc';
}
