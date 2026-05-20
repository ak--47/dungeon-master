/**
 * User Loop Orchestrator module
 * Manages user generation and event creation workflow
 */

/** @typedef {import('../../types').Context} Context */

import dayjs from "dayjs";
import { randomUUID } from "node:crypto";
import pLimit from 'p-limit';
import os from 'os';
import * as u from "../utils/utils.js";
import * as t from 'ak-tools';
import { makeEvent } from "../generators/events.js";
import { makeFunnel } from "../generators/funnels.js";
import { makeUserProfile } from "../generators/profiles.js";
import { makeSCD } from "../generators/scd.js";

/**
 * Main user generation loop that creates users, their profiles, events, and SCDs
 * @param {Context} context - Context object containing config, defaults, storage, etc.
 * @returns {Promise<void>}
 */
export async function userLoop(context) {
	const { config, storage, defaults } = context;
	const chance = u.getChance();
	const concurrency = config?.concurrency ?? 1;
	const USER_CONN = pLimit(concurrency);

	const {
		verbose,
		numUsers,
		numEvents,
		isAnonymous,
		hasAvatar,
		hasAnonIds,
		avgDevicePerUser = 0,
		hasSessionIds,
		hasLocation,
		funnels,
		userProps,
		scdProps,
		numDays,
		avgEventsPerUserPerDay,
		avgActiveDaysPerUser,
		percentUsersBornInDataset = 15,
		strictEventCount = false,
		bornRecentBias = 0, // -1..1; positive = births skew toward end of window
		preExistingSpread = 'uniform', // 'pinned' (FIXED_BEGIN ± 1d) | 'uniform' ([FIXED_BEGIN-30d, FIXED_BEGIN])
		personas,
		worldEvents,
		engagementDecay: globalEngagementDecay,
		dataQuality,
	} = config;

	const { eventData, userProfilesData, scdTableData } = storage;
	// Per-user-per-day rate is the canonical event-volume primitive (config-validator
	// guarantees it is set). Each user's event count is rate × their active days, so
	// born-late users don't compress a full per-user budget into a tiny window.
	const ratePerDay = avgEventsPerUserPerDay ?? (numEvents / numUsers / numDays);
	const startTime = Date.now();

	// Create batches for parallel processing
	const batchSize = Math.max(1, Math.ceil(numUsers / concurrency));
	const userPromises = [];

	// Track if we've already logged the strict event count message
	let hasLoggedStrictCountReached = false;

	// Handle graceful shutdown on SIGINT (Ctrl+C).
	// CRITICAL: listener MUST be removed in a `finally` block — pre-fix, throws /
	// cancellation paths leaked listeners across test runs, accumulating until
	// Node fired the MaxListenersExceededWarning AND test workers stalled.
	let cancelled = false;
	const onSigint = () => {
		cancelled = true;
		USER_CONN.clearQueue();
		if (verbose) console.log(`\n\nStopping generation (Ctrl+C)...\n`);
	};
	process.on('SIGINT', onSigint);

	try {
	for (let i = 0; i < numUsers; i++) {
		const userPromise = USER_CONN(async () => {
			// Bail out if cancelled
			if (cancelled) return;

			// Bail out early if strictEventCount is enabled and we've hit numEvents
			if (strictEventCount && context.getEventCount() >= numEvents) {
				if (verbose && !hasLoggedStrictCountReached) {
					console.log(`\n\u2713 Reached target of ${numEvents.toLocaleString()} events with strict event count enabled. Stopping user generation.`);
					hasLoggedStrictCountReached = true;
				}
				return;
			}

			context.incrementUserCount();
			const eps = Math.floor(context.getEventCount() / ((Date.now() - startTime) / 1000));
			const memUsed = u.bytesHuman(process.memoryUsage().heapUsed);
			const duration = u.formatDuration(Date.now() - startTime);

			if (verbose) {
				u.progress([
					["users", context.getUserCount()],
					["events", context.getEventCount()],
					["eps", eps],
					["mem", memUsed],
					["time", duration]
				]);
			}

			context.reportProgress({
				phase: "generation",
				users: context.getUserCount(),
				events: context.getEventCount(),
				eps,
				memory: memUsed,
				elapsed: duration,
				percentComplete: Math.min(100, Math.round((context.getUserCount() / numUsers) * 100))
			});

			// v1.5.1: distinct_id sourced from a separate `userChance` when
			// `Dungeon.userSeed` is set. This lets sharded runs (e.g., kodiak
			// Cloud Run Job) generate the SAME user pool with DIFFERENT events
			// across shards. Falls back to the event chance when userSeed is
			// unset so existing dungeons stay byte-identical.
			const userId = u.getUserChance().guid();
			const user = u.generateUser(userId, { numDays, isAnonymous, hasAvatar, hasAnonIds, hasSessionIds, datasetEndUnix: context.FIXED_NOW, avgDevicePerUser });
			const { distinct_id, created } = user;
			const userDevicePool = (user.anonymousIds && user.anonymousIds.length) ? user.anonymousIds.slice() : null;
			const userIsBornInDataset = chance.bool({ likelihood: percentUsersBornInDataset });

			// Feature 1: Assign persona
			let persona = null;
			if (personas && personas.length > 0) {
				const weights = personas.map(p => p.weight);
				const totalWeight = weights.reduce((a, b) => a + b, 0);
				let roll = chance.floating({ min: 0, max: totalWeight });
				for (const p of personas) {
					roll -= p.weight;
					if (roll <= 0) { persona = p; break; }
				}
				if (!persona) persona = personas[personas.length - 1];
			}
			let numEventsPreformed = 0;

			if (!userIsBornInDataset) delete user.created;

			// Apply recency bias to birth dates for users born in dataset.
			// `created` (from generateUser → person) is anchored to the dataset end,
			// so it already lives inside [FIXED_BEGIN, FIXED_NOW]. No shift needed.
			// bornRecentBias: 0 = uniform distribution, 1 = heavily biased toward recent
			let adjustedCreated;
			if (userIsBornInDataset) {
				let biasedCreated = dayjs(created);

				if (bornRecentBias !== 0) {
					// Calculate how far into the dataset this user was born (0 = start, 1 = end/recent)
					const datasetStart = dayjs.unix(context.FIXED_BEGIN);
					const datasetEnd = dayjs.unix(context.FIXED_NOW);
					const totalDuration = datasetEnd.diff(datasetStart);
					// Clamp userPosition to [0, 1] to handle edge cases from rounding in time calculations
					const userPosition = Math.max(0, Math.min(1, biasedCreated.diff(datasetStart) / totalDuration));

					let biasedPosition;
					if (bornRecentBias > 0) {
						// Positive bias: exponent < 1 shifts distribution toward 1 (recent)
						const exponent = 1 - (bornRecentBias * 0.7); // 0.3 bias -> 0.79 exponent (gentle nudge)
						biasedPosition = Math.pow(userPosition, exponent);
					} else {
						// Negative bias: mirror the power function to shift toward 0 (early)
						// -0.3 bias -> 0.79 exponent applied to (1 - position), then mirrored back
						const exponent = 1 - (Math.abs(bornRecentBias) * 0.7);
						biasedPosition = 1 - Math.pow(1 - userPosition, exponent);
					}

					// Convert back to timestamp
					biasedCreated = datasetStart.add(biasedPosition * totalDuration, 'millisecond');
				}

				adjustedCreated = biasedCreated;
				// Update user.created to match biased timestamp for profile consistency
				user.created = adjustedCreated.toISOString();
			} else {
				// Pre-existing user: choose where their "first ever event" lives.
				// 'pinned' (legacy): exactly at FIXED_BEGIN — all pre-existing users stack
				//   at day 0, which front-loads early-window event density.
				// 'uniform' (default): sample uniformly from [FIXED_BEGIN - 30d, FIXED_BEGIN]
				//   so pre-existing users have varied "born before dataset" timestamps.
				//   Their TimeSoup-distributed events still mostly land in [FIXED_BEGIN, FIXED_NOW].
				if (preExistingSpread === 'uniform') {
					const offsetDays = chance.floating({ min: 0, max: 30 });
					adjustedCreated = dayjs.unix(context.FIXED_BEGIN).subtract(offsetDays, 'day');
				} else {
					adjustedCreated = dayjs.unix(context.FIXED_BEGIN);
				}
			}

			let userLocation = null;
			if (hasLocation) {
				const location = u.pickRandom(u.choose(defaults.locationsUsers));
				for (const key in location) {
					user[key] = location[key];
				}
				userLocation = location;
			}

			// Profile creation
			const profile = await makeUserProfile(context, userProps, user);

			// Feature 1: Merge persona properties into profile (before hook, so hook can override)
			if (persona && persona.properties) {
				for (const [key, value] of Object.entries(persona.properties)) {
					profile[key] = u.choose(value);
				}
				profile._persona = persona.name;
			}

			// Build feature context for event generation
			const featureCtx = {
				persona,
				userLocation,
				worldEventsTimeline: worldEvents,
				dataQuality,
			};

			// Call user hook after profile creation (hooks override persona properties).
			// v1.5.1: an explicit `null` return is interpreted as "drop the user
			// PROFILE record" — the user's events still generate normally. Used
			// by sharded runs that have one canonical chunk per bucket emit profiles
			// while every other chunk skips them (see dungeons/user/kodiak/).
			let dropUserProfile = false;
			if (config.hook) {
				const hookedProfile = await config.hook(profile, "user", {
					user,
					config,
					userIsBornInDataset,
					persona,
					datasetStart: context.DATASET_START_SECONDS,
					datasetEnd: context.DATASET_END_SECONDS
				});
				if (hookedProfile === null) {
					dropUserProfile = true;
				}
			}

			// SCD creation
			// @ts-ignore
			const scdUserTables = t.objFilter(scdProps, (scd) => scd.type === 'user' || !scd.type);
			const scdTableKeys = Object.keys(scdUserTables);

			const userSCD = {};
			for (const [index, key] of scdTableKeys.entries()) {
				const { max = 10 } = scdProps[key];
				const mutations = chance.integer({ min: 1, max });
				let changes = await makeSCD(context, scdProps[key], key, distinct_id, mutations, created);
				userSCD[key] = changes;

				if (config.hook) {
					const hookResult = await config.hook(changes, "scd-pre", {
						profile,
						type: 'user',
						scd: { [key]: scdProps[key] },
						config,
						allSCDs: userSCD,
						datasetStart: context.DATASET_START_SECONDS,
						datasetEnd: context.DATASET_END_SECONDS
					});
					if (Array.isArray(hookResult)) {
						changes = hookResult;
						userSCD[key] = changes;
					}
				}
			}

			// User's active days = how much of the dataset window they're alive for.
			// Pre-existing users: full window. Born-in-dataset: from birth to FIXED_NOW.
			// Floor at 1 day so users born on the very last day still emit a few events.
			const userActiveDays = userIsBornInDataset
				? Math.max(1, (context.FIXED_NOW - adjustedCreated.unix()) / 86400)
				: numDays;
			const userEventBudget = ratePerDay * userActiveDays;

			// v1.5.1 (TODO #10): per-user event budget.
			//
			// Removed:
			//   - the 0.714 magic dampening factor (pre-existing vestigial constant)
			//   - the ×5 / ×0.333 "power user" / "low activity" dice rolls
			//     (E[dice mult] ≈ 1.62, combined with 0.714 ≈ 1.16x inflation
			//     by design — produced 60-100% systematic overshoot on
			//     `numEvents` targets across all macros).
			//
			// New: pure normal distribution around `userEventBudget` with
			// `dev = userEventBudget / 3` (~68% of users within ±1σ of target,
			// ~95% within ±2σ). Real heavy-tail behavior should come from
			// `personas` (`eventMultiplier`) — explicit, opt-in, documented.
			let numEventsThisUserWillPreform = Math.max(0, Math.round(chance.normal({
				mean: userEventBudget,
				dev: userEventBudget / 3,
			})));
			if (persona) {
				numEventsThisUserWillPreform *= persona.eventMultiplier;
			}
			numEventsThisUserWillPreform = Math.round(numEventsThisUserWillPreform);

			let userFirstEventTime;

			// ── v1.5 Active-day scheduling ──
			// When `avgActiveDaysPerUser` is set, build a per-user day plan: a list
			// of UTC day-start unix-seconds, one entry per planned event. Each event
			// generation call pops the next day from the plan and constrains TimeSoup
			// to that day's [start, end] range. Funnel events anchor on the picked
			// day; subsequent funnel steps spill within `timeToConvert` hours.
			//
			// When unset, dayPlan stays null and behavior is fully legacy (TimeSoup
			// across [adjustedCreated, FIXED_NOW]).
			const soupCfgForActiveDay = /** @type {import('../../types').SoupConfig} */ (config.soup) || {};
			// v1.5 follow-up (Fix #1): buildActiveDayPlan returns
			// `{ plan, pickedDayBuckets }`. `pickedDayBuckets` flows into
			// `applyEngagementDecay` so the decay filter never drops the last event
			// on a picked day — preserving the configured distinct-day count.
			const dayPlanResult = (avgActiveDaysPerUser !== undefined && avgActiveDaysPerUser !== null && Number.isFinite(avgActiveDaysPerUser))
				? buildActiveDayPlan({
					adjustedCreated, fixedBegin: context.FIXED_BEGIN, fixedNow: context.FIXED_NOW,
					avgActiveDaysPerUser, userActiveDays,
					numEvents: numEventsThisUserWillPreform,
					dowWeights: soupCfgForActiveDay.dayOfWeekWeights,
					chance,
				})
				: null;
			const dayPlan = dayPlanResult ? dayPlanResult.plan : null;
			const pickedDayBuckets = dayPlanResult ? dayPlanResult.pickedDayBuckets : null;
			let dayPlanCursor = 0;
			const nextDayBounds = () => {
				if (!dayPlan || !dayPlan.length) return null;
				// When the plan is exhausted, wrap (over-generation due to noise rounding;
				// bounded re-use keeps remaining events on picked days rather than spilling).
				const dayStartSec = dayPlan[dayPlanCursor % dayPlan.length];
				dayPlanCursor++;
				const dayEndSec = Math.min(dayStartSec + 86400 - 1, context.FIXED_NOW);
				return { earliest: Math.max(dayStartSec, context.FIXED_BEGIN), latest: dayEndSec };
			};

			const firstFunnels = funnels.filter((f) => f.isFirstFunnel)
				.filter((f) => !f.conditions || matchConditions(profile, f.conditions))
				.reduce(weighFunnels, []);
			const usageFunnels = funnels.filter((f) => !f.isFirstFunnel)
				.filter((f) => !f.conditions || matchConditions(profile, f.conditions))
				.reduce(weighFunnels, []);

			const secondsInDay = 86400;
			const noise = () => chance.integer({ min: 0, max: secondsInDay });
			let usersEvents = [];
			let userConverted = true;

			// Pre-compute weighted events array for standalone event selection.
			// Filter out isStrictEvent events — they only appear inside funnels.
			const weightedEvents = config.events.filter(e => !e.isStrictEvent).reduce((acc, event) => {
				const w = Math.max(1, Math.min(Math.floor(event.weight) || 1, 10));
				for (let i = 0; i < w; i++) acc.push(event);
				return acc;
			}, []);

			// Build churn event lookup: { eventName: returnLikelihood }
			const churnEvents = new Map();
			for (const ev of config.events) {
				if (ev.isChurnEvent) {
					churnEvents.set(ev.event, ev.returnLikelihood ?? 0);
				}
			}

			// ── Phase 2 identity tracking ──
			// Pre-existing users are considered already-stitched before the dataset window —
			// `userAuthed` starts true. Born-in-dataset users start anonymous and only flip
			// authed once the stitch (`isAuthEvent` step in their `isFirstFunnel`) actually
			// fires. `userAuthTimeMs` is the unix-millisecond timestamp of that stitch event.
			let userAuthed = !userIsBornInDataset;
			let userAuthTimeMs = null;

			// PATH FOR USERS BORN IN DATASET AND PERFORMING FIRST FUNNEL
			if (firstFunnels.length && userIsBornInDataset) {
				const firstFunnel = chance.pickone(firstFunnels, user);
				// Active-day mode: anchor the first funnel on a picked day so the user's
				// signup lands within their planned active window. Legacy mode: anchor at
				// adjustedCreated minus a noise offset.
				let cursor;
				if (dayPlan) {
					const bounds = nextDayBounds();
					cursor = bounds ? bounds.earliest : adjustedCreated.subtract(noise(), 'seconds').unix();
				} else {
					cursor = adjustedCreated.subtract(noise(), 'seconds').unix();
				}

				// Resolve attempts plan. `attempts.{min,max}` count FAILED PRIORS; total
				// passes = failedPriors + 1.  Validator coerced bounds; default both 0.
				const attemptsCfg = firstFunnel.attempts || null;
				const minA = attemptsCfg ? (attemptsCfg.min || 0) : 0;
				const maxA = attemptsCfg ? (attemptsCfg.max || 0) : 0;
				const failedPriors = (maxA > 0) ? chance.integer({ min: minA, max: maxA }) : 0;
				const totalAttempts = failedPriors + 1;
				let firstAttemptFirstEventTime = null;

				for (let attemptNum = 1; attemptNum <= totalAttempts; attemptNum++) {
					const isFinal = attemptNum === totalAttempts;
					// On the final attempt, `attempts.conversionRate` (when set) overrides the
					// funnel's normal conversionRate. Clone the funnel object so we don't
					// mutate the shared config.
					const funnelToRun = (isFinal && attemptsCfg && attemptsCfg.conversionRate !== undefined)
						? { ...firstFunnel, conversionRate: attemptsCfg.conversionRate }
						: firstFunnel;
					const attemptMeta = {
						isFirstFunnel: true,
						isBorn: true,
						attemptsConfig: attemptsCfg,
						attemptNumber: attemptNum,
						totalAttempts,
						isFinalAttempt: isFinal,
						truncateBeforeAuth: !isFinal,
						devicePool: userDevicePool,
					};
					const [data, converted, authMs] = await makeFunnel(
						context, funnelToRun, user, cursor, profile, userSCD, persona, featureCtx, attemptMeta
					);
					if (isFinal) userConverted = converted;
					if (data && data.length) {
						if (firstAttemptFirstEventTime === null) {
							firstAttemptFirstEventTime = dayjs(data[0].time).unix();
						}
						// Advance the cursor for the next attempt by a small abandon-and-retry gap.
						const lastTime = dayjs(data[data.length - 1].time).unix();
						cursor = lastTime + chance.integer({ min: 60, max: 30 * 60 }); // 1–30 min later
						numEventsPreformed += data.length;
						usersEvents = usersEvents.concat(data);
					}
					if (authMs) {
						// First time we see a stitch wins — should only happen on the final attempt.
						if (userAuthTimeMs === null) userAuthTimeMs = authMs;
						userAuthed = true;
					}
				}

				userFirstEventTime = firstAttemptFirstEventTime !== null
					? firstAttemptFirstEventTime
					: Math.max(adjustedCreated.subtract(noise(), 'seconds').unix(), context.FIXED_BEGIN);
			} else {
				// v1.5.1: clamp at FIXED_BEGIN so pre-existing-user events stay strictly
				// inside the dataset window. Without this, `noise()` (up to 1 day) can
				// shift the first-event time before FIXED_BEGIN — fine when the dataset
				// is years long, but visible at sub-day chunk windows (kodiak shards).
				userFirstEventTime = Math.max(adjustedCreated.subtract(noise(), 'seconds').unix(), context.FIXED_BEGIN);
			}

			// ALL SUBSEQUENT EVENTS (funnels for converted users, standalone for all)
			let userChurned = false;
			const sessionTimeout = config.sessionTimeout || 30;

			// Standalone identity stamping mode: pre-existing or post-auth users get both
			// user_id + device_id; born-in-dataset users who never authed (final firstFunnel
			// attempt failed) stay device_only forever per the Phase 2 model.
			const standaloneStamping = userAuthed ? 'both' : 'device_only';
			const standaloneIdentityCtx = (userDevicePool || standaloneStamping !== 'both')
				? { stamping: standaloneStamping, devicePool: userDevicePool }
				: null;
			// Usage funnels for converted users: identity already stitched, just default 'both'.
			const usageAttemptMeta = { isFirstFunnel: false, isBorn: userIsBornInDataset, devicePool: userDevicePool };

			// v1.5 follow-up (engine bunchiness fix, 2026-05-09):
			// REMOVED `usageFunnelCursor` accumulator. Each funnel call now uses
			// `userFirstEventTime` (constant) as the anchor. Without this, the cursor
			// chained `last_event_time + small_gap` between funnel runs, walking past
			// FIXED_NOW and producing the right-edge bunchiness regression. See
			// `plans/ENGINE-BUNCHINESS/FIX.md` for the full diagnosis.
			//
			// Loop budget now counts SURVIVING events (post `_drop`), not raw output.
			// Combined with the cursor removal, this gives each funnel an independent
			// uniform-in-window anchor (via TimeSoup) and lets the budget loop iterate
			// until the user actually has the target event count.
			//
			// v1.5: when auto-promote marks every event strict (e.g. all events appear in
			// the only funnel), there's nothing for the standalone branch to pick. Bail
			// out cleanly rather than crashing on `pick([])`.
			const hasUsageFunnels = usageFunnels.length > 0;
			const hasStandaloneEvents = weightedEvents.length > 0;
			// v1.5.1 (TODO #10): shortest usage-funnel length. Used to decide
			// whether the remaining budget can fit another funnel run — funnels
			// add N events at once, so iterations near the budget ceiling
			// systematically overshot. Now we redirect to standalone (or break)
			// when the remaining headroom is smaller than the smallest funnel.
			const minUsageFunnelLen = hasUsageFunnels
				? Math.min(...usageFunnels.map(f => Array.isArray(f.sequence) ? f.sequence.length : 1))
				: Infinity;
			// Hard ceiling on iterations: defends against pathological configs where
			// every funnel produces 0 surviving events (e.g. ttc > numDays so step1
			// uniform anchor always lands too late). Cap at 2× expected iteration count
			// based on average funnel length (~7 steps) to avoid infinite loops.
			const MAX_ITERATIONS = Math.max(100, numEventsThisUserWillPreform * 2);
			let iterationCount = 0;
			while (numEventsPreformed < numEventsThisUserWillPreform && !cancelled && iterationCount < MAX_ITERATIONS) {
				iterationCount++;
				let newEvents;
				// v1.5 active-day: pop next picked-day bounds. Pass `latestTime` through
				// featureCtx so makeEvent's TimeSoup confines to that day. Funnel cursor
				// gets re-anchored to the picked day's start (subsequent funnel steps
				// spill within `timeToConvert` hours; this is intentional).
				const dayBounds = dayPlan ? nextDayBounds() : null;
				// Compute step1's `latestTime` so the funnel's relative span fits before
				// FIXED_NOW. Without this, born-late users + long-ttc funnels generate
				// large numbers of `_drop`'d events that consume budget cycles. The
				// safety margin is `timeToConvert * 3600 - 1` seconds (matches v1.5
				// conversion window contract).
				const standaloneFeatureCtx = dayBounds
					? { ...featureCtx, latestTime: dayBounds.latest }
					: featureCtx;
				// Nothing to generate: user converted via firstFunnel only and has no
				// usage funnels and no standalone events. Stop attempting.
				if ((!hasUsageFunnels || !userConverted) && !hasStandaloneEvents) break;
				// v1.5.1 (TODO #10): if the remaining budget can't fit even the
				// shortest usage funnel, prefer a standalone event (or break if
				// no standalone). Without this, the funnel branch added N events
				// at once and overshot `numEvents` by `(funnel_length - 1)` per
				// terminal iteration — measured ~5-15% systematic overshoot.
				const remainingBudget = numEventsThisUserWillPreform - numEventsPreformed;
				const useFunnel = hasUsageFunnels && userConverted && remainingBudget >= minUsageFunnelLen;
				// Budget exhausted for funnels AND no standalone → break.
				if (!useFunnel && !hasStandaloneEvents) break;
				if (useFunnel) {
					const currentFunnel = chance.pickone(usageFunnels);
					const ttcSec = (currentFunnel.timeToConvert || 0) * 3600;
					// Anchor cursor at picked day's start when active-day mode is on,
					// otherwise pass userFirstEventTime (constant). NO cursor accumulation.
					const funnelCursor = dayBounds ? dayBounds.earliest : userFirstEventTime;
					// Constrain funnel step1's TimeSoup latestTime so the full funnel fits in
					// window. Without this, late steps spill past FIXED_NOW and get `_drop`'d.
					//
					// v1.5 final (2026-05-09): `FUNNEL_DEAD_ZONE_CAP_SEC = 0` — funnels can
					// anchor step1 right up to FIXED_NOW. Earlier rounds defended against a
					// cursor-accumulation bug by reserving a `ttc`-sized dead zone at the
					// right edge; round 1 fixed cursor accumulation directly, leaving the
					// dead zone as defense-in-depth. The future-time guard at storage step
					// 14 (per CLAUDE.md "Execution Order") drops any event with `time >
					// FIXED_NOW`, so spillover from late funnel steps is filtered there
					// instead of by anchoring upstream. Removing the dead zone eliminated
					// the last-day cliff for funnel-heavy dungeons WITHOUT re-introducing
					// `futureEvents > 0` — verified across the 194-combo engine-validation
					// sweep (`scripts/sweep-engine.mjs`, `plans/ENGINE-VALIDATION/FIX.md`).
					//
					// Trade-off retained: long-ttc funnels still lose some late steps to
					// `_drop`. Budget loop iterates more to compensate. Catch-all funnel
					// (`ttc=1d`, set in config-validator) is unaffected.
					//
					// Born-late edge case: when `funnelCursor > FN`, the `safeLatest >
					// funnelCursor` check below falls back to `FN` so the user can emit.
					const FUNNEL_DEAD_ZONE_CAP_SEC = 0;
					const deadZoneSec = Math.min(ttcSec, FUNNEL_DEAD_ZONE_CAP_SEC);
					const safeLatest = context.FIXED_NOW - deadZoneSec;
					const funnelLatestTime = dayBounds
						? dayBounds.latest
						: (safeLatest > funnelCursor ? safeLatest : context.FIXED_NOW);
					const funnelEventFeatureCtx = { ...featureCtx, latestTime: funnelLatestTime };
					const [data, converted] = await makeFunnel(context, currentFunnel, user, funnelCursor, profile, userSCD, persona, funnelEventFeatureCtx, usageAttemptMeta);
					// Budget counts raw output (matches pre-fix semantics). For short-ttc
					// funnels (≤1d), almost no events `_drop` so the loop terminates at the
					// expected count. For long-ttc funnels (>1d), some late steps `_drop` —
					// loop iterates more to compensate, world-event `_drop`s still reduce
					// the user's surviving total since they fire on dropped events too.
					numEventsPreformed += data.length;
					newEvents = data;
				} else {
					// Active-day mode: standalone event uses picked-day start as earliestTime
					// + day-end as latestTime (passed via eventFeatureCtx).
					// `isFirstEvent: false` (8th arg) so TimeSoup distributes the timestamp
					// — passing `true` here would pin every standalone event to the same
					// `earliestTime`, which the now-deleted bunchIntoSessions used to paper
					// over. With bunchIntoSessions removed, TimeSoup is the time source.
					const standaloneEarliest = dayBounds ? dayBounds.earliest : userFirstEventTime;
					// v1.5.1: pass `config.superProps` so standalone events get super-property
					// stamping. Pre-1.5.1, standalone events received `{}` here, but the
					// validator's auto-funnel (catch-all) consumed all non-strict events so
					// the bug was invisible. The TODO #10 `useFunnel` gate redirects some
					// budget-boundary iterations to standalone, exposing the gap.
					const data = await makeEvent(context, distinct_id, standaloneEarliest, u.pick(weightedEvents), user.anonymousIds, config.superProps || {}, config.groupKeys, false, false, standaloneFeatureCtx, standaloneIdentityCtx);
					numEventsPreformed++;
					newEvents = [data];
				}
				usersEvents = usersEvents.concat(newEvents);

				// Check for churn events — if user churned, they may stop generating
				if (churnEvents.size > 0) {
					const eventsToCheck = Array.isArray(newEvents[0]) ? newEvents.flat() : newEvents;
					for (const ev of eventsToCheck) {
						if (ev.event && churnEvents.has(ev.event)) {
							const returnLikelihood = churnEvents.get(ev.event);
							const userReturns = returnLikelihood > 0 && chance.bool({ likelihood: returnLikelihood * 100 });
							if (!userReturns) {
								userChurned = true;
								break;
							}
						}
					}
					if (userChurned) break;
				}
			}

			// Remove events flagged as future timestamps (before dungeon hooks see them)
			usersEvents = usersEvents.filter(e => !e._drop);

			// Feature 3: Engagement decay — filter behavioral events
			const userDecay = persona?.engagementDecay || globalEngagementDecay;
			if (userDecay && userDecay.model !== 'none' && usersEvents.length > 0) {
				// adjustedCreated and event times now share the same dataset window — no shift.
				usersEvents = applyEngagementDecay(usersEvents, userDecay, adjustedCreated, context, chance, pickedDayBuckets);
			}

			// Feature 4: Data quality — duplicates and late-arriving
			if (dataQuality) {
				if (dataQuality.duplicateRate > 0) {
					const dupes = [];
					for (const ev of usersEvents) {
						if (chance.bool({ likelihood: dataQuality.duplicateRate * 100 })) {
							const dupe = { ...ev };
							dupe.time = dayjs(ev.time).add(chance.integer({ min: 1, max: 60 }), 'seconds').toISOString();
							dupe.insert_id = randomUUID();
							dupes.push(dupe);
						}
					}
					usersEvents = usersEvents.concat(dupes);
				}
				if (dataQuality.lateArrivingRate > 0) {
					for (const ev of usersEvents) {
						if (chance.bool({ likelihood: dataQuality.lateArrivingRate * 100 })) {
							ev.time = dayjs(ev.time).subtract(chance.integer({ min: 1, max: 7 }), 'days').toISOString();
						}
					}
				}
			}

			// Session clustering: assign session IDs based on natural temporal gaps.
			// v1.5: bunchIntoSessions deleted — was a redundant wholesale time-overwrite
			// that scrambled multi-step funnels (round-robin into anchor buckets) and
			// clobbered v1.5 active-day picking. assignSessionIds operates on the original
			// TimeSoup-driven timestamps (Mixpanel-aligned 30-min-gap rule).
			if (hasSessionIds && usersEvents.length > 0) {
				// assignSessionIds requires events sorted ascending by time.
				usersEvents.sort((a, b) => {
					const ta = typeof a.time === 'string' ? Date.parse(a.time) : Number(a.time);
					const tb = typeof b.time === 'string' ? Date.parse(b.time) : Number(b.time);
					return ta - tb;
				});
				u.assignSessionIds(usersEvents, sessionTimeout);

				// Phase 2: per-session sticky device. After session_ids exist, deterministically
				// pick one device per session from the user's pool and overwrite each event's
				// device_id so all events in that session share a device. Skip when there's no
				// pool (avgDevicePerUser=0) or only one device (no choice to make).
				if (userDevicePool && userDevicePool.length > 1) {
					const sessionToDevice = new Map();
					for (const ev of usersEvents) {
						if (!ev || !ev.device_id || !ev.session_id) continue;
						let dev = sessionToDevice.get(ev.session_id);
						if (!dev) {
							dev = userDevicePool[Number(u.quickHash(`${distinct_id}:${ev.session_id}`)) % userDevicePool.length];
							sessionToDevice.set(ev.session_id, dev);
						}
						ev.device_id = dev;
					}
				}
			}

			// v1.5: Touchpoint cap. Sample up to `maxTouchpointsPerUser` (default 10,
			// matching Mixpanel `TOUCHPOINTS_LIMIT`) eligible events from the user's
			// lifetime and stamp UTMs on the sample. Lifetime-distributed sampling
			// preserves realistic touch shape — last-10-window attribution then
			// gives meaningful first/last-touch results.
			if (config.hasCampaigns && usersEvents.length > 0) {
				applyTouchpointCap(usersEvents, config, defaults, chance);
			}

			// v1.5.1: anonymous non-converters never call $identify in production,
			// so Mixpanel never creates a profile for them. Stamp `_drop: true` so
			// mixpanel-sender skips the /engage push. Stamped BEFORE the everything
			// hook fires so hooks can rescue a profile by deleting the flag.
			if (userIsBornInDataset && !userAuthed) {
				profile._drop = true;
			}

			// Hook for processing all user events (hooks override everything)
			if (config.hook) {
				// `meta.isPreAuth(event)` predicate bound to this user's auth state.
				// - Pre-existing user: authed throughout; never pre-auth.
				// - Born-in-dataset, never converted (userAuthTimeMs===null): all pre-auth.
				// - Born-in-dataset, converted: pre-auth strictly before the stitch event.
				const userAuthTimeMsLocal = userAuthTimeMs;
				const userIsBornLocal = userIsBornInDataset;
				const isPreAuth = (event) => {
					if (!event || !event.time) return false;
					if (userAuthTimeMsLocal === null) return userIsBornLocal;
					const t = typeof event.time === 'string' ? Date.parse(event.time) : Number(event.time);
					return Number.isFinite(t) ? t < userAuthTimeMsLocal : false;
				};
				const newEvents = await config.hook(usersEvents, "everything", {
					profile,
					scd: userSCD,
					config,
					userIsBornInDataset,
					persona,
					datasetStart: context.DATASET_START_SECONDS,
					datasetEnd: context.DATASET_END_SECONDS,
					authTime: userAuthTimeMs,
					isPreAuth,
				});
				if (Array.isArray(newEvents)) usersEvents = newEvents;
			}

			// v1.5: auto-sort by time after everything hook. Defends against the
			// most common new footgun — hooks that push() cloned events with
			// arbitrary timestamps and break the greedy funnel engine's
			// chronological-order requirement. Opt out with `autoSortAfterEverything: false`.
			if (config.autoSortAfterEverything !== false && usersEvents.length > 1) {
				usersEvents.sort((a, b) => {
					const ta = (a && typeof a.time === 'string') ? Date.parse(a.time) : Number(a && a.time);
					const tb = (b && typeof b.time === 'string') ? Date.parse(b.time) : Number(b && b.time);
					if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
					if (!Number.isFinite(ta)) return 1;
					if (!Number.isFinite(tb)) return -1;
					return ta - tb;
				});
			}

			// Defensive guard: drop any events whose timestamp landed past the
			// configured dataset end. Hooks that duplicate events with time offsets
			// (weekend surges, viral spreads) can leak a few past the boundary.
			// v1.5 follow-up (`reccomendations-agent-1.md` Fix #2): surface the drop
			// in verbose mode. Silent dropping made determinism failures hard to debug
			// — events vanished without trace. Per-user log helps the owner see which
			// users + how many events were affected.
			const beforeFutureFilter = usersEvents.length;
			usersEvents = usersEvents.filter(e => {
				if (!e || !e.time) return true;
				const t = typeof e.time === 'string' ? Date.parse(e.time) / 1000 : Number(e.time);
				return Number.isFinite(t) ? t <= context.FIXED_NOW : true;
			});
			const droppedFuture = beforeFutureFilter - usersEvents.length;
			if (droppedFuture > 0 && config.verbose) {
				console.warn(`⚠️  Dropped ${droppedFuture} future-dated event(s) for user ${distinct_id}`);
			}

			// Store all user data (skip profile push when a hook returned null
			// for type='user' — see dropUserProfile above).
			if (!dropUserProfile) {
				await userProfilesData.hookPush(profile);
			}

			if (Object.keys(userSCD).length) {
				for (const [key, changesArray] of Object.entries(userSCD)) {
					for (const changes of changesArray) {
						try {
							const target = scdTableData.filter(arr => arr.scdKey === key).pop();
							await target.hookPush(changes, { profile, type: 'user' });
						}
						catch (e) {
							// This is probably a test
							const target = scdTableData[0];
							await target.hookPush(changes, { profile, type: 'user' });
						}
					}
				}
			}

			await eventData.hookPush(usersEvents, { profile });
		});

		userPromises.push(userPromise);

		// v1.5.1: V8's Promise.all has a hard ceiling (~65K elements). Sharded
		// kodiak runs pass numUsers in the millions per chunk, which blows that
		// limit. Drain the in-flight buffer in batches of 50K to keep Promise.all
		// well under the cap. With p-limit honoring `concurrency`, this is purely
		// a backpressure boundary — no behavior change for existing dungeons that
		// have numUsers under 50K.
		if (userPromises.length >= 50_000) {
			await Promise.all(userPromises);
			userPromises.length = 0;
		}
	}

	// Drain whatever's left in the final partial batch.
	if (userPromises.length > 0) {
		await Promise.all(userPromises);
		userPromises.length = 0;
	}

	// Feature 4: Generate bot users (after regular users)
	if (dataQuality && dataQuality.botUsers > 0) {
		await generateBotUsers(context, dataQuality, storage);
	}
	} finally {
		// Always remove the SIGINT listener — even if userLoop throws or is
		// cancelled. Pre-fix this leaked across test runs and stalled workers.
		process.removeListener('SIGINT', onSigint);
	}
}


