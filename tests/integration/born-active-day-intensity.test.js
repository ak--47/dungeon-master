//@ts-nocheck
/**
 * 1.9.0: a born user on an active day behaves like an established user on an
 * active day. The active-day modes change how many days a user is active, not
 * how many events an active day holds.
 *
 * - `avgActiveDaysPerUser`: born users' active-day mean scales with the share of
 *   the window they are alive for, so the per-active-day rate is
 *   `(avgEventsPerUserPerDay x numDays) / avgActiveDaysPerUser` for every user.
 *   Before, born users kept the full mean on a pro-rated budget (~0.6x).
 * - `retentionCurve`: born users' active days follow the curve over their
 *   lifetime, and their budget is the established per-active-day rate times
 *   that expected day count. Before, the budget was pro-rated by lifetime
 *   (~0.85x per active day for a decaying curve).
 * - Legacy mode already matched; it is covered as a guard.
 *
 * The birth day is excluded: it is a partial day (the user signs up at a soup
 * time of day), so it holds fewer events in every mode by design.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const START = '2026-01-01T00:00:00.000Z';
const END = '2026-03-01T23:59:59.999Z';

const cfg = (extra) => ({
	seed: 'born-active-day-intensity',
	datasetStart: START,
	datasetEnd: END,
	numUsers: 300,
	avgEventsPerUserPerDay: 4,
	percentUsersBornInDataset: 50,
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	events: [
		{ event: 'sign up', isFirstEvent: true },
		{ event: 'app open', weight: 5 },
		{ event: 'post view', weight: 10 },
		{ event: 'post like', weight: 3 },
		{ event: 'post shared', weight: 1 },
		{ event: 'settings', weight: 2 },
	],
	funnels: [
		{ sequence: ['sign up'], isFirstFunnel: true, conversionRate: 100, timeToConvert: 1 },
		{ sequence: ['app open', 'post view', 'post view', 'post like'], weight: 5, conversionRate: 70, timeToConvert: 1 },
		{ sequence: ['app open', 'post view', 'post view', 'post view', 'post view'], weight: 2, conversionRate: 60, timeToConvert: 2 },
	],
	...extra,
});

function perActiveDay(result) {
	const begin = Date.parse(START);
	const birthDay = new Map(Array.from(result.userProfilesData)
		.filter(p => Date.parse(p.created) >= begin).map(p => [p.distinct_id, p.created.slice(0, 10)]));
	const users = new Map();
	for (const ev of result.eventData) {
		if (!users.has(ev.user_id)) users.set(ev.user_id, []);
		users.get(ev.user_id).push(ev);
	}
	const agg = { born: { days: 0, events: 0, views: 0 }, est: { days: 0, events: 0, views: 0 } };
	for (const [id, evs] of users) {
		const a = agg[birthDay.has(id) ? 'born' : 'est'];
		const kept = evs.filter(e => e.time.slice(0, 10) !== birthDay.get(id));
		a.days += new Set(kept.map(e => e.time.slice(0, 10))).size;
		a.events += kept.length;
		a.views += kept.filter(e => e.event === 'post view').length;
	}
	return {
		events: (agg.born.events / agg.born.days) / (agg.est.events / agg.est.days),
		views: (agg.born.views / agg.born.days) / (agg.est.views / agg.est.days),
	};
}

describe.sequential('born users: events per active day match established users', () => {
	test.each([
		['avgActiveDaysPerUser', { avgActiveDaysPerUser: 15 }],
		['retentionCurve', { retentionCurve: { day1: 0.3, day7: 0.15, day30: 0.08 } }],
		['legacy', {}],
	])('%s', async (_label, extra) => {
		const ratio = perActiveDay(await DUNGEON_MASTER(cfg(extra)));
		expect(ratio.events).toBeGreaterThan(0.9);
		expect(ratio.events).toBeLessThan(1.1);
		expect(ratio.views).toBeGreaterThan(0.9);
		expect(ratio.views).toBeLessThan(1.1);
	}, 60000);
});
