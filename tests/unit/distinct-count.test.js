//@ts-nocheck
/**
 * v1.5.1: COUNT_DISTINCT(property) — Mixpanel Insights aggregator.
 *
 * Covers both the `countDistinctValues` primitive in counting.js and the new
 * `distinctCount` type added to `emulateBreakdown`.
 */

import { describe, test, expect } from 'vitest';
import { countDistinctValues } from '../../lib/verify/counting.js';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const sampleEvents = [
	{ event: 'page_view', utm_campaign: 'spring',   user_id: 'u1' },
	{ event: 'page_view', utm_campaign: 'spring',   user_id: 'u2' },
	{ event: 'page_view', utm_campaign: 'fall',     user_id: 'u3' },
	{ event: 'page_view', utm_campaign: 'winter',   user_id: 'u4' },
	{ event: 'page_view', utm_campaign: 'spring',   user_id: 'u5' },
	{ event: 'page_view', utm_campaign: null,       user_id: 'u6' },
	{ event: 'page_view', utm_campaign: undefined,  user_id: 'u7' },
	{ event: 'page_view',                           user_id: 'u8' },
	{ event: 'page_view', utm_campaign: '',         user_id: 'u9' },
	{ event: 'sign_up',   utm_campaign: 'summer',   user_id: 'u10' },
	{ event: 'sign_up',   utm_campaign: 'spring',   user_id: 'u11' },
];

describe('v1.5.1 countDistinctValues', () => {
	test('counts distinct non-null values across all events by default', () => {
		const { distinct_count, top_values } = countDistinctValues(sampleEvents, 'utm_campaign');
		expect(distinct_count).toBe(4); // spring, fall, winter, summer
		// Top-by-frequency: spring (4), fall (1), winter (1), summer (1).
		expect(top_values[0]).toEqual({ value: 'spring', count: 4 });
	});

	test('filters by event name', () => {
		const { distinct_count, top_values } = countDistinctValues(sampleEvents, 'utm_campaign', { event: 'page_view' });
		expect(distinct_count).toBe(3); // spring, fall, winter (summer is sign_up)
		const spring = top_values.find(v => v.value === 'spring');
		expect(spring.count).toBe(3);
	});

	test('respects topN cap', () => {
		const { distinct_count, top_values } = countDistinctValues(sampleEvents, 'utm_campaign', { topN: 2 });
		expect(distinct_count).toBe(4);
		expect(top_values.length).toBe(2);
	});

	test('default topN is 25', () => {
		const events = Array.from({ length: 30 }, (_, i) => ({ event: 'x', tag: `tag_${i}` }));
		const { distinct_count, top_values } = countDistinctValues(events, 'tag');
		expect(distinct_count).toBe(30);
		expect(top_values.length).toBe(25);
	});

	test('throws on missing property', () => {
		expect(() => countDistinctValues(sampleEvents, '')).toThrow(/property is required/);
	});

	test('returns 0 distinct_count when property never appears', () => {
		const { distinct_count, top_values } = countDistinctValues(sampleEvents, 'nonexistent');
		expect(distinct_count).toBe(0);
		expect(top_values.length).toBe(0);
	});

	test('handles non-array gracefully', () => {
		expect(() => countDistinctValues(null, 'utm_campaign')).toThrow(/array/);
	});
});

describe('v1.5.1 emulateBreakdown(type: distinctCount)', () => {
	test('returns a single row with distinct_count + top_values', () => {
		const rows = emulateBreakdown(sampleEvents, {
			type: 'distinctCount',
			property: 'utm_campaign',
		});
		expect(rows.length).toBe(1);
		expect(rows[0].distinct_count).toBe(4);
		expect(Array.isArray(rows[0].top_values)).toBe(true);
	});

	test('event filter routes to scoped distinct count', () => {
		const rows = emulateBreakdown(sampleEvents, {
			type: 'distinctCount',
			property: 'utm_campaign',
			event: 'sign_up',
		});
		expect(rows[0].distinct_count).toBe(2); // summer, spring
	});

	test('topN passes through', () => {
		const rows = emulateBreakdown(sampleEvents, {
			type: 'distinctCount',
			property: 'utm_campaign',
			topN: 1,
		});
		expect(rows[0].top_values.length).toBe(1);
		expect(rows[0].top_values[0].value).toBe('spring');
	});

	test('throws when property missing', () => {
		expect(() => emulateBreakdown(sampleEvents, { type: 'distinctCount' }))
			.toThrow(/property/);
	});

	test('integrates with timeBucket wrapper', () => {
		const dayMs = 86_400_000;
		const t0 = 1_706_832_000_000; // 2024-02-02 UTC
		const events = [
			{ event: 'page_view', utm_campaign: 'spring', time: t0, user_id: 'u1' },
			{ event: 'page_view', utm_campaign: 'fall',   time: t0, user_id: 'u2' },
			{ event: 'page_view', utm_campaign: 'spring', time: t0 + dayMs, user_id: 'u3' },
		];
		const rows = emulateBreakdown(events, {
			type: 'distinctCount',
			property: 'utm_campaign',
			timeBucket: 'day',
		});
		// 2 day buckets (one with spring+fall, one with spring only).
		expect(rows.length).toBe(2);
		expect(rows[0].period).toBeDefined();
		expect(rows[0].distinct_count).toBeGreaterThan(0);
	});
});