export function weighFunnels(acc, funnel) {
	const weight = funnel?.weight || 1;
	for (let i = 0; i < weight; i++) {
		acc.push(funnel);
	}
	return acc;
}

export function matchConditions(profile, conditions) {
	for (const [key, value] of Object.entries(conditions)) {
		if (profile[key] !== value) return false;
	}
	return true;
}

// ── v1.5 Active-Day Plan Helpers ──

/**
 * Build a deterministic per-user "day plan" for active-day mode.
 *
 * Each element of `plan` names the day on which the event-i should land. Events
 * naturally concentrate onto `targetActiveDays` distinct days (drawn from a normal
 * around `avgActiveDaysPerUser`, clamped to `[1, userActiveDays]`).
 *
 * Day picking uses weighted-without-replacement against soup DOW weights so the
 * cohort-level weekly rhythm is preserved. Event distribution across picked days
 * is proportional to those same weights, with a floor of 1 event per picked day.
 *
 * **Return shape (v1.5 follow-up — `reccomendations-agent-1.md` Fix #1):**
 *   `{ plan, pickedDayBuckets }` — `plan` is the shuffled per-event day-start
 *   unix-seconds array; `pickedDayBuckets` is a `Set<number>` of UTC-day-index
 *   buckets (`Math.floor(timestamp_ms / 86400000)`). Downstream consumers like
 *   `applyEngagementDecay` use `pickedDayBuckets` to enforce the v1.5
 *   distinct-day contract — see Fix #1 below.
 *
 * @param {Object} args
 * @param {import('dayjs').Dayjs} args.adjustedCreated - User's "created" timestamp
 * @param {number} args.fixedBegin - Dataset start (unix seconds)
 * @param {number} args.fixedNow - Dataset end (unix seconds)
 * @param {number} args.avgActiveDaysPerUser
 * @param {number} args.userActiveDays - Capacity (max possible distinct days)
 * @param {number} args.numEvents - Total events to schedule for this user
 * @param {number[]} [args.dowWeights] - 7-element soup DOW weights (Sun..Sat)
 * @param {Object} args.chance - Seeded chance instance
 * @returns {{ plan: number[], pickedDayBuckets: Set<number> } | null} Day plan
 *   + bucket set, or null if not applicable (no candidate days, no events, etc.).
 */
