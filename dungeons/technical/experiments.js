// ── IMPORTS ──
import Chance from "chance";
import { weighNumRange, weighChoices } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       experiments
 * PURPOSE:    Exercises funnel experiments (A/B/C variants), bindPropsIndex,
 *             and multiple funnel ordering modes (sequential, first-and-last-fixed, random).
 * SCALE:      2,000 users, ~100K events, 60 days
 * EVENTS (7): page view, signup, feature viewed, action taken, checkout, button click, help viewed
 * FUNNELS (4): Onboarding Flow (sequential, experiment), Purchase Funnel (first-and-last-fixed, experiment),
 *              Feature Adoption (random, experiment, bindPropsIndex), Quick Signup (sequential, control)
 */

// ── SCALE ──
const SEED = "experiments";
const NUM_DAYS = 60;
const NUM_USERS = 2_000;
const EVENTS_PER_DAY = 0.83;
const token = process.env.MP_TOKEN || "";

const chance = new Chance();

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
	hasSessionIds: true,
	hasAdSpend: false,
	hasLocation: false,
	hasAndroidDevices: true,
	hasIOSDevices: true,
	hasDesktopDevices: true,
	hasBrowser: true,
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
				page: ["/", "/features", "/pricing", "/docs", "/about"],
			}
		},
		{
			event: "signup",
			weight: 1,
			isFirstEvent: true,
			properties: {
				method: ["email", "google", "github"],
				referral: weighChoices(["organic", "organic", "organic", "ad", "friend", "friend"]),
			}
		},
		{
			event: "feature viewed",
			weight: 7,
			properties: {
				feature: ["analytics", "funnels", "retention", "flows", "reports"],
				source: ["nav", "search", "recommendation", "link"],
			}
		},
		{
			event: "action taken",
			weight: 5,
			properties: {
				action: ["create", "edit", "delete", "share", "export"],
				target: ["report", "dashboard", "chart", "segment"],
			}
		},
		{
			event: "checkout",
			weight: 2,
			properties: {
				amount: weighNumRange(29, 499, .25),
				plan: ["starter", "growth", "enterprise"],
				billing: ["monthly", "annual"],
			}
		},
		{
			event: "button click",
			weight: 8,
			properties: {
				button: ["cta", "upgrade", "try-free", "learn-more", "contact-sales"],
				location: ["hero", "header", "pricing-card", "feature-section"],
			}
		},
		{
			event: "help viewed",
			weight: 4,
			properties: {
				article: ["getting-started", "billing-faq", "api-docs", "integrations", "data-export"],
			}
		},
	],

	funnels: [
		{
			// A/B/C experiment with sequential order
			sequence: ["page view", "signup", "feature viewed", "action taken"],
			conversionRate: 45,
			order: "sequential",
			weight: 5,
			isFirstFunnel: true,
			timeToConvert: 3,
			experiment: true,
			name: "Onboarding Flow",
		},
		{
			// A/B/C experiment with first-and-last-fixed order
			sequence: ["page view", "feature viewed", "button click", "checkout"],
			conversionRate: 30,
			order: "first-and-last-fixed",
			weight: 8,
			timeToConvert: 5,
			experiment: true,
			name: "Purchase Funnel",
		},
		{
			// A/B/C experiment with random order + bindPropsIndex
			sequence: ["feature viewed", "action taken", "help viewed", "action taken"],
			conversionRate: 50,
			order: "random",
			weight: 4,
			timeToConvert: 2,
			experiment: true,
			requireRepeats: true,
			bindPropsIndex: 2,
			name: "Feature Adoption",
			props: {
				experiment_cohort: ["new_ui", "classic_ui"],
			},
		},
		{
			// Non-experiment control funnel (sequential, no variants)
			sequence: ["page view", "button click", "signup"],
			conversionRate: 40,
			order: "sequential",
			weight: 6,
			isFirstFunnel: true,
			timeToConvert: 1,
			name: "Quick Signup",
		},
	],

	superProps: {
		platform: ["web", "web", "ios", "android"],
	},

	userProps: {
		plan: weighChoices(["free", "free", "free", "starter", "growth", "enterprise"]),
		platform: ["web", "web", "ios", "android"],
	},

	scdProps: {},
	mirrorProps: {},
	groupKeys: [],
	groupProps: {},
	lookupTables: [],

	hook: function (record, type, meta) {
		if (type === "everything") {
			const profile = meta.profile;
			record.forEach(e => {
				e.platform = profile.platform;
			});
			return record;
		}
		return record;
	}
};

export default config;
