import { describe, expect, it } from 'vitest';
import { applyFunnelFrequencyBreakdown } from '../../lib/hook-patterns/index.js';

describe('funnel frequency intervention determinism', () => {
  it('does not use random insertion IDs to choose a user outcome', () => {
    const decisions = new Set();
    for (let index = 0; index < 100; index++) {
      const events = [
        { event: 'Entry', user_id: 'person', time: '2026-08-01T12:00:00Z', insert_id: `random-${index}` },
        { event: 'Success', user_id: 'person', time: '2026-08-01T12:01:00Z', insert_id: `result-${index}` },
      ];
      decisions.add(applyFunnelFrequencyBreakdown(events, {}, events, {
        cohortEvent: 'Entry', bins: { all: [0, Infinity] }, dropMultipliers: { all: 0.5 }, finalStep: 'Success',
      }).droppedFinal);
    }
    expect(decisions.size).toBe(1);
  });
});