//@ts-nocheck
/**
 * P1.8 unit tests: lifecycle (the LCA board template classification).
 *
 * Every expected value below is hand-computed from the template's cohort
 * rules — NOT derived from running the implementation:
 *   - the four classes generalize weeklyResurrectedUserBookmark
 *     (iron/common/widgets/profile-summary/bookmark_templates.ts:179-320):
 *     resurrected = AtLeast 1 in T AND EqualTo 0 in T−1 AND AtLeast 1
 *     before T−1; retained = AtLeast 1 in T AND T−1; dormant = EqualTo 0
 *     in T AND AtLeast 1 in T−1; new = first-ever value moment in T
 *     ($nth_time_event — the P1.4 machinery)
 *   - periods tile back from the DATASET's last event day (declared
 *     deterministic stand-in for the template's rolling as-of windows,
 *     insights/params.py:1396-1403)
 *   - period field = ISO date of the period's last day
 *
 * Period math used throughout (hand-derived): with last event day L and
 * first value-moment day F, numPeriods = ceil((L − F + 1) / P); period i
 * covers days (endDay(i) − P, endDay(i)], endDay(i) = L − (N − 1 − i)·P.
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const DAY = 86_400_000;
const JAN1 = Date.UTC(2024, 0, 1); // day index base; Jan 1 2024 = "day 0" below
const vm = (uid, day, event = 'Value Moment') => ({ event, time: JAN1 + day * DAY + 12 * 3_600_000, user_id: uid });

describe('lifecycle — new / retained / dormant', () => {
	test('three 7-day periods: first-ever → new; consecutive → retained; drop-off → dormant ONCE', () => {
		// Days 0..20 → L=20, F=0, N=3. Periods: [0..6] end Jan 7,
		// [7..13] end Jan 14, [14..20] end Jan 21.
		//   u1 active days 3, 10, 20 → periods {0,1,2}: new@0, retained@1, retained@2
		//   u2 active day 3          → {0}: new@0, dormant@1, NOTHING@2 (dormant
		//     counts exactly one period — EqualTo 0 in T requires AtLeast 1 in T−1)
		//   u3 active day 10         → {1}: new@1, dormant@2
		const events = [
			vm('u1', 3), vm('u1', 10), vm('u1', 20),
			vm('u2', 3),
			vm('u3', 10),
		];
		const rows = emulateBreakdown(events, { type: 'lifecycle', valueMomentEvent: 'Value Moment' });
		expect(rows).toEqual([
			{ period: '2024-01-07', new: 2, retained: 0, resurrected: 0, dormant: 0 },
			{ period: '2024-01-14', new: 1, retained: 1, resurrected: 0, dormant: 1 },
			{ period: '2024-01-21', new: 0, retained: 1, resurrected: 0, dormant: 1 },
		]);
	});

	test('resurrected: active T, inactive T−1, active before T−1', () => {
		// Days 0..27 → L=27, F=0, N=4. Period ends Jan 7/14/21/28.
		//   u1 active days 2, 16 → periods {0,2}: new@0, dormant@1,
		//     RESURRECTED@2 (inactive per1, active per0), dormant@3
		//   u2 active day 27 → {3}: new@3 (also pins L=27 as the anchor)
		const events = [vm('u1', 2), vm('u1', 16), vm('u2', 27)];
		const rows = emulateBreakdown(events, { type: 'lifecycle', valueMomentEvent: 'Value Moment' });
		expect(rows).toEqual([
			{ period: '2024-01-07', new: 1, retained: 0, resurrected: 0, dormant: 0 },
			{ period: '2024-01-14', new: 0, retained: 0, resurrected: 0, dormant: 1 },
			{ period: '2024-01-21', new: 0, retained: 0, resurrected: 1, dormant: 0 },
			{ period: '2024-01-28', new: 1, retained: 0, resurrected: 0, dormant: 1 },
		]);
	});

	test('ONE stray event in the dormancy window reclassifies (EqualTo-0 filter)', () => {
		// Same shape as the resurrection fixture but u1 fires once on day 9
		// (inside period 1) → per1 flips dormant→retained and per2 flips
		// resurrected→retained. This is the gap-discipline hazard the spec
		// calls out (bookmark_templates.ts EqualTo 0).
		const events = [vm('u1', 2), vm('u1', 9), vm('u1', 16), vm('u2', 20)];
		const rows = emulateBreakdown(events, { type: 'lifecycle', valueMomentEvent: 'Value Moment' });
		expect(rows).toEqual([
			{ period: '2024-01-07', new: 1, retained: 0, resurrected: 0, dormant: 0 },
			{ period: '2024-01-14', new: 0, retained: 1, resurrected: 0, dormant: 0 },
			{ period: '2024-01-21', new: 1, retained: 1, resurrected: 0, dormant: 0 },
		]);
	});

	test('periodDays: 30 (the monthly LCA variant)', () => {
		// Days 0..59 → L=59, F=0, N=2. Period ends: day 29 = Jan 30, day 59 =
		// Feb 29 (2024 is a leap year). u1 active days 5, 45 → new@0,
		// retained@1; u2 active day 59 → new@1.
		const events = [vm('u1', 5), vm('u1', 45), vm('u2', 59)];
		const rows = emulateBreakdown(events, {
			type: 'lifecycle', valueMomentEvent: 'Value Moment', periodDays: 30,
		});
		expect(rows).toEqual([
			{ period: '2024-01-30', new: 1, retained: 0, resurrected: 0, dormant: 0 },
			{ period: '2024-02-29', new: 1, retained: 1, resurrected: 0, dormant: 0 },
		]);
	});
});

describe('lifecycle — anchoring and identity', () => {
	test('period edges anchor on the FULL stream last event day; non-value-moment users appear in no class', () => {
		// u1 value moments on days 0 and 8; u2 fires only 'other', last on
		// day 13. Anchor = day 13 (dataset boundary) → N=2, period ends Jan 7
		// and Jan 14 — NOT day 8 (the value-moment subset's last day, which
		// would end the tiles on Jan 2/Jan 9). u2 is never active → no class.
		const events = [
			vm('u1', 0), vm('u1', 8),
			{ event: 'other', time: JAN1 + 13 * DAY, user_id: 'u2' },
		];
		const rows = emulateBreakdown(events, { type: 'lifecycle', valueMomentEvent: 'Value Moment' });
		expect(rows).toEqual([
			{ period: '2024-01-07', new: 1, retained: 0, resurrected: 0, dormant: 0 },
			{ period: '2024-01-14', new: 0, retained: 1, resurrected: 0, dormant: 0 },
		]);
	});

	test('identity resolution: pre-auth device event anchors first-ever and activity', () => {
		// d1 (device-only) fires the value moment on day 0; u9 on days 8 and
		// 13. With profiles joining d1→u9: one user, active periods {0,1},
		// first-ever@0 → new@0, retained@1.
		const events = [
			{ event: 'Value Moment', time: JAN1 + 0 * DAY, device_id: 'd1' },
			vm('u9', 8), vm('u9', 13),
		];
		const profiles = [{ distinct_id: 'u9', device_ids: ['d1'] }];
		const rows = emulateBreakdown(events, {
			type: 'lifecycle', valueMomentEvent: 'Value Moment', profiles,
		});
		expect(rows).toEqual([
			{ period: '2024-01-07', new: 1, retained: 0, resurrected: 0, dormant: 0 },
			{ period: '2024-01-14', new: 0, retained: 1, resurrected: 0, dormant: 0 },
		]);
		// Without profiles the unjoined device is its OWN distinct user
		// (identity.js resolveUserId device_id fallback — Mixpanel's
		// unmerged $device: identity): d1 new@0 then dormant@1, u9 new@1.
		const noJoin = emulateBreakdown(events, { type: 'lifecycle', valueMomentEvent: 'Value Moment' });
		expect(noJoin).toEqual([
			{ period: '2024-01-07', new: 1, retained: 0, resurrected: 0, dormant: 0 },
			{ period: '2024-01-14', new: 1, retained: 0, resurrected: 0, dormant: 1 },
		]);
	});
});

describe('lifecycle — guards', () => {
	test('valueMomentEvent is required', () => {
		expect(() => emulateBreakdown([], { type: 'lifecycle' }))
			.toThrow(/valueMomentEvent/);
	});

	test('periodDays must be 7 or 30 (the LCA template variants)', () => {
		expect(() => emulateBreakdown([], { type: 'lifecycle', valueMomentEvent: 'x', periodDays: 14 }))
			.toThrow(/7 or 30/);
	});

	test('empty input and value-moment-free input → empty series', () => {
		expect(emulateBreakdown([], { type: 'lifecycle', valueMomentEvent: 'x' })).toEqual([]);
		expect(emulateBreakdown(
			[{ event: 'other', time: JAN1, user_id: 'u1' }],
			{ type: 'lifecycle', valueMomentEvent: 'x' },
		)).toEqual([]);
	});

	test('does not compose with the generic timeBucket wrapper', () => {
		expect(() => emulateBreakdown([], { type: 'lifecycle', valueMomentEvent: 'x', timeBucket: 'day' }))
			.toThrow(/timeBucket/);
	});
});
