import { splitDateKey } from '../core/dates';

export type Route = { name: 'calendar' } | { name: 'day'; dateKey: string } | { name: 'settings' };

export function parseHash(hash: string): Route {
  const value = hash.replace(/^#/, '');
  if (value === 'settings') return { name: 'settings' };
  if (splitDateKey(value)) return { name: 'day', dateKey: value };
  return { name: 'calendar' };
}

export function hashFor(route: Route): string {
  if (route.name === 'day') return `#${route.dateKey}`;
  if (route.name === 'settings') return '#settings';
  return '';
}
