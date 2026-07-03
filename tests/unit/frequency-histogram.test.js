//@ts-nocheck
/**
 * P1.10 unit tests: frequencyHistogram — the Frequency (Addiction) report
 * interval/histogram shape.
 *
 * Every expected value is hand-computed from the ARB rules — NOT derived
 * from running the implementation:
 *   - rolling counter per (user, interval): an event counts iff
 *     time >= last_counted + unit_seconds; last_counted is per-interval and
 *     calloc-zeroed, so it resets at each interval boundary
 *     (addiction_query_update_history, addiction_query.cpp:363-374)
 *   - histogram[count - 1] += 1 per user with count > 0; zero-count users
 *     omitted — no zero bucket (addiction_query_prepare_results,
 *     addiction_query.cpp:546-573)
 *   - histogram length = ceil(interval_seconds / unit_seconds)
 *     (addiction_units_per_interval, libquery/time/unit.c:108-113)
 *   - intervals tile FORWARD from range start (uniform_intervals_for,
 *     uniform_intervals.h:48-58); every interval is emitted, zeros included
 *
 * Two fixtures port directly from mixpanel/analytics
 * backend/arb/test/test_qt_addiction.py EVENT_DATA with the ARB test's own
 * expected outputs.
 */

import { describe, test, expect } from 'vitest';
import { frequencyHistogram } from '../../lib/verify/counting.js';

const D0 = Date.UTC(2024, 0, 1); // 2024-01-01T00:00:00Z
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const mk = (event, tMs, uid = 'u1') => ({ event, time: tMs, user_id: uid });

