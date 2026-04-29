// ── TWEAK THESE ──
const SEED = "meetcute";
const num_days = 120;
const num_users = 30_000;
const avg_events_per_user_per_day = 1.5;
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
 * ANALYTICS HOOKS (9 hooks)
 * =====================================================================================
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable via
 * behavioral cohorts, raw-prop breakdowns, or funnel analysis.
 *
 * -------------------------------------------------------------------------------------
 * 1. PHOTO MAGIC NUMBER (everything)
 * -------------------------------------------------------------------------------------
 * PATTERN: Sweet 2-5 photos uploaded → 2-4 extra cloned match-received events
 * per existing match. Over 6+ photos → match_score drops 35% on match-received
 * events (over-curated profile reads as fake; quality matches don't trust it).
 * No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Matches per User by Photo-Count Bucket
 *   - Cohort A: users with 2-5 "photo uploaded"
 *   - Cohort B: users with 0-1
 *   - Event: "match received" → Total per user
 *   - Expected: A ~ 2-3x B
 *
 *   Report 2: Avg match_score on Heavy Photo Uploaders
 *   - Cohort C: users with >= 6 "photo uploaded"
 *   - Cohort A: users with 2-5
 *   - Event: "match received" → AVG of match_score
 *   - Expected: C ~ 0.65x A (35% lower match quality)
 *
 * REAL-WORLD ANALOGUE: A few good photos signal authenticity; too many
 * curated shots read as catfish or staged.
 *
 * -------------------------------------------------------------------------------------
 * 2. WEEKEND SWIPE SURGE (everything)
 * -------------------------------------------------------------------------------------
 * PATTERN: Sunday 18-23 UTC swipes get 1.5x duplication. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Swipe Volume by Day of Week
 *   - Insights > "swipe right" → Total → Breakdown: Day of Week
 *   - Expected: Sunday taller than other days
 *
 * REAL-WORLD ANALOGUE: Sunday Scaries drive swipe activity.
 *
 * -------------------------------------------------------------------------------------
 * 3. SUPER-LIKE EFFECT (everything)
 * -------------------------------------------------------------------------------------
 * PATTERN: Each is_super_like=true swipe clones 3 extra match-received events
 * within 5-120 minutes. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Super-Like to Match Funnel
 *   - Funnels > "swipe right" (filter: is_super_like=true) → "match received"
 *   - vs same with is_super_like=false
 *   - Expected: super-like funnel ~ 3x higher conversion
 *
 * REAL-WORLD ANALOGUE: Super-likes dramatically lift match rates.
 *
 * -------------------------------------------------------------------------------------
 * 4. PREMIUM MATCH BOOST (everything)
 * -------------------------------------------------------------------------------------
 * PATTERN: Premium subscribers get 2x match events; Elite get 4x + cloned
 * profile-viewed events (see-who-liked-you). Reads subscription from profile.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Matches by Subscription Tier
 *   - Insights > "match received" → Total per user → Breakdown: subscription
 *   - Expected: Free ~ 1x, Premium ~ 2x, Elite ~ 4x
 *
 * REAL-WORLD ANALOGUE: Premium tiers boost visibility.
 *
 * -------------------------------------------------------------------------------------
 * 5. GHOSTING CHURN (everything)
 * -------------------------------------------------------------------------------------
 * PATTERN: Users with match-received but no message-sent within 48 hours lose
 * 80% of post-match events. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Retention by Messaging Behavior
 *   - Retention starting "match received"
 *   - Cohort A: users with >= 1 "message sent" within 48 hours of match
 *   - Cohort B: rest
 *   - Expected: B drops sharply
 *
 * REAL-WORLD ANALOGUE: Non-responders churn.
 *
 * -------------------------------------------------------------------------------------
 * 6. BIO + PROMPT POWER USERS (everything)
 * -------------------------------------------------------------------------------------
 * PATTERN: Users with bio-updated AND 3+ prompt-answered events get 3 extra
 * cloned date-scheduled events per existing. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Dates per User by Profile Effort
 *   - Cohort A: users with bio-updated AND >= 3 "prompt answered"
 *   - Cohort B: rest
 *   - Event: "date scheduled" → Total per user
 *   - Expected: A ~ 4x B
 *
 * REAL-WORLD ANALOGUE: Profile effort signals serious intent.
 *
 * -------------------------------------------------------------------------------------
 * 7. VALENTINE'S DAY SPIKE (everything)
 * -------------------------------------------------------------------------------------
 * PATTERN: Days 58-63 (V-Day window): profile-created events cloned 3x and
 * premium-upgrade events cloned 5x. No flag — discover via line chart by day.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Signup Volume Over Time
 *   - Insights > "profile created" → Total → Line by day
 *   - Expected: spike ~ 3x days 58-63
 *
 * REAL-WORLD ANALOGUE: Love is expensive.
 *
 * -------------------------------------------------------------------------------------
 * 8. OFF-APP RETENTION (everything)
 * -------------------------------------------------------------------------------------
 * PATTERN: Users with phone-exchanged OR date-scheduled in first 14 days
 * get extra cloned app-open + swipe events past day 30. Non-milestone
 * users lose 80% of post-day-30 events. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Retention by Milestone Cohort
 *   - Cohort A: users with phone-exchanged OR date-scheduled in first 14 days
 *   - Cohort B: rest
 *   - Expected: A ~ 60% D30 retention vs B ~ 20%
 *
 * REAL-WORLD ANALOGUE: Once they find someone IRL, app becomes irrelevant.
 *
 * -------------------------------------------------------------------------------------
 * 9. MATCH FLOW TIME-TO-CONVERT (funnel-post)
 * -------------------------------------------------------------------------------------
 * PATTERN: Elite users complete swipe→match→message funnel 1.4x faster
 * (factor 0.71 on inter-event gaps); Free users 1.4x slower (factor 1.4).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Match Flow Median Time-to-Convert by Tier
 *   - Funnels > "swipe right" → "match received" → "message sent"
 *   - Measure: Median time to convert
 *   - Breakdown: subscription
 *   - Expected: Elite ~ 0.71x; Free ~ 1.4x
 *
 * REAL-WORLD ANALOGUE: Premium notifications + boost surface matches faster.
 *
 * =====================================================================================
 * EXPECTED METRICS SUMMARY
 * =====================================================================================
 *
 * Hook                        | Metric               | Baseline | Effect   | Ratio
 * ----------------------------|----------------------|----------|----------|------
 * Photo Magic Number          | sweet matches/user   | 1x       | ~ 1.7x   | 1.7x
 * Photo Magic Number          | over matches/user    | 1x       | 0.7x     | -30%
 * Weekend Swipe Surge         | Sunday swipes        | 1x       | ~ 1.5x   | 1.5x
 * Super-Like Effect           | matches from super   | 1x       | 3x       | 3x
 * Premium Match Boost         | matches (Elite)      | 1x       | 4x       | 4x
 * Ghosting Churn              | post-match retention | 100%     | 20%      | 0.2x
 * Bio + Prompt Power Users    | dates/user           | 1x       | 4x       | 4x
 * Valentine's Day Spike       | signups days 58-63   | 1x       | 3x       | 3x
 * Off-App Retention           | D30 retention        | ~ 20%    | ~ 60%    | 3x
 * Match Flow T2C              | median min by tier   | 1x       | 0.71x/1.4x| ~ 2x range
 */

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-04-28T23:59:59Z",
	// numDays: num_days,
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
			},
		},
		{
			event: "photo uploaded",
			weight: 12,
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
			},
		},
		{
			event: "profile viewed",
			weight: 5,
			properties: {
				viewer_source: ["feed", "discover", "liked_you", "nearby"],
			},
		},
		{
			event: "premium upgrade",
			weight: 1,
			properties: {
				plan: ["Premium", "Premium", "Premium", "Elite"],
				price_usd: [14.99, 14.99, 14.99, 29.99],
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
		Platform: ["ios", "ios", "android"],
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
		Platform: ["ios", "ios", "android"],
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

	hook: function (record, type, meta) {

		// HOOK 9 (T2C): MATCH FLOW TIME-TO-CONVERT (funnel-post)
		// Elite users complete swipe→match→message funnel 1.4x faster
		// (factor 0.71); Free users 1.4x slower (factor 1.4).
		if (type === "funnel-post") {
			const segment = meta?.profile?.subscription;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "Elite" ? 0.71 :
					segment === "Free" ? 1.4 :
					1.0
				);
				if (factor !== 1.0) {
					for (let i = 1; i < record.length; i++) {
						const prev = dayjs(record[i - 1].time);
						const newGap = Math.round(dayjs(record[i].time).diff(prev) * factor);
						record[i].time = prev.add(newGap, "milliseconds").toISOString();
					}
				}
			}
		}

		// ─── EVERYTHING-LEVEL HOOKS ──────────────────────────────────────

		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const VDAY_WINDOW_START = datasetStart.add(58, "days");
			const VDAY_WINDOW_END = datasetStart.add(63, "days");
			const events = record;
			if (!events || events.length === 0) return record;

			const profile = meta.profile || {};

			events.forEach(e => {
				if (profile.subscription) e.subscription = profile.subscription;
				if (profile.platform) e.platform = profile.platform;
			});

			let photoUploadCount = 0;
			let promptAnsweredCount = 0;
			let hasBioUpdated = false;
			const matchEvents = [];
			const messageSentEvents = [];
			const superLikeEvents = [];
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
				if (event.event === "swipe right" && event.is_super_like === true) superLikeEvents.push(event);
			});

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

			// HOOK 1 + HOOK 9: PHOTO MAGIC NUMBER (no flags)
			// Sweet 2-5 photos → clone 2-4 extra match events per existing.
			// Over 6+ photos → drop match_score by 35% on match received events
			// (over-curated profile reads as fake/staged).
			if (photoUploadCount >= 2 && photoUploadCount <= 5 && matchEvents.length > 0) {
				const matchTemplate = matchEvents[0];
				matchEvents.forEach(m => {
					const extras = chance.integer({ min: 2, max: 4 });
					for (let i = 0; i < extras; i++) {
						events.push({
							...matchTemplate,
							time: dayjs(m.time).add(chance.integer({ min: 1, max: 180 }), "minutes").toISOString(),
							user_id: m.user_id,
							match_score: chance.integer({ min: 60, max: 98 }),
						});
					}
				});
			} else if (photoUploadCount >= 6) {
				events.forEach(e => {
					if (e.event === "match received" && typeof e.match_score === "number") {
						e.match_score = Math.max(20, Math.round(e.match_score * 0.65));
					}
				});
			}

			// HOOK 2: WEEKEND SWIPE SURGE — Sunday 18-23 UTC swipes get cloned
			// 1.5x. No flag — discover via day-of-week chart.
			for (let idx = events.length - 1; idx >= 0; idx--) {
				const event = events[idx];
				if (event.event === "swipe right") {
					const dow = new Date(event.time).getUTCDay();
					const hr = new Date(event.time).getUTCHours();
					if (dow === 0 && hr >= 18 && hr <= 23) {
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
			}

			// HOOK 3: SUPER-LIKE EFFECT — clone 3 extra match events per
			// super-like, near in time. No flag — discover via funnel
			// "swipe right where is_super_like=true" → "match received".
			if (superLikeEvents.length > 0) {
				const matchTemplate = matchEvents[0] || events[0];
				superLikeEvents.forEach(sle => {
					for (let i = 0; i < 3; i++) {
						events.push({
							...matchTemplate,
							event: "match received",
							time: dayjs(sle.time).add(chance.integer({ min: 5, max: 120 }), "minutes").toISOString(),
							user_id: sle.user_id,
							match_score: chance.integer({ min: 70, max: 99 }),
						});
					}
				});
			}

			// HOOK 4: PREMIUM MATCH BOOST — Premium 2x, Elite 4x match events.
			// Elite users also get profile-viewed events injected (see-who-liked-you).
			// Reads subscription from profile.
			const sub = profile.subscription;
			if ((sub === "Premium" || sub === "Elite") && matchEvents.length > 0) {
				const multiplier = sub === "Elite" ? 3 : 1;
				const matchTemplate = matchEvents[0];
				for (let i = 0; i < matchEvents.length * multiplier; i++) {
					const sourceMatch = matchEvents[i % matchEvents.length];
					events.push({
						...matchTemplate,
						time: dayjs(sourceMatch.time).add(chance.integer({ min: 10, max: 240 }), "minutes").toISOString(),
						user_id: sourceMatch.user_id,
						match_score: chance.integer({ min: 65, max: 99 }),
					});
				}
				if (sub === "Elite") {
					const viewTemplate = events.find(e => e.event === "profile viewed") || matchTemplate;
					matchEvents.forEach(m => {
						events.push({
							...viewTemplate,
							event: "profile viewed",
							time: dayjs(m.time).subtract(chance.integer({ min: 10, max: 120 }), "minutes").toISOString(),
							user_id: m.user_id,
							viewer_source: "liked_you",
						});
					});
				}
			}

			// HOOK 6: BIO + PROMPT POWER USERS — bio + 3+ prompts → 3 extra
			// cloned date events per existing. No flag.
			if (hasBioUpdated && promptAnsweredCount >= 3) {
				const dateEvents = events.filter(e => e.event === "date scheduled");
				if (dateEvents.length > 0) {
					const dateTemplate = dateEvents[0];
					const venueTypes = ["coffee", "dinner", "drinks", "activity", "virtual"];
					for (let i = 0; i < dateEvents.length * 3; i++) {
						const sourceDate = dateEvents[i % dateEvents.length];
						events.push({
							...dateTemplate,
							time: dayjs(sourceDate.time).add(chance.integer({ min: 1, max: 72 }), "hours").toISOString(),
							user_id: sourceDate.user_id,
							venue_type: chance.pickone(venueTypes),
						});
					}
				}
			}

			// HOOK 7: VALENTINE'S DAY SPIKE — clone profile-created events during
			// days 58-63 (3x volume), plus clone premium-upgrade events 5x. No flag.
			const vdaySignups = events.filter(e =>
				e.event === "profile created" &&
				dayjs(e.time).isAfter(VDAY_WINDOW_START) &&
				dayjs(e.time).isBefore(VDAY_WINDOW_END)
			);
			vdaySignups.forEach(signup => {
				for (let i = 0; i < 2; i++) {
					events.push({
						...signup,
						time: dayjs(signup.time).add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
						user_id: signup.user_id,
					});
				}
			});

			const vdayUpgrades = events.filter(e =>
				e.event === "premium upgrade" &&
				dayjs(e.time).isAfter(VDAY_WINDOW_START) &&
				dayjs(e.time).isBefore(VDAY_WINDOW_END)
			);
			if (vdayUpgrades.length > 0) {
				const upgradeTemplate = vdayUpgrades[0];
				vdayUpgrades.forEach(upgrade => {
					for (let i = 0; i < 4; i++) {
						events.push({
							...upgradeTemplate,
							time: dayjs(upgrade.time).add(chance.integer({ min: 1, max: 24 }), "hours").toISOString(),
							user_id: upgrade.user_id,
							plan: upgrade.plan,
							price_usd: upgrade.price_usd,
						});
					}
				});
			}

			// HOOK 8: OFF-APP RETENTION — users with phone-exchanged or
			// date-scheduled in first 14 days get extra cloned app-open + swipe
			// events past day 30. Non-milestone users lose 80% of post-day-30
			// events. No flag.
			if (firstEventTime) {
				const day30 = dayjs(firstEventTime).add(30, "days");
				const hasEarlyMilestone = hasPhoneExchangedEarly || hasDateScheduledEarly;
				if (hasEarlyMilestone) {
					const appOpenedTemplate = events.find(e => e.event === "app opened") || events[0];
					const swipeTemplate = events.find(e => e.event === "swipe right") || events[0];
					const postDay30Events = events.filter(e => dayjs(e.time).isAfter(day30));
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
					for (let i = events.length - 1; i >= 0; i--) {
						if (dayjs(events[i].time).isAfter(day30) && chance.bool({ likelihood: 80 })) {
							events.splice(i, 1);
						}
					}
				}
			}

			// HOOK 5: GHOSTING CHURN — users with match but no message within
			// 48hrs lose 80% of post-match events. No flag.
			if (matchEvents.length > 0) {
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
					const earliestMatch = matchEvents.reduce((min, m) =>
						dayjs(m.time).isBefore(dayjs(min.time)) ? m : min
					);
					const churnAfter = dayjs(earliestMatch.time);
					for (let i = events.length - 1; i >= 0; i--) {
						if (dayjs(events[i].time).isAfter(churnAfter) && chance.bool({ likelihood: 80 })) {
							events.splice(i, 1);
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
