import { describe, expect, it } from 'vitest';
import {
  evaluateFunnel,
  evaluateFunnelHPC,
  resolveFunnelSegment,
} from '../../lib/verify/funnel-engine.js';

const baseMs = Date.parse('2024-01-15T00:00:00.000Z');
const steps = ['A', 'B'];
const totals = { countMode: 'totals', reentry: true };

function event(name, seconds, properties = {}) {
  return { event: name, time: new Date(baseMs + seconds * 1000).toISOString(), user_id: 'alignment-user', ...properties };
}

function summarize(attempts, stepCount) {
  return {
    completions: attempts.filter((attempt) => attempt.completed).length,
    reached: attempts.map((attempt) => attempt.reached),
    stepCounts: Array.from({ length: stepCount }, (_, step) =>
      attempts.filter((attempt) => attempt.reached >= step).length),
  };
}

describe('source-derived counting contracts (analytics 717286d2)', () => {
  it('C1: shared last/first edge completes and restarts on the same event', () => {
    const events = [event('A', 0), event('B', 10), event('A', 20), event('B', 30), event('A', 40)];
    const attempts = evaluateFunnel(events, ['A', 'B', 'A'], totals);
    expect(summarize(attempts, 3)).toEqual({ completions: 2, reached: [2, 2, 0], stepCounts: [3, 2, 2] });
    expect(attempts.map((attempt) => attempt.stepTimes[0])).toEqual([baseMs, baseMs + 20000, baseMs + 40000]);
  });

  it('C2: completion grace consumes arrivals through two seconds without reentry', () => {
    const events = [event('A', 0), event('B', 10), event('A', 11), event('B', 12)];
    expect(summarize(evaluateFunnel(events, steps, totals), 2))
      .toEqual({ completions: 1, reached: [1], stepCounts: [1, 1] });
  });

  it('C3: HPC sessions use full-stream session boundaries before property partitioning', () => {
    const events = [event('A', 0, { plan: 'x' }), event('X', 1200, { plan: 'y' }), event('B', 2400, { plan: 'x' })];
    const attempts = evaluateFunnelHPC(events, steps, 'plan', { countMode: 'sessions' }).get('x');
    expect(summarize(attempts, 2)).toEqual({ completions: 1, reached: [1], stepCounts: [1, 1] });
  });

  it.each([
    ['first', {}, { src: 'paid' }],
    ['last', { src: 'paid' }, {}],
  ])('C4: %s touch merges a property absent on the preferred reached step', (mode, firstProps, lastProps) => {
    const result = evaluateFunnel([event('A', 0, firstProps), event('B', 10, lastProps)], steps,
      { trackStepProperties: ['src'] });
    expect(result.completed).toBe(true);
    expect(resolveFunnelSegment(result, mode)?.src).toBe('paid');
  });
});

describe('C1: ordered shared-edge restart', () => {
  it('restarts only when the completion event also passes the first selector', () => {
    const filtered = [{ event: 'A', where: { prop: 'start', op: 'eq', value: true } }, 'B', 'A'];
    const events = [event('A', 0, { start: true }), event('B', 10), event('A', 20, { start: false }),
      event('B', 30), event('A', 40, { start: true }), event('B', 50), event('A', 60, { start: true })];
    const attempts = evaluateFunnel(events, filtered, totals);
    expect(attempts.map((attempt) => attempt.stepTimes[0])).toEqual([baseMs, baseMs + 40000, baseMs + 60000]);
    expect(attempts.map((attempt) => attempt.reached)).toEqual([2, 2, 0]);
  });

  it('requires the last selector and retains the first eligible shared event', () => {
    const filtered = ['A', 'B', { event: 'A', where: { prop: 'end', op: 'eq', value: true } }];
    const events = [event('A', 0), event('B', 10), event('A', 20, { end: false }), event('A', 30, { end: true })];
    const attempts = evaluateFunnel(events, filtered, totals);
    expect(attempts.map((attempt) => attempt.stepTimes[0])).toEqual([baseMs, baseMs + 30000]);
    expect(attempts.map((attempt) => attempt.reached)).toEqual([2, 0]);
  });

  it('does not anchor a replay at the exclusive anchor bound', () => {
    const events = [event('A', 0), event('B', 10), event('A', 20), event('B', 30), event('A', 40)];
    const attempts = evaluateFunnel(events, ['A', 'B', 'A'], { ...totals, anchorRange: { toMs: baseMs + 20000 } });
    expect(attempts.map((attempt) => attempt.reached)).toEqual([2]);
  });

  it('preserves strict conversion-window expiry before a shared edge', () => {
    const events = [event('A', 0), event('B', 10), event('A', 20)];
    expect(evaluateFunnel(events, ['A', 'B', 'A'], { ...totals, conversionWindowMs: 20000 })
      .map((attempt) => attempt.reached)).toEqual([1, 0]);
  });

  it('does not replay an any-order edge', () => {
    const events = [event('A', 0), event('B', 10), event('A', 20)];
    expect(evaluateFunnel(events, ['A', { anyOrder: ['B', 'A'] }], totals)
      .map((attempt) => attempt.reached)).toEqual([2]);
    expect(evaluateFunnel(events, [{ anyOrder: ['A', 'B'] }, 'A'], totals)
      .map((attempt) => attempt.reached)).toEqual([2]);
  });

  it('makes progress with single steps and equal-time shared edges', () => {
    expect(evaluateFunnel([event('A', 0)], ['A'], totals)).toHaveLength(1);
    const attempts = evaluateFunnel([event('A', 0), event('A', 0), event('A', 0)], ['A', 'A'], totals);
    expect(attempts.map((attempt) => attempt.reached)).toEqual([1, 1, 0]);
  });
});