describe('frequencyHistogram', () => {
	test('day unit: rolling counts bucket users into histogram[count - 1]', () => {
		// u1: noon on days 0/1/2 — each gap exactly 86400s, `>=` passes → count 3.
		// u2: day0 12:00 + day1 11:00 — gap 82800s < 86400s → count 1.
		// histLen = ceil(7·86400 / 86400) = 7.
		const events = [
			mk('Buy', D0 + 12 * HOUR, 'u1'),
			mk('Buy', D0 + DAY + 12 * HOUR, 'u1'),
			mk('Buy', D0 + 2 * DAY + 12 * HOUR, 'u1'),
			mk('Buy', D0 + 12 * HOUR, 'u2'),
			mk('Buy', D0 + DAY + 11 * HOUR, 'u2'),
		];
		expect(frequencyHistogram(events, { event: 'Buy', unit: 'day', intervalDays: 7 })).toEqual([
			{ interval: '2024-01-01', histogram: [1, 0, 1, 0, 0, 0, 0] },
		]);
	});

	test('rolling counter resets at interval boundary: first event of each interval always counts', () => {
		// intervalDays 1: u1 at day0 23:00 and day1 00:30 — gap 5400s < 86400s,
		// so a GLOBAL rolling counter would count only the first. last_counted
		// is per-(user, interval) and calloc-zeroed (addiction_query.cpp:363-374)
		// → both count, one per interval. histLen = ceil(86400/86400) = 1.
		const events = [
			mk('Buy', D0 + 23 * HOUR, 'u1'),
			mk('Buy', D0 + DAY + 30 * MIN, 'u1'),
		];
		expect(frequencyHistogram(events, { event: 'Buy', unit: 'day', intervalDays: 1 })).toEqual([
			{ interval: '2024-01-01', histogram: [1] },
			{ interval: '2024-01-02', histogram: [1] },
		]);
	});

	test('range spans the full stream; empty intervals emit zero-filled rows; zero-count users omitted', () => {
		// u2's 'Other' on day 9 extends the range (tiling covers the whole
		// stream) but never matches 'Buy' — u2 enters NO histogram (no zero
		// bucket). Interval 1 (days 7-13) prints all zeros; ARB's print loop
		// emits every interval (addiction_query.cpp:546-573 print path).
		const events = [
			mk('Buy', D0 + 12 * HOUR, 'u1'),
			mk('Other', D0 + 9 * DAY + 12 * HOUR, 'u2'),
		];
		expect(frequencyHistogram(events, { event: 'Buy', unit: 'day', intervalDays: 7 })).toEqual([
			{ interval: '2024-01-01', histogram: [1, 0, 0, 0, 0, 0, 0] },
			{ interval: '2024-01-08', histogram: [0, 0, 0, 0, 0, 0, 0] },
		]);
	});

	test('hour unit: histogram length = ceil(interval/unit) = 24 for a 1-day interval', () => {
		// u1 at 00:05, 00:30, 01:10. 00:05 counts (first); 00:30 gap 1500s
		// < 3600s → no; 01:10 gap from last COUNTED (00:05) = 3900s >= 3600s
		// → counts. count 2 → index 1.
		const events = [
			mk('Buy', D0 + 5 * MIN, 'u1'),
			mk('Buy', D0 + 30 * MIN, 'u1'),
			mk('Buy', D0 + 70 * MIN, 'u1'),
		];
		const expected = new Array(24).fill(0);
		expected[1] = 1;
		expect(frequencyHistogram(events, { event: 'Buy', unit: 'hour', intervalDays: 1 })).toEqual([
			{ interval: '2024-01-01', histogram: expected },
		]);
	});

	test('ports test_qt_addiction.py 2012-07-27 hourly fixture: [1, 1, 0, ...]', () => {
		// EVENT_DATA restricted to 2012-07-27 (the ARB test passes
		// --from-date/--to-date 2012-07-27; this helper derives range from
		// the stream). user1: 00:00:00 ×2 (second same-timestamp not
		// counted) + 00:00:01 (gap 1s < 3600s, not counted) + 01:00:00
		// (counted) → 2. user2: 00:00:00 once → 1. ARB expected:
		// {"2012-07-27": [1, 1, 0 ×22]} — "user2 hit once, user1 twice".
		const B = Date.UTC(2012, 6, 27);
		const events = [
			mk('addicted_event', B, 'user1'),
			mk('addicted_event', B, 'user1'),
			mk('addicted_event', B + 1000, 'user1'),
			mk('addicted_event', B + HOUR, 'user1'),
			mk('addicted_event', B, 'user2'),
		];
		const expected = new Array(24).fill(0);
		expected[0] = 1; // user2 → count 1
		expected[1] = 1; // user1 → count 2
		expect(frequencyHistogram(events, { event: 'addicted_event', unit: 'hour', intervalDays: 1 }))
			.toEqual([{ interval: '2012-07-27', histogram: expected }]);
	});

	test('ports test_qt_addiction.py 2022-08-21 cluster: [1, 1, 1, 0, ...]', () => {
		// In-fixture comments: "User_N has an addiction index of N" — index =
		// count − 1. User_0: 00:00 → 1. User_1: 00:00 + 01:00 → 2. User_2:
		// 00:00 + 01:00 + 03:00 → 3 (every gap >= 3600s).
		const B = Date.UTC(2022, 7, 21);
		const events = [
			mk('addicted_event', B, 'User_0'),
			mk('addicted_event', B, 'User_1'),
			mk('addicted_event', B + HOUR, 'User_1'),
			mk('addicted_event', B, 'User_2'),
			mk('addicted_event', B + HOUR, 'User_2'),
			mk('addicted_event', B + 3 * HOUR, 'User_2'),
		];
		const expected = new Array(24).fill(0);
		expected[0] = 1;
		expected[1] = 1;
		expected[2] = 1;
		expect(frequencyHistogram(events, { event: 'addicted_event', unit: 'hour', intervalDays: 1 }))
			.toEqual([{ interval: '2022-08-21', histogram: expected }]);
	});

	test('profiles join device-only events to the canonical user', () => {
		// Joined: d1 day0 10:00 + u9 day1 10:00 — gap exactly 86400s, `>=`
		// passes → one user, count 2. Unjoined: two users, count 1 each.
		const events = [
			{ event: 'Buy', time: D0 + 10 * HOUR, device_id: 'd1' },
			{ event: 'Buy', time: D0 + DAY + 10 * HOUR, user_id: 'u9' },
		];
		const profiles = [{ distinct_id: 'u9', device_ids: ['d1'] }];
		expect(frequencyHistogram(events, { event: 'Buy', unit: 'day', intervalDays: 7, profiles }))
			.toEqual([{ interval: '2024-01-01', histogram: [0, 1, 0, 0, 0, 0, 0] }]);
		expect(frequencyHistogram(events, { event: 'Buy', unit: 'day', intervalDays: 7 }))
			.toEqual([{ interval: '2024-01-01', histogram: [2, 0, 0, 0, 0, 0, 0] }]);
	});

	test('guards: event required; unit validated; intervalDays positive integer; empty → []', () => {
		expect(() => frequencyHistogram([], { unit: 'day', intervalDays: 1 }))
			.toThrow(/event is required/);
		expect(() => frequencyHistogram([], { event: 'Buy', unit: 'minute', intervalDays: 1 }))
			.toThrow(/unsupported unit/);
		expect(() => frequencyHistogram([], { event: 'Buy', intervalDays: 0 }))
			.toThrow(/positive integer/);
		expect(() => frequencyHistogram([], { event: 'Buy', intervalDays: 2.5 }))
			.toThrow(/positive integer/);
		expect(() => frequencyHistogram([], { event: 'Buy' }))
			.toThrow(/positive integer/);
		expect(frequencyHistogram([], { event: 'Buy', intervalDays: 1 })).toEqual([]);
	});
});
