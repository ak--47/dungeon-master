// ── IMPORTS ──
import { weighNumRange } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       ad-spend
 * PURPOSE:    exercises hasAdSpend + hasCampaigns — generates cost/CPC/CTR/impressions/clicks + UTM attribution
 * SCALE:      1,000 users, ~50K events, 90 days
 * EVENTS (6): sign up, page view, purchase, ad click, search, share
 * FUNNELS (0): none
 */

// ── SCALE ──
const SEED = "ad spend test";
const NUM_DAYS = 90;
const NUM_USERS = 1_000;
const EVENTS_PER_DAY = 0.56;
const token = process.env.MP_TOKEN || "";

// ── CONFIG ──
/** @type {Config} */
const config = {
	token,
	seed: SEED,
	name: "ad-spend",
	numDays: NUM_DAYS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: 'json',
	region: "US",
	hasAnonIds: true,
	hasSessionIds: true,
	hasAdSpend: true,
	hasLocation: false,
	hasAndroidDevices: false,
	hasIOSDevices: false,
	hasDesktopDevices: true,
	hasBrowser: true,
	hasCampaigns: true,
	isAnonymous: false,
	alsoInferFunnels: false,
	concurrency: 1,
	writeToDisk: false,

	events: [
		{
			event: "sign up",
			weight: 1,
			isFirstEvent: true,
			properties: {
				method: ["email", "google", "facebook", "github"],
			}
		},
		{
			event: "page view",
			weight: 10,
			properties: {
				page: ["/", "/pricing", "/features", "/docs", "/blog", "/signup"],
			}
		},
		{
			event: "purchase",
			weight: 2,
			properties: {
				amount: weighNumRange(10, 500, .25),
				currency: ["USD", "EUR", "GBP"],
				item_count: weighNumRange(1, 8),
			}
		},
		{
			event: "ad click",
			weight: 6,
			properties: {
				partner: ["google", "facebook", "linkedin", "twitter", "bing", "tiktok"],
				ad_format: ["banner", "video", "carousel", "native", "search"],
				placement: ["feed", "sidebar", "header", "interstitial"],
			}
		},
		{
			event: "search",
			weight: 5,
			properties: {
				query_length: weighNumRange(1, 30),
				results_count: weighNumRange(0, 100, .25),
			}
		},
		{
			event: "share",
			weight: 3,
			properties: {
				platform: ["twitter", "facebook", "linkedin", "email"],
				content_type: ["product", "page", "deal"],
			}
		},
	],
	funnels: [],
	superProps: {},
	userProps: {
		plan: ["free", "starter", "pro", "enterprise"],
		signup_source: ["organic", "organic", "organic", "paid", "paid", "referral"],
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
