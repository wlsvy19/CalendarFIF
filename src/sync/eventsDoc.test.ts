import { describe, expect, it } from 'vitest';
import type { AlarmRecord } from '../core/events';
import { buildEventsWrite, parseEventsDoc } from './eventsDoc';

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
  it('parseEventsDoc은 형식이 틀린 항목을 버린다', () => {
    const out = parseEventsDoc({ items: { good: alarm('좋음'), bad: { type: 'alarm' }, 'no good': alarm('x') }, updatedAt: 5 });
    expect(Object.keys(out)).toEqual(['good']);
    expect(parseEventsDoc(null)).toEqual({});
    expect(parseEventsDoc({})).toEqual({});
  });
});
