//@ts-nocheck
/**
 * P1.4 unit tests: filterFirstTimeEver + firstTimeOnly wiring.
 *
 * Every expected value below is hand-computed from the ARB rewrite rule —
 * NOT derived from running the implementation:
 *   - two-query rewrite: event_selector.py:59-149 — pre-filters feed a
 *     per-user first_event_time aggregation (:125-142); the query is then
 *     rewritten to `$time == first_event_time` AND post-filters (:143-145)
 *   - order matters: filters before the nth-time marker are pre, after
 *     are post (arb_selector.py:1935-1936); post-filters test ONLY the
 *     picked event (event_selector.py:59-63)
 *   - the second query does NOT re-apply pre-filters — same-name events
 *     tied at the first timestamp all pass (consequence of the
 *     `properties["$time"] == first_event_time` selector)
 */

import { describe, test, expect } from 'vitest';
import { filterFirstTimeEver } from '../../lib/verify/first-time.js';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';
import { buildIdentityMap } from '../../lib/verify/identity.js';

const ev = (user_id, time, event = 'purchase', props = {}) => ({ event, time, user_id, ...props });

describe('filterFirstTimeEver — basic', () => {
	test('keeps each user\'s first-ever occurrence only', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-16T10:00:00.000Z'),
			ev('u2', '2024-01-16T12:00:00.000Z'),
		];
		const out = filterFirstTimeEver(events, { event: 'purchase' });
		// hand-computed: u1's first = Jan 15; u2's first = Jan 16
		expect(out).toEqual([events[0], events[2]]);
	});

	test('event-name scoping: other events neither picked nor counted as firsts', () => {
		const events = [
			ev('u1', '2024-01-14T10:00:00.000Z', 'page view'),
			ev('u1', '2024-01-15T10:00:00.000Z', 'purchase'),
		];
		const out = filterFirstTimeEver(events, { event: 'purchase' });
		// hand-computed: the Jan 14 page view does not make Jan 15 "not first"
		expect(out).toEqual([events[1]]);
	});

	test('input order preserved; unordered input still finds the true first', () => {
		const later = ev('u1', '2024-01-16T10:00:00.000Z');
		const first = ev('u1', '2024-01-15T10:00:00.000Z');
		const out = filterFirstTimeEver([later, first], { event: 'purchase' });
		expect(out).toEqual([first]);
	});

	test('empty input and users without ids', () => {
		expect(filterFirstTimeEver([], { event: 'purchase' })).toEqual([]);
		expect(filterFirstTimeEver([{ event: 'purchase', time: '2024-01-15T10:00:00.000Z' }], { event: 'purchase' })).toEqual([]);
	});
});

describe('filterFirstTimeEver — pre/post filter order (event_selector.py:59-63)', () => {
	test('preWhere defines the universe: first PRO purchase, not first purchase', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'purchase', { plan: 'free' }),
			ev('u1', '2024-01-16T10:00:00.000Z', 'purchase', { plan: 'pro' }),
			ev('u1', '2024-01-17T10:00:00.000Z', 'purchase', { plan: 'pro' }),
		];
		const out = filterFirstTimeEver(events, { event: 'purchase', preWhere: { plan: 'pro' } });
		// hand-computed: universe = {Jan 16, Jan 17}; first = Jan 16
		expect(out).toEqual([events[1]]);
	});

	test('postWhere tests ONLY the picked event: first-ever fails post → user contributes NOTHING', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'purchase', { browser: 'safari' }),
			ev('u1', '2024-01-16T10:00:00.000Z', 'purchase', { browser: 'chrome' }),
		];
		const out = filterFirstTimeEver(events, { event: 'purchase', postWhere: { browser: 'chrome' } });
		// hand-computed: u1's first-ever is the safari event; it fails the post
		// filter, and the chrome event is NOT "first" — so nothing survives.
		expect(out).toEqual([]);
	});

	test('the spec\'s worked example: first insights view, was it chrome?', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'view report', { report: 'insights', browser: 'chrome' }),
			ev('u1', '2024-01-16T10:00:00.000Z', 'view report', { report: 'insights', browser: 'safari' }),
			ev('u2', '2024-01-15T11:00:00.000Z', 'view report', { report: 'flows', browser: 'chrome' }),
			ev('u2', '2024-01-16T11:00:00.000Z', 'view report', { report: 'insights', browser: 'safari' }),
		];
		const opts = { event: 'view report', preWhere: { report: 'insights' }, postWhere: { browser: 'chrome' } };
		const out = filterFirstTimeEver(events, opts);
		// hand-computed: u1's first insights view is Jan 15 (chrome) → passes.
		// u2's first insights view is Jan 16 (safari) → fails post. The Jan 15
		// flows view was never in the universe.
		expect(out).toEqual([events[0]]);
	});

	test('preWhere matching is case-insensitive (WHERE-filter rulebook)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'purchase', { plan: 'PRO' }),
			ev('u1', '2024-01-16T10:00:00.000Z', 'purchase', { plan: 'pro' }),
		];
		const out = filterFirstTimeEver(events, { event: 'purchase', preWhere: { plan: 'pro' } });
		expect(out).toEqual([events[0]]);
	});
});

