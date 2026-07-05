// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat, applyLifecycleWave } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       BingeBox
 * APP:        Netflix-style video streaming service: browse/search discovery,
 *             a watchlist, trailers, push-notification re-engagement, and one
 *             value moment — "content played".
 * SCALE:      10,000 users, ~2.8M events, 151 days (2026-01-01 → 2026-05-31)
 * CORE LOOP:  signup → browse → content played → (watchlist, rate, return)
 *
 * PURPOSE:    v1.6 LIFECYCLE SHOWCASE. This dungeon exists to demonstrate the
 *             `applyLifecycleWave` atom and the lifecycle/uniques emulator
 *             families — engineered New/Retained/Resurrected/Dormant waves at
 *             BOTH template periods (7d and 30d), plus a resurrection
 *             campaign attributable to a push_open burst. Everything else is
 *             deliberately plain: no SCDs, no campaigns, no group keys.
 *
 * EVENTS (9):
 *   content played (30) > browse (15) > search (8) > trailer viewed (6)
 *   > watchlist add (5) > push_open (4) > rating submitted (3)
 *   > plan upgraded (1) > signup (1)
 *
 * FUNNELS (4):
 *   - Onboarding:   signup → browse → content played (75%, isFirstFunnel)
 *   - Discovery:    search → trailer viewed → watchlist add (35%)
 *   - Watchlist:    watchlist add → content played (50%)
 *   - Re-engage:    push_open → browse → content played (45%)
 *
 * USER PROPS:  plan, household_size, primary_device, kids_profile
 * SUPER PROPS: plan, app_version
 *
 * IDENTITY:   avgDevicePerUser: 2; signup is isFirstEvent + isAuthEvent, so
 *             every event carries user_id and ~all carry device_id.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ENGINEERED PATTERNS (hooks) — 3 hooks, disjoint hashFloat cohorts
 * ═══════════════════════════════════════════════════════════════════
 *
 * Cohort gating uses disjoint hashFloat(uid) bands (NOT nested hashCohort
 * calls — hashCohort(id, 15) ⊂ hashCohort(id, 30), so two waves gated that
 * way would overlap and double-drop). All three waves apply only to
 * "early-born" users (first event within the first EARLY_BORN_DAYS days of
 * the dataset) so the birth-relative dormancy windows land on near-absolute
 * calendar days and the lifecycle tiles read as a coherent cohort wave
 * instead of a smear. Under the default flat macro ~88% of users are
 * pre-existing and their first in-dataset event lands within a few days of
 * datasetStart, so the early-born gate keeps most of each band.
 *
 * 1. WEEKLY LIFECYCLE WAVE (everything) — hashFloat band [0.00, 0.25)
 * PATTERN: applyLifecycleWave drops every "content played" in the window
 * [birth+42d, birth+63d] (21 days = 3 whole 7d periods) and appends a
 * 4-clone resurrection burst 1-3h after the window. Browse/search/watchlist
 * events survive the window — the user still visits, but stops hitting the
 * value moment. That is exactly the state the Lifecycle template calls
 * dormant (value-moment count EqualTo 0 in the period). The window starts
 * 3 weeks after H2's so each wave owns its own 7d tiles: H2's dormant
 * onset lands ~Jan 25, H1's ~Feb 22, H1's resurrection ~Mar 8, H2's ~Apr 1.
 *   Discovery: Lifecycle (7d period) on "content played" — a dormant hump
 *   ~6 weeks in, then a resurrected spike 3 weeks later.
 *
 *   Report 1: Lifecycle, value moment "content played", 7-day period
 *   - Measure: dormant count peak across periods; resurrected count peak;
 *     retained count dip while the wave cohort is dark
 *   - Expected (2K reduced run, hooked | organic): dormant peak / quiet
 *     median 1.81 | 0.93; resurrected spike / quiet median 2.38 | 0.99;
 *     retained dip / quiet median 0.58 | 1.01.
 *
 * 2. MONTHLY LIFECYCLE WAVE (everything) — hashFloat band [0.25, 0.40)
 * PATTERN: same atom, sized for the 30d template variant: window
 * [birth+21d, birth+86d] (65 days ≥ 2 whole 30d periods), 5-clone burst.
 * A 21-day gap would be invisible at the 30d period — the wave must span
 * two whole tiles for the EqualTo-0 dormancy test to fire at this
 * granularity; that's the "gap discipline" rule from HOOKS.md §2.16.
 *   Discovery: Lifecycle (30d period) on "content played" — dormant in the
 *   middle tiles, resurrected in the tile after the gap.
 *
 *   Report 1: Lifecycle, value moment "content played", 30-day period
 *   - Measure: dormant count peak; resurrected count in the post-gap tile
 *   - Expected (2K, hooked | organic): dormant tile 305 vs 27 max
 *     elsewhere (ratio 11.3) | 12 vs 17 (0.71); resurrected tile 299 vs
 *     28 max elsewhere (10.7) | 12 vs 8 (1.5 on noise-level counts).
 *
 * 3. RESURRECTION CAMPAIGN (everything) — hashFloat band [0.40, 0.52)
 * PATTERN: applyLifecycleWave with dropAll: true erases the ENTIRE stream
 * in [birth+100d, birth+130d] — a true 30-day disappearance, not just
 * value-moment abstinence — then the standard burst brings the user back.
 * After the wave, the hook clones the user's own "push_open" 2-3 times
 * 15-45 minutes BEFORE the first post-gap "content played", making the
 * resurrection attributable: the push burst precedes the return. Users with
 * no push_open anywhere in their stream get no clones (schema-first: never
 * fabricate) — the campaign story's cohort is "resurrected AND pushed",
 * measured as a share.
 *   Discovery: Lifecycle resurrected spike + per-user event-sequence audit:
 *   returners' first post-gap play is preceded by push_open within 24h.
 *
 *   Report 1: Funnels / sequence audit "push_open → content played"
 *   - Measure: share of long-gap (≥25d) returners whose first post-gap play
 *     has a push_open in the preceding 24h; long-gap population size
 *   - Expected (2K, hooked | organic): 195 gap users, 195 returners, 190
 *     pushed (share 0.974) | 8 gap users, 6 returners, 3 pushed. The 7d
 *     lifecycle also shows the return: resurrected spike / quiet median
 *     1.76 | 0.95 in the May tiles.
 *
 * COMBINED EFFECT — WAU DOUBLE TROUGH: H1's and H2's dormancy windows
 * overlap on absolute days ~42-63 (H2 spans 21-86, H1 spans 42-63), so WAU
 * (uniques on "content played", 7-day rolling window) carves a deep
 * mid-dataset trough, partially recovers as H1's burst lands, fully
 * recovers after H2's, then dips again (smaller) for H3's total gap on
 * days ~100-130 before the final recovery. The streaming-h4 story reads
 * both trough/baseline ratios and the tail recovery.
 *   - Expected (2K, hooked | organic): trough1 (days 49-63 vs days 7-20
 *     baseline) 0.586 | 0.997; trough2 (days 107-137 vs local pre-dip
 *     days 93-99) 0.886 | 1.002; tail recovery vs baseline 1.09 | 1.09.
 *
 * NOTE: engine shape guarantees apply to no-hook configs; these hooks
 * intentionally carve mid-dataset activity troughs (~52% of users go
 * value-moment-dormant for 3-9 weeks). That is the point of the dungeon.
 */

