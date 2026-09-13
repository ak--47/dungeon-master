import { describe, expect, it, vi } from 'vitest';
import { buildEventIdentityMap, buildIdentityMap, resolveUserId } from '../../lib/verify/identity.js';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';
import { evaluateAssertion } from '../../lib/verify/story-runner.js';

describe('live alignment review boundaries', () => {
  it('preserves an explicit event user during an automatic device mapping conflict', () => {
    const events = [{ device_id: 'device', user_id: 'first' }, { device_id: 'device', user_id: 'second' }];
    const map = buildEventIdentityMap(events);
    expect(resolveUserId(events[1], map)).toBe('second');
    expect(resolveUserId({ device_id: 'device' }, map)).toBe('first');
    const explicit = buildIdentityMap([{ distinct_id: 'override', device_ids: ['device'] }]);
    expect(resolveUserId(events[1], explicit)).toBe('override');
  });

  it('runs object-result callbacks before conservatively capping unknown population evidence', () => {
    const callback = vi.fn(() => ({ pass: true }));
    const result = evaluateAssertion({ nodes: [], edges: [] }, { breakdown: { type: 'topPaths' }, minCohort: 1, assert: callback });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result.verdict).toBe('WEAK');
    expect(result.detail).toMatch(/independent-user denominator unavailable/);
  });

  it('validates bucketed attribution options even without conversions', () => {
    expect(() => emulateBreakdown([{ event: 'Touch', time: '2026-08-01', user_id: 'person', source: 'paid' }], {
      type: 'attributedBy', conversionEvent: 'Buy', attributionEvent: 'Touch', attributionProperty: 'source',
      perConversion: 'every', timeBucket: 'day',
    })).toThrow(/perConversion/);
  });
});