describe('filterFirstTimeEver — rewrite fidelity', () => {
	test('timestamp ties: second query does NOT re-apply preWhere, so both tied events pass', () => {
		// Consequence of `properties["$time"] == first_event_time` — the
		// rewritten selector is event name + timestamp + postWhere only.
		const proAtT0 = ev('u1', '2024-01-15T10:00:00.000Z', 'purchase', { plan: 'pro' });
		const freeAtT0 = ev('u1', '2024-01-15T10:00:00.000Z', 'purchase', { plan: 'free' });
		const out = filterFirstTimeEver([proAtT0, freeAtT0], { event: 'purchase', preWhere: { plan: 'pro' } });
		// hand-computed: first pro time = T0; both purchase events at T0 pass
		expect(out).toEqual([proAtT0, freeAtT0]);
	});

	test('identity resolution: pre-auth device event IS the user\'s first', () => {
		const deviceEvent = { event: 'purchase', time: '2024-01-15T10:00:00.000Z', device_id: 'd1' };
		const userEvent = ev('u9', '2024-01-16T10:00:00.000Z');
		const identityMap = buildIdentityMap([{ distinct_id: 'u9', device_ids: ['d1'] }]);
		const out = filterFirstTimeEver([deviceEvent, userEvent], { event: 'purchase', identityMap });
		// hand-computed: d1 resolves to u9 → the device event is the first
		expect(out).toEqual([deviceEvent]);
	});
});

describe('firstTimeOnly wiring', () => {
	test('uniques + firstTimeOnly = new-user series (repeat activity excluded)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-16T10:00:00.000Z'), // repeat — not first
			ev('u2', '2024-01-16T12:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', event: 'purchase', unit: 'day', firstTimeOnly: true });
		// hand-computed: firsts are u1@Jan15, u2@Jan16
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 1 },
		]);
	});

	test('uniques + firstTimeOnly: `where` is the PRE-filter (first matching event, not first event matching)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'purchase', { plan: 'free' }),
			ev('u1', '2024-01-16T10:00:00.000Z', 'purchase', { plan: 'pro' }),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', event: 'purchase', unit: 'day', where: { plan: 'pro' }, firstTimeOnly: true });
		// hand-computed: first PRO purchase is Jan 16 — Jan 15 contributes nothing
		expect(rows).toEqual([{ period: '2024-01-16', uniques: 1 }]);
	});

	test('eventBreakdown + firstTimeOnly segments only first-ever events', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'purchase', { platform: 'iOS' }),
			ev('u1', '2024-01-16T10:00:00.000Z', 'purchase', { platform: 'android' }), // repeat
			ev('u2', '2024-01-16T12:00:00.000Z', 'purchase', { platform: 'android' }),
		];
		const rows = emulateBreakdown(events, { type: 'eventBreakdown', event: 'purchase', breakdownProperty: 'platform', firstTimeOnly: true });
		// hand-computed: firsts = u1's iOS event + u2's android event
		expect(rows).toEqual([
			{ value: 'iOS', count: 1, total_users: 1 },
			{ value: 'android', count: 1, total_users: 1 },
		]);
	});
});
