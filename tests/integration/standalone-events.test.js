//@ts-nocheck
/**
 * Integration tests for `standaloneEvents` (v1.8.0).
 *
 * One generation pass per test, in memory, small scale. Covers the properties
 * that make a standalone event different from a normal event: no identity keys,
 * cadence-driven cardinality, dimension cross-product, the `standalone` hook,
 * and the fact that the stream never leaks into `eventData`.
 */
import { describe, test, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);
import generate from '../../index.js';

// Pinned window — cadence math must not depend on when CI runs.
const WINDOW = {
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-09-30T00:00:00Z', // 29 full days => 30 daily ticks
};

/** Baseline config with every default-property switch off. */
function baseConfig(overrides = {}) {
	return {
		seed: 'standalone-integration',
		numUsers: 20,
		numEvents: 400,
		writeToDisk: false,
		verbose: false,
		concurrency: 1,
		...WINDOW,
		switches: {
			hasLocation: false, hasBrowser: false, hasSessionIds: false,
			hasCampaigns: false, hasAdSpend: false, hasIOSDevices: false,
			hasAndroidDevices: false, hasDesktopDevices: false, hasAvatar: false,
		},
		events: [{ event: 'thing', weight: 1, properties: { foo: ['a', 'b'] } }],
		superProps: { app_ver: ['1.0.0'] },
		userProps: { plan: ['free', 'pro'] },
		...overrides,
	};
}

describe('standaloneEvents — record shape', () => {
	test('records carry no user_id and no device_id', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{
				event: 'cdn_egress',
				cadence: 'day',
				dimensions: { region: ['us-east', 'eu'] },
				distinctIdFrom: 'region',
				properties: { gb_out: [100, 200], cost_usd: [8.5] },
			}],
		}));

		const records = result.standaloneEventData;
		expect(records.length).toBeGreaterThan(0);
		for (const record of records) {
			expect(record).not.toHaveProperty('user_id');
			expect(record).not.toHaveProperty('device_id');
		}
	});

	test('distinct_id comes from the named dimension', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{
				event: 'cdn_egress',
				dimensions: { region: ['us-east', 'eu'] },
				distinctIdFrom: 'region',
				properties: { gb_out: [100] },
			}],
		}));

		for (const record of result.standaloneEventData) {
			expect(record.distinct_id).toBe(record.region);
		}
		expect(new Set(result.standaloneEventData.map(r => r.distinct_id)))
			.toEqual(new Set(['us-east', 'eu']));
	});

	test('distinct_id falls back to the event name when no dimension is named', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{ event: 'queue_depth', properties: { n: [1, 2, 3] } }],
		}));

		for (const record of result.standaloneEventData) {
			expect(record.distinct_id).toBe('queue_depth');
		}
	});

	test('every record gets a unique insert_id', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{
				event: 'cdn_egress',
				dimensions: { region: ['us-east', 'us-west', 'eu', 'apac'] },
				properties: { gb_out: [100] },
			}],
		}));

		const ids = result.standaloneEventData.map(r => r.insert_id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('dimensions land as flat properties on the record', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{
				event: 'fleet',
				dimensions: { cluster: ['a', 'b'], zone: ['x'] },
				properties: { job_n: [10] },
			}],
		}));

		const record = result.standaloneEventData[0];
		expect(record.cluster).toBeDefined();
		expect(record.zone).toBe('x');
		expect(record.job_n).toBe(10);
		expect(record.properties).toBeUndefined();
	});
});

describe('standaloneEvents — cadence and cardinality', () => {
	test('daily cadence emits one record per day per dimension row', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{
				event: 'cdn_egress',
				cadence: 'day',
				dimensions: { region: ['us-east', 'eu'] },
				properties: { gb_out: [100] },
			}],
		}));

		// 2025-09-01 through 2025-09-30 inclusive = 30 daily ticks, x 2 regions
		expect(result.standaloneEventData).toHaveLength(60);
	});

	test('weekly cadence emits far fewer records than daily', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [
				{ event: 'daily_snap', cadence: 'day', properties: { n: [1] } },
				{ event: 'weekly_snap', cadence: 'week', properties: { n: [1] } },
			],
		}));

		const daily = result.standaloneEventData.filter(r => r.event === 'daily_snap');
		const weekly = result.standaloneEventData.filter(r => r.event === 'weekly_snap');
		expect(daily).toHaveLength(30);
		expect(weekly).toHaveLength(5); // days 0, 7, 14, 21, 28
	});

	test('multiple streams coexist in one container', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [
				{ event: 'cdn_egress', dimensions: { region: ['us', 'eu'] }, properties: { gb: [1] } },
				{ event: 'billing_rollup', cadence: 'week', dimensions: { tier: ['a', 'b', 'c'] }, properties: { mrr: [1] } },
				{ event: 'queue_depth', properties: { n: [1] } },
			],
		}));

		const byEvent = {};
		for (const record of result.standaloneEventData) {
			byEvent[record.event] = (byEvent[record.event] || 0) + 1;
		}
		expect(byEvent).toEqual({ cdn_egress: 60, billing_rollup: 15, queue_depth: 30 });
	});

	test('no record lands past the dataset end', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{ event: 'snap', properties: { n: [1] } }],
		}));

		const end = dayjs.utc(WINDOW.datasetEnd).valueOf();
		for (const record of result.standaloneEventData) {
			expect(dayjs.utc(record.time).valueOf()).toBeLessThanOrEqual(end);
		}
	});
});

