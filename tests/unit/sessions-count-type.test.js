//@ts-nocheck
/**
 * P1.7.3 unit tests: `countType: 'sessions'` on eventBreakdown + uniques.
 *
 * Rules under test (expected values hand-computed from the ARB source, never
 * from running this implementation):
 *   - eventBreakdown: an event counts at most once per (user, session,
 *     segment) — counted iff the segment has no prior counted event in that
 *     session, then stamp (query_record_per_user_session_segment_state,
 *     normal_query.cpp:1318-1352).
 *   - uniques: the bucket value is the count of distinct (user, session)
 *     pairs active in the bucket, NOT distinct users (per-interval
 *     user_session_states containers, normal_query.cpp:397-417, dispatch at
 *     :1462-1464).
 *   - Sessions derive from the FULL event stream — ARB updates session state
 *     on every event and only gates result recording on the filter
 *     (normal_query.cpp:2271-2280).
 *   - Session triggers (session_query.cpp, via P1.7.1 sessionize): gap
 *     strictly > 30-min timeout, span strictly > 24h max from session start,
 *     UTC day-index change.
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const T = Date.UTC(2024, 0, 15); // 2024-01-15T00:00:00Z
const MIN = 60_000;
const DAY = 86_400_000;
const mk = (event, tMs, uid = 'u1', props = {}) => ({ event, time: tMs, user_id: uid, ...props });

describe('eventBreakdown — countType: sessions', () => {
	test('counts once per (user, session, segment); segments independent within a session', () => {
		// u1 hand-derived sessions at the 30-min default: gaps 1min/1min stay,
		// the 2min → 80min gap (78 min) splits → session A = first three
		// events, session B = the last.
		//   session A: Play rock, Play rock, Play jazz
		//   session B: Play rock
		// rock → counted in A (once — second occurrence stamped out) and in
		// B → 2. jazz → counted in A → 1.
		const events = [
			mk('Play', T, 'u1', { genre: 'rock' }),
			mk('Play', T + 1 * MIN, 'u1', { genre: 'rock' }),
			mk('Play', T + 2 * MIN, 'u1', { genre: 'jazz' }),
			mk('Play', T + 80 * MIN, 'u1', { genre: 'rock' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'eventBreakdown', event: 'Play', breakdownProperty: 'genre', countType: 'sessions',
		});
		expect(rows).toEqual([
			{ value: 'rock', count: 2, total_users: 1 },
			{ value: 'jazz', count: 1, total_users: 1 },
		]);
	});

	test('without countType the same fixture counts raw events (totals)', () => {
		const events = [
			mk('Play', T, 'u1', { genre: 'rock' }),
			mk('Play', T + 1 * MIN, 'u1', { genre: 'rock' }),
			mk('Play', T + 2 * MIN, 'u1', { genre: 'jazz' }),
			mk('Play', T + 80 * MIN, 'u1', { genre: 'rock' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'eventBreakdown', event: 'Play', breakdownProperty: 'genre',
		});
		expect(rows.find(r => r.value === 'rock').count).toBe(3);
	});

	test('list-valued property: each item segment counted once per session', () => {
		// One session (1-min gap); two events each carrying ['a','b'] — the
		// per-item record() dedups per segment, so a and b count 1 each.
		const events = [
			mk('Play', T, 'u1', { tags: ['a', 'b'] }),
			mk('Play', T + 1 * MIN, 'u1', { tags: ['a', 'b'] }),
		];
		const rows = emulateBreakdown(events, {
			type: 'eventBreakdown', breakdownProperty: 'tags', countType: 'sessions',
		});
		expect(rows).toEqual([
			{ value: 'a', count: 1, total_users: 1 },
			{ value: 'b', count: 1, total_users: 1 },
		]);
	});

	test('sessions derive from the FULL stream, not the filtered events', () => {
		// u1: A@0, B@20min, A@40min. Full-stream gaps are 20min/20min → ONE
		// session → A counts 1. Deriving from the A-only subset would see a
		// 40-min gap → two sessions → 2 (the wrong answer this test pins out;
		// normal_query.cpp:2271-2280 updates session state unconditionally).
		const events = [
			mk('A', T, 'u1', { p: 'x' }),
			mk('B', T + 20 * MIN, 'u1', { p: 'x' }),
			mk('A', T + 40 * MIN, 'u1', { p: 'x' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'eventBreakdown', event: 'A', breakdownProperty: 'p', countType: 'sessions',
		});
		expect(rows).toEqual([{ value: 'x', count: 1, total_users: 1 }]);
	});

	test('sessionTimeoutMs threads into derivation', () => {
		// 15-min gap between two same-segment events: one session at the
		// default (count 1), two sessions at a 10-min timeout (count 2).
		const events = [
			mk('A', T, 'u1', { p: 'x' }),
			mk('A', T + 15 * MIN, 'u1', { p: 'x' }),
		];
		const def = emulateBreakdown(events, {
			type: 'eventBreakdown', breakdownProperty: 'p', countType: 'sessions',
		});
		expect(def[0].count).toBe(1);
		const tight = emulateBreakdown(events, {
			type: 'eventBreakdown', breakdownProperty: 'p', countType: 'sessions',
			sessionTimeoutMs: 10 * MIN,
		});
		expect(tight[0].count).toBe(2);
	});

	test('cross-user: each user session counts; total_users from counted events', () => {
		// u1 and u2 each one session with segment 'x' → count 2, users 2.
		const events = [
			mk('A', T, 'u1', { p: 'x' }),
			mk('A', T + 1 * MIN, 'u1', { p: 'x' }), // deduped within u1's session
			mk('A', T, 'u2', { p: 'x' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'eventBreakdown', breakdownProperty: 'p', countType: 'sessions',
		});
		expect(rows).toEqual([{ value: 'x', count: 2, total_users: 2 }]);
	});

	test('composes with firstTimeOnly (first-ever filter, then session counting)', () => {
		// u1 Plays in two sessions (80-min gap). firstTimeOnly keeps only the
		// first-ever Play → 1 counted session; without it both sessions count.
		const events = [
			mk('Play', T, 'u1', { p: 'x' }),
			mk('Play', T + 80 * MIN, 'u1', { p: 'x' }),
		];
		const both = emulateBreakdown(events, {
			type: 'eventBreakdown', event: 'Play', breakdownProperty: 'p', countType: 'sessions',
		});
		expect(both[0].count).toBe(2);
		const first = emulateBreakdown(events, {
			type: 'eventBreakdown', event: 'Play', breakdownProperty: 'p', countType: 'sessions',
			firstTimeOnly: true,
		});
		expect(first[0].count).toBe(1);
	});
});

describe('uniques — countType: sessions', () => {
	test('bucket value is distinct (user, session) pairs, not distinct users', () => {
		// Same UTC day: u1 has TWO sessions (50-min gap between 10:10 and
		// 11:00 exceeds 30 min), u2 has one → sessions value 3 where the
		// default uniques value is 2.
		const events = [
			mk('A', Date.UTC(2024, 0, 15, 10, 0), 'u1'),
			mk('A', Date.UTC(2024, 0, 15, 10, 10), 'u1'),
			mk('A', Date.UTC(2024, 0, 15, 11, 0), 'u1'),
			mk('A', Date.UTC(2024, 0, 15, 10, 0), 'u2'),
		];
		const bySessions = emulateBreakdown(events, { type: 'uniques', countType: 'sessions' });
		expect(bySessions).toEqual([{ period: '2024-01-15', uniques: 3 }]);
		const byUsers = emulateBreakdown(events, { type: 'uniques' });
		expect(byUsers).toEqual([{ period: '2024-01-15', uniques: 2 }]);
	});

	test('UTC-day split: a near-midnight run yields one session per day bucket', () => {
		// 23:55 → 00:05 is a 10-min gap, but the UTC day-index change splits
		// (session_query.cpp day trigger) → each daily bucket sees 1 session.
		const events = [
			mk('A', Date.UTC(2024, 0, 15, 23, 55), 'u1'),
			mk('A', Date.UTC(2024, 0, 16, 0, 5), 'u1'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', countType: 'sessions' });
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 1 },
		]);
	});

	test("unit: 'range' counts distinct sessions over the whole range", () => {
		const events = [
			mk('A', Date.UTC(2024, 0, 15, 10, 0), 'u1'),
			mk('A', Date.UTC(2024, 0, 15, 11, 0), 'u1'), // 60-min gap → 2nd session
			mk('A', Date.UTC(2024, 0, 15, 10, 0), 'u2'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', countType: 'sessions', unit: 'range' });
		expect(rows).toEqual([{ period: 'range', uniques: 3 }]);
	});

	test('event filter selects events but sessions derive from the full stream', () => {
		// u1: A@10:00, B@10:20, A@10:40 — full-stream gaps 20min → ONE
		// session; the A-filtered view still reports 1 session, not the 2 a
		// filtered-stream derivation would produce (40-min A-to-A gap).
		const events = [
			mk('A', Date.UTC(2024, 0, 15, 10, 0), 'u1'),
			mk('B', Date.UTC(2024, 0, 15, 10, 20), 'u1'),
			mk('A', Date.UTC(2024, 0, 15, 10, 40), 'u1'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', event: 'A', countType: 'sessions' });
		expect(rows).toEqual([{ period: '2024-01-15', uniques: 1 }]);
	});

	test('rollingWindow composes: a session lands in W look-back buckets', () => {
		// u1 session on day 0, u2 session on day 1, W=2. Day-0 event → buckets
		// [0, 1]; day-1 event → buckets [1, 2] clamped to maxDay 1. Hand-
		// computed: day0 = {u1-session} = 1, day1 = {u1-session, u2-session}
		// = 2. (normal_query.cpp:1797-1830 routes the window branch through
		// the same count-type dispatch at :1462-1464.)
		const events = [
			mk('A', T, 'u1'),
			mk('A', T + DAY, 'u2'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', countType: 'sessions', rollingWindow: 2 });
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 2 },
		]);
	});

	test('sessionTimeoutMs threads into derivation', () => {
		// 15-min gap: 1 session at the default, 2 at a 10-min timeout.
		const events = [
			mk('A', T, 'u1'),
			mk('A', T + 15 * MIN, 'u1'),
		];
		expect(emulateBreakdown(events, { type: 'uniques', countType: 'sessions' })[0].uniques).toBe(1);
		expect(emulateBreakdown(events, {
			type: 'uniques', countType: 'sessions', sessionTimeoutMs: 10 * MIN,
		})[0].uniques).toBe(2);
	});

	test('cumulative + sessions throws (no ARB cumulative sessions count type)', () => {
		expect(() => emulateBreakdown([], { type: 'uniques', countType: 'sessions', cumulative: true }))
			.toThrow(/cumulative sessions/);
	});
});
