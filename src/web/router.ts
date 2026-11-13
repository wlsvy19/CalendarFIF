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
