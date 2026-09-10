//@ts-nocheck
import { describe, expect, test } from 'vitest';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { validateDungeonShape } from '../../lib/core/dungeon-loader.js';
import {
	bucketStart,
	buildBuckets,
	nextBucket,
	validateWarehouseMetrics,
	WarehouseAccumulator,
} from '../../lib/generators/warehouse.js';

const baseConfig = () => ({
	events: [
		{ event: 'purchase', properties: { amount: [10, 20], region: ['us', 'eu'], plan: ['pro', 'free'] } },
		{ event: 'refund', properties: { amount: [10], region: ['us', 'eu'] } },
		{ event: 'signup', properties: { region: ['us', 'eu'] } },
	],
	superProps: { workspace_id: ['w1', 'w2'] },
});

const metric = (overrides = {}) => ({
	name: 'daily_new_bookings',
	source: { event: 'purchase' },
	...overrides,
});

describe('validateWarehouseMetrics', () => {
	test('absent config normalizes to an empty array with no warnings', () => {
		expect(validateWarehouseMetrics(baseConfig())).toEqual({ warehouseMetrics: [], warnings: [] });
		expect(validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: null })).toEqual({ warehouseMetrics: [], warnings: [] });
	});

	test('fills defaults and normalizes scalars to arrays', () => {
		const { warehouseMetrics, warnings } = validateWarehouseMetrics({
			...baseConfig(),
			format: 'json',
			warehouseMetrics: [metric()],
		});

		expect(warnings).toEqual([]);
		expect(warehouseMetrics).toHaveLength(1);
		expect(warehouseMetrics[0]).toEqual({
			name: 'daily_new_bookings',
			type: 'additive',
			grain: 'day',
			sparse: false,
			source: {
				event: ['purchase'],
				minus: [],
				measure: 'count',
				property: null,
				where: null,
				groupBy: [],
			},
			timeColumn: 'date',
			valueColumn: 'value',
			baseline: 0,
			scale: 1,
			noise: 0,
			history: 0,
			columns: {},
			format: 'json',
		});
	});

	test('throws when warehouseMetrics is not an array', () => {
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: {} })).toThrow(/warehouseMetrics must be an array/i);
	});

	test('enforces metric names to be present, valid, and unique', () => {
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [{ source: { event: 'purchase' } }] })).toThrow(/name/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ name: 'Bad-Name' })] })).toThrow(/name/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric(), metric()] })).toThrow(/unique|more than once/i);
	});

	test('validates type, grain, sparse, source, and source events', () => {
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ type: 'rolling' })] })).toThrow(/type/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ grain: 'quarter' })] })).toThrow(/grain/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ sparse: true })] })).toThrow(/sparse/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [{ name: 'daily_new_bookings' }] })).toThrow(/source/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ source: {} })] })).toThrow(/source\.event/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ source: { event: 'missing' } })] })).toThrow(/missing/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ source: { event: 'purchase', minus: 'missing' } })] })).toThrow(/missing/i);
	});

	test('validates measures and required properties', () => {
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ source: { event: 'purchase', measure: 'median' } })] })).toThrow(/measure/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ source: { event: 'purchase', measure: 'sum' } })] })).toThrow(/property/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ source: { event: 'purchase', measure: 'avg' } })] })).toThrow(/property/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ source: { event: 'purchase', measure: 'sum', property: 'missing' } })] })).toThrow(/property/i);
		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: 'purchase', minus: 'signup', measure: 'sum', property: 'amount' } })],
		})).toThrow(/property/i);
		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: ['purchase', 'signup'], measure: 'sum', property: 'amount' } })],
		})).toThrow(/property/i);
	});

	test('accepts declared properties from either every source event or superProps', () => {
		const fromEvents = validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: ['purchase', 'refund'], measure: 'sum', property: 'amount' } })],
		});
		expect(fromEvents.warehouseMetrics[0].source.property).toBe('amount');

		const fromSuperProps = validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: ['purchase', 'signup'], measure: 'users', groupBy: 'workspace_id' } })],
		});
		expect(fromSuperProps.warehouseMetrics[0].source.groupBy).toEqual(['workspace_id']);
	});

	test('forbids point-in-time avg and dau measures', () => {
		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ type: 'point-in-time', source: { event: 'purchase', measure: 'avg', property: 'amount' } })],
		})).toThrow(/avg/i);
		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ type: 'point-in-time', source: { event: 'purchase', measure: 'dau' } })],
		})).toThrow(/dau/i);
	});

	test('validates and normalizes groupBy', () => {
		const { warehouseMetrics } = validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: ['purchase', 'refund'], groupBy: ['region', 'workspace_id'] } })],
		});
		expect(warehouseMetrics[0].source.groupBy).toEqual(['region', 'workspace_id']);

		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: 'purchase', groupBy: ['region', 'workspace_id', 'plan'] } })],
		})).toThrow(/groupBy/i);
		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: ['purchase', 'refund'], groupBy: 'plan' } })],
		})).toThrow(/groupBy/i);
		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: 'purchase', minus: 'refund', groupBy: 'plan' } })],
		})).toThrow(/groupBy/i);
	});

	test('warns when groupBy exceeds 50 observed distinct values', () => {
		const config = {
			...baseConfig(),
			events: [
				{ event: 'purchase', properties: { region: Array.from({ length: 51 }, (_, i) => `r${i}`) } },
			],
			warehouseMetrics: [metric({ source: { event: 'purchase', groupBy: 'region' } })],
		};
		const { warnings } = validateWarehouseMetrics(config);
		expect(warnings.some((warning) => /groupBy/i.test(String(warning)) && /50/i.test(String(warning)))).toBe(true);
	});

	test('validates history and warns beyond three years at each grain', () => {
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ history: -1 })] })).toThrow(/history/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ history: 1.2 })] })).toThrow(/history/i);

		expect(validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ history: 1096 })] }).warnings.some((warning) => /history/i.test(String(warning)))).toBe(true);
		expect(validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ grain: 'week', history: 157 })] }).warnings.some((warning) => /history/i.test(String(warning)))).toBe(true);
		expect(validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ grain: 'month', history: 37 })] }).warnings.some((warning) => /history/i.test(String(warning)))).toBe(true);
	});

	test('validates baseline, scale, and noise behavior', () => {
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ type: 'point-in-time', baseline: -1 })] })).toThrow(/baseline/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ scale: 0 })] })).toThrow(/scale/i);

		const { warehouseMetrics, warnings } = validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ baseline: 25, noise: 2 })],
		});
		expect(warehouseMetrics[0].baseline).toBe(0);
		expect(warehouseMetrics[0].noise).toBe(0.5);
		expect(warnings.some((warning) => /baseline/i.test(String(warning)))).toBe(true);
		expect(warnings.some((warning) => /noise/i.test(String(warning)))).toBe(true);
	});

	test('validates identifiers and disallows collisions across output columns', () => {
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ timeColumn: 'bad-name' })] })).toThrow(/identifier/i);
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ source: { event: 'purchase', groupBy: 'bad-name' } })] })).toThrow(/identifier/i);
		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ source: { event: 'purchase', groupBy: 'region' }, valueColumn: 'region' })],
		})).toThrow(/distinct|collision|collide/i);
		expect(() => validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ columns: { date: 'USD' } })],
		})).toThrow(/distinct|collision|collide/i);
	});

	test('validates format and preserves declared columns', () => {
		expect(() => validateWarehouseMetrics({ ...baseConfig(), warehouseMetrics: [metric({ format: 'parquet' })] })).toThrow(/format/i);

		const { warehouseMetrics } = validateWarehouseMetrics({
			...baseConfig(),
			warehouseMetrics: [metric({ columns: { currency: 'USD', is_forecast: false } })],
		});
		expect(warehouseMetrics[0].columns).toEqual({ currency: 'USD', is_forecast: false });
	});

	test('config-validator integration normalizes warehouseMetrics onto the validated config', () => {
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			seed: 'warehouse-unit',
			writeToDisk: true,
			format: 'json',
			events: [{ event: 'purchase', properties: { amount: [10], region: ['us'] } }],
			warehouseMetrics: [
				{
					name: 'daily_new_bookings',
					source: { event: 'purchase', measure: 'sum', property: 'amount', groupBy: 'region' },
				},
			],
		});
		expect(config.warehouseMetrics).toHaveLength(1);
		expect(config.warehouseMetrics[0].source.event).toEqual(['purchase']);
		expect(config.warehouseMetrics[0].source.groupBy).toEqual(['region']);
		expect(config.warehouseMetrics[0].format).toBe('json');
	});

	test('dungeon-loader recognizes warehouseMetrics as a top-level dungeon key', () => {
		expect(() => validateDungeonShape({ warehouseMetrics: [] })).not.toThrow();
	});
});