describe('standaloneEvents — property value functions', () => {
	test('value functions receive tickIndex, tickCount, and dimensions', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{
				event: 'trend',
				cadence: 'day',
				dimensions: { region: ['us', 'eu'] },
				properties: {
					idx: (ctx) => ctx.tickIndex,
					total: (ctx) => ctx.tickCount,
					echo: (ctx) => ctx.dimensions.region,
					cad: (ctx) => ctx.cadence,
				},
			}],
		}));

		const records = result.standaloneEventData;
		for (const record of records) {
			expect(record.total).toBe(30);
			expect(record.echo).toBe(record.region);
			expect(record.cad).toBe('day');
		}
		// tickIndex spans the whole window
		expect(Math.min(...records.map(r => r.idx))).toBe(0);
		expect(Math.max(...records.map(r => r.idx))).toBe(29);
	});

	test('a value function can shape a monotonic trend across the window', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{
				event: 'growth',
				properties: { gb_out: (ctx) => 100 + ctx.tickIndex * 10 },
			}],
		}));

		const series = result.standaloneEventData
			.sort((a, b) => dayjs.utc(a.time).valueOf() - dayjs.utc(b.time).valueOf())
			.map(r => r.gb_out);
		expect(series[0]).toBe(100);
		expect(series.at(-1)).toBe(100 + 29 * 10);
		for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1]);
	});
});

describe('standaloneEvents — hook and isolation', () => {
	test('the standalone hook fires and mutations stick', async () => {
		const seenTypes = new Set();
		const result = await generate(baseConfig({
			standaloneEvents: [{
				event: 'cdn_egress',
				dimensions: { region: ['us-east', 'eu'] },
				properties: { gb_out: [100] },
			}],
			hook: (record, type, meta) => {
				if (type === 'standalone') {
					seenTypes.add(meta?.spec?.event);
					if (record.region === 'eu') record.gb_out = 999;
				}
				return record;
			},
		}));

		expect(seenTypes.has('cdn_egress')).toBe(true);
		const eu = result.standaloneEventData.filter(r => r.region === 'eu');
		const us = result.standaloneEventData.filter(r => r.region === 'us-east');
		expect(eu.every(r => r.gb_out === 999)).toBe(true);
		expect(us.every(r => r.gb_out === 100)).toBe(true);
	});

	test('standalone records never leak into eventData', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{ event: 'cdn_egress', properties: { gb_out: [100] } }],
		}));

		expect(result.eventData.length).toBeGreaterThan(0);
		expect(result.eventData.some(e => e.event === 'cdn_egress')).toBe(false);
		expect(result.standaloneEventData.every(e => e.event === 'cdn_egress')).toBe(true);
	});

	test('omitting standaloneEvents yields an empty container, not a crash', async () => {
		const result = await generate(baseConfig());
		// the container is a HookedArray (carries hookPush/flush), so assert on
		// length rather than deep-equality against a bare []
		expect(result.standaloneEventData).toHaveLength(0);
		expect(result.eventData.length).toBeGreaterThan(0);
	});

	test('user events keep a clean schema alongside a standalone stream', async () => {
		const result = await generate(baseConfig({
			standaloneEvents: [{ event: 'cdn_egress', properties: { gb_out: [100] } }],
		}));

		// no Mixpanel default properties leaked onto normal events
		const keys = Object.keys(result.eventData[0]).sort();
		expect(keys).toEqual(['app_ver', 'event', 'foo', 'insert_id', 'time', 'user_id']);
	});
});
