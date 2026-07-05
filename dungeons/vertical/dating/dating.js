// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       MeetCute
 * APP:        Swipe-based dating app (Hinge/Tinder-style) with profile prompts,
 *             photo verification, matchmaking, messaging, premium tiers. Users
 *             create a profile with photos and prompts, swipe on potential
 *             matches, message, exchange numbers, and schedule dates. Premium
 *             subscribers get boosts, super-likes, and see-who-liked-you.
 * SCALE:      30,000 users, ~5.8M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  profile created → photo uploaded → swipe right → match received → message sent → phone number exchanged → date scheduled
 *
 * EVENTS (17):
 *   photo uploaded (12) > swipe right (10) > swipe left (8) > app opened (8)
 *   > message sent (6) > message received (5) > profile viewed (5) > match received (4)
 *   > prompt answered (3) > bio updated (2) > boost activated (2)
 *   > profile created (1) > phone number exchanged (1) > date scheduled (1)
 *   > premium upgrade (1) > premium cancelled (1) > report user (1)
 *
 * FUNNELS (4):
 *   - Onboarding:   profile created → photo uploaded → swipe right (75%)
 *   - Match Flow:   swipe right → match received → message sent (50%, reentry)
 *   - Date Funnel:  message sent → phone number exchanged → date scheduled (25%, reentry)
 *   - Monetization: app opened → boost activated → premium upgrade (20%)
 *
 * USER PROPS:  subscription, age_range, gender, looking_for, photo_count, total_matches, total_messages_sent, profile_completeness, Platform
 * SUPER PROPS: subscription, Platform
 * SCD PROPS:   subscription_tier (Free/Premium/Elite, monthly fuzzy, max 6)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
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
 *   - Expected: ~4x activity-normalized (matches-per-swipe); the raw
 *     per-user ratio is smaller because sweet uploaders skew less active
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
 * PATTERN: Sunday swipes get heavy cloning (evening 5 extra clones = 6x,
 * daytime 2 extra = 3x) to overcome soup DOW weight deficit. No flag.
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
 *   - Expected: 4x mechanism; the population-level rate ratio reads
 *     ~2x because the rest cohort is the low-activity tail whose
 *     messages co-occur with funnel dates (see story H6)
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
 * PATTERN: Elite users complete the MATCH FLOW funnel (swipe→match→message)
 * 1.4x faster (factor 0.71 on inter-event gaps); Free users 1.4x slower
 * (factor 1.4). v1.6: scoped to Match Flow only — the v1.5 hook stretched
 * every funnel, leaking an undocumented tier-speed pattern into
 * Onboarding/Date Funnel/Monetization.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Match Flow Median Time-to-Convert by Tier
 *   - Funnels > "swipe right" → "match received" → "message sent"
 *   - Measure: Median time to convert
 *   - Breakdown: subscription
 *   - Expected: Elite ~ 0.71x; Free ~ 1.4x (both compressed toward 1 by
 *     organic cross-instance pairings; see the H9 story narrative)
 *
 *   NOTE (funnel-post measurement): visible via Mixpanel funnel median
 *   TTC and via emulateBreakdown's timeToConvert (the H9 story asserts
 *   the delta itself at a 33.6h conversion window = 24h generative
 *   window × 1.4 max stretch). Cross-event MIN→MIN SQL queries on raw
 *   events do NOT show this — funnel-post adjusts gaps within funnel
 *   instances, not across the user's full event history.
 *
 * REAL-WORLD ANALOGUE: Premium notifications + boost surface matches faster.
 *
 * -------------------------------------------------------------------------------------
 * 10. AGE RANGE AFFECTS DATE CONVERSION (funnel-pre)
 * -------------------------------------------------------------------------------------
 * PATTERN: On the Date Funnel (message sent → phone number exchanged →
 * date scheduled), users aged 25-34 convert at 1.3x baseline; 40+ at 0.6x.
 * Scoped to the funnel containing "date scheduled".
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Date Funnel Conversion by Age Range
 *   - Funnels > "message sent" → "phone number exchanged" → "date scheduled"
 *   - Breakdown: age_range
 *   - Expected: 25-29 / 30-34 ~ 1.3x baseline; 40+ ~ 0.6x
 *
 * REAL-WORLD ANALOGUE: Peak dating age ranges convert faster to in-person
 * dates; older users are more selective.
 *
 * =====================================================================================
 * EXPECTED METRICS SUMMARY (Measured = full fidelity, 30K users / 5,839,522 events)
 * =====================================================================================
 *
 * Story id                    | Metric                              | Expected     | Measured
 * ----------------------------|-------------------------------------|--------------|---------
 * H1-photo-magic-number[0]    | over/low avg match_score            | [0.60, 0.73] | 0.659
 * H1-photo-magic-number[1]    | sweet/low adj-match-per-swipe DD    | [2.8, 5.2]   | 4.10
 * H2-sunday-swipe-surge[0]    | Sunday / mean(other DOW) swipes     | [2.0, 6.0]   | 2.38
 * H3-super-like-effect[0]     | measured/predicted additive lift    | [0.75, 1.25] | 0.881
 * H4-premium-match-boost[0]   | Elite/Free avg matches              | [3.2, 4.6]   | 3.99
 * H4-premium-match-boost[1]   | Premium/Free avg matches            | [1.6, 2.4]   | 2.01
 * H4-premium-match-boost[2]   | Elite mod-4 share (Free placebo)    | ≥0.9 (≤0.4)  | 0.987 (0.248)
 * H5-ghosting-churn[0]        | pre-calibrated keep / knob 0.2      | [0.6, 1.4]   | 0.982
 * H6-bio-prompt-power-users[0]| power/rest dates-per-message        | [1.5, 3.4]   | 2.09
 * H6-bio-prompt-power-users[1]| power mod-4 share (rest placebo)    | ≥0.9 (≤0.4)  | 0.906 (0.378)
 * H7-vday-spike[0]            | V-Day window/baseline daily signups | [2.0, 3.3]   | 2.30
 * H7-vday-spike[1]            | V-Day window/baseline daily upgrades| [3.5, 5.6]   | 4.25
 * H8-offapp-retention[0]      | rest post-30d share / predicted     | [0.7, 1.35]  | 1.04
 * H9-match-flow-ttc[0]        | Elite/Premium median TTC (emulator) | [0.55, 0.92] | 0.820
 * H9-match-flow-ttc[1]        | Free/Premium median TTC (emulator)  | [1.05, 1.55] | 1.11
 * H10-age-date-conversion[0]  | 25-34/base date-funnel conv ratio   | [1.05, 1.45] | 1.28
 * H10-age-date-conversion[0]  | 40+/base date-funnel conv ratio     | [0.45, 0.88] | 0.604
 */

// ── SCALE ──
const SEED = "meetcute";
const NUM_USERS = 30_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.5;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const PHOTO_SWEET_MIN = 2;
const PHOTO_SWEET_MAX = 5;
const PHOTO_OVER_THRESHOLD = 6;
const PHOTO_OVER_SCORE_FACTOR = 0.65;

const SUNDAY_EVENING_CLONES = 5;
const SUNDAY_DAYTIME_CLONES = 2;

const SUPER_LIKE_MATCH_CLONES = 3;

const PREMIUM_MATCH_MULT = 2;
const ELITE_MATCH_MULT = 4;

const GHOSTING_WINDOW_HOURS = 48;
const GHOSTING_DROP_LIKELIHOOD = 80;

