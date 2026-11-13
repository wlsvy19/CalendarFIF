import type { SyncStatus } from '../../sync/engine';
import type { ReadProblem } from '../state';

/** Reading problems come first, then upload failures, then the connection. */
export function statusText(status: SyncStatus, readProblem: ReadProblem | null = null, online = true): string {
  if (readProblem === 'denied') return '권한이 없어 읽지 못했습니다';
  if (readProblem === 'failed') return '읽지 못했습니다. 다시 연결하는 중';
  switch (status.state) {
    case 'waiting':
      return status.reason === 'denied' ? `권한이 없어 올리지 못했습니다 (대기 ${status.pending}건)` : `오프라인 (대기 ${status.pending}건)`;
    case 'sending':
      return '올리는 중';
    case 'synced':
      return online ? '동기화됨' : '오프라인';
  }
}
