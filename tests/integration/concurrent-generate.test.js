//@ts-nocheck
/**
 * v1.5.1: concurrent in-process `generate()` calls must not clobber each
 * other's dataset window. Before TODO #2, `setDatasetNow` / `setDatasetBegin`
 * mutated module-scoped `let DATASET_NOW` / `DATASET_BEGIN` — two parallel
 * pipelines would race on the setters and produce events in the wrong window.
 *
 * After TODO #2, each pipeline wraps its body in `runWithDataset(begin, now)`
 * (an AsyncLocalStorage scope). The factory thunks read from the ALS store at
 * event-generation time, so parallel calls each see their own window.
 *
 * NOTE on RNG: the `chance` instance is STILL a module-scoped global (separate
 * concurrency hole, deferred to v1.6). Each pipeline here uses a distinct seed
 * so we don't accidentally test the RNG dimension.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';
import dayjs from 'dayjs';

function pinWindow(extra = {}) {
	return {
		writeToDisk: false,
		verbose: false,
		concurrency: 1,
		numUsers: 50,
		numDays: 30,
		avgEventsPerUserPerDay: 3,
		percentUsersBornInDataset: 60,
		hasAnonIds: true,
		events: [
			{ event: 'visit', isStrictEvent: true },
			{ event: 'sign_up', isAuthEvent: true, isStrictEvent: true },
			{ event: 'browse', weight: 5 },
		],
		funnels: [
			{ sequence: ['visit', 'sign_up'], conversionRate: 80, isFirstFunnel: true, timeToConvert: 1 },
		],
		...extra,
	};
}

describe('v1.5.1 concurrent generate — no cross-window contamination', () => {
	test('two parallel generate() calls with DIFFERENT windows keep their events in-window', async () => {
		const aNow = dayjs('2024-02-02').unix();
		const aBegin = aNow - 30 * 86400;
		const bNow = dayjs('2023-06-15').unix();
		const bBegin = bNow - 30 * 86400;

		const [a, b] = await Promise.all([
			DUNGEON_MASTER(pinWindow({
				seed: 'concurrent-a',
				datasetStart: aBegin,
				datasetEnd: aNow,
			})),
			DUNGEON_MASTER(pinWindow({
				seed: 'concurrent-b',
				datasetStart: bBegin,
				datasetEnd: bNow,
			})),
		]);

		const aEvents = Array.from(a.eventData);
		const bEvents = Array.from(b.eventData);

		expect(aEvents.length).toBeGreaterThan(0);
		expect(bEvents.length).toBeGreaterThan(0);

		// Each pipeline's events fall within its OWN window (no cross-contamination).
		// 1-day slack on both ends to absorb noise() offsets and tz edge effects.
		const slack = 86400;
		for (const e of aEvents) {
			const t = Date.parse(e.time) / 1000;
			expect(t).toBeGreaterThanOrEqual(aBegin - slack);
			expect(t).toBeLessThanOrEqual(aNow + slack);
		}
		for (const e of bEvents) {
			const t = Date.parse(e.time) / 1000;
			expect(t).toBeGreaterThanOrEqual(bBegin - slack);
			expect(t).toBeLessThanOrEqual(bNow + slack);
		}

		// No event from pipeline B should land in pipeline A's window when the
		// two windows are disjoint. Quick sanity sanity check on a few events.
		// (Comprehensive check below — these date windows are well-separated.)
		for (const e of bEvents.slice(0, 100)) {
			const t = Date.parse(e.time) / 1000;
			expect(t).toBeLessThan(aBegin);
		}
	});

	test('four parallel generate() calls maintain isolation', async () => {
		const windows = [
			{ name: 'W1', now: dayjs('2024-02-02').unix() },
			{ name: 'W2', now: dayjs('2023-08-01').unix() },
			{ name: 'W3', now: dayjs('2023-03-15').unix() },
			{ name: 'W4', now: dayjs('2022-11-30').unix() },
		];
		const results = await Promise.all(windows.map((w, i) =>
			DUNGEON_MASTER(pinWindow({
				seed: `concurrent-${w.name}`,
				datasetStart: w.now - 30 * 86400,
				datasetEnd: w.now,
			}))
		));

		for (let i = 0; i < windows.length; i++) {
			const w = windows[i];
			const events = Array.from(results[i].eventData);
			expect(events.length).toBeGreaterThan(0);
			const slack = 86400;
			for (const e of events.slice(0, 50)) {
				const t = Date.parse(e.time) / 1000;
				expect(t).toBeGreaterThanOrEqual(w.now - 30 * 86400 - slack);
				expect(t).toBeLessThanOrEqual(w.now + slack);
			}
		}
	});
});
