import { describe, expect, it } from 'vitest';
import { ALIVE_MS, CREDIT_MS, MAX_TRIES, RELOAD_EPOCH, REPEATABLE, SETTLE_MS, creditDraw, outcomeOf, pickReload, reloadCell, toProbe, triesOf, verdictOf, type ReloadTry } from './reload';

const NOW = new Date(2026, 10, 17, 14, 0, 0).getTime();
const MIN = 60_000;
/** 오래전(다 지켜본 뒤)의 시도. ago: 몇 분 전인가. */
const t = (how: ReloadTry['how'], ago: number, more: Partial<ReloadTry> = {}): ReloadTry => ({ how, why: 'probe', at: NOW - ago * MIN, got: 0, alive: true, void: false, away: false, shut: false, err: '', ...more });
const hit = (how: ReloadTry['how'], ago: number, more: Partial<ReloadTry> = {}): ReloadTry => t(how, ago, { got: NOW - ago * MIN + 800, ...more });

describe('triesOf', () => {
  it('보관 파일의 칸을 읽는다. 판 번호가 다르거나 모양이 다른 것은 버리고 마지막 열두 개만 둔다', () => {
    const one = t('ping', 3, { got: 5, away: true, shut: true, err: 'x' });
    expect(triesOf(reloadCell([one]))).toEqual([one]);
    expect(triesOf({ epoch: RELOAD_EPOCH, tries: [{ how: 'finish', why: 'save', at: 7 }] })).toEqual([{ how: 'finish', why: 'save', at: 7, got: 0, alive: false, void: false, away: false, shut: false, err: '' }]);
    expect(triesOf({ epoch: RELOAD_EPOCH + 1, tries: [one] })).toEqual([]);
    for (const v of [undefined, null, [], {}, { epoch: RELOAD_EPOCH }, { epoch: RELOAD_EPOCH, tries: 'x' }]) expect(triesOf(v)).toEqual([]);
    const bad = [null, 'x', { how: 'other', why: 'save', at: 1 }, { how: 'ping', why: 'other', at: 1 }, { how: 'ping', why: 'save', at: 0 }, { how: 'ping', why: 'save', at: 'x' }];
    expect(triesOf({ epoch: RELOAD_EPOCH, tries: [...bad, one] })).toEqual([one]);
    const many = Array.from({ length: MAX_TRIES + 5 }, (_, i) => t('setWidget', 100 - i));
    expect(triesOf(reloadCell(many))).toEqual(many.slice(-MAX_TRIES));
  });

  it('열두 개를 넘으면 판정에 들어가지 않을 기록부터 버린다: 판정의 근거가 그런 기록에 밀려 나가지 않는다', () => {
    const proof = hit('ping', 500);
    // 저장하자마자 홈 화면으로 나가 지켜보지 못한 것, 닫아서 무효가 된 것, 나간 뒤에 한 것이 잇달아 쌓였다.
    const noise = Array.from({ length: 20 }, (_, i) => t('ping', 400 - i, { why: i % 3 === 2 ? 'leave' : 'save', void: i % 3 !== 0, away: i % 3 === 0 }));
    const kept = triesOf(reloadCell([proof, ...noise]));
    expect(kept).toHaveLength(MAX_TRIES);
    expect(kept[0]).toEqual(proof);
    expect(kept.slice(1)).toEqual(noise.slice(-(MAX_TRIES - 1)));
    expect(verdictOf('ping', kept, NOW)).toBe('works');
    // 나갔지만 그려진 것은 근거다: 버리지 않는다. 마지막 둘은 방금 한 것이라 무엇이든 둔다.
    const hits = Array.from({ length: MAX_TRIES }, (_, i) => hit('ping', 300 - i, { why: 'save', away: true }));
    expect(triesOf(reloadCell([...hits, noise[0], noise[1]]))).toEqual([...hits.slice(2), noise[0], noise[1]]);
  });
});