function buildActiveDayPlan({ adjustedCreated, fixedBegin, fixedNow, avgActiveDaysPerUser, userActiveDays, numEvents, dowWeights, chance }) {
	if (!Number.isFinite(numEvents) || numEvents <= 0) return null;

	// Candidate day buckets: UTC days intersecting [max(adjustedCreated, FIXED_BEGIN), FIXED_NOW].
	// Pre-existing users with 'uniform' preExistingSpread have adjustedCreated < FIXED_BEGIN;
	// active-day mode constrains them to in-window days only (matches what Mixpanel sees).
	const userStartUnix = Math.max(
		Math.floor(adjustedCreated.unix()),
		Math.floor(fixedBegin)
	);
	const userEndUnix = Math.floor(fixedNow);
	if (userEndUnix < userStartUnix) return null;

	const dayMs = 86400;
	const firstDay = Math.floor(userStartUnix / dayMs);
	const lastDay = Math.floor(userEndUnix / dayMs);
	const candidateDays = [];
	for (let d = firstDay; d <= lastDay; d++) {
		candidateDays.push(d * dayMs);
	}
	if (!candidateDays.length) return null;

	// Weight by soup DOW (Sun=0..Sat=6). Default uniform if no weights configured.
	const weights = candidateDays.map(daySec => {
		if (!Array.isArray(dowWeights) || dowWeights.length !== 7) return 1;
		const dow = new Date(daySec * 1000).getUTCDay();
		const w = Number(dowWeights[dow]);
		return Number.isFinite(w) && w > 0 ? w : 0.0001;
	});

	// Draw target active-day count: normal(mean, sd=mean/3), clamped.
	const meanActive = Math.max(1, Math.min(avgActiveDaysPerUser, candidateDays.length));
	const sd = Math.max(0.5, meanActive / 3);
	let targetActiveDays = Math.round(chance.normal({ mean: meanActive, dev: sd }));
	targetActiveDays = Math.max(1, Math.min(targetActiveDays, candidateDays.length));

	// Pick which days are active.
	const pickedDays = weightedSampleNoReplacement(candidateDays, weights, targetActiveDays, chance);
	if (!pickedDays.length) return null;
	pickedDays.sort((a, b) => a - b);

	// Recompute weights aligned to picked days for event distribution.
	const pickedWeights = pickedDays.map(daySec => {
		if (!Array.isArray(dowWeights) || dowWeights.length !== 7) return 1;
		const dow = new Date(daySec * 1000).getUTCDay();
		const w = Number(dowWeights[dow]);
		return Number.isFinite(w) && w > 0 ? w : 0.0001;
	});
	const totalWeight = pickedWeights.reduce((s, x) => s + x, 0);

	// Allocate event counts across picked days. Each picked day gets at least 1
	// event so every day is "used" — distinct-day count actually hits target.
	const k = pickedDays.length;
	let allocations;
	if (numEvents <= k) {
		// Fewer events than picked days: distribute one each, sample which days get them.
		const subPicks = weightedSampleNoReplacement(pickedDays, pickedWeights, numEvents, chance);
		const subSet = new Set(subPicks);
		allocations = pickedDays.map(d => subSet.has(d) ? 1 : 0);
	} else {
		// Floor 1 per picked day, distribute remainder proportionally.
		const remainder = numEvents - k;
		allocations = pickedWeights.map(w => Math.floor((remainder * w) / totalWeight));
		// Add floor of 1 to each
		for (let i = 0; i < k; i++) allocations[i] += 1;
		// Distribute rounding remainder by descending weight order
		let assigned = allocations.reduce((s, x) => s + x, 0);
		let rem = numEvents - assigned;
		const order = pickedDays.map((_, i) => i).sort((a, b) => pickedWeights[b] - pickedWeights[a]);
		for (let i = 0; i < rem; i++) {
			allocations[order[i % order.length]]++;
		}
	}

	// Expand into a flat plan and shuffle deterministically.
	const plan = [];
	for (let i = 0; i < k; i++) {
		for (let j = 0; j < allocations[i]; j++) {
			plan.push(pickedDays[i]);
		}
	}
	// v1.5 follow-up (Fix #1): expose the picked-day bucket set so engagement
	// decay can protect the last surviving event per picked day. Buckets use
	// the same `floor(ms / 86400000)` formula that decay applies to event times.
	const pickedDayBuckets = new Set(pickedDays.map(daySec => Math.floor(daySec / 86400)));
	// chance.shuffle uses seeded RNG → deterministic.
	return { plan: chance.shuffle(plan), pickedDayBuckets };
}