describe('C2: inclusive completion grace', () => {
  it.each([[1.999, 1], [2, 1], [2.001, 2]])('handles a restart %s seconds after completion', (offset, completions) => {
    const events = [event('A', 0), event('B', 10), event('A', 10 + offset), event('B', 20)];
    const attempts = evaluateFunnel(events, steps, totals);
    expect(attempts).toHaveLength(completions);
    expect(attempts.filter((attempt) => attempt.completed)).toHaveLength(completions);
  });

  it('does not replay an absorbed first step after grace ends', () => {
    const events = [event('A', 0), event('B', 10), event('A', 11), event('X', 13), event('B', 20)];
    expect(evaluateFunnel(events, steps, totals).map((attempt) => attempt.reached)).toEqual([1]);
  });

  it('respects graceperiod=false for ordinary reentry', () => {
    const events = [event('A', 0), event('B', 10), event('A', 11), event('B', 12)];
    expect(evaluateFunnel(events, steps, { ...totals, graceperiod: false })
      .map((attempt) => attempt.reached)).toEqual([1, 1]);
  });

  it('expires the conversion window even inside completion grace', () => {
    const events = [event('A', 0), event('B', 10), event('A', 11), event('B', 12)];
    expect(evaluateFunnel(events, steps, { ...totals, conversionWindowMs: 11000 })
      .map((attempt) => attempt.reached)).toEqual([1, 1]);
  });

  it.each([[1.999, true], [2, true], [2.001, false]])('handles late exclusion at %s seconds', (offset, excluded) => {
    const events = [event('A', 0), event('B', 10), event('X', 10 + offset), event('A', 16), event('B', 20)];
    const attempts = evaluateFunnel(events, steps, { ...totals, exclusionSteps: [{ event: 'X' }] });
    expect(attempts.map((attempt) => attempt.reached)).toEqual([excluded ? 0 : 1, 1]);
    expect(attempts[0].terminatedByExclusion).toBe(excluded);
    expect(attempts[1].stepTimes[0]).toBe(baseMs + 16000);
  });

  it('shared-edge completion skips late exclusion on the old history', () => {
    const events = [event('A', 0), event('B', 10), event('A', 20), event('X', 21)];
    const attempts = evaluateFunnel(events, ['A', 'B', 'A'], { ...totals, exclusionSteps: [{ event: 'X' }] });
    expect(attempts.map((attempt) => attempt.reached)).toEqual([2, 0]);
    expect(attempts.map((attempt) => attempt.terminatedByExclusion)).toEqual([false, true]);
  });

  it('keeps woRepeat open until window expiry, including shared edges', () => {
    const events = [event('A', 0), event('B', 10), event('A', 20), event('B', 30), event('A', 40)];
    expect(evaluateFunnel(events, ['A', 'B', 'A'], { countMode: 'totals', woRepeat: true })
      .map((attempt) => attempt.reached)).toEqual([2]);
  });

  it('preserves totals opt-in reentry compatibility', () => {
    const events = [event('A', 0), event('B', 10), event('A', 20), event('B', 30)];
    expect(evaluateFunnel(events, steps, { countMode: 'totals' })).toHaveLength(1);
  });
});

describe('C3: full-stream HPC session context', () => {
  it.each([
    { countMode: 'sessions' },
    { countMode: 'totals', woRepeat: true, conversionWindow: { unit: 'sessions', n: 1 } },
    { ...totals, conversionWindow: { unit: 'sessions', n: 1 } },
  ])('bridges sessions without accepting wrong-property steps: %j', (options) => {
    const events = [event('A', 0, { plan: 'x' }), event('B', 1200, { plan: 'y' }), event('B', 2400, { plan: 'x' })];
    const attempts = evaluateFunnelHPC(events, steps, 'plan', options).get('x');
    expect(summarize(attempts, 2)).toEqual({ completions: 1, reached: [1], stepCounts: [1, 1] });
    expect(attempts[0].stepEvents[1]).toBe(events[2]);
    expect(evaluateFunnelHPC(events.slice(0, 2), steps, 'plan', options).get('x')[0].completed).toBe(false);
  });

  it('retains public session-window validation', () => {
    const events = [event('A', 0, { plan: 'x' })];
    expect(() => evaluateFunnelHPC(events, steps, 'plan', { countMode: 'sessions', reentry: true })).toThrow(/re-entry/);
    expect(() => evaluateFunnelHPC(events, steps, 'plan', { conversionWindow: { unit: 'sessions', n: 13 } })).toThrow(/12-session/);
    expect(() => evaluateFunnelHPC(events, steps, 'plan', {
      conversionWindow: { unit: 'sessions', n: 1 }, conversionWindowMs: 1000,
    })).toThrow(/mutually exclusive/);
  });
});

