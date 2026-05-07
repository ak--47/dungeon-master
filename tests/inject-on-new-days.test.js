//@ts-nocheck
/**
 * Unit tests for `injectOnNewDays`. The atom moves users between frequency
 * bins in Mixpanel's distinct-period frequency distribution by adding events
 * on previously empty days within the user's active window.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { injectOnNewDays } from '../lib/hook-helpers/inject.js';
import { initChance } from '../lib/utils/utils.js';
import { countDistinctPeriods } from '../lib/verify/counting.js';

const DAY_MS = 86400000;
const t0 = Date.parse('2024-02-01T00:00:00Z');
const ev = (event, dayOffset, hour = 12, extra = {}) => ({
	event,
	time: new Date(t0 + dayOffset * DAY_MS + hour * 3600000).toISOString(),
	user_id: 'u1',
	insert_id: `iid-${event}-${dayOffset}-${hour}`,
	...extra,
});

describe('injectOnNewDays', () => {
	beforeEach(() => {
		initChance('inject-on-new-days-tests');
	});

	test('basic injection: user on 2 distinct days, target 5 → 3 events injected on 3 new days', () => {
		// Span: day 0 to day 9. Existing Buy events on day 0 and day 5.
		// Filler events expand the active window.
		const events = [
			ev('Buy', 0),
			ev('Buy', 5),
			ev('Browse', 9),
		];
		const before = countDistinctPeriods(events, 'Buy');
		expect(before).toBe(2);
		injectOnNewDays(events, 'Buy', 5);
		const after = countDistinctPeriods(events, 'Buy');
		expect(after).toBe(5);
		// 3 new Buy events appended.
		const buys = events.filter(e => e.event === 'Buy');
		expect(buys.length).toBe(5);
	});

	test('already at target: user on 5 distinct days, target 5 → no changes', () => {
		const events = [0, 1, 2, 3, 4].map(d => ev('Buy', d));
		const before = events.length;
		injectOnNewDays(events, 'Buy', 5);
		expect(events.length).toBe(before);
	});

	test('above target: user on 7 distinct days, target 5 → no changes', () => {
		const events = [0, 1, 2, 3, 4, 5, 6].map(d => ev('Buy', d));
		const before = events.length;
		injectOnNewDays(events, 'Buy', 5);
		expect(events.length).toBe(before);
	});

	test('active window respected: injected events fall within first-to-last event range', () => {
		const events = [
			ev('Buy', 2),
			ev('Buy', 4),
			ev('Browse', 8),
		];
		injectOnNewDays(events, 'Buy', 6);
		const minMs = Date.parse(events[0].time);
		const maxMs = Date.parse(events[2].time);
		const buys = events.filter(e => e.event === 'Buy');
		for (const b of buys) {
			const t = Date.parse(b.time);
			expect(t).toBeGreaterThanOrEqual(minMs);
			expect(t).toBeLessThanOrEqual(maxMs);
		}
	});

	test('template cloning: injected events have same event name as template, different timestamp/insert_id', () => {
		const events = [
			ev('Buy', 0, 12, { amount: 100, category: 'electronics' }),
			ev('Browse', 5),
		];
		injectOnNewDays(events, 'Buy', 3);
		const buys = events.filter(e => e.event === 'Buy');
		// All should be `Buy` with cloned properties
		for (const b of buys) {
			expect(b.event).toBe('Buy');
			expect(b.amount).toBe(100);
			expect(b.category).toBe('electronics');
		}
		// Cloned events should NOT carry insert_id (stripped for re-dedup).
		const clones = buys.filter(b => b !== events[0]);
		for (const c of clones) {
			expect(c.insert_id).toBeUndefined();
		}
	});

	test('no template available: returns unchanged when event type does not exist on user', () => {
		const events = [
			ev('Browse', 0),
			ev('Browse', 5),
		];
		const before = events.length;
		injectOnNewDays(events, 'Buy', 5);
		expect(events.length).toBe(before);
	});

	test('deterministic: same seed → same injection days', () => {
		const make = () => [ev('Buy', 0), ev('Buy', 9)];

		initChance('determ-seed-1');
		const a = make();
		injectOnNewDays(a, 'Buy', 6);
		const aDays = a.filter(e => e.event === 'Buy').map(e => Math.floor(Date.parse(e.time) / DAY_MS)).sort();

		initChance('determ-seed-1');
		const b = make();
		injectOnNewDays(b, 'Buy', 6);
		const bDays = b.filter(e => e.event === 'Buy').map(e => Math.floor(Date.parse(e.time) / DAY_MS)).sort();

		expect(aDays).toEqual(bDays);
	});
});
