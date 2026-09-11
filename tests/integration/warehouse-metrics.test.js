//@ts-nocheck
import { describe, test, expect } from 'vitest';
import generate from '../../index.js';

const WINDOW = {
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-09-30T00:00:00Z',
};

function baseConfig(overrides = {}) {
	return {
		name: 'wh-int',
		seed: 'wh-test',
		numUsers: 100,
		numEvents: 500,
		numDays: 30,
		writeToDisk: false,
		verbose: false,
		concurrency: 1,
		...WINDOW,
		switches: {
			hasLocation: false,
			hasBrowser: false,
			hasSessionIds: false,
			hasCampaigns: false,
			hasAdSpend: false,
			hasIOSDevices: false,
			hasAndroidDevices: false,
			hasDesktopDevices: false,
			hasAvatar: false,
		},
		events: [
			{ event: 'purchase', weight: 5, properties: { amount: [10, 20, 30], region: ['us', 'eu'] } },
			{ event: 'subscribe', weight: 2, properties: { region: ['us', 'eu'] } },
			{ event: 'cancel', weight: 1, properties: { region: ['us', 'eu'] } },
			{ event: 'page_view', weight: 10, properties: {} },
		],
		warehouseMetrics: [
			{ name: 'bookings', source: { event: 'purchase', measure: 'sum', property: 'amount', groupBy: 'region' } },
			{ name: 'active_subs', type: 'point-in-time', source: { event: 'subscribe', minus: 'cancel', groupBy: 'region' }, baseline: 50, valueColumn: 'active' },
			{ name: 'arr', type: 'point-in-time', grain: 'month', sparse: true, history: 6, source: { event: 'subscribe', groupBy: 'region' }, baseline: 1000, scale: 100, valueColumn: 'arr_usd' },
		],
		...overrides,
	};
}

function stripInsertIds(events) {
	return events.map(({ insert_id, ...rest }) => rest);
}

