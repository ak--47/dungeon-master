//@ts-nocheck
/**
 * 1.9.0: emitted hour-of-day and day-of-week shapes track `soup` weights.
 *
 * Before 1.9.0, legacy mode spread the catch-all funnel's steps linearly over
 * 24 hours after step 0, so standalone events lost the hour shape (configured
 * peak/trough 3.6x, emitted 1.27x). Active-day modes applied the day-of-week
 * weights twice (day picks and per-day event allocation): configured 2.5x,
 * emitted ~5.3x.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const HW = [0.95, 0.95, 0.9, 0.8, 0.65, 0.5, 0.38, 0.3, 0.28, 0.3, 0.36, 0.42,
	0.5, 0.56, 0.62, 0.68, 0.74, 0.82, 0.9, 0.95, 1.0, 1.0, 0.98, 0.96];
const DW = [1.0, 0.5, 0.4, 0.4, 0.45, 0.7, 0.95];
const HOUR_RATIO = Math.max(...HW) / Math.min(...HW);
const DOW_RATIO = Math.max(...DW) / Math.min(...DW);

const corr = (a, b) => {
	const ma = a.reduce((x, y) => x + y) / a.length;
	const mb = b.reduce((x, y) => x + y) / b.length;
	let n = 0, da = 0, db = 0;
	for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
	return n / Math.sqrt(da * db);
};

const run = (extra) => DUNGEON_MASTER({
	seed: 'soup-shape',
	numUsers: 600,
	avgEventsPerUserPerDay: 2,
	datasetStart: '2026-04-02T00:00:00Z',
	datasetEnd: '2026-06-30T23:59:59Z',
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	percentUsersBornInDataset: 30,
	macro: 'flat',
	soup: { hourOfDayWeights: HW, dayOfWeekWeights: DW },
	events: [
		{ event: 'signup', isFirstEvent: true },
		{ event: 'f1' }, { event: 'f2' }, { event: 'f3' },
		{ event: 'sa', weight: 4 }, { event: 'sb', weight: 3 }, { event: 'sc', weight: 2 },
	],
	funnels: [
		{ sequence: ['signup'], isFirstFunnel: true, conversionRate: 100 },
		{ sequence: ['f1', 'f2', 'f3'], conversionRate: 60, timeToConvert: 2, weight: 2 },
	],
	...extra,
});

function shape(result, filter) {
	const hours = new Array(24).fill(0);
	const days = new Array(7).fill(0);
	for (const e of result.eventData) {
		if (!filter(e)) continue;
		const t = new Date(e.time);
		hours[t.getUTCHours()]++;
		days[t.getUTCDay()]++;
	}
	return { hours, days };
}

const standalone = (e) => e.event === 'sa' || e.event === 'sb' || e.event === 'sc';
const funnel = (e) => e.event[0] === 'f';
const MODES = {
	legacy: {},
	activeDays: { avgActiveDaysPerUser: 20 },
	retentionCurve: { retentionCurve: { day1: 0.6, day7: 0.4, day30: 0.3 } },
};

describe.sequential('soup shape', () => {
	for (const [mode, extra] of Object.entries(MODES)) {
		test(`${mode}: standalone hour and weekday shapes track the weights`, async () => {
			const { hours, days } = shape(await run(extra), standalone);
			const hourRatio = Math.max(...hours) / Math.min(...hours);
			const dowRatio = Math.max(...days) / Math.min(...days);
			expect(corr(hours, HW)).toBeGreaterThan(0.95);
			expect(hourRatio).toBeGreaterThan(HOUR_RATIO * 0.75);
			expect(hourRatio).toBeLessThan(HOUR_RATIO * 1.25);
			expect(corr(days, DW)).toBeGreaterThan(0.95);
			expect(dowRatio).toBeGreaterThan(DOW_RATIO * 0.75);
			expect(dowRatio).toBeLessThan(DOW_RATIO * 1.25);
		}, 60000);

		test(`${mode}: funnel-step weekday shape tracks the weights`, async () => {
			const { hours, days } = shape(await run(extra), funnel);
			const dowRatio = Math.max(...days) / Math.min(...days);
			expect(corr(hours, HW)).toBeGreaterThan(0.95);
			expect(corr(days, DW)).toBeGreaterThan(0.95);
			expect(dowRatio).toBeGreaterThan(DOW_RATIO * 0.75);
			expect(dowRatio).toBeLessThan(DOW_RATIO * 1.25);
		}, 60000);
	}
	// Without `soup` config the default weekday curve (Sat 0.53 of Tue) applies in
	// every mode. The active-day plan only read explicit weights, so active-day
	// modes had no weekly rhythm with the default soup (1.11x against 1.89x).
	const DEFAULT_DOW = [0.637, 1.0, 0.999, 0.998, 0.966, 0.802, 0.528];
	for (const [mode, extra] of Object.entries(MODES)) {
		test(`${mode}: the default weekday curve applies without soup config`, async () => {
			const { days } = shape(await run({ ...extra, soup: undefined }), (e) => e.event !== 'signup');
			const ratio = Math.max(...days) / Math.min(...days);
			const defaultRatio = Math.max(...DEFAULT_DOW) / Math.min(...DEFAULT_DOW);
			expect(corr(days, DEFAULT_DOW)).toBeGreaterThan(0.9);
			expect(ratio).toBeGreaterThan(defaultRatio * 0.75);
			expect(ratio).toBeLessThan(defaultRatio * 1.25);
		}, 60000);
	}
});
