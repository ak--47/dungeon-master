//@ts-nocheck
import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const t0 = Date.parse('2024-02-01T00:00:00Z');
const ev = (event, time, extra = {}) => ({ event, time: new Date(t0 + time).toISOString(), ...extra });

describe('emulateBreakdown', () => {
	test('frequencyByFrequency: produces metric_freq × breakdown_freq cells', () => {
		const events = [
			// user u1: 3 metric, 2 breakdown
			ev('Buy', 0, { user_id: 'u1' }), ev('Buy', 1, { user_id: 'u1' }), ev('Buy', 2, { user_id: 'u1' }),
			ev('Click', 3, { user_id: 'u1' }), ev('Click', 4, { user_id: 'u1' }),
			// user u2: 1 metric, 5 breakdown
			ev('Buy', 5, { user_id: 'u2' }),
			...[6, 7, 8, 9, 10].map(t => ev('Click', t, { user_id: 'u2' })),
			// user u3: 0 metric, 0 breakdown — only present via "other" event
			ev('Other', 11, { user_id: 'u3' }),
		];
		const tbl = emulateBreakdown(events, {
			type: 'frequencyByFrequency',
			metricEvent: 'Buy',
			breakdownByFrequencyOf: 'Click',
		});
		const cell32 = tbl.find(r => r.metric_freq === 3 && r.breakdown_freq === 2);
		const cell15 = tbl.find(r => r.metric_freq === 1 && r.breakdown_freq === 5);
		const cell00 = tbl.find(r => r.metric_freq === 0 && r.breakdown_freq === 0);
		expect(cell32?.user_count).toBe(1);
		expect(cell15?.user_count).toBe(1);
		expect(cell00?.user_count).toBe(1);
	});

	test('funnelFrequency: counts step conversions per breakdown_freq bucket', () => {
		const events = [
			// u1 (1 click) reaches all 3 funnel steps
			ev('Click', 0, { user_id: 'u1' }),
			ev('Sign Up', 100, { user_id: 'u1' }),
			ev('Onboard', 200, { user_id: 'u1' }),
			ev('Activate', 300, { user_id: 'u1' }),
			// u2 (3 clicks) reaches step 2 only
			...[10, 20, 30].map(t => ev('Click', t, { user_id: 'u2' })),
			ev('Sign Up', 100, { user_id: 'u2' }),
			ev('Onboard', 200, { user_id: 'u2' }),
		];
		const tbl = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['Sign Up', 'Onboard', 'Activate'],
			breakdownByFrequencyOf: 'Click',
		});
		// u1 → bucket 1, u2 → bucket 3
		const u1Step3 = tbl.find(r => r.step === 'Activate' && r.breakdown_freq === 1);
		const u2Step3 = tbl.find(r => r.step === 'Activate' && r.breakdown_freq === 3);
		expect(u1Step3?.conversions).toBe(1);
		expect(u2Step3).toBeUndefined();
		// Conversion percent at step 0 must be 100 for any present bucket.
		const step0 = tbl.filter(r => r.step_index === 0);
		for (const r of step0) expect(r.conversion_pct).toBe(100);
	});

	test('aggregatePerUser: groups avg per user by breakdown_freq', () => {
		const events = [
			// u1: 2 Browse → bin 2; 2 Purchase amounts (10, 20) → avg 15
			ev('Browse', 0, { user_id: 'u1' }), ev('Browse', 1, { user_id: 'u1' }),
			ev('Purchase', 5, { user_id: 'u1', amount: 10 }), ev('Purchase', 10, { user_id: 'u1', amount: 20 }),
			// u2: 5 Browse → bin 5; 1 Purchase amount 100
			...[0, 1, 2, 3, 4].map(t => ev('Browse', t, { user_id: 'u2' })),
			ev('Purchase', 5, { user_id: 'u2', amount: 100 }),
		];
		const tbl = emulateBreakdown(events, {
			type: 'aggregatePerUser',
			event: 'Purchase',
			property: 'amount',
			agg: 'avg',
			breakdownByFrequencyOf: 'Browse',
		});
		const b2 = tbl.find(r => r.breakdown_freq === 2);
		const b5 = tbl.find(r => r.breakdown_freq === 5);
		expect(b2?.avg_aggregate).toBe(15);
		expect(b5?.avg_aggregate).toBe(100);
	});

	test('timeToConvert: bucket by user profile property', () => {
		const events = [
			ev('Sign Up', 0, { user_id: 'u1' }), ev('Convert', 60_000, { user_id: 'u1' }), // 60s
			ev('Sign Up', 0, { user_id: 'u2' }), ev('Convert', 600_000, { user_id: 'u2' }), // 600s
		];
		const profiles = [
			{ distinct_id: 'u1', tier: 'enterprise' },
			{ distinct_id: 'u2', tier: 'trial' },
		];
		const tbl = emulateBreakdown(events, {
			type: 'timeToConvert',
			fromEvent: 'Sign Up',
			toEvent: 'Convert',
			breakdownByUserProperty: 'tier',
			profiles,
		});
		const ent = tbl.find(r => r.segment_value === 'enterprise');
		const tr = tbl.find(r => r.segment_value === 'trial');
		expect(ent?.avg_ttc_ms).toBe(60_000);
		expect(tr?.avg_ttc_ms).toBe(600_000);
	});

	test('attributedBy: firstTouch + lastTouch attribution count rows', () => {
		const events = [
			// u1: google then facebook then conversion
			ev('Touch', 0, { user_id: 'u1', source: 'google' }),
			ev('Touch', 100, { user_id: 'u1', source: 'facebook' }),
			ev('Convert', 200, { user_id: 'u1' }),
			// u2: facebook only
			ev('Touch', 0, { user_id: 'u2', source: 'facebook' }),
			ev('Convert', 100, { user_id: 'u2' }),
		];
		const first = emulateBreakdown(events, {
			type: 'attributedBy',
			conversionEvent: 'Convert',
			attributionEvent: 'Touch',
			attributionProperty: 'source',
			model: 'firstTouch',
		});
		const last = emulateBreakdown(events, {
			type: 'attributedBy',
			conversionEvent: 'Convert',
			attributionEvent: 'Touch',
			attributionProperty: 'source',
			model: 'lastTouch',
		});
		expect(first.find(r => r.attribution_value === 'google')?.conversions).toBe(1);
		expect(first.find(r => r.attribution_value === 'facebook')?.conversions).toBe(1);
		expect(last.find(r => r.attribution_value === 'facebook')?.conversions).toBe(2);
		expect(last.find(r => r.attribution_value === 'google')).toBeUndefined();
	});
});