describe.sequential('warehouseMetrics integration', () => {
	test('result carries tables, manifest, warnings, and additive truth totals', async () => {
		const result = await generate(baseConfig());

		expect(result.warnings).toEqual([]);
		expect(result.warehouseMetricData).toBeDefined();
		expect(Object.keys(result.warehouseMetricData)).toEqual(['bookings', 'active_subs', 'arr']);

		const bookings = result.warehouseMetricData.bookings;
		expect(bookings.length).toBeGreaterThan(0);
		expect(Object.keys(bookings[0])).toEqual(['date', 'region', 'value']);

		const purchaseEvents = result.eventData.filter((event) => event.event === 'purchase');
		const truth = new Map();
		for (const event of purchaseEvents) {
			const key = `${event.time.slice(0, 10)}|${event.region}`;
			truth.set(key, (truth.get(key) ?? 0) + event.amount);
		}
		for (const row of bookings) {
			expect(row.value).toBeCloseTo(truth.get(`${row.date}|${row.region}`) ?? 0, 2);
		}

		for (const row of result.warehouseMetricData.active_subs) {
			expect(row.active).toBeGreaterThanOrEqual(0);
		}

		const arr = result.warehouseMetricData.arr;
		expect(arr.length).toBeGreaterThan(1);
		expect(arr.some((row) => row.date < WINDOW.datasetStart.slice(0, 10))).toBe(true);
		for (let index = 1; index < arr.length; index += 1) {
			expect(arr[index].arr_usd).not.toBe(arr[index - 1].arr_usd);
		}

		expect(result.warehouseManifest).toMatchObject({
			configName: 'wh-int',
			tables: expect.any(Array),
		});
		expect(result.warehouseManifest.tables).toHaveLength(3);

		const bookingsManifest = result.warehouseManifest.tables.find((table) => table.table === 'bookings');
		expect(bookingsManifest).toEqual({
			table: 'bookings',
			file: 'wh-int-WAREHOUSE-bookings',
			format: 'csv',
			grain: 'day',
			type: 'additive',
			timeColumn: 'date',
			valueColumn: 'value',
			dimensionColumns: ['region'],
			columns: [
				{ name: 'date', bqType: 'DATE' },
				{ name: 'region', bqType: 'STRING' },
				{ name: 'value', bqType: 'FLOAT64' },
			],
			recommendedAggregation: 'sum',
			sql: 'SELECT * FROM `{{DATASET}}.bookings` ORDER BY date',
			refreshHint: 'hourly',
		});

		const arrManifest = result.warehouseManifest.tables.find((table) => table.table === 'arr');
		expect(arrManifest.recommendedAggregation).toBe('last value');
		expect(arrManifest.sql).toContain('SELECT * FROM `{{DATASET}}.arr`');
		expect(arrManifest.dimensionColumns).toEqual(['region']);
		expect(arrManifest.columns.map((column) => column.name)).toEqual(['date', 'region', 'arr_usd']);

		expect(result.validatedConfig.warehouseMetrics.map((spec) => spec.source.event)).toEqual([
			['purchase'],
			['subscribe'],
			['subscribe'],
		]);
		expect(result.validatedConfig.warehouseMetrics.map((spec) => spec.source.minus)).toEqual([
			[],
			['cancel'],
			[],
		]);
	});

	test('warehouseMetrics do not perturb events and are deterministic for the same seed', async () => {
		const withoutWarehouse = await generate(baseConfig({ warehouseMetrics: undefined }));
		const noisyConfig = baseConfig();
		noisyConfig.warehouseMetrics = noisyConfig.warehouseMetrics.map((spec) => ({ ...spec, noise: 0.1 }));
		const withWarehouseA = await generate(noisyConfig);
		const withWarehouseB = await generate(noisyConfig);

		expect(stripInsertIds(withWarehouseA.eventData)).toEqual(stripInsertIds(withoutWarehouse.eventData));
		expect(stripInsertIds(withWarehouseA.eventData)).toEqual(stripInsertIds(withWarehouseB.eventData));
		expect(withWarehouseA.warehouseMetricData).toEqual(withWarehouseB.warehouseMetricData);
		expect(withWarehouseA.warehouseManifest).toEqual(withWarehouseB.warehouseManifest);
	});

	test('warehouse hook sees resolved meta and can mutate declared columns only', async () => {
		const seen = [];
		const result = await generate(baseConfig({
			warehouseMetrics: [{
				name: 'bookings',
				source: { event: 'purchase', groupBy: 'region' },
				columns: { boosted: false },
			}],
			hook: (row, type, meta) => {
				if (type !== 'warehouse') return row;
				seen.push({
					metricName: meta.metricName,
					grain: meta.grain,
					isBackfill: meta.isBackfill,
					seriesKey: meta.seriesKey,
					bucketIndex: meta.bucketIndex,
					bucketCount: meta.bucketCount,
					raw: meta.raw,
					sourceEvents: meta.spec.source.event,
					minusEvents: meta.spec.source.minus,
					datasetStart: meta.datasetStart,
					datasetEnd: meta.datasetEnd,
				});
				if (meta.bucketIndex === 0) row.boosted = true;
				return row;
			},
		}));

		expect(seen.length).toBe(result.warehouseMetricData.bookings.length);
		expect(seen[0]).toMatchObject({
			metricName: 'bookings',
			grain: 'day',
			isBackfill: false,
			sourceEvents: ['purchase'],
			minusEvents: [],
			raw: {
				plus: expect.objectContaining({ count: expect.any(Number), sum: expect.any(Number), users: expect.any(Number) }),
				minus: expect.objectContaining({ count: expect.any(Number), sum: expect.any(Number), users: expect.any(Number) }),
			},
			datasetStart: expect.any(Number),
			datasetEnd: expect.any(Number),
		});
		expect(result.warehouseMetricData.bookings[0]).toHaveProperty('boosted');
		expect(result.warehouseMetricData.bookings.every((row) => Object.keys(row).sort().join(',') === 'boosted,date,region,value')).toBe(true);
	});
});