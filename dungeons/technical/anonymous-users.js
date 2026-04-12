/**
 * Anonymous Users — tests anonymous user mode, anonIds, and identity merge.
 *
 * Exercises: isAnonymous mode, hasAnonIds for anonymous-to-identified
 * user flows, long 180-day timespan for tail behavior.
 *
 * - 1000 users, 50K events, 180 days
 * - isAnonymous: true, hasAnonIds: true
 * - Simple events with signup as isFirstEvent (identity resolution point)
 * - No hooks, minimal config
 */

import Chance from 'chance';
let chance = new Chance();
import { pickAWinner, weighNumRange, weighChoices } from "../../lib/utils/utils.js";

/** @type {import('../../types').Dungeon} */
const config = {
	token: "",
	seed: "anonymous-users",
	numDays: 180,
	numEvents: 50_000,
	numUsers: 1_000,
	format: "json",
	region: "US",
	isAnonymous: true,
	hasAnonIds: true,
	hasSessionIds: true,
	hasAdSpend: false,
	hasLocation: false,
	hasAndroidDevices: true,
	hasIOSDevices: true,
	hasDesktopDevices: true,
	hasBrowser: true,
	hasCampaigns: false,
	alsoInferFunnels: false,
	concurrency: 1,
	batchSize: 2_500_000,
	writeToDisk: false,

	events: [
		{
			event: "page view",
			weight: 10,
			properties: {
				page: pickAWinner(["/", "/", "/features", "/pricing", "/docs", "/blog"]),
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
