// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import * as v from "ak-tools";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       QuestForge
 * APP:        D&D-inspired action RPG with a deep character system, party-based
 *             dungeon crawls, boss fights, a player-driven economy, guilds, and
 *             subscription tiers. Combines tabletop-RPG strategic depth with the
 *             monetization and engagement loops of a modern live-service game.
 * SCALE:      10,000 users, ~1.4M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  character created → tutorial → quest → dungeon crawl → combat → loot → level up
 *
 * EVENTS (24):
 *   combat initiated (20) > enter dungeon (18) > combat completed (18) > find treasure (16)
 *   > quest accepted (15) > exit dungeon (14) > use item (14) > quest objective completed (12)
 *   > item purchased (11) > quest turned in (10) > inspect (9) > player death (8)
 *   > search for clues (8) > item sold (7) > gameplay summary (6) > level up (5)
 *   > attack (5) > guild joined (4) > real money purchase (3) > fight boss (3)
 *   > defend (3) > tutorial completed (2) > character created (1) > guild left (1)
 *
 * FUNNELS (7):
 *   - Onboarding:         character created → tutorial completed → quest accepted (75%)
 *   - Combat Loop:        combat initiated → combat completed → use item (75%)
 *   - Dungeon Crawl:      enter dungeon → find treasure → exit dungeon (60%)
 *   - Quest Lifecycle:    quest accepted → quest objective completed → quest turned in (55%)
 *   - Prep Funnel:        inspect → search for clues → enter dungeon (50%)
 *   - Economy:            item purchased → use item → item sold (45%)
 *   - Social/Progression: guild joined → level up → real money purchase (25%)
 *
 * USER PROPS:  preferred_playstyle, total_playtime_hours, achievement_points, favorite_class,
 *              Platform, graphics_quality, subscription_tier, race, class, alignment,
 *              background, level, archetype, experiment, variant
 * SUPER PROPS: Platform, graphics_quality, subscription_tier
 * SCD PROPS:   player_rank (recruit/veteran/elite/legend, weekly fuzzy, max 20)
 * GROUPS:      guild_id (cap 500; on guild joined / guild left / quest turned in / combat completed)
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable via
 * behavioral cohorts (count event per user), raw-prop breakdowns
 * (treasure_type, subscription_tier, day-of-user-life), or funnel
 * time-to-convert. Expectations below were measured at 1500-user iteration
 * scale (per-user event density is scale-invariant, so ratios transfer to
 * the shipped 10K). The machine-checked contract is the `stories` export at
 * the bottom of this file:
 *   node scripts/verify-stories.mjs dungeons/vertical/gaming/gaming.js
 *
 * Hook 1 — ANCIENT COMPASS REWARDS (everything)
 *    Heavy compass users (COMPASS_HEAVY_MIN=2+ "use item" events with
 *    item_type="Ancient Compass" — ~48% of users) earn
 *    COMPASS_REWARD_MULT=1.5x reward_gold and reward_xp on every quest
 *    turned in, plus a 40% chance per turn-in of a bonus cloned quest.
 *    item_type is a 6-value enum on a high-frequency event, so a 1+ gate
 *    would leave no control group (~75% of users qualify at 1+).
 *    → Mixpanel: cohort A = users with 2+ "use item" where
 *      item_type="Ancient Compass"; avg reward_gold on "quest turned in"
 *    → Expected: A/rest reward_gold ≈ 1.56x, reward_xp ≈ 1.58x (slightly
 *      above the 1.5 knob — bonus clones are built at the boosted rate)
 *
 * Hook 2 — CURSED WEEK (everything, time-based)
 *    Injected "player death" events with cause_of_death="Curse" cluster in
 *    days 40-47 of each user's own timeline (CURSED_DEATH_INJECTION_FACTOR
 *    0.6 deaths per in-window event). "Curse" also appears organically at a
 *    flat 1/6 share of deaths, so out-of-window Curse deaths exist.
 *    → Mixpanel: "player death" filtered cause_of_death="Curse", charted by
 *      day-of-user-life (calendar-day charts smear the spike across born-in
 *      cohorts)
 *    → Expected: per-day Curse density in window ≈ 36x out-of-window
 *      (measured on 48d+ lifetime users); raw in/out count ratio ≈ 2.7
 *
 * Hook 3 — EARLY GUILD RESCUE (everything, retention)
 *    Early guild joiners ("guild joined" within first EARLY_GUILD_DAYS=3
 *    days, ~13% of users) are exempt from the Hook 4 death spiral, and 60%
 *    of them get a bonus late combat-victory clone.
 *    → Mixpanel: among users with 3+ week-1 deaths, cohort by early guild
 *      join; compare post-week-1 event volume
 *    → Expected: joiners keep ~2.5x the post-week-1 events of non-joiners
 *      (knob ceiling 1/0.3 = 3.3x; guild joiners are front-loaded players,
 *      which pulls the measured contrast below the ceiling)
 *
 * Hook 4 — DEATH SPIRAL CHURN (everything)
 *    Non-joiners with DEATH_SPIRAL_MIN_DEATHS=3+ deaths in the first
 *    DEATH_SPIRAL_EARLY_DAYS=7 days (~9% of users) lose
 *    DEATH_SPIRAL_DROP_LIKELIHOOD=70% of their post-week-1 events.
 *    → Mixpanel: bucket users by week-1 "player death" count; compare
 *      post/pre-day-7 event volume
 *    → Expected: spiral post/pre ≈ 1.4 vs ≈ 12.4 for everyone else (ratio
 *      ≈ 0.11 — the 0.3 keep-rate compounds with activity selection: 3+
 *      early deaths selects front-loaded players whose natural post/pre is
 *      already ~3x lower than average)
 *
 * Hook 5 — LUCKY CHARM LTV (everything)
 *    Lucky Charm Pack buyers (~8% of users, organic product-enum share) get
 *    LUCKY_CHARM_PRICE_MULT=2.5x price_usd on ALL their real-money
 *    purchases, plus a 35% chance per "item purchased" of a bonus cloned
 *    real-money purchase at premium price points (19.99/49.99/99.99 base,
 *    x2.5, and x1.8 more if the buyer is a Hook 10 whale).
 *    → Mixpanel: cohort A = users with any "real money purchase" where
 *      product="Lucky Charm Pack"; compare avg price_usd vs rest
 *    → Expected: A/rest avg price ≈ 3.4x among non-whales (2.5x organic
 *      floor + high-ticket bonus clones ≈ 65% of A's purchase rows)
 *
 * Hook 6 — STRATEGIC EXPLORERS (everything, behaviors-together)
 *    Strategic players (STRATEGIC_MIN_EACH=6+ "inspect" AND 6+ "search for
 *    clues", ~42% of users — both events are high-frequency, so a 1+ gate
 *    covers ~99% of users and leaves no control group) get
 *    STRATEGIC_COMPLETION_LIKELIHOOD=85% of their non-completed dungeon
 *    exits flipped to completed and STRATEGIC_TREASURE_MULT=2x
 *    treasure_value.
 *    → Mixpanel: cohort A = users with 6+ inspect AND 6+ search for clues;
 *      completion share on "exit dungeon", avg treasure_value on
 *      "find treasure"
 *    → Expected: A completion ≈ 0.93 vs ≈ 0.54 rest; A/rest treasure ≈
 *      1.7x (2.0 knob diluted by Hook 13's sweet-band 1.3x boost, which
 *      lands mostly in the control cohort — honest band is 2.0/1.3 .. 2.0)
 *
 * Hook 7 — SHADOWMOURNE LEGENDARY (everything, timed release)
 *    Zero drops before dataset day LEGENDARY_RELEASE_DAY=45. One per-player
 *    roll at LEGENDARY_DROP_LIKELIHOOD=2%; a winner's first post-release
 *    "find treasure" becomes the drop (treasure_value 50000). Owners then
 *    get LEGENDARY_WIN_LIKELIHOOD=90% of non-victory combats flipped to
 *    Victory and 0.6x dungeon completion time with forced completion.
 *    → Mixpanel: "find treasure" filtered treasure_type="Shadowmourne
 *      Legendary", line chart by day — zero before day 45, trickle after.
 *      Cohort A = owners; per-user combat win rate.
 *    → Expected: owners ≈ 2% of post-release treasure finders; owner win
 *      rate ≈ 0.96 (0.9 flip floor, pushed up by tier flips) vs ≈ 0.55 rest
 *
 * Hook 8 — SUBSCRIBER TIER ADVANTAGE (everything)
 *    subscription_tier is 60/20/20 Free/Premium/Elite. Premium: 50% of
 *    losses flipped to wins, 1.4x rewards, 45% completion flips, 1.5x
 *    treasure, 30% of deaths survived. Elite: 70% win flips, 1.8x rewards,
 *    65% completion flips, 2.0x treasure, 50% survived, 5% bonus treasure
 *    clones.
 *    → Mixpanel: avg reward_gold on "quest turned in" broken down by
 *      subscription_tier; completion share on "exit dungeon" by tier
 *    → Expected: reward_gold Elite/Free ≈ 1.8x, Premium/Free ≈ 1.4x (the
 *      other multipliers are tier-independent and cancel); completion
 *      follows f + (1-f)*flip from the Free baseline f ≈ 0.68 → Premium ≈
 *      0.82, Elite ≈ 0.90 (Free baseline sits above the raw enum share
 *      because Hooks 6/7 also flip completions)
 *
 * Hook 9 — GOLD SCALES WITH LEVEL (everything, progression)
 *    Quest reward_gold *= (1 + level * LEVEL_GOLD_SCALING=0.15), level from
 *    the user profile (weighNumRange 1-20, low-skewed).
 *    → Mixpanel: avg reward_gold on "quest turned in" broken down by user
 *      property "level" (bucketed)
 *    → Expected: bucket ratios match the formula computed from the
 *      buckets' own mean levels — e.g. level 13+ (mean ≈ 14.3) vs level
 *      1-5 (mean ≈ 4.2) → (1+14.3*0.15)/(1+4.2*0.15) ≈ 1.94x, measured
 *      1.95x. Tier/compass multipliers are level-independent and cancel.
 *
 * Hook 10 — WHALE PURCHASES (everything)
 *    Whales get WHALE_PRICE_MULT=1.8x price_usd on real-money purchases.
 *    Deterministic hash — first char of the user_id hex, charCodeAt % 3
 *    == 0, which matches '0','3','6','9','c','f' = 6/16 = 37.5% of users
 *    (hash math, not "a third").
 *    → Mixpanel: rank users by total spend on "real money purchase";
 *      compare avg price_usd top-spender cohort vs rest
 *    → Expected: whale/rest avg price ≈ 1.8x among non-Lucky-Charm users
 *      (Hook 5's high-ticket clones contaminate the unscoped ratio to ~2x)
 *
 * Hook 11 — ALIGNMENT ARCHETYPE (user)
 *    archetype is a deterministic function of the D&D alignment user prop:
 *    Lawful/Neutral Good → "hero", Chaotic/Neutral Evil → "villain", the
 *    five remaining alignments → "neutral".
 *    → Mixpanel: uniques broken down by user property "archetype";
 *      cross-check counts against the alignment breakdown
 *    → Expected: mapping is exact (hero count == LG+NG count, villain ==
 *      CE+NE); shares ≈ hero 26% / villain 25% / neutral 49% at this seed
 *      (uniform alignment would give 22/22/56)
 *
 * Hook 12 — COMBAT FUNNEL SPEED BY TIER (everything, temporal)
 *    Greedy-matched combat sequences (combat initiated → combat completed →
 *    use item) get their inter-step gaps scaled per tier:
 *    TTC_ELITE_FACTOR=0.30, TTC_PREMIUM_FACTOR=0.70, TTC_FREE_FACTOR=1.40.
 *    → Mixpanel: Funnels on combat initiated → combat completed → use
 *      item; median time-to-convert broken down by subscription_tier
 *    → Expected: median TTC Free/Premium ≈ 1.40/0.70 = 2.0x,
 *      Premium/Elite ≈ 0.70/0.30 = 2.33x
 *
 * Hook 13 — COMBAT-PREP MAGIC NUMBER (everything, in-funnel)
 *    Prep events (inspect + search for clues) between the user's first
 *    quest-accepted and first fight-boss: PREP_SWEET_MIN..MAX=3-6 preps →
 *    all the user's treasure_value x PREP_TREASURE_BOOST=1.3;
 *    PREP_OVER_THRESHOLD=7+ preps → PREP_BOSS_FLIP_LIKELIHOOD=25% of the
 *    user's boss victories flip to defeat (analysis paralysis).
 *    → Mixpanel: bucket users by prep count between the two anchors; avg
 *      treasure_value and fight-boss victory rate per bucket
 *    → Expected: sweet/low treasure ≈ 1.24x among NON-strategic users
 *      (knob 1.3; Hook 6's 2x concentrates in high-prep bands and swamps
 *      the unscoped ratio); boss win over/sweet ≈ 0.73 (knob predicts
 *      0.75, Hook 6 does not touch the victory prop so no scoping needed)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EXPECTED METRICS SUMMARY (measured at 1500-user iteration; gates final)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Hook | Metric                                     | Knob     | Measured
 * -----|--------------------------------------------|----------|---------
 *  1   | compass-heavy / light avg reward_gold      | 1.5x     | 1.56x
 *  1   | compass-heavy / light avg reward_xp        | 1.5x     | 1.58x
 *  2   | Curse per-day density in/out of window     | —        | 35.6x
 *  3   | guild-saved / spiral post-week-1 volume    | ≤3.33x   | 2.51x
 *  4   | spiral / other post-pre event ratio        | 0.3 core | 0.113
 *  5   | lucky / rest avg price_usd (non-whales)    | ≥2.5x    | 3.40x
 *  6   | strategic / rest avg treasure_value        | ≤2.0x    | 1.72x
 *  6   | strategic completion share                 | ≥0.90    | 0.926
 *  7   | legendary adoption among treasure finders  | ~2%      | 1.5%
 *  7   | owner combat win rate                      | ≥0.90    | 0.963
 *  8   | Elite/Free avg reward_gold                 | 1.8x     | 1.80x
 *  8   | Premium/Free avg reward_gold               | 1.4x     | 1.37x
 *  9   | hi/lo level-bucket gold obs/formula        | 1.0      | 1.007
 * 10   | whale / rest avg price_usd (non-lucky)     | 1.8x     | 1.80x
 * 11   | archetype == alignment mapping             | exact    | exact
 * 12   | median combat TTC Free/Premium             | 2.0x     | (story)
 * 12   | median combat TTC Premium/Elite            | 2.33x    | (story)
 * 13   | sweet/low treasure (non-strategic)         | 1.3x     | 1.24x
 * 13   | over/sweet boss win rate                   | 0.75x    | 0.73x
 */

// ── SCALE ──
const SEED = "questforge";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const COMPASS_REWARD_MULT = 1.5;
const COMPASS_BONUS_QUEST_LIKELIHOOD = 40;
// item_type is a 6-value enum on a high-frequency event, so nearly every
// user fires "Ancient Compass" at least once — a 1+ gate leaves no control
// group. Gate on repeat use instead; threshold calibrated from the measured
// per-user compass-use distribution (see H1 story).
const COMPASS_HEAVY_MIN = 2;

const CURSED_WEEK_START_DAY = 40;
const CURSED_WEEK_END_DAY = 47;
const CURSED_DEATH_INJECTION_FACTOR = 0.6;

const EARLY_GUILD_DAYS = 3;
const EARLY_GUILD_COMBAT_CLONE_LIKELIHOOD = 60;

const DEATH_SPIRAL_EARLY_DAYS = 7;
const DEATH_SPIRAL_MIN_DEATHS = 3;
const DEATH_SPIRAL_DROP_LIKELIHOOD = 70;

const LUCKY_CHARM_PRICE_MULT = 2.5;
const LUCKY_CHARM_BONUS_PURCHASE_LIKELIHOOD = 35;

const STRATEGIC_COMPLETION_LIKELIHOOD = 85;
const STRATEGIC_TREASURE_MULT = 2;
// inspect (w9) and search for clues (w8) are common enough that almost every
// user fires both at least once — a low gate leaves no control group (3+ each
// covers ~76% of users). 6+ each splits ~42% strategic / ~58% rest, measured
// on the per-user count distributions (see H6 story).
const STRATEGIC_MIN_EACH = 6;

const LEGENDARY_RELEASE_DAY = 45;
const LEGENDARY_DROP_LIKELIHOOD = 2;
const LEGENDARY_TREASURE_VALUE = 50000;
const LEGENDARY_WIN_LIKELIHOOD = 90;
const LEGENDARY_DUNGEON_SPEED_MULT = 0.6;

const PREMIUM_WIN_LIKELIHOOD = 50;
const PREMIUM_REWARD_MULT = 1.4;
const PREMIUM_COMPLETION_LIKELIHOOD = 45;
const PREMIUM_DUNGEON_SPEED_MULT = 0.85;
const PREMIUM_TREASURE_MULT = 1.5;
const PREMIUM_SURVIVAL_LIKELIHOOD = 30;

const ELITE_WIN_LIKELIHOOD = 70;
const ELITE_REWARD_MULT = 1.8;
const ELITE_COMPLETION_LIKELIHOOD = 65;
const ELITE_DUNGEON_SPEED_MULT = 0.7;
const ELITE_TREASURE_MULT = 2.0;
const ELITE_SURVIVAL_LIKELIHOOD = 50;
const ELITE_BONUS_TREASURE_LIKELIHOOD = 5;

const LEVEL_GOLD_SCALING = 0.15;

const WHALE_PRICE_MULT = 1.8;

const TTC_ELITE_FACTOR = 0.30;
const TTC_PREMIUM_FACTOR = 0.70;
const TTC_FREE_FACTOR = 1.40;

const PREP_SWEET_MIN = 3;
const PREP_SWEET_MAX = 6;
const PREP_OVER_THRESHOLD = 7;
const PREP_TREASURE_BOOST = 1.3;
const PREP_BOSS_FLIP_LIKELIHOOD = 25;

// ── DATA ARRAYS ──
// Generate consistent item/location IDs for lookup tables
const dungeonIds = v.range(1, 51).map(n => `dungeon_${v.uid(6)}`);
const questIds = v.range(1, 201).map(n => `quest_${v.uid(8)}`);
const itemIds = v.range(1, 301).map(n => `item_${v.uid(7)}`);

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// Hook #11: ALIGNMENT ARCHETYPE — derive archetype on user profile
	if (record.alignment === "Chaotic Evil" || record.alignment === "Neutral Evil") {
		record.archetype = "villain";
	} else if (record.alignment === "Lawful Good" || record.alignment === "Neutral Good") {
		record.archetype = "hero";
	} else {
		record.archetype = "neutral";
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	const userEvents = record;
	const profile = meta.profile;
	const datasetStart = dayjs.unix(meta.datasetStart);
	const LEGENDARY_WEAPON_RELEASE = datasetStart.add(LEGENDARY_RELEASE_DAY, 'days');

	// Phase order follows types.d.ts everything-hook guidance:
	// stamp → mutate → clone → filter → temporal.

	// ── STAMP: superProps from profile for consistency ──
	userEvents.forEach(e => {
		e.Platform = profile.Platform;
		e.graphics_quality = profile.graphics_quality;
		e.subscription_tier = profile.subscription_tier;
	});

	const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;
	const userLevel = profile.level || 1;
	const subscriptionTier = profile.subscription_tier || "Free";
	const isElite = subscriptionTier === "Elite";
	const isPremium = subscriptionTier === "Premium";
	const tierRewardMult = isElite ? ELITE_REWARD_MULT : isPremium ? PREMIUM_REWARD_MULT : 1;

	// Hook #7: TIMED RELEASE — per-PLAYER roll, not per-event. The doc says
	// "~2% of players find it after release"; the old per-event roll made
	// adoption scale with each player's find-treasure volume. One roll per
	// user; a winner's first find-treasure after release becomes the drop.
	let hasLegendaryWeapon = false;
	if (chance.bool({ likelihood: LEGENDARY_DROP_LIKELIHOOD })) {
		const drop = userEvents.find(e => e.event === "find treasure" && dayjs(e.time).isAfter(LEGENDARY_WEAPON_RELEASE));
		if (drop) {
			drop.treasure_type = "Shadowmourne Legendary";
			drop.treasure_value = LEGENDARY_TREASURE_VALUE;
			hasLegendaryWeapon = true;
		}
	}

	// ── DETECT: per-user counts (counts, not booleans — high-frequency
	// enums mean 1+ gates leave no control group) ──
	let compassUses = 0;
	let boughtLuckyCharm = false;
	let joinedGuildEarly = false;
	let earlyDeaths = 0;
	let inspectCount = 0;
	let searchCount = 0;

	userEvents.forEach((event) => {
		const daysSinceStart = firstEventTime ? dayjs(event.time).diff(firstEventTime, 'days', true) : 0;

		if (event.event === "use item" && event.item_type === "Ancient Compass") compassUses++;
		if (event.event === "real money purchase" && event.product === "Lucky Charm Pack") boughtLuckyCharm = true;
		if (event.event === "guild joined" && daysSinceStart < EARLY_GUILD_DAYS) joinedGuildEarly = true;
		if (event.event === "player death" && daysSinceStart < DEATH_SPIRAL_EARLY_DAYS) earlyDeaths++;
		if (event.event === "inspect") inspectCount++;
		if (event.event === "search for clues") searchCount++;
	});

	const usedAncientCompass = compassUses >= COMPASS_HEAVY_MIN;
	const isStrategic = inspectCount >= STRATEGIC_MIN_EACH && searchCount >= STRATEGIC_MIN_EACH;

	// Hook #10: Whale segmentation — deterministic via user_id hash.
	// distinct_id is hex, so charCodeAt(0) % 3 === 0 matches '0','3','6',
	// '9','c','f' → 6/16 = 37.5% of users (not "a third" — hash math).
	const userId = userEvents.length > 0 ? (userEvents[0].user_id || userEvents[0].distinct_id || "") : "";
	const isWhale = userId.length > 0 && userId.charCodeAt(0) % 3 === 0;

	// ── MUTATE + CLONE-COLLECT: single pass over organic events. Clones are
	// collected and pushed AFTER the loop — the old splice-at-idx+1 pattern
	// fed every clone back through the mutations below (compass clones were
	// re-multiplied, clones could spawn clones). Clones are built fully
	// formed here instead, with the same multipliers an organic event of
	// their cohort receives, so cohort ratios stay exact.
	const clones = [];
	userEvents.forEach((event) => {
		const eventTime = dayjs(event.time);

		// Hook 9: PROGRESSION SCALING — Quest gold scales linearly with level.
		if (event.event === "quest turned in") {
			const baseGold = event.reward_gold || 100;
			event.reward_gold = Math.floor(baseGold * (1 + userLevel * LEVEL_GOLD_SCALING));
		}

		// Hook 1: CONVERSION — heavy compass users earn 1.5x quest rewards
		// plus 40% chance of a bonus cloned quest per turn-in.
		if (usedAncientCompass && event.event === "quest turned in") {
			event.reward_gold = Math.floor((event.reward_gold || 100) * COMPASS_REWARD_MULT);
			event.reward_xp = Math.floor((event.reward_xp || 500) * COMPASS_REWARD_MULT);

			if (chance.bool({ likelihood: COMPASS_BONUS_QUEST_LIKELIHOOD })) {
				clones.push({
					...event,
					time: eventTime.add(chance.integer({ min: 10, max: 120 }), 'minutes').toISOString(),
					quest_id: chance.pickone(questIds),
					// same treatment an organic quest of this user gets:
					// level scaling × compass mult × tier mult, applied once
					reward_gold: Math.floor(chance.integer({ min: 100, max: 500 }) * (1 + userLevel * LEVEL_GOLD_SCALING) * COMPASS_REWARD_MULT * tierRewardMult),
					reward_xp: Math.floor(chance.integer({ min: 500, max: 2000 }) * COMPASS_REWARD_MULT * tierRewardMult),
				});
			}
		}

		// Hook 5: PURCHASE VALUE — Lucky Charm buyers see 2.5x prices on all
		// real-money purchases; item purchases carry a 35% chance of a bonus
		// cloned real-money purchase.
		if (boughtLuckyCharm) {
			if (event.event === "real money purchase" && event.price_usd) {
				event.price_usd = Math.round(event.price_usd * LUCKY_CHARM_PRICE_MULT * 100) / 100;
			}
			if (event.event === "item purchased" && chance.bool({ likelihood: LUCKY_CHARM_BONUS_PURCHASE_LIKELIHOOD })) {
				const purchaseTemplate = userEvents.find(e => e.event === "real money purchase");
				if (purchaseTemplate) {
					// lucky (2.5x) and whale (1.8x) multipliers applied at build
					// time so the H5/H10 cohort ratios hold on every purchase row
					let bonusPrice = chance.pickone([19.99, 49.99, 99.99]) * LUCKY_CHARM_PRICE_MULT;
					if (isWhale) bonusPrice *= WHALE_PRICE_MULT;
					clones.push({
						...purchaseTemplate,
						time: eventTime.add(chance.integer({ min: 1, max: 3 }), 'days').toISOString(),
						user_id: event.user_id,
						product: chance.pickone(["Premium Currency (5000)", "Legendary Weapon Chest", "Season Pass"]),
						price_usd: Math.round(bonusPrice * 100) / 100,
						payment_method: chance.pickone(["Credit Card", "PayPal"]),
					});
				}
			}
		}

		// Hook 10: WHALE PURCHASES — 1.8x price for whale cohort.
		if (isWhale && event.event === "real money purchase" && event.price_usd) {
			event.price_usd = Math.round(event.price_usd * WHALE_PRICE_MULT * 100) / 100;
		}

		// Hook 6: BEHAVIORS TOGETHER — strategic explorers (repeat inspect +
		// search) get 85% completion flips + 2x treasure value.
		if (isStrategic) {
			if (event.event === "exit dungeon" && event.completion_status !== "completed" && chance.bool({ likelihood: STRATEGIC_COMPLETION_LIKELIHOOD })) {
				event.completion_status = "completed";
			}
			if (event.event === "find treasure") {
				event.treasure_value = Math.floor((event.treasure_value || 50) * STRATEGIC_TREASURE_MULT);
			}
		}

		// Hook 7: TIMED RELEASE — Legendary owners get 90% combat
		// wins + 0.6x dungeon time.
		if (hasLegendaryWeapon) {
			if (event.event === "combat completed" && event.outcome !== "Victory" && chance.bool({ likelihood: LEGENDARY_WIN_LIKELIHOOD })) {
				event.outcome = "Victory";
			}
			if (event.event === "exit dungeon") {
				event.completion_status = "completed";
				event.time_spent_mins = Math.floor((event.time_spent_mins || 60) * LEGENDARY_DUNGEON_SPEED_MULT);
			}
		}

		// Hook 8: SUBSCRIPTION TIER — Premium/Elite get win+reward+
		// completion+treasure boosts. Reads tier from profile.
		if (isPremium || isElite) {
			if (event.event === "combat completed" && event.outcome !== "Victory") {
				const winBoost = isElite ? ELITE_WIN_LIKELIHOOD : PREMIUM_WIN_LIKELIHOOD;
				if (chance.bool({ likelihood: winBoost })) {
					event.outcome = "Victory";
					event.loot_gained = true;
				}
			}
			if (event.event === "quest turned in") {
				event.reward_gold = Math.floor((event.reward_gold || 100) * tierRewardMult);
				event.reward_xp = Math.floor((event.reward_xp || 500) * tierRewardMult);
			}
			if (event.event === "exit dungeon") {
				if (event.completion_status !== "completed") {
					const completionBoost = isElite ? ELITE_COMPLETION_LIKELIHOOD : PREMIUM_COMPLETION_LIKELIHOOD;
					if (chance.bool({ likelihood: completionBoost })) {
						event.completion_status = "completed";
					}
				}
				if (event.completion_status === "completed") {
					const speedBoost = isElite ? ELITE_DUNGEON_SPEED_MULT : PREMIUM_DUNGEON_SPEED_MULT;
					event.time_spent_mins = Math.floor((event.time_spent_mins || 60) * speedBoost);
				}
			}
			if (event.event === "find treasure") {
				const treasureBoost = isElite ? ELITE_TREASURE_MULT : PREMIUM_TREASURE_MULT;
				event.treasure_value = Math.floor((event.treasure_value || 50) * treasureBoost);
			}
			if (event.event === "player death") {
				const survivalLikelihood = isElite ? ELITE_SURVIVAL_LIKELIHOOD : PREMIUM_SURVIVAL_LIKELIHOOD;
				if (chance.bool({ likelihood: survivalLikelihood })) {
					// full rename: strip player-death-only props so the schema
					// of "combat completed" stays clean (no leaked columns)
					event.event = "combat completed";
					event.outcome = "Victory";
					event.loot_gained = true;
					delete event.cause_of_death;
					delete event.player_level;
					delete event.resurrection_used;
				}
			}
			if (isElite && chance.bool({ likelihood: ELITE_BONUS_TREASURE_LIKELIHOOD })) {
				if (event.event === "quest turned in" || event.event === "exit dungeon") {
					const treasureTemplate = userEvents.find(e => e.event === "find treasure");
					if (treasureTemplate) {
						const treasureTypes = ["Rare Artifact", "Gold", "Weapon", "Armor"];
						clones.push({
							...treasureTemplate,
							time: eventTime.add(chance.integer({ min: 5, max: 30 }), 'minutes').toISOString(),
							user_id: event.user_id,
							treasure_type: chance.pickone(treasureTypes),
							treasure_value: chance.integer({ min: 200, max: 800 }),
						});
					}
				}
			}
		}
	});

	// ── CLONE-PUSH: engine auto-sorts by time after the everything hook ──
	userEvents.push(...clones);

	// Hook 2: CURSED WEEK — inject extra deaths in days 40-47 of
	// user's timeline. Cause_of_death set to "Curse" on injected.
	// Discover via line-chart of player-death by day-of-user-life.
	if (firstEventTime) {
		const deathTemplate = userEvents.find(e => e.event === "player death");
		if (deathTemplate) {
			const cursedStart = firstEventTime.add(CURSED_WEEK_START_DAY, 'days');
			const cursedEnd = firstEventTime.add(CURSED_WEEK_END_DAY, 'days');
			const cursedEvents = userEvents.filter(e => {
				const t = dayjs(e.time);
				return t.isAfter(cursedStart) && t.isBefore(cursedEnd);
			});
			const deathsToInject = Math.floor(cursedEvents.length * CURSED_DEATH_INJECTION_FACTOR);
			for (let d = 0; d < deathsToInject; d++) {
				const sourceEvent = cursedEvents[d % cursedEvents.length];
				userEvents.push({
					...deathTemplate,
					time: dayjs(sourceEvent.time).add(chance.integer({ min: 1, max: 30 }), 'minutes').toISOString(),
					user_id: sourceEvent.user_id,
					event: "player death",
					cause_of_death: "Curse",
					player_level: chance.integer({ min: 1, max: 50 }),
					resurrection_used: chance.bool({ likelihood: 80 }),
				});
			}
		}
	}

	// Hook 3 RETENTION + Hook 4 CHURN — death-spiral taxonomy matches the
	// doc: non-joiners with 3+ week-1 deaths lose ~70% of post-week-1
	// events. Early guild joiners are exempt (that IS the retention story)
	// and 60% of them get a bonus late combat clone. The old gate
	// ((!guild && deaths>=2) || deaths>=4, 80% drop) matched neither doc.
	const shouldChurn = !joinedGuildEarly && earlyDeaths >= DEATH_SPIRAL_MIN_DEATHS;
	if (shouldChurn) {
		const firstWeekEnd = firstEventTime ? firstEventTime.add(DEATH_SPIRAL_EARLY_DAYS, 'days') : null;
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (firstWeekEnd && dayjs(userEvents[i].time).isAfter(firstWeekEnd) && chance.bool({ likelihood: DEATH_SPIRAL_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	} else if (joinedGuildEarly) {
		const lastEvent = userEvents[userEvents.length - 1];
		const combatTemplate = userEvents.find(e => e.event === "combat completed");
		if (lastEvent && combatTemplate && chance.bool({ likelihood: EARLY_GUILD_COMBAT_CLONE_LIKELIHOOD })) {
			userEvents.push({
				...combatTemplate,
				time: dayjs(lastEvent.time).add(chance.integer({ min: 1, max: 5 }), 'days').toISOString(),
				user_id: lastEvent.user_id,
				outcome: "Victory",
				loot_gained: true,
			});
		}
	}

	// HOOK 13: COMBAT-PREP MAGIC NUMBER (in-funnel, no flags)
	// Sweet 3-6 inspect+search events between quest accepted and
	// fight boss → +30% loot/treasure_value on find-treasure events.
	// Over 7+ → drop 25% of fight-boss completion (over-prep
	// signals analysis paralysis). No flag.
	const questAccept = userEvents.find(e => e.event === "quest accepted");
	const bossFight = userEvents.find(e => e.event === "fight boss");
	if (questAccept && bossFight) {
		const aTime = dayjs(questAccept.time);
		const bTime = dayjs(bossFight.time);
		const prepCount = userEvents.filter(e =>
			(e.event === "inspect" || e.event === "search for clues") &&
			dayjs(e.time).isAfter(aTime) &&
			dayjs(e.time).isBefore(bTime)
		).length;
		if (prepCount >= PREP_SWEET_MIN && prepCount <= PREP_SWEET_MAX) {
			userEvents.forEach(e => {
				if (e.event === "find treasure" && typeof e.treasure_value === "number") {
					e.treasure_value = Math.round(e.treasure_value * PREP_TREASURE_BOOST);
				}
			});
		} else if (prepCount >= PREP_OVER_THRESHOLD) {
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const ev = userEvents[i];
				if (ev.event === "fight boss" && ev.victory === true && chance.bool({ likelihood: PREP_BOSS_FLIP_LIKELIHOOD })) {
					ev.victory = false;
				}
			}
		}
	}

	// ── TEMPORAL (last phase): Hook #12 COMBAT T2C — scale time gaps in
	// combat funnel sequences (combat initiated → combat completed → use
	// item). Elite ~0.30x (faster), Premium ~0.70x, Free ~1.40x (slower).
	// Runs after clones/filters so it compresses exactly the sequences the
	// analyst will see; engine auto-sorts by time afterwards.
	// Sort first: clones were appended at the tail, and the sequence matcher
	// below relies on index order == time order (unsorted, a tail clone can
	// match as "next step" and produce a negative gap).
	userEvents.sort((a, b) => new Date(a.time) - new Date(b.time));
	const t2cFactor = (
		isElite ? TTC_ELITE_FACTOR :
		isPremium ? TTC_PREMIUM_FACTOR :
		subscriptionTier === "Free" ? TTC_FREE_FACTOR :
		1.0
	);
	if (t2cFactor !== 1.0) {
		// Collect indices for each combat funnel step
		const combatInitiated = [];
		const combatCompleted = [];
		const useItem = [];
		for (let i = 0; i < userEvents.length; i++) {
			const e = userEvents[i];
			if (e.event === "combat initiated") combatInitiated.push(i);
			else if (e.event === "combat completed") combatCompleted.push(i);
			else if (e.event === "use item") useItem.push(i);
		}
		// Match sequences: for each combat initiated, find next
		// combat completed after it, then next use item after that
		const matched = new Set();
		for (const ciIdx of combatInitiated) {
			const ccIdx = combatCompleted.find(j => j > ciIdx && !matched.has(j));
			if (ccIdx === undefined) continue;
			const uiIdx = useItem.find(j => j > ccIdx && !matched.has(j));
			if (uiIdx === undefined) continue;
			matched.add(ccIdx);
			matched.add(uiIdx);
			// Scale gap between step 1→2 and 2→3
			const t0 = dayjs(userEvents[ciIdx].time);
			const t1 = dayjs(userEvents[ccIdx].time);
			const t2 = dayjs(userEvents[uiIdx].time);
			const gap1 = t1.diff(t0);
			const gap2 = t2.diff(t1);
			userEvents[ccIdx].time = t0.add(Math.round(gap1 * t2cFactor), 'milliseconds').toISOString();
			userEvents[uiIdx].time = dayjs(userEvents[ccIdx].time).add(Math.round(gap2 * t2cFactor), 'milliseconds').toISOString();
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
		hasDesktopDevices: true,
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

	funnels: [
		{
			sequence: ["character created", "tutorial completed", "quest accepted"],
			isFirstFunnel: true,
			conversionRate: 75,
			timeToConvert: 0.5,
		},
		{
			// Core combat loop: most frequent player activity
			sequence: ["combat initiated", "combat completed", "use item"],
			conversionRate: 75,
			timeToConvert: 0.5,
			weight: 5,
		},
		{
			// Dungeon crawl: enter, explore, loot, exit
			sequence: ["enter dungeon", "find treasure", "exit dungeon"],
			conversionRate: 60,
			timeToConvert: 2,
			weight: 4,
			props: {
				"dungeon_id": dungeonIds,
				"difficulty": ["Easy", "Medium", "Hard", "Deadly"],
			}
		},
		{
			// Quest lifecycle
			sequence: ["quest accepted", "quest objective completed", "quest turned in"],
			conversionRate: 55,
			timeToConvert: 3,
			weight: 3,
			props: { "quest_id": questIds },
		},
		{
			// Preparation before dungeon: inspect + search for strategic explorer hook
			sequence: ["inspect", "search for clues", "enter dungeon"],
			conversionRate: 50,
			timeToConvert: 1,
			weight: 3,
		},
		{
			// Economy: buy gear, sell loot
			sequence: ["item purchased", "use item", "item sold"],
			conversionRate: 45,
			timeToConvert: 6,
			weight: 2,
		},
		{
			// Social and progression
			sequence: ["guild joined", "level up", "real money purchase"],
			conversionRate: 25,
			timeToConvert: 24,
			weight: 1,
		},
	],

	events: [
		{
			event: "character created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				"character_class": [
					"Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk",
					"Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"
				],
				"starting_race": [
					"Human", "Elf", "Dwarf", "Halfling", "Dragonborn",
					"Gnome", "Half-Elf", "Half-Orc", "Tiefling"
				],
			}
		},
		{
			event: "tutorial completed",
			weight: 2,
			properties: {
				"completion_time_mins": u.weighNumRange(3, 25, 0.8, 10),
				"skipped": [false, false, false, false, false, false, true],
			}
		},
		{
			event: "quest accepted",
			weight: 15,
			properties: {
				"quest_id": questIds,
				"quest_type": ["Main Story", "Side Quest", "Bounty", "Exploration", "Escort"],
				"recommended_level": u.weighNumRange(1, 50),
			}
		},
		{
			event: "quest objective completed",
			weight: 12,
			properties: {
				"quest_id": questIds,
				"objective_number": u.weighNumRange(1, 5),
			}
		},
		{
			event: "quest turned in",
			weight: 10,
			isStrictEvent: false,
			properties: {
				"quest_id": questIds,
				"reward_gold": u.weighNumRange(10, 500, 0.5, 100),
				"reward_xp": u.weighNumRange(50, 2000, 0.5, 500),
			}
		},
		{
			event: "enter dungeon",
			weight: 18,
			properties: {
				"dungeon_id": dungeonIds,
				"difficulty": ["Easy", "Medium", "Hard", "Deadly"],
				"party_size": u.weighNumRange(1, 5),
			}
		},
		{
			event: "exit dungeon",
			weight: 14,
			isStrictEvent: false,
			properties: {
				"dungeon_id": dungeonIds,
				"time_spent_mins": u.weighNumRange(5, 120, 0.6, 30),
				"completion_status": ["completed", "abandoned", "died"],
			}
		},
		{
			event: "find treasure",
			weight: 16,
			isStrictEvent: false,
			properties: {
				"treasure_type": ["Gold", "Weapon", "Armor", "Potion", "Scroll", "Rare Artifact"],
				"treasure_value": u.weighNumRange(5, 1000, 1.2, 50),
			}
		},
		{
			event: "player death",
			weight: 8,
			properties: {
				// "Curse" appears organically at 1/6 share; Hook 2 injects a dense
				// cluster of Curse deaths in user-days 40-47 on top of that flat
				// baseline (schema-first: injected values must be declared here)
				"cause_of_death": ["Monster", "Trap", "Fall Damage", "Poison", "Friendly Fire", "Curse"],
				"player_level": u.weighNumRange(1, 50),
				"resurrection_used": [false, false, false, true],
			}
		},
		{
			event: "level up",
			weight: 5,
			properties: {
				"new_level": u.weighNumRange(2, 50),
				"stat_points_gained": u.weighNumRange(1, 5),
				"new_abilities": ["Attack", "Spell", "Feat", "Skill"],
			}
		},
		{
			event: "item purchased",
			weight: 11,
			isStrictEvent: false,
			properties: {
				"item_id": itemIds,
				"item_type": ["Weapon", "Armor", "Potion", "Scroll", "Mount", "Cosmetic"],
				"price_gold": u.weighNumRange(10, 500, 0.8, 100),
				"vendor_type": ["Town", "Dungeon", "Special Event"],
			}
		},
		{
			event: "item sold",
			weight: 7,
			properties: {
				"item_id": itemIds,
				"item_type": ["Weapon", "Armor", "Potion", "Scroll", "Junk"],
				"sell_price": u.weighNumRange(5, 250, 0.5, 50),
			}
		},
		{
			event: "real money purchase",
			weight: 3,
			isStrictEvent: false,
			properties: {
				"product": [
					"Premium Currency (1000)",
					"Premium Currency (5000)",
					"Lucky Charm Pack",
					"Legendary Weapon Chest",
					"Cosmetic Bundle",
					"Season Pass"
				],
				"price_usd": [4.99, 9.99, 19.99, 49.99, 99.99],
				"payment_method": ["Credit Card", "PayPal", "Apple Pay", "Google Pay"],
			}
		},
		{
			event: "guild joined",
			weight: 4,
			isStrictEvent: false,
			properties: {
				"guild_size": u.weighNumRange(5, 100),
				"guild_level": u.weighNumRange(1, 20),
			}
		},
		{
			event: "guild left",
			weight: 1,
			properties: {
				"reason": ["Inactive", "Found Better Guild", "Conflict", "Disbanded"],
			}
		},
		{
			event: "inspect",
			weight: 9,
			isStrictEvent: false,
			properties: {
				"inspect_target": ["NPC", "Monster", "Treasure Chest", "Door", "Statue", "Bookshelf"],
			}
		},
		{
			event: "search for clues",
			weight: 8,
			isStrictEvent: false,
			properties: {
				"location_type": ["Dungeon Entrance", "Hidden Room", "Quest Location", "Town Square"],
				"clue_found": [false, false, true, true, true],
			}
		},
		{
			event: "use item",
			weight: 14,
			isStrictEvent: false,
			properties: {
				"item_id": itemIds,
				"item_type": [
					"Health Potion", "Mana Potion", "Buff Scroll",
					"Ancient Compass", "Lucky Charm", "Resurrection Stone"
				],
				"context": ["Combat", "Exploration", "Boss Fight", "Casual"],
			}
		},
		{
			event: "combat initiated",
			weight: 20,
			properties: {
				"enemy_type": ["Goblin", "Skeleton", "Dragon", "Demon", "Undead", "Beast"],
				"enemy_level": u.weighNumRange(1, 50),
				"combat_duration_sec": u.weighNumRange(10, 300, 0.7, 60),
			}
		},
		{
			event: "combat completed",
			weight: 18,
			isStrictEvent: false,
			properties: {
				"outcome": ["Victory", "Defeat", "Fled"],
				"loot_gained": [false, false, false, true, true, true, true, true, true, true],
			}
		},
		{
			event: "fight boss",
			weight: 3,
			properties: {
				"boss_type": ["Dragon", "Demon", "Lich", "Vampire", "Beholder"],
				"boss_level": u.weighNumRange(10, 50),
				"boss_difficulty": ["Hard", "Legendary", "Impossible"],
				"fight_duration_mins": u.weighNumRange(1, 60),
				"victory": [false, true, true],
			}
		},
		{
			event: "attack",
			weight: 5,
			properties: {
				"attack_type": ["Melee", "Ranged", "Spell", "Special"],
				"damage_dealt": u.weighNumRange(1, 200, 0.7, 30),
			}
		},
		{
			event: "defend",
			weight: 3,
			properties: {
				"defense_type": ["Block", "Parry", "Dodge", "Shield"],
				"damage_blocked": u.weighNumRange(0, 150, 0.7, 20),
			}
		},
		{
			event: "gameplay summary",
			weight: 6,
			properties: {
				"enemies_defeated": u.weighNumRange(0, 100),
				"respawns": u.weighNumRange(0, 10, 5),
				"total_attacks": u.weighNumRange(0, 100, 6, 12),
				"gold_found": u.weighNumRange(0, 1000),
			}
		},
	],

	superProps: {
		Platform: ["PC", "Mac", "PlayStation", "Xbox", "Switch"],
		graphics_quality: ["Low", "Medium", "High", "Ultra"],
		subscription_tier: ["Free", "Free", "Free", "Premium", "Elite"],
	},

	scdProps: {
		player_rank: {
			values: ["recruit", "veteran", "elite", "legend"],
			frequency: "week",
			timing: "fuzzy",
			max: 20
		}
	},

	userProps: {
		"preferred_playstyle": [
			"Solo Explorer", "Group Raider", "PvP Fighter",
			"Quest Completionist", "Treasure Hunter"
		],
		"total_playtime_hours": u.weighNumRange(1, 500, 1.5, 50),
		"achievement_points": u.weighNumRange(0, 5000, 0.8, 500),
		"favorite_class": [
			"Warrior", "Mage", "Rogue", "Cleric", "Ranger", "Paladin"
		],
		Platform: ["PC", "Mac", "PlayStation", "Xbox", "Switch"],
		graphics_quality: ["Low", "Medium", "High", "Ultra"],
		subscription_tier: ["Free", "Free", "Free", "Premium", "Elite"],

		// D&D character identity (from gaming dungeon)
		race: [
			"Human", "Elf", "Dwarf", "Halfling", "Dragonborn",
			"Gnome", "Half-Elf", "Half-Orc", "Tiefling"
		],
		class: [
			"Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk",
			"Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"
		],
		alignment: [
			"Lawful Good", "Neutral Good", "Chaotic Good",
			"Lawful Neutral", "True Neutral", "Chaotic Neutral",
			"Lawful Evil", "Neutral Evil", "Chaotic Evil"
		],
		background: [
			"Acolyte", "Charlatan", "Criminal", "Entertainer", "Folk Hero",
			"Guild Artisan", "Hermit", "Noble", "Outlander", "Sage",
			"Sailor", "Soldier", "Urchin"
		],
		level: u.weighNumRange(1, 20),
		archetype: ["neutral"],

		// A/B/C experiment scaffolding
		experiment: ["fast leveling", "tension economy", "free trial"],
		variant: ["A", "B", "C", "Control"],
	},

	groupKeys: [
		["guild_id", 500, ["guild joined", "guild left", "quest turned in", "combat completed"]],
	],

	groupProps: {
		guild_id: {
			"name": () => `${chance.word()} ${chance.pickone(["Knights", "Dragons", "Warriors", "Seekers", "Legends"])}`,
			"member_count": u.weighNumRange(5, 100),
			"guild_level": u.weighNumRange(1, 20),
			"total_wealth": u.weighNumRange(1000, 1000000, 0.5, 50000),
		}
	},

	lookupTables: [],

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

// ── STORIES ──
// Machine-checkable contract for the 13 hooks above. Thresholds derive from
// the knob constants (and the declared property distributions), never from
// observed output. duckdb assertions run in disk mode only
// (scripts/verify-stories.mjs after scripts/verify-runner.mjs).

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;

// Shared cohort CTEs. Compass/strategic gates count per-user events via a
// LEFT JOIN from profiles so zero-count users land in the control group.
const CNT_CTE = `SELECT us.distinct_id::VARCHAR AS uid,
  count(e.user_id) FILTER (WHERE e.event = 'use item' AND e.item_type = 'Ancient Compass') AS compass,
  count(e.user_id) FILTER (WHERE e.event = 'inspect') AS ins,
  count(e.user_id) FILTER (WHERE e.event = 'search for clues') AS sea
FROM ${US} us LEFT JOIN ${EV} e ON e.user_id::VARCHAR = us.distinct_id::VARCHAR GROUP BY 1`;

// Per-user week-1 death / early-guild flags for the H3/H4 churn taxonomy.
const CHURN_CTE = `firsts AS (SELECT user_id, min(time::TIMESTAMP) AS t0 FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1),
flags AS (
  SELECT f.user_id,
    count(*) FILTER (WHERE e.event = 'player death' AND e.time::TIMESTAMP < f.t0 + INTERVAL ${DEATH_SPIRAL_EARLY_DAYS} DAY) AS early_deaths,
    count(*) FILTER (WHERE e.event = 'guild joined' AND e.time::TIMESTAMP < f.t0 + INTERVAL ${EARLY_GUILD_DAYS} DAY) AS early_guild,
    count(*) FILTER (WHERE e.time::TIMESTAMP >= f.t0 + INTERVAL ${DEATH_SPIRAL_EARLY_DAYS} DAY) AS post_events,
    count(*) FILTER (WHERE e.time::TIMESTAMP < f.t0 + INTERVAL ${DEATH_SPIRAL_EARLY_DAYS} DAY) AS pre_events
  FROM firsts f JOIN ${EV} e USING (user_id) GROUP BY 1)`;

// Prep-count band CTEs for H13 (preps between first quest-accepted and first
// fight-boss; users without both anchors in order are excluded).
const PREP_CTE = `anchors AS (
  SELECT user_id,
    min(time::TIMESTAMP) FILTER (WHERE event = 'quest accepted') AS qa,
    min(time::TIMESTAMP) FILTER (WHERE event = 'fight boss') AS fb
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1),
prep AS (
  SELECT a.user_id, count(e.user_id) AS n
  FROM anchors a LEFT JOIN ${EV} e ON e.user_id = a.user_id
    AND e.event IN ('inspect', 'search for clues') AND e.time::TIMESTAMP > a.qa AND e.time::TIMESTAMP < a.fb
  WHERE a.qa IS NOT NULL AND a.fb IS NOT NULL AND a.fb > a.qa GROUP BY 1),
bands AS (SELECT user_id, CASE WHEN n BETWEEN ${PREP_SWEET_MIN} AND ${PREP_SWEET_MAX} THEN 'sweet' WHEN n < ${PREP_SWEET_MIN} THEN 'low' ELSE 'over' END AS band FROM prep)`;

// Whale hash predicate — mirrors the hook's charCodeAt(0) % 3 === 0 on the
// first hex char of user_id ('0','3','6','9','c','f' = 6/16 = 37.5%).
const WHALE_CHARS = `('0','3','6','9','c','f')`;

/**
 * Five-tier verdict for a ratio measured inside a custom assert: NAILED
 * within ±10% of target, STRONG past floor, WEAK direction-correct, INVERSE
 * wrong side of 1, NONE not computable. Mirrors verdictFor() for op '>=' —
 * needed where the select grammar can't express the comparison (formula
 * predictions, exact-mapping checks).
 */
function ratioVerdict(ratio, target, floor, detail, smallestCohort, minCohort) {
	if (!Number.isFinite(ratio)) return { pass: false, verdict: "NONE", detail: `ratio not computable — ${detail}` };
	let verdict;
	if (Math.abs(ratio - target) <= 0.1 * target) verdict = "NAILED";
	else if (ratio >= floor) verdict = "STRONG";
	else if (ratio > 1) verdict = "WEAK";
	else if (ratio < 1) verdict = "INVERSE";
	else verdict = "NONE";
	if ((verdict === "NAILED" || verdict === "STRONG") && smallestCohort < minCohort) {
		verdict = "WEAK";
		detail += ` — capped: smallest cohort ${smallestCohort} < minCohort ${minCohort}`;
	}
	return { pass: verdict === "NAILED" || verdict === "STRONG", verdict, detail };
}

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-compass-heavy-rewards",
		hook: "H1",
		archetype: "cohort-prop-scale",
		narrative: `heavy compass users (${COMPASS_HEAVY_MIN}+ "use item" with item_type="Ancient Compass", ~48% of users) earn ${COMPASS_REWARD_MULT}x reward_gold and reward_xp on quest turned in, plus a ${COMPASS_BONUS_QUEST_LIKELIHOOD}% bonus-quest clone per turn-in. item_type is a 6-value enum on a high-frequency event — a 1+ gate covers ~75% of users and leaves no control group`,
		assertions: [
			{
				// cohort split sanity: heavy/light ≈ 48/52 (measured per-user
				// compass-count distribution at the gate)
				breakdown: {
					type: "duckdb",
					sql: `WITH cnt AS (${CNT_CTE})
SELECT CASE WHEN compass >= ${COMPASS_HEAVY_MIN} THEN 'heavy' ELSE 'light' END AS grp, count(*) AS user_count FROM cnt GROUP BY 1`,
				},
				select: {
					heavy: { where: { grp: "heavy" } },
					light: { where: { grp: "light" } },
				},
				expect: { metric: "heavy.user_count / light.user_count", op: "between", target: [0.72, 1.17] },
				minCohort: 300,
			},
			{
				// COMPASS_REWARD_MULT = 1.5 exactly; measured 1.56 (bonus clones are
				// built at the boosted rate). Floor 1.35 absorbs cohort mix noise.
				breakdown: {
					type: "duckdb",
					sql: `WITH cnt AS (${CNT_CTE})
SELECT CASE WHEN c.compass >= ${COMPASS_HEAVY_MIN} THEN 'heavy' ELSE 'light' END AS grp,
avg(e.reward_gold) AS avg_gold, avg(e.reward_xp) AS avg_xp, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e JOIN cnt c ON e.user_id::VARCHAR = c.uid
WHERE e.event = 'quest turned in' AND e.reward_gold IS NOT NULL GROUP BY 1`,
				},
				select: {
					heavy: { where: { grp: "heavy" } },
					light: { where: { grp: "light" } },
				},
				expect: { metric: "heavy.avg_gold / light.avg_gold", op: ">=", target: COMPASS_REWARD_MULT, floor: 1.35 },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH cnt AS (${CNT_CTE})
SELECT CASE WHEN c.compass >= ${COMPASS_HEAVY_MIN} THEN 'heavy' ELSE 'light' END AS grp,
avg(e.reward_gold) AS avg_gold, avg(e.reward_xp) AS avg_xp, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e JOIN cnt c ON e.user_id::VARCHAR = c.uid
WHERE e.event = 'quest turned in' AND e.reward_xp IS NOT NULL GROUP BY 1`,
				},
				select: {
					heavy: { where: { grp: "heavy" } },
					light: { where: { grp: "light" } },
				},
				expect: { metric: "heavy.avg_xp / light.avg_xp", op: ">=", target: COMPASS_REWARD_MULT, floor: 1.35 },
				minCohort: 300,
			},
		],
	},
	{
		id: "H2-cursed-week",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `injected Curse deaths cluster in days ${CURSED_WEEK_START_DAY}-${CURSED_WEEK_END_DAY} of each user's own timeline (${CURSED_DEATH_INJECTION_FACTOR} injections per in-window event). Measured on 48d+ lifetime users so every user contributes a full window: per-day density in/out ≈ 36x; raw in/out count ≈ 2.7 (the out-of-window span is ~10x longer and collects the organic 1/6 enum share)`,
		assertions: [
			{
				// density ratio: (in/8 days) / (out/(avg_lifetime - 8) days). Band
				// [25, 50] is measured-anchored — the exact value depends on the
				// organic death rate (enum 1/6) vs the injection factor 0.6/event.
				breakdown: {
					type: "duckdb",
					sql: `WITH firsts AS (SELECT user_id, min(time::TIMESTAMP) AS t0, max(time::TIMESTAMP) AS tN FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1),
ll AS (SELECT user_id, t0, tN FROM firsts WHERE tN >= t0 + INTERVAL ${CURSED_WEEK_END_DAY + 1} DAY),
curse AS (SELECT e.user_id, epoch(e.time::TIMESTAMP - l.t0) / 86400.0 AS dol FROM ${EV} e JOIN ll l USING (user_id) WHERE e.event = 'player death' AND e.cause_of_death = 'Curse'),
lifespan AS (SELECT avg(epoch(tN - t0)) / 86400.0 AS avg_days, count(*) AS n FROM ll)
SELECT 'curse' AS grp,
 count(*) FILTER (WHERE dol BETWEEN ${CURSED_WEEK_START_DAY} AND ${CURSED_WEEK_END_DAY}) AS in_window,
 count(*) FILTER (WHERE dol < ${CURSED_WEEK_START_DAY} OR dol > ${CURSED_WEEK_END_DAY}) AS out_window,
 (count(*) FILTER (WHERE dol BETWEEN ${CURSED_WEEK_START_DAY} AND ${CURSED_WEEK_END_DAY}) / 8.0)
   / nullif(count(*) FILTER (WHERE dol < ${CURSED_WEEK_START_DAY} OR dol > ${CURSED_WEEK_END_DAY}) / ((SELECT avg_days FROM lifespan) - 8.0), 0) AS density_ratio,
 (SELECT n FROM lifespan) AS user_count
FROM curse`,
				},
				select: { curse: { where: { grp: "curse" } } },
				expect: { metric: "curse.density_ratio", op: "between", target: [25, 50] },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH firsts AS (SELECT user_id, min(time::TIMESTAMP) AS t0, max(time::TIMESTAMP) AS tN FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1),
ll AS (SELECT user_id, t0 FROM firsts WHERE tN >= t0 + INTERVAL ${CURSED_WEEK_END_DAY + 1} DAY),
curse AS (SELECT epoch(e.time::TIMESTAMP - l.t0) / 86400.0 AS dol FROM ${EV} e JOIN ll l USING (user_id) WHERE e.event = 'player death' AND e.cause_of_death = 'Curse')
SELECT 'curse' AS grp,
 (count(*) FILTER (WHERE dol BETWEEN ${CURSED_WEEK_START_DAY} AND ${CURSED_WEEK_END_DAY}))::DOUBLE
   / nullif(count(*) FILTER (WHERE dol < ${CURSED_WEEK_START_DAY} OR dol > ${CURSED_WEEK_END_DAY}), 0) AS in_out,
 count(*) AS event_count
FROM curse`,
				},
				select: { curse: { where: { grp: "curse" } } },
				// raw in/out ≈ 2.7 measured; an 8-day window holding >2x the deaths
				// of the other ~80 days combined is the analyst-visible spike
				expect: { metric: "curse.in_out", op: "between", target: [2.0, 3.5] },
			},
		],
	},
	{
		id: "H3-guild-rescue",
		hook: "H3",
		archetype: "retention-divergence",
		narrative: `among users with ${DEATH_SPIRAL_MIN_DEATHS}+ week-1 deaths, early guild joiners (first ${EARLY_GUILD_DAYS} days) are exempt from the death spiral and ${EARLY_GUILD_COMBAT_CLONE_LIKELIHOOD}% get a bonus combat-victory clone. Knob ceiling = 1/0.3 ≈ 3.3x post-week-1 volume vs spiraled peers; measured 2.51x (both cohorts select front-loaded players, pulling below the ceiling)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${CHURN_CTE}
SELECT CASE WHEN early_guild > 0 THEN 'saved' ELSE 'spiral' END AS grp, count(*) AS user_count, avg(post_events) AS avg_post
FROM flags WHERE early_deaths >= ${DEATH_SPIRAL_MIN_DEATHS} GROUP BY 1`,
				},
				select: {
					saved: { where: { grp: "saved" } },
					spiral: { where: { grp: "spiral" } },
				},
				expect: { metric: "saved.avg_post / spiral.avg_post", op: "between", target: [2.0, 3.4] },
				// ~190 saved users at 10K; WEAK-caps at reduced-scale iteration
				minCohort: 100,
			},
		],
	},
	{
		id: "H4-death-spiral",
		hook: "H4",
		archetype: "retention-divergence",
		narrative: `non-guild users with ${DEATH_SPIRAL_MIN_DEATHS}+ deaths in the first ${DEATH_SPIRAL_EARLY_DAYS} days (~9% of users) lose ${DEATH_SPIRAL_DROP_LIKELIHOOD}% of post-week-1 events. The post/pre contrast vs low-death users runs ~0.11, well below the raw 0.3 keep-rate: qualifying on 3+ early deaths selects front-loaded players whose natural post/pre is already ~3x lower. Asserted as a knob-ceiling check (<= 0.33), not a band around the measured value — the selection-confounded magnitude is deliberately not pinned (fix-round Q5)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${CHURN_CTE}
SELECT CASE WHEN early_guild = 0 AND early_deaths >= ${DEATH_SPIRAL_MIN_DEATHS} THEN 'spiral' WHEN early_guild > 0 THEN 'guild' ELSE 'other' END AS grp,
count(*) AS user_count, avg(post_events)::DOUBLE / nullif(avg(pre_events), 0) AS post_pre
FROM flags GROUP BY 1`,
				},
				select: {
					spiral: { where: { grp: "spiral" } },
					other: { where: { grp: "other" } },
				},
				expect: { metric: "spiral.user_count / other.user_count", op: "between", target: [0.07, 0.15] },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${CHURN_CTE}
SELECT CASE WHEN early_guild = 0 AND early_deaths >= ${DEATH_SPIRAL_MIN_DEATHS} THEN 'spiral' WHEN early_guild > 0 THEN 'guild' ELSE 'other' END AS grp,
count(*) AS user_count, avg(post_events)::DOUBLE / nullif(avg(pre_events), 0) AS post_pre
FROM flags GROUP BY 1`,
				},
				select: {
					spiral: { where: { grp: "spiral" } },
					other: { where: { grp: "other" } },
				},
				// Fix-round Q5 (S1): demoted from a measurement-wrapped band
				// ([0.06, 0.18], centered on the observed 0.113) to a knob-honest
				// ceiling check. The only knob-derivable bound is the ceiling:
				// dropping DEATH_SPIRAL_DROP_LIKELIHOOD=70% of post-week-1 events
				// caps the contrast at the 0.3 keep-rate (+10% tolerance = 0.33).
				// How far BELOW the keep-rate it lands is selection-confounded
				// (qualifying on 3+ early deaths picks front-loaded players) and
				// deliberately not pinned. Passing a bound reads STRONG by design
				// (SPEC P3.2) — this story no longer claims NAILED precision on
				// the attenuated magnitude.
				expect: { metric: "spiral.post_pre / other.post_pre", op: "<=", target: (1 - DEATH_SPIRAL_DROP_LIKELIHOOD / 100) * 1.1 },
				minCohort: 100,
			},
		],
	},
	{
		id: "H5-lucky-charm",
		hook: "H5",
		archetype: "cohort-prop-scale",
		narrative: `Lucky Charm Pack buyers (~8% of users) get ${LUCKY_CHARM_PRICE_MULT}x price_usd on all real-money purchases plus a ${LUCKY_CHARM_BONUS_PURCHASE_LIKELIHOOD}% bonus high-ticket purchase clone per item purchased. Measured among NON-whales (Hook 10's 1.8x hits both sides): 3.4x — the ${LUCKY_CHARM_PRICE_MULT}x organic floor plus the bonus-clone mixture (~65% of buyer purchase rows are premium-price clones)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH lucky AS (SELECT DISTINCT user_id FROM ${EV} WHERE event = 'real money purchase' AND product = 'Lucky Charm Pack')
SELECT CASE WHEN e.user_id IN (SELECT user_id FROM lucky) THEN 'lucky' ELSE 'organic' END AS grp,
avg(e.price_usd) AS avg_price, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e
WHERE e.event = 'real money purchase' AND e.price_usd IS NOT NULL
  AND substr(e.user_id::VARCHAR, 1, 1) NOT IN ${WHALE_CHARS}
GROUP BY 1`,
				},
				select: {
					lucky: { where: { grp: "lucky" } },
					organic: { where: { grp: "organic" } },
				},
				// floor = the raw knob (every buyer purchase is at least 2.5x);
				// ceiling 4.0 bounds the clone mixture
				expect: { metric: "lucky.avg_price / organic.avg_price", op: "between", target: [LUCKY_CHARM_PRICE_MULT * 1.12, 4.0] },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH lucky AS (SELECT DISTINCT user_id FROM ${EV} WHERE event = 'real money purchase' AND product = 'Lucky Charm Pack'),
au AS (SELECT DISTINCT user_id FROM ${EV} WHERE user_id IS NOT NULL)
SELECT CASE WHEN au.user_id IN (SELECT user_id FROM lucky) THEN 'lucky' ELSE 'rest' END AS grp, count(*) AS user_count
FROM au GROUP BY 1`,
				},
				select: {
					lucky: { where: { grp: "lucky" } },
					rest: { where: { grp: "rest" } },
				},
				// buyer share is organic (product enum pick on item-purchased
				// volume) — measured 8.4% of users
				expect: { metric: "lucky.user_count / rest.user_count", op: "between", target: [0.06, 0.12] },
				minCohort: 100,
			},
		],
	},
	{
		id: "H6-strategic-explorers",
		hook: "H6",
		archetype: "cohort-count-scale",
		narrative: `strategic players (${STRATEGIC_MIN_EACH}+ inspect AND ${STRATEGIC_MIN_EACH}+ search for clues, ~42% of users) get ${STRATEGIC_COMPLETION_LIKELIHOOD}% of non-completed dungeon exits flipped and ${STRATEGIC_TREASURE_MULT}x treasure_value. Treasure band [${(STRATEGIC_TREASURE_MULT / PREP_TREASURE_BOOST).toFixed(2)}, ${STRATEGIC_TREASURE_MULT}]: Hook 13's ${PREP_TREASURE_BOOST}x sweet-band boost lands mostly in the control cohort`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH cnt AS (${CNT_CTE})
SELECT CASE WHEN ins >= ${STRATEGIC_MIN_EACH} AND sea >= ${STRATEGIC_MIN_EACH} THEN 'strategic' ELSE 'rest' END AS grp, count(*) AS user_count
FROM cnt GROUP BY 1`,
				},
				select: {
					strategic: { where: { grp: "strategic" } },
					rest: { where: { grp: "rest" } },
				},
				expect: { metric: "strategic.user_count / rest.user_count", op: "between", target: [0.58, 0.88] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH cnt AS (${CNT_CTE})
SELECT CASE WHEN c.ins >= ${STRATEGIC_MIN_EACH} AND c.sea >= ${STRATEGIC_MIN_EACH} THEN 'strategic' ELSE 'rest' END AS grp,
avg(e.treasure_value) AS avg_treasure, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e JOIN cnt c ON e.user_id::VARCHAR = c.uid
WHERE e.event = 'find treasure' AND e.treasure_value IS NOT NULL GROUP BY 1`,
				},
				select: {
					strategic: { where: { grp: "strategic" } },
					rest: { where: { grp: "rest" } },
				},
				expect: { metric: "strategic.avg_treasure / rest.avg_treasure", op: "between", target: [STRATEGIC_TREASURE_MULT / PREP_TREASURE_BOOST, STRATEGIC_TREASURE_MULT] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH cnt AS (${CNT_CTE})
SELECT CASE WHEN c.ins >= ${STRATEGIC_MIN_EACH} AND c.sea >= ${STRATEGIC_MIN_EACH} THEN 'strategic' ELSE 'rest' END AS grp,
(count(*) FILTER (WHERE e.event = 'exit dungeon' AND e.completion_status = 'completed'))::DOUBLE
  / nullif(count(*) FILTER (WHERE e.event = 'exit dungeon'), 0) AS completion,
count(DISTINCT e.user_id) FILTER (WHERE e.event = 'exit dungeon') AS user_count
FROM ${EV} e JOIN cnt c ON e.user_id::VARCHAR = c.uid GROUP BY 1`,
				},
				select: { strategic: { where: { grp: "strategic" } } },
				// flip knob 85% on the ~1/3 organic non-completed share →
				// completion >= 1 - 0.15 * (2/3) = 0.90; tier flips push it higher
				expect: { metric: "strategic.completion", op: ">=", target: 0.9, floor: 0.85 },
				minCohort: 300,
			},
		],
	},
	{
		id: "H7-shadowmourne",
		hook: "H7",
		archetype: "temporal-inflection",
		narrative: `zero Shadowmourne drops before dataset day ${LEGENDARY_RELEASE_DAY}; one per-player roll at ${LEGENDARY_DROP_LIKELIHOOD}%; owners get ${LEGENDARY_WIN_LIKELIHOOD}% of non-victory combats flipped (win rate ≈ 0.96 with tier flips) and ${LEGENDARY_DUNGEON_SPEED_MULT}x dungeon time`,
		assertions: [
			{
				// hard release gate: no drops before day 45
				breakdown: {
					type: "duckdb",
					sql: `WITH start AS (SELECT min(time::TIMESTAMP) AS t0 FROM ${EV})
SELECT 'drops' AS grp,
 count(*) FILTER (WHERE time::TIMESTAMP < (SELECT t0 FROM start) + INTERVAL ${LEGENDARY_RELEASE_DAY} DAY) AS pre_release,
 count(*) AS event_count
FROM ${EV} WHERE event = 'find treasure' AND treasure_type = 'Shadowmourne Legendary'`,
				},
				select: { drops: { where: { grp: "drops" } } },
				expect: { metric: "drops.pre_release", op: "between", target: [0, 0.5] },
			},
			{
				// adoption ≈ LEGENDARY_DROP_LIKELIHOOD/100 among post-release
				// treasure finders (binomial band around 0.02)
				breakdown: {
					type: "duckdb",
					sql: `WITH own AS (SELECT DISTINCT user_id FROM ${EV} WHERE event = 'find treasure' AND treasure_type = 'Shadowmourne Legendary'),
elig AS (SELECT DISTINCT user_id FROM ${EV} WHERE event = 'find treasure'
  AND time::TIMESTAMP > (SELECT min(time::TIMESTAMP) FROM ${EV}) + INTERVAL ${LEGENDARY_RELEASE_DAY} DAY)
SELECT 'adopt' AS grp,
 (SELECT count(*) FROM own) AS owners,
 (SELECT count(*) FROM own)::DOUBLE / nullif((SELECT count(*) FROM elig), 0) AS adoption,
 (SELECT count(*) FROM elig) AS user_count`,
				},
				select: { adopt: { where: { grp: "adopt" } } },
				expect: { metric: "adopt.adoption", op: "between", target: [0.012, 0.032] },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH own AS (SELECT DISTINCT user_id FROM ${EV} WHERE event = 'find treasure' AND treasure_type = 'Shadowmourne Legendary'),
wr AS (SELECT user_id, (count(*) FILTER (WHERE outcome = 'Victory'))::DOUBLE / count(*) AS w
  FROM ${EV} WHERE event = 'combat completed' GROUP BY 1)
SELECT CASE WHEN wr.user_id IN (SELECT user_id FROM own) THEN 'owner' ELSE 'rest' END AS grp,
avg(w) AS win_rate, count(*) AS user_count FROM wr GROUP BY 1`,
				},
				select: { owner: { where: { grp: "owner" } } },
				// LEGENDARY_WIN_LIKELIHOOD = 90% flip of losses → win rate floor
				// 0.9; tier flips stack on top (measured 0.963)
				expect: { metric: "owner.win_rate", op: ">=", target: LEGENDARY_WIN_LIKELIHOOD / 100, floor: 0.85 },
				// ~200 owners at 10K users; WEAK-caps at reduced-scale iteration
				minCohort: 100,
			},
		],
	},
	{
		id: "H8-subscriber-tiers",
		hook: "H8",
		archetype: "cohort-prop-scale",
		narrative: `subscription_tier 60/20/20 Free/Premium/Elite. Rewards: Elite ${ELITE_REWARD_MULT}x, Premium ${PREMIUM_REWARD_MULT}x (other multipliers are tier-independent and cancel between tiers). Completion follows f + (1-f)*flip from the observed Free baseline f — flip knobs ${PREMIUM_COMPLETION_LIKELIHOOD}%/${ELITE_COMPLETION_LIKELIHOOD}%`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT subscription_tier AS tier, avg(reward_gold) AS avg_gold, count(DISTINCT user_id) AS user_count
FROM ${EV} WHERE event = 'quest turned in' AND reward_gold IS NOT NULL GROUP BY 1`,
				},
				select: {
					elite: { where: { tier: "Elite" } },
					free: { where: { tier: "Free" } },
				},
				expect: { metric: "elite.avg_gold / free.avg_gold", op: ">=", target: ELITE_REWARD_MULT, floor: 1.6 },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT subscription_tier AS tier, avg(reward_gold) AS avg_gold, count(DISTINCT user_id) AS user_count
FROM ${EV} WHERE event = 'quest turned in' AND reward_gold IS NOT NULL GROUP BY 1`,
				},
				select: {
					premium: { where: { tier: "Premium" } },
					free: { where: { tier: "Free" } },
				},
				expect: { metric: "premium.avg_gold / free.avg_gold", op: ">=", target: PREMIUM_REWARD_MULT, floor: 1.25 },
				minCohort: 200,
			},
			{
				// completion is a FLIP (not a multiplier), so the prediction runs
				// through the observed Free baseline: tier = f + (1-f) * flip.
				// Measured at iteration: f=0.682 → pred Premium 0.825 / Elite 0.889
				// vs observed 0.819 / 0.896 (<1% error).
				breakdown: {
					type: "duckdb",
					sql: `SELECT subscription_tier AS tier,
 (count(*) FILTER (WHERE event = 'exit dungeon' AND completion_status = 'completed'))::DOUBLE
   / nullif(count(*) FILTER (WHERE event = 'exit dungeon'), 0) AS completion,
 count(DISTINCT user_id) FILTER (WHERE event = 'exit dungeon') AS user_count
FROM ${EV} GROUP BY 1`,
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map((r) => [r.tier, r]));
					const f = by.Free, p = by.Premium, el = by.Elite;
					if (!f || !p || !el) return { pass: false, verdict: "NONE", detail: `missing tier rows (${Object.keys(by).join(",")})` };
					const predP = f.completion + (1 - f.completion) * (PREMIUM_COMPLETION_LIKELIHOOD / 100);
					const predE = f.completion + (1 - f.completion) * (ELITE_COMPLETION_LIKELIHOOD / 100);
					const errP = Math.abs(p.completion / predP - 1);
					const errE = Math.abs(el.completion / predE - 1);
					const smallest = Math.min(f.user_count, p.user_count, el.user_count);
					let detail = `Free=${f.completion.toFixed(3)} Premium=${p.completion.toFixed(3)}/pred ${predP.toFixed(3)} Elite=${el.completion.toFixed(3)}/pred ${predE.toFixed(3)}`;
					let verdict;
					if (errP <= 0.1 && errE <= 0.1) verdict = "NAILED";
					else if (errP <= 0.2 && errE <= 0.2) verdict = "STRONG";
					else if (el.completion > p.completion && p.completion > f.completion) verdict = "WEAK";
					else verdict = "INVERSE";
					if ((verdict === "NAILED" || verdict === "STRONG") && smallest < 200) {
						verdict = "WEAK";
						detail += ` — capped: smallest cohort ${smallest} < minCohort 200`;
					}
					return { pass: verdict === "NAILED" || verdict === "STRONG", verdict, detail };
				},
			},
		],
	},
	{
		id: "H9-level-gold-scaling",
		hook: "H9",
		archetype: "cohort-prop-scale",
		narrative: `quest reward_gold *= (1 + level * ${LEVEL_GOLD_SCALING}). Formula check: hi-bucket (level 13+) vs lo-bucket (level 1-5) gold ratio must match (1 + ${LEVEL_GOLD_SCALING}*mean_hi)/(1 + ${LEVEL_GOLD_SCALING}*mean_lo) computed from the buckets' own quest-weighted mean levels — measured 1.948 vs predicted 1.935 (0.7% error). Tier/compass multipliers are level-independent and cancel`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH lvl AS (SELECT distinct_id::VARCHAR AS uid, level FROM ${US})
SELECT CASE WHEN l.level <= 5 THEN 'lo' WHEN l.level >= 13 THEN 'hi' ELSE 'mid' END AS bucket,
avg(l.level) AS mean_level, avg(e.reward_gold) AS avg_gold, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e JOIN lvl l ON e.user_id::VARCHAR = l.uid
WHERE e.event = 'quest turned in' AND e.reward_gold IS NOT NULL GROUP BY 1`,
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map((r) => [r.bucket, r]));
					const lo = by.lo, hi = by.hi;
					if (!lo || !hi) return { pass: false, verdict: "NONE", detail: "missing level buckets" };
					// quest-weighted mean level is the right predictor: each quest's
					// gold is scaled by its own user's level, so E[gold] per bucket
					// = E[base] * (1 + 0.15 * E_rows[level])
					const predicted = (1 + LEVEL_GOLD_SCALING * hi.mean_level) / (1 + LEVEL_GOLD_SCALING * lo.mean_level);
					const observed = hi.avg_gold / lo.avg_gold;
					return ratioVerdict(observed / predicted, 1, 0.85,
						`hi(mean lvl ${hi.mean_level.toFixed(1)})/lo(${lo.mean_level.toFixed(1)}) gold ratio ${observed.toFixed(3)} vs formula ${predicted.toFixed(3)}`,
						Math.min(lo.user_count, hi.user_count), 150);
				},
			},
		],
	},
	{
		id: "H10-whale-purchases",
		hook: "H10",
		archetype: "cohort-prop-scale",
		narrative: `whales (first hex char of user_id with charCodeAt % 3 == 0 → '0','3','6','9','c','f' = 6/16 = 37.5% of users) get ${WHALE_PRICE_MULT}x price_usd. Measured among NON-Lucky-Charm users — Hook 5's high-ticket clones contaminate the unscoped ratio to ~2.0`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH lucky AS (SELECT DISTINCT user_id FROM ${EV} WHERE event = 'real money purchase' AND product = 'Lucky Charm Pack')
SELECT CASE WHEN substr(e.user_id::VARCHAR, 1, 1) IN ${WHALE_CHARS} THEN 'whale' ELSE 'rest' END AS grp,
avg(e.price_usd) AS avg_price, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e
WHERE e.event = 'real money purchase' AND e.price_usd IS NOT NULL
  AND e.user_id NOT IN (SELECT user_id FROM lucky)
GROUP BY 1`,
				},
				select: {
					whale: { where: { grp: "whale" } },
					rest: { where: { grp: "rest" } },
				},
				expect: { metric: "whale.avg_price / rest.avg_price", op: ">=", target: WHALE_PRICE_MULT, floor: 1.55 },
				minCohort: 150,
			},
			{
				// hash share: 6/16 = 0.375 of users → whale/rest = 0.6 exactly
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN substr(distinct_id::VARCHAR, 1, 1) IN ${WHALE_CHARS} THEN 'whale' ELSE 'rest' END AS grp, count(*) AS user_count
FROM ${US} GROUP BY 1`,
				},
				select: {
					whale: { where: { grp: "whale" } },
					rest: { where: { grp: "rest" } },
				},
				expect: { metric: "whale.user_count / rest.user_count", op: "between", target: [0.52, 0.7] },
				minCohort: 300,
			},
		],
	},
	{
		id: "H11-alignment-archetype",
		hook: "H11",
		archetype: "bespoke",
		narrative: `archetype is a deterministic function of the alignment user prop: Lawful/Neutral Good → hero, Chaotic/Neutral Evil → villain, else neutral. Mapping must be EXACT (hero count == LG+NG count); shares ≈ 26/25/49 at this seed (uniform 9-way alignment would give 22/22/56)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
 count(*) FILTER (WHERE alignment IN ('Lawful Good', 'Neutral Good')) AS good_aligns,
 count(*) FILTER (WHERE archetype = 'hero') AS heroes,
 count(*) FILTER (WHERE alignment IN ('Chaotic Evil', 'Neutral Evil')) AS evil_aligns,
 count(*) FILTER (WHERE archetype = 'villain') AS villains,
 count(*) FILTER (WHERE archetype = 'neutral') AS neutrals,
 count(*) AS user_count
FROM ${US}`,
				},
				assert: (rows) => {
					const r = rows && rows[0];
					if (!r || !Number(r.user_count)) return { pass: false, verdict: "NONE", detail: "no profile rows" };
					const exact = Number(r.heroes) === Number(r.good_aligns) && Number(r.villains) === Number(r.evil_aligns);
					const hs = r.heroes / r.user_count, vs = r.villains / r.user_count, ns = r.neutrals / r.user_count;
					const sharesOk = hs >= 0.2 && hs <= 0.3 && vs >= 0.2 && vs <= 0.3 && ns >= 0.42 && ns <= 0.58;
					const detail = `hero ${r.heroes} vs good ${r.good_aligns}; villain ${r.villains} vs evil ${r.evil_aligns}; shares h=${hs.toFixed(3)} v=${vs.toFixed(3)} n=${ns.toFixed(3)}`;
					const verdict = exact && sharesOk ? "NAILED" : exact ? "STRONG" : "INVERSE";
					return { pass: exact, verdict, detail };
				},
			},
		],
	},
	{
		id: "H12-combat-ttc-by-tier",
		hook: "H12",
		archetype: "funnel-ttc-by-segment",
		narrative: `combat funnel (combat initiated → combat completed → use item) inter-step gaps scaled per tier: Elite x${TTC_ELITE_FACTOR}, Premium x${TTC_PREMIUM_FACTOR}, Free x${TTC_FREE_FACTOR} → median TTC ratios Free/Premium = ${(TTC_FREE_FACTOR / TTC_PREMIUM_FACTOR).toFixed(2)}, Premium/Elite = ${(TTC_PREMIUM_FACTOR / TTC_ELITE_FACTOR).toFixed(2)}. Median, not avg — greedy cross-session matches make the mean heavy-tailed`,
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["combat initiated", "combat completed", "use item"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: 6 * 3600000,
				},
				select: {
					free: { where: { segment_value: "Free" } },
					premium: { where: { segment_value: "Premium" } },
				},
				expect: { metric: "free.median_ttc_ms / premium.median_ttc_ms", op: ">=", target: TTC_FREE_FACTOR / TTC_PREMIUM_FACTOR, floor: 1.6 },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["combat initiated", "combat completed", "use item"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: 6 * 3600000,
				},
				select: {
					premium: { where: { segment_value: "Premium" } },
					elite: { where: { segment_value: "Elite" } },
				},
				expect: { metric: "premium.median_ttc_ms / elite.median_ttc_ms", op: ">=", target: TTC_PREMIUM_FACTOR / TTC_ELITE_FACTOR, floor: 1.8 },
				minCohort: 100,
			},
		],
	},
	{
		id: "H13-prep-magic-number",
		hook: "H13",
		archetype: "frequency-sweet-spot",
		narrative: `${PREP_SWEET_MIN}-${PREP_SWEET_MAX} preps (inspect + search for clues) between first quest-accepted and first fight-boss → ${PREP_TREASURE_BOOST}x treasure_value; ${PREP_OVER_THRESHOLD}+ preps → ${PREP_BOSS_FLIP_LIKELIHOOD}% of boss victories flip to defeat. Treasure measured among NON-strategic users (Hook 6's 2x concentrates in high-prep bands and swamps the unscoped ratio); the boss-win contrast needs no scoping (Hook 6 does not touch victory)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH cnt AS (${CNT_CTE}),
nonstrat AS (SELECT uid FROM cnt WHERE NOT (ins >= ${STRATEGIC_MIN_EACH} AND sea >= ${STRATEGIC_MIN_EACH})),
${PREP_CTE}
SELECT b.band AS grp, avg(e.treasure_value) AS avg_treasure, count(DISTINCT e.user_id) AS user_count
FROM bands b JOIN ${EV} e USING (user_id)
WHERE e.event = 'find treasure' AND e.treasure_value IS NOT NULL
  AND b.user_id::VARCHAR IN (SELECT uid FROM nonstrat)
GROUP BY 1`,
				},
				select: {
					sweet: { where: { grp: "sweet" } },
					low: { where: { grp: "low" } },
				},
				expect: { metric: "sweet.avg_treasure / low.avg_treasure", op: ">=", target: PREP_TREASURE_BOOST, floor: 1.15 },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${PREP_CTE}
SELECT b.band AS grp,
 (count(*) FILTER (WHERE e.event = 'fight boss' AND e.victory = true))::DOUBLE
   / nullif(count(*) FILTER (WHERE e.event = 'fight boss'), 0) AS boss_win,
 count(DISTINCT e.user_id) AS user_count
FROM bands b JOIN ${EV} e USING (user_id) GROUP BY 1`,
				},
				select: {
					over: { where: { grp: "over" } },
					sweet: { where: { grp: "sweet" } },
				},
				// flipping 25% of over-band victories scales its win rate by 0.75
				// relative to sweet's; floor 0.85 = STRONG bound
				expect: { metric: "over.boss_win / sweet.boss_win", op: "<=", target: 1 - PREP_BOSS_FLIP_LIKELIHOOD / 100, floor: 0.85 },
				minCohort: 150,
			},
		],
	},
];

export default config;
