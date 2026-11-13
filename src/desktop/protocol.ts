import { extname, resolve, sep } from 'node:path';

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: wss: http://127.0.0.1:8085 http://127.0.0.1:9095 ws://127.0.0.1:8085; frame-src 'none'; object-src 'none'; base-uri 'none'";

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'app:' && u.hostname === 'calfif' ? u : null;
  } catch {
    return null;
  }
}

export function isAppUrl(url: string | undefined): boolean {
  return parse(url) !== null;
}

// app://calfif/… 를 root 안의 파일 경로로 바꾼다. 밖으로 나가거나 이상하면 null.
export function resolveAppPath(url: string, root: string): string | null {
  const u = parse(url);
  if (!u) return null;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  if (path === '/' || path === '') path = '/index.html';
  const base = resolve(root);
  const file = resolve(base, '.' + path);
  return file.startsWith(base + sep) ? file : null;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function contentType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}
