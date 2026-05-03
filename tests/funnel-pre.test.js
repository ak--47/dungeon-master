//@ts-nocheck
/**
 * Funnel-pre hook tests: temporal patterns, props, modifier override, cursor advancement.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';
import dayjs from 'dayjs';

const FIXED_NOW = dayjs('2024-02-02').unix();
const baseConfig = (extra) => ({
	datasetStart: FIXED_NOW - 90 * 86400,
	datasetEnd: FIXED_NOW,
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	...extra,
});

describe('funnel-pre hooks', () => {
	test('temporal conversion trend: post-day-45 conversion is higher', async () => {
		const DAY45_UNIX = (FIXED_NOW - 90 * 86400) + 45 * 86400;
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'funnel-pre-temporal',
			numUsers: 400,
			avgEventsPerUserPerDay: 2,
			percentUsersBornInDataset: 100,
			events: [
				{ event: 'View', isFirstEvent: true, isStrictEvent: true },
				{ event: 'Start', isStrictEvent: true },
				{ event: 'Complete', isStrictEvent: true },
				{ event: 'Browse', weight: 3 },
			],
			funnels: [
				{
					sequence: ['View', 'Start', 'Complete'],
					conversionRate: 30,
					isFirstFunnel: true,
					timeToConvert: 2,
				},
				{
					sequence: ['View', 'Start', 'Complete'],
					conversionRate: 30,
					timeToConvert: 2,
					weight: 2,
				},
			],
			hook: function (record, type, meta) {
				if (type !== 'funnel-pre') return;
				if (meta.firstEventTime > DAY45_UNIX) {
					record.conversionRate = 90;
				}
			},
		}));

		const events = Array.from(result.eventData);
		const completeEvents = events.filter(e => e.event === 'Complete');
		const earlyCompletes = completeEvents.filter(e => dayjs(e.time).unix() < DAY45_UNIX);
		const lateCompletes = completeEvents.filter(e => dayjs(e.time).unix() >= DAY45_UNIX);

		expect(lateCompletes.length).toBeGreaterThan(earlyCompletes.length);
	}, 30000);

	test('hook overrides persona conversionModifier', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'funnel-pre-override',
			numUsers: 300,
			avgEventsPerUserPerDay: 2,
			percentUsersBornInDataset: 100,
			personas: [{
				name: 'low-converter',
				weight: 1,
				eventMultiplier: 1,
				conversionModifier: 0.3,
			}],
			events: [
				{ event: 'Land', isFirstEvent: true, isStrictEvent: true },
				{ event: 'Signup', isStrictEvent: true },
				{ event: 'Browse', weight: 3 },
			],
			funnels: [{
				sequence: ['Land', 'Signup'],
				conversionRate: 100,
				isFirstFunnel: true,
				timeToConvert: 1,
			}],
			hook: function (record, type) {
				if (type !== 'funnel-pre') return;
				record.conversionRate = 95;
			},
		}));

		const events = Array.from(result.eventData);
		const signups = events.filter(e => e.event === 'Signup');
		const lands = events.filter(e => e.event === 'Land');
		// Hook forces 95% conversion. Without the hook, persona would cut it to 30%.
		// Conversion = signups / lands should be > 80% (allowing variance)
		expect(signups.length / Math.max(1, lands.length)).toBeGreaterThan(0.8);
	}, 30000);

	test('funnel-pre can modify props per instance', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'funnel-pre-props',
			numUsers: 200,
			avgEventsPerUserPerDay: 2,
			percentUsersBornInDataset: 100,
			userProps: { tier: ['free', 'paid'] },
			events: [
				{ event: 'Start', isFirstEvent: true, isStrictEvent: true },
				{ event: 'Finish', isStrictEvent: true, properties: { plan_type: ['basic'] } },
				{ event: 'Browse', weight: 3 },
			],
			funnels: [{
				sequence: ['Start', 'Finish'],
				conversionRate: 100,
				isFirstFunnel: true,
				timeToConvert: 1,
				props: { plan_type: ['basic'] },
			}],
			hook: function (record, type, meta) {
				if (type !== 'funnel-pre') return;
				if (meta.profile && meta.profile.tier === 'paid') {
					record.props = { ...record.props, plan_type: ['premium'] };
				}
			},
		}));

		const events = Array.from(result.eventData);
		const profiles = Array.from(result.userProfilesData);
		const paidUsers = new Set(profiles.filter(p => p.tier === 'paid').map(p => p.distinct_id));
		const finishEvents = events.filter(e => e.event === 'Finish');
		const paidFinish = finishEvents.filter(e => paidUsers.has(e.user_id));
		const freeFinish = finishEvents.filter(e => !paidUsers.has(e.user_id));

		// Paid users should have plan_type = 'premium' from the hook
		const paidPremium = paidFinish.filter(e => e.plan_type === 'premium').length;
		const freePremium = freeFinish.filter(e => e.plan_type === 'premium').length;
		expect(paidPremium).toBeGreaterThan(0);
		expect(freePremium).toBe(0);
	}, 30000);

	test('usage funnel cursor advances: firstEventTime spreads across the dataset', async () => {
		const runTimesByUser = new Map();
		const DATASET_START = FIXED_NOW - 90 * 86400;
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'funnel-pre-cursor',
			numUsers: 30,
			avgEventsPerUserPerDay: 3,
			numDays: 90,
			percentUsersBornInDataset: 100,
			events: [
				{ event: 'Step1', isFirstEvent: true, isStrictEvent: true },
				{ event: 'Step2', isStrictEvent: true },
				{ event: 'Browse', weight: 5 },
			],
			funnels: [
				{
					sequence: ['Step1', 'Step2'],
					conversionRate: 100,
					isFirstFunnel: true,
					timeToConvert: 2,
				},
				{
					sequence: ['Step1', 'Step2'],
					conversionRate: 100,
					timeToConvert: 2,
					weight: 2,
				},
			],
			hook: function (record, type, meta) {
				if (type !== 'funnel-pre' || meta.isFirstFunnel) return;
				const uid = meta.user.distinct_id;
				if (!runTimesByUser.has(uid)) runTimesByUser.set(uid, []);
				runTimesByUser.get(uid).push(meta.firstEventTime);
			},
		}));

		// Verify firstEventTime spreads across the dataset window (not all at birth time)
		let usersWithSpread = 0;
		let totalUsersWithMultiple = 0;
		for (const [, times] of runTimesByUser) {
			if (times.length < 3) continue;
			totalUsersWithMultiple++;
			const minT = Math.min(...times);
			const maxT = Math.max(...times);
			const span = maxT - minT;
			// Should span at least 7 days of the 90-day window
			if (span > 7 * 86400) usersWithSpread++;
		}

		expect(totalUsersWithMultiple).toBeGreaterThan(0);
		expect(usersWithSpread / totalUsersWithMultiple).toBeGreaterThan(0.5);
	}, 30000);
});
