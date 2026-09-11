//@ts-nocheck
/**
 * Unit tests for `standaloneEvents` (v1.8.0) — identity-less metric snapshots.
 *
 * Pure-function coverage only: dimension expansion, cadence tick building, and
 * the validator. Generation-through-the-engine coverage lives at
 * tests/integration/standalone-events.test.js.
 */
import { describe, test, expect } from 'vitest';
import {
	expandDimensions,
	buildTicks,
	validateStandaloneEvents,
	VALID_CADENCES,
} from '../../lib/generators/standalone.js';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';

const DAY = 86400;

describe('expandDimensions', () => {
	test('no dimensions yields exactly one empty row', () => {
		expect(expandDimensions({})).toEqual([{}]);
		expect(expandDimensions(undefined)).toEqual([{}]);
	});

	test('single dimension yields one row per value', () => {
		expect(expandDimensions({ region: ['us', 'eu'] })).toEqual([
			{ region: 'us' },
			{ region: 'eu' },
		]);
	});

	test('two dimensions yield the full cross product', () => {
		const rows = expandDimensions({ region: ['us', 'eu'], tier: ['a', 'b'] });
		expect(rows).toHaveLength(4);
		expect(rows).toEqual([
			{ region: 'us', tier: 'a' },
			{ region: 'us', tier: 'b' },
			{ region: 'eu', tier: 'a' },
			{ region: 'eu', tier: 'b' },
		]);
	});

	test('three dimensions multiply out', () => {
		const rows = expandDimensions({ a: [1, 2], b: [1, 2, 3], c: [1] });
		expect(rows).toHaveLength(6);
		// every row carries every key
		for (const row of rows) expect(Object.keys(row).sort()).toEqual(['a', 'b', 'c']);
	});
});

describe('buildTicks', () => {
	const start = 1_700_000_000;

	test('daily cadence is inclusive of both endpoints', () => {
		const ticks = buildTicks(start, start + 3 * DAY, 'day');
		expect(ticks).toEqual([start, start + DAY, start + 2 * DAY, start + 3 * DAY]);
	});

	test('never emits a tick past the dataset end', () => {
		// end lands mid-day: the partial final day produces no tick
		const ticks = buildTicks(start, start + 3 * DAY - 1, 'day');
		expect(ticks).toHaveLength(3);
		expect(Math.max(...ticks)).toBeLessThanOrEqual(start + 3 * DAY - 1);
	});

	test('weekly cadence steps by 7 days', () => {
		const ticks = buildTicks(start, start + 21 * DAY, 'week');
		expect(ticks).toHaveLength(4);
		expect(ticks[1] - ticks[0]).toBe(7 * DAY);
	});

	test('hourly cadence steps by an hour', () => {
		const ticks = buildTicks(start, start + 5 * 3600, 'hour');
		expect(ticks).toHaveLength(6);
		expect(ticks[1] - ticks[0]).toBe(3600);
	});

	test('a zero-length window still yields the opening tick', () => {
		expect(buildTicks(start, start, 'day')).toEqual([start]);
	});

	test('throws on an unknown cadence', () => {
		expect(() => buildTicks(start, start + DAY, 'fortnight')).toThrow(/unknown cadence/);
	});
});

describe('validateStandaloneEvents', () => {
	test('absent config normalizes to an empty array', () => {
		expect(validateStandaloneEvents(undefined)).toEqual([]);
		expect(validateStandaloneEvents(null)).toEqual([]);
	});

	test('fills defaults: day cadence, empty dimensions, null distinctIdFrom', () => {
		const [spec] = validateStandaloneEvents([{ event: 'snap' }]);
		expect(spec).toEqual({
			event: 'snap',
			cadence: 'day',
			dimensions: {},
			distinctIdFrom: null,
			properties: {},
		});
	});

	test('accepts every documented cadence', () => {
		for (const cadence of VALID_CADENCES) {
			const [spec] = validateStandaloneEvents([{ event: 'snap', cadence }]);
			expect(spec.cadence).toBe(cadence);
		}
	});

	test('throws when standaloneEvents is not an array', () => {
		expect(() => validateStandaloneEvents({ event: 'snap' })).toThrow(/must be an array/);
	});

	test('throws on a missing or empty event name', () => {
		expect(() => validateStandaloneEvents([{}])).toThrow(/event must be a non-empty string/);
		expect(() => validateStandaloneEvents([{ event: '  ' }])).toThrow(/event must be a non-empty string/);
	});

	test('throws on a duplicate event name', () => {
		expect(() => validateStandaloneEvents([{ event: 'snap' }, { event: 'snap' }]))
			.toThrow(/declared more than once/);
	});

	test('throws on an unknown cadence', () => {
		expect(() => validateStandaloneEvents([{ event: 'snap', cadence: 'fortnight' }]))
			.toThrow(/cadence must be one of/);
	});

	test('throws on an empty dimension array', () => {
		expect(() => validateStandaloneEvents([{ event: 'snap', dimensions: { region: [] } }]))
			.toThrow(/must be a non-empty array/);
	});

	test('throws when distinctIdFrom names an undeclared dimension', () => {
		expect(() => validateStandaloneEvents([{ event: 'snap', distinctIdFrom: 'region' }]))
			.toThrow(/is not a declared dimension/);
	});

	test('accepts distinctIdFrom when the dimension exists', () => {
		const [spec] = validateStandaloneEvents([
			{ event: 'snap', dimensions: { region: ['us'] }, distinctIdFrom: 'region' },
		]);
		expect(spec.distinctIdFrom).toBe('region');
	});

	test('throws when a property collides with a reserved record key', () => {
		for (const key of ['event', 'time', 'insert_id', 'distinct_id', 'user_id', 'device_id']) {
			expect(() => validateStandaloneEvents([{ event: 'snap', properties: { [key]: [1] } }]))
				.toThrow(/collides with a reserved record key/);
		}
	});

	test('throws when a property collides with a dimension of the same name', () => {
		expect(() => validateStandaloneEvents([
			{ event: 'snap', dimensions: { region: ['us'] }, properties: { region: ['x'] } },
		])).toThrow(/collides with a dimension/);
	});
});

describe('config-validator integration', () => {
	test('normalizes standaloneEvents onto the validated config', () => {
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			seed: 'standalone-unit',
			writeToDisk: true,
			standaloneEvents: [{ event: 'cdn_egress', dimensions: { region: ['us'] } }],
		});
		expect(config.standaloneEvents).toHaveLength(1);
		expect(config.standaloneEvents[0].cadence).toBe('day');
		expect(config.standaloneEvents[0].dimensions).toEqual({ region: ['us'] });
	});

	test('a config with no standaloneEvents gets an empty array, not undefined', () => {
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'standalone-unit-2', writeToDisk: true,
		});
		expect(config.standaloneEvents).toEqual([]);
	});

	test('a malformed standaloneEvents entry fails validation loudly', () => {
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'standalone-unit-3', writeToDisk: true,
			standaloneEvents: [{ cadence: 'day' }],
		})).toThrow(/event must be a non-empty string/);
	});
});