/**
 * v1.5 Touchpoint cap: sample up to `maxTouchpointsPerUser` eligible events from
 * the user's stream and stamp UTMs on the sample. Mirrors Mixpanel's
 * `TOUCHPOINTS_LIMIT = 10` (`backend/libquery/properties_over_time/attributed_value_reader.cpp`).
 *
 * Eligibility:
 *   - If any event in `config.events[]` has `isAttributionEvent: true`: candidate
 *     pool = events whose name carries that flag.
 *   - Else (legacy fallback): candidate pool = ALL events in the user's stream.
 *
 * Sampling:
 *   - If `eligible.length <= cap`: stamp all of them.
 *   - Else: uniform random sample of size `cap` (seeded `chance.pickset`,
 *     deterministic). Sort sample chronologically before stamping so UTMs land
 *     in time order.
 *
 * Mutates `events` in place.
 *
 * @param {Object[]} events - User's events (flat shape with .event, .time)
 * @param {Object} config - Validated dungeon config
 * @param {Object} defaults - Context.defaults (provides campaigns())
 * @param {Object} chance - Seeded chance instance
 */
function applyTouchpointCap(events, config, defaults, chance) {
	const cap = Number.isFinite(config.maxTouchpointsPerUser)
		? config.maxTouchpointsPerUser
		: 10;
	if (cap <= 0) return;

	// Build event-name → config map for isAttributionEvent lookup.
	const eventCfgByName = new Map();
	for (const e of (config.events || [])) {
		if (e && e.event) eventCfgByName.set(e.event, e);
	}

	// Determine eligible events.
	let eligible;
	if (config.hasAttributionFlags) {
		eligible = events.filter(e => {
			if (!e || !e.event) return false;
			const cfg = eventCfgByName.get(e.event);
			return cfg && cfg.isAttributionEvent === true;
		});
	} else {
		eligible = events.slice();
	}
	if (eligible.length === 0) return;

	// Sample up to cap (uniform random without replacement, seeded).
	let sample;
	if (eligible.length <= cap) {
		sample = eligible;
	} else {
		sample = chance.pickset(eligible, cap);
	}

	// Sort sample chronologically so UTMs land in time order.
	sample.sort((a, b) => {
		const ta = typeof a.time === 'string' ? Date.parse(a.time) : Number(a.time);
		const tb = typeof b.time === 'string' ? Date.parse(b.time) : Number(b.time);
		return ta - tb;
	});

	// Stamp UTMs on each sampled event using a campaign template.
	for (const ev of sample) {
		const campaignTemplate = u.pickRandom(defaults.campaigns());
		if (!campaignTemplate || typeof campaignTemplate !== 'object') continue;
		for (const [k, v] of Object.entries(campaignTemplate)) {
			ev[k] = u.choose(v);
		}
	}
}

