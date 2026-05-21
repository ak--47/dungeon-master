// ── IMPORTS ──
import * as u from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       datagen-v1.5-verify
 * PURPOSE:    Canonical v1.5 fixture — active-days, conversion window, touchpoint cap, auto-sort, determinism
 * SCALE:      500 users, ~60K events, 30 days
 * EVENTS (4): page view, click, sign up, purchase
 * FUNNELS (1): page view → sign up → purchase (50%, 14d window)
 *
 * Used by:
 *   - tests/active-days.test.js          → asserts distinct-day distribution shape
 *   - tests/conversion-window.test.js    → exercises Funnel.conversionWindowDays
 *   - tests/touchpoint-cap.test.js       → exercises maxTouchpointsPerUser
 *   - tests/datagen-determinism.test.js  → byte-equal verification across runs
 *   - tests/auto-sort.test.js            → relies on sorted output
 *
 * Realistic small-scale config with `hasCampaigns: true` + an explicit
 * `isAttributionEvent` flagged event so the touchpoint cap has eligible
 * candidates beyond the default ~25% legacy fallback.
 *
 * **DO NOT enable `engagementDecay`** — it interacts with `avgActiveDaysPerUser`
 * by dropping events on late picked days, eroding the effective active-day count
 * below the configured target. See HOOKS.md §2.5.
 */

// ── SCALE ──
const SEED = "datagen-v1.5-verify";
u.initChance(SEED);

// ── CONFIG ──
/** @type {Config} */
const config = {
	seed: SEED,
	// Pin the dataset window for full determinism (independent of run date).
	datasetStart: "2025-09-01T00:00:00Z",
	datasetEnd: "2025-10-01T00:00:00Z",
	numUsers: 500,
	avgEventsPerUserPerDay: 4,
	// v1.5 distinct-day primitive — concentrate events onto ~6 days/user.
	avgActiveDaysPerUser: 6,
	// v1.5 attribution cap — explicit (default is also 10).
	maxTouchpointsPerUser: 10,
	switches: {
		hasCampaigns: true,
		hasSessionIds: true,
	},
	identity: {
		avgDevicePerUser: 1,
	},
	autoSortAfterEverything: true,
	events: [
		{ event: "page view", weight: 5, isAttributionEvent: true },
		{ event: "click",     weight: 3 },
		{
			event: "sign up",
			isFirstEvent: true,
			isAuthEvent: true,
			isAttributionEvent: true,
			properties: { method: ["email", "google", "apple"] },
		},
		{
			event: "purchase",
			weight: 1,
			properties: { amount: u.weighNumRange(10, 200) },
		},
	],
	funnels: [
		{
			sequence: ["page view", "sign up", "purchase"],
			isFirstFunnel: true,
			conversionRate: 50,
			timeToConvert: 4, // hours
			// v1.5 explicit conversion window — well under the 30d default.
			conversionWindowDays: 14,
			order: "sequential",
		},
	],
	superProps: { Plan: ["Free", "Pro"] },
	userProps: { Plan: ["Free", "Pro"] },
	writeToDisk: false,
	verbose: false,
};

export default config;
