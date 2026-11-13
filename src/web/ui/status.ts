import type { SyncStatus } from '../../sync/engine';

export function statusText(status: SyncStatus): string {
  switch (status.state) {
    case 'synced':
      return '동기화됨';
    case 'sending':
      return '올리는 중';
    case 'waiting':
      return `오프라인 (대기 ${status.pending}건)`;
  }
}