/**
 * Weighted-without-replacement sampler. Samples `count` items from `items` without
 * replacement, with selection probability proportional to `weights`.
 *
 * @param {*[]} items
 * @param {number[]} weights
 * @param {number} count
 * @param {Object} chance - Seeded chance instance
 * @returns {*[]}
 */
function weightedSampleNoReplacement(items, weights, count, chance) {
	if (count >= items.length) return items.slice();
	const pool = items.slice();
	const w = weights.slice();
	const result = [];
	for (let i = 0; i < count; i++) {
		const total = w.reduce((s, x) => s + x, 0);
		let chosen;
		if (total <= 0) {
			chosen = chance.integer({ min: 0, max: pool.length - 1 });
		} else {
			let roll = chance.floating({ min: 0, max: total });
			chosen = 0;
			for (let j = 0; j < w.length; j++) {
				roll -= w[j];
				if (roll <= 0) { chosen = j; break; }
			}
		}
		result.push(pool[chosen]);
		pool.splice(chosen, 1);
		w.splice(chosen, 1);
	}
	return result;
}

// ── Advanced Feature Helper Functions ──

/**
 * Feature 3: Apply engagement decay to a user's events.
 *
 * Filters events probabilistically per the configured decay model
 * (`exponential` / `linear` / `step`). Late events drop more often.
 *
 * **v1.5 follow-up (`reccomendations-agent-1.md` Fix #1):** when
 * `pickedDayBuckets` is provided (active-day mode), the filter NEVER drops the
 * last surviving event on any picked day. Without this, decay can silently
 * undershoot the configured `avgActiveDaysPerUser` by killing all events on
 * sparse late days (e.g., exponential decay with short half-life). The protect-
 * last-event logic preserves the v1.5 distinct-day contract.
 *
 * @param {Object[]} events - User's events (mutated by filter; new array returned)
 * @param {Object} decay - `engagementDecay` config (model/halfLife/floor/etc.)
 * @param {*} userCreated - dayjs object or ISO string of user's creation time
 * @param {Object} context - Engine context (unused; kept for future use)
 * @param {Object} chance - Seeded chance instance
 * @param {Set<number> | null} [pickedDayBuckets=null] - From `buildActiveDayPlan`.
 *   Each bucket = `Math.floor(timestamp_ms / 86400000)`. When non-null, the
 *   filter protects the last surviving event on each bucket.
 * @returns {Object[]} Filtered events array
 */
