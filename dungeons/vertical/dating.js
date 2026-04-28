// ── TWEAK THESE ──
const SEED = "meetcute";
const num_days = 120;
const num_users = 8_000;
const avg_events_per_user_per_day = 0.75;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";

dayjs.extend(utc);
const chance = u.initChance(SEED);
const NOW = dayjs();
const DATASET_START = NOW.subtract(num_days, "days");

/** @typedef  {import("../../types").Dungeon} Config */

/*
 * =====================================================================================
 * DATASET OVERVIEW
 * =====================================================================================
 *
 * MeetCute — a swipe-based dating app (Hinge/Tinder-style) with profile
 * prompts, photo verification, matchmaking, messaging, and premium tiers.
 *
 * CORE LOOP:
 * Users create a profile with photos and prompts, swipe on potential
 * matches, receive matches, message matches, exchange phone numbers,
 * and schedule dates. Premium subscribers get boosts, super-likes,
 * and see-who-liked-you.
 *
 * - 8,000 users over 120 days
 * - ~720,000 base events across 17 event types
 * - 4 funnels (onboarding, match flow, date funnel, monetization)
 * - 3 subscription tiers: Free, Premium, Elite
 *
 * Key entities:
 * - swipe_source: feed / discover / boost / nearby
 * - subscription: Free / Premium / Elite
 * - venue_type: coffee / dinner / drinks / activity / virtual
 * - prompt_type: icebreaker / opinion / hypothetical / personal / creative
 *
 * =====================================================================================
 */

