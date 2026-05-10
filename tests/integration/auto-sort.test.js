//@ts-nocheck
/**
 * v1.5 auto-sort after `everything` hook tests.
 *
 * Defends against the most common new footgun under v1.5: hooks that push()
 * cloned events with arbitrary timestamps, breaking the greedy funnel engine's
 * chronological-order requirement (`history.cpp` processes events left-to-right
 * after sorting, with no backtracking).
 *
 * Default: ON. Opt out with `autoSortAfterEverything: false`.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const baseConfig = (overrides = {}) => ({
	seed: 'auto-sort-test',
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-10-01T00:00:00Z',
	numUsers: 20,
	avgEventsPerUserPerDay: 3,
	events: [
		{ event: 'page view', weight: 5 },
		{ event: 'click', weight: 3 },
	],
	funnels: [{
		sequence: ['page view', 'click'],
		timeToConvert: 1,
		order: 'sequential',
	}],
	writeToDisk: false,
	verbose: false,
	...overrides,
});

function userEvents(events) {
	const map = new Map();
	for (const ev of events) {
		const uid = ev.user_id || ev.distinct_id;
		if (!uid) continue;
		if (!map.has(uid)) map.set(uid, []);
		map.get(uid).push(ev);
	}
	return map;
}

function isSortedAscending(events) {
	let prev = -Infinity;
	for (const e of events) {
		const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
		if (t < prev) return false;
		prev = t;
	}
	return true;
}

describe('v1.5 autoSortAfterEverything', () => {
	test('default ON: hook that pushes out-of-order events results in sorted output', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'sort-on',
			hook: function (record, type) {
				if (type === 'everything' && Array.isArray(record) && record.length > 0) {
					// Inject events 1 hour and 1 day BEFORE the first event.
					const first = record[0];
					const before1h = { ...first, time: new Date(Date.parse(first.time) - 3600000).toISOString() };
					const before1d = { ...first, time: new Date(Date.parse(first.time) - 86400000).toISOString() };
					record.push(before1h, before1d); // intentionally out-of-order
				}
				return record;
			},
		}));
		const events = Array.from(result.eventData);
		// Per-user, events should be sorted ascending despite the hook's push order.
		for (const [, evs] of userEvents(events)) {
			expect(isSortedAscending(evs)).toBe(true);
		}
	});

	test('autoSortAfterEverything: false preserves hook order', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'sort-off',
			autoSortAfterEverything: false,
			hook: function (record, type) {
				if (type === 'everything' && Array.isArray(record) && record.length > 0) {
					// Push a far-future event then a far-past event to verify no sort.
					// (Future event will be filtered by the future-time guard, so use a past event.)
					const first = record[0];
					const before1y = { ...first, time: new Date(Date.parse(first.time) - 365 * 86400000).toISOString() };
					record.push(before1y);
				}
				return record;
			},
		}));
		const events = Array.from(result.eventData);
		// Per-user — at least ONE user should have an out-of-order event.
		let foundUnsorted = false;
		for (const [, evs] of userEvents(events)) {
			if (!isSortedAscending(evs)) { foundUnsorted = true; break; }
		}
		expect(foundUnsorted).toBe(true);
	});

	test('default ON: dungeons WITHOUT push hooks still produce sorted output (BC)', async () => {
		const result = await DUNGEON_MASTER(baseConfig({ seed: 'no-hook' }));
		const events = Array.from(result.eventData);
		for (const [, evs] of userEvents(events)) {
			expect(isSortedAscending(evs)).toBe(true);
		}
	});

	test('greedy funnel engine works correctly when hook injects step-2 BEFORE step-1', async () => {
		// Hook injects "click" events 1 hour BEFORE matching "page view" events.
		// Without auto-sort, the greedy engine would consume the early click first
		// and fail to advance through "page view" → "click". With auto-sort, the
		// engine sees them in order.
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'greedy-defense',
			hook: function (record, type) {
				if (type === 'everything' && Array.isArray(record) && record.length > 0) {
					// Find a page view; clone an out-of-order click before it.
					for (const e of record) {
						if (e.event === 'page view') {
							const beforeClick = {
								...e,
								event: 'click',
								time: new Date(Date.parse(e.time) - 3600000).toISOString(),
							};
							record.push(beforeClick);
							break; // just one
						}
					}
				}
				return record;
			},
		}));
		const events = Array.from(result.eventData);
		for (const [, evs] of userEvents(events)) {
			expect(isSortedAscending(evs)).toBe(true);
		}
	});
});
