//@ts-nocheck
/**
 * 1.9.0 — a repeated funnel step with requireRepeats: false is optional, but
 * skipping it must not change the chance of reaching later distinct steps.
 * conversionRate is the share of runs that reach the last step.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const EVENTS = ['A', 'B', 'C', 'D', 'E', 'X'].map(e => ({ event: e, ...(e === 'C' ? { isAuthEvent: true } : {}) }));

async function measure(seed, sequence, conversionRate) {
	const runs = { first: { n: 0, auth: 0, last: 0 }, usage: { n: 0, auth: 0, last: 0 } };
	const result = await DUNGEON_MASTER({
		numUsers: 300, numDays: 30, seed, verbose: false, writeToDisk: false, concurrency: 1,
		avgEventsPerUserPerDay: 1, percentUsersBornInDataset: 100, identity: { avgDevicePerUser: 1 },
		events: EVENTS,
		funnels: [
			{ name: 'first', sequence, isFirstFunnel: true, conversionRate, timeToConvert: 0.5 },
			{ name: 'usage', sequence: sequence.map(s => (s === 'C' ? 'X' : s)), conversionRate, timeToConvert: 0.5 },
		],
		hook: (record, type, meta) => {
			if (type !== 'funnel-post' || !runs[meta.funnel.name]) return record;
			const r = runs[meta.funnel.name];
			const names = record.filter(e => !e._drop).map(e => e.event);
			const lastStep = meta.funnel.sequence[meta.funnel.sequence.length - 1];
			r.n++;
			if (names.includes(meta.funnel.name === 'first' ? 'C' : 'X')) r.auth++;
			// Reached the last step: it is the final emitted event, after D.
			if (names.includes('D') && names[names.length - 1] === lastStep) r.last++;
			return record;
		},
	});
	const users = new Set(result.userProfilesData.map(p => p.distinct_id));
	const authed = new Set(result.eventData.filter(e => e.event === 'C').map(e => e.user_id));
	return { runs, users: users.size, authed: authed.size };
}

describe.sequential('repeated funnel steps (requireRepeats: false)', () => {
	test('conversionRate 100 completes every run, with a repeat before the auth step and as the last step', async () => {
		for (const sequence of [['A', 'B', 'B', 'C', 'D', 'B', 'E'], ['A', 'B', 'B', 'C', 'D', 'B']]) {
			const m = await measure('repeats-100', sequence, 100);
			for (const name of ['first', 'usage']) {
				const r = m.runs[name];
				expect(r.n).toBeGreaterThan(250);
				// Allow only the few first-funnel runs clipped at the window end.
				expect(r.auth / r.n, `${sequence.join('>')} ${name} reached step 4`).toBeGreaterThan(0.99);
				expect(r.last / r.n, `${sequence.join('>')} ${name} reached the last step`).toBeGreaterThan(0.99);
			}
			expect(m.authed / m.users).toBeGreaterThan(0.99);
		}
	}, 60000);

	test('a repeated step does not move conversion away from conversionRate', async () => {
		const withRepeats = await measure('repeats-50', ['A', 'B', 'B', 'C', 'D', 'B', 'E'], 50);
		const without = await measure('repeats-50', ['A', 'B', 'C', 'D', 'E'], 50);
		for (const name of ['first', 'usage']) {
			const a = withRepeats.runs[name].last / withRepeats.runs[name].n;
			const b = without.runs[name].last / without.runs[name].n;
			expect(a, `${name} with repeats`).toBeGreaterThan(0.42);
			expect(a, `${name} with repeats`).toBeLessThan(0.58);
			expect(Math.abs(a - b), `${name} repeats vs none`).toBeLessThan(0.08);
		}
	}, 60000);
});
