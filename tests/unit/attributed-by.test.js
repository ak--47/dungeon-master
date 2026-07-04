//@ts-nocheck
/**
 * P1.11 unit tests: attributedBy perConversion — multi-conversion attribution.
 *
 * Every expected value is hand-computed from the ARB rules — NOT derived
 * from running the implementation:
 *   - attribution runs once PER conversion event: attributed_value_reader_read
 *     takes a single event_time_ms per read
 *     (backend/libquery/properties_over_time/attributed_value_reader.cpp)
 *   - FIRST/LAST models have NO touchpoint cap: they execute hard-LIMIT-1
 *     statements (whoval/read.cpp:173-192 first_stmt_). TOUCHPOINTS_LIMIT=10
 *     is consumed only by sorted_list_stmt_ (LIMIT ?4, read.cpp:595) for
 *     multi-touch list models the emulator doesn't implement.
 *   - default perConversion: 'first' preserves the v1.5 one-conversion-per-user
 *     behavior (documented back-compat, not ARB semantics)
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const T = Date.UTC(2024, 0, 15, 10, 0); // 2024-01-15T10:00:00Z
const MIN = 60_000;
const touch = (tMs, src, uid = 'u1') => ({ event: 'Ad Click', time: tMs, user_id: uid, utm_source: src });
const buy = (tMs, uid = 'u1') => ({ event: 'Buy', time: tMs, user_id: uid });

const CFG = {
	type: 'attributedBy',
	conversionEvent: 'Buy',
	attributionEvent: 'Ad Click',
	attributionProperty: 'utm_source',
};

describe('attributedBy — perConversion', () => {
	// Shared fixture: google touch, convert, facebook touch, convert.
	const twoConversions = [
		touch(T, 'google'),
		buy(T + 1 * MIN),
		touch(T + 2 * MIN, 'facebook'),
		buy(T + 3 * MIN),
	];

	test("default 'first': only the user's first conversion is evaluated (v1.5 behavior)", () => {
		expect(emulateBreakdown(twoConversions, { ...CFG, model: 'firstTouch' })).toEqual([
			{ attribution_value: 'google', conversions: 1 },
		]);
	});

	test("'all' + firstTouch: every conversion attributes; both lookbacks start at google", () => {
		// conversion@+1min sees [google] → google. conversion@+3min sees
		// [google, facebook] → first = google. Total google: 2.
		expect(emulateBreakdown(twoConversions, { ...CFG, model: 'firstTouch', perConversion: 'all' })).toEqual([
			{ attribution_value: 'google', conversions: 2 },
		]);
	});

	test("'all' + lastTouch: each conversion credits its own most recent touch", () => {
		// conversion@+1min → google; conversion@+3min → facebook. Tie at 1
		// conversion each — stable sort keeps Map insertion order (google
		// credited first).
		expect(emulateBreakdown(twoConversions, { ...CFG, model: 'lastTouch', perConversion: 'all' })).toEqual([
			{ attribution_value: 'google', conversions: 1 },
			{ attribution_value: 'facebook', conversions: 1 },
		]);
	});

	test("'all' + firstTouch: NO 10-touch cap — >10 prior touches still attribute the globally first (whoval/read.cpp:173-192 LIMIT 1)", () => {
		// 12 touches src0..src11, then c1; a 13th touch src12, then c2.
		// FIRST runs `ORDER BY timestamp_ms ASC LIMIT 1` over the whole
		// lookback — TOUCHPOINTS_LIMIT never binds (only sorted_list_stmt_'s
		// LIMIT ?4 consumes it, and that serves multi-touch list models).
		// c1: firstTouch over src0..src11 = src0.
		// c2: firstTouch over src0..src12 = src0. Total src0: 2.
		const events = [];
		for (let i = 0; i < 12; i++) events.push(touch(T + i * MIN, `src${i}`));
		events.push(buy(T + 12 * MIN));
		events.push(touch(T + 13 * MIN, 'src12'));
		events.push(buy(T + 14 * MIN));
		expect(emulateBreakdown(events, { ...CFG, model: 'firstTouch', perConversion: 'all' })).toEqual([
			{ attribution_value: 'src0', conversions: 2 },
		]);
	});

	test("'all' + lastTouch: >10 prior touches attribute the most recent (get_last_value, whoval/read.cpp:650-655)", () => {
		// Same 12-touch fixture, one conversion: lastTouch = src11.
		const events = [];
		for (let i = 0; i < 12; i++) events.push(touch(T + i * MIN, `src${i}`));
		events.push(buy(T + 12 * MIN));
		expect(emulateBreakdown(events, { ...CFG, model: 'lastTouch', perConversion: 'all' })).toEqual([
			{ attribution_value: 'src11', conversions: 1 },
		]);
	});

	test("'all': a conversion with zero prior touches contributes nothing; same-ms touch is included", () => {
		// u1: Buy BEFORE any touch (skipped), then google touch, then Buy →
		// google 1. u2: touch and Buy at the SAME ms — lookback is
		// time <= conversionTime, inclusive → bing 1.
		const events = [
			buy(T, 'u1'),
			touch(T + 1 * MIN, 'google', 'u1'),
			buy(T + 2 * MIN, 'u1'),
			touch(T + 5 * MIN, 'bing', 'u2'),
			buy(T + 5 * MIN, 'u2'),
		];
		expect(emulateBreakdown(events, { ...CFG, model: 'firstTouch', perConversion: 'all' })).toEqual([
			{ attribution_value: 'google', conversions: 1 },
			{ attribution_value: 'bing', conversions: 1 },
		]);
	});

	test('unknown perConversion throws', () => {
		expect(() => emulateBreakdown([], { ...CFG, perConversion: 'every' }))
			.toThrow(/perConversion/);
	});
});