const BIO_PROMPT_THRESHOLD = 3;
const BIO_PROMPT_DATE_CLONE_MULT = 3;

const VDAY_WINDOW_START_DAY = 58;
const VDAY_WINDOW_END_DAY = 63;
const VDAY_SIGNUP_CLONES = 2;
const VDAY_UPGRADE_CLONES = 4;

const MILESTONE_WINDOW_DAYS = 14;
const RETENTION_CUTOFF_DAYS = 30;
const RETENTION_TARGET_PCT = 0.3;
const OFFAPP_DROP_LIKELIHOOD = 80;

const FUNNEL_TTC_ELITE = 0.71;
const FUNNEL_TTC_FREE = 1.4;

const AGE_CONV_BOOST = 1.3;
const AGE_CONV_DROP = 0.6;

// ── HELPER FUNCTIONS ──
function handleFunnelPreHooks(record, meta) {
	// H10: Age range affects date conversion — 25-34 +30%, 40+ -40%
	const isDateFunnel = meta.funnel?.sequence?.includes("date scheduled");
	if (isDateFunnel) {
		const age = meta.profile?.age_range;
		if (age === "25-29" || age === "30-34") {
			record.conversionRate = Math.min(95, Math.round(record.conversionRate * AGE_CONV_BOOST));
		} else if (age === "40+") {
			record.conversionRate = Math.round(record.conversionRate * AGE_CONV_DROP);
		}
	}
	return record;
}

