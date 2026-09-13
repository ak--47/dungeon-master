import { describe, expect, it } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';
import { applyFunnelDefaults } from '../../lib/verify/verify-dungeon.js';

const origin = Date.parse('2026-08-01T12:00:00Z');
const events = [
  { event: 'A', user_id: 'person', plan: 'x', time: new Date(origin).toISOString() },
  { event: 'B', user_id: 'person', plan: 'y', time: new Date(origin + 1200000).toISOString() },
  { event: 'B', user_id: 'person', plan: 'x', time: new Date(origin + 2400000).toISOString() },
];
const report = { type: 'funnelFrequency', steps: ['A', 'B'], breakdownByFrequencyOf: 'A', countMode: 'sessions' };

describe('story report session boundaries', () => {
  it('passes supported scalar held-property session counting through the report wrapper', () => {
    const rows = emulateBreakdown(events, { ...report, holdPropertyConstant: 'plan' });
    expect(rows.find(row => row.step === 'B')?.conversions).toBe(1);
  });

  it('keeps implicit session-count windows when applying matching funnel defaults', () => {
    const args = applyFunnelDefaults(report, [{ sequence: ['A', 'B'], order: 'sequential', conversionWindowDays: 30 }]);
    expect(args.conversionWindowMs).toBeUndefined();
    const rows = emulateBreakdown(events, args);
    expect(rows.find(row => row.step === 'B')?.conversions).toBe(1);
  });
});