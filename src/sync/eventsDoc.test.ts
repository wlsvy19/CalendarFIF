import { describe, expect, it } from 'vitest';
import type { AlarmRecord } from '../core/events';
import { buildEventsWrite, decideEventsWrite, parseEventsDoc, type PendingChange } from './eventsDoc';

const DEL = { __t: 'delete' };
const TS = { __t: 'ts' };
const sentinels = { deleteField: () => DEL, serverTimestamp: () => TS };

const alarm = (text: string): AlarmRecord => ({
  type: 'alarm', date: '2026-11-20', text, done: false, repeat: { freq: 'none' },
  time: '09:00', advance: [0], editedAt: 1, editedBy: 'dev',
});

describe('eventsDoc', () => {
  it('buildEventsWrite는 항목마다 mergeFields 경로를 만들고 삭제는 deleteField로', () => {
    const w = buildEventsWrite({ a1: alarm('가'), b2: 'delete' }, sentinels);
    expect(w).not.toBeNull();
    expect(w!.data.items.a1).toEqual(alarm('가'));
    expect(w!.data.items.b2).toBe(DEL);
    expect(w!.data.updatedAt).toBe(TS);
    expect(w!.fields).toEqual([['items', 'a1'], ['items', 'b2'], ['updatedAt']]);
  });
  it('바꿀 것이 없으면 null', () => {
    expect(buildEventsWrite({}, sentinels)).toBeNull();
  });
  it('undefined 칸은 뺀다(repeat 안쪽도)', () => {
    const rec = { ...alarm('가'), repeat: { freq: 'daily', until: undefined } } as unknown as AlarmRecord;
    const w = buildEventsWrite({ a1: rec }, sentinels);
    expect(w!.data.items.a1).toEqual({ ...alarm('가'), repeat: { freq: 'daily' } });
    expect('until' in (w!.data.items.a1 as AlarmRecord).repeat).toBe(false);
  });
  it('decideEventsWrite: 서버의 더 새 편집과 다른 곳의 삭제가 이기고, 할 일이 없는 것은 쓰지 않는다', () => {
    const at = (text: string, editedAt: number): AlarmRecord => ({ ...alarm(text), editedAt });
    const save = (text: string, editedAt: number, wasNew: boolean): PendingChange => ({ change: at(text, editedAt), editedAt, wasNew });
    const del = (editedAt: number): PendingChange => ({ change: 'delete', editedAt, wasNew: false });
    const server = { older: at('서버', 100), newer: at('서버', 900), same: at('서버', 500), gone: at('서버', 100), keep: at('서버', 100) };
    const { changes, result } = decideEventsWrite(server, {
      older: save('내것', 500, false), // 서버가 더 오래됐다: 쓴다
      newer: save('내것', 500, false), // 서버가 더 새것: 진다
      same: save('내것', 500, false), // 같은 때의 저장이 이미 있다: 할 일이 없다
      deleted: save('내것', 500, false), // 서버에 있던 것을 고쳤는데 다른 곳에서 지웠다: 진다
      fresh: save('새것', 500, true), // 이 기기에서 새로 만들었다: 쓴다
      gone: del(500), // 지운다
      keep: del(50), // 지운 뒤에 다른 곳에서 고쳤다: 진다
      missing: del(500), // 이미 없다: 할 일이 없다
    });
    expect(result.written.sort()).toEqual(['fresh', 'gone', 'older']);
    expect(result.dropped.sort()).toEqual(['deleted', 'keep', 'missing', 'newer', 'same']);
    expect(Object.keys(changes).sort()).toEqual(['fresh', 'gone', 'older']);
    expect(changes.gone).toBe('delete');
    expect((changes.older as AlarmRecord).text).toBe('내것');
    expect(decideEventsWrite({}, {})).toEqual({ changes: {}, result: { written: [], dropped: [] } });
  });
  it('parseEventsDoc은 형식이 틀린 항목을 버린다', () => {
    const out = parseEventsDoc({ items: { good: alarm('좋음'), bad: { type: 'alarm' }, 'no good': alarm('x') }, updatedAt: 5 });
    expect(Object.keys(out)).toEqual(['good']);
    expect(parseEventsDoc(null)).toEqual({});
    expect(parseEventsDoc({})).toEqual({});
  });
});