function handleFunnelPostHooks(record, meta) {
	// H9: Match Flow TTC scaled by subscription tier. Scoped to the Match
	// Flow funnel only — the documented story (and the Mixpanel report it
	// teaches) is Match Flow median TTC; the v1.5 hook stretched EVERY
	// funnel, leaking an undocumented tier-speed pattern into
	// Onboarding/Date Funnel/Monetization.
	if (meta?.funnel?.name !== "Match Flow") return record;
	const segment = meta?.profile?.subscription;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "Elite" ? FUNNEL_TTC_ELITE :
			segment === "Free" ? FUNNEL_TTC_FREE :
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
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	const VDAY_WINDOW_START = datasetStart.add(VDAY_WINDOW_START_DAY, "days");
	const VDAY_WINDOW_END = datasetStart.add(VDAY_WINDOW_END_DAY, "days");
	const events = record;
	if (!events || events.length === 0) return record;

	const profile = meta.profile || {};

	events.forEach(e => {
		if (profile.subscription) e.subscription = profile.subscription;
		// pin Platform per-user — the engine draws super props per-event,
		// which gives one user mixed platforms (profile key is capital-P;
		// the v1.5 lowercase read was dead code)
		if (profile.Platform) e.Platform = profile.Platform;
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
		const earlyWindow = dayjs(firstEventTime).add(MILESTONE_WINDOW_DAYS, "days");
		events.forEach(event => {
			const t = dayjs(event.time);
			if (t.isBefore(earlyWindow)) {
				if (event.event === "phone number exchanged") hasPhoneExchangedEarly = true;
				if (event.event === "date scheduled") hasDateScheduledEarly = true;
			}
		});
	}

	// H1: PHOTO MAGIC NUMBER (sweet 2-5 photos → clone 2-4 extra matches)
	// Over-6 score reduction is applied AT THE END of this hook so it also
	// affects matches injected by H4 (premium boost).
	if (photoUploadCount >= PHOTO_SWEET_MIN && photoUploadCount <= PHOTO_SWEET_MAX && matchEvents.length > 0) {
		const matchTemplate = matchEvents[0];
		matchEvents.forEach(m => {
			const extras = chance.integer({ min: 2, max: 4 });
			for (let i = 0; i < extras; i++) {
				events.push({
					...matchTemplate,
					time: dayjs(m.time).add(chance.integer({ min: 1, max: 180 }), "minutes").toISOString(),
					user_id: m.user_id,
					match_score: chance.integer({ min: 60, max: 98 }),
					// engine stamps insert_id at generation — clones need fresh
					// ids or Mixpanel's $insert_id dedupe silently eats them
					insert_id: chance.guid(),
				});
			}
		});
	}

	// H2: WEEKEND SWIPE SURGE — Sunday swipes get heavy cloning
	// to overcome the soup DOW weight deficit. Evening swipes (18-23)
	// get 5 clones; daytime Sunday swipes get 2 clones.
	// No flag — discover via day-of-week chart.
	for (let idx = events.length - 1; idx >= 0; idx--) {
		const event = events[idx];
		if (event.event === "swipe right") {
			const dow = new Date(event.time).getUTCDay();
			if (dow === 0) {
				const hr = new Date(event.time).getUTCHours();
				const clones = (hr >= 18 && hr <= 23) ? SUNDAY_EVENING_CLONES : SUNDAY_DAYTIME_CLONES;
				const etime = dayjs(event.time);
				for (let c = 0; c < clones; c++) {
					events.push({
						...event,
						time: etime.add(chance.integer({ min: 1, max: 60 }), "minutes").toISOString(),
						user_id: event.user_id,
						insert_id: chance.guid(),
					});
				}
			}
		}
	}

	// H3: SUPER-LIKE EFFECT — clone 3 extra match events per
	// super-like, near in time. No flag — discover via funnel
	// "swipe right where is_super_like=true" → "match received".
	if (superLikeEvents.length > 0) {
		const matchTemplate = matchEvents[0] || events[0];
		superLikeEvents.forEach(sle => {
			for (let i = 0; i < SUPER_LIKE_MATCH_CLONES; i++) {
				events.push({
					...matchTemplate,
					event: "match received",
					time: dayjs(sle.time).add(chance.integer({ min: 5, max: 120 }), "minutes").toISOString(),
					user_id: sle.user_id,
					match_score: chance.integer({ min: 70, max: 99 }),
					insert_id: chance.guid(),
				});
			}
		});
	}

	// H5: GHOSTING CHURN — users with match but no message within
	// 48hrs lose 80% of post-match events. No flag.
	// (runs BEFORE premium boost so injected premium matches survive)
	if (matchEvents.length > 0) {
		let hasTimely = false;
		for (const m of matchEvents) {
			const matchTime = dayjs(m.time);
			const deadline = matchTime.add(GHOSTING_WINDOW_HOURS, "hours");
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
				if (dayjs(events[i].time).isAfter(churnAfter) && chance.bool({ likelihood: GHOSTING_DROP_LIKELIHOOD })) {
					events.splice(i, 1);
				}
			}
		}
	}

	// H4: PREMIUM MATCH BOOST — Premium 2x, Elite 4x match events.
	// Elite users also get profile-viewed events injected (see-who-liked-you).
	// Reads subscription from profile. Runs AFTER ghosting churn so
	// injected matches are not culled.
	const sub = profile.subscription;
	if ((sub === "Premium" || sub === "Elite") && matchEvents.length > 0) {
		// Count surviving match events post-churn
		const survivingMatches = events.filter(e => e.event === "match received");
		const baseCount = survivingMatches.length || 1;
		const targetMultiplier = sub === "Elite" ? ELITE_MATCH_MULT : PREMIUM_MATCH_MULT;
		const toAdd = Math.max(0, baseCount * targetMultiplier - baseCount);
		const matchTemplate = matchEvents[0];
		for (let i = 0; i < toAdd; i++) {
			const sourceMatch = survivingMatches[i % survivingMatches.length] || matchTemplate;
			events.push({
				...matchTemplate,
				time: dayjs(sourceMatch.time).add(chance.integer({ min: 10, max: 240 }), "minutes").toISOString(),
				user_id: sourceMatch.user_id,
				match_score: chance.integer({ min: 65, max: 99 }),
				insert_id: chance.guid(),
			});
		}
		if (sub === "Elite") {
			const viewTemplate = events.find(e => e.event === "profile viewed") || matchTemplate;
			survivingMatches.forEach(m => {
				events.push({
					...viewTemplate,
					event: "profile viewed",
					time: dayjs(m.time).subtract(chance.integer({ min: 10, max: 120 }), "minutes").toISOString(),
					user_id: m.user_id,
					viewer_source: "liked_you",
					insert_id: chance.guid(),
				});
			});
		}
	}

	// H6: BIO + PROMPT POWER USERS — bio + 3+ prompts → 3 extra
	// cloned date events per existing. No flag.
	if (hasBioUpdated && promptAnsweredCount >= BIO_PROMPT_THRESHOLD) {
		const dateEvents = events.filter(e => e.event === "date scheduled");
		if (dateEvents.length > 0) {
			const dateTemplate = dateEvents[0];
			const venueTypes = ["coffee", "dinner", "drinks", "activity", "virtual"];
			for (let i = 0; i < dateEvents.length * BIO_PROMPT_DATE_CLONE_MULT; i++) {
				const sourceDate = dateEvents[i % dateEvents.length];
				events.push({
					...dateTemplate,
					time: dayjs(sourceDate.time).add(chance.integer({ min: 1, max: 72 }), "hours").toISOString(),
					user_id: sourceDate.user_id,
					venue_type: chance.pickone(venueTypes),
					insert_id: chance.guid(),
				});
			}
		}
	}

	// H7: VALENTINE'S DAY SPIKE — clone profile-created events during
	// days 58-63 (3x volume), plus clone premium-upgrade events 5x. No flag.
	const vdaySignups = events.filter(e =>
		e.event === "profile created" &&
		dayjs(e.time).isAfter(VDAY_WINDOW_START) &&
		dayjs(e.time).isBefore(VDAY_WINDOW_END)
	);
	vdaySignups.forEach(signup => {
		for (let i = 0; i < VDAY_SIGNUP_CLONES; i++) {
			events.push({
				...signup,
				time: dayjs(signup.time).add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
				user_id: signup.user_id,
				insert_id: chance.guid(),
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
			for (let i = 0; i < VDAY_UPGRADE_CLONES; i++) {
				events.push({
					...upgradeTemplate,
					time: dayjs(upgrade.time).add(chance.integer({ min: 1, max: 24 }), "hours").toISOString(),
					user_id: upgrade.user_id,
					plan: upgrade.plan,
					price_usd: upgrade.price_usd,
					insert_id: chance.guid(),
				});
			}
		});
	}

	// H1b: PHOTO MAGIC NUMBER — over-6 score reduction (applied LAST so
	// it also affects matches injected by H4 premium boost).
	if (photoUploadCount >= PHOTO_OVER_THRESHOLD) {
		events.forEach(e => {
			if (e.event === "match received" && typeof e.match_score === "number") {
				e.match_score = Math.max(20, Math.round(e.match_score * PHOTO_OVER_SCORE_FACTOR));
			}
		});
	}

	// H8: OFF-APP RETENTION — users with phone-exchanged or
	// date-scheduled in first 14 days get extra cloned app-open + swipe
	// events past day 30. Non-milestone users lose 80% of post-day-30
	// events. No flag.
	if (firstEventTime) {
		const day30 = dayjs(firstEventTime).add(RETENTION_CUTOFF_DAYS, "days");
		const hasEarlyMilestone = hasPhoneExchangedEarly || hasDateScheduledEarly;
		if (hasEarlyMilestone) {
			const appOpenedTemplate = events.find(e => e.event === "app opened") || events[0];
			const swipeTemplate = events.find(e => e.event === "swipe right") || events[0];
			const postDay30Events = events.filter(e => dayjs(e.time).isAfter(day30));
			if (postDay30Events.length < events.length * RETENTION_TARGET_PCT) {
				const retentionCount = Math.floor(events.length * RETENTION_TARGET_PCT);
				for (let i = 0; i < retentionCount; i++) {
					const daysAfter = chance.integer({ min: 1, max: 60 });
					const template = chance.bool({ likelihood: 50 }) ? appOpenedTemplate : swipeTemplate;
					events.push({
						...template,
						time: day30.add(daysAfter, "days").add(chance.integer({ min: 0, max: 23 }), "hours").toISOString(),
						user_id: template.user_id,
						insert_id: chance.guid(),
					});
				}
			}
		} else {
			for (let i = events.length - 1; i >= 0; i--) {
				if (dayjs(events[i].time).isAfter(day30) && chance.bool({ likelihood: OFFAPP_DROP_LIKELIHOOD })) {
					events.splice(i, 1);
				}
			}
		}
	}

	return record;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	version: 2,
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: "json",
	gzip: true,
	credentials: {
		token,
	},
	switches: {
		hasSessionIds: true,
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
	},
	identity: {
		avgDevicePerUser: 2,
	},
	concurrency: 1,
	writeToDisk: false,
	soup: "growth",

	events: [
		{
			event: "profile created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				age_range: ["18-24", "25-29", "30-34", "35-39", "40+"],
				gender: ["Male", "Male", "Female", "Female", "Non-binary"],
				looking_for: ["Men", "Women", "Everyone"],
			},
		},
		{
			event: "photo uploaded",
			weight: 12,
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				match_score: u.weighNumRange(50, 100, 0.5, 75),
			},
		},
		{
			event: "message sent",
			weight: 6,
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				exchange_method: ["in_chat", "in_chat", "voice_call", "video_call"],
			},
		},
		{
			event: "date scheduled",
			weight: 1,
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				session_duration_mins: u.weighNumRange(1, 120, 0.3, 8),
			},
		},
	],

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
			reentry: true,
		},
		{
			name: "Date Funnel",
			sequence: ["message sent", "phone number exchanged", "date scheduled"],
			conversionRate: 25,
			order: "sequential",
			timeToConvert: 72,
			weight: 3,
			reentry: true,
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

	superProps: {
		subscription: ["Free", "Free", "Free", "Premium", "Elite"],
		Platform: ["ios", "ios", "android"],
	},

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

	hook(record, type, meta) {
		if (type === "funnel-pre") return handleFunnelPreHooks(record, meta);
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

// ── STORIES (v1.6 machine-checkable contract — one story per numbered hook) ──
// Generate:  node scripts/verify-runner.mjs dungeons/vertical/dating/dating.js verify-dating
// Evaluate:  node scripts/verify-stories.mjs dungeons/vertical/dating/dating.js --data-prefix verify-dating
//
// Measurement doctrine for this dungeon:
// - Deletions-only logic (H5 ghosting, H8 off-app drop, the silent future-time
//   guard) means every hook-time cohort classification is only ONE-SIDED
//   recoverable from output counts: hook-time count >= output count. Cohort
//   definitions below are chosen so output-side membership IMPLIES hook-time
//   membership (e.g. an output-visible timely match→message pair proves the
//   user was never ghosted); the reverse-direction contamination lands in the
//   control arm and biases every ratio TOWARD null, never away from it.
// - Photo count / super-like count / prompt count correlate with total user
//   activity, so raw cohort-vs-cohort comparisons of clone-lifted events are
//   activity-confounded BY CONSTRUCTION. Count-lift assertions therefore use
//   activity-normalized double ratios (matches-per-swipe, dates-per-message)
//   where the proxy event is untouched by the hook under test.

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;
// identity prelude: avgDevicePerUser 2 + profile created is isAuthEvent+isFirstEvent,
// so born users auth on their first event; the device-pool resolve is
// belt-and-braces for any device-only edge. ::VARCHAR casts — user_id sniffs
// as UUID, device_id as VARCHAR; DuckDB refuses to coalesce mixed types.
const ID_CTE = `
us AS (SELECT * FROM ${US}),
dm AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM us),
ev AS (
  SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
         e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e
  LEFT JOIN dm m ON e.device_id = m.device_id
)`;

// per-user counts used by H1/H3 (photos/matches/swipes/super-likes)
const PU_CTE = `
pu AS (
  SELECT e.uid,
    count(*) FILTER (WHERE e.event = 'photo uploaded') AS photos,
    count(*) FILTER (WHERE e.event = 'match received') AS matches,
    count(*) FILTER (WHERE e.event = 'swipe right') AS swipes,
    count(*) FILTER (WHERE e.event = 'swipe right' AND e.is_super_like = true) AS sls
  FROM ev e GROUP BY 1
)`;

// output-visible timely pair (match → message within the ghosting window)
// proves the user was NOT ghosted at hook time: H5 deletes but never adds,
// so a surviving pair must have existed when H5 evaluated it.
const TP_CTE = `
tp AS (
  SELECT DISTINCT a.uid FROM ev a
  JOIN ev b ON b.uid = a.uid AND b.event = 'message sent'
  WHERE a.event = 'match received'
    AND b.t > a.t AND b.t < a.t + INTERVAL ${GHOSTING_WINDOW_HOURS} HOUR
)`;

// output-visible early milestone (phone/date within the first
// MILESTONE_WINDOW_DAYS of the user's first event) proves hook-time milestone
// status: H6 clones dates only FORWARD from existing dates (+1-72h), so a
// clone inside the early window implies its source was too.
const MS_CTE = `
fe AS (SELECT uid, min(t) AS f FROM ev GROUP BY 1),
ms AS (
  SELECT DISTINCT e.uid FROM ev e JOIN fe ON fe.uid = e.uid
  WHERE e.event IN ('phone number exchanged', 'date scheduled')
    AND e.t < fe.f + INTERVAL ${MILESTONE_WINDOW_DAYS} DAY
)`;

// knob-derived timestamps (dataset starts ${DATASET_START})
const DS = dayjs.utc(DATASET_START);
const TS = (d) => d.format("YYYY-MM-DD HH:mm:ss");
const VDAY_START_TS = TS(DS.add(VDAY_WINDOW_START_DAY, "day"));
const VDAY_END_TS = TS(DS.add(VDAY_WINDOW_END_DAY, "day"));
const VDAY_DAYS = VDAY_WINDOW_END_DAY - VDAY_WINDOW_START_DAY;
// flanking baseline: 14 days before the window + 14 days after, with the
// post-window flank starting +3 days after window end so the 48h clone
// spill (V-Day clones are stamped source+1..48h) cannot inflate the baseline
const VDAY_BASE_PRE_TS = TS(DS.add(VDAY_WINDOW_START_DAY - 14, "day"));
const VDAY_BASE_POST_START_TS = TS(DS.add(VDAY_WINDOW_END_DAY + 3, "day"));
const VDAY_BASE_POST_END_TS = TS(DS.add(VDAY_WINDOW_END_DAY + 3 + 14, "day"));
// H8 clean-cohort birth cutoff: retention clones land at day30 + U[1,60] days,
// so only users born before day RETENTION_CUTOFF_DAYS have their entire clone
// support inside the 121-day window (30 + 30 + 60 < 121) — later-born
// milestone users lose clones to the silent future-time guard.
const H8_EARLYBORN_TS = TS(DS.add(RETENTION_CUTOFF_DAYS, "day"));

const cellsOf = (rows, key) => Object.fromEntries((rows || []).map((r) => [r[key], r]));

export const stories = [
	{
		id: "H1-photo-magic-number",
		hook: "H1",
		archetype: "frequency-sweet-spot",
		narrative:
			"Sweet-spot uploaders (2-5 photos at hook time) get 2-4 cloned matches per existing match " +
			"(expected multiplier 1+E[U{2..4}] = 4x); heavy uploaders (6+) keep their match volume but every " +
			"match_score is cut to 0.65x at the END of the everything hook, so the cut also covers H3/H4-injected " +
			"matches. Score assertion compares 6+ vs 0-1 uploaders (NOT vs sweet — sweet users' H1 clones redraw " +
			"score from U[60,98], a different pool than organic, which would confound the read): both arms carry " +
			"organic+H3/H4 score mixtures, so the ratio reads the 0.65 knob within composition tolerance " +
			"[0.60, 0.73]. The count assertion is an activity-normalized double ratio (matches-per-user over " +
			"swipes-per-user, sweet vs 0-1) restricted to Free-tier users (removes the H4 tier multiplier) with " +
			"H3's additive term subtracted arithmetically (adjusted matches = matches - 3*super_likes; " +
			"conditioning on super_likes = 0 instead would select the near-inactive tail, P(no SL) ~ 0.9^swipes, " +
			"and starve the sweet cell). Hook-time DD = 1+E[U{2..4}] = 4, band [2.8, 5.2] (±30% for H5/H8 " +
			"dilution and one-sided photo-count contamination in both directions).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
ph AS (SELECT uid, count(*) FILTER (WHERE event = 'photo uploaded') AS photos FROM ev GROUP BY 1),
coh AS (SELECT uid, CASE WHEN photos >= ${PHOTO_OVER_THRESHOLD} THEN 'over' WHEN photos <= 1 THEN 'low' END AS grp FROM ph)
SELECT c.grp, count(DISTINCT c.uid)::BIGINT AS user_count, avg(e.match_score) AS avg_score
FROM coh c JOIN ev e ON e.uid = c.uid AND e.event = 'match received'
WHERE c.grp IS NOT NULL GROUP BY 1`,
				},
				select: {
					over: { where: { grp: "over" } },
					low: { where: { grp: "low" } },
				},
				expect: { metric: "over.avg_score / low.avg_score", op: "between", target: [0.6, 0.73] },
				minCohort: 250,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE},
j AS (
  SELECT p.*, CASE WHEN p.photos BETWEEN ${PHOTO_SWEET_MIN} AND ${PHOTO_SWEET_MAX} THEN 'sweet'
                   WHEN p.photos <= 1 THEN 'low' END AS arm
  FROM pu p JOIN us u ON u.distinct_id::VARCHAR = p.uid
  WHERE u.subscription = 'Free'
)
SELECT arm, count(*)::BIGINT AS user_count,
  avg(matches - ${SUPER_LIKE_MATCH_CLONES} * sls) AS avg_adj_m, avg(swipes) AS avg_s
FROM j WHERE arm IS NOT NULL AND swipes > 0 GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const s = by.sweet, l = by.low;
					if (!s || !l || Number(s.user_count) < 150 || Number(l.user_count) < 150) {
						return { verdict: "WEAK", detail: `cohort too small: sweet=${s?.user_count ?? 0} low=${l?.user_count ?? 0}` };
					}
					if (!(l.avg_adj_m > 0 && l.avg_s > 0 && s.avg_s > 0)) {
						return { verdict: "NONE", detail: "degenerate baseline (zero adjusted matches or swipes in an arm)" };
					}
					const dd = (s.avg_adj_m / l.avg_adj_m) / (s.avg_s / l.avg_s);
					const detail = `DD=${dd.toFixed(3)} (adj-match ratio ${(s.avg_adj_m / l.avg_adj_m).toFixed(2)} ÷ swipe ratio ${(s.avg_s / l.avg_s).toFixed(2)}; knob 1+E[2..4]=4; sweet n=${s.user_count}, low n=${l.user_count})`;
					if (dd >= 2.8 && dd <= 5.2) return { verdict: "NAILED", detail };
					if (dd >= 2.3 && dd <= 6.0) return { verdict: "STRONG", detail };
					return { verdict: dd > 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H2-sunday-swipe-surge",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative:
			"Every Sunday swipe-right is cloned in place: evening swipes (18-23 UTC) get " +
			`${SUNDAY_EVENING_CLONES} clones (x${SUNDAY_EVENING_CLONES + 1}), the rest get ${SUNDAY_DAYTIME_CLONES} ` +
			`(x${SUNDAY_DAYTIME_CLONES + 1}), so the Sunday multiplier is a soup-hour-weighted mix in ` +
			"[3, 6] on top of an unknown-but-bounded soup DOW baseline (growth soup keeps per-DOW weights within " +
			"roughly [0.6, 1.2] of the mean, and the hook exists precisely because Sunday sits at the bottom of " +
			"that range). Assertion: Sunday must be the strict per-DOW maximum AND Sunday/mean(other six days) " +
			"must land in [2.0, 6.0] (NAILED) / [1.5, 7.0] (STRONG). H8's retention clones re-stamp swipes onto " +
			"uniform-random days, diluting the ratio slightly toward 1 — covered by the band floor.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT dayofweek(t) AS dow, count(*)::BIGINT AS swipes
FROM ev WHERE event = 'swipe right' GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					if (!rows || rows.length < 7) return { verdict: "NONE", detail: `expected 7 DOW rows, got ${rows?.length ?? 0}` };
					const sunday = rows.find((r) => Number(r.dow) === 0);
					const others = rows.filter((r) => Number(r.dow) !== 0).map((r) => Number(r.swipes));
					if (!sunday || !others.length) return { verdict: "NONE", detail: "missing DOW rows" };
					const sun = Number(sunday.swipes);
					const otherMean = others.reduce((a, b) => a + b, 0) / others.length;
					const ratio = sun / otherMean;
					const isMax = others.every((o) => sun > o);
					const detail = `Sunday=${sun}, other-day mean=${otherMean.toFixed(0)}, ratio=${ratio.toFixed(3)}, strict max=${isMax}`;
					if (isMax && ratio >= 2.0 && ratio <= 6.0) return { verdict: "NAILED", detail };
					if (isMax && ratio >= 1.5 && ratio <= 7.0) return { verdict: "STRONG", detail };
					return { verdict: ratio > 1.15 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H3-super-like-effect",
		hook: "H3",
		archetype: "cohort-count-scale",
		narrative:
			`Each super-like swipe injects exactly ${SUPER_LIKE_MATCH_CLONES} cloned matches, an ADDITIVE effect ` +
			"(hook-time matches = organic + 3*SL), so the expected lift depends on the organic match baseline and " +
			"cannot be a fixed ratio. The assertion is self-calibrating: within Free-tier users outside the H1 " +
			"sweet range (output photos NOT IN 2-5 — one-sided-safe since output>=6 implies hook>=6, and 0-1 " +
			"contamination lands in both arms), it activity-scales the SL=0 arm's match average by the swipe " +
			"ratio to estimate the SL arm's organic baseline, predicts lift = (organic + 3*avg_SL)/organic from " +
			"the knob, and requires measured/predicted in [0.75, 1.25] (NAILED) / [0.6, 1.45] (STRONG). H5 " +
			"ghosting drops post-match events multiplicatively in both arms, which the ratio-of-ratios absorbs.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE},
j AS (
  SELECT p.*, CASE WHEN p.sls >= 1 THEN 'sl' ELSE 'none' END AS arm
  FROM pu p JOIN us u ON u.distinct_id::VARCHAR = p.uid
  WHERE u.subscription = 'Free' AND p.photos NOT BETWEEN ${PHOTO_SWEET_MIN} AND ${PHOTO_SWEET_MAX}
)
SELECT arm, count(*)::BIGINT AS user_count, avg(matches) AS avg_m, avg(swipes) AS avg_s, avg(sls) AS avg_sl
FROM j WHERE swipes > 0 GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const t = by.sl, c = by.none;
					if (!t || !c || Number(t.user_count) < 100 || Number(c.user_count) < 100) {
						return { verdict: "WEAK", detail: `cohort too small: sl=${t?.user_count ?? 0} none=${c?.user_count ?? 0}` };
					}
					if (!(c.avg_m > 0 && c.avg_s > 0 && t.avg_s > 0)) {
						return { verdict: "NONE", detail: "degenerate baseline (zero matches or swipes in an arm)" };
					}
					const organicT = c.avg_m * (t.avg_s / c.avg_s);
					const predicted = (organicT + SUPER_LIKE_MATCH_CLONES * t.avg_sl) / organicT;
					const measured = t.avg_m / organicT;
					const r = measured / predicted;
					const detail = `measured lift ${measured.toFixed(3)} vs predicted ${predicted.toFixed(3)} (ratio ${r.toFixed(3)}; avg SL ${Number(t.avg_sl).toFixed(2)}, scaled organic ${organicT.toFixed(2)}; sl n=${t.user_count}, none n=${c.user_count})`;
					if (r >= 0.75 && r <= 1.25) return { verdict: "NAILED", detail };
					if (r >= 0.6 && r <= 1.45) return { verdict: "STRONG", detail };
					return { verdict: measured > 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H4-premium-match-boost",
		hook: "H4",
		archetype: "cohort-count-scale",
		narrative:
			"H4 runs AFTER H5's ghosting churn and multiplies each Premium/Elite user's SURVIVING match count to " +
			`exactly base*${PREMIUM_MATCH_MULT} / base*${ELITE_MATCH_MULT} (toAdd = base*mult - base is ` +
			"deterministic). Tier is drawn independently of activity, so the cross-tier avg-matches ratio reads " +
			"the multiplier directly; the only dilution is users with zero hook-time organic matches (H4's gate) " +
			"who sit in every tier equally. Bands: Elite/Free [3.2, 4.6], Premium/Free [1.6, 2.4]. The third " +
			"assertion is the structural signature: for Elite users who are provably non-ghosted (output-visible " +
			"timely pair) AND provably milestone (early phone/date, so H8 adds instead of drops), no later hook " +
			"touches match counts, hence output matches ≡ 0 (mod 4) except for the ~1-2% future-guard tail " +
			"(clones stamped source+10..240min past datasetEnd are silently dropped). Free users are the placebo " +
			"(uniform-ish counts give mod-4 share near 0.25).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
mc AS (SELECT uid, count(*) FILTER (WHERE event = 'match received') AS matches FROM ev GROUP BY 1)
SELECT u.subscription AS tier, count(*)::BIGINT AS user_count, avg(coalesce(mc.matches, 0)) AS avg_m
FROM us u LEFT JOIN mc ON mc.uid = u.distinct_id::VARCHAR
GROUP BY 1`,
				},
				select: {
					el: { where: { tier: "Elite" } },
					fr: { where: { tier: "Free" } },
				},
				expect: { metric: "el.avg_m / fr.avg_m", op: "between", target: [3.2, 4.6] },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
mc AS (SELECT uid, count(*) FILTER (WHERE event = 'match received') AS matches FROM ev GROUP BY 1)
SELECT u.subscription AS tier, count(*)::BIGINT AS user_count, avg(coalesce(mc.matches, 0)) AS avg_m
FROM us u LEFT JOIN mc ON mc.uid = u.distinct_id::VARCHAR
GROUP BY 1`,
				},
				select: {
					pr: { where: { tier: "Premium" } },
					fr: { where: { tier: "Free" } },
				},
				expect: { metric: "pr.avg_m / fr.avg_m", op: "between", target: [1.6, 2.4] },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${TP_CTE},
${MS_CTE},
mc AS (SELECT uid, count(*) FILTER (WHERE event = 'match received') AS matches FROM ev GROUP BY 1),
j AS (
  SELECT u.subscription AS tier, mc.matches
  FROM us u
  JOIN mc ON mc.uid = u.distinct_id::VARCHAR
  JOIN tp ON tp.uid = mc.uid
  JOIN ms ON ms.uid = mc.uid
  WHERE mc.matches >= ${ELITE_MATCH_MULT}
)
SELECT tier, count(*)::BIGINT AS user_count,
  count(*) FILTER (WHERE matches % ${ELITE_MATCH_MULT} = 0)::DOUBLE / count(*) AS mod_share
FROM j WHERE tier IN ('Elite', 'Free') GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "tier");
					const e = by.Elite, f = by.Free;
					if (!e || !f || Number(e.user_count) < 150 || Number(f.user_count) < 150) {
						return { verdict: "WEAK", detail: `cohort too small: Elite=${e?.user_count ?? 0} Free=${f?.user_count ?? 0}` };
					}
					const detail = `Elite mod-${ELITE_MATCH_MULT} share ${Number(e.mod_share).toFixed(4)} (n=${e.user_count}) vs Free placebo ${Number(f.mod_share).toFixed(4)} (n=${f.user_count})`;
					if (e.mod_share >= 0.9 && f.mod_share <= 0.4) return { verdict: "NAILED", detail };
					if (e.mod_share >= 0.75 && f.mod_share <= 0.5) return { verdict: "STRONG", detail };
					return { verdict: e.mod_share > f.mod_share ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H5-ghosting-churn",
		hook: "H5",
		archetype: "retention-divergence",
		narrative:
			`Matched users with no message inside the ${GHOSTING_WINDOW_HOURS}h ghosting window lose ` +
			`${GHOSTING_DROP_LIKELIHOOD}% of post-first-match events (keep rate ${(1 - GHOSTING_DROP_LIKELIHOOD / 100).toFixed(2)}). ` +
			"Arms split on the output-visible timely pair (deletions-only ⇒ visible pair proves non-ghosted; " +
			"hook-timely users whose pair was later dropped land in the ghosted arm and dilute toward null). " +
			"Estimator is the within-user volume-normalized ρ = Σpost-first-match / Σpre-first-match per arm; " +
			"both arms are restricted to non-milestone users so H8's post-day-30 drop applies to BOTH and cancels " +
			"in the ratio (milestone users get H8 clone ADDS, which would inflate the timely arm only). " +
			"The raw ρ_ghosted/ρ_timely ratio is confounded DOWNWARD by activity selection — the ghosted arm is " +
			"the least-engaged matched tail, on an organically flatter trajectory — so the assertion " +
			"self-calibrates: the same ρ computed over each arm's PRE-first-match half-split (H5 never touches " +
			"pre-match events) estimates the organic trajectory ratio, and the selection-corrected keep estimate " +
			"(raw ratio / pre-trajectory ratio) must land within [0.6, 1.4] of the 0.2 knob.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${TP_CTE},
${MS_CTE},
fm AS (SELECT uid, min(t) AS first_match FROM ev WHERE event = 'match received' GROUP BY 1),
per AS (
  SELECT fm.uid,
    count(*) FILTER (WHERE e.t <= fm.first_match) AS pre,
    count(*) FILTER (WHERE e.t > fm.first_match) AS post,
    count(*) FILTER (WHERE e.t <= to_timestamp((epoch(fe.f) + epoch(fm.first_match)) / 2)) AS pre_a,
    count(*) FILTER (WHERE e.t > to_timestamp((epoch(fe.f) + epoch(fm.first_match)) / 2) AND e.t <= fm.first_match) AS pre_b
  FROM fm JOIN fe ON fe.uid = fm.uid JOIN ev e ON e.uid = fm.uid
  GROUP BY 1
),
j AS (
  SELECT p.*, CASE WHEN tp.uid IS NOT NULL THEN 'timely' ELSE 'ghosted' END AS arm
  FROM per p
  LEFT JOIN tp ON tp.uid = p.uid
  WHERE p.uid NOT IN (SELECT uid FROM ms)
)
SELECT arm, count(*)::BIGINT AS user_count,
  sum(post)::DOUBLE / nullif(sum(pre), 0) AS rho,
  sum(pre_b)::DOUBLE / nullif(sum(pre_a), 0) AS rho_pre
FROM j GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const g = by.ghosted, t = by.timely;
					if (!g || !t || Number(g.user_count) < 300 || Number(t.user_count) < 300) {
						return { verdict: "WEAK", detail: `cohort too small: ghosted=${g?.user_count ?? 0} timely=${t?.user_count ?? 0}` };
					}
					if (!(g.rho > 0 && t.rho > 0 && g.rho_pre > 0 && t.rho_pre > 0)) {
						return { verdict: "NONE", detail: "degenerate rho (zero pre or post volume in an arm)" };
					}
					const raw = g.rho / t.rho;
					const keep = 1 - GHOSTING_DROP_LIKELIHOOD / 100;
					const adj = raw / (g.rho_pre / t.rho_pre);
					const r = adj / keep;
					const detail = `raw rho ratio ${raw.toFixed(4)}, pre-trajectory ratio ${(g.rho_pre / t.rho_pre).toFixed(4)}, corrected keep ${adj.toFixed(4)} vs knob ${keep} (r=${r.toFixed(3)}; ghosted n=${g.user_count}, timely n=${t.user_count})`;
					if (raw >= 1) return { verdict: "INVERSE", detail };
					if (r >= 0.6 && r <= 1.4) return { verdict: "NAILED", detail };
					if (r >= 0.45 && r <= 1.75) return { verdict: "STRONG", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
	{
		id: "H6-bio-prompt-power-users",
		hook: "H6",
		archetype: "cohort-count-scale",
		narrative:
			`Users with a bio update AND >=${BIO_PROMPT_THRESHOLD} prompt answers at hook time get ` +
			`${BIO_PROMPT_DATE_CLONE_MULT} cloned dates per existing date (x${BIO_PROMPT_DATE_CLONE_MULT + 1} exact ` +
			"at hook time). At this dungeon's event density (~190 events/user) the power cohort is ~80% of users " +
			"and the rest arm is the low-activity tail whose messages come disproportionately from Date Funnel " +
			"instances (which co-emit dates), so the rest arm's ORGANIC dates-per-message rate runs ~2x the power " +
			"arm's — the population-level rate ratio is a composite: 4x mechanism times a 0.4-0.85 composition " +
			"factor (per-user event density is scale-invariant, so the factor is stable across run sizes), giving " +
			"band [1.5, 3.4]. The mechanism itself is asserted exactly by the second check: for power users who " +
			"are provably non-ghosted (output-visible timely pair) AND milestone (H8 add-branch — clones app " +
			"opens/swipes only), no hook after H6 deletes dates, so output date counts are ≡ 0 (mod 4) except the " +
			"future-guard tail (clones stamped source+1..72h past datasetEnd are silently dropped, ~9%); the same " +
			"clean cohort's REST arm is the placebo at the ~0.25 random baseline.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pw AS (
  SELECT uid,
    count(*) FILTER (WHERE event = 'bio updated') AS bios,
    count(*) FILTER (WHERE event = 'prompt answered') AS prompts,
    count(*) FILTER (WHERE event = 'date scheduled') AS dates,
    count(*) FILTER (WHERE event = 'message sent') AS msgs
  FROM ev GROUP BY 1
),
j AS (
  SELECT CASE WHEN bios >= 1 AND prompts >= ${BIO_PROMPT_THRESHOLD} THEN 'power' ELSE 'rest' END AS arm, dates, msgs
  FROM pw WHERE msgs > 0
)
SELECT arm, count(*)::BIGINT AS user_count, sum(dates)::DOUBLE / sum(msgs) AS date_rate
FROM j GROUP BY 1`,
				},
				select: {
					p: { where: { arm: "power" } },
					r: { where: { arm: "rest" } },
				},
				expect: { metric: "p.date_rate / r.date_rate", op: "between", target: [1.5, 3.4] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${TP_CTE},
${MS_CTE},
pw AS (
  SELECT uid,
    count(*) FILTER (WHERE event = 'bio updated') AS bios,
    count(*) FILTER (WHERE event = 'prompt answered') AS prompts,
    count(*) FILTER (WHERE event = 'date scheduled') AS dates
  FROM ev GROUP BY 1
),
j AS (
  SELECT CASE WHEN p.bios >= 1 AND p.prompts >= ${BIO_PROMPT_THRESHOLD} THEN 'power' ELSE 'rest' END AS arm, p.dates
  FROM pw p JOIN tp ON tp.uid = p.uid JOIN ms ON ms.uid = p.uid
  WHERE p.dates >= ${BIO_PROMPT_DATE_CLONE_MULT + 1}
)
SELECT arm, count(*)::BIGINT AS user_count,
  count(*) FILTER (WHERE dates % ${BIO_PROMPT_DATE_CLONE_MULT + 1} = 0)::DOUBLE / count(*) AS mod_share
FROM j GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const p = by.power, r = by.rest;
					if (!p || !r || Number(p.user_count) < 300 || Number(r.user_count) < 100) {
						return { verdict: "WEAK", detail: `cohort too small: power=${p?.user_count ?? 0} rest=${r?.user_count ?? 0}` };
					}
					const detail = `power mod-${BIO_PROMPT_DATE_CLONE_MULT + 1} share ${Number(p.mod_share).toFixed(4)} (n=${p.user_count}) vs rest placebo ${Number(r.mod_share).toFixed(4)} (n=${r.user_count})`;
					if (p.mod_share >= 0.9 && r.mod_share <= 0.4) return { verdict: "NAILED", detail };
					if (p.mod_share >= 0.8 && r.mod_share <= 0.5) return { verdict: "STRONG", detail };
					return { verdict: p.mod_share > r.mod_share ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H7-vday-spike",
		hook: "H7",
		archetype: "temporal-inflection",
		narrative:
			`Inside the V-Day window (days ${VDAY_WINDOW_START_DAY}-${VDAY_WINDOW_END_DAY}: ${VDAY_START_TS} → ` +
			`${VDAY_END_TS}), signups are cloned x${VDAY_SIGNUP_CLONES} extra and premium upgrades ` +
			`x${VDAY_UPGRADE_CLONES} extra. Clones are stamped source+U[1,48]h (signups) / +U[1,24]h (upgrades), ` +
			"so a computable share leaks past the window edge: E[leak] = (48/2)/120h = 20% of signup clones and " +
			"(24/2)/120h = 10% of upgrade clones, giving in-window daily multipliers of 1+2*0.8 = 2.6 and " +
			"1+4*0.9 = 4.6. Baseline = symmetric 14-day flanks, with the post flank starting +3 days after window " +
			"end so leaked clones cannot inflate it; symmetric flanks cancel the growth-soup trend to first order " +
			"(convexity bias ~1% at this window size). Bands: signups [2.0, 3.3], upgrades [3.5, 5.6].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS tag,
  count(*) FILTER (WHERE t >= TIMESTAMP '${VDAY_START_TS}' AND t < TIMESTAMP '${VDAY_END_TS}')::BIGINT AS user_count,
  count(*) FILTER (WHERE t >= TIMESTAMP '${VDAY_START_TS}' AND t < TIMESTAMP '${VDAY_END_TS}') / ${VDAY_DAYS}.0 AS w_daily,
  count(*) FILTER (WHERE (t >= TIMESTAMP '${VDAY_BASE_PRE_TS}' AND t < TIMESTAMP '${VDAY_START_TS}')
                OR (t >= TIMESTAMP '${VDAY_BASE_POST_START_TS}' AND t < TIMESTAMP '${VDAY_BASE_POST_END_TS}')) / 28.0 AS b_daily
FROM ev WHERE event = 'profile created'`,
				},
				select: { r: { where: { tag: "all" } } },
				expect: { metric: "r.w_daily / r.b_daily", op: "between", target: [2.0, 3.3] },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS tag,
  count(*) FILTER (WHERE t >= TIMESTAMP '${VDAY_START_TS}' AND t < TIMESTAMP '${VDAY_END_TS}')::BIGINT AS user_count,
  count(*) FILTER (WHERE t >= TIMESTAMP '${VDAY_START_TS}' AND t < TIMESTAMP '${VDAY_END_TS}') / ${VDAY_DAYS}.0 AS w_daily,
  count(*) FILTER (WHERE (t >= TIMESTAMP '${VDAY_BASE_PRE_TS}' AND t < TIMESTAMP '${VDAY_START_TS}')
                OR (t >= TIMESTAMP '${VDAY_BASE_POST_START_TS}' AND t < TIMESTAMP '${VDAY_BASE_POST_END_TS}')) / 28.0 AS b_daily
FROM ev WHERE event = 'premium upgrade'`,
				},
				select: { r: { where: { tag: "all" } } },
				expect: { metric: "r.w_daily / r.b_daily", op: "between", target: [3.5, 5.6] },
				minCohort: 60,
			},
		],
	},
	{
		id: "H8-offapp-retention",
		hook: "H8",
		archetype: "retention-divergence",
		narrative:
			`Non-milestone users lose ${OFFAPP_DROP_LIKELIHOOD}% of post-day-${RETENTION_CUTOFF_DAYS} events; ` +
			"milestone users (early phone/date) instead get app-open/swipe clones topping post-30 volume toward " +
			`${RETENTION_TARGET_PCT * 100}% of total — but for early-born users the organic post-30 share already ` +
			"exceeds 30% (growth soup back-loads events), so the milestone arm is approximately organic and the " +
			"measurable signal is the drop. Cohort: born before day 30 (retention clones land day30+U[1,60], so " +
			"the whole clone support fits the window — later-born users lose clones to the future guard), AND " +
			"provably non-ghosted (timely pair) or match-free, so H5's post-match drop cannot masquerade as H8. " +
			"Self-calibrating check: with keep k=0.2 and milestone-arm share s as the organic estimate, predicted " +
			"rest-arm share = k*s/(1-(1-k)*s); measured/predicted in [0.7, 1.35] (NAILED) / [0.55, 1.6] (STRONG).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${TP_CTE},
${MS_CTE},
mc AS (SELECT uid, count(*) FILTER (WHERE event = 'match received') AS matches FROM ev GROUP BY 1),
per AS (
  SELECT fe.uid,
    count(*) FILTER (WHERE e.t > fe.f + INTERVAL ${RETENTION_CUTOFF_DAYS} DAY) AS post30,
    count(*) AS total
  FROM fe JOIN ev e ON e.uid = fe.uid
  WHERE fe.f < TIMESTAMP '${H8_EARLYBORN_TS}'
  GROUP BY 1
),
j AS (
  SELECT p.*, CASE WHEN ms.uid IS NOT NULL THEN 'milestone' ELSE 'rest' END AS arm
  FROM per p
  LEFT JOIN ms ON ms.uid = p.uid
  LEFT JOIN tp ON tp.uid = p.uid
  LEFT JOIN mc ON mc.uid = p.uid
  WHERE tp.uid IS NOT NULL OR coalesce(mc.matches, 0) = 0
)
SELECT arm, count(*)::BIGINT AS user_count, sum(post30)::DOUBLE / sum(total) AS post30_share
FROM j GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const m = by.milestone, r = by.rest;
					if (!m || !r || Number(m.user_count) < 200 || Number(r.user_count) < 200) {
						return { verdict: "WEAK", detail: `cohort too small: milestone=${m?.user_count ?? 0} rest=${r?.user_count ?? 0}` };
					}
					const keep = 1 - OFFAPP_DROP_LIKELIHOOD / 100;
					const sM = Number(m.post30_share), sR = Number(r.post30_share);
					if (!(sM > 0 && sM < 1)) return { verdict: "NONE", detail: `degenerate milestone share ${sM}` };
					const pred = (keep * sM) / (1 - (1 - keep) * sM);
					const ratio = sR / pred;
					const detail = `milestone share ${sM.toFixed(4)} (n=${m.user_count}), rest share ${sR.toFixed(4)} (n=${r.user_count}), predicted rest ${pred.toFixed(4)}, measured/predicted ${ratio.toFixed(3)}`;
					if (!(sM > sR)) return { verdict: "INVERSE", detail };
					if (ratio >= 0.7 && ratio <= 1.35) return { verdict: "NAILED", detail };
					if (ratio >= 0.55 && ratio <= 1.6) return { verdict: "STRONG", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
	{
		id: "H9-match-flow-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative:
			`funnel-post stretches Match Flow inter-step gaps by tier: Elite x${FUNNEL_TTC_ELITE}, Free ` +
			`x${FUNNEL_TTC_FREE}, Premium untouched (the v1.6 hook is scoped to Match Flow only). Cross-event SQL ` +
			"cannot see this (greedy single-pass pairing across the full history — the documented v1.5 " +
			"limitation), so the assertion goes through the Mixpanel-aligned emulator's timeToConvert at a " +
			`conversion window of 24h * ${FUNNEL_TTC_FREE} = 33.6h — the generative Match Flow window times the ` +
			"max stretch factor, covering the stretched support so Free conversions are not right-censored (the " +
			"ai-platform lesson: censoring inverts the measured direction). Median ratios vs the untouched " +
			"Premium tier read the knobs, compressed toward 1 by cross-instance organic pairings — and this " +
			"dungeon's clone traffic (H2 Sunday swipes at ~2.4x daily volume, H3/H4 match injections) makes the " +
			"organic mixture heavier than ai-platform's. Compression is asymmetric: the Free stretch pushes " +
			"true-instance completions LATER, so a competing organic pairing more often lands first and masks " +
			"them (only ~25-30% of the 1.4 knob distance survives), while the Elite compression pulls completions " +
			"EARLIER, which organic events can rarely preempt (~65% survives). Bands: Elite/Premium in " +
			"[0.55, 0.92], Free/Premium in [1.05, 1.55].",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["swipe right", "match received", "message sent"],
					breakdownByUserProperty: "subscription",
					conversionWindowMs: Math.round(24 * FUNNEL_TTC_FREE * 3600 * 1000),
				},
				select: {
					el: { where: { segment_value: "Elite" } },
					pr: { where: { segment_value: "Premium" } },
				},
				expect: { metric: "el.median_ttc_ms / pr.median_ttc_ms", op: "between", target: [0.55, 0.92] },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["swipe right", "match received", "message sent"],
					breakdownByUserProperty: "subscription",
					conversionWindowMs: Math.round(24 * FUNNEL_TTC_FREE * 3600 * 1000),
				},
				select: {
					fr: { where: { segment_value: "Free" } },
					pr: { where: { segment_value: "Premium" } },
				},
				expect: { metric: "fr.median_ttc_ms / pr.median_ttc_ms", op: "between", target: [1.05, 1.55] },
				minCohort: 400,
			},
		],
	},
	{
		id: "H10-age-date-conversion",
		hook: "H10",
		archetype: "funnel-conversion-by-segment",
		narrative:
			`funnel-pre scales Date Funnel completion probability by age: 25-29/30-34 x${AGE_CONV_BOOST} (capped ` +
			`at 95), 40+ x${AGE_CONV_DROP}. Measured through the emulator's Date Funnel step counts per age_range ` +
			"at the 72h generative window (H9 no longer stretches this funnel — it is Match Flow-scoped in v1.6). " +
			"Organic weight-drawn phone/date events add age-independent conversions on top of the funnel-driven " +
			"ones, compressing both ratios toward 1, so bands sit inside the knobs: boost/base in [1.05, 1.45], " +
			"drop/base in [0.45, 0.88], where base pools 18-24 and 35-39 (the x1.0 segments) with attempt-weighted " +
			"conversion.",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["message sent", "phone number exchanged", "date scheduled"],
					breakdownByUserProperty: "age_range",
					conversionWindowMs: 72 * 3600 * 1000,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const cells = (names) => names.map((n) => by[n]).filter(Boolean);
					const conv = (names) => {
						const cs = cells(names);
						const entered = cs.reduce((s, c) => s + (c.step_counts?.[0] ?? 0), 0);
						const done = cs.reduce((s, c) => s + (c.step_counts?.[2] ?? 0), 0);
						return entered > 0 ? { rate: done / entered, entered } : null;
					};
					const boost = conv(["25-29", "30-34"]);
					const base = conv(["18-24", "35-39"]);
					const drop = conv(["40+"]);
					if (!boost || !base || !drop) return { verdict: "NONE", detail: "missing age segments in emulator rows" };
					if (boost.entered < 500 || base.entered < 500 || drop.entered < 250) {
						return { verdict: "WEAK", detail: `attempts too few: boost=${boost.entered} base=${base.entered} drop=${drop.entered}` };
					}
					const rb = boost.rate / base.rate;
					const rd = drop.rate / base.rate;
					const detail = `boost/base=${rb.toFixed(3)}, drop/base=${rd.toFixed(3)} (rates ${boost.rate.toFixed(4)}/${base.rate.toFixed(4)}/${drop.rate.toFixed(4)}; attempts ${boost.entered}/${base.entered}/${drop.entered})`;
					if (rb >= 1.05 && rb <= 1.45 && rd >= 0.45 && rd <= 0.88) return { verdict: "NAILED", detail };
					if (rb >= 1.02 && rd <= 0.94) return { verdict: "STRONG", detail };
					if (rb > 1 && rd < 1) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
];

export default config;
