//@ts-nocheck
/**
 * Unit tests for `emulateBreakdown({ type: 'retention' })`.
 *
 * Reference: backend/arb/reader/queries/retention_query.cpp — birth retention
 * with day buckets, optional `carry_forward` (CARRY_FORWARD unbounded mode),
 * optional `segmentBy` on birth event property (segment_event=FIRST).
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

	test('return event on birth day is NOT counted as retention', () => {
		// Mixpanel definition: birth = day 0. Return must be on day >= 1.
		const events = [
			ev('Sign Up', day(0),               { user_id: 'u1' }),
			ev('Login',   day(0) + 3_600_000,   { user_id: 'u1' }),  // same UTC day as birth
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1],
		});
		expect(rows[0].retained_count).toBe(0);
	});

	// ported from test_qt_retention.py: test_retention basic case.
	// Two cohort users (r9, r2), bucket 1 (next day) checks retention_event.
	test('ported fixture: cohort = users with birth event; daily buckets', () => {
		const events = [
			ev('$born',           Date.UTC(2011, 11, 1, 20, 58, 41), { user_id: 'r9' }),
			ev('$born',           Date.UTC(2011, 11, 1, 20, 58, 41), { user_id: 'r2' }),
			ev('$born',           Date.UTC(2011, 11, 1, 20, 58, 44), { user_id: 'r2' }),
			ev('retention_event', Date.UTC(2011, 11, 1, 20, 58, 43), { user_id: 'r9' }),  // birth day, not counted
			ev('retention_event', Date.UTC(2011, 11, 1, 20, 58, 43), { user_id: 'r3' }),  // no $born, not in cohort
			ev('retention_event', Date.UTC(2011, 11, 2, 21, 54, 22), { user_id: 'r9' }),  // day 1
			ev('retention_event', Date.UTC(2011, 11, 3, 18, 54, 22), { user_id: 'r2' }),  // day 2
			ev('retention_event', Date.UTC(2011, 11, 5, 20, 58, 22), { user_id: 'r9' }),  // day 4
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: '$born',
			returnEvent: 'retention_event',
			dayBuckets: [1, 2, 3, 4],
		});
		// Cohort = {r9, r2} = 2 users. r3 excluded.
		expect(rows[0].cohort_size).toBe(2);
		// Day 1: only r9 (1 user)
		expect(rows.find(r => r.day === 1).retained_count).toBe(1);
		// Day 2: only r2 (1 user)
		expect(rows.find(r => r.day === 2).retained_count).toBe(1);
		// Day 3: nobody
		expect(rows.find(r => r.day === 3).retained_count).toBe(0);
		// Day 4: r9
		expect(rows.find(r => r.day === 4).retained_count).toBe(1);
	});

	test('throws on missing required config', () => {
		expect(() => emulateBreakdown([], { type: 'retention' })).toThrow(/cohortEvent/);
		expect(() => emulateBreakdown([], { type: 'retention', cohortEvent: 'X' })).toThrow(/returnEvent/);
		expect(() => emulateBreakdown([], { type: 'retention', cohortEvent: 'X', returnEvent: 'Y', dayBuckets: [] })).toThrow(/dayBuckets/);
	});
});
