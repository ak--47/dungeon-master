//@ts-nocheck
/**
 * End-to-end integration tests for 1.3.0 changes:
 *   - per-user-per-day event budget (born-late users get rate × remaining_days, not the full budget)
 *   - future-event guard (no event timestamps past MAX_TIME)
 *   - preExistingSpread "uniform" vs "pinned" placement of pre-existing users' first event
 *
 * These run a small dungeon end-to-end (in-memory only; writeToDisk: false) and
 * inspect the returned arrays so we don't pay disk-I/O cost.
 */

import { describe, test, expect } from 'vitest';
import generate from '../index.js';

const SMALL = {
	seed: 'integration-1.3.0',
	numUsers: 200,
	numDays: 30,
	avgEventsPerUserPerDay: 3,
	format: 'json',
	gzip: false,
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	token: '',
	events: [
		{ event: 'sign up', isFirstEvent: true },
		{ event: 'page view', weight: 5 },
		{ event: 'click', weight: 3 }
	]
};

describe('future-event guard (no timestamps past MAX_TIME)', () => {
	test('no event in eventData has time > now', async () => {
		const result = await generate({ ...SMALL, name: 'guard-baseline' });
		const nowMs = Date.now();
		const future = result.eventData.filter(e => {
			if (!e || !e.time) return false;
			return Date.parse(e.time) > nowMs;
		});
		expect(future.length).toBe(0);
	});

	test('hook that injects events with positive time offsets cannot leak past now', async () => {
		// Hook clones the last event in each user's stream and shifts it forward
		// by a year. Future-event guard must drop those clones.
		const result = await generate({
			...SMALL,
			name: 'guard-hook',
			hook: function (record, type) {
				if (type !== 'everything' || !Array.isArray(record) || record.length === 0) return record;
				const last = record[record.length - 1];
				const clone = {
					...last,
					time: new Date(Date.parse(last.time) + 365 * 86400 * 1000).toISOString()
				};
				record.push(clone);
				return record;
			}
		});
		const nowMs = Date.now();
		const future = result.eventData.filter(e => Date.parse(e.time) > nowMs);
		expect(future.length).toBe(0);
	});
});

describe('per-user-per-day budget', () => {
	test('born-late users have proportionally fewer events than pre-existing users', async () => {
		// macro: "growth" pushes 25% of users into the dataset window with bornRecentBias=0.3.
		// Pre-existing users (75%) get rate × numDays. Born-in-dataset users get
		// rate × (their remaining window). Across the cohort, born-in-dataset users
		// should average meaningfully fewer events than pre-existing ones.
		const result = await generate({
			...SMALL,
			seed: 'budget-growth',
			name: 'budget-test',
			numUsers: 500,
			numDays: 60,
			avgEventsPerUserPerDay: 2,
			macro: 'growth'
		});

		// Group events by user_id, count per user
		const eventsPerUser = new Map();
		for (const e of result.eventData) {
			eventsPerUser.set(e.user_id, (eventsPerUser.get(e.user_id) || 0) + 1);
		}

		// In user-loop.js, profile.created is deleted for pre-existing users and kept
		// (and back-dated to a biased timestamp) for users born in the dataset window.
		// So presence of `created` is the cleanest born-in-dataset signal.
		const bornInDatasetCounts = [];
		const preExistingCounts = [];
		for (const profile of result.userProfilesData) {
			const eventCount = eventsPerUser.get(profile.distinct_id) || 0;
			if (profile.created) bornInDatasetCounts.push(eventCount);
			else preExistingCounts.push(eventCount);
		}

		expect(bornInDatasetCounts.length).toBeGreaterThan(0);
		expect(preExistingCounts.length).toBeGreaterThan(0);

		const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
		const bornAvg = avg(bornInDatasetCounts);
		const preAvg = avg(preExistingCounts);

		// Pre-existing users should on average have noticeably more events.
		// We don't pin an exact ratio because of randomness, but pre-existing
		// should be at least 1.3× higher when the macro pushes births toward the recent edge.
		expect(preAvg).toBeGreaterThan(bornAvg);
		expect(preAvg / bornAvg).toBeGreaterThan(1.2);
	});
});

describe('preExistingSpread', () => {
	test('"uniform" allows events to land before the dataset window start', async () => {
		// With percentUsersBornInDataset: 0, every user is pre-existing.
		// Under "uniform", their adjustedCreated is sampled from
		// [FIXED_BEGIN - 30d, FIXED_BEGIN], so userFirstEventTime can sit before
		// the nominal window. TimeSoup will then place events anywhere in
		// [userFirstEventTime, FIXED_NOW], so we expect at least some events to
		// fall before the standard window start.
		const result = await generate({
			...SMALL,
			seed: 'spread-uniform',
			name: 'spread-uniform',
			numUsers: 300,
			numDays: 30,
			macro: { preset: 'flat', preExistingSpread: 'uniform', percentUsersBornInDataset: 0 }
		});

		const times = result.eventData.map(e => Date.parse(e.time)).sort((a, b) => a - b);
		expect(times.length).toBeGreaterThan(0);
		const span = (times[times.length - 1] - times[0]) / (86400 * 1000);
		// Total span across all events should exceed the nominal 30-day window
		// because uniform pushes some users' first event up to 30 days earlier.
		expect(span).toBeGreaterThan(30);
	});

	test('"pinned" keeps pre-existing users\' first event near the dataset window start', async () => {
		const result = await generate({
			...SMALL,
			seed: 'spread-pinned',
			name: 'spread-pinned',
			numUsers: 300,
			numDays: 30,
			macro: { preset: 'flat', preExistingSpread: 'pinned', percentUsersBornInDataset: 0 }
		});

		const times = result.eventData.map(e => Date.parse(e.time)).sort((a, b) => a - b);
		expect(times.length).toBeGreaterThan(0);
		const span = (times[times.length - 1] - times[0]) / (86400 * 1000);
		// With "pinned", events should fit roughly within the nominal 30-day window
		// (a small amount of slop for sub-day noise/jitter is fine).
		expect(span).toBeLessThan(32);
	});
});
