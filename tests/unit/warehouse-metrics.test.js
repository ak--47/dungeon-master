//@ts-nocheck
import { describe, expect, test } from 'vitest';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { validateDungeonShape } from '../../lib/core/dungeon-loader.js';
import { validateWarehouseMetrics } from '../../lib/generators/warehouse.js';

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