describe('warehouse bucket math', () => {
	test('computes UTC day, ISO week, and month bucket starts', () => {
		const t = Date.parse('2024-01-17T15:30:00Z') / 1000;

		expect(bucketStart(t, 'day')).toBe(Date.parse('2024-01-17T00:00:00Z') / 1000);
		expect(bucketStart(t, 'week')).toBe(Date.parse('2024-01-15T00:00:00Z') / 1000);
		expect(bucketStart(t, 'month')).toBe(Date.parse('2024-01-01T00:00:00Z') / 1000);
		expect(nextBucket(bucketStart(t, 'day'), 'day')).toBe(Date.parse('2024-01-18T00:00:00Z') / 1000);
		expect(nextBucket(bucketStart(t, 'week'), 'week')).toBe(Date.parse('2024-01-22T00:00:00Z') / 1000);
		expect(nextBucket(bucketStart(t, 'month'), 'month')).toBe(Date.parse('2024-02-01T00:00:00Z') / 1000);
	});

	test('buildBuckets tiles partial windows and prepends history buckets', () => {
		const begin = Date.parse('2024-01-10T12:00:00Z') / 1000;
		const end = Date.parse('2024-01-20T06:00:00Z') / 1000;

		expect(buildBuckets(begin, end, 'week', 2).map((s) => new Date(s * 1000).toISOString().slice(0, 10))).toEqual([
			'2023-12-25',
			'2024-01-01',
			'2024-01-08',
			'2024-01-15',
		]);
	});
});

