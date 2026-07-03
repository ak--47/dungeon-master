//@ts-nocheck
/**
 * P2.4 binBy axis on the three bin-based patterns. Fixtures are hand-built:
 * 6 cohort events spread across exactly 2 distinct UTC days, so the SAME
 * stream classifies 'high' on the total-event axis (6 ≥ 5) and 'low' on the
 * distinct-day axis (2 < 5). Expected deltas derived from the scaleEventCount
 * / scalePropertyValue contracts by hand — never from running the patterns.
 */
import { describe, test, expect } from 'vitest';
import {
	applyFrequencyByFrequency,
	applyFunnelFrequencyBreakdown,
	applyAggregateByBin,
} from '../../lib/hook-patterns/index.js';

const T0 = Date.parse('2024-01-01T00:00:00Z');
const H = 3600_000;
const DAY = 86400_000;
const mk = (event, ms, extra = {}) => ({ event, time: new Date(ms).toISOString(), ...extra });

// 6 'B' events on days 0-1 (3 per day), 2 'T' events on day 2.
const mkStream = () => [
	mk('B', T0 + 1 * H), mk('B', T0 + 2 * H), mk('B', T0 + 3 * H),
	mk('B', T0 + DAY + 1 * H), mk('B', T0 + DAY + 2 * H), mk('B', T0 + DAY + 3 * H),
	mk('T', T0 + 2 * DAY + 1 * H, { amount: 10 }), mk('T', T0 + 2 * DAY + 2 * H, { amount: 30 }),
];
// Total B = 6 → 'high' on the events axis; distinct B days = 2 → 'low' on
// the distinctDays axis.
const BINS = { low: [0, 5], high: [5, Infinity] };

describe('applyFrequencyByFrequency binBy', () => {
	test('default distinctDays: 2 days → low bin → multiplier 1 no-op', () => {
		const events = mkStream();
		const r = applyFrequencyByFrequency(events, null, {
			cohortEvent: 'B', bins: BINS, targetEvent: 'T', multipliers: { low: 1, high: 3 },
		});
		expect(r.bin).toBe('low');
		expect(r.delta).toBe(0);
		expect(events.length).toBe(8);
	});

	test("binBy 'events': 6 events → high bin → target scaled 3x", () => {
		const events = mkStream();
		const r = applyFrequencyByFrequency(events, null, {
			cohortEvent: 'B', bins: BINS, targetEvent: 'T', multipliers: { low: 1, high: 3 },
			binBy: 'events',
		});
		expect(r.bin).toBe('high');
		// scaleEventCount contract: additionalNeeded = round(2 matches × (3-1)) = 4.
		expect(r.delta).toBe(4);
		expect(events.filter(e => e.event === 'T').length).toBe(6);
	});
});

describe('applyAggregateByBin binBy', () => {
	test('default distinctDays: low bin → delta 1 leaves amounts untouched', () => {
		const events = mkStream();
		const r = applyAggregateByBin(events, null, {
			cohortEvent: 'B', bins: BINS, event: 'T', propertyName: 'amount', deltas: { low: 1, high: 2 },
		});
		expect(r.bin).toBe('low');
		expect(r.scaled).toBe(0);
		expect(events.filter(e => e.event === 'T').map(e => e.amount)).toEqual([10, 30]);
	});

	test("binBy 'events': high bin → amounts doubled", () => {
		const events = mkStream();
		const r = applyAggregateByBin(events, null, {
			cohortEvent: 'B', bins: BINS, event: 'T', propertyName: 'amount', deltas: { low: 1, high: 2 },
			binBy: 'events',
		});
		expect(r.bin).toBe('high');
		expect(r.scaled).toBe(2);
		expect(events.filter(e => e.event === 'T').map(e => e.amount)).toEqual([20, 60]);
	});
});

describe('applyFunnelFrequencyBreakdown binBy', () => {
	const mkFunnel = () => [
		mk('Land', T0 + 3 * DAY, { insert_id: 'f1' }),
		mk('Sign Up', T0 + 3 * DAY + 10 * 60_000),
		mk('Activate', T0 + 3 * DAY + 20 * 60_000),
	];

	test('default distinctDays over full history: low bin → keepRate 0 drops final', () => {
		const funnelEvents = mkFunnel();
		const r = applyFunnelFrequencyBreakdown(mkStream(), null, funnelEvents, {
			cohortEvent: 'B', bins: BINS, dropMultipliers: { low: 0, high: 1 }, finalStep: 'Activate',
		});
		// keepRate 0 → dropProb 1 → simpleHashFloat ∈ [0,1) < 1 always drops.
		expect(r.bin).toBe('low');
		expect(r.droppedFinal).toBe(true);
		expect(funnelEvents.map(e => e.event)).toEqual(['Land', 'Sign Up']);
	});

	test("binBy 'events': high bin → keepRate 1 keeps final step", () => {
		const funnelEvents = mkFunnel();
		const r = applyFunnelFrequencyBreakdown(mkStream(), null, funnelEvents, {
			cohortEvent: 'B', bins: BINS, dropMultipliers: { low: 0, high: 1 }, finalStep: 'Activate',
			binBy: 'events',
		});
		expect(r.bin).toBe('high');
		expect(r.droppedFinal).toBe(false);
		expect(funnelEvents.length).toBe(3);
	});
});
