import { splitDateKey } from '../core/dates';

export type Route = { name: 'calendar' } | { name: 'day'; dateKey: string } | { name: 'settings' } | { name: 'users' };

export function parseHash(hash: string): Route {
  const value = hash.replace(/^#/, '');
  if (value === 'settings') return { name: 'settings' };
  if (value === 'users') return { name: 'users' };
  if (splitDateKey(value)) return { name: 'day', dateKey: value };
  return { name: 'calendar' };
}

export function hashFor(route: Route): string {
  if (route.name === 'day') return `#${route.dateKey}`;
  if (route.name === 'settings') return '#settings';
  if (route.name === 'users') return '#users';
  return '';
}

/**
 * 시트(편집, 설정, 사용자 관리)를 닫은 뒤 달력으로 돌아가는 방법.
 * 앱이 쌓은 기록이면 한 걸음 뒤로 가고, 주소로 곧바로 연 것이면 그 기록을 달력 주소로 바꾼다(뒤로 가기가 시트를 다시 열지 않게).
 */
export function closeAction(pushedByApp: boolean): 'back' | 'replace' {
  return pushedByApp ? 'back' : 'replace';
}
