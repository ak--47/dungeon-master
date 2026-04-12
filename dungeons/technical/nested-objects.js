import Chance from 'chance';
let chance = new Chance();
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { uid, comma } from 'ak-tools';
import { pickAWinner, weighNumRange, date, integer, weighChoices } from "../../lib/utils/utils.js";

/**
 * ═══════════════════════════════════════════════════════════════
 * TECHNICAL TEST: Nested Objects & High Cardinality
 * ═══════════════════════════════════════════════════════════════
 *
 * Tests Mixpanel's handling of:
 * - Array-of-object event properties (cart items, search results, form fields)
 * - Deeply nested object properties (metadata.browser.name, etc.)
 * - High cardinality string properties (10K product IDs, unique session IDs)
 *
 * 500 users, 30K events, 30 days. No hooks.
 */

const productCategories = ["electronics", "books", "clothing", "home", "garden", "toys", "sports", "automotive", "beauty", "health", "grocery", "jewelry", "shoes", "tools", "office"];
const browsers = ["Chrome", "Firefox", "Safari", "Edge", "Opera", "Brave"];
const browserVersions = ["120.0", "121.0", "119.0", "118.0", "117.0", "116.0", "115.0"];
const deviceTypes = ["desktop", "mobile", "tablet"];
const osList = ["Windows 11", "macOS 14", "iOS 17", "Android 14", "Linux", "ChromeOS"];
const cities = ["New York", "London", "Tokyo", "Berlin", "Sydney", "Toronto", "Paris", "Mumbai", "Seoul", "Mexico City", "Cairo", "Lagos", "Dubai", "Bangkok", "Istanbul"];
const countries = ["US", "UK", "JP", "DE", "AU", "CA", "FR", "IN", "KR", "MX", "EG", "NG", "AE", "TH", "TR"];

/** @type {import('../../types').Dungeon} */
const config = {
	seed: "nested objects test",
	name: "nested-objects",
	numDays: 30,
	numEvents: 30_000,
	numUsers: 500,
	format: 'json',
	region: "US",
	hasAnonIds: false,
	hasSessionIds: false,
	hasAdSpend: false,
	hasLocation: false,
	hasAndroidDevices: false,
	hasIOSDevices: false,
	hasDesktopDevices: true,
	hasBrowser: false,
	hasCampaigns: false,
	isAnonymous: false,
	alsoInferFunnels: false,
	concurrency: 1,
	batchSize: 500_000,
	writeToDisk: false,

	events: [
		{
			event: "checkout",
			weight: 3,
			properties: {
				// Array of objects: cart items
				cart: makeCartItems(),
				total_amount: weighNumRange(10, 2000, .25),
				currency: ["USD", "EUR", "GBP", "JPY", "CAD"],
				// High cardinality: unique session per event
				session_id: () => chance.guid(),
				// Deeply nested metadata
				metadata: makeMetadata(),
			}
		},
		{
			event: "search performed",
			weight: 5,
			properties: {
				query: ["laptop", "shoes", "headphones", "jacket", "phone case", "coffee maker", "backpack", "monitor", "keyboard", "mouse"],
				// Array of objects: search results
				results: makeSearchResults(),
				result_count: weighNumRange(0, 50),
				// High cardinality product ID
				top_result_id: () => `prod_${integer(1, 10000)}`,
				session_id: () => chance.guid(),
				metadata: makeMetadata(),
			}
		},
		{
			event: "form submitted",
			weight: 4,
			properties: {
				form_name: ["checkout", "signup", "contact", "feedback", "settings", "profile"],
				// Array of objects: form fields
				fields: makeFormFields(),
				submission_valid: [true, true, true, false],
				session_id: () => chance.guid(),
				metadata: makeMetadata(),
			}
		},
		{
			event: "page view",
			weight: 8,
			properties: {
				page: ["/", "/products", "/cart", "/search", "/account", "/help", "/about"],
				// High cardinality
				product_id: () => `prod_${integer(1, 10000)}`,
				session_id: () => chance.guid(),
				metadata: makeMetadata(),
			}
		},
	],
	funnels: [],
	superProps: {},
	userProps: {
		plan: ["free", "basic", "pro", "enterprise"],
	},
	scdProps: {},
	mirrorProps: {},
	groupKeys: [],
	groupProps: {},
	lookupTables: [],
	hook: function (record, type, meta) {
		return record;
	}
};

/**
 * Generates an array-of-objects property for cart items.
 * Each cart has 1-5 items with product_id, name, price, quantity, category.
 */
function makeCartItems() {
	return function () {
		const items = [];
		const count = integer(1, 5);
		for (let i = 0; i < count; i++) {
			items.push({
				product_id: `prod_${integer(1, 10000)}`,
				name: `${chance.pickone(["Premium", "Basic", "Ultra", "Eco", "Pro"])} ${chance.pickone(["Widget", "Gadget", "Device", "Tool", "Kit"])}`,
				price: integer(5, 500),
				quantity: integer(1, 4),
				category: chance.pickone(productCategories),
			});
		}
		return () => [items];
	};
}

/**
 * Generates an array-of-objects property for search results.
 * Each search has 1-5 results with result_id, title, score, sponsored.
 */
function makeSearchResults() {
	return function () {
		const results = [];
		const count = integer(1, 5);
		for (let i = 0; i < count; i++) {
			results.push({
				result_id: `res_${integer(1, 50000)}`,
				title: `${chance.pickone(["Best", "Top", "New", "Sale"])} ${chance.pickone(productCategories)} item`,
				score: parseFloat((Math.random() * 100).toFixed(2)),
				sponsored: chance.pickone([true, false, false, false]),
			});
		}
		return () => [results];
	};
}

/**
 * Generates an array-of-objects property for form fields.
 * Each form has 2-6 fields with field_name, value, valid.
 */
function makeFormFields() {
	return function () {
		const fieldNames = ["email", "name", "phone", "address", "city", "zip", "country", "card_number", "expiry", "cvv"];
		const fields = [];
		const count = integer(2, 6);
		const picked = chance.pickset(fieldNames, count);
		for (const name of picked) {
			fields.push({
				field_name: name,
				value: name === "email" ? chance.email() : chance.word(),
				valid: chance.pickone([true, true, true, false]),
			});
		}
		return () => [fields];
	};
}

/**
 * Generates a deeply nested metadata object:
 * metadata: { browser: { name, version }, device: { type, os }, location: { city, country } }
 */
function makeMetadata() {
	return function () {
		return {
			browser: {
				name: chance.pickone(browsers),
				version: chance.pickone(browserVersions),
			},
			device: {
				type: chance.pickone(deviceTypes),
				os: chance.pickone(osList),
			},
			location: {
				city: chance.pickone(cities),
				country: chance.pickone(countries),
			},
		};
	};
}

export default config;
