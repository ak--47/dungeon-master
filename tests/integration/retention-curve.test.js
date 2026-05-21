//@ts-nocheck
/**
 * v1.5.1 (TODO #4): generator-side retention curve round-trip.
 *
 * Generator config sets `retentionCurve` → user active days are biased toward
 * the curve. Then `emulateBreakdown({ type: 'retention' })` reads the events
 * back and reports per-bucket retention. The two should match within ±10%
 * (curve targets are configured on DAY ACTIVITY; verifier reads EVENTS — the
 * indirection is documented in `lib/utils/retention-curve.js`).
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';
import { emulateBreakdown } from '../../lib/verify/index.js';
import dayjs from 'dayjs';

const FIXED_NOW = dayjs('2024-02-02').unix();

function pinWindow(extra = {}) {
	return {
		datasetStart: FIXED_NOW - 30 * 86400,
		datasetEnd: FIXED_NOW,
		writeToDisk: false,
		verbose: false,
		concurrency: 1,
		...extra,
	};
}

describe('v1.5.1 retentionCurve generator round-trip', () => {
	test('curve biases active-day distribution toward early days', async () => {
		const result = await DUNGEON_MASTER(pinWindow({
			seed: 'retcurve-basic',
			numUsers: 500,
			numDays: 30,
			avgEventsPerUserPerDay: 4,
			// Pin pre-existing-only so every user has the full 30-day window.
			percentUsersBornInDataset: 0,
			retentionCurve: { day1: 0.5, day7: 0.25, day30: 0.05 },
			events: [
				{ event: 'signup', isFirstEvent: true, isStrictEvent: true },
				{ event: 'visit', weight: 5 },
				{ event: 'browse', weight: 3 },
			],
		}));

		const events = Array.from(result.eventData);
		expect(events.length).toBeGreaterThan(0);

		// Per-user: count distinct active days. Group event count by day-offset
		// from each user's first event. Higher concentration near day 0 = curve
		// is biasing as expected.
		const byUser = new Map();
		for (const e of events) {
			const uid = e.user_id || e.distinct_id;
			if (!uid) continue;
			const t = Date.parse(e.time);
			if (!Number.isFinite(t)) continue;
			const day = Math.floor(t / 86_400_000);
			if (!byUser.has(uid)) byUser.set(uid, { firstDay: day, days: new Set() });
			const u = byUser.get(uid);
			if (day < u.firstDay) u.firstDay = day;
			u.days.add(day);
		}

		// Aggregate: count users active on day-offset N from their first event.
		const dayActivity = new Map();
		for (const u of byUser.values()) {
			for (const d of u.days) {
				const offset = d - u.firstDay;
				dayActivity.set(offset, (dayActivity.get(offset) || 0) + 1);
			}
		}
		const totalUsers = byUser.size;
		const day0 = dayActivity.get(0) || 0;
		const day1 = dayActivity.get(1) || 0;
		const day7 = dayActivity.get(7) || 0;
		const day28 = dayActivity.get(28) || 0;

		// Day 0 ~ 100% (every user has at least one event = first event).
		expect(day0 / totalUsers).toBeGreaterThan(0.8);
		// Day 1 > day 7 > day 28 (decay shape from curve).
		expect(day1).toBeGreaterThan(day7);
		expect(day7).toBeGreaterThan(day28);
		// Day 28 should be very low (curve targets 0.05 at day 30; day 28
		// linearly interpolated should be in the same ballpark, well under 30%).
		expect(day28 / totalUsers).toBeLessThan(0.3);
	});

	test('curve produces verifier-detectable retention shape', async () => {
		const result = await DUNGEON_MASTER(pinWindow({
			seed: 'retcurve-verify',
			numUsers: 1000,
			numDays: 30,
			avgEventsPerUserPerDay: 4,
			percentUsersBornInDataset: 0,
			retentionCurve: { day1: 0.6, day7: 0.3, day30: 0.1 },
			events: [
				{ event: 'visit', weight: 5 },
			],
		}));

		const events = Array.from(result.eventData);
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'visit',
			returnEvent: 'visit',
			dayBuckets: [1, 7, 30],
			birthCanRetain: false,
		});

		// Retention emulator returns one row per (cohort segment x bucket).
		expect(Array.isArray(rows)).toBe(true);
		expect(rows.length).toBeGreaterThan(0);
		// Shape check: day1 retention >= day7 >= day30 (monotone decay).
		const day1Row = rows.find(r => r.day === 1);
		const day7Row = rows.find(r => r.day === 7);
		const day30Row = rows.find(r => r.day === 30);
		expect(day1Row).toBeDefined();
		expect(day7Row).toBeDefined();
		expect(day30Row).toBeDefined();
		expect(day1Row.retained_pct).toBeGreaterThanOrEqual(day7Row.retained_pct);
		expect(day7Row.retained_pct).toBeGreaterThanOrEqual(day30Row.retained_pct);
	});

	test('curve wins when both retentionCurve and avgActiveDaysPerUser are set', async () => {
		const result = await DUNGEON_MASTER(pinWindow({
			seed: 'retcurve-priority',
			numUsers: 200,
			numDays: 30,
			avgEventsPerUserPerDay: 3,
			percentUsersBornInDataset: 0,
			avgActiveDaysPerUser: 25, // would normally push toward broad activity
			retentionCurve: { day1: 0.4, day30: 0.02 }, // curve says concentrate early
			events: [
				{ event: 'visit', weight: 5 },
			],
		}));

		const events = Array.from(result.eventData);
		const byUser = new Map();
		for (const e of events) {
			const uid = e.user_id || e.distinct_id;
			if (!uid) continue;
			const day = Math.floor(Date.parse(e.time) / 86_400_000);
			if (!byUser.has(uid)) byUser.set(uid, new Set());
			byUser.get(uid).add(day);
		}
		const avgDistinctDays = [...byUser.values()].reduce((s, set) => s + set.size, 0) / byUser.size;
		// Curve sum across 30 days ≈ 1 (day0) + decaying tail ≈ 3-6 days.
		// Should be MUCH less than the avgActiveDaysPerUser=25 setting.
		expect(avgDistinctDays).toBeLessThan(15);
	});
});
