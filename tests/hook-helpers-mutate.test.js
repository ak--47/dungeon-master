//@ts-nocheck
import { describe, test, expect, beforeEach } from 'vitest';
import {
	cloneEvent,
	dropEventsWhere,
	scaleEventCount,
	scalePropertyValue,
	shiftEventTime,
} from '../lib/hook-helpers/mutate.js';
import { initChance } from '../lib/utils/utils.js';

beforeEach(() => initChance('mutate-tests'));

const mkEv = (event, time, extra = {}) => ({ event, time, ...extra });

describe('mutate atoms', () => {
	test('cloneEvent: shallow merges overrides on top of template', () => {
		const tpl = { event: 'X', time: 100, amount: 10 };
		const c = cloneEvent(tpl, { time: 200, amount: 50 });
		expect(c).toEqual({ event: 'X', time: 200, amount: 50 });
		expect(c).not.toBe(tpl);
		// overrides default to {}
		const c2 = cloneEvent(tpl);
		expect(c2).toEqual(tpl);
		expect(c2).not.toBe(tpl);
	});

	test('cloneEvent: throws when template missing', () => {
		expect(() => cloneEvent(null)).toThrow();
	});

	test('dropEventsWhere: removes matching events in place, returns count', () => {
		const events = [mkEv('A', 1), mkEv('B', 2), mkEv('A', 3), mkEv('C', 4)];
		const dropped = dropEventsWhere(events, ev => ev.event === 'A');
		expect(dropped).toBe(2);
		expect(events.map(e => e.event)).toEqual(['B', 'C']);
	});

	test('dropEventsWhere: tolerates missing inputs', () => {
		expect(dropEventsWhere(null, () => true)).toBe(0);
		expect(dropEventsWhere([], () => true)).toBe(0);
	});

	test('scaleEventCount: factor=1 is no-op', () => {
		const events = [mkEv('A', 1), mkEv('B', 2)];
		expect(scaleEventCount(events, 'A', 1)).toBe(0);
		expect(events.length).toBe(2);
	});

	test('scaleEventCount: factor>1 clones with monotonic time offsets', () => {
		const t0 = Date.parse('2024-02-01T00:00:00Z');
		const events = [
			mkEv('A', new Date(t0).toISOString()),
			mkEv('A', new Date(t0 + 1000).toISOString()),
		];
		const added = scaleEventCount(events, 'A', 2); // double → 2 more
		expect(added).toBe(2);
		expect(events.length).toBe(4);
		const aClones = events.filter(e => e.event === 'A' && e.insert_id === undefined);
		expect(aClones.length).toBeGreaterThanOrEqual(2);
	});

	test('scaleEventCount: factor<1 drops some matching events using seeded RNG', () => {
		initChance('drop-some');
		const events = Array.from({ length: 100 }, (_, i) => mkEv('A', i));
		const delta = scaleEventCount(events, 'A', 0.5);
		expect(delta).toBeLessThan(0); // negative = dropped
		expect(events.length).toBeLessThan(100);
		// Most events should have been dropped — within ±25% of expected ~50 remaining.
		expect(events.length).toBeGreaterThan(25);
		expect(events.length).toBeLessThan(75);
	});

	test('scalePropertyValue: multiplies numeric props on matching events', () => {
		const events = [
			mkEv('purchase', 1, { amount: 10 }),
			mkEv('purchase', 2, { amount: 20 }),
			mkEv('view', 3, { amount: 999 }), // wrong event — skipped
			mkEv('purchase', 4, { amount: 'not a number' }), // skipped (non-numeric)
		];
		const n = scalePropertyValue(events, e => e.event === 'purchase', 'amount', 3);
		expect(n).toBe(2);
		expect(events[0].amount).toBe(30);
		expect(events[1].amount).toBe(60);
		expect(events[2].amount).toBe(999);
		expect(events[3].amount).toBe('not a number');
	});

	test('shiftEventTime: ISO + numeric (s and ms) variants', () => {
		const isoEv = { time: '2024-02-01T00:00:00.000Z' };
		shiftEventTime(isoEv, 60_000);
		expect(isoEv.time).toBe('2024-02-01T00:01:00.000Z');

		const msEv = { time: 1_700_000_000_000 }; // unix ms
		shiftEventTime(msEv, 60_000);
		expect(msEv.time).toBe(1_700_000_060_000);

		const sEv = { time: 1_700_000_000 }; // unix seconds
		shiftEventTime(sEv, 60_000);
		expect(sEv.time).toBe(1_700_000_060);
	});
});
