//@ts-nocheck
/**
 * P1.6.5 unit tests: step-0-anchored trends under timeBucket.
 *
 * Mixpanel's trend-interval rule (funnel_query.cpp:1398-1401; history.cpp
 * :437-440 for retention): "Step 0 in [start, stop); steps 1+ in
 * [start, stop + conversion window)". Plain event partitioning truncates any
 * window spanning a bucket edge — these tests pin the anchored behavior:
 * conversions/returns spilling past the bucket edge credit the bucket that
 * ANCHORED them, and spill events can never anchor a new attempt in an
 * earlier bucket.
 *
 * Every expected value is hand-computed from the rule, not from running the
 * implementation.
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';
import { bucketBoundsMs } from '../../lib/verify/counting.js';

const ev = (uid, event, time, props = {}) => ({ event, time, user_id: uid, ...props });
const rowsFor = (rows, period) => rows.filter(r => r.period === period);

describe('bucketBoundsMs', () => {
	test('day label round-trips to [midnight, midnight+24h)', () => {
		const { startMs, endMs } = bucketBoundsMs('2024-02-29', 'day'); // leap day
		expect(startMs).toBe(Date.UTC(2024, 1, 29));
		expect(endMs).toBe(Date.UTC(2024, 2, 1));
	});

	test('ISO week label resolves to its Monday', () => {
		// 2024-01-01 is a Monday → W01 starts Jan 1; W03 = Jan 15 (hand-computed).
		const { startMs, endMs } = bucketBoundsMs('2024-W03', 'week');
		expect(startMs).toBe(Date.UTC(2024, 0, 15));
		expect(endMs).toBe(Date.UTC(2024, 0, 22));
	});

	test('month label spans calendar month', () => {
		const { startMs, endMs } = bucketBoundsMs('2024-02', 'month');
		expect(startMs).toBe(Date.UTC(2024, 1, 1));
		expect(endMs).toBe(Date.UTC(2024, 2, 1));
	});
});

describe('funnelFrequency under timeBucket (step-0 anchored)', () => {
	const CFG = {
		type: 'funnelFrequency',
		steps: ['A', 'B'],
		breakdownByFrequencyOf: 'C',
		conversionWindowMs: 60 * 60_000, // 1h
		timeBucket: 'day',
	};

	test('conversion spilling past midnight credits the anchor bucket', () => {
		const events = [
			ev('u1', 'C', '2024-01-15T12:00:00.000Z'),
			ev('u1', 'A', '2024-01-15T23:50:00.000Z'), // anchors Jan 15
			ev('u1', 'B', '2024-01-16T00:10:00.000Z'), // converts 20min later — Jan 16
		];
		const rows = emulateBreakdown(events, CFG);
		// hand-computed: Jan 15 slice = [Jan15, Jan16+1h) ⊇ {C, A, B}; axis
		// counts in-bucket only → C-freq 1; A anchors in [Jan15, Jan16),
		// B within the 1h window → reached 1.
		const jan15 = rowsFor(rows, '2024-01-15');
		expect(jan15.find(r => r.step_index === 0 && r.breakdown_freq === 1).conversions).toBe(1);
		expect(jan15.find(r => r.step_index === 1 && r.breakdown_freq === 1).conversions).toBe(1);
		// Jan 16 bucket: B alone can't anchor step 0 → empty marker.
		const jan16 = rowsFor(rows, '2024-01-16');
		expect(jan16).toEqual([{ period: '2024-01-16', _empty: true }]);
	});

	test('spill events cannot anchor a new attempt in the earlier bucket', () => {
		const events = [
			// u1 fully inside Jan 15
			ev('u1', 'A', '2024-01-15T10:00:00.000Z'),
			ev('u1', 'B', '2024-01-15T10:05:00.000Z'),
			ev('u1', 'C', '2024-01-15T11:00:00.000Z'),
			// u2 fully inside Jan 16, but A/B land in Jan 15's 1h spill region
			ev('u2', 'A', '2024-01-16T00:30:00.000Z'),
			ev('u2', 'B', '2024-01-16T00:45:00.000Z'),
			ev('u2', 'C', '2024-01-16T10:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, CFG);
		// hand-computed Jan 15: only u1 anchors (u2's A@00:30 ≥ Jan 16 → no
		// anchor; u2's in-bucket axis count is 0). step0 = 1, NOT 2; and no
		// breakdown_freq 0 rows may exist (that would mean u2 leaked in).
		const jan15 = rowsFor(rows, '2024-01-15');
		expect(jan15.find(r => r.step_index === 0 && r.breakdown_freq === 1).conversions).toBe(1);
		expect(jan15.some(r => r.breakdown_freq === 0)).toBe(false);
		// hand-computed Jan 16: u2 anchors in its own bucket → freq 1, reached 1.
		const jan16 = rowsFor(rows, '2024-01-16');
		expect(jan16.find(r => r.step_index === 0 && r.breakdown_freq === 1).conversions).toBe(1);
		expect(jan16.find(r => r.step_index === 1 && r.breakdown_freq === 1).conversions).toBe(1);
	});

	test('middle-fixed order keeps plain partitioning (set-membership has no anchor concept)', () => {
		// P1.6.6: 'middle-fixed' is the ONLY order left on plain partitioning —
		// its scrambled slots (the two ends) are non-contiguous, so it cannot
		// map to engine anyOrder blocks.
		const events = [
			ev('u1', 'C', '2024-01-15T12:00:00.000Z'),
			ev('u1', 'A', '2024-01-15T23:50:00.000Z'),
			ev('u1', 'B', '2024-01-16T00:10:00.000Z'),
		];
		const rows = emulateBreakdown(events, { ...CFG, funnelOrder: 'middle-fixed' });
		// hand-computed: plain partition — Jan 15 sees {C, A} only → set
		// membership [A,B] incomplete → reached -1 → no funnel rows for Jan 15.
		const jan15 = rowsFor(rows, '2024-01-15');
		expect(jan15.some(r => r.step_index >= 0 && r.conversions > 0)).toBe(false);
	});

	test('last-fixed order anchors through the engine anyOrder block (P1.6.6)', () => {
		const events = [
			ev('u1', 'C', '2024-01-15T12:00:00.000Z'),
			ev('u1', 'B', '2024-01-15T23:40:00.000Z'), // chunk member fills position 0
			ev('u1', 'A', '2024-01-15T23:50:00.000Z'), // second member, 10min later
			ev('u1', 'L', '2024-01-16T00:10:00.000Z'), // fixed last anchor — 30min spill
		];
		const rows = emulateBreakdown(events, {
			...CFG,
			steps: ['A', 'B', 'L'],
			funnelOrder: 'last-fixed',
		});
		// hand-computed: last-fixed maps to [{ anyOrder: [A, B] }, L]. Jan 15
		// slice = [Jan15, Jan16+1h) ⊇ all four events; B@23:40 anchors position
		// 0 inside [Jan15, Jan16), A joins the chunk, L crosses the anchor at
		// 30min — all within the 1h window → full conversion credited to
		// Jan 15. Pre-P1.6.6 this order used set-membership over the PLAIN
		// partition: Jan 15 saw {C, B, A} only → incomplete → no rows.
		const jan15 = rowsFor(rows, '2024-01-15');
		expect(jan15.find(r => r.step_index === 0 && r.breakdown_freq === 1).conversions).toBe(1);
		expect(jan15.find(r => r.step_index === 2 && r.breakdown_freq === 1).conversions).toBe(1);
		// Jan 16: L alone cannot fill position 0 → empty marker.
		expect(rowsFor(rows, '2024-01-16')).toEqual([{ period: '2024-01-16', _empty: true }]);
	});
});

describe('timeToConvert under timeBucket (step-0 anchored)', () => {
	test('pair spanning midnight converts in the anchor bucket', () => {
		const events = [
			ev('u1', 'A', '2024-01-15T23:00:00.000Z'),
			ev('u1', 'B', '2024-01-16T00:30:00.000Z'), // 90 min later
		];
		const rows = emulateBreakdown(events, {
			type: 'timeToConvert',
			fromEvent: 'A',
			toEvent: 'B',
			conversionWindowMs: 2 * 60 * 60_000, // 2h
			timeBucket: 'day',
		});
		// hand-computed: Jan 15 anchors A, B converts in the 2h spill →
		// ttc = 90 min = 5,400,000 ms. Pre-P1.6.5 partitioning split the pair
		// across buckets and reported NO conversion at all.
		const jan15 = rowsFor(rows, '2024-01-15');
		expect(jan15.length).toBe(1);
		expect(jan15[0].user_count).toBe(1);
		expect(jan15[0].avg_ttc_ms).toBe(90 * 60_000);
		// Jan 16: B alone can't anchor → empty.
		expect(rowsFor(rows, '2024-01-16')).toEqual([{ period: '2024-01-16', _empty: true }]);
	});
});

describe('retention under timeBucket (birth anchored)', () => {
	test('day-1 return past the bucket edge still retains', () => {
		const events = [
			ev('u1', 'Sign Up', '2024-01-15T10:00:00.000Z'),
			ev('u1', 'Login', '2024-01-16T12:00:00.000Z'), // 26h later → day 1 (birth-anchored AND calendar)
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1],
			timeBucket: 'day',
		});
		// hand-computed: Jan 15 bucket → cohortWindow [Jan15, Jan16) — birth in
		// window; return floor((26h)/24h) = bucket 1 → retained. Pre-P1.6.5 the
		// Jan 16 return was partitioned OUT of the Jan 15 bucket → retained 0.
		const jan15 = rowsFor(rows, '2024-01-15');
		expect(jan15.length).toBe(1);
		expect(jan15[0].cohort_size).toBe(1);
		expect(jan15[0].retained_count).toBe(1);
		// Jan 16 bucket: Login doesn't match the Sign Up birth filter → no
		// cohort → empty marker.
		expect(rowsFor(rows, '2024-01-16')).toEqual([{ period: '2024-01-16', _empty: true }]);
	});

	test('user-supplied cohortWindow intersects with the bucket bounds', () => {
		const events = [
			ev('u1', 'Sign Up', '2024-01-15T10:00:00.000Z'),
			ev('u1', 'Login', '2024-01-16T12:00:00.000Z'),
			ev('u3', 'Sign Up', '2024-01-16T09:00:00.000Z'), // outside user window
			ev('u3', 'Login', '2024-01-17T11:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1],
			timeBucket: 'day',
			cohortWindow: { from: '2024-01-15T00:00:00.000Z', to: '2024-01-15T23:59:59.999Z' },
		});
		// hand-computed: Jan 15 bucket ∩ window = Jan 15 → u1 births, retains
		// day 1. Jan 16 bucket ∩ window = ∅ (from > to) → u3 never cohorts.
		const jan15 = rowsFor(rows, '2024-01-15');
		expect(jan15[0].cohort_size).toBe(1);
		expect(jan15[0].retained_count).toBe(1);
		expect(rowsFor(rows, '2024-01-16')).toEqual([{ period: '2024-01-16', _empty: true }]);
		// u3's own bucket (Jan 17 has only a Login — no birth) → empty too.
		expect(rowsFor(rows, '2024-01-17')).toEqual([{ period: '2024-01-17', _empty: true }]);
	});
});

describe('evaluateFunnel anchorRange (engine primitive)', () => {
	test('event outside [fromMs, toMs) cannot record step 0 but can complete later steps', async () => {
		const { evaluateFunnel } = await import('../../lib/verify/funnel-engine.js');
		const mk = (event, time) => ({ event, time, user_id: 'u1' });
		const T0 = Date.UTC(2024, 0, 15);
		const events = [
			mk('A', T0 + 23.5 * 3600_000),  // 23:30 — in range, anchors
			mk('B', T0 + 24.5 * 3600_000),  // next day 00:30 — later step OK in spill
			mk('A', T0 + 25 * 3600_000),    // 01:00 next day — must NOT re-anchor
		];
		const r = evaluateFunnel(events, ['A', 'B'], {
			anchorRange: { fromMs: T0, toMs: T0 + 86400_000 },
			reentry: true,
			countMode: 'totals',
		});
		// hand-computed: exactly ONE attempt (anchored at 23:30, completed at
		// 00:30); the 01:00 A is anchor-refused so no second attempt exists.
		expect(r.length).toBe(1);
		expect(r[0].completed).toBe(true);
		expect(r[0].stepTimes).toEqual([T0 + 23.5 * 3600_000, T0 + 24.5 * 3600_000]);
	});
});
