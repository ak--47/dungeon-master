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