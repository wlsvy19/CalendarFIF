import { describe, expect, it } from 'vitest';
import { ALIVE_MS, AWAY_LIMIT, CREDIT_MS, KEEP_PER_HOW, MAX_TRIES, RELOAD_EPOCH, REPEATABLE, RETRY_AFTER_MS, SETTLE_MS, creditDraw, outcomeOf, pickReload, reloadCell, toProbe, triesOf, verdictOf, type ReloadTry } from './reload';

const NOW = new Date(2026, 10, 17, 14, 0, 0).getTime();
const MIN = 60_000;
/** 오래전(다 지켜본 뒤)의 시도. ago: 몇 분 전인가. 목록에는 옛 것부터 적는다. */
const t = (how: ReloadTry['how'], ago: number, more: Partial<ReloadTry> = {}): ReloadTry => ({ how, why: 'probe', at: NOW - ago * MIN, got: 0, alive: true, void: false, away: false, shut: false, err: '', ...more });
const hit = (how: ReloadTry['how'], ago: number, more: Partial<ReloadTry> = {}): ReloadTry => t(how, ago, { got: NOW - ago * MIN + 800, ...more });
/** 달력에서 저장하고 바로 홈 화면으로 나가 지켜보지 못했고 그림도 없는 것. */
const away = (how: ReloadTry['how'], ago: number): ReloadTry => t(how, ago, { why: 'save', away: true });

