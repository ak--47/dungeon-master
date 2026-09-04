//@ts-nocheck
/**
 * v1.7.0 — the DM4 engine requests, measured on real generation passes.
 * Each block pins the number the CHANGELOG cites (small scale, wide bands).
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const DAY = 86_400_000;
const BASE = {
	numUsers: 250,
	numDays: 60,
	avgEventsPerUserPerDay: 3,
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	datasetStart: '2026-06-01',
	datasetEnd: '2026-07-30',
	events: [
		{ event: 'Signed Up', weight: 2, isFirstEvent: true, properties: {} },
		{ event: 'Viewed Item', weight: 8, properties: {} },
		{ event: 'Purchased', weight: 3, properties: {} },
		{ event: 'Searched', weight: 5, properties: {} },
	],
	funnels: [{ name: 'Buy', sequence: ['Viewed Item', 'Purchased'], conversionRate: 40, timeToConvert: 4 }],
	userProps: { plan: ['free', 'free', 'pro'] },
	superProps: {},
};
const run = (seed, extra) => DUNGEON_MASTER({ ...BASE, ...extra, seed });
const byUser = (events) => {
	const m = new Map();
	for (const e of events) { if (!m.has(e.user_id)) m.set(e.user_id, []); m.get(e.user_id).push(e); }
	return m;
};

describe.sequential('P0-1 conditions split one funnel by segment', () => {
	test('iOS 80 vs Android 40 on the same-named funnel, operators included', async () => {
		const r = await run('v170-cond', {
			userProps: { platform: ['iOS', 'Android'], seats: [1, 5, 10, 20] },
			funnels: [
				{ name: 'Checkout', sequence: ['Viewed Item', 'Purchased'], conditions: { platform: 'iOS', seats: { gte: 1 } }, conversionRate: 80, timeToConvert: 1 },
				{ name: 'Checkout', sequence: ['Viewed Item', 'Purchased'], conditions: { platform: { in: ['Android'] } }, conversionRate: 40, timeToConvert: 1 },
			],
		});
		const conv = (plat) => {
			const ids = new Set(r.userProfilesData.filter(u => u.platform === plat).map(u => u.distinct_id));
			let v = 0, p = 0;
			for (const e of r.eventData) { if (!ids.has(e.user_id)) continue; if (e.event === 'Viewed Item') v++; if (e.event === 'Purchased') p++; }
			return p / v;
		};
		expect(conv('iOS')).toBeGreaterThan(0.72);
		expect(conv('Android')).toBeLessThan(0.48);
		expect(r.warnings.find(w => w.key === 'funnels.conditions')).toBeUndefined();
	});

	test('users matching no funnel are reported once per run', async () => {
		const r = await run('v170-nomatch', {
			userProps: { platform: ['iOS', 'Android'] },
			funnels: [{ name: 'Only iOS', sequence: ['Viewed Item', 'Purchased'], conditions: { platform: 'iOS' }, conversionRate: 50, timeToConvert: 1 }],
		});
		const w = r.warnings.find(x => x.key === 'funnels.conditions');
		expect(w).toBeDefined();
		expect(w.count).toBeGreaterThan(0);
		expect(w.applied + w.count).toBe(w.requested);
	});
});

describe.sequential('P0-2 experiment variant on the profile', () => {
	test('every exposed user carries Experiment: <name> equal to the exposure event variant', async () => {
		const r = await run('v170-exp', {
			funnels: [{ name: 'Buy', sequence: ['Viewed Item', 'Purchased'], conversionRate: 40, timeToConvert: 4, experiment: true }],
		});
		const key = 'Experiment: Buy Experiment';
		const profiles = new Map(r.userProfilesData.map(u => [u.distinct_id, u]));
		let checked = 0;
		for (const e of r.eventData) {
			if (e.event !== '$experiment_started') continue;
			checked++;
			expect(profiles.get(e.user_id)[key]).toBe(e['Variant name']);
		}
		expect(checked).toBeGreaterThan(100);
		const exposed = new Set(r.eventData.filter(e => e.event === '$experiment_started').map(e => e.user_id));
		for (const u of r.userProfilesData) {
			if (!exposed.has(u.distinct_id)) expect(u[key]).toBeUndefined();
		}
	});

	test('stampProfile: false and sticky: false do not stamp', async () => {
		const a = await run('v170-exp-off', { funnels: [{ name: 'Buy', sequence: ['Viewed Item', 'Purchased'], experiment: { stampProfile: false } }] });
		expect(a.userProfilesData.some(u => Object.keys(u).some(k => k.startsWith('Experiment:')))).toBe(false);
		const b = await run('v170-exp-nosticky', { funnels: [{ name: 'Buy', sequence: ['Viewed Item', 'Purchased'], experiment: { sticky: false } }] });
		expect(b.userProfilesData.some(u => Object.keys(u).some(k => k.startsWith('Experiment:')))).toBe(false);
	});
});

describe.sequential('P1-1 value context', () => {
	test('profile and event values correlate through ctx', async () => {
		const r = await run('v170-ctx', {
			userProps: { plan: ['free', 'pro'], revenue: (ctx) => (ctx.profile.plan === 'pro' ? 100 : 10) },
			superProps: { plan_on_event: (ctx) => ctx.profile.plan, hour: (ctx) => new Date(ctx.time).getUTCHours() },
		});
		for (const u of r.userProfilesData) expect(u.revenue).toBe(u.plan === 'pro' ? 100 : 10);
		const profiles = new Map(r.userProfilesData.map(u => [u.distinct_id, u.plan]));
		for (const e of r.eventData.slice(0, 2000)) {
			expect(e.plan_on_event).toBe(profiles.get(e.user_id));
			expect(e.hour).toBe(new Date(e.time).getUTCHours());
		}
	});

	test('same seed → identical output with a ctx-using dungeon', async () => {
		const cfg = { userProps: { plan: ['free', 'pro'], revenue: (ctx) => (ctx.profile.plan === 'pro' ? 100 : 10) } };
		const a = await run('v170-ctx-det', cfg);
		const b = await run('v170-ctx-det', cfg);
		const strip = (evs) => evs.map(({ insert_id, ...e }) => e);
		expect(strip(a.eventData)).toEqual(strip(b.eventData));
		// plain copies: the storage containers are HookedArrays with run-specific bookkeeping props
		expect([...a.userProfilesData]).toEqual([...b.userProfilesData]);
	});
});

describe.sequential('P1-2 stickyEventProps + stable location', () => {
	test('sticky props equal the profile on every event; hasLocation is one city per user', async () => {
		const r = await run('v170-sticky', {
			switches: { hasLocation: true, stickyEventProps: ['plan', 'app_version'] },
			superProps: { app_version: ['1.0', '1.1', '1.2', '2.0'] },
		});
		const profiles = new Map(r.userProfilesData.map(u => [u.distinct_id, u]));
		const versionsPerUser = new Map();
		const citiesPerUser = new Map();
		for (const e of r.eventData) {
			const p = profiles.get(e.user_id);
			expect(e.plan).toBe(p.plan);
			expect(e.city).toBe(p.city);
			if (!versionsPerUser.has(e.user_id)) versionsPerUser.set(e.user_id, new Set());
			versionsPerUser.get(e.user_id).add(e.app_version);
			if (!citiesPerUser.has(e.user_id)) citiesPerUser.set(e.user_id, new Set());
			citiesPerUser.get(e.user_id).add(e.city);
		}
		for (const s of versionsPerUser.values()) expect(s.size).toBe(1);
		for (const s of citiesPerUser.values()) expect(s.size).toBe(1);
		// still a distribution across users
		expect(new Set([...versionsPerUser.values()].map(s => [...s][0])).size).toBeGreaterThan(1);
	});
});

describe.sequential('P1-3 ttcModifier', () => {
	test('fast persona converts in a quarter of the time', async () => {
		const r = await run('v170-ttc', {
			personas: [{ name: 'fast', weight: 50, ttcModifier: 0.25 }, { name: 'slow', weight: 50, ttcModifier: 1 }],
		});
		const persona = new Map(r.userProfilesData.map(u => [u.distinct_id, u._persona]));
		const ttc = { fast: [], slow: [] };
		for (const [uid, evs] of byUser(r.eventData)) {
			evs.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
			let last = null;
			for (const e of evs) {
				if (e.event === 'Viewed Item') last = Date.parse(e.time);
				else if (e.event === 'Purchased' && last !== null) { ttc[persona.get(uid)].push((Date.parse(e.time) - last) / 3600000); last = null; }
			}
		}
		const median = (a) => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
		expect(median(ttc.fast)).toBeLessThan(median(ttc.slow) * 0.5);
	});
});

describe.sequential('P1-4 campaignPerUser', () => {
	test('one utm_source per user, equal to the profile; persona utm wins over the draw', async () => {
		const r = await run('v170-camp', {
			switches: { hasCampaigns: true, campaignPerUser: true },
			personas: [
				{ name: 'paid', weight: 50, properties: { utm_source: 'google', utm_medium: 'cpc' } },
				{ name: 'organic-ish', weight: 50 },
			],
		});
		const profiles = new Map(r.userProfilesData.map(u => [u.distinct_id, u]));
		const sourcesPerUser = new Map();
		for (const e of r.eventData) {
			if (!e.utm_source) continue;
			expect(e.utm_source).toBe(profiles.get(e.user_id).utm_source);
			if (!sourcesPerUser.has(e.user_id)) sourcesPerUser.set(e.user_id, new Set());
			sourcesPerUser.get(e.user_id).add(e.utm_source);
		}
		expect(sourcesPerUser.size).toBeGreaterThan(100);
		for (const s of sourcesPerUser.values()) expect(s.size).toBe(1);
		for (const u of r.userProfilesData) {
			expect(u.utm_source).toBeDefined();
			if (u._persona === 'paid') { expect(u.utm_source).toBe('google'); expect(u.utm_medium).toBe('cpc'); }
		}
	});
});

describe.sequential('P0-3 volumeMultiplier amplifies', () => {
	test('3x on Viewed Item over a 4-day window lands near 3x with unique insert_ids', async () => {
		const r = await run('v170-spike', {
			worldEvents: [{ name: 'promo', startDay: 20, duration: 4, volumeMultiplier: 3, affectsEvents: ['Viewed Item'] }],
		});
		const start = Date.parse('2026-06-01') + 20 * DAY, end = start + 4 * DAY;
		let inWin = 0, outWin = 0;
		for (const e of r.eventData) {
			if (e.event !== 'Viewed Item') continue;
			const t = Date.parse(e.time);
			if (t >= start && t < end) inWin++; else outWin++;
		}
		const ratio = (inWin / 4) / (outWin / 56);
		expect(ratio).toBeGreaterThan(2.4);
		expect(ratio).toBeLessThan(3.6);
		expect(new Set(r.eventData.map(e => e.insert_id)).size).toBe(r.eventData.length);
		// spread across the window, not stacked: every window day has clones
		const days = new Set(r.eventData.filter(e => e.event === 'Viewed Item' && Date.parse(e.time) >= start && Date.parse(e.time) < end).map(e => Math.floor(Date.parse(e.time) / DAY)));
		expect(days.size).toBe(4);
	});

	test('fractional 1.5x lands between 1.3 and 1.7', async () => {
		const r = await run('v170-spike-frac', {
			worldEvents: [{ name: 'promo', startDay: 10, duration: 10, volumeMultiplier: 1.5 }],
		});
		const start = Date.parse('2026-06-01') + 10 * DAY, end = start + 10 * DAY;
		let inWin = 0, outWin = 0;
		for (const e of r.eventData) { const t = Date.parse(e.time); if (t >= start && t < end) inWin++; else outWin++; }
		const ratio = (inWin / 10) / (outWin / 50);
		expect(ratio).toBeGreaterThan(1.3);
		expect(ratio).toBeLessThan(1.7);
	});
});

describe.sequential('R2-3 strictEventCount is exact', () => {
	test('lands on numEvents exactly with headroom; reports the shortfall without it', async () => {
		const { avgEventsPerUserPerDay, ...noRate } = BASE;
		const exact = await DUNGEON_MASTER({ ...noRate, numEvents: 3000, strictEventCount: true, seed: 'v170-strict' });
		expect(exact.eventData.length).toBe(3000);
		expect(exact.eventCount).toBe(3000);
		expect(exact.warnings.find(w => w.key === 'numEvents')).toBeUndefined();

		// Capacity bounded by a churn event that ends every user early → the target is unreachable.
		const short = await DUNGEON_MASTER({
			...noRate, numEvents: 20_000, strictEventCount: true, seed: 'v170-strict-short',
			events: [...BASE.events, { event: 'Churned', weight: 4, properties: {}, isChurnEvent: true }],
		});
		expect(short.eventData.length).toBeLessThan(20_000);
		expect(short.warnings.find(w => w.key === 'numEvents')).toMatchObject({ requested: 20_000, applied: short.eventData.length });
	});
});

describe.sequential('P2-2 result.warnings', () => {
	test('always present; carries validator clamps with verbose: false', async () => {
		const r = await run('v170-warn', { macro: 'growth', percentUsersBornInDataset: 80 });
		expect(Array.isArray(r.warnings)).toBe(true);
		expect(r.warnings).toContainEqual(expect.objectContaining({ key: 'percentUsersBornInDataset', requested: 80, applied: 30, severity: 'clamp' }));
		const clean = await run('v170-warn-clean', {});
		expect(clean.warnings).toEqual([]);
	});

	test('P2-4: conversionRate saturation from a persona modifier is reported once per funnel', async () => {
		const r = await run('v170-sat', {
			funnels: [{ name: 'Buy', sequence: ['Viewed Item', 'Purchased'], conversionRate: 65, timeToConvert: 1 }],
			personas: [{ name: 'whale', weight: 100, conversionModifier: 3 }],
		});
		const sat = r.warnings.filter(w => w.key.startsWith('funnels[Buy].conversionRate'));
		expect(sat).toHaveLength(1);
		expect(sat[0]).toMatchObject({ requested: 195, applied: 100, severity: 'clamp' });
		expect(sat[0].count).toBeGreaterThan(1);
	});
});

describe.sequential('P1-5 eventMultiplier and churn', () => {
	test('a 3x persona runs ~3x the funnel passes when every event is a funnel step', async () => {
		const r = await run('v170-mult', {
			events: [
				{ event: 'Signed Up', weight: 2, isFirstEvent: true, properties: {} },
				{ event: 'Viewed Item', weight: 8, properties: {} },
				{ event: 'Purchased', weight: 3, properties: {} },
			],
			personas: [{ name: 'power', weight: 50, eventMultiplier: 3 }, { name: 'casual', weight: 50, eventMultiplier: 1 }],
		});
		const counts = new Map();
		for (const e of r.eventData) counts.set(e.user_id, (counts.get(e.user_id) || 0) + 1);
		const avg = (name) => { const us = r.userProfilesData.filter(u => u._persona === name); return us.reduce((s, u) => s + (counts.get(u.distinct_id) || 0), 0) / us.length; };
		const ratio = avg('power') / avg('casual');
		expect(ratio).toBeGreaterThan(2.4);
		expect(ratio).toBeLessThan(3.6);
		expect(r.warnings.find(w => w.key === 'personas.eventMultiplier')).toBeUndefined();
	});

	test('a churn event in the pool washes the multiplier out and the run says so', async () => {
		const r = await run('v170-mult-churn', {
			events: [
				...BASE.events,
				{ event: 'Churned', weight: 1, properties: {}, isChurnEvent: true, returnLikelihood: 0.15 },
			],
			personas: [{ name: 'power', weight: 50, eventMultiplier: 3 }, { name: 'casual', weight: 50, eventMultiplier: 1 }],
		});
		const w = r.warnings.find(x => x.key === 'personas.eventMultiplier');
		expect(w).toBeDefined();
		expect(w.count / BASE.numUsers).toBeGreaterThan(0.5);
	});
});
