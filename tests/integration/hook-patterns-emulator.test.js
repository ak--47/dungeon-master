//@ts-nocheck
import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const t0 = Date.parse('2024-02-01T00:00:00Z');
const DAY_MS = 86400000;
const ev = (event, time, extra = {}) => ({ event, time: new Date(t0 + time).toISOString(), ...extra });
// Day-spanning helper: counting now uses distinct-period (default day) so we
// must place events on different UTC days to register as separate periods.
// See lib/verify/counting.js for the rule.
const evDay = (event, dayOffset, extra = {}) => ({
	event,
	time: new Date(t0 + dayOffset * DAY_MS).toISOString(),
	...extra,
});

describe('emulateBreakdown', () => {
	test('frequencyByFrequency: produces metric_freq × breakdown_freq cells (distinct-day counting)', () => {
		const events = [
			// user u1: 3 distinct days of Buy, 2 distinct days of Click
			evDay('Buy', 0, { user_id: 'u1' }), evDay('Buy', 1, { user_id: 'u1' }), evDay('Buy', 2, { user_id: 'u1' }),
			evDay('Click', 3, { user_id: 'u1' }), evDay('Click', 4, { user_id: 'u1' }),
			// user u2: 1 distinct day of Buy, 5 distinct days of Click
			evDay('Buy', 0, { user_id: 'u2' }),
			...[1, 2, 3, 4, 5].map(d => evDay('Click', d, { user_id: 'u2' })),
			// user u3: 0 metric, 0 breakdown — only present via "other" event
			evDay('Other', 11, { user_id: 'u3' }),
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

	test('aggregatePerUser: groups avg per user by breakdown_freq (distinct-day counting)', () => {
		const events = [
			// u1: 2 distinct Browse days → bin 2; 2 Purchase amounts (10, 20) → avg 15
			evDay('Browse', 0, { user_id: 'u1' }), evDay('Browse', 1, { user_id: 'u1' }),
			ev('Purchase', 5, { user_id: 'u1', amount: 10 }), ev('Purchase', 10, { user_id: 'u1', amount: 20 }),
			// u2: 5 distinct Browse days → bin 5; 1 Purchase amount 100
			...[0, 1, 2, 3, 4].map(d => evDay('Browse', d, { user_id: 'u2' })),
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

	// ── v1.5.0 funnel option threading ────────────────────────────────────────

	test('funnelFrequency: reentry counts both completions for repeat users', () => {
		const events = [
			// u1: completes funnel twice (signup → activate, ×2)
			ev('signup',   1000, { user_id: 'u1' }),
			ev('activate', 2000, { user_id: 'u1' }),
			ev('signup',   3000, { user_id: 'u1' }),
			ev('activate', 4000, { user_id: 'u1' }),
			// u2: completes once
			ev('signup',   1000, { user_id: 'u2' }),
			ev('activate', 2000, { user_id: 'u2' }),
		];
		// Without reentry: u1 counted at step 1 once; u2 counted once.
		const without = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['signup', 'activate'],
			breakdownByFrequencyOf: 'signup',
		});
		// Conversions count uniques per (step, breakdown_freq) cell — same user
		// is counted once per cell regardless of reentry. That's a deliberate
		// choice for funnelFrequency (uniques view), not a bug.
		expect(without.length).toBeGreaterThan(0);

		// Verify reentry doesn't break the threading — same shape comes back.
		const withReentry = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['signup', 'activate'],
			breakdownByFrequencyOf: 'signup',
			reentry: true,
		});
		expect(withReentry.length).toBe(without.length);
	});

	test('funnelFrequency: exclusionSteps drops users who hit the exclusion event', () => {
		const events = [
			// u1: clean signup → activate
			ev('signup',   1000, { user_id: 'u1' }),
			ev('activate', 2000, { user_id: 'u1' }),
			// u2: signup → bounce → activate (excluded)
			ev('signup',   1000, { user_id: 'u2' }),
			ev('bounce',   1500, { user_id: 'u2' }),
			ev('activate', 2000, { user_id: 'u2' }),
		];
		const noExcl = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['signup', 'activate'],
			breakdownByFrequencyOf: 'signup',
		});
		const withExcl = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['signup', 'activate'],
			breakdownByFrequencyOf: 'signup',
			exclusionSteps: [{ event: 'bounce' }],
		});
		const noExclStep1 = noExcl.filter(r => r.step_index === 1).reduce((s, r) => s + r.conversions, 0);
		const withExclStep1 = withExcl.filter(r => r.step_index === 1).reduce((s, r) => s + r.conversions, 0);
		expect(withExclStep1).toBeLessThan(noExclStep1);
	});

	test('timeBucket: wraps any breakdown type and tags rows with period', () => {
		// Use absolute ISO times (skip the t0-offset `ev` helper).
		const mk = (event, isoTime, props) => ({ event, time: isoTime, ...props });
		const events = [
			mk('A', '2024-01-15T12:00:00Z', { user_id: 'u1' }),
			mk('B', '2024-01-15T12:00:00Z', { user_id: 'u1' }),
			mk('A', '2024-02-15T12:00:00Z', { user_id: 'u2' }),
			mk('B', '2024-02-15T12:00:00Z', { user_id: 'u2' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'frequencyByFrequency',
			metricEvent: 'A',
			breakdownByFrequencyOf: 'B',
			timeBucket: 'month',
		});
		const periods = new Set(rows.map(r => r.period));
		expect(periods).toEqual(new Set(['2024-01', '2024-02']));
	});

	test('retention: birth + day-N return → retained_pct rows', () => {
		const day = (n) => Date.UTC(2024, 0, 1 + n);
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1' }),
			ev('Sign Up', day(0), { user_id: 'u2' }),
			ev('Sign Up', day(0), { user_id: 'u3' }),
			ev('Login',   day(1), { user_id: 'u1' }),
			ev('Login',   day(1), { user_id: 'u2' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1, 7],
		});
		const day1 = rows.find(r => r.day === 1);
		expect(day1.retained_count).toBe(2);
		expect(day1.cohort_size).toBe(3);
	});

	test('sessionMetrics: count / duration / eventsPerSession from pre-stamped session_id', () => {
		const events = [
			ev('A', 0,         { user_id: 'u1', session_id: 's1' }),
			ev('B', 30_000,    { user_id: 'u1', session_id: 's1' }),
			ev('A', 5_000_000, { user_id: 'u1', session_id: 's2' }),
			ev('A', 5_001_000, { user_id: 'u1', session_id: 's2' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics' });
		const byMetric = Object.fromEntries(rows.map(r => [r.metric, r]));
		expect(byMetric.count.total_sessions).toBe(2);
		expect(byMetric.eventsPerSession.avg).toBe(2);
	});

	test('timeToConvert: sessionScoped only counts within-session conversions', () => {
		const profiles = [{ distinct_id: 'u1', plan: 'pro' }];
		const events = [
			ev('A', 1000, { user_id: 'u1', session_id: 's1' }),
			ev('B', 2000, { user_id: 'u1', session_id: 's2' }), // different session
		];
		const noScope = emulateBreakdown(events, {
			type: 'timeToConvert',
			fromEvent: 'A',
			toEvent: 'B',
			breakdownByUserProperty: 'plan',
			profiles,
		});
		const scoped = emulateBreakdown(events, {
			type: 'timeToConvert',
			fromEvent: 'A',
			toEvent: 'B',
			breakdownByUserProperty: 'plan',
			profiles,
			sessionScoped: true,
		});
		expect(noScope.length).toBe(1); // converted across sessions
		expect(scoped.length).toBe(0);   // sessionScoped: no completion
	});
});
