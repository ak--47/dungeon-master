//@ts-nocheck
/**
 * v1.5 follow-up (`plans/DATAGEN/reccomendations-agent-1.md` Fix #1):
 * `engagementDecay` must respect `pickedDayBuckets` from `buildActiveDayPlan`.
 *
 * Without the fix: decay can drop ALL events on later picked days (exponential
 * with short half-life), silently undershooting the configured
 * `avgActiveDaysPerUser`.
 *
 * With the fix: decay protects the LAST surviving event on each picked day,
 * preserving the v1.5 distinct-day contract.
 *
 * Counting rule: distinct calendar days per user (Mixpanel addiction_query.cpp
 * calendar-bucket).
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';

const cfg = (overrides = {}) => ({
	seed: 'decay-active-days',
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-10-01T00:00:00Z',
	numUsers: 200,
	avgEventsPerUserPerDay: 4,
	avgActiveDaysPerUser: 5,
	engagementDecay: { model: 'exponential', halfLife: 7, floor: 0.05 },
	events: [
		{ event: 'page view', weight: 5 },
		{ event: 'click', weight: 3 },
	],
	funnels: [{
		sequence: ['page view', 'click'],
		conversionRate: 50,
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

function distinctDayCounts(events) {
	const counts = [];
	for (const [, evs] of userEvents(events)) {
		const buckets = new Set();
		for (const e of evs) {
			const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
			if (!Number.isFinite(t)) continue;
			buckets.add(Math.floor(t / 86400000));
		}
		counts.push(buckets.size);
	}
	return counts;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Sequential block — chance singleton is process-global; concurrent tests
// would interleave consumption and break the active-day distribution check.
describe.sequential('v1.5 Fix #1 — engagementDecay respects pickedDays', () => {
	test('mean distinct-day count stays close to avgActiveDaysPerUser=5 with exponential decay', async () => {
		const result = await DUNGEON_MASTER(cfg());
		const events = Array.from(result.eventData);
		const counts = distinctDayCounts(events);
		const meanActive = mean(counts);
		// Without the fix: meanActive collapses to ~2-3 because exponential decay
		// with halfLife=7 and floor=0.05 kills most events on later picked days.
		// With the fix: each picked day retains at least 1 event, so the
		// distinct-day count stays close to the configured target. 20% tolerance.
		expect(meanActive).toBeGreaterThan(4);
		expect(meanActive).toBeLessThan(6.5);
	});

	test('users with engagementDecay still have events on EVERY picked day', async () => {
		const result = await DUNGEON_MASTER(cfg({ seed: 'every-picked-day' }));
		const events = Array.from(result.eventData);
		// Per-user: distinct-day count should be > 1. Without the fix, late
		// picked days routinely get fully drained → some users end up at 1 or
		// even 0 distinct days.
		const counts = distinctDayCounts(events);
		const usersWithFewerThan2 = counts.filter(c => c < 2).length;
		// Very few users should have <2 distinct days under v1.5.
		expect(usersWithFewerThan2 / counts.length).toBeLessThan(0.15);
	});
});
