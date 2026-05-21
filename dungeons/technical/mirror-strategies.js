// ── IMPORTS ──
import { weighNumRange } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       mirror-strategies
 * PURPOSE:    exercises all 4 mirrorProps strategies (create, update, fill, delete)
 * SCALE:      500 users, ~30K events, 30 days
 * EVENTS (5): page view, checkout, profile update, subscription change, login
 * FUNNELS (0): none
 */

// ── SCALE ──
const SEED = "mirror-strategies";
const NUM_DAYS = 30;
const NUM_USERS = 500;
const EVENTS_PER_DAY = 2;
const token = process.env.MP_TOKEN || "";

// ── CONFIG ──
/** @type {Config} */
const config = {
	token,
	seed: SEED,
	numDays: NUM_DAYS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
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