function applyEngagementDecay(events, decay, userCreated, context, chance, pickedDayBuckets = null) {
	if (!events.length) return events;
	// Perf 2: Use Date.parse instead of dayjs for hot loop
	const userStartUnix = new Date(userCreated.toISOString ? userCreated.toISOString() : userCreated).getTime() / 1000;
	const halfLifeDays = decay.halfLife || 45;
	const floor = decay.floor ?? 0.1;
	const reactivationChance = decay.reactivationChance || 0;
	const reactivationMult = decay.reactivationMultiplier || 2.0;

	// v1.5 Fix #1: pre-compute per-bucket counts so we can enforce "at least one
	// event survives on each picked day". Only counts events that fall within a
	// picked-day bucket (events spilled to other days don't count toward the
	// per-bucket survivor budget).
	const dayMs = 86400000;
	const dayCounts = new Map(); // bucket → remaining (mutable) event count
	if (pickedDayBuckets && pickedDayBuckets.size) {
		for (const ev of events) {
			const t = new Date(ev.time).getTime();
			if (!Number.isFinite(t)) continue;
			const bucket = Math.floor(t / dayMs);
			if (pickedDayBuckets.has(bucket)) {
				dayCounts.set(bucket, (dayCounts.get(bucket) || 0) + 1);
			}
		}
	}

	return events.filter(ev => {
		const evUnix = new Date(ev.time).getTime() / 1000;
		const daysSinceBirth = Math.max(0, (evUnix - userStartUnix) / 86400);

		let retention;
		switch (decay.model) {
			case 'exponential':
				retention = Math.max(floor, Math.pow(0.5, daysSinceBirth / halfLifeDays));
				break;
			case 'linear':
				retention = Math.max(floor, 1 - (daysSinceBirth / (halfLifeDays * 2)));
				break;
			case 'step':
				retention = daysSinceBirth < halfLifeDays ? 1.0 : floor;
				break;
			default:
				return true;
		}

		// Reactivation chance can spike retention back up
		if (reactivationChance > 0 && retention < 0.5 && chance.bool({ likelihood: reactivationChance * 100 })) {
			retention = Math.min(1.0, retention * reactivationMult);
		}

		const keep = chance.bool({ likelihood: retention * 100 });

		// v1.5 Fix #1: protect the last surviving event on each picked day.
		// Determinism preserved: no extra RNG calls, just a count check.
		if (pickedDayBuckets && pickedDayBuckets.size) {
			const bucket = Math.floor(new Date(ev.time).getTime() / dayMs);
			if (pickedDayBuckets.has(bucket)) {
				const remaining = dayCounts.get(bucket) || 0;
				if (!keep) {
					if (remaining <= 1) {
						// Last event on this picked day — protect it. Leave dayCounts
						// at 1 so subsequent events on this bucket can still drop.
						return true;
					}
					dayCounts.set(bucket, remaining - 1);
				}
				// If keep===true, no decrement — the survivor still counts.
			}
		}

		return keep;
	});
}