describe('WarehouseAccumulator', () => {
	const fixedBegin = Date.parse('2024-01-15T00:00:00Z') / 1000;
	const fixedNow = Date.parse('2024-01-21T23:59:59Z') / 1000;
	const day = Date.parse('2024-01-17T00:00:00Z') / 1000;
	const week = Date.parse('2024-01-15T00:00:00Z') / 1000;
	const ev = (event, time, extras = {}) => ({ event, time, user_id: 'u1', ...extras });
	const spec = (overrides = {}) => ({
		name: 'metric',
		type: 'additive',
		grain: 'day',
		sparse: false,
		baseline: 0,
		scale: 1,
		noise: 0,
		history: 0,
		timeColumn: 'date',
		valueColumn: 'value',
		columns: {},
		format: 'csv',
		source: {
			event: ['purchase'],
			minus: [],
			measure: 'count',
			property: null,
			where: null,
			groupBy: [],
		},
		...overrides,
	});

	test('accumulates plus and minus sums per series and ignores unrelated events', () => {
		const acc = new WarehouseAccumulator([
			spec({
				name: 'bookings',
				source: {
					event: ['purchase'],
					minus: ['refund'],
					measure: 'sum',
					property: 'amount',
					where: null,
					groupBy: ['region'],
				},
			}),
		], { FIXED_BEGIN: fixedBegin, FIXED_NOW: fixedNow });

		acc.ingest([
			ev('purchase', '2024-01-17T10:00:00Z', { amount: 10, region: 'us' }),
			ev('purchase', '2024-01-17T11:00:00Z', { amount: 5, region: 'us' }),
			ev('purchase', '2024-01-17T12:00:00Z', { amount: 7, region: 'eu' }),
			ev('refund', '2024-01-17T13:00:00Z', { amount: 4, region: 'us' }),
			ev('page_view', '2024-01-17T14:00:00Z', { amount: 99, region: 'us' }),
		]);

		expect(acc.getCell('bookings', 'us', day)).toMatchObject({ sum: 15, count: 2, mSum: 4, mCount: 1 });
		expect(acc.getCell('bookings', 'eu', day)).toMatchObject({ sum: 7, count: 1, mSum: 0, mCount: 0 });
	});

	test('tracks count, avg, users, and dau measures without mutating input events', () => {
		const specs = [
			spec({ name: 'count_metric' }),
			spec({ name: 'avg_metric', source: { event: ['purchase'], minus: ['refund'], measure: 'avg', property: 'amount', where: null, groupBy: [] } }),
			spec({ name: 'users_metric', grain: 'week', source: { event: ['purchase'], minus: ['refund'], measure: 'users', property: null, where: null, groupBy: [] } }),
			spec({ name: 'dau_metric', grain: 'week', source: { event: ['purchase'], minus: ['refund'], measure: 'dau', property: null, where: null, groupBy: [] } }),
		];
		const acc = new WarehouseAccumulator(specs, { FIXED_BEGIN: fixedBegin, FIXED_NOW: fixedNow });
		const events = [
			ev('purchase', '2024-01-17T10:00:00Z', { amount: 10, keep: 'yes', user_id: 'a' }),
			ev('purchase', '2024-01-17T11:00:00Z', { amount: 20, keep: 'yes', user_id: 'a' }),
			ev('purchase', '2024-01-18T11:00:00Z', { amount: 30, keep: 'yes', user_id: 'b' }),
			ev('refund', '2024-01-18T12:00:00Z', { amount: 5, keep: 'yes', user_id: 'a' }),
		];
		const before = JSON.stringify(events);

		acc.ingest(events);

		expect(acc.getCell('count_metric', '', day)).toMatchObject({ count: 2, mCount: 0 });
		expect(acc.getCell('avg_metric', '', day)).toMatchObject({ sum: 30, count: 2, mSum: 0, mCount: 0 });
		expect(acc.getCell('avg_metric', '', Date.parse('2024-01-18T00:00:00Z') / 1000)).toMatchObject({ sum: 30, count: 1, mSum: 5, mCount: 1 });
		expect(Array.from(acc.getCell('users_metric', '', week).users).sort()).toEqual(['a', 'b']);
		expect(Array.from(acc.getCell('users_metric', '', week).mUsers).sort()).toEqual(['a']);
		expect(Array.from(acc.getCell('dau_metric', '', week).userDays).sort()).toEqual(['a|2024-01-17', 'b|2024-01-18']);
		expect(Array.from(acc.getCell('dau_metric', '', week).mUserDays).sort()).toEqual(['a|2024-01-18']);
		expect(JSON.stringify(events)).toBe(before);
	});

	test('applies where filters and computes empty cells on demand', () => {
		const acc = new WarehouseAccumulator([
			spec({
				name: 'filtered_users',
				grain: 'week',
				source: {
					event: ['purchase'],
					minus: ['refund'],
					measure: 'users',
					property: null,
					where: (event) => event.region === 'us' && event.plan === 'pro',
					groupBy: [],
				},
			}),
		], { FIXED_BEGIN: fixedBegin, FIXED_NOW: fixedNow });

		acc.ingest([
			ev('purchase', '2024-01-17T10:00:00Z', { region: 'us', plan: 'pro', user_id: 'a' }),
			ev('purchase', '2024-01-17T10:00:00Z', { region: 'us', plan: 'free', user_id: 'b' }),
			ev('refund', '2024-01-18T10:00:00Z', { region: 'eu', plan: 'pro', user_id: 'c' }),
		]);

		expect(Array.from(acc.getCell('filtered_users', '', week).users)).toEqual(['a']);
		expect(acc.getCell('filtered_users', '', Date.parse('2024-01-22T00:00:00Z') / 1000)).toMatchObject({
			count: 0,
			sum: 0,
			mCount: 0,
			mSum: 0,
			users: expect.any(Set),
			mUsers: expect.any(Set),
		});
	});

	test('includes events on the exact window boundaries and ignores events outside the window', () => {
		const acc = new WarehouseAccumulator([
			spec({ name: 'boundary_count' }),
		], { FIXED_BEGIN: fixedBegin, FIXED_NOW: fixedNow });

		acc.ingest([
			ev('purchase', '2024-01-14T23:59:59Z'),
			ev('purchase', '2024-01-15T00:00:00Z'),
			ev('purchase', '2024-01-21T23:59:59Z'),
			ev('purchase', '2024-01-22T00:00:00Z'),
		]);

		expect(acc.getCell('boundary_count', '', Date.parse('2024-01-15T00:00:00Z') / 1000)).toMatchObject({ count: 1 });
		expect(acc.getCell('boundary_count', '', Date.parse('2024-01-21T00:00:00Z') / 1000)).toMatchObject({ count: 1 });
		expect(acc.getCell('boundary_count', '', Date.parse('2024-01-14T00:00:00Z') / 1000)).toMatchObject({ count: 0 });
	});

	test('warns once per metric when sum inputs are non-numeric and treats them as zero', () => {
		const acc = new WarehouseAccumulator([
			spec({
				name: 'sum_metric',
				source: { event: ['purchase'], minus: ['refund'], measure: 'sum', property: 'amount', where: null, groupBy: [] },
			}),
			spec({
				name: 'avg_metric',
				source: { event: ['purchase'], minus: [], measure: 'avg', property: 'amount', where: null, groupBy: [] },
			}),
		], { FIXED_BEGIN: fixedBegin, FIXED_NOW: fixedNow });

		acc.ingest([
			ev('purchase', '2024-01-17T10:00:00Z', { amount: 'bad' }),
			ev('purchase', '2024-01-17T11:00:00Z', { amount: 'worse' }),
			ev('refund', '2024-01-17T12:00:00Z', { amount: 'nope' }),
		]);

		expect(acc.getCell('sum_metric', '', day)).toMatchObject({ sum: 0, count: 2, mSum: 0, mCount: 1 });
		expect(acc.getCell('avg_metric', '', day)).toMatchObject({ sum: 0, count: 2 });
		expect(acc.warnings).toHaveLength(2);
		expect(acc.warnings[0]).toMatch(/sum_metric/);
		expect(acc.warnings[1]).toMatch(/avg_metric/);
	});
});