// ── SCALE ──
const SEED = "harness-streaming";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-31T23:59:59Z";
const EVENTS_PER_DAY = 2.0;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
// Disjoint hashFloat(uid) cohort bands — see OVERVIEW for why not hashCohort.
const WAVE7_BAND = [0.00, 0.25];   // H1: weekly-period wave, ~25% of users
const WAVE30_BAND = [0.25, 0.40];  // H2: monthly-period wave, ~15%
const CAMPAIGN_BAND = [0.40, 0.52]; // H3: dropAll + push-attributed return, ~12%

// Waves only apply to users born in the first N dataset days, pinning the
// birth-relative windows to near-absolute calendar days.
const EARLY_BORN_DAYS = 10;

const WAVE7_FROM_DAY = 42;   // window [birth+42d, birth+63d]
const WAVE7_DAYS = 21;       // 3 whole 7d periods (gap discipline)
const WAVE7_BURST = 4;

const WAVE30_FROM_DAY = 21;  // window [birth+21d, birth+86d]
const WAVE30_DAYS = 65;      // ≥ 2 whole 30d periods
const WAVE30_BURST = 5;

const CAMPAIGN_FROM_DAY = 100; // window [birth+100d, birth+130d], dropAll
const CAMPAIGN_DAYS = 30;
const CAMPAIGN_BURST = 4;
const CAMPAIGN_PUSH_CLONES_MIN = 2;
const CAMPAIGN_PUSH_CLONES_MAX = 3;
const CAMPAIGN_PUSH_LEAD_MIN_MIN = 15; // push lands 15-45 min before the return play
const CAMPAIGN_PUSH_LEAD_MAX_MIN = 45;

const VALUE_MOMENT = "content played";

const inBand = (x, [lo, hi]) => x >= lo && x < hi;

// ── HOOK ──
function hook(record, type, meta) {
	if (type === "everything") {
		const userEvents = record;
		if (!Array.isArray(userEvents) || userEvents.length === 0) return record;
		const uid = meta?.user?.distinct_id || userEvents.find(e => e?.user_id)?.user_id;
		if (!uid) return record;

		// Early-born gate: first event within EARLY_BORN_DAYS of datasetStart.
		// meta.datasetStart is a unix timestamp (seconds), dataset times are UTC.
		const datasetStart = dayjs.unix(meta.datasetStart).utc();
		let firstMs = Infinity;
		for (const e of userEvents) {
			const t = dayjs.utc(e?.time).valueOf();
			if (Number.isFinite(t) && t < firstMs) firstMs = t;
		}
		if (!Number.isFinite(firstMs)) return record;
		const bornDay = dayjs.utc(firstMs).diff(datasetStart, "day");
		if (bornDay >= EARLY_BORN_DAYS) return record;

		const h = hashFloat(uid);

		// H1: WEEKLY LIFECYCLE WAVE — 21-day value-moment gap + burst.
		if (inBand(h, WAVE7_BAND)) {
			return applyLifecycleWave(userEvents, uid, {
				dormantFromDay: WAVE7_FROM_DAY,
				dormantDays: WAVE7_DAYS,
				resurrectBurst: WAVE7_BURST,
				valueMomentEvent: VALUE_MOMENT,
			});
		}

		// H2: MONTHLY LIFECYCLE WAVE — 65-day gap spans two whole 30d tiles.
		if (inBand(h, WAVE30_BAND)) {
			return applyLifecycleWave(userEvents, uid, {
				dormantFromDay: WAVE30_FROM_DAY,
				dormantDays: WAVE30_DAYS,
				resurrectBurst: WAVE30_BURST,
				valueMomentEvent: VALUE_MOMENT,
			});
		}

		// H3: RESURRECTION CAMPAIGN — total 30-day disappearance (dropAll),
		// then the user's own push_open cloned just before the return play so
		// the resurrection is attributable to the push burst.
		if (inBand(h, CAMPAIGN_BAND)) {
			const shaped = applyLifecycleWave(userEvents, uid, {
				dormantFromDay: CAMPAIGN_FROM_DAY,
				dormantDays: CAMPAIGN_DAYS,
				resurrectBurst: CAMPAIGN_BURST,
				valueMomentEvent: VALUE_MOMENT,
				dropAll: true,
			});
			const windowEndMs = firstMs + (CAMPAIGN_FROM_DAY + CAMPAIGN_DAYS) * 86400000;
			let returnPlay = null;
			for (const e of shaped) {
				if (e?.event !== VALUE_MOMENT) continue;
				const t = dayjs.utc(e.time).valueOf();
				if (t > windowEndMs && (!returnPlay || t < dayjs.utc(returnPlay.time).valueOf())) {
					returnPlay = e;
				}
			}
			const pushTemplate = shaped.find(e => e?.event === "push_open");
			if (returnPlay && pushTemplate) {
				const returnMs = dayjs.utc(returnPlay.time).valueOf();
				const clones = chance.integer({ min: CAMPAIGN_PUSH_CLONES_MIN, max: CAMPAIGN_PUSH_CLONES_MAX });
				for (let i = 0; i < clones; i++) {
					const leadMin = chance.integer({ min: CAMPAIGN_PUSH_LEAD_MIN_MIN, max: CAMPAIGN_PUSH_LEAD_MAX_MIN });
					const clone = {
						...pushTemplate,
						time: dayjs.utc(returnMs - leadMin * 60000).toISOString(),
						user_id: pushTemplate.user_id || uid,
					};
					delete clone.insert_id;
					shaped.push(clone);
				}
			}
			return shaped;
		}

		return record;
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
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: false,
	},
	identity: {
		avgDevicePerUser: 2,
	},
	concurrency: 1,
	writeToDisk: false,

	funnels: [
		{
			sequence: ["signup", "browse", "content played"],
			isFirstFunnel: true,
			conversionRate: 75,
			timeToConvert: 1,
		},
		{
			sequence: ["search", "trailer viewed", "watchlist add"],
			conversionRate: 35,
			timeToConvert: 0.5,
			weight: 3,
		},
		{
			sequence: ["watchlist add", "content played"],
			conversionRate: 50,
			timeToConvert: 24,
			weight: 2,
		},
		{
			sequence: ["push_open", "browse", "content played"],
			conversionRate: 45,
			timeToConvert: 0.5,
			weight: 2,
		},
	],

	events: [
		{
			event: "signup",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: ["email", "google", "apple"],
				referral_source: ["organic", "friend", "promo", "app_store"],
			},
		},
		{
			event: "content played",
			weight: 30,
			properties: {
				content_type: ["movie", "series_episode", "series_episode", "documentary", "kids"],
				genre: ["drama", "comedy", "thriller", "sci-fi", "romance", "animation", "true-crime"],
				duration_watched_min: u.weighNumRange(1, 180, 0.3, 35),
				completion_pct: u.weighNumRange(1, 100, 0.2, 70),
				audio_language: ["en", "en", "en", "es", "fr", "de", "ja"],
				is_download: [false, false, false, false, true],
			},
		},
		{
			event: "browse",
			weight: 15,
			properties: {
				row_category: ["trending", "new_releases", "continue_watching", "recommended", "originals"],
				rows_scrolled: u.weighNumRange(1, 30, 0.3, 6),
			},
		},
		{
			event: "search",
			weight: 8,
			properties: {
				query_length: u.weighNumRange(2, 40, 0.3, 11),
				results_count: u.weighNumRange(0, 200, 0.3, 25),
			},
		},
		{
			event: "trailer viewed",
			weight: 6,
			properties: {
				content_type: ["movie", "series_episode", "documentary", "kids"],
				watched_full: [true, false, false],
			},
		},
		{
			event: "watchlist add",
			weight: 5,
			properties: {
				content_type: ["movie", "series_episode", "documentary", "kids"],
				list_size_after: u.weighNumRange(1, 120, 0.3, 12),
			},
		},
		{
			event: "push_open",
			weight: 4,
			properties: {
				campaign_type: ["new_season", "because_you_watched", "weekly_digest", "win_back"],
				time_to_open_min: u.weighNumRange(0, 720, 0.3, 20),
			},
		},
		{
			event: "rating submitted",
			weight: 3,
			properties: {
				rating: ["thumbs_up", "thumbs_up", "thumbs_up", "thumbs_down"],
				content_type: ["movie", "series_episode", "documentary", "kids"],
			},
		},
		{
			event: "plan upgraded",
			weight: 1,
			properties: {
				from_plan: ["basic", "standard"],
				to_plan: ["standard", "premium"],
				price_usd: [7.99, 12.99, 19.99],
			},
		},
	],

	superProps: {
		plan: ["basic", "standard", "standard", "premium"],
		app_version: ["6.1.0", "6.1.0", "6.2.0", "6.2.0", "6.2.1"],
	},

	userProps: {
		plan: ["basic", "standard", "standard", "premium"],
		household_size: u.weighNumRange(1, 6, 0.3, 2),
		primary_device: ["smart_tv", "smart_tv", "mobile", "tablet", "desktop"],
		kids_profile: [true, false, false, false],
	},

	hook,
};

