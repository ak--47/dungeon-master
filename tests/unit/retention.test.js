//@ts-nocheck
/**
 * Unit tests for `emulateBreakdown({ type: 'retention' })`.
 *
 * Reference: backend/arb/reader/queries/retention_query.cpp. Every expected
 * value below is hand-computed from the cited ARB rule — NOT derived from
 * running the implementation:
 *   - bucketing: floor((return_ms − aligned_birth_ms) / unit_ms), :1258-1262
 *   - unit widths: hour/day/week/month(31d FIXED) — libquery/util.h:265-273
 *   - birth gate: `<=` only when birthCanRetain AND the return matches the
 *     birth filter (matches_first, COR-233) — :1120-1139
 *   - compounded: return side := cohort side — :677-685
 *   - unbounded: carryForward read-carry :1854-1868; carryBack reverse-iter
 *     :274-278; consecutiveForward WRITE-gated :1275-1287
 *   - calendarStart alignment of the birth time — :312-332 (applied :1260)
 *   - internal-event ignore list for any-event sides — :2546-2555
 *   - segmentOn 'return' (SEGMENT_EVENT_SECOND) — :1413-1419, :1421-1444
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/index.js';

const day = (n) => Date.UTC(2024, 0, 1 + n); // Jan 1 + n days, UTC

const ev = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

describe('emulateBreakdown — retention', () => {
	test('basic birth retention: 5 users, 3 return on day 1, 2 return on day 7', () => {
		const events = [];
		// 5 users born on day 0, with retention pattern
		for (let i = 1; i <= 5; i++) {
			events.push(ev('Sign Up', day(0), { user_id: `u${i}` }));
		}
		// u1, u2, u3 return on day 1
		events.push(ev('Login', day(1), { user_id: 'u1' }));
		events.push(ev('Login', day(1), { user_id: 'u2' }));
		events.push(ev('Login', day(1), { user_id: 'u3' }));
		// u4, u5 return on day 7
		events.push(ev('Login', day(7), { user_id: 'u4' }));
		events.push(ev('Login', day(7), { user_id: 'u5' }));

		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1, 7],
		});
		const day1 = rows.find(r => r.day === 1);
		const day7 = rows.find(r => r.day === 7);
		expect(day1.retained_count).toBe(3);
		expect(day1.cohort_size).toBe(5);
		expect(day1.retained_pct).toBeCloseTo(0.6);
		expect(day7.retained_count).toBe(2);
		expect(day7.retained_pct).toBeCloseTo(0.4);
	});

	test('users without birth event are excluded from cohort', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1' }),
			ev('Login',   day(1), { user_id: 'u1' }),
			ev('Login',   day(1), { user_id: 'u2' }),  // never signed up
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1],
		});
		expect(rows[0].cohort_size).toBe(1);
	});

	test('carry_forward: retained on day 3 → counted on days 7, 14, 30', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1' }),
			ev('Login',   day(3), { user_id: 'u1' }),  // returns on day 3 only
			ev('Sign Up', day(0), { user_id: 'u2' }),
			ev('Login',   day(7), { user_id: 'u2' }),  // returns on day 7 only
		];
		const noCarry = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [3, 7, 14, 30],
		});
		const carry = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [3, 7, 14, 30],
			carry_forward: true,
		});
		// Without carry: only u1 on day 3, only u2 on day 7, none on day 14/30.
		expect(noCarry.find(r => r.day === 3).retained_count).toBe(1);
		expect(noCarry.find(r => r.day === 7).retained_count).toBe(1);
		expect(noCarry.find(r => r.day === 14).retained_count).toBe(0);
		// With carry: u1 retained on day 3 → also days 7/14/30; u2 on day 7 → also 14/30.
		expect(carry.find(r => r.day === 3).retained_count).toBe(1);
		expect(carry.find(r => r.day === 7).retained_count).toBe(2);
		expect(carry.find(r => r.day === 14).retained_count).toBe(2);
		expect(carry.find(r => r.day === 30).retained_count).toBe(2);
	});

	test('segmentBy: free vs pro users have different retention curves', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1', plan: 'free' }),
			ev('Sign Up', day(0), { user_id: 'u2', plan: 'pro' }),
			ev('Sign Up', day(0), { user_id: 'u3', plan: 'pro' }),
			ev('Login',   day(1), { user_id: 'u2' }),
			ev('Login',   day(1), { user_id: 'u3' }),
			// u1 (free) never returns
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1],
			segmentBy: 'plan',
		});
		const free = rows.find(r => r.segment === 'free' && r.day === 1);
		const pro = rows.find(r => r.segment === 'pro' && r.day === 1);
		expect(free.retained_pct).toBe(0);
		expect(pro.retained_pct).toBe(1);
	});

	test('return event 1h after birth lands in bucket 0 (ms-delta), NOT bucket 1', () => {
		// Mixpanel retention_query.cpp:1227-1231 — bucket = floor((return - birth) / DAY_MS).
		// 1h delta → bucket 0 → not counted in dayBuckets [1].
		const events = [
			ev('Sign Up', day(0),               { user_id: 'u1' }),
			ev('Login',   day(0) + 3_600_000,   { user_id: 'u1' }),  // 1h after birth
		];
		const noDay1 = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1],
		});
		expect(noDay1[0].retained_count).toBe(0);
		// But bucket 0 IS counted when requested.
		const day0 = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [0],
		});
		expect(day0[0].retained_count).toBe(1);
	});

	test('ms-delta bucketing: 23h after birth → bucket 0; 25h → bucket 1', () => {
		// Both returns happen on the UTC day AFTER birth (calendar day+1) but
		// the ms-delta puts them in different buckets.
		const events = [
			ev('Sign Up', Date.UTC(2024, 0, 1, 18, 0, 0), { user_id: 'u23h' }),
			ev('Login',   Date.UTC(2024, 0, 2, 17, 0, 0), { user_id: 'u23h' }),  // 23h delta → bucket 0
			ev('Sign Up', Date.UTC(2024, 0, 1, 18, 0, 0), { user_id: 'u25h' }),
			ev('Login',   Date.UTC(2024, 0, 2, 19, 0, 0), { user_id: 'u25h' }),  // 25h delta → bucket 1
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [0, 1],
		});
		expect(rows.find(r => r.day === 0).retained_count).toBe(1);
		expect(rows.find(r => r.day === 1).retained_count).toBe(1);
	});

	test('birthCanRetain with DISTINCT birth/return events stays strictly < (COR-233)', () => {
		// 1.6.0 expectation change (spec rule 2): retention_query.cpp:1120-1139
		// applies `<=` ONLY when the return event also matches the birth filter.
		// Login does not match 'Sign Up', so a same-ms Login is NOT counted
		// even with birthCanRetain: true.
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1' }),
			ev('Login',   day(0), { user_id: 'u1' }),  // same ms as birth
		];
		const off = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [0],
		});
		const on = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [0],
			birthCanRetain: true,
		});
		expect(off[0].retained_count).toBe(0);   // strict < default
		expect(on[0].retained_count).toBe(0);    // STILL strict — return ≠ birth filter
	});

	// ported from test_qt_retention.py: test_retention basic case.
	// With Mixpanel's ms-delta bucketing (retention_query.cpp:1227-1231):
	//   r9 birth at 2011-12-01 20:58:41
	//     return at 2011-12-01 20:58:43 → 2s delta → bucket 0
	//     return at 2011-12-02 21:54:22 → 1d 0h 55m delta → bucket 1
	//     return at 2011-12-05 20:58:22 → 3d 23h 59m 41s delta → bucket 3 (under 96h)
	//   r2 birth at 2011-12-01 20:58:41
	//     return at 2011-12-03 18:54:22 → 1d 21h 55m delta → bucket 1 (under 48h)
	test('ported fixture (ms-delta bucketing): cohort = 2 users, distribute across buckets', () => {
		const events = [
			ev('$born',           Date.UTC(2011, 11, 1, 20, 58, 41), { user_id: 'r9' }),
			ev('$born',           Date.UTC(2011, 11, 1, 20, 58, 41), { user_id: 'r2' }),
			ev('$born',           Date.UTC(2011, 11, 1, 20, 58, 44), { user_id: 'r2' }),
			ev('retention_event', Date.UTC(2011, 11, 1, 20, 58, 43), { user_id: 'r9' }),
			ev('retention_event', Date.UTC(2011, 11, 1, 20, 58, 43), { user_id: 'r3' }),  // r3 not in cohort
			ev('retention_event', Date.UTC(2011, 11, 2, 21, 54, 22), { user_id: 'r9' }),
			ev('retention_event', Date.UTC(2011, 11, 3, 18, 54, 22), { user_id: 'r2' }),
			ev('retention_event', Date.UTC(2011, 11, 5, 20, 58, 22), { user_id: 'r9' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: '$born',
			returnEvent: 'retention_event',
			dayBuckets: [0, 1, 2, 3],
		});
		expect(rows[0].cohort_size).toBe(2);
		expect(rows.find(r => r.day === 0).retained_count).toBe(1); // r9 only (2s delta)
		expect(rows.find(r => r.day === 1).retained_count).toBe(2); // r9 + r2 (24h-48h)
		expect(rows.find(r => r.day === 2).retained_count).toBe(0);
		expect(rows.find(r => r.day === 3).retained_count).toBe(1); // r9 (~96h)
	});

	test('throws on missing required config', () => {
		expect(() => emulateBreakdown([], { type: 'retention' })).toThrow(/cohortEvent/);
		expect(() => emulateBreakdown([], { type: 'retention', cohortEvent: 'X' })).toThrow(/returnEvent/);
		expect(() => emulateBreakdown([], { type: 'retention', cohortEvent: 'X', returnEvent: 'Y', dayBuckets: [] })).toThrow(/dayBuckets/);
	});
});

// ── P1.5 rule 1: compounded (retention_query.cpp:677-685) ────────────────────

describe('retention — compounded', () => {
	test('"DAU coming back": every cohort event is a return candidate', () => {
		// u1 visits days 0, 1, 3; u2 visits day 0 only; u3 visits days 0, 3.
		const events = [
			ev('visit', day(0), { user_id: 'u1' }),
			ev('visit', day(1), { user_id: 'u1' }),
			ev('visit', day(3), { user_id: 'u1' }),
			ev('visit', day(0), { user_id: 'u2' }),
			ev('visit', day(0), { user_id: 'u3' }),
			ev('visit', day(3), { user_id: 'u3' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'visit',
			compounded: true,
			birthCanRetain: true,
			dayBuckets: [0, 1, 3],
		});
		// hand-computed: cohort = 3. Compounded + birthCanRetain → every birth
		// matches the return side (matches_first) and <= passes at the birth
		// itself → bucket 0 = all 3. Day 1: u1. Day 3: u1 + u3.
		expect(rows[0].cohort_size).toBe(3);
		expect(rows.find(r => r.day === 0).retained_count).toBe(3);
		expect(rows.find(r => r.day === 1).retained_count).toBe(1);
		expect(rows.find(r => r.day === 3).retained_count).toBe(2);
	});

	test('compounded without birthCanRetain: the birth itself does NOT fill bucket 0', () => {
		const events = [
			ev('visit', day(0), { user_id: 'u1' }),
			ev('visit', day(0) + 3_600_000, { user_id: 'u1' }),  // 1h later → bucket 0
			ev('visit', day(0), { user_id: 'u2' }),              // lone birth
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'visit',
			compounded: true,
			dayBuckets: [0],
		});
		// hand-computed: strict < — u1's second visit qualifies; u2's lone birth doesn't.
		expect(rows[0].retained_count).toBe(1);
		expect(rows[0].cohort_size).toBe(2);
	});

	test('compounded + a DIFFERENT returnEvent throws; same returnEvent tolerated', () => {
		expect(() => emulateBreakdown([], {
			type: 'retention', cohortEvent: 'visit', returnEvent: 'other', compounded: true,
		})).toThrow(/compounded/);
		expect(() => emulateBreakdown([], {
			type: 'retention', cohortEvent: 'visit', returnEvent: 'visit', compounded: true,
		})).not.toThrow();
	});
});

// ── P1.5 rule 2: birthCanRetain matches_first nuance (COR-233, :1120-1139) ───

describe('retention — birthCanRetain COR-233 nuance', () => {
	test('`<=` applies when the return event ALSO matches the birth filter', () => {
		// Same event on both sides, non-compounded: the lone birth is its own
		// return candidate.
		const events = [ev('visit', day(0), { user_id: 'u1' })];
		const base = { type: 'retention', cohortEvent: 'visit', returnEvent: 'visit', dayBuckets: [0] };
		const on = emulateBreakdown(events, { ...base, birthCanRetain: true });
		// hand-computed: matches_first true → birthMs <= evMs → bucket 0.
		expect(on[0].retained_count).toBe(1);
		const off = emulateBreakdown(events, { ...base });
		expect(off[0].retained_count).toBe(0);
	});

	test('same event name but return FAILS the birth WHERE filter → stays strictly <', () => {
		// Birth side = visit(plan: pro); return side = visit(plan: free).
		// The same-ms free visit matches the return side but NOT the birth
		// side → matches_first false → strict < → rejected despite
		// birthCanRetain: true.
		const events = [
			ev('visit', day(0), { user_id: 'u1', plan: 'pro' }),
			ev('visit', day(0), { user_id: 'u1', plan: 'free' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'visit', cohortWhere: { plan: 'pro' },
			returnEvent: 'visit', returnWhere: { plan: 'free' },
			birthCanRetain: true,
			dayBuckets: [0],
		});
		expect(rows[0].retained_count).toBe(0);
		expect(rows[0].cohort_size).toBe(1);
	});
});

// ── P1.5 rule 3: unbounded modes ─────────────────────────────────────────────

describe('retention — unbounded modes', () => {
	// Fixture: u1 returns on days 1, 2, 5 (gap at 3-4); u2 returns on day 4 only.
	const fixture = [
		ev('Sign Up', day(0), { user_id: 'u1' }),
		ev('Login',   day(1), { user_id: 'u1' }),
		ev('Login',   day(2), { user_id: 'u1' }),
		ev('Login',   day(5), { user_id: 'u1' }),
		ev('Sign Up', day(0), { user_id: 'u2' }),
		ev('Login',   day(4), { user_id: 'u2' }),
	];
	const base = { type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login', dayBuckets: [0, 1, 2, 3, 4, 5] };
	const countAt = (rows, d) => rows.find(r => r.day === d).retained_count;

	test('none: exact bucket membership', () => {
		const rows = emulateBreakdown(fixture, { ...base, unbounded: 'none' });
		// hand-computed marks: u1 {1,2,5}, u2 {4}
		expect([0, 1, 2, 3, 4, 5].map(d => countAt(rows, d))).toEqual([0, 1, 1, 0, 1, 1]);
	});

	test('carryForward: active in ANY bucket ≤ N (:1854-1868)', () => {
		const rows = emulateBreakdown(fixture, { ...base, unbounded: 'carryForward' });
		// hand-computed: d0: none; d1-d3: u1 (mark 1 ≤ N); d4-d5: u1 + u2
		expect([0, 1, 2, 3, 4, 5].map(d => countAt(rows, d))).toEqual([0, 1, 1, 1, 2, 2]);
	});

	test('carryBack: active in ANY bucket ≥ N (:274-278)', () => {
		const rows = emulateBreakdown(fixture, { ...base, unbounded: 'carryBack' });
		// hand-computed: d0-d4: u1 (mark 5 ≥ N) + u2 while 4 ≥ N; d5: u1 only
		expect([0, 1, 2, 3, 4, 5].map(d => countAt(rows, d))).toEqual([2, 2, 2, 2, 2, 1]);
	});

	test('consecutiveForward: bucket N marks only if N−1 already marked (:1275-1287)', () => {
		const rows = emulateBreakdown(fixture, { ...base, unbounded: 'consecutiveForward' });
		// hand-computed: u1's first hit is bucket 1 — blocked (0 unmarked), so
		// 2 and 5 also blocked. u2's bucket 4 blocked. All zero.
		expect([0, 1, 2, 3, 4, 5].map(d => countAt(rows, d))).toEqual([0, 0, 0, 0, 0, 0]);
	});

	test('consecutiveForward: a run from bucket 0 marks the maximal consecutive prefix', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u3' }),
			ev('Login',   day(0) + 3_600_000, { user_id: 'u3' }),  // bucket 0
			ev('Login',   day(1), { user_id: 'u3' }),              // bucket 1
			ev('Login',   day(2), { user_id: 'u3' }),              // bucket 2
			ev('Login',   day(4), { user_id: 'u3' }),              // bucket 4 — gap at 3
		];
		const rows = emulateBreakdown(events, { ...base, unbounded: 'consecutiveForward' });
		// hand-computed: chain {0, 1, 2}; 4 blocked by the gap at 3.
		expect([0, 1, 2, 3, 4, 5].map(d => countAt(rows, d))).toEqual([1, 1, 1, 0, 0, 0]);
	});

	test('carry_forward boolean stays as a deprecated alias for carryForward', () => {
		const viaAlias = emulateBreakdown(fixture, { ...base, carry_forward: true });
		const viaMode = emulateBreakdown(fixture, { ...base, unbounded: 'carryForward' });
		expect(viaAlias).toEqual(viaMode);
	});

	test('unknown unbounded mode throws', () => {
		expect(() => emulateBreakdown([], { ...base, unbounded: 'carryUp' })).toThrow(/unbounded/);
	});
});

// ── P1.5 rule 4: internal-event ignore list (:2546-2555) ─────────────────────

describe('retention — internal-event ignore list', () => {
	test('any-event cohort side skips $identify when picking the birth', () => {
		const events = [
			{ event: '$identify', time: day(0), user_id: 'u1' },
			{ event: 'visit', time: day(1), user_id: 'u1' },
			{ event: 'visit', time: day(2), user_id: 'u1' },
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: null, returnEvent: 'visit', dayBuckets: [0, 1],
		});
		// hand-computed: birth = visit@day1 (NOT $identify@day0) → the day-2
		// visit is bucket 1. If $identify were the birth, day-1 visit would
		// fill bucket 1 AND day-2 would land in bucket 2.
		expect(rows.find(r => r.day === 0).retained_count).toBe(0);
		expect(rows.find(r => r.day === 1).retained_count).toBe(1);
	});

	test('any-event return side ignores internal events', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1' }),
			{ event: '$merge', time: day(1), user_id: 'u1' },
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: '$any_event', dayBuckets: [1],
		});
		// hand-computed: the only day-1 candidate is $merge — ignored → 0.
		expect(rows[0].retained_count).toBe(0);
		expect(rows[0].cohort_size).toBe(1);
	});

	test('explicit selector bypasses the ignore list', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1' }),
			{ event: '$identify', time: day(1), user_id: 'u1' },
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: '$identify', dayBuckets: [1],
		});
		expect(rows[0].retained_count).toBe(1);
	});
});

// ── P1.5 rule 5: bucketAlignment calendarStart (:312-332, applied :1260) ─────

describe('retention — bucketAlignment calendarStart', () => {
	test('day unit: birth 18:00, return next morning → bucket 0 anchored, bucket 1 aligned', () => {
		const events = [
			ev('Sign Up', Date.UTC(2024, 0, 1, 18, 0, 0), { user_id: 'u1' }),
			ev('Login',   Date.UTC(2024, 0, 2, 9, 0, 0),  { user_id: 'u1' }),  // 15h later
		];
		const base = { type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login', dayBuckets: [0, 1] };
		const anchored = emulateBreakdown(events, base);
		// hand-computed: 15h delta → bucket 0
		expect(anchored.find(r => r.day === 0).retained_count).toBe(1);
		const aligned = emulateBreakdown(events, { ...base, bucketAlignment: 'calendarStart' });
		// hand-computed: aligned birth = Jan 1 00:00 UTC; delta 33h → bucket 1
		expect(aligned.find(r => r.day === 0).retained_count).toBe(0);
		expect(aligned.find(r => r.day === 1).retained_count).toBe(1);
	});

	test('week unit floors the birth to ISO Monday', () => {
		// Wed Jan 3 2024 birth; return Tue Jan 9 (6d later).
		const events = [
			ev('Sign Up', Date.UTC(2024, 0, 3), { user_id: 'u1' }),
			ev('Login',   Date.UTC(2024, 0, 9), { user_id: 'u1' }),
		];
		const base = { type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login', bucketUnit: 'week', dayBuckets: [0, 1] };
		const anchored = emulateBreakdown(events, base);
		// hand-computed: 6d < 7d → bucket 0
		expect(anchored.find(r => r.day === 0).retained_count).toBe(1);
		const aligned = emulateBreakdown(events, { ...base, bucketAlignment: 'calendarStart' });
		// hand-computed: ISO Monday = Jan 1; Jan 9 delta = 8d → bucket 1
		expect(aligned.find(r => r.day === 1).retained_count).toBe(1);
		expect(aligned.find(r => r.day === 0).retained_count).toBe(0);
	});

	test('the birth gate still uses the RAW birth time, not the aligned one', () => {
		// Return BEFORE the birth on the same calendar day: alignment moves the
		// bucket origin to midnight but the gate stays raw birthMs < evMs.
		const events = [
			ev('Sign Up', Date.UTC(2024, 0, 1, 18, 0, 0), { user_id: 'u1' }),
			ev('Login',   Date.UTC(2024, 0, 1, 9, 0, 0),  { user_id: 'u1' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login',
			bucketAlignment: 'calendarStart', dayBuckets: [0],
		});
		expect(rows[0].retained_count).toBe(0);
	});

	test('unknown bucketAlignment throws', () => {
		expect(() => emulateBreakdown([], {
			type: 'retention', cohortEvent: 'X', returnEvent: 'Y', bucketAlignment: 'weird',
		})).toThrow(/bucketAlignment/);
	});
});

// ── P1.5: bucketUnit widths (libquery/util.h:265-273, unit.c:5-16) ───────────

describe('retention — bucketUnit widths', () => {
	test('hour: 90-minute delta → bucket 1', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1' }),
			ev('Login',   day(0) + 90 * 60_000, { user_id: 'u1' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login',
			bucketUnit: 'hour', dayBuckets: [0, 1],
		});
		// hand-computed: 5400s / 3600s → bucket 1
		expect(rows.find(r => r.day === 1).retained_count).toBe(1);
		expect(rows.find(r => r.day === 0).retained_count).toBe(0);
	});

	test('month is 31 FIXED days, not calendar months', () => {
		// Birth Feb 1 2024 (leap year, Feb = 29d); return Mar 2 = +30d.
		// Calendar-month intuition says bucket 1; ARB's fixed 31d width says bucket 0.
		const events = [
			ev('Sign Up', Date.UTC(2024, 1, 1), { user_id: 'u1' }),
			ev('Login',   Date.UTC(2024, 2, 2), { user_id: 'u1' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login',
			bucketUnit: 'month', dayBuckets: [0, 1],
		});
		expect(rows.find(r => r.day === 0).retained_count).toBe(1);
		expect(rows.find(r => r.day === 1).retained_count).toBe(0);
	});

	test('unknown bucketUnit throws', () => {
		expect(() => emulateBreakdown([], {
			type: 'retention', cohortEvent: 'X', returnEvent: 'Y', bucketUnit: 'fortnight',
		})).toThrow(/bucketUnit/);
	});
});

// ── P1.5 rule 6: segmentOn 'return' (SEGMENT_EVENT_SECOND, :1421-1444) ───────

describe('retention — segmentOn return', () => {
	test('segment is read from each RETURN event; a user can appear in multiple segments', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1' }),
			ev('Login',   day(1), { user_id: 'u1', platform: 'ios' }),
			ev('Login',   day(2), { user_id: 'u1', platform: 'web' }),
			ev('Sign Up', day(0), { user_id: 'u2' }),
			ev('Login',   day(1), { user_id: 'u2', platform: 'web' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login',
			segmentBy: 'platform', segmentOn: 'return', dayBuckets: [1, 2],
		});
		// hand-computed: ios cohort {u1} — d1: 1, d2: 0.
		//                web cohort {u1, u2} — d1: u2, d2: u1.
		const ios1 = rows.find(r => r.segment === 'ios' && r.day === 1);
		expect(ios1.retained_count).toBe(1);
		expect(ios1.cohort_size).toBe(1);
		const web1 = rows.find(r => r.segment === 'web' && r.day === 1);
		expect(web1.retained_count).toBe(1);
		expect(web1.cohort_size).toBe(2);
		expect(rows.find(r => r.segment === 'web' && r.day === 2).retained_count).toBe(1);
	});

	test('births are unsegmented: a user with no qualifying return joins NO cohort (:1413-1419)', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1', platform: 'ios' }),  // never returns
			ev('Sign Up', day(0), { user_id: 'u2' }),
			ev('Login',   day(1), { user_id: 'u2', platform: 'ios' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login',
			segmentBy: 'platform', segmentOn: 'return', dayBuckets: [1],
		});
		// hand-computed: ios cohort = {u2} only — u1's birth property does not
		// segment it, and no 'unknown' segment appears for u1.
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ segment: 'ios', day: 1, retained_count: 1, cohort_size: 1 });
	});

	test('birthCanRetain lets a birth matching the return side segment itself', () => {
		const events = [
			ev('visit', day(0), { user_id: 'u1', platform: 'ios' }),  // lone visit
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'visit', compounded: true,
			birthCanRetain: true, segmentBy: 'platform', segmentOn: 'return',
			dayBuckets: [0],
		});
		// hand-computed: the birth IS the qualifying return (matches_first + <=)
		// → ios cohort {u1}, retained at bucket 0.
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ segment: 'ios', day: 0, retained_count: 1, cohort_size: 1 });
	});

	test('unknown segmentOn throws', () => {
		expect(() => emulateBreakdown([], {
			type: 'retention', cohortEvent: 'X', returnEvent: 'Y', segmentOn: 'both',
		})).toThrow(/segmentOn/);
	});
});

// ── P1.5 rule 7: unrecognized option keys throw (1.6.0 behavior change) ──────

describe('retention — strict option keys', () => {
	test('typo/unknown key throws instead of being silently ignored', () => {
		expect(() => emulateBreakdown([], {
			type: 'retention', cohortEvent: 'X', returnEvent: 'Y', compunded: true,
		})).toThrow(/unrecognized option "compunded"/);
	});

	test('all documented keys are accepted', () => {
		expect(() => emulateBreakdown([], {
			type: 'retention', cohortEvent: 'X', returnEvent: 'Y',
			cohortWhere: { plan: 'pro' }, returnWhere: { plan: 'pro' },
			dayBuckets: [1], bucketUnit: 'day', unbounded: 'none',
			bucketAlignment: 'birth', cohortWindow: { from: day(0), to: day(1) },
			segmentBy: 'plan', segmentOn: 'birth', birthCanRetain: false,
			profiles: [],
		})).not.toThrow();
	});
});

// ── P1.5: cohortWindow (findings #13) ────────────────────────────────────────

describe('retention — cohortWindow', () => {
	test('birth outside [from, to] excludes the user from the cohort', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'uEarly' }),
			ev('Login',   day(1), { user_id: 'uEarly' }),
			ev('Sign Up', day(5), { user_id: 'uIn' }),
			ev('Login',   day(6), { user_id: 'uIn' }),
			ev('Sign Up', day(9), { user_id: 'uLate' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login',
			cohortWindow: { from: day(4), to: day(8) }, dayBuckets: [1],
		});
		// hand-computed: only uIn's birth (day 5) lands in [day 4, day 8].
		expect(rows[0].cohort_size).toBe(1);
		expect(rows[0].retained_count).toBe(1);
	});

	test('window bounds are inclusive', () => {
		const events = [
			ev('Sign Up', day(4), { user_id: 'uFrom' }),
			ev('Sign Up', day(8), { user_id: 'uTo' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', returnEvent: 'Login',
			cohortWindow: { from: day(4), to: day(8) }, dayBuckets: [1],
		});
		expect(rows[0].cohort_size).toBe(2);
	});

	test('invalid cohortWindow throws', () => {
		expect(() => emulateBreakdown([], {
			type: 'retention', cohortEvent: 'X', returnEvent: 'Y',
			cohortWindow: { from: 'not-a-date' },
		})).toThrow(/cohortWindow/);
	});
});

// ── P1.5: cohortWhere / returnWhere filter stacks (:205-206, :2552-2555) ─────

describe('retention — per-side where filters', () => {
	test('cohortWhere picks the first MATCHING event as birth, not the first event', () => {
		const events = [
			ev('Sign Up', day(0), { user_id: 'u1', plan: 'free' }),
			ev('Sign Up', day(2), { user_id: 'u1', plan: 'pro' }),  // ← birth
			ev('Login',   day(3), { user_id: 'u1' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up', cohortWhere: { plan: 'pro' },
			returnEvent: 'Login', dayBuckets: [1, 3],
		});
		// hand-computed: birth = day 2 (pro) → Login@day3 is bucket 1, not 3.
		expect(rows.find(r => r.day === 1).retained_count).toBe(1);
		expect(rows.find(r => r.day === 3).retained_count).toBe(0);
	});

	test('returnWhere filters return candidates', () => {
		const events = [
			ev('Sign Up',  day(0), { user_id: 'u1' }),
			ev('Purchase', day(1), { user_id: 'u1', amount: 0 }),
			ev('Purchase', day(2), { user_id: 'u1', amount: 50 }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention', cohortEvent: 'Sign Up',
			returnEvent: 'Purchase', returnWhere: { amount: { op: 'gt', value: 0 } },
			dayBuckets: [1, 2],
		});
		// hand-computed: only the day-2 purchase (amount 50) qualifies.
		expect(rows.find(r => r.day === 1).retained_count).toBe(0);
		expect(rows.find(r => r.day === 2).retained_count).toBe(1);
	});
});
