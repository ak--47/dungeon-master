/**
 * Mirror Strategies — tests all 4 mirror data strategies.
 *
 * Exercises: create, update, fill, delete mirror transformations.
 * Each mirror prop targets a different event and uses a different
 * strategy so the output can be diffed against the original data.
 *
 * - 500 users, 30K events, 30 days
 * - 5 simple events, no funnels, no hooks
 */

import Chance from 'chance';
let chance = new Chance();
import { weighNumRange, weighChoices } from "../../lib/utils/utils.js";

/** @typedef {import("../../types").Dungeon} Config */
/** @type {import('../../types').Dungeon} */
const config = {
	token: "",
	seed: "mirror-strategies",
	numDays: 30,
	numEvents: 30_000,
	numUsers: 500,
	format: "json",
	region: "US",
	hasAnonIds: false,
	hasSessionIds: false,
	hasAdSpend: false,
	hasLocation: false,
	hasAndroidDevices: false,
	hasIOSDevices: false,
	hasDesktopDevices: false,
	hasBrowser: false,
	hasCampaigns: false,
	isAnonymous: false,
	alsoInferFunnels: false,
	concurrency: 1,
	writeToDisk: false,

	events: [
		{
			event: "page view",
			weight: 10,
			properties: {
				page: ["/", "/help", "/account", "/pricing", "/product"],
			}
		},
		{
			event: "checkout",
			weight: 3,
			properties: {
				amount: weighNumRange(5, 200, .25),
				currency: ["USD", "EUR", "GBP"],
			}
		},
		{
			event: "profile update",
			weight: 4,
			properties: {
				field: ["name", "email", "avatar", "address", "phone"],
			}
		},
		{
			event: "subscription change",
			weight: 2,
			properties: {
				plan: ["free", "starter", "pro", "enterprise"],
				action: ["upgrade", "downgrade", "cancel", "renew"],
			}
		},
		{
			event: "login",
			weight: 8,
			properties: {
				method: ["password", "google", "sso"],
			}
		},
	],

	funnels: [],

	superProps: {},

	userProps: {
		plan: ["free", "starter", "pro", "enterprise"],
	},

	scdProps: {},

	mirrorProps: {
		// "update" — adds a status property to profile update events; keeps existing values
		user_status: {
			events: ["profile update"],
			strategy: "update",
			values: ["active", "inactive", "suspended", "pending"],
		},
		// "create" — always creates a new tier property on subscription change events
		subscription_tier: {
			events: ["subscription change"],
			strategy: "create",
			values: ["bronze", "silver", "gold", "platinum"],
		},
		// "fill" — fills login_source on login events only if older than 10 days
		login_source: {
			events: ["login"],
			strategy: "fill",
			values: ["web", "mobile", "api", "desktop"],
			daysUnfilled: 10,
		},
		// "delete" — removes the amount property from checkout events in the mirror
		amount: {
			events: ["checkout"],
			strategy: "delete",
		},
	},

	groupKeys: [],
	groupProps: {},
	lookupTables: [],

	hook: function (record, type, meta) {
		return record;
	}
};

export default config;
