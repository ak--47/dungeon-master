// ── IMPORTS ──
import Chance from 'chance';
let chance = new Chance();
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { uid, comma } from 'ak-tools';
import { weighNumRange, date, integer, weighChoices } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       scale-test
 * PURPOSE:    High-volume scale fixture — exercises batch sizing, gzip, large file output, no hooks
 * SCALE:      10,000 users, ~500K events, 365 days
 * EVENTS (3): page view, click, api call
 * FUNNELS (0): none
 */

// ── SCALE ──
const SEED = "scale test";
const num_days = 365;
const num_users = 10_000;
const avg_events_per_user_per_day = 0.14;
const token = process.env.MP_TOKEN || "";

// ── CONFIG ──
/** @type {Config} */
const config = {
	seed: SEED,
	name: "scale-test",
	numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	format: 'json',
	gzip: true,
	concurrency: 1,
	credentials: {
		token,
		region: "US",
	},
	switches: {
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
	},
	writeToDisk: false,

	events: [
		{
			event: "page view",
			weight: 10,
			properties: {
				page: ["/", "/home", "/about", "/pricing", "/docs"],
			}
		},
		{
			event: "click",
			weight: 8,
			properties: {
				element: ["button", "link", "card", "nav", "tab"],
				label: ["submit", "cancel", "next", "back", "learn more"],
			}
		},
		{
			event: "api call",
			weight: 6,
			properties: {
				endpoint: ["/api/users", "/api/data", "/api/auth", "/api/events"],
				status: [200, 200, 200, 200, 201, 301, 400, 404, 500],
				latency_ms: weighNumRange(10, 2000, .25),
			}
		},
	],
	funnels: [],
	superProps: {},
	userProps: {
		plan: ["free", "pro", "enterprise"],
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