export default config;

// ── STORIES ──
/*
 * Derivation notes (2K reduced run iter-streaming-1 vs organic
 * counterfactual iter-streaming-0, hook overridden to identity; full
 * fidelity = 10K users, expected populations ≈ 5x the 2K numbers; scale
 * guards at ~50% of that):
 *
 *  - Lifecycle tiles are read by INDEX, not date — generation shifts the
 *    dataset forward to the present, so period labels move but the
 *    151-day span (22 seven-day tiles, 6 thirty-day tiles, first tile
 *    partial) and every hook's tile position are fixed by construction.
 *    7d tile i≥1 covers dataset days [7i-3, 7i+3]; H2 dormant onset lands
 *    tiles 3-4, H1 onset tiles 6-8, H1 burst tiles 9-10, H2 burst tiles
 *    12-13, H3 gap tiles 15-18, H3 return tiles 19-20. "Quiet" tile sets
 *    below exclude every hook-touched tile AND tiles 0-2 (birth ramp).
 *  - h1: dormant peak max(d[6..8])=449 / quiet median 248.5 = 1.81
 *    (organic 0.93); resurrected spike max(z[9,10])=585 / quiet median
 *    246 = 2.38 (organic 0.99); retained dip min(r[7,8])=658 / quiet
 *    median 1136 = 0.58 (organic 1.01). Cohort: wave7 band ~303 uids at
 *    2K, ~87% early-born.
 *  - h2: 30d tiles [0..5]; gap covers exactly one whole tile (index 2):
 *    d[2]=305 vs max 27 elsewhere → 11.3 (organic 0.71 on counts ≤17);
 *    z[3]=299 vs max 28 elsewhere → 10.7 (organic 1.5 on counts ≤12).
 *  - h3: DuckDB LAG audit — users whose max inter-event gap ≥25d (only
 *    the dropAll band creates whole-stream gaps; H1/H2 keep browse/search
 *    running): 195 gap users, 195 return to the value moment, 190 have a
 *    push_open within the 24h before the first post-gap play → share
 *    0.974 (organic: 8 gap users, 6 returners, 3 pushed). 7d lifecycle
 *    echo: max(z[19,20])=433 / quiet median 246 = 1.76 (organic 0.95).
 *  - h4: WAU (uniques, rollingWindow 7) day-indexed; trough1
 *    min(v[49..63])/mean(v[7..20]) = 811/1384.7 = 0.586 (organic 0.997);
 *    trough2 min(v[107..137])/mean(v[93..99]) = 1265/1427.9 = 0.886
 *    (organic 1.002); recovery mean(v[-14..-2])/baseline = 1.091.
 *  - identity: uid_share 1.0, device_share 0.9993, devices/user 2.084
 *    (avgDevicePerUser: 2).
 */

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;