describe('C4: reached-path touch allocation', () => {
  it.each([
    [undefined, 'paid', 'paid', 'paid'],
    ['paid', undefined, 'paid', 'paid'],
    [null, 'paid', 'paid', 'paid'],
    ['paid', null, 'paid', 'paid'],
    [undefined, null, null, null],
    [null, undefined, null, null],
    [null, null, null, null],
    [undefined, undefined, undefined, undefined],
    ['organic', 'paid', 'organic', 'paid'],
    [false, 0, false, 0],
  ])('merges %s and %s without changing snapshots', (first, last, expectedFirst, expectedLast) => {
    const result = evaluateFunnel([event('A', 0, { src: first }), event('B', 10, { src: last })], steps,
      { trackStepProperties: ['src'] });
    for (const snapshot of result.stepProperties) Object.freeze(snapshot);
    Object.freeze(result.stepProperties);
    expect(resolveFunnelSegment(result, 'first')).toEqual({ src: expectedFirst });
    expect(resolveFunnelSegment(result, 'last')).toEqual({ src: expectedLast });
    expect(resolveFunnelSegment(result, { step: 0 })).toEqual({ src: first });
    expect(resolveFunnelSegment(result, { step: 1 })).toEqual({ src: last });
  });

  it('merges only reached steps on a partial path', () => {
    const result = evaluateFunnel([event('A', 0), event('B', 10, { src: 'paid' }), event('D', 20, { src: 'unreached' })],
      ['A', 'B', 'C', 'D'], { trackStepProperties: ['src'] });
    expect(result.reached).toBe(1);
    expect(resolveFunnelSegment(result, 'first')).toEqual({ src: 'paid' });
    expect(resolveFunnelSegment(result, 'last')).toEqual({ src: 'paid' });
    expect(resolveFunnelSegment(result, { step: 2 })).toBeUndefined();
  });

  it('uses recorded any-order path instead of declaration order', () => {
    const result = evaluateFunnel([event('C', 0, { src: 'first' }), event('B', 10, { src: 'last' })],
      [{ anyOrder: ['B', 'C'] }], { trackStepProperties: ['src'] });
    expect(result.completed).toBe(true);
    expect(result.stepEvents.map((matched) => matched.event)).toEqual(['C', 'B']);
    expect(resolveFunnelSegment(result, 'first')).toEqual({ src: 'first' });
    expect(resolveFunnelSegment(result, 'last')).toEqual({ src: 'last' });
    expect(resolveFunnelSegment(result, { step: 0 })).toEqual({ src: 'first' });
  });

  it('merges a partial any-order path in recorded order, even when times go backward', () => {
    const result = evaluateFunnel([event('C', 9, { src: 'last' }), event('A', 10, { src: null }),
      event('B', 11, { src: 'first' })], ['A', { anyOrder: ['B', 'C'] }, 'D'], { trackStepProperties: ['src'] });
    expect(result.reached).toBe(2);
    expect(result.stepEvents.map((matched) => matched.event)).toEqual(['A', 'C', 'B']);
    expect(resolveFunnelSegment(result, 'first')).toEqual({ src: 'last' });
    expect(resolveFunnelSegment(result, 'last')).toEqual({ src: 'first' });
  });
});

describe('nearby controls', () => {
  it('permits distinct-edge reentry after completion grace', () => {
    const events = [event('A', 0), event('B', 10), event('A', 13), event('B', 20)];
    expect(summarize(evaluateFunnel(events, steps, totals), 2))
      .toEqual({ completions: 2, reached: [1, 1], stepCounts: [2, 2] });
  });

  it('uses the unrelated event to bridge the session without HPC', () => {
    const events = [event('A', 0), event('X', 1200), event('B', 2400)];
    expect(summarize(evaluateFunnel(events, steps, { countMode: 'sessions' }), 2))
      .toEqual({ completions: 1, reached: [1], stepCounts: [1, 1] });
  });

  it('does not bridge a real 40-minute gap for HPC sessions', () => {
    const events = [event('A', 0, { plan: 'x' }), event('B', 2400, { plan: 'x' })];
    expect(summarize(evaluateFunnelHPC(events, steps, 'plan', { countMode: 'sessions' }).get('x'), 2))
      .toEqual({ completions: 0, reached: [0], stepCounts: [1, 0] });
  });

  it('keeps first/last precedence when both reached steps define the property', () => {
    const result = evaluateFunnel([event('A', 0, { src: 'organic' }), event('B', 10, { src: 'paid' })], steps,
      { trackStepProperties: ['src'] });
    expect(resolveFunnelSegment(result, 'first')?.src).toBe('organic');
    expect(resolveFunnelSegment(result, 'last')?.src).toBe('paid');
    expect(resolveFunnelSegment(result, { step: 0 })?.src).toBe('organic');
    expect(resolveFunnelSegment(result, { step: 1 })?.src).toBe('paid');
  });
});