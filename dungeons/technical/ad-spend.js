// ── TWEAK THESE ──
const SEED = "ad spend test";
const num_days = 90;
const num_users = 1_000;
const avg_events_per_user_per_day = 0.56;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import Chance from 'chance';
let chance = new Chance();
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { uid, comma } from 'ak-tools';
import { weighNumRange, date, integer, weighChoices } from "../../lib/utils/utils.js";

/** @typedef {import("../../types").Dungeon} Config */
/**
 * ═══════════════════════════════════════════════════════════════
 * TECHNICAL TEST: Ad Spend & Campaign Attribution
 * ═══════════════════════════════════════════════════════════════
 *
 * Tests Mixpanel ad spend data generation and campaign attribution.
 * - 1,000 users, 50K events, 90 days
 * - hasAdSpend: true — generates cost, CPC, CTR, impressions, clicks
 * - hasCampaigns: true — adds UTM parameters to events
 * - hasBrowser: true — required for campaign tracking
 * - 6 events: signup, page view, purchase, ad click, search, share
 *
 * No hooks. Focus is on verifying ad spend event structure
 * and campaign attribution properties flow through correctly.
 */

/** @type {import('../../types').Dungeon} */
const config = {
	token,
	seed: SEED,
	name: "ad-spend",
	numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
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