describe('creditDraw', () => {
  const at = NOW - 10_000;
  const fresh = (more: Partial<ReloadTry> = {}): ReloadTry => ({ how: 'ping', why: 'save', at, got: 0, alive: true, void: false, away: false, shut: false, err: '', ...more });

  it('그림이 시작한 때의 바로 앞(5초 안)에 한 시도에 그 시각을 적는다', () => {
    expect(creditDraw([fresh()], at + 900)).toEqual([fresh({ got: at + 900 })]);
    expect(creditDraw([fresh()], at + CREDIT_MS)).toEqual([fresh({ got: at + CREDIT_MS })]);
    // 너무 뒤의 그림, 시도보다 앞의 그림은 그 시도의 것이 아니다.
    expect(creditDraw([fresh()], at + CREDIT_MS + 1)).toBeNull();
    expect(creditDraw([fresh()], at - 1)).toBeNull();
    expect(creditDraw([], at)).toBeNull();
  });

  it('홈 화면으로 나가서 지켜보지 못한 시도에도 적는다(나가기 전에 한 것이다)', () => {
    expect(creditDraw([fresh({ away: true })], at + 900)).toEqual([fresh({ away: true, got: at + 900 })]);
  });

  it('여러 시도가 있으면 그림의 바로 앞 것에 적는다. 닫아서 무효가 된 것, 이미 적힌 것, 하지 못한 것은 건너뛴다', () => {
    const older = fresh({ how: 'setWidget', at: at - 2000 });
    expect(creditDraw([older, fresh()], at + 500)).toEqual([older, fresh({ got: at + 500 })]);
    // 뒤의 시도보다 앞에 시작한 그림은 앞의 시도의 것이다.
    expect(creditDraw([older, fresh()], at - 500)).toEqual([{ ...older, got: at - 500 }, fresh()]);
    for (const skip of [{ void: true }, { got: at + 100 }, { err: '못 했다' }]) {
      expect(creditDraw([older, fresh(skip)], at + 500)).toEqual([{ ...older, got: at + 500 }, fresh(skip)]);
      expect(creditDraw([fresh(skip)], at + 500)).toBeNull();
    }
  });
});

describe('outcomeOf', () => {
  it('그려졌으면 hit, 다 지켜보고도 안 그려졌으면 miss, 아직 지켜보는 중이면 open', () => {
    expect(outcomeOf(hit('ping', 5), NOW)).toBe('hit');
    expect(outcomeOf(t('ping', 5), NOW)).toBe('miss');
    expect(outcomeOf({ ...t('ping', 0), at: NOW - SETTLE_MS + 1 }, NOW)).toBe('open');
    expect(outcomeOf({ ...t('ping', 0), at: NOW - SETTLE_MS }, NOW)).toBe('miss');
    expect(outcomeOf(t('ping', 5, { err: 'Safari.open이 없다' }), NOW)).toBe('miss');
  });

  it('닫아서 무효가 된 것과 나간 뒤에 한 것은 판정에 넣지 않는다. 나가서 지켜보지 못한 것은 그려졌으면 hit, 아니면 넣지 않는다', () => {
    expect(outcomeOf(t('ping', 5, { void: true }), NOW)).toBe('open');
    expect(outcomeOf(hit('ping', 5, { void: true }), NOW)).toBe('open');
    expect(outcomeOf(t('ping', 5, { why: 'save', away: true }), NOW)).toBe('open');
    expect(outcomeOf(hit('ping', 5, { why: 'save', away: true }), NOW)).toBe('hit');
    expect(outcomeOf(hit('ping', 5, { why: 'leave' }), NOW)).toBe('open');
  });

  it('하자마자 메뉴가 닫혔거나, 메뉴에서 시험한 뒤 스크립트가 멈췄으면 hurt(그려졌더라도)', () => {
    expect(outcomeOf(t('complete', 5, { shut: true, void: true }), NOW)).toBe('hurt');
    expect(outcomeOf(hit('ping', 5, { alive: false }), NOW)).toBe('hurt');
    // 아직 지켜보는 중이면 모른다.
    expect(outcomeOf({ ...t('ping', 0, { alive: false }), at: NOW - ALIVE_MS }, NOW)).toBe('open');
    // 달력에서 저장할 때 한 것은 멈췄는지로 가리지 않는다(저장하자마자 홈 화면으로 나가면 살아 있음을 적지 못한다).
    expect(outcomeOf(hit('ping', 5, { alive: false, why: 'save' }), NOW)).toBe('hit');
    expect(outcomeOf(t('finish', 5, { alive: false, why: 'save' }), NOW)).toBe('miss');
  });
});

describe('verdictOf', () => {
  it('해 본 적이 없거나 판정에 넣을 것이 없으면 모른다', () => {
    expect(verdictOf('ping', [], NOW)).toBe('unknown');
    expect(verdictOf('ping', [hit('setWidget', 5), t('ping', 5, { void: true }), hit('ping', 4, { why: 'leave' })], NOW)).toBe('unknown');
  });

  it('마지막에 그려졌으면 된다. 그 뒤 한 번 안 그려진 것은 넘어가고, 두 번 잇달아 안 그려지면 안 된다', () => {
    expect(verdictOf('ping', [t('ping', 9), hit('ping', 5)], NOW)).toBe('works');
    expect(verdictOf('ping', [hit('ping', 9), t('ping', 5)], NOW)).toBe('works');
    expect(verdictOf('ping', [hit('ping', 9), t('ping', 5), t('ping', 4)], NOW)).toBe('fails');
    expect(verdictOf('ping', [hit('ping', 9), t('ping', 5), t('ping', 4), hit('ping', 3)], NOW)).toBe('works');
  });

  it('그려진 적 없이 한 번 안 그려지면: 여러 번 쓰는 방법은 안 되는 것, 스크립트 끝내기는 한 번 더 해 볼 것', () => {
    for (const how of REPEATABLE) expect(verdictOf(how, [t(how, 5)], NOW)).toBe('fails');
    expect(verdictOf('finish', [t('finish', 5, { why: 'save' })], NOW)).toBe('unknown');
    expect(verdictOf('finish', [t('finish', 5, { why: 'save' }), t('finish', 4, { why: 'save' })], NOW)).toBe('fails');
    expect(verdictOf('finish', [hit('finish', 5, { why: 'save' }), t('finish', 4, { why: 'save' })], NOW)).toBe('works');
  });

  it('한 번 멈추거나 닫혔으면 다시 시험할 것으로 두고, 두 번 잇달아 그러면 쓰지 않는다', () => {
    const hurt = (ago: number): ReloadTry => t('complete', ago, { shut: true, void: true });
    expect(verdictOf('complete', [hurt(5)], NOW)).toBe('unknown');
    expect(verdictOf('complete', [hit('complete', 9), hurt(5)], NOW)).toBe('unknown');
    expect(verdictOf('complete', [hurt(9), hurt(5)], NOW)).toBe('bad');
    expect(verdictOf('ping', [t('ping', 9, { alive: false }), t('ping', 5, { alive: false })], NOW)).toBe('bad');
    // 그 뒤에 잘 됐으면 앞의 것은 보지 않는다.
    expect(verdictOf('complete', [hurt(9), hurt(7), hit('complete', 5)], NOW)).toBe('works');
    expect(verdictOf('complete', [hurt(9), t('complete', 5)], NOW)).toBe('fails');
  });
});

describe('pickReload', () => {
  it('되는 것으로 가려진 여러 번 쓰는 방법을 앞의 것부터 고른다', () => {
    expect(pickReload([hit('ping', 5), hit('complete', 4)], NOW)).toBe('ping');
    expect(pickReload([hit('setWidget', 5), hit('ping', 4)], NOW)).toBe('setWidget');
    expect(pickReload([t('setWidget', 6), t('ping', 5), hit('complete', 4)], NOW)).toBe('complete');
  });

  it('없으면 스크립트 끝내기다. 그것도 안 되는 것으로 가려졌으면 아무것도 하지 않는다', () => {
    expect(pickReload([], NOW)).toBe('finish');
    expect(pickReload([t('setWidget', 6), t('ping', 5), t('complete', 4)], NOW)).toBe('finish');
    expect(pickReload([t('finish', 6, { why: 'save' })], NOW)).toBe('finish');
    expect(pickReload([t('finish', 6, { why: 'save' }), t('finish', 5, { why: 'save' })], NOW)).toBeNull();
    expect(pickReload([t('finish', 6, { why: 'save' }), t('finish', 5, { why: 'save' }), hit('ping', 4)], NOW)).toBe('ping');
  });
});

describe('toProbe', () => {
  it('아직 모르는 여러 번 쓰는 방법을 차례대로 준다. 되는 것이 있으면 시험하지 않는다', () => {
    expect(toProbe([], NOW)).toEqual(['setWidget', 'ping', 'complete']);
    expect(toProbe([t('setWidget', 5)], NOW)).toEqual(['ping', 'complete']);
    expect(toProbe([t('setWidget', 5), hit('ping', 4)], NOW)).toEqual([]);
    expect(toProbe([t('setWidget', 6), t('ping', 5), t('complete', 4)], NOW)).toEqual([]);
    // 한 번 멈춘 것은 다시 시험하고, 두 번 멈춘 것은 하지 않는다.
    expect(toProbe([t('setWidget', 6), t('ping', 5, { alive: false }), t('complete', 4)], NOW)).toEqual(['ping']);
    expect(toProbe([t('setWidget', 6), t('ping', 5, { alive: false }), t('ping', 4, { alive: false }), t('complete', 3)], NOW)).toEqual([]);
    // 끝까지 지켜보지 못한 것은 다시 시험한다.
    expect(toProbe([t('setWidget', 6, { void: true }), t('ping', 5), t('complete', 4)], NOW)).toEqual(['setWidget']);
  });
});