/**
 * Feature 4: Generate bot users with repetitive patterns
 */
async function generateBotUsers(context, dataQuality, storage) {
	const { botUsers, botEventsPerUser } = dataQuality;
	const chance = u.getChance();
	const { config } = context;
	const events = config.events || [{ event: 'page_view' }];
	// Bots use only 1-2 event types repetitively
	const botEventTypes = events.slice(0, Math.min(2, events.length));

	for (let b = 0; b < botUsers; b++) {
		const botId = `bot_${chance.guid().slice(0, 8)}`;
		const botEvents = [];

		// Bots generate events at machine-like intervals across the dataset window
		let currentTime = context.FIXED_BEGIN;
		const interval = Math.floor(((context.FIXED_NOW - currentTime) / botEventsPerUser));

		for (let e = 0; e < botEventsPerUser; e++) {
			const chosenEvent = botEventTypes[e % botEventTypes.length];
			currentTime += interval + chance.integer({ min: 0, max: 10 });
			if (currentTime > context.FIXED_NOW) break;
			botEvents.push({
				event: chosenEvent.event,
				time: dayjs.unix(currentTime).toISOString(),
				user_id: botId,
				device_id: botId,
				insert_id: u.quickHash(`${chosenEvent.event}-${currentTime}-${botId}`),
				is_bot: true
			});
		}

		// Store bot profile
		await storage.userProfilesData.hookPush({
			distinct_id: botId,
			name: `Bot ${b + 1}`,
			is_bot: true
		});

		// Store bot events
		await storage.eventData.hookPush(botEvents, { profile: { distinct_id: botId, is_bot: true } });
	}
}