const bandVerdict = (x, nailed, strong, detail, inverse = () => false) => {
	if (x == null || Number.isNaN(Number(x))) return { verdict: "NONE", detail: `${detail} — metric missing` };
	const v = Number(x);
	if (inverse(v)) return { verdict: "INVERSE", detail };
	if (v >= nailed[0] && v <= nailed[1]) return { verdict: "NAILED", detail };
	if (v >= strong[0] && v <= strong[1]) return { verdict: "STRONG", detail };
	return { verdict: "WEAK", detail };
};

const guarded = (ok, detail, inner) => ok ? inner() : { verdict: "WEAK", detail: `${detail} — cohort below scale guard (expected at reduced scale)` };

const worstOf = (...verdicts) => {
	const order = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"];
	const worst = order.find(o => verdicts.some(v => v.verdict === o)) || "NONE";
	return { verdict: worst, detail: verdicts.map(v => v.detail).join("; ") };
};

const medianOf = (arr) => {
	const s = [...arr].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// 7d-tile index sets (see derivation notes). Quiet sets differ per line
// because each lifecycle line is disturbed by different hooks.
const LIFECYCLE_7D = { type: "lifecycle", valueMomentEvent: VALUE_MOMENT, periodDays: 7 };
const QUIET_DORMANT = [5, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21];
const QUIET_RESURRECTED = [5, 6, 7, 8, 11, 14, 15, 16, 17, 18, 21];
const QUIET_RETAINED = [2, 13, 14, 20, 21];

const tiles7Ok = (rows) => Array.isArray(rows) && rows.length === 22;

export const stories = [
	{
		id: "streaming-h1-weekly-wave",
		hook: "H1",
		archetype: "lifecycle-wave",
		narrative: "~25% of early-born users stop hitting the value moment for exactly 3 weeks (days 42-63) while still browsing, then a burst brings them back: the 7d Lifecycle shows a dormant hump (~1.8x quiet median), a resurrected spike (~2.4x) three tiles later, and a retained dip (~0.58x) in between (organic: 0.93 / 0.99 / 1.01).",
		assertions: [
			{
				breakdown: LIFECYCLE_7D,
				assert: (rows) => {
					if (!tiles7Ok(rows)) return { verdict: "NONE", detail: `expected 22 seven-day tiles, got ${rows?.length}` };
					const quiet = medianOf(QUIET_DORMANT.map(i => rows[i].dormant));
					const peak = Math.max(rows[6].dormant, rows[7].dormant, rows[8].dormant);
					const ratio = peak / quiet;
					return guarded(quiet >= 600, `quiet dormant median ${quiet}`,
						() => bandVerdict(ratio, [1.5, 2.6], [1.3, 3.2],
							`dormant peak ${peak} / quiet median ${quiet} = ${ratio.toFixed(2)} (expect ~1.8, organic 0.93)`,
							v => v <= 1.1));
				},
			},
			{
				breakdown: LIFECYCLE_7D,
				assert: (rows) => {
					if (!tiles7Ok(rows)) return { verdict: "NONE", detail: `expected 22 seven-day tiles, got ${rows?.length}` };
					const quiet = medianOf(QUIET_RESURRECTED.map(i => rows[i].resurrected));
					const peak = Math.max(rows[9].resurrected, rows[10].resurrected);
					const ratio = peak / quiet;
					return guarded(quiet >= 600, `quiet resurrected median ${quiet}`,
						() => bandVerdict(ratio, [1.8, 3.2], [1.5, 4.0],
							`resurrected spike ${peak} / quiet median ${quiet} = ${ratio.toFixed(2)} (expect ~2.4, organic 0.99)`,
							v => v <= 1.15));
				},
			},
			{
				breakdown: LIFECYCLE_7D,
				assert: (rows) => {
					if (!tiles7Ok(rows)) return { verdict: "NONE", detail: `expected 22 seven-day tiles, got ${rows?.length}` };
					const quiet = medianOf(QUIET_RETAINED.map(i => rows[i].retained));
					const dip = Math.min(rows[7].retained, rows[8].retained);
					const ratio = dip / quiet;
					return guarded(quiet >= 2800, `quiet retained median ${quiet}`,
						() => bandVerdict(ratio, [0.45, 0.70], [0.40, 0.82],
							`retained dip ${dip} / quiet median ${quiet} = ${ratio.toFixed(2)} (expect ~0.58, organic 1.01)`,
							v => v >= 0.93));
				},
			},
		],
	},
	{
		id: "streaming-h2-monthly-wave",
		hook: "H2",
		archetype: "lifecycle-wave",
		narrative: "~15% of early-born users go value-moment-dark for 65 days (days 21-86) — a gap sized to cover one whole 30d tile, per the HOOKS.md gap-discipline rule. The 30d Lifecycle shows dormant ~11x every other tile in tile 2 and resurrected ~11x in tile 3 (organic: both lines are noise-level counts ≤17).",
		assertions: [
			{
				breakdown: { type: "lifecycle", valueMomentEvent: VALUE_MOMENT, periodDays: 30 },
				assert: (rows) => {
					if (!Array.isArray(rows) || rows.length !== 6) return { verdict: "NONE", detail: `expected 6 thirty-day tiles, got ${rows?.length}` };
					const dOther = Math.max(...[1, 3, 4, 5].map(i => rows[i].dormant), 1);
					const zOther = Math.max(...[2, 4, 5].map(i => rows[i].resurrected), 1);
					const dRatio = rows[2].dormant / dOther;
					const zRatio = rows[3].resurrected / zOther;
					const legD = guarded(rows[2].dormant >= 760, `dormant tile ${rows[2].dormant}`,
						() => bandVerdict(dRatio, [5, 1e9], [2.5, 1e9],
							`30d dormant tile ${rows[2].dormant} vs ${dOther} max elsewhere = ${dRatio.toFixed(1)}x (expect ~11x, organic 0.7)`,
							v => v <= 1.2));
					const legZ = guarded(rows[3].resurrected >= 745, `resurrected tile ${rows[3].resurrected}`,
						() => bandVerdict(zRatio, [5, 1e9], [2.5, 1e9],
							`30d resurrected tile ${rows[3].resurrected} vs ${zOther} max elsewhere = ${zRatio.toFixed(1)}x (expect ~11x, organic 1.5)`,
							v => v <= 1.2));
					return worstOf(legD, legZ);
				},
			},
		],
	},
	{
		id: "streaming-h3-resurrection-campaign",
		hook: "H3",
		archetype: "lifecycle-wave",
		narrative: "~12% of early-born users disappear COMPLETELY (dropAll) for 30 days (days 100-130), then return — and ~97% of returners have a push_open burst in the 24h before their first post-gap play (organic: 8 users ever gap ≥25d, half their returns near a push by chance). The resurrection is attributable to the campaign.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH e AS (
  SELECT user_id::VARCHAR AS uid, event, time::TIMESTAMP AS t,
    LAG(time::TIMESTAMP) OVER (PARTITION BY user_id::VARCHAR ORDER BY time::TIMESTAMP) AS prev_t
  FROM ${EV} WHERE user_id IS NOT NULL
), gaps AS (
  SELECT uid, MAX(t - prev_t) AS max_gap FROM e WHERE prev_t IS NOT NULL GROUP BY 1
), gap_users AS (
  SELECT uid FROM gaps WHERE max_gap >= INTERVAL 25 DAY
), gap_edge AS (
  SELECT e.uid, MIN(e.t) AS gap_end
  FROM e JOIN gap_users g ON e.uid = g.uid
  WHERE e.prev_t IS NOT NULL AND e.t - e.prev_t >= INTERVAL 25 DAY
  GROUP BY 1
), first_play AS (
  SELECT e.uid, MIN(e.t) AS play_t
  FROM e JOIN gap_edge g ON e.uid = g.uid
  WHERE e.event = 'content played' AND e.t >= g.gap_end
  GROUP BY 1
), pushed AS (
  SELECT DISTINCT f.uid
  FROM first_play f JOIN e ON e.uid = f.uid
  WHERE e.event = 'push_open' AND e.t <= f.play_t AND e.t >= f.play_t - INTERVAL 24 HOUR
)
SELECT (SELECT COUNT(*) FROM gap_users) AS gap_users,
  (SELECT COUNT(*) FROM first_play) AS returners,
  (SELECT COUNT(*) FROM pushed) AS pushed_returners`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r) return { verdict: "NONE", detail: "gap audit returned no rows" };
					const gapUsers = Number(r.gap_users), returners = Number(r.returners), pushed = Number(r.pushed_returners);
					return guarded(gapUsers >= 490, `${gapUsers} gap users`, () => {
						const returnRate = returners / gapUsers;
						const pushShare = pushed / Math.max(returners, 1);
						const legReturn = bandVerdict(returnRate, [0.9, 1.0], [0.75, 1.0],
							`${returners}/${gapUsers} gap users return to the value moment (${returnRate.toFixed(3)})`,
							v => v <= 0.3);
						const legPush = bandVerdict(pushShare, [0.85, 1.0], [0.65, 1.0],
							`pushed-returner share ${pushShare.toFixed(3)} (expect ~0.97, organic ~0.5 of n=6)`,
							v => v <= 0.25);
						return worstOf(legReturn, legPush);
					});
				},
			},
			{
				breakdown: LIFECYCLE_7D,
				assert: (rows) => {
					if (!tiles7Ok(rows)) return { verdict: "NONE", detail: `expected 22 seven-day tiles, got ${rows?.length}` };
					const quiet = medianOf(QUIET_RESURRECTED.map(i => rows[i].resurrected));
					const peak = Math.max(rows[19].resurrected, rows[20].resurrected);
					const ratio = peak / quiet;
					return guarded(quiet >= 600, `quiet resurrected median ${quiet}`,
						() => bandVerdict(ratio, [1.4, 2.6], [1.25, 3.2],
							`H3 return spike ${peak} / quiet median ${quiet} = ${ratio.toFixed(2)} (expect ~1.8, organic 0.95)`,
							v => v <= 1.1));
				},
			},
		],
	},
	{
		id: "streaming-h4-wau-double-trough",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: "Combined H1+H2+H3 effect on WAU (uniques on the value moment, 7-day rolling window): a deep mid-dataset trough (~0.59x baseline, days 49-63, where H1's and H2's windows overlap), a second smaller dip (~0.89x local baseline, days 107-137, H3's total gap), and full tail recovery (~1.09x) as the bursts land (organic: 1.00 / 1.00 / 1.09).",
		assertions: [
			{
				breakdown: { type: "uniques", event: VALUE_MOMENT, rollingWindow: 7 },
				assert: (rows) => {
					if (!Array.isArray(rows) || rows.length !== 151) return { verdict: "NONE", detail: `expected 151 daily WAU rows, got ${rows?.length}` };
					const v = rows.map(r => r.uniques);
					const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
					const baseline = mean(v.slice(7, 21));
					return guarded(baseline >= 3450, `WAU baseline ${baseline.toFixed(0)}`, () => {
						const r1 = Math.min(...v.slice(49, 64)) / baseline;
						const r2 = Math.min(...v.slice(107, 138)) / mean(v.slice(93, 100));
						const rec = mean(v.slice(-14, -2)) / baseline;
						const leg1 = bandVerdict(r1, [0.45, 0.72], [0.38, 0.85],
							`trough1 (d49-63) ${r1.toFixed(3)} of baseline (expect ~0.59, organic 1.00)`, x => x >= 0.93);
						const leg2 = bandVerdict(r2, [0.82, 0.93], [0.75, 0.96],
							`trough2 (d107-137) ${r2.toFixed(3)} of local pre-dip (expect ~0.89, organic 1.00)`, x => x >= 0.985);
						const legRec = bandVerdict(rec, [1.0, 1.35], [0.92, 1.5],
							`tail recovery ${rec.toFixed(3)} of baseline (expect ~1.09)`, x => x <= 0.8);
						return worstOf(leg1, leg2, legRec);
					});
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT COUNT(*) AS n,
  AVG((user_id IS NOT NULL)::INT) AS uid_share,
  AVG((device_id IS NOT NULL)::INT) AS device_share,
  COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id) AS dpu
FROM ${EV}`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r) return { verdict: "NONE", detail: "identity query returned no rows" };
					const legUid = bandVerdict(Number(r.uid_share), [1, 1], [0.999, 1],
						`uid_share ${Number(r.uid_share).toFixed(4)} (every event carries user_id)`, v => v < 0.99);
					const legDev = bandVerdict(Number(r.device_share), [0.99, 1], [0.97, 1],
						`device_share ${Number(r.device_share).toFixed(4)} (avgDevicePerUser: 2)`, v => v < 0.9);
					const legDpu = bandVerdict(Number(r.dpu), [1.6, 2.4], [1.4, 2.6],
						`devices/user ${Number(r.dpu).toFixed(2)} (expect ~2.08)`, v => v < 1.05);
					return worstOf(legUid, legDev, legDpu);
				},
			},
		],
	},
];
