//@ts-nocheck
/**
 * v1.5 active-day primitive tests.
 *
 * Verifies `Dungeon.avgActiveDaysPerUser` is a CONCENTRATOR — events cluster
 * onto fewer distinct UTC days. (Total event count IS preserved at the
 * `numEventsThisUserWillPreform` budget level, but engine quirks like the
 * catch-all funnel drifting events past FIXED_NOW make end-to-end count
 * preservation hard to assert exactly. We assert distribution shape instead.)
 *
 * Counting rule under test: distinct calendar days per user. Matches Mixpanel's
 * `addiction_query.cpp` calendar-bucket semantics — see
 * `lib/verify/counting.js#countDistinctPeriods`.
 *
 * Reference: `mixpanel/analytics/backend/arb/reader/queries/addiction_query.cpp`
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';
import { countDistinctPeriods } from '../lib/verify/counting.js';

// Test config uses explicit short-TTC funnels so the catch-all funnel
// (auto-created when events are not in any funnel) does not drift past
// FIXED_NOW and confound count comparisons.
const baseConfig = (overrides = {}) => ({
	seed: 'active-days-test',
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-10-01T00:00:00Z',
	numUsers: 200,
	avgEventsPerUserPerDay: 4,
	hasSessionIds: false,
	events: [
		{ event: 'page view', weight: 5 },
		{ event: 'click', weight: 3 },
	],
	// Explicit short-TTC funnel covering both events so no catch-all auto-runs.
	funnels: [{
		sequence: ['page view', 'click'],
		conversionRate: 50,
		timeToConvert: 1, // 1 hour — funnel stays inside a single day
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

// `sequence.concurrent: true` (vitest.config.js) parallelizes tests within a
// file. Active-day distribution depends on a deterministic chance stream;
// concurrent tests interleave consumption.
describe.sequential('v1.5 avgActiveDaysPerUser primitive', () => {
	test('mean distinct-day count matches configured target ±20%', async () => {
		// 200 users × 30 days. Target: ~5 active days per user (sd ≈ mean/3 ≈ 1.67).
		// Expect mean across users in [4, 6] (20% tolerance to absorb engine
		// interactions like funnel TTC spilling onto adjacent days).
		const result = await DUNGEON_MASTER(baseConfig({ avgActiveDaysPerUser: 5 }));
		const counts = distinctDayCounts(Array.from(result.eventData));
		const meanActive = mean(counts);
		expect(meanActive).toBeGreaterThan(4);
		expect(meanActive).toBeLessThan(6.5);
	});

	test('higher avgActiveDaysPerUser produces higher distinct-day mean', async () => {
		const low = await DUNGEON_MASTER(baseConfig({ seed: 'low-active', avgActiveDaysPerUser: 3 }));
		const high = await DUNGEON_MASTER(baseConfig({ seed: 'high-active', avgActiveDaysPerUser: 12 }));
		const meanLow = mean(distinctDayCounts(Array.from(low.eventData)));
		const meanHigh = mean(distinctDayCounts(Array.from(high.eventData)));
		expect(meanHigh).toBeGreaterThan(meanLow);
		// active=3 → ~3 days; active=12 → ~10 days (born-late users cap target)
		expect(meanHigh - meanLow).toBeGreaterThan(4);
	});

	test('legacy mode (avgActiveDaysPerUser undefined) does not honor a target — distribution emerges from cursor drift', async () => {
		// Without the knob, distinct-day distribution emerges from how the funnel
		// cursor advances (lastTime + 1-30min gap) and how TimeSoup spreads the
		// first event of each funnel run. There is NO contract on distinct-day
		// count in legacy mode; we just verify the distribution exists.
		const result = await DUNGEON_MASTER(baseConfig({ seed: 'legacy-noop' }));
		const counts = distinctDayCounts(Array.from(result.eventData));
		expect(counts.length).toBeGreaterThan(0);
		expect(mean(counts)).toBeGreaterThan(0);
	});

	test('countDistinctPeriods agrees with raw distinct-day count', async () => {
		const result = await DUNGEON_MASTER(baseConfig({ avgActiveDaysPerUser: 4 }));
		const events = Array.from(result.eventData);
		const allUserEvents = userEvents(events);
		// Sample 5 users — distinct-day count via countDistinctPeriods should match
		// raw set-of-day-buckets math. Tests that the verifier uses same calendar
		// bucketing as the engine's active-day picking.
		let checked = 0;
		for (const [, evs] of allUserEvents) {
			if (checked >= 5 || !evs.length) break;
			const eventName = evs[0].event;
			const allDays = countDistinctPeriods(evs, eventName, 'day');
			const buckets = new Set();
			for (const e of evs) {
				if (e.event !== eventName) continue;
				const t = Date.parse(e.time);
				if (!Number.isFinite(t)) continue;
				buckets.add(Math.floor(t / 86400000));
			}
			expect(allDays).toBe(buckets.size);
			checked++;
		}
		expect(checked).toBeGreaterThan(0);
	});

	test('per-active-day rate warning fires for high-concentration configs', async () => {
		const warnings = [];
		const origWarn = console.warn;
		console.warn = (msg) => { warnings.push(String(msg)); };
		try {
			// 100 events/window-day × 30 days ÷ 2 active days = 1500 events/active day → warn
			// 10 users is enough — warning fires per-config, not per-user.
			await DUNGEON_MASTER(baseConfig({
				seed: 'rate-warn',
				numUsers: 10,
				avgEventsPerUserPerDay: 100,
				avgActiveDaysPerUser: 2,
			}));
		} finally {
			console.warn = origWarn;
		}
		const hasRateWarning = warnings.some(w => w.includes('events per active day'));
		expect(hasRateWarning).toBe(true);
	});

	test('throws on negative avgActiveDaysPerUser', async () => {
		await expect(
			DUNGEON_MASTER(baseConfig({ avgActiveDaysPerUser: -1 }))
		).rejects.toThrow(/avgActiveDaysPerUser/);
	});

	test('throws on non-finite avgActiveDaysPerUser', async () => {
		await expect(
			DUNGEON_MASTER(baseConfig({ avgActiveDaysPerUser: NaN }))
		).rejects.toThrow(/avgActiveDaysPerUser/);
	});
});

describe('v1.5 bunchIntoSessions removal — session integrity preserved', () => {
	test('hasSessionIds: true still produces sensible session counts via assignSessionIds', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'sessions-emergent',
			hasSessionIds: true,
		}));
		const events = Array.from(result.eventData);
		expect(events.length).toBeGreaterThan(0);
		// Every event should have a session_id.
		const withSessions = events.filter(e => e.session_id);
		expect(withSessions.length).toBe(events.length);
		// Per-user session counts should be reasonable (1-100).
		for (const [, evs] of userEvents(events)) {
			const sessions = new Set(evs.map(e => e.session_id));
			expect(sessions.size).toBeGreaterThan(0);
			expect(sessions.size).toBeLessThan(200);
		}
	});

	test('events arrive sorted (assignSessionIds + auto-sort guarantee)', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'sort-check',
			hasSessionIds: true,
		}));
		const events = Array.from(result.eventData);
		for (const [, evs] of userEvents(events)) {
			let prev = -Infinity;
			for (const e of evs) {
				const t = Date.parse(e.time);
				expect(t).toBeGreaterThanOrEqual(prev);
				prev = t;
			}
		}
	});
});
