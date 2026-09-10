//@ts-nocheck
import Chance from 'chance';
import { describe, expect, test } from 'vitest';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { validateDungeonShape } from '../../lib/core/dungeon-loader.js';
import {
	buildManifest,
	bucketStart,
	buildBuckets,
	materializeWarehouseMetrics,
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

const seeded = (seed = 'test') => new Chance(seed);

function buildAccumulator(specs, events, window = {
	FIXED_BEGIN: Date.parse('2024-01-01T00:00:00Z') / 1000,
	FIXED_NOW: Date.parse('2024-01-04T12:00:00Z') / 1000,
}) {
	const accumulator = new WarehouseAccumulator(specs, window);
	accumulator.ingest(events);
	return { accumulator, ...window };
}

function materialize(specs, events, options = {}) {
	const window = options.window || {
		FIXED_BEGIN: Date.parse('2024-01-01T00:00:00Z') / 1000,
		FIXED_NOW: Date.parse('2024-01-04T12:00:00Z') / 1000,
	};
	const { accumulator, FIXED_BEGIN, FIXED_NOW } = buildAccumulator(specs, events, window);
	const materialized = materializeWarehouseMetrics({
		specs,
		accumulator,
		chance: options.chance || seeded(options.seed),
		FIXED_BEGIN,
		FIXED_NOW,
		configName: options.configName || 'warehouse_test',
		config: options.config || { name: options.configName || 'warehouse_test' },
	});
	return { materialized, accumulator, FIXED_BEGIN, FIXED_NOW };
}

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

	test('warns at runtime when observed groupBy cardinality exceeds 50', () => {
		const acc = new WarehouseAccumulator([
			spec({
				name: 'runtime_cardinality',
				source: {
					event: ['purchase'],
					minus: [],
					measure: 'count',
					property: null,
					where: null,
					groupBy: ['region'],
				},
			}),
		], { FIXED_BEGIN: fixedBegin, FIXED_NOW: fixedNow });

		acc.ingest(Array.from({ length: 51 }, (_, index) => ev('purchase', '2024-01-17T10:00:00Z', { region: `r${index}`, user_id: `u${index}` })));

		expect(acc.warnings.some((warning) => /groupBy/i.test(String(warning)) && /50/i.test(String(warning)))).toBe(true);
	});
});