describe('triesOf', () => {
  it('보관 파일의 칸을 읽는다. 판 번호가 다르거나 모양이 다른 것은 버린다', () => {
    const one = t('ping', 3, { got: 5, away: true, shut: true, err: 'x' });
    expect(triesOf(reloadCell([one]))).toEqual([one]);
    expect(triesOf({ epoch: RELOAD_EPOCH, tries: [{ how: 'finish', why: 'save', at: 7 }] })).toEqual([{ how: 'finish', why: 'save', at: 7, got: 0, alive: false, void: false, away: false, shut: false, err: '' }]);
    expect(triesOf({ epoch: RELOAD_EPOCH + 1, tries: [one] })).toEqual([]);
    for (const v of [undefined, null, [], {}, { epoch: RELOAD_EPOCH }, { epoch: RELOAD_EPOCH, tries: 'x' }]) expect(triesOf(v)).toEqual([]);
    const bad = [null, 'x', { how: 'other', why: 'save', at: 1 }, { how: 'ping', why: 'other', at: 1 }, { how: 'ping', why: 'save', at: 0 }, { how: 'ping', why: 'save', at: 'x' }];
    expect(triesOf({ epoch: RELOAD_EPOCH, tries: [...bad, one] })).toEqual([one]);
  });

  it('스물여덟 개까지만 남긴다. 방법마다 판정에 들어가는 마지막 여섯 개는 다른 기록에 밀려 나가지 않는다', () => {
    const many = Array.from({ length: MAX_TRIES + 5 }, (_, i) => t('setWidget', 100 - i, { void: true }));
    expect(triesOf(reloadCell(many))).toEqual(many.slice(-MAX_TRIES));
    // 메뉴에서 시험한 기록 뒤에, 저장할 때마다 스크립트를 끝낸 기록이 마흔 번 쌓였다.
    const probes = [t('setWidget', 900), t('ping', 899), t('complete', 898)];
    const saves = Array.from({ length: 40 }, (_, i) => hit('finish', 800 - i, { why: 'save' }));
    const kept = triesOf(reloadCell([...probes, ...saves]));
    expect(kept).toHaveLength(MAX_TRIES);
    expect(kept.slice(0, 3)).toEqual(probes);
    expect(kept.slice(3)).toEqual(saves.slice(-(MAX_TRIES - 3)));
    // 그래서 판정이 그대로다: 같은 시험을 되풀이하지 않는다.
    expect(toProbe(kept, NOW)).toEqual([]);
    expect(pickReload(kept, NOW)).toBe('finish');
  });

  it('하자마자 메뉴가 닫힌 기록은 판정의 근거라 남기고, 닫아서 무효가 된 것과 나간 뒤에 한 것은 먼저 버린다', () => {
    const shut = [t('ping', 900, { void: true, shut: true }), t('ping', 899, { void: true, shut: true })];
    const noise = Array.from({ length: 40 }, (_, i) => t('ping', 800 - i, { why: i % 2 === 0 ? 'leave' : 'save', void: true }));
    const kept = triesOf(reloadCell([...shut, ...noise]));
    expect(kept.slice(0, 2)).toEqual(shut);
    expect(verdictOf('ping', kept, NOW)).toBe('bad');
    expect(KEEP_PER_HOW).toBe(6);
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

  it('여러 시도가 있으면 그림의 바로 앞 것에 적는다. 닫아서 무효가 된 것과 하지 못한 것은 건너뛴다', () => {
    const older = fresh({ how: 'setWidget', at: at - 2000 });
    expect(creditDraw([older, fresh()], at + 500)).toEqual([older, fresh({ got: at + 500 })]);
    // 뒤의 시도보다 앞에 시작한 그림은 앞의 시도의 것이다.
    expect(creditDraw([older, fresh()], at - 500)).toEqual([{ ...older, got: at - 500 }, fresh()]);
    for (const skip of [{ void: true }, { err: '못 했다' }]) {
      expect(creditDraw([older, fresh(skip)], at + 500)).toEqual([{ ...older, got: at + 500 }, fresh(skip)]);
      expect(creditDraw([fresh(skip)], at + 500)).toBeNull();
    }
  });

  it('바로 앞의 시도에 이미 그림이 적혀 있으면 아무 데도 적지 않는다: 위젯은 한 번에 두 번 잇달아 그려지기도 한다', () => {
    const older = fresh({ how: 'setWidget', at: at - 2000 });
    const drawn = fresh({ got: at + 900 });
    expect(creditDraw([older, drawn], at + 2900)).toBeNull();
    expect(creditDraw([drawn], at + 2900)).toBeNull();
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

  it('닫아서 무효가 된 것과 나간 뒤에 한 것은 판정에 넣지 않는다(그림이 적혀 있어도)', () => {
    expect(outcomeOf(t('ping', 5, { void: true }), NOW)).toBe('open');
    expect(outcomeOf(hit('ping', 5, { void: true }), NOW)).toBe('open');
    expect(outcomeOf(hit('ping', 5, { why: 'leave' }), NOW)).toBe('open');
  });

  it('나가서 지켜보지 못한 것: 그려졌으면 hit, 아니면 away(안 그려진 것으로 치지 않는다)', () => {
    expect(outcomeOf(hit('ping', 5, { why: 'save', away: true }), NOW)).toBe('hit');
    expect(outcomeOf(away('ping', 5), NOW)).toBe('away');
    expect(outcomeOf({ ...away('ping', 0), at: NOW - 3000 }, NOW)).toBe('open');
  });

  it('하자마자 메뉴가 닫혔거나, 메뉴에서 시험한 뒤 스크립트가 멈췄으면 hurt(그려졌더라도)', () => {
    expect(outcomeOf(t('complete', 5, { shut: true, void: true }), NOW)).toBe('hurt');
    expect(outcomeOf(hit('ping', 5, { alive: false }), NOW)).toBe('hurt');
    // 아직 지켜보는 중이면 모른다.
    expect(outcomeOf({ ...t('ping', 0, { alive: false }), at: NOW - ALIVE_MS }, NOW)).toBe('open');
    // 달력에서 저장할 때 한 것은 멈췄는지로 가리지 않는다(살아 있음을 적지 않는다).
    expect(outcomeOf(hit('ping', 5, { alive: false, why: 'save' }), NOW)).toBe('hit');
    expect(outcomeOf(t('finish', 5, { alive: false, why: 'save' }), NOW)).toBe('miss');
  });
});

describe('verdictOf', () => {
  it('해 본 적이 없거나 판정에 넣을 것이 없으면 모른다', () => {
    expect(verdictOf('ping', [], NOW)).toBe('unknown');
    expect(verdictOf('ping', [hit('setWidget', 6), hit('setWidget', 5), t('ping', 5, { void: true }), hit('ping', 4, { why: 'leave' })], NOW)).toBe('unknown');
  });

  it('여러 번 쓰는 방법은 잇달아 두 번 그려져야 된다. 한 번뿐이면 모르는 것으로 두어 다시 시험한다', () => {
    expect(verdictOf('ping', [hit('ping', 5)], NOW)).toBe('unknown');
    expect(verdictOf('ping', [hit('ping', 6), hit('ping', 5)], NOW)).toBe('works');
    // 안 그려진 적이 있어도 그 뒤에 두 번 그려졌으면 된다.
    expect(verdictOf('ping', [t('ping', 9), hit('ping', 6), hit('ping', 5)], NOW)).toBe('works');
    // 두 번 그려진 뒤 한 번 안 그려진 것은 넘어간다. 그 뒤에 다시 그려져도 그대로 된다. 두 번 잇달아 안 그려지면 안 된다.
    expect(verdictOf('ping', [hit('ping', 9), hit('ping', 8), t('ping', 5)], NOW)).toBe('works');
    expect(verdictOf('ping', [hit('ping', 9), hit('ping', 8), t('ping', 5), hit('ping', 4)], NOW)).toBe('works');
    expect(verdictOf('ping', [hit('ping', 9), hit('ping', 8), t('ping', 5), t('ping', 4)], NOW)).toBe('fails');
    // 그려진 것 사이에 안 그려진 것이 끼면 잇달아 그려진 것이 아니다: 다시 시험한다.
    expect(verdictOf('ping', [hit('ping', 9), t('ping', 8), hit('ping', 5)], NOW)).toBe('unknown');
    expect(verdictOf('ping', [hit('ping', 9), t('ping', 5)], NOW)).toBe('unknown');
  });

  it('메뉴를 열 때마다 "한 번 그려지고, 다시 하면 안 그려지는" 방법은 두 번이면 안 되는 것으로 본다(끝없이 다시 시험하지 않는다)', () => {
    expect(verdictOf('ping', [hit('ping', 9), t('ping', 8)], NOW)).toBe('unknown');
    expect(verdictOf('ping', [hit('ping', 9), t('ping', 8), hit('ping', 5), t('ping', 4)], NOW)).toBe('fails');
    expect(toProbe([hit('setWidget', 9), t('setWidget', 8), hit('setWidget', 5), t('setWidget', 4), t('ping', 3), t('complete', 2)], NOW)).toEqual([]);
  });

  it('안 되는 것으로 가려진 지 사흘이 지나면 모르는 것으로 돌려 한 번 더 해 본다', () => {
    const days = (n: number): number => (n * RETRY_AFTER_MS) / 3 / MIN;
    expect(verdictOf('ping', [t('ping', days(2.9))], NOW)).toBe('fails');
    expect(verdictOf('ping', [t('ping', days(3))], NOW)).toBe('unknown');
    expect(verdictOf('finish', [t('finish', days(9), { why: 'save' }), t('finish', days(8), { why: 'save' })], NOW)).toBe('unknown');
    // 다시 해 봐서 또 안 그려지면 다시 사흘 동안 안 되는 것이다.
    expect(verdictOf('ping', [t('ping', days(5)), t('ping', 1)], NOW)).toBe('fails');
    // 쓰지 않기로 한 것(스크립트가 멈추거나 메뉴가 닫혔다)은 그대로다.
    expect(verdictOf('ping', [t('ping', days(9), { alive: false }), t('ping', days(8), { alive: false })], NOW)).toBe('bad');
  });

  it('스크립트 끝내기는 한 번 그려지면 된다', () => {
    expect(verdictOf('finish', [hit('finish', 5, { why: 'save' })], NOW)).toBe('works');
    expect(verdictOf('finish', [hit('finish', 5, { why: 'save' }), t('finish', 4, { why: 'save' })], NOW)).toBe('works');
    expect(verdictOf('finish', [hit('finish', 5, { why: 'save' }), t('finish', 4, { why: 'save' }), t('finish', 3, { why: 'save' })], NOW)).toBe('fails');
  });

  it('그려진 적 없이 한 번 안 그려지면: 여러 번 쓰는 방법은 안 되는 것, 스크립트 끝내기는 한 번 더 해 볼 것', () => {
    for (const how of REPEATABLE) expect(verdictOf(how, [t(how, 5)], NOW)).toBe('fails');
    expect(verdictOf('finish', [t('finish', 5, { why: 'save' })], NOW)).toBe('unknown');
    expect(verdictOf('finish', [t('finish', 5, { why: 'save' }), t('finish', 4, { why: 'save' })], NOW)).toBe('fails');
  });

  it('한 번 멈추거나 닫혔으면 다시 시험할 것으로 두고, 두 번 잇달아 그러면 쓰지 않는다', () => {
    const hurt = (ago: number): ReloadTry => t('complete', ago, { shut: true, void: true });
    expect(verdictOf('complete', [hurt(5)], NOW)).toBe('unknown');
    expect(verdictOf('complete', [hit('complete', 9), hit('complete', 8), hurt(5)], NOW)).toBe('unknown');
    expect(verdictOf('complete', [hurt(9), hurt(5)], NOW)).toBe('bad');
    expect(verdictOf('ping', [t('ping', 9, { alive: false }), t('ping', 5, { alive: false })], NOW)).toBe('bad');
    // 그 뒤에 잘 됐으면 앞의 것은 보지 않는다.
    expect(verdictOf('complete', [hurt(9), hurt(7), hit('complete', 6), hit('complete', 5)], NOW)).toBe('works');
    expect(verdictOf('complete', [hurt(9), t('complete', 5)], NOW)).toBe('fails');
  });

  it('나가서 지켜보지 못했고 그림도 없는 일이 세 번 잇달으면, 되던 방법도 모르는 것으로 돌린다', () => {
    const proof = [hit('ping', 60), hit('ping', 59)];
    expect(AWAY_LIMIT).toBe(3);
    expect(verdictOf('ping', [...proof, away('ping', 9), away('ping', 8)], NOW)).toBe('works');
    expect(verdictOf('ping', [...proof, away('ping', 9), away('ping', 8), away('ping', 7)], NOW)).toBe('unknown');
    // 나갔어도 그려진 것이 사이에 있으면 다시 센다.
    expect(verdictOf('ping', [...proof, away('ping', 9), away('ping', 8), hit('ping', 7, { why: 'save', away: true }), away('ping', 6), away('ping', 5)], NOW)).toBe('works');
    // 돌린 뒤에 메뉴에서 다시 두 번 그려지면 다시 된다. 다시 시험해서 안 그려지면 안 되는 것이다(옛 근거로 되돌아가지 않는다).
    expect(verdictOf('ping', [...proof, away('ping', 9), away('ping', 8), away('ping', 7), hit('ping', 2), hit('ping', 1)], NOW)).toBe('works');
    expect(verdictOf('ping', [...proof, away('ping', 9), away('ping', 8), away('ping', 7), t('ping', 1)], NOW)).toBe('fails');
  });
});

describe('relaunch', () => {
  const save = { why: 'save' as const };
  it('그려진 적 없이 한 번 안 그려지면 안 되는 것이다(finish는 모르는 것으로 둔다)', () => {
    expect(verdictOf('relaunch', [t('relaunch', 5, save)], NOW)).toBe('fails');
    expect(verdictOf('finish', [t('finish', 5, save)], NOW)).toBe('unknown');
  });
  it('한 번 그려지면 된다. 옛 이름(reopen)의 기록은 relaunch의 판정에 들지 않는다', () => {
    expect(verdictOf('relaunch', [t('relaunch', 5, { ...save, got: NOW - 5 * MIN + 100 })], NOW)).toBe('works');
    expect(verdictOf('relaunch', [t('reopen', 9, save), t('reopen', 8, save)], NOW)).toBe('unknown');
  });
});

describe('pickReload', () => {
  it('되는 것으로 가려진 여러 번 쓰는 방법을 앞의 것부터 고른다', () => {
    const twice = (how: ReloadTry['how'], ago: number): ReloadTry[] => [hit(how, ago + 1), hit(how, ago)];
    expect(pickReload([...twice('ping', 5), ...twice('complete', 3)], NOW)).toBe('ping');
    expect(pickReload([...twice('setWidget', 5), ...twice('ping', 3)], NOW)).toBe('setWidget');
    expect(pickReload([t('setWidget', 6), t('ping', 5), ...twice('complete', 3)], NOW)).toBe('complete');
  });

  it('없으면 스크립트 끝내기다(한 번만 그려진 방법은 아직 쓰지 않는다). 그것도 안 되는 것으로 가려졌으면 아무것도 하지 않는다', () => {
    expect(pickReload([], NOW)).toBe('finish');
    expect(pickReload([hit('ping', 5)], NOW)).toBe('finish');
    expect(pickReload([t('setWidget', 6), t('ping', 5), t('complete', 4)], NOW)).toBe('finish');
    expect(pickReload([t('finish', 6, { why: 'save' })], NOW)).toBe('finish');
    expect(pickReload([t('finish', 6, { why: 'save' }), t('finish', 5, { why: 'save' })], NOW)).toBeNull();
    expect(pickReload([t('finish', 6, { why: 'save' }), t('finish', 5, { why: 'save' }), hit('ping', 4), hit('ping', 3)], NOW)).toBe('ping');
  });
});

describe('toProbe', () => {
  it('아직 모르는 여러 번 쓰는 방법을 차례대로 준다. 되는 것이 있으면 시험하지 않는다', () => {
    expect(toProbe([], NOW)).toEqual(['setWidget', 'ping', 'complete']);
    expect(toProbe([t('setWidget', 5)], NOW)).toEqual(['ping', 'complete']);
    // 한 번만 그려진 것은 한 번 더 시험한다.
    expect(toProbe([t('setWidget', 5), hit('ping', 4)], NOW)).toEqual(['ping', 'complete']);
    expect(toProbe([t('setWidget', 5), hit('ping', 4), hit('ping', 3)], NOW)).toEqual([]);
    expect(toProbe([t('setWidget', 6), t('ping', 5), t('complete', 4)], NOW)).toEqual([]);
    // 한 번 멈춘 것은 다시 시험하고, 두 번 멈춘 것은 하지 않는다.
    expect(toProbe([t('setWidget', 6), t('ping', 5, { alive: false }), t('complete', 4)], NOW)).toEqual(['ping']);
    expect(toProbe([t('setWidget', 6), t('ping', 5, { alive: false }), t('ping', 4, { alive: false }), t('complete', 3)], NOW)).toEqual([]);
    // 닫아서 무효가 된 것은 다시 시험한다.
    expect(toProbe([t('setWidget', 6, { void: true }), t('ping', 5), t('complete', 4)], NOW)).toEqual(['setWidget']);
  });
});
