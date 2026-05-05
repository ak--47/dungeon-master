//@ts-nocheck
import { describe, test, expect, beforeAll } from 'vitest';
import {
	dateRange, listOf, objectList, ListValue,
	choose, initChance, setDatasetNow, setDatasetBegin, weighNumRange
} from '../lib/utils/utils.js';
import generate from '../index.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

const timeout = 30_000;

beforeAll(() => {
	initChance('property-helpers-test');
	setDatasetBegin(dayjs.utc('2024-01-01').unix());
	setDatasetNow(dayjs.utc('2024-04-01').unix());
});


describe('dateRange', () => {

	test('default range produces dates within dataset window', () => {
		const gen = dateRange();
		const start = dayjs.utc('2024-01-01');
		const end = dayjs.utc('2024-04-01');
		for (let i = 0; i < 50; i++) {
			const d = dayjs.utc(gen());
			expect(d.isAfter(start.subtract(1, 'second'))).toBe(true);
			expect(d.isBefore(end.add(1, 'second'))).toBe(true);
		}
	});

	test('custom range produces dates within specified bounds', () => {
		const gen = dateRange('2023-06-01', '2023-06-30');
		const start = dayjs.utc('2023-06-01');
		const end = dayjs.utc('2023-06-30');
		for (let i = 0; i < 50; i++) {
			const d = dayjs.utc(gen());
			expect(d.isAfter(start.subtract(1, 'second'))).toBe(true);
			expect(d.isBefore(end.add(1, 'second'))).toBe(true);
		}
	});

	test('format parameter controls output', () => {
		const gen = dateRange('2024-01-01', '2024-01-31', 'YYYY-MM-DD');
		const result = gen();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test('null format produces ISO string', () => {
		const gen = dateRange('2024-01-01', '2024-01-31', null);
		const result = gen();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	test('unix seconds as bounds', () => {
		const startUnix = dayjs.utc('2024-02-01').unix();
		const endUnix = dayjs.utc('2024-02-28').unix();
		const gen = dateRange(startUnix, endUnix);
		const d = dayjs.utc(gen());
		expect(d.month()).toBe(1); // February
	});

	test('choose() resolves dateRange thunk to a string', () => {
		const gen = dateRange();
		const result = choose(gen);
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});
});


describe('listOf', () => {

	const pool = ['Rock', 'Pop', 'Jazz', 'Folk', 'Blues', 'Classical', 'Metal', 'Country'];

	test('returns array of length between min and max', () => {
		const gen = listOf(pool, { min: 2, max: 4 });
		for (let i = 0; i < 50; i++) {
			const result = gen();
			expect(result.length).toBeGreaterThanOrEqual(2);
			expect(result.length).toBeLessThanOrEqual(4);
		}
	});

	test('items come from pool only', () => {
		const gen = listOf(pool, { min: 1, max: 5 });
		for (let i = 0; i < 50; i++) {
			const result = gen();
			for (const item of result) {
				expect(pool).toContain(item);
			}
		}
	});

	test('items are unique within a single pick', () => {
		const gen = listOf(pool, { min: 3, max: 5 });
		for (let i = 0; i < 50; i++) {
			const result = gen();
			expect(new Set(result).size).toBe(result.length);
		}
	});

	test('works with number pools', () => {
		const numPool = [10, 20, 30, 40, 50];
		const gen = listOf(numPool, { min: 1, max: 3 });
		const result = gen();
		expect(Array.isArray(result)).toBe(true);
		for (const item of result) {
			expect(typeof item).toBe('number');
		}
	});

	test('returns ListValue instance', () => {
		const gen = listOf(pool);
		const result = gen();
		expect(result).toBeInstanceOf(ListValue);
		expect(result).toBeInstanceOf(Array);
	});

	test('choose() passes through list without picking', () => {
		const gen = listOf(pool, { min: 3, max: 3 });
		const result = choose(gen);
		expect(result).toBeInstanceOf(ListValue);
		expect(result.length).toBe(3);
	});

	test('default min/max are 1 and 3', () => {
		const gen = listOf(pool);
		for (let i = 0; i < 50; i++) {
			const result = gen();
			expect(result.length).toBeGreaterThanOrEqual(1);
			expect(result.length).toBeLessThanOrEqual(3);
		}
	});
});


describe('objectList', () => {

	const template = {
		product_id: weighNumRange(1, 1000),
		category: ['Electronics', 'Clothing', 'Books', 'Food'],
		price: weighNumRange(5, 200),
	};

	test('returns array of objects with length between min and max', () => {
		const gen = objectList(template, { min: 2, max: 4 });
		for (let i = 0; i < 20; i++) {
			const result = gen();
			expect(result.length).toBeGreaterThanOrEqual(2);
			expect(result.length).toBeLessThanOrEqual(4);
		}
	});

	test('each object has template keys', () => {
		const gen = objectList(template, { min: 1, max: 3 });
		const result = gen();
		for (const obj of result) {
			expect(Object.keys(obj).sort()).toEqual(['category', 'price', 'product_id']);
		}
	});

	test('values are independently resolved per object', () => {
		const gen = objectList(template, { min: 5, max: 5 });
		const result = gen();
		const ids = result.map(o => o.product_id);
		const prices = result.map(o => o.price);
		const allSameId = ids.every(id => id === ids[0]);
		const allSamePrice = prices.every(p => p === prices[0]);
		expect(allSameId && allSamePrice).toBe(false);
	});

	test('returns ListValue instance', () => {
		const gen = objectList(template);
		const result = gen();
		expect(result).toBeInstanceOf(ListValue);
	});

	test('choose() passes through object list without picking', () => {
		const gen = objectList(template, { min: 3, max: 3 });
		const result = choose(gen);
		expect(result).toBeInstanceOf(ListValue);
		expect(result.length).toBe(3);
		expect(result[0]).toHaveProperty('product_id');
	});

	test('template with static values', () => {
		const staticTemplate = { type: 'widget', quantity: 1 };
		const gen = objectList(staticTemplate, { min: 2, max: 2 });
		const result = gen();
		expect(result).toHaveLength(2);
		expect(result[0].type).toBe('widget');
		expect(result[0].quantity).toBe(1);
	});

	test('default min/max are 1 and 5', () => {
		const gen = objectList(template);
		for (let i = 0; i < 20; i++) {
			const result = gen();
			expect(result.length).toBeGreaterThanOrEqual(1);
			expect(result.length).toBeLessThanOrEqual(5);
		}
	});
});


describe('end-to-end generation', () => {

	test('event properties with all three helpers produce correct shapes', async () => {
		const config = {
			seed: 'prop-helpers-e2e',
			numUsers: 10,
			numEvents: 100,
			numDays: 30,
			datasetStart: '2024-01-01T00:00:00Z',
			datasetEnd: '2024-01-31T00:00:00Z',
			format: 'json',
			writeToDisk: false,
			concurrency: 1,
			batchSize: 500_000,
			hasAdSpend: false,
			hasAnonIds: false,
			hasSessionIds: false,
			hasCampaigns: false,
			hasLocation: false,
			hasAvatar: false,
			hasBrowser: false,
			hasAndroidDevices: false,
			hasIOSDevices: false,
			hasDesktopDevices: false,
			events: [
				{
					event: 'checkout',
					weight: 3,
					properties: {
						total: weighNumRange(10, 500),
						cart_items: objectList({
							sku: weighNumRange(1000, 9999),
							name: ['Widget', 'Gadget', 'Doohickey', 'Thingamajig'],
							qty: [1, 1, 1, 2, 2, 3],
						}, { min: 1, max: 4 }),
						tags: listOf(['sale', 'new', 'featured', 'clearance', 'limited'], { min: 1, max: 3 }),
						order_date: dateRange(),
					}
				},
			],
			funnels: [],
			superProps: {},
			userProps: {},
			scdProps: {},
			mirrorProps: {},
			lookupTables: [],
			groupKeys: [],
			groupProps: {},
		};

		const result = await generate(config);
		const events = Array.from(result.eventData);
		const checkouts = events.filter(e => e.event === 'checkout');

		expect(checkouts.length).toBeGreaterThan(0);

		for (const ev of checkouts) {
			// cart_items is an array of objects
			expect(Array.isArray(ev.cart_items)).toBe(true);
			expect(ev.cart_items.length).toBeGreaterThanOrEqual(1);
			expect(ev.cart_items[0]).toHaveProperty('sku');
			expect(ev.cart_items[0]).toHaveProperty('name');
			expect(ev.cart_items[0]).toHaveProperty('qty');

			// tags is an array of strings
			expect(Array.isArray(ev.tags)).toBe(true);
			expect(ev.tags.length).toBeGreaterThanOrEqual(1);
			expect(typeof ev.tags[0]).toBe('string');

			// order_date is a date string
			expect(typeof ev.order_date).toBe('string');
			expect(ev.order_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}
	}, timeout);
});