describe('materializeWarehouseMetrics', () => {
	const dailySpec = (overrides = {}) => ({
		name: 'daily_metric',
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
	const ev = (event, time, extras = {}) => ({ event, time, user_id: extras.user_id || 'u1', ...extras });

	test('additive dense emits one row per bucket with zeros for empty buckets', () => {
		const specs = [dailySpec()];
		const [{ rows }] = materialize(specs, [
			ev('purchase', '2024-01-01T10:00:00Z'),
			ev('purchase', '2024-01-03T10:00:00Z'),
		]).materialized;

		expect(rows.map((row) => [row.date, row.value])).toEqual([
			['2024-01-01', 1],
			['2024-01-02', 0],
			['2024-01-03', 1],
			['2024-01-04', 0],
		]);
	});

	test('grouped metrics with no observed combos emit no synthetic empty-key rows', () => {
		const specs = [dailySpec({
			name: 'grouped_empty',
			source: { event: ['purchase'], minus: [], measure: 'count', property: null, where: null, groupBy: ['region'] },
			valueColumn: 'bookings',
		})];
		const [{ rows, metas }] = materialize(specs, []).materialized;

		expect(rows).toEqual([]);
		expect(metas).toEqual([]);
	});

	test('point-in-time dense running level uses baseline plus cumulative signed deltas floored at zero', () => {
		const specs = [dailySpec({
			name: 'subs',
			type: 'point-in-time',
			baseline: 100,
			valueColumn: 'active',
			source: { event: ['subscribe'], minus: ['cancel'], measure: 'count', property: null, where: null, groupBy: [] },
		})];
		const [{ rows }] = materialize(specs, [
			ev('subscribe', '2024-01-01T10:00:00Z', { user_id: 'a' }),
			ev('subscribe', '2024-01-02T10:00:00Z', { user_id: 'b' }),
			ev('cancel', '2024-01-03T10:00:00Z', { user_id: 'a' }),
		]).materialized;

		expect(rows.map((row) => [row.date, row.active])).toEqual([
			['2024-01-01', 101],
			['2024-01-02', 102],
			['2024-01-03', 101],
			['2024-01-04', 101],
		]);
	});

	test('point-in-time preserves signed cumulative balance across negative buckets before flooring', () => {
		const specs = [dailySpec({
			name: 'net_arr',
			type: 'point-in-time',
			baseline: 0,
			valueColumn: 'arr_usd',
			source: { event: ['subscribe'], minus: ['cancel'], measure: 'sum', property: 'amount', where: null, groupBy: [] },
		})];
		const [{ rows }] = materialize(specs, [
			ev('cancel', '2024-01-01T10:00:00Z', { amount: 10, user_id: 'a' }),
			ev('subscribe', '2024-01-02T10:00:00Z', { amount: 3, user_id: 'b' }),
			ev('subscribe', '2024-01-03T10:00:00Z', { amount: 8, user_id: 'c' }),
		]).materialized;

		expect(rows.map((row) => [row.date, row.arr_usd])).toEqual([
			['2024-01-01', 0],
			['2024-01-02', 0],
			['2024-01-03', 1],
			['2024-01-04', 1],
		]);
	});

	test('point-in-time sparse emits first bucket then only changed rounded values', () => {
		const specs = [dailySpec({
			name: 'arr',
			type: 'point-in-time',
			sparse: true,
			valueColumn: 'arr_usd',
			source: { event: ['subscribe'], minus: ['cancel'], measure: 'sum', property: 'amount', where: null, groupBy: [] },
		})];
		const [{ rows }] = materialize(specs, [
			ev('subscribe', '2024-01-02T10:00:00Z', { amount: 10 }),
			ev('cancel', '2024-01-04T10:00:00Z', { amount: 4 }),
		]).materialized;

		expect(rows.map((row) => [row.date, row.arr_usd])).toEqual([
			['2024-01-01', 0],
			['2024-01-02', 10],
			['2024-01-04', 6],
		]);
	});

	test('point-in-time sparse retains chronological bucketIndex and bucketCount across skipped gaps and history', () => {
		const specs = [dailySpec({
			name: 'arr_sparse_meta',
			type: 'point-in-time',
			sparse: true,
			history: 1,
			valueColumn: 'arr_usd',
			source: { event: ['subscribe'], minus: ['cancel'], measure: 'sum', property: 'amount', where: null, groupBy: [] },
		})];
		const [{ rows, metas }] = materialize(specs, [
			ev('subscribe', '2024-01-02T10:00:00Z', { amount: 10 }),
			ev('cancel', '2024-01-04T10:00:00Z', { amount: 4 }),
		]).materialized;

		expect(rows.map((row) => [row.date, row.arr_usd])).toEqual([
			['2023-12-31', 0],
			['2024-01-02', 10],
			['2024-01-04', 6],
		]);
		expect(metas.map((meta) => [meta.bucketIndex, meta.bucketCount, meta.isBackfill])).toEqual([
			[0, 5, true],
			[2, 5, false],
			[4, 5, false],
		]);
	});

	test('scale and noise are deterministic and noise zero draws nothing', () => {
		const specs = [dailySpec({ name: 'scaled', scale: 3, noise: 0.1 })];
		const events = [ev('purchase', '2024-01-02T10:00:00Z')];
		const first = materialize(specs, events, { seed: 'same-seed' }).materialized[0].rows;
		const second = materialize(specs, events, { seed: 'same-seed' }).materialized[0].rows;
		const zeroNoise = materialize([dailySpec({ name: 'no_noise', scale: 3, noise: 0 })], events).materialized[0].rows;

		expect(first).toEqual(second);
		expect(zeroNoise.map((row) => row.value)).toEqual([0, 3, 0, 0]);
	});

	test('applies noise and rounds only at the final emitted value', () => {
		const specs = [dailySpec({ name: 'fractional_noise', scale: 1 / 3, noise: 0.1 })];
		const [{ rows }] = materialize(specs, [ev('purchase', '2024-01-02T10:00:00Z')], {
			chance: { normal: () => 0.1 },
		}).materialized;

		expect(rows.map((row) => row.value)).toEqual([0, 0.37, 0, 0]);
	});

	test('month-grain dau divides by the actual bucket length', () => {
		const specs = [dailySpec({
			name: 'monthly_dau',
			grain: 'month',
			source: { event: ['purchase'], minus: [], measure: 'dau', property: null, where: null, groupBy: [] },
		})];
		const [{ rows }] = materialize(specs, [
			ev('purchase', '2024-01-01T10:00:00Z', { user_id: 'a' }),
			ev('purchase', '2024-01-31T10:00:00Z', { user_id: 'b' }),
		], {
			window: {
				FIXED_BEGIN: Date.parse('2024-01-01T00:00:00Z') / 1000,
				FIXED_NOW: Date.parse('2024-01-31T23:59:59Z') / 1000,
			},
		}).materialized;

		expect(rows).toEqual([{ date: '2024-01-01', value: 0.06 }]);
	});

	test('backfill prepends history buckets using the unnoised scaled least-squares slope and marks meta rows', () => {
		const specs = [dailySpec({ name: 'backfill_metric', scale: 2, history: 3 })];
		const events = [
			ev('purchase', '2024-01-01T10:00:00Z'),
			ev('purchase', '2024-01-02T10:00:00Z'),
			ev('purchase', '2024-01-02T11:00:00Z'),
			ev('purchase', '2024-01-03T10:00:00Z'),
			ev('purchase', '2024-01-03T11:00:00Z'),
			ev('purchase', '2024-01-03T12:00:00Z'),
			ev('purchase', '2024-01-04T09:00:00Z'),
			ev('purchase', '2024-01-04T10:00:00Z'),
			ev('purchase', '2024-01-04T11:00:00Z'),
			ev('purchase', '2024-01-04T12:00:00Z'),
		];
		const [{ rows, metas }] = materialize(specs, events).materialized;

		expect(rows.map((row) => [row.date, row.value])).toEqual([
			['2023-12-29', 0],
			['2023-12-30', 0],
			['2023-12-31', 0],
			['2024-01-01', 2],
			['2024-01-02', 4],
			['2024-01-03', 6],
			['2024-01-04', 8],
		]);
		expect(metas.slice(0, 3).every((meta) => meta.isBackfill === true)).toBe(true);
		expect(metas.slice(3).every((meta) => meta.isBackfill === false)).toBe(true);
	});

	test('backfill fits history from unrounded scaled window values', () => {
		const specs = [dailySpec({ name: 'fractional_backfill', scale: 1 / 3, history: 1 })];
		const [{ rows }] = materialize(specs, [
			ev('purchase', '2024-01-01T10:00:00Z'),
			ev('purchase', '2024-01-02T10:00:00Z'),
			ev('purchase', '2024-01-02T11:00:00Z'),
			ev('purchase', '2024-01-03T10:00:00Z'),
			ev('purchase', '2024-01-03T11:00:00Z'),
		], {
			window: {
				FIXED_BEGIN: Date.parse('2024-01-01T00:00:00Z') / 1000,
				FIXED_NOW: Date.parse('2024-01-03T23:59:59Z') / 1000,
			},
		}).materialized;

		expect(rows.map((row) => [row.date, row.value])).toEqual([
			['2023-12-31', 0.17],
			['2024-01-01', 0.33],
			['2024-01-02', 0.67],
			['2024-01-03', 0.67],
		]);
	});

	test('groupBy emits sorted multi-key series, preserves null keys as empty series parts, and PIT carries levels independently', () => {
		const specs = [dailySpec({
			name: 'grouped_subs',
			type: 'point-in-time',
			baseline: 0,
			valueColumn: 'active',
			source: {
				event: ['subscribe'],
				minus: ['cancel'],
				measure: 'count',
				property: null,
				where: null,
				groupBy: ['region', 'plan'],
			},
		})];
		const [{ rows }] = materialize(specs, [
			ev('subscribe', '2024-01-01T10:00:00Z', { region: 'us', plan: 'pro', user_id: 'a' }),
			ev('subscribe', '2024-01-02T10:00:00Z', { region: 'us', plan: null, user_id: 'b' }),
			ev('cancel', '2024-01-03T10:00:00Z', { region: 'us', plan: 'pro', user_id: 'a' }),
			ev('subscribe', '2024-01-03T11:00:00Z', { region: 'eu', plan: 'free', user_id: 'c' }),
		]).materialized;

		expect(rows.map((row) => [row.date, row.region, row.plan, row.active])).toEqual([
			['2024-01-01', 'eu', 'free', 0],
			['2024-01-02', 'eu', 'free', 0],
			['2024-01-03', 'eu', 'free', 1],
			['2024-01-04', 'eu', 'free', 1],
			['2024-01-01', 'us', '', 0],
			['2024-01-02', 'us', '', 1],
			['2024-01-03', 'us', '', 1],
			['2024-01-04', 'us', '', 1],
			['2024-01-01', 'us', 'pro', 1],
			['2024-01-02', 'us', 'pro', 1],
			['2024-01-03', 'us', 'pro', 0],
			['2024-01-04', 'us', 'pro', 0],
		]);
	});

	test('groupBy rows preserve typed dimensions and pipe-containing values from observed tuples', () => {
		const specs = [dailySpec({
			name: 'typed_grouped',
			valueColumn: 'bookings',
			source: {
				event: ['purchase'],
				minus: [],
				measure: 'count',
				property: null,
				where: null,
				groupBy: ['channel', 'is_active', 'tier'],
			},
		})];
		const [{ rows }] = materialize(specs, [
			ev('purchase', '2024-01-02T10:00:00Z', { channel: 'pro|plus', is_active: true, tier: 7 }),
		]).materialized;

		expect(rows).toContainEqual({
			date: '2024-01-01',
			channel: 'pro|plus',
			is_active: true,
			tier: 7,
			bookings: 0,
		});
		expect(rows).toContainEqual({
			date: '2024-01-02',
			channel: 'pro|plus',
			is_active: true,
			tier: 7,
			bookings: 1,
		});
	});

	test('groupBy throws when unequal dimension tuples collapse to the same joined seriesKey', () => {
		const specs = [dailySpec({
			name: 'collision_metric',
			source: {
				event: ['purchase'],
				minus: [],
				measure: 'count',
				property: null,
				where: null,
				groupBy: ['left_dim', 'right_dim'],
			},
		})];

		expect(() => buildAccumulator(specs, [
			ev('purchase', '2024-01-02T10:00:00Z', { left_dim: 'a|b', right_dim: 'c' }),
			ev('purchase', '2024-01-02T11:00:00Z', { left_dim: 'a', right_dim: 'b|c' }),
		])).toThrow(/collision_metric/);
	});

	test('declared columns stamp scalars and functions receive the chained warehouse value context', () => {
		const specs = [dailySpec({
			name: 'column_metric',
			valueColumn: 'bookings',
			columns: {
				currency: 'USD',
				is_backfill: ({ isBackfill }) => isBackfill,
				target: ({ value, row, bucketIndex, grain, seriesKey }) => {
					expect(row.currency).toBe('USD');
					expect(bucketIndex).toBeGreaterThanOrEqual(0);
					expect(grain).toBe('day');
					expect(seriesKey).toBe('');
					return value + bucketIndex + 1;
				},
			},
		})];
		const [{ rows }] = materialize(specs, [ev('purchase', '2024-01-01T10:00:00Z')]).materialized;

		expect(rows[0]).toEqual({
			date: '2024-01-01',
			bookings: 1,
			currency: 'USD',
			is_backfill: false,
			target: 2,
		});
	});

	test('buildManifest matches row shape, aggregation semantics, and SQL template', () => {
		const specs = [
			dailySpec({
				name: 'daily_new_bookings',
				valueColumn: 'bookings',
				columns: { currency: 'USD', is_forecast: false },
			}),
			dailySpec({
				name: 'monthly_arr_snapshot',
				type: 'point-in-time',
				grain: 'month',
				timeColumn: 'month',
				valueColumn: 'arr_usd',
				source: { event: ['subscribe'], minus: ['cancel'], measure: 'sum', property: 'amount', where: null, groupBy: ['region'] },
				columns: { is_forecast: true },
			}),
		];
		const { materialized } = materialize(specs, [
			ev('purchase', '2024-01-01T10:00:00Z'),
			ev('subscribe', '2024-01-01T10:00:00Z', { amount: 10, region: 'us' }),
		], {
			window: {
				FIXED_BEGIN: Date.parse('2024-01-01T00:00:00Z') / 1000,
				FIXED_NOW: Date.parse('2024-02-10T00:00:00Z') / 1000,
			},
			configName: 'demo_config',
		});
		const manifest = buildManifest(specs, materialized, 'demo_config');

		expect(manifest).toEqual({
			configName: 'demo_config',
			tables: [
				{
					table: 'daily_new_bookings',
					file: 'demo_config-WAREHOUSE-daily_new_bookings',
					format: 'csv',
					grain: 'day',
					type: 'additive',
					timeColumn: 'date',
					valueColumn: 'bookings',
					dimensionColumns: [],
					columns: [
						{ name: 'date', bqType: 'DATE' },
						{ name: 'bookings', bqType: 'FLOAT64' },
						{ name: 'currency', bqType: 'STRING' },
						{ name: 'is_forecast', bqType: 'BOOL' },
					],
					recommendedAggregation: 'sum',
					sql: 'SELECT * FROM `{{DATASET}}.daily_new_bookings` ORDER BY date',
					refreshHint: 'hourly',
				},
				{
					table: 'monthly_arr_snapshot',
					file: 'demo_config-WAREHOUSE-monthly_arr_snapshot',
					format: 'csv',
					grain: 'month',
					type: 'point-in-time',
					timeColumn: 'month',
					valueColumn: 'arr_usd',
					dimensionColumns: ['region'],
					columns: [
						{ name: 'month', bqType: 'DATE' },
						{ name: 'region', bqType: 'STRING' },
						{ name: 'arr_usd', bqType: 'FLOAT64' },
						{ name: 'is_forecast', bqType: 'BOOL' },
					],
					recommendedAggregation: 'last value',
					sql: 'SELECT * FROM `{{DATASET}}.monthly_arr_snapshot` ORDER BY month',
					refreshHint: 'hourly',
				},
			],
		});
	});

	test('buildManifest infers DATE from spec.timeColumn only and keeps metric values FLOAT64 even without rows', () => {
		const specs = [
			dailySpec({
				name: 'empty_metric',
				timeColumn: 'bucket_label',
				valueColumn: 'bookings',
				columns: { report_date: '2024-01-01', is_forecast: false },
			}),
		];
		const manifest = buildManifest(specs, [{ rows: [] }], 'demo_config');

		expect(manifest.tables[0].columns).toEqual([
			{ name: 'bucket_label', bqType: 'DATE' },
			{ name: 'bookings', bqType: 'FLOAT64' },
			{ name: 'report_date', bqType: 'STRING' },
			{ name: 'is_forecast', bqType: 'STRING' },
		]);
	});
});