//@ts-nocheck
/**
 * P1.1 unit tests: eventBreakdown + countEvents + coerce helpers.
 *
 * Every expected value below is hand-computed from the ARB rule the
 * implementation cites — NOT derived from running the implementation:
 *   - list fan-out / $empty_list / undefined bucket: normal_query.cpp
 *     ACTION_TYPE_FOR_EACH (:1718-1776), arb_selector.py:889-916
 *   - case-sensitive segment identity: hash_value.c:114-115, cmp.c:24-32
 *   - case-insensitive filters: value.c:285, eval_node.c:2914/:2931
 *   - topN 250 truncation, no "other": normal_query.cpp:1195-1197, :1865-1905
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';
import { countEvents } from '../../lib/verify/counting.js';
import {
	coerceToBreakdownKey,
	breakdownSegmentKey,
	filterEquals,
	filterCompare,
	filterContains,
	matchesWhere,
} from '../../lib/verify/coerce.js';

const T = '2024-01-15T12:00:00.000Z';
const ev = (event, props = {}, user_id = 'u1', time = T) => ({ event, time, user_id, ...props });

describe('coerceToBreakdownKey', () => {
	test('null and undefined both map to the literal "undefined"', () => {
		// arb_selector.py: string(prop, "undefined") typecast default
		expect(coerceToBreakdownKey(null)).toBe('undefined');
		expect(coerceToBreakdownKey(undefined)).toBe('undefined');
	});

	test('booleans and numbers stringify; -0 normalizes to 0', () => {
		expect(coerceToBreakdownKey(true)).toBe('true');
		expect(coerceToBreakdownKey(false)).toBe('false');
		expect(coerceToBreakdownKey(42)).toBe('42');
		// hash_value.c:111 — v.d = v.d == -0.0 ? 0.0 : v.d
		expect(coerceToBreakdownKey(-0)).toBe('0');
	});

	test('strings pass through case-PRESERVED', () => {
		expect(coerceToBreakdownKey('iOS')).toBe('iOS');
		expect(coerceToBreakdownKey('ios')).toBe('ios');
	});
});

describe('breakdownSegmentKey — type-tagged identity', () => {
	test('number 1 and string "1" are DIFFERENT segments', () => {
		// hash_value.c mixes number_tag vs string_tag before hashing
		expect(breakdownSegmentKey(1)).not.toBe(breakdownSegmentKey('1'));
	});

	test('null and undefined share ONE segment', () => {
		expect(breakdownSegmentKey(null)).toBe(breakdownSegmentKey(undefined));
	});

	test('"iOS" and "ios" are different segments (case-sensitive)', () => {
		expect(breakdownSegmentKey('iOS')).not.toBe(breakdownSegmentKey('ios'));
	});
});

describe('filter comparators — case-INSENSITIVE (filters only)', () => {
	test('filterEquals: "iOS" == "ios" (value.c:285 arb_strcasecmp)', () => {
		expect(filterEquals('iOS', 'ios')).toBe(true);
		expect(filterEquals('iOS', 'android')).toBe(false);
	});

	test('filterEquals: null==null, undefined==undefined, null!=undefined', () => {
		expect(filterEquals(null, null)).toBe(true);
		expect(filterEquals(undefined, undefined)).toBe(true);
		expect(filterEquals(null, undefined)).toBe(false);
	});

	test('filterEquals: cross-type never equal (1 vs "1")', () => {
		expect(filterEquals(1, '1')).toBe(false);
	});

	test('filterCompare orders case-insensitively (eval_node.c:2931)', () => {
		expect(filterCompare('Apple', 'apple')).toBe(0);
		expect(filterCompare('Apple', 'BANANA')).toBeLessThan(0);
	});

	test('filterContains is case-insensitive (eval_node.c:2914 arb_strcaseinstr)', () => {
		expect(filterContains('Hello World', 'WORLD')).toBe(true);
		expect(filterContains('Hello World', 'mars')).toBe(false);
	});

	test('matchesWhere: relational ops on numbers and strings', () => {
		expect(matchesWhere({ price: 10 }, { price: { op: 'gt', value: 5 } })).toBe(true);
		expect(matchesWhere({ price: 10 }, { price: { op: 'lte', value: 9 } })).toBe(false);
		expect(matchesWhere({ tier: 'Pro' }, { tier: { op: 'gte', value: 'pro' } })).toBe(true);
		// mixed types fail relational tests (value_cmp orders by type first)
		expect(matchesWhere({ price: '10' }, { price: { op: 'gt', value: 5 } })).toBe(false);
	});

	test('matchesWhere: list-valued props — eq/contains are per-item membership (eval_node.c:2949-2959 IN)', () => {
		const rec = { tags: ['VIP', 'beta'], codes: [1, 2, 3] };
		// per-item value_equal: case-insensitive for string items
		expect(matchesWhere(rec, { tags: 'vip' })).toBe(true);
		expect(matchesWhere(rec, { tags: { op: 'contains', value: 'Beta' } })).toBe(true);
		// membership is EXACT per item, not substring (IN with a list right
		// operand runs value_equal, never arb_strcaseinstr)
		expect(matchesWhere(rec, { tags: { op: 'contains', value: 'vi' } })).toBe(false);
		// typed: number needle matches number item; "1" does not match 1
		expect(matchesWhere(rec, { codes: 2 })).toBe(true);
		expect(matchesWhere(rec, { codes: '2' })).toBe(false);
		// negations
		expect(matchesWhere(rec, { tags: { op: 'neq', value: 'vip' } })).toBe(false);
		expect(matchesWhere(rec, { tags: { op: 'not_contains', value: 'gold' } })).toBe(true);
		// relational ops on list values stay false (no scalar-vs-list per-item relational in ARB)
		expect(matchesWhere(rec, { codes: { op: 'gt', value: 0 } })).toBe(false);
		// empty list never matches, and its negation always does
		expect(matchesWhere({ tags: [] }, { tags: 'vip' })).toBe(false);
		expect(matchesWhere({ tags: [] }, { tags: { op: 'neq', value: 'vip' } })).toBe(true);
	});
});

describe('eventBreakdown', () => {
	test('counts EVENTS per segment (not users): 3 iOS events from 1 user, 1 android from another', () => {
		const events = [
			ev('page view', { platform: 'iOS' }, 'u1'),
			ev('page view', { platform: 'iOS' }, 'u1'),
			ev('page view', { platform: 'iOS' }, 'u1'),
			ev('page view', { platform: 'android' }, 'u2'),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', event: 'page view', breakdownProperty: 'platform' });
		// hand-computed: iOS count=3 (3 events), total_users=1; android count=1, total_users=1
		expect(rows).toEqual([
			{ value: 'iOS', count: 3, total_users: 1 },
			{ value: 'android', count: 1, total_users: 1 },
		]);
	});

	test('segment identity is case-SENSITIVE: "iOS" and "ios" are separate rows', () => {
		const events = [
			ev('a', { p: 'iOS' }),
			ev('a', { p: 'iOS' }),
			ev('a', { p: 'ios' }),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p' });
		expect(rows).toEqual([
			{ value: 'iOS', count: 2, total_users: 1 },
			{ value: 'ios', count: 1, total_users: 1 },
		]);
	});

	test('list fan-out: event with ["a","b"] increments BOTH segments once each', () => {
		const events = [
			ev('tag', { tags: ['a', 'b'] }, 'u1'),
			ev('tag', { tags: ['a'] }, 'u2'),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'tags' });
		// hand-computed: a = 2 events (both), b = 1 event (first only)
		expect(rows).toEqual([
			{ value: 'a', count: 2, total_users: 2 },
			{ value: 'b', count: 1, total_users: 1 },
		]);
	});

	test('empty list → "$empty_list" segment (normal_query.cpp:1762)', () => {
		const events = [ev('tag', { tags: [] })];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'tags' });
		expect(rows).toEqual([{ value: '$empty_list', count: 1, total_users: 1 }]);
	});

	test('null and MISSING property both land in one "undefined" bucket', () => {
		const events = [
			ev('a', { p: null }, 'u1'),
			ev('a', {}, 'u2'), // property absent → undefined
			ev('a', { p: 'x' }, 'u3'),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p' });
		// hand-computed: undefined bucket = 2 events (null + missing), 2 users
		expect(rows).toEqual([
			{ value: 'undefined', count: 2, total_users: 2 },
			{ value: 'x', count: 1, total_users: 1 },
		]);
	});

	test('number 1 and string "1" produce two rows that BOTH display "1"', () => {
		const events = [
			ev('a', { v: 1 }),
			ev('a', { v: 1 }),
			ev('a', { v: '1' }),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'v' });
		expect(rows.length).toBe(2);
		expect(rows[0]).toEqual({ value: '1', count: 2, total_users: 1 });
		expect(rows[1]).toEqual({ value: '1', count: 1, total_users: 1 });
	});

	test('topN truncates with NO "other" bucket (query_set_top_results)', () => {
		const events = [
			ev('a', { p: 'x' }), ev('a', { p: 'x' }), ev('a', { p: 'x' }),
			ev('a', { p: 'y' }), ev('a', { p: 'y' }),
			ev('a', { p: 'z' }),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p', topN: 2 });
		// hand-computed: keep x(3), y(2); z truncated entirely; sum of counts = 5, not 6
		expect(rows).toEqual([
			{ value: 'x', count: 3, total_users: 1 },
			{ value: 'y', count: 2, total_users: 1 },
		]);
	});

	test('omitting `event` counts across all event names', () => {
		const events = [
			ev('a', { p: 'x' }),
			ev('b', { p: 'x' }),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p' });
		expect(rows).toEqual([{ value: 'x', count: 2, total_users: 1 }]);
	});

	test('identity resolution: device-only pre-auth event joins the user segment', () => {
		const events = [
			{ event: 'a', time: T, device_id: 'd1', p: 'x' },       // pre-auth: no user_id
			{ event: 'a', time: T, user_id: 'u9', p: 'x' },
		];
		const profiles = [{ distinct_id: 'u9', device_ids: ['d1'] }];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p', profiles });
		// hand-computed: 2 events, ONE resolved user
		expect(rows).toEqual([{ value: 'x', count: 2, total_users: 1 }]);
	});

	test('composes with timeBucket: per-day rows tagged with period', () => {
		const events = [
			ev('a', { p: 'x' }, 'u1', '2024-01-15T10:00:00.000Z'),
			ev('a', { p: 'x' }, 'u1', '2024-01-16T10:00:00.000Z'),
			ev('a', { p: 'y' }, 'u2', '2024-01-16T11:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p', timeBucket: 'day' });
		expect(rows).toEqual([
			{ period: '2024-01-15', value: 'x', count: 1, total_users: 1 },
			{ period: '2024-01-16', value: 'x', count: 1, total_users: 1 },
			{ period: '2024-01-16', value: 'y', count: 1, total_users: 1 },
		]);
	});

	test('countType "sessions" on empty input returns no rows (P1.7.3 — full tests in sessions-count-type.test.js)', () => {
		expect(emulateBreakdown([], { type: 'eventBreakdown', breakdownProperty: 'p', countType: 'sessions' }))
			.toEqual([]);
	});

	// COUNT_TYPE_UNIQUE: per-segment metric is distinct resolved users
	// (query_record_per_user_state per segment, normal_query.cpp:1300-1316).
	test('countType "unique": count is distinct users per segment, not events', () => {
		const events = [
			ev('a', { p: 'red' }, 'u1'),
			ev('a', { p: 'red' }, 'u1'),
			ev('a', { p: 'red' }, 'u1'),
			ev('a', { p: 'red' }, 'u2'),
			ev('a', { p: 'blue' }, 'u1'),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p', countType: 'unique' });
		// hand-computed: red = {u1, u2} → 2; blue = {u1} → 1. General would
		// have said red=4, blue=1.
		expect(rows).toEqual([
			{ value: 'red', count: 2, total_users: 2 },
			{ value: 'blue', count: 1, total_users: 1 },
		]);
	});

	test('countType "unique": topN sorts on the unique metric, not event volume', () => {
		// red: 4 events, 1 user. blue: 2 events, 2 users. General ranks
		// red first (4 > 2); unique ranks blue first (2 users > 1 user).
		const events = [
			ev('a', { p: 'red' }, 'u1'),
			ev('a', { p: 'red' }, 'u1'),
			ev('a', { p: 'red' }, 'u1'),
			ev('a', { p: 'red' }, 'u1'),
			ev('a', { p: 'blue' }, 'u1'),
			ev('a', { p: 'blue' }, 'u2'),
		];
		const general = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p' });
		expect(general.map(r => r.value)).toEqual(['red', 'blue']);
		const uniq = emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p', countType: 'unique' });
		expect(uniq).toEqual([
			{ value: 'blue', count: 2, total_users: 2 },
			{ value: 'red', count: 1, total_users: 1 },
		]);
	});

	test('explicit countType "general" is accepted and identical to the default', () => {
		const events = [ev('a', { p: 'x' }, 'u1'), ev('a', { p: 'x' }, 'u1')];
		expect(emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p', countType: 'general' }))
			.toEqual(emulateBreakdown(events, { type: 'eventBreakdown', breakdownProperty: 'p' }));
	});

	test('unrecognized countType throws (strict-option rule — no silent general fallback)', () => {
		expect(() => emulateBreakdown([ev('a', { p: 'x' })], { type: 'eventBreakdown', breakdownProperty: 'p', countType: 'uniques' }))
			.toThrow(/countType/);
	});
});

// v1.6.0 fix round (B5): timeBucket compositions. Hand-computed from the
// ARB rules:
//   - firstTimeOnly: ONE first_event_time per user over the whole lookback
//     (event_selector.py:125-149) — the first-ever event lands in exactly
//     one bucket; later buckets get nothing for that user. The wrapper must
//     hoist the filter above the partition (the real B5 bug).
//   - countType 'sessions' needs no hoist: sessions never cross UTC
//     midnight (unconditional daySplit, sessionize.js) and every bucket
//     unit cuts at midnights, so per-bucket slice re-derivation reproduces
//     full-stream session boundaries exactly. The two session tests below
//     LOCK that invariant — if daySplit is ever removed or made
//     conditional, the wrapper needs a full-stream sessionize hoist and
//     these fixtures must be re-derived.
describe('eventBreakdown × timeBucket — full-stream compositions (B5)', () => {
	test('firstTimeOnly: a user first-ever in bucket 1 does NOT re-qualify in bucket 2', () => {
		const events = [
			ev('Play', { platform: 'ios' }, 'u1', '2024-01-01T10:00:00.000Z'),     // u1 first ever
			ev('Play', { platform: 'ios' }, 'u1', '2024-01-02T10:00:00.000Z'),     // NOT first — must not count
			ev('Play', { platform: 'android' }, 'u2', '2024-01-02T11:00:00.000Z'), // u2 first ever
		];
		const rows = emulateBreakdown(events, {
			type: 'eventBreakdown', event: 'Play', breakdownProperty: 'platform',
			firstTimeOnly: true, timeBucket: 'day',
		});
		// Hand-computed: Jan 1 = u1's first (ios). Jan 2 = u2's first only
		// (android). The per-bucket-recompute bug would add ios:1 on Jan 2.
		expect(rows).toEqual([
			{ period: '2024-01-01', value: 'ios', count: 1, total_users: 1 },
			{ period: '2024-01-02', value: 'android', count: 1, total_users: 1 },
		]);
	});

	test('sessions invariant: midnight ALWAYS splits — a would-be straddle is two sessions, one per bucket', () => {
		// timeout 2h; gap 23:30 → 00:30 is only 1h, BUT daySplit fires at
		// the midnight crossing (sessionize.js buildUserSessions) → session
		// A = {23:30}, session B = {00:30}. Each bucket sees exactly its own
		// session: Jan 1 → 1, Jan 2 → 1. Identical whether sessions derive
		// from the full stream or the bucket slice — that identity is what
		// makes the wrapper's slice recursion safe for countType 'sessions'.
		const events = [
			ev('Play', { platform: 'ios' }, 'u1', '2024-01-01T23:30:00.000Z'),
			ev('Play', { platform: 'ios' }, 'u1', '2024-01-02T00:30:00.000Z'),
		];
		const rows = emulateBreakdown(events, {
			type: 'eventBreakdown', event: 'Play', breakdownProperty: 'platform',
			countType: 'sessions', sessionTimeoutMs: 2 * 3_600_000, timeBucket: 'day',
		});
		expect(rows).toEqual([
			{ period: '2024-01-01', value: 'ios', count: 1, total_users: 1 },
			{ period: '2024-01-02', value: 'ios', count: 1, total_users: 1 },
		]);
	});

	test('sessions invariant: max-cap anchors reset at midnight with the daySplit, so slice = full-stream', () => {
		// timeout 2h, maxSession 2h. Full-stream derivation:
		//   23:00 Jan 1 starts session A. 00:30 Jan 2 — midnight crossed →
		//   daySplit → session B starts 00:30. 01:30 — gap 1h < timeout,
		//   1h from B's start ≤ max → still session B.
		// Jan 1: {A} → 1. Jan 2: {B} → 1. A slice-derived Jan 2 gives the
		// same session B — daySplit guarantees no session state carries
		// across the bucket edge for ANY timeout/max-cap combination.
		const events = [
			ev('Play', { platform: 'ios' }, 'u1', '2024-01-01T23:00:00.000Z'),
			ev('Play', { platform: 'ios' }, 'u1', '2024-01-02T00:30:00.000Z'),
			ev('Play', { platform: 'ios' }, 'u1', '2024-01-02T01:30:00.000Z'),
		];
		const rows = emulateBreakdown(events, {
			type: 'eventBreakdown', event: 'Play', breakdownProperty: 'platform',
			countType: 'sessions', sessionTimeoutMs: 2 * 3_600_000, maxSessionMs: 2 * 3_600_000,
			timeBucket: 'day',
		});
		expect(rows).toEqual([
			{ period: '2024-01-01', value: 'ios', count: 1, total_users: 1 },
			{ period: '2024-01-02', value: 'ios', count: 1, total_users: 1 },
		]);
	});
});

describe('countEvents', () => {
	const events = [
		ev('purchase', { platform: 'iOS', price: 10 }),
		ev('purchase', { platform: 'ios', price: 20 }),
		ev('purchase', { platform: 'android', price: 5 }),
		ev('page view', { platform: 'iOS' }),
	];

	test('counts all events with no filter', () => {
		expect(countEvents(events)).toBe(4);
	});

	test('filters by event name', () => {
		expect(countEvents(events, { event: 'purchase' })).toBe(3);
	});

	test('where equality is case-INSENSITIVE: platform "ios" matches both spellings', () => {
		// filters use arb_strcasecmp — unlike breakdown bucketing
		expect(countEvents(events, { event: 'purchase', where: { platform: 'ios' } })).toBe(2);
	});

	test('where relational op on numbers', () => {
		expect(countEvents(events, { event: 'purchase', where: { price: { op: 'gte', value: 10 } } })).toBe(2);
	});
});