/*
 * =====================================================================================
 * ANALYTICS HOOKS (8 hooks)
 * =====================================================================================
 *
 * -------------------------------------------------------------------------------------
 * 1. PHOTO UPLOAD CONVERSION (everything hook)
 * -------------------------------------------------------------------------------------
 * PATTERN: Users with 4+ "photo uploaded" events get 5x more "match received"
 * events injected (cloned from existing matches). complete_profile=true on
 * those match events. Complete profiles are magnets.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Match Volume by Profile Completeness
 *   - Insights > "match received" > Total per user > Breakdown: "complete_profile"
 *   - Expected: complete_profile=true users have ~5x more matches
 *
 *   Report 2: Photo Count Correlation
 *   - Insights > "photo uploaded" > Uniques > Compare to "match received" > Uniques
 *   - Expected: strong positive correlation between photo uploads and matches
 *
 * -------------------------------------------------------------------------------------
 * 2. WEEKEND SWIPE SURGE (event hook)
 * -------------------------------------------------------------------------------------
 * PATTERN: On Sunday evenings (day=0, hour 18-23), "swipe right" events are
 * duplicated 2.5x with weekend_surge=true. The Sunday Scaries drive swipes.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Swipe Volume by Day of Week
 *   - Insights (bar) > "swipe right" > Total > Breakdown: Day of Week
 *   - Expected: Sunday bar significantly taller than other days
 *
 *   Report 2: Weekend Surge Flag
 *   - Insights (line) > "swipe right" > Total > Breakdown: "weekend_surge"
 *   - Expected: weekend_surge=true events clustered on Sunday evenings
 *
 * -------------------------------------------------------------------------------------
 * 3. SUPER-LIKE EFFECT (everything hook)
 * -------------------------------------------------------------------------------------
 * PATTERN: "swipe right" events with is_super_like=true generate 3x more
 * "match received" events nearby in time. super_like_match=true on those
 * matches. Super-likes dramatically improve match rates.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Match Rate by Super-Like
 *   - Insights > "match received" > Total per user > Breakdown: "super_like_match"
 *   - Expected: super_like_match=true concentrated among super-likers
 *
 *   Report 2: Super-Like Conversion
 *   - Funnels > "swipe right" (filter: is_super_like=true) > "match received"
 *   - Compare to: "swipe right" (filter: is_super_like=false) > "match received"
 *   - Expected: super-like funnel ~3x higher conversion
 *
 * -------------------------------------------------------------------------------------
 * 4. PREMIUM MATCH BOOST (everything hook)
 * -------------------------------------------------------------------------------------
 * PATTERN: Premium subscribers get 2x "match received" events. Elite
 * subscribers get 4x + injected "profile viewed" events (see-who-liked-you).
 * premium_boost=true on injected events. Subscription pays off.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Matches by Subscription Tier
 *   - Insights > "match received" > Total per user > Breakdown: user prop "subscription"
 *   - Expected: Free ~baseline, Premium ~2x, Elite ~4x
 *
 *   Report 2: Profile Views (Elite Exclusive)
 *   - Insights > "profile viewed" > Total > Breakdown: "premium_boost"
 *   - Expected: premium_boost=true events only from Elite subscribers
 *
 * -------------------------------------------------------------------------------------
 * 5. GHOSTING CHURN (everything hook)
 * -------------------------------------------------------------------------------------
 * PATTERN: Users who receive a match but send zero messages within 48 hours
 * lose 70% of their events after the match date. ghosted=true stamped on
 * remaining "app opened" events. Ghosters churn.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Retention by Messaging Behavior
 *   - Retention > Starting: "match received" > Return: any event
 *   - Segment: users who did "message sent" vs users who didn't
 *   - Expected: non-messengers have ~70% lower retention
 *
 *   Report 2: Ghost Flag
 *   - Insights (line) > "app opened" > Total > Breakdown: "ghosted"
 *   - Expected: ghosted=true users trail off sharply after match date
 *
 * -------------------------------------------------------------------------------------
 * 6. BIO + PROMPT POWER USERS (everything hook)
 * -------------------------------------------------------------------------------------
 * PATTERN: Users with both "bio updated" AND 3+ "prompt answered" events
 * get 4x "date scheduled" events. complete_profile_power=true on injected
 * dates. Effort on profile = real dates.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Dates by Profile Effort
 *   - Insights > "date scheduled" > Total per user > Breakdown: "complete_profile_power"
 *   - Expected: complete_profile_power=true users schedule ~4x more dates
 *
 *   Report 2: Profile Effort Funnel
 *   - Funnels > "bio updated" > "prompt answered" > "date scheduled"
 *   - Expected: users completing all 3 have dramatically higher date rates
 *
 * -------------------------------------------------------------------------------------
 * 7. VALENTINE'S DAY SPIKE (event + everything hook)
 * -------------------------------------------------------------------------------------
 * PATTERN: Day 60 = Feb 14. Days 58-63: "profile created" events 3x via
 * cloned events (valentines=true). In everything hook, "premium upgrade"
 * events 5x for users active during V-Day window. Love is expensive.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Signup Spike
 *   - Insights (line) > "profile created" > Total > Daily
 *   - Expected: sharp 3x spike around day 58-63
 *
 *   Report 2: Premium Upgrades Around V-Day
 *   - Insights (line) > "premium upgrade" > Total > Breakdown: "valentines"
 *   - Expected: 5x premium upgrades during V-Day window
 *
 * -------------------------------------------------------------------------------------
 * 8. OFF-APP RETENTION (everything hook)
 * -------------------------------------------------------------------------------------
 * PATTERN: Users with "phone number exchanged" OR "date scheduled" in first
 * 14 days maintain 60% D30 retention (extra events injected). Users without
 * these milestones lose events after day 30 — the app becomes irrelevant
 * once they find someone IRL.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Retention by Milestone
 *   - Retention > Starting: "profile created" > Return: any event
 *   - Segment: users who did "date scheduled" in first 14 days vs not
 *   - Expected: milestone users ~60% D30 retention vs ~20% for others
 *
 *   Report 2: Long-Term Engagement
 *   - Insights (line) > "app opened" > Total per user > Weekly > Breakdown: user prop "subscription"
 *   - Expected: after week 4, non-milestone users nearly disappear
 *
 * =====================================================================================
 * EXPECTED METRICS SUMMARY
 * =====================================================================================
 *
 * Hook                        | Metric               | Baseline | Effect   | Ratio
 * ───────────────────────────-|──────────────────────-|──────────|──────────|──────
 * Photo Upload Conversion     | matches/user          | ~3       | ~15      | 5x
 * Weekend Swipe Surge         | Sunday swipes          | 1x       | 2.5x     | 2.5x
 * Super-Like Effect           | matches from super     | 1x       | 3x       | 3x
 * Premium Match Boost         | matches (Elite)        | 1x       | 4x       | 4x
 * Ghosting Churn              | post-match retention   | 100%     | 30%      | 0.3x
 * Bio + Prompt Power Users    | dates/user             | 1x       | 4x       | 4x
 * Valentine's Day Spike       | signups (days 58-63)   | 1x       | 3x       | 3x
 * Off-App Retention           | D30 retention          | ~20%     | ~60%     | 3x
 *
 * =====================================================================================
 * ADVANCED ANALYSIS IDEAS
 * =====================================================================================
 *
 * - Photo Conversion + Premium Boost: Do complete-profile Elite users compound
 *   to 20x matches (5x photos * 4x Elite)?
 * - Weekend Surge + Super-Like: Sunday evening super-likes should be the
 *   highest-converting swipe segment.
 * - Ghosting + Off-App Retention: Users who ghost AND never schedule a date
 *   churn fastest — double negative retention effect.
 * - Valentine's Spike + Monetization: V-Day signups who upgrade to Premium
 *   within 7 days have the highest LTV window.
 * - Bio/Prompt Power + Date Scheduling: Complete profile users schedule dates
 *   at 4x the rate, but do they also have higher message response rates?
 * - Cohort by age_range, gender, subscription tier, and signup week.
 * - Funnel analysis: onboarding by gender, match flow by subscription,
 *   date funnel by profile completeness.
 * =====================================================================================
 */

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: false,
	hasSessionIds: true,
	format: "json",
	gzip: true,
	alsoInferFunnels: false,
	hasLocation: true,
	hasAndroidDevices: true,
	hasIOSDevices: true,
	hasDesktopDevices: false,
	hasBrowser: false,
	hasCampaigns: false,
	isAnonymous: false,
	hasAdSpend: false,
	hasAvatar: true,
	concurrency: 1,
	writeToDisk: false,
	soup: "growth",

	// ── Events (17) ──────────────────────────────────────────
	events: [
		{
			event: "profile created",
			weight: 1,
			isFirstEvent: true,
			properties: {
				age_range: ["18-24", "25-29", "30-34", "35-39", "40+"],
				gender: ["Male", "Male", "Female", "Female", "Non-binary"],
				looking_for: ["Men", "Women", "Everyone"],
				valentines: [false],
			},
		},
		{
			event: "photo uploaded",
			weight: 3,
			properties: {
				photo_number: u.weighNumRange(1, 6, 0.5, 2),
				has_face: [true, true, true, true, false],
			},
		},
		{
			event: "bio updated",
			weight: 2,
			properties: {
				bio_length: u.weighNumRange(10, 500, 0.4, 120),
			},
		},
		{
			event: "prompt answered",
			weight: 3,
			properties: {
				prompt_type: ["icebreaker", "opinion", "hypothetical", "personal", "creative"],
				answer_length: u.weighNumRange(10, 300, 0.4, 80),
			},
		},
		{
			event: "swipe right",
			weight: 10,
			properties: {
				is_super_like: [false, false, false, false, false, false, false, false, false, true],
				weekend_surge: [false],
				swipe_source: ["feed", "feed", "feed", "discover", "boost", "nearby"],
			},
		},
		{
			event: "swipe left",
			weight: 8,
			properties: {
				swipe_source: ["feed", "feed", "feed", "discover", "boost", "nearby"],
			},
		},
		{
			event: "match received",
			weight: 4,
			properties: {
				match_score: u.weighNumRange(50, 100, 0.5, 75),
				complete_profile: [false],
				super_like_match: [false],
				premium_boost: [false],
			},
		},
		{
			event: "message sent",
			weight: 6,
			properties: {
				message_length: u.weighNumRange(1, 500, 0.3, 40),
				has_emoji: [false, false, true, true, true],
				response_time_mins: u.weighNumRange(1, 1440, 0.3, 30),
			},
		},
		{
			event: "message received",
			weight: 5,
			properties: {
				message_length: u.weighNumRange(1, 500, 0.3, 50),
			},
		},
		{
			event: "phone number exchanged",
			weight: 1,
			properties: {
				exchange_method: ["in_chat", "in_chat", "voice_call", "video_call"],
			},
		},
		{
			event: "date scheduled",
			weight: 1,
			properties: {
				venue_type: ["coffee", "dinner", "drinks", "activity", "virtual"],
				complete_profile_power: [false],
			},
		},
		{
			event: "profile viewed",
			weight: 5,
			properties: {
				viewer_source: ["feed", "discover", "liked_you", "nearby"],
				premium_boost: [false],
			},
		},
		{
			event: "premium upgrade",
			weight: 1,
			properties: {
				plan: ["Premium", "Premium", "Premium", "Elite"],
				price_usd: [14.99, 14.99, 14.99, 29.99],
				valentines: [false],
			},
		},
		{
			event: "premium cancelled",
			weight: 1,
			isStrictEvent: true,
			properties: {
				cancel_reason: ["found_someone", "too_expensive", "not_enough_matches", "bad_experience", "taking_a_break"],
				subscription_duration_days: u.weighNumRange(7, 365, 0.3, 30),
			},
		},
		{
			event: "boost activated",
			weight: 2,
			properties: {
				boost_type: ["standard", "super"],
				boost_duration_mins: [15, 30, 30, 60],
			},
		},
		{
			event: "report user",
			weight: 1,
			isStrictEvent: true,
			properties: {
				report_reason: ["fake_profile", "inappropriate_photos", "harassment", "spam", "underage"],
			},
		},
		{
			event: "app opened",
			weight: 8,
			properties: {
				session_duration_mins: u.weighNumRange(1, 120, 0.3, 8),
				ghosted: [false],
			},
		},
	],

	// ── Funnels (4) ──────────────────────────────────────────
	funnels: [
		{
			name: "Onboarding",
			sequence: ["profile created", "photo uploaded", "swipe right"],
			conversionRate: 75,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 1,
			weight: 3,
		},
		{
			name: "Match Flow",
			sequence: ["swipe right", "match received", "message sent"],
			conversionRate: 50,
			order: "sequential",
			timeToConvert: 24,
			weight: 6,
		},
		{
			name: "Date Funnel",
			sequence: ["message sent", "phone number exchanged", "date scheduled"],
			conversionRate: 25,
			order: "sequential",
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Monetization",
			sequence: ["app opened", "boost activated", "premium upgrade"],
			conversionRate: 20,
			order: "sequential",
			timeToConvert: 48,
			weight: 2,
		},
	],

	// ── SuperProps ──────────────────────────────────────────
	superProps: {
		subscription: ["Free", "Free", "Free", "Premium", "Elite"],
		platform: ["ios", "ios", "android"],
	},

	// ── UserProps ──────────────────────────────────────────
	userProps: {
		subscription: ["Free", "Free", "Free", "Premium", "Elite"],
		age_range: ["18-24", "25-29", "30-34", "35-39", "40+"],
		gender: ["Male", "Male", "Female", "Female", "Non-binary"],
		looking_for: ["Men", "Women", "Everyone"],
		photo_count: u.weighNumRange(0, 8, 0.4, 3),
		total_matches: u.weighNumRange(0, 200, 0.3, 15),
		total_messages_sent: u.weighNumRange(0, 500, 0.3, 30),
		profile_completeness: ["incomplete", "incomplete", "basic", "basic", "complete"],
		platform: ["ios", "ios", "android"],
	},

	// ── SCD Props ──────────────────────────────────────────
	scdProps: {
		subscription_tier: {
			values: ["Free", "Premium", "Elite"],
			frequency: "month",
			timing: "fuzzy",
			max: 6,
		},
	},

	groupKeys: [],
	groupProps: {},
	mirrorProps: {},
	lookupTables: [],

	// ── Hook Function ──────────────────────────────────────
	hook: function (record, type, meta) {
		const VALENTINES_DAY = DATASET_START.add(60, "days");
		const VDAY_WINDOW_START = DATASET_START.add(58, "days");
		const VDAY_WINDOW_END = DATASET_START.add(63, "days");

		// ─── EVENT-LEVEL HOOKS ───────────────────────────────────────────

		if (type === "event") {
			const EVENT_TIME = dayjs(record.time);

			// ── HOOK 2: WEEKEND SWIPE SURGE ─────────────────
			// Tagging moved to everything hook (sessionization reassigns times after event hook)

			// ── HOOK 7: VALENTINE'S DAY SPIKE (event part) ──
			// Days 58-63: tag profile created events for 3x duplication
			if (record.event === "profile created") {
				if (EVENT_TIME.isAfter(VDAY_WINDOW_START) && EVENT_TIME.isBefore(VDAY_WINDOW_END)) {
					record.valentines = true;
				}
			}
		}

		// ─── EVERYTHING-LEVEL HOOKS ──────────────────────────────────────

		if (type === "everything") {
			const events = record;
			if (!events || events.length === 0) return record;

			const profile = meta.profile || {};

			// Stamp superProps from profile for consistency
			events.forEach(e => {
				if (profile.subscription) e.subscription = profile.subscription;
				if (profile.platform) e.platform = profile.platform;
			});

			// ── First pass: scan user patterns ──
			let photoUploadCount = 0;
			let promptAnsweredCount = 0;
			let hasBioUpdated = false;
			let matchEvents = [];
			let messageSentEvents = [];
			let hasSuperLike = false;
			let superLikeEvents = [];
			let hasPhoneExchangedEarly = false;
			let hasDateScheduledEarly = false;
			let firstEventTime = null;

			events.forEach(event => {
				if (!firstEventTime || dayjs(event.time).isBefore(dayjs(firstEventTime))) {
					firstEventTime = event.time;
				}
				if (event.event === "photo uploaded") photoUploadCount++;
				if (event.event === "prompt answered") promptAnsweredCount++;
				if (event.event === "bio updated") hasBioUpdated = true;
				if (event.event === "match received") matchEvents.push(event);
				if (event.event === "message sent") messageSentEvents.push(event);
				if (event.event === "swipe right" && event.is_super_like === true) {
					hasSuperLike = true;
					superLikeEvents.push(event);
				}
			});

			// Check early milestones (first 14 days)
			if (firstEventTime) {
				const earlyWindow = dayjs(firstEventTime).add(14, "days");
				events.forEach(event => {
					const t = dayjs(event.time);
					if (t.isBefore(earlyWindow)) {
						if (event.event === "phone number exchanged") hasPhoneExchangedEarly = true;
						if (event.event === "date scheduled") hasDateScheduledEarly = true;
					}
				});
			}

			// ── HOOK 1: PHOTO UPLOAD CONVERSION ─────────────
			// Users with 4+ photo uploads get 5x match events
			if (photoUploadCount >= 4 && matchEvents.length > 0) {
				const matchTemplate = matchEvents[0];
				const extraMatches = matchEvents.length * 4; // 4 additional = 5x total
				for (let i = 0; i < extraMatches; i++) {
					const sourceMatch = matchEvents[i % matchEvents.length];
					events.push({
						...matchTemplate,
						event: "match received",
						time: dayjs(sourceMatch.time).add(chance.integer({ min: 1, max: 180 }), "minutes").toISOString(),
						user_id: sourceMatch.user_id,
						match_score: chance.integer({ min: 60, max: 98 }),
						complete_profile: true,
						super_like_match: false,
						premium_boost: false,
					});
				}
			}

			// ── HOOK 2: WEEKEND SWIPE SURGE (everything part) ─
			// Tag Sunday evening swipes AFTER sessionization has finalized times
			events.forEach(event => {
				if (event.event === "swipe right") {
					const dow = new Date(event.time).getUTCDay();
					const hr = new Date(event.time).getUTCHours();
					if (dow === 0 && hr >= 18 && hr <= 23) {
						event.weekend_surge = true;
					}
				}
			});
			// Duplicate weekend_surge=true swipes to create 2.5x volume
			for (let idx = events.length - 1; idx >= 0; idx--) {
				const event = events[idx];
				if (event.event === "swipe right" && event.weekend_surge === true) {
					// Add 1.5 extra copies on average (1 always + 50% chance of second)
					const etime = dayjs(event.time);
					events.push({
						...event,
						time: etime.add(chance.integer({ min: 1, max: 30 }), "minutes").toISOString(),
						user_id: event.user_id,
					});
					if (chance.bool({ likelihood: 50 })) {
						events.push({
							...event,
							time: etime.add(chance.integer({ min: 5, max: 60 }), "minutes").toISOString(),
							user_id: event.user_id,
						});
					}
				}
			}

			// ── HOOK 3: SUPER-LIKE EFFECT ───────────────────
			// Super-likes generate 3x more matches nearby in time
			if (hasSuperLike && superLikeEvents.length > 0) {
				const matchTemplate = matchEvents.length > 0
					? matchEvents[0]
					: events.find(e => e.event === "swipe right") || events[0];

				superLikeEvents.forEach(sle => {
					for (let i = 0; i < 3; i++) {
						events.push({
							...matchTemplate,
							event: "match received",
							time: dayjs(sle.time).add(chance.integer({ min: 5, max: 120 }), "minutes").toISOString(),
							user_id: sle.user_id,
							match_score: chance.integer({ min: 70, max: 99 }),
							complete_profile: false,
							super_like_match: true,
							premium_boost: false,
						});
					}
				});
			}

			// ── HOOK 4: PREMIUM MATCH BOOST ─────────────────
			// Premium: 2x matches. Elite: 4x matches + profile viewed (see-who-liked-you).
			const sub = profile.subscription;
			if ((sub === "Premium" || sub === "Elite") && matchEvents.length > 0) {
				const multiplier = sub === "Elite" ? 3 : 1; // +3 = 4x total for Elite, +1 = 2x for Premium
				const matchTemplate = matchEvents[0];

				for (let i = 0; i < matchEvents.length * multiplier; i++) {
					const sourceMatch = matchEvents[i % matchEvents.length];
					events.push({
						...matchTemplate,
						event: "match received",
						time: dayjs(sourceMatch.time).add(chance.integer({ min: 10, max: 240 }), "minutes").toISOString(),
						user_id: sourceMatch.user_id,
						match_score: chance.integer({ min: 65, max: 99 }),
						complete_profile: false,
						super_like_match: false,
						premium_boost: true,
					});
				}

				// Elite exclusive: inject "profile viewed" events (see-who-liked-you)
				if (sub === "Elite") {
					const viewTemplate = events.find(e => e.event === "profile viewed") || matchTemplate;
					matchEvents.forEach(m => {
						events.push({
							...viewTemplate,
							event: "profile viewed",
							time: dayjs(m.time).subtract(chance.integer({ min: 10, max: 120 }), "minutes").toISOString(),
							user_id: m.user_id,
							viewer_source: "liked_you",
							premium_boost: true,
						});
					});
				}
			}

			// ── HOOK 6: BIO + PROMPT POWER USERS ────────────
			// Users with bio updated AND 3+ prompts get 4x date scheduled
			if (hasBioUpdated && promptAnsweredCount >= 3) {
				const dateEvents = events.filter(e => e.event === "date scheduled");
				if (dateEvents.length > 0) {
					const dateTemplate = dateEvents[0];
					const extraDates = dateEvents.length * 3; // +3 = 4x total
					const venueTypes = ["coffee", "dinner", "drinks", "activity", "virtual"];
					for (let i = 0; i < extraDates; i++) {
						const sourceDate = dateEvents[i % dateEvents.length];
						events.push({
							...dateTemplate,
							event: "date scheduled",
							time: dayjs(sourceDate.time).add(chance.integer({ min: 1, max: 72 }), "hours").toISOString(),
							user_id: sourceDate.user_id,
							venue_type: chance.pickone(venueTypes),
							complete_profile_power: true,
						});
					}
				}
			}

			// ── HOOK 7: VALENTINE'S DAY SPIKE (everything part) ─
			// 3x profile created events during V-Day window (via cloning tagged events)
			const vdaySignups = events.filter(e => e.event === "profile created" && e.valentines === true);
			vdaySignups.forEach(signup => {
				for (let i = 0; i < 2; i++) { // +2 clones = 3x total
					events.push({
						...signup,
						time: dayjs(signup.time).add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
						user_id: signup.user_id,
						valentines: true,
					});
				}
			});

			// 5x premium upgrade events for users active during V-Day window
			const vdayUpgrades = events.filter(e =>
				e.event === "premium upgrade" &&
				dayjs(e.time).isAfter(VDAY_WINDOW_START) &&
				dayjs(e.time).isBefore(VDAY_WINDOW_END)
			);
			if (vdayUpgrades.length > 0) {
				const upgradeTemplate = vdayUpgrades[0];
				vdayUpgrades.forEach(upgrade => {
					for (let i = 0; i < 4; i++) { // +4 clones = 5x total
						events.push({
							...upgradeTemplate,
							event: "premium upgrade",
							time: dayjs(upgrade.time).add(chance.integer({ min: 1, max: 24 }), "hours").toISOString(),
							user_id: upgrade.user_id,
							plan: upgrade.plan,
							price_usd: upgrade.price_usd,
							valentines: true,
						});
					}
				});
			}

			// ── HOOK 5: GHOSTING CHURN ──────────────────────
			// Users with match but no message within 48 hours → lose 70% of later events
			let isGhoster = false;
			if (matchEvents.length > 0) {
				// Check if any match has a message within 48 hours
				let hasTimely = false;
				for (const m of matchEvents) {
					const matchTime = dayjs(m.time);
					const deadline = matchTime.add(48, "hours");
					for (const msg of messageSentEvents) {
						const msgTime = dayjs(msg.time);
						if (msgTime.isAfter(matchTime) && msgTime.isBefore(deadline)) {
							hasTimely = true;
							break;
						}
					}
					if (hasTimely) break;
				}

				if (!hasTimely) {
					isGhoster = true;
					// Find earliest match time as churn reference point
					const earliestMatch = matchEvents.reduce((min, m) =>
						dayjs(m.time).isBefore(dayjs(min.time)) ? m : min
					);
					const churnAfter = dayjs(earliestMatch.time);

					for (let i = events.length - 1; i >= 0; i--) {
						const evt = events[i];
						if (dayjs(evt.time).isAfter(churnAfter)) {
							if (chance.bool({ likelihood: 70 })) {
								events.splice(i, 1);
							} else if (evt.event === "app opened") {
								evt.ghosted = true;
							}
						}
					}
				}
			}

			// ── HOOK 8: OFF-APP RETENTION ───────────────────
			// Users with phone exchange or date in first 14 days: 60% D30 retention
			// Others: lose events after day 30
			if (firstEventTime) {
				const day30 = dayjs(firstEventTime).add(30, "days");
				const hasEarlyMilestone = hasPhoneExchangedEarly || hasDateScheduledEarly;

				if (hasEarlyMilestone) {
					// Good retention: inject extra events after day 30 to sustain engagement
					const appOpenedTemplate = events.find(e => e.event === "app opened") || events[0];
					const swipeTemplate = events.find(e => e.event === "swipe right") || events[0];
					const postDay30Events = events.filter(e => dayjs(e.time).isAfter(day30));

					// If they don't have enough post-day30 events, inject some
					if (postDay30Events.length < events.length * 0.3) {
						const retentionCount = Math.floor(events.length * 0.3);
						for (let i = 0; i < retentionCount; i++) {
							const daysAfter = chance.integer({ min: 1, max: 60 });
							const template = chance.bool({ likelihood: 50 }) ? appOpenedTemplate : swipeTemplate;
							events.push({
								...template,
								time: day30.add(daysAfter, "days").add(chance.integer({ min: 0, max: 23 }), "hours").toISOString(),
								user_id: template.user_id,
							});
						}
					}
				} else {
					// No milestone: churn after day 30
					for (let i = events.length - 1; i >= 0; i--) {
						const evt = events[i];
						if (dayjs(evt.time).isAfter(day30)) {
							// Keep ~20% of events (remove ~80%) to simulate natural drop-off
							if (chance.bool({ likelihood: 80 })) {
								events.splice(i, 1);
							}
						}
					}
				}
			}

			return record;
		}

		return record;
	},
};

export default config;
