// ── IMPORTS ──
import Chance from 'chance';
let chance = new Chance();
import { weighNumRange, weighChoices } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       anonymous-users
 * PURPOSE:    Anonymous-user mode fixture — exercises isAnonymous + hasAnonIds + anon-to-identified flow
 * SCALE:      1,000 users, ~50K events, 180 days
 * EVENTS (5): page view, signup, feature used, purchase, button click
 * FUNNELS (0): none
 */

// ── SCALE ──
const SEED = "anonymous-users";
const num_days = 180;
const num_users = 1_000;
const avg_events_per_user_per_day = 0.28;
const token = process.env.MP_TOKEN || "";

// ── CONFIG ──
/** @type {Config} */
const config = {
	seed: SEED,
	numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	format: "json",
	credentials: {
		token,
		region: "US",
	},
	switches: {
		isAnonymous: true,
		hasSessionIds: true,
		hasAdSpend: false,
		hasLocation: false,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: false,
		alsoInferFunnels: false,
	},
	identity: {
		avgDevicePerUser: 1,
	},
	concurrency: 1,
	writeToDisk: false,

	events: [
		{
			event: "page view",
			weight: 10,
			properties: {
				page: ["/", "/", "/features", "/pricing", "/docs", "/blog"],
				referrer: weighChoices(["direct", "direct", "direct", "google", "google", "twitter", "linkedin"]),
			}
		},
		{
			event: "signup",
			weight: 1,
			isFirstEvent: true,
			properties: {
				method: ["email", "google", "github", "sso"],
			}
		},
		{
			event: "feature used",
			weight: 7,
			properties: {
				feature: ["dashboard", "reports", "settings", "export", "import", "search"],
			}
		},
		{
			event: "purchase",
			weight: 2,
			properties: {
				amount: weighNumRange(10, 500, .25),
				plan: ["monthly", "annual"],
			}
		},
		{
			event: "button click",
			weight: 8,
			properties: {
				button: ["cta", "nav", "menu", "submit", "cancel", "back"],
				location: ["header", "body", "footer", "sidebar"],
			}
		},
	],

	funnels: [],

	superProps: {},

	userProps: {
		plan: weighChoices(["free", "free", "free", "pro", "pro", "enterprise"]),
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

export default config;
