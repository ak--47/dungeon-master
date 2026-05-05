// ── TWEAK THESE ──
const SEED = "questforge";
const num_days = 120;
const num_users = 10_000;
const avg_events_per_user_per_day = 1.2;
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
 * ═══════════════════════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * QuestForge — a D&D-inspired action RPG with a deep character system, party-
 * based dungeon crawls, boss fights, a player-driven economy, guilds, and
 * subscription tiers. Combines the strategic depth of a tabletop RPG with the
 * monetization and engagement loops of a modern live-service game.
 *
 * CORE LOOP: Players create characters (12 classes, 9 races, 9 alignments,
 * 13 backgrounds) and progress through quests, dungeon crawls, boss fights,
 * and combat encounters. Strategic preparation (inspect, search for clues,
 * Ancient Compass) creates skill gaps. Guild membership drives social
 * retention. Monetization via premium currency, lucky charms, season pass,
 * and subscription tiers (Free / Premium / Elite).
 *
 * SCALE: 5,000 users × 120 events = 600K events over 100 days
 * 24 event types, 7 funnels, guild group analytics, subscription tiers
 *
 * KEY SYSTEMS:
 * - Character: 12 D&D classes, 9 races, 9 alignments, 13 backgrounds
 * - Quests: accept → objective → turn in (5 quest types, gold/XP rewards)
 * - Dungeons: enter → find treasure → exit (50 dungeons, party-based, 3 outcomes)
 * - Combat: initiate → complete (6 enemy types), boss fights, attack/defend
 * - Economy: item purchase/sell, real money purchases, vendor types
 * - Progression: level up (1-50), stat points, level-scaled rewards
 * - Social: guild join/leave (5-100 members, guild levels 1-20)
 * - Monetization: premium currency, lucky charms, legendary chests, season pass
 * - Subscriptions: Free / Premium ($9.99/mo) / Elite ($19.99/mo)
 * - Experiments: A/B/C/Control variants across "fast leveling", "tension
 *   economy", "free trial"
 */

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (13 hooks)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable via
 * behavioral cohorts (count event per user), raw-prop breakdowns
 * (treasure_type, subscription_tier, day-of-user-life), or funnel time-to-convert.
 *
 * 1. CONVERSION: Ancient Compass Effect
 *    Players who use the "Ancient Compass" item earn 1.5x quest reward_gold
 *    and reward_xp on subsequent quest-turned-in events.
 *    → Mixpanel: Cohort A = users who fired "use item" with item_type="Ancient Compass"
 *    → Compare avg reward_gold / reward_xp on "quest turned in" between A and rest
 *    → Expected: A ~ 1.5x rest
 *
 * 2. TIME-BASED: Cursed Week (days 40-47 of user life)
 *    Death rates spike heavily during the user's days 40-47 (relative to their
 *    first event). Injected deaths carry cause_of_death="Curse".
 *    → Mixpanel: Chart "player death" count by day-of-user-life
 *    → Filter cause_of_death = "Curse" — clear cluster in user's days 40-47
 *
 * 3. RETENTION: Early Guild Joiners
 *    Players who fire "guild joined" within first 3 days get extra cloned
 *    "combat completed" events; non-joiners with 3+ early deaths churn.
 *    → Mixpanel: Cohort users who did "guild joined" within first 3 days
 *    → Compare D30 retention vs other users — early joiners retain higher
 *
 * 4. CHURN: Death Spiral
 *    Players with 3+ "player death" events in first 7 days lose 70% of their
 *    post-week-1 events.
 *    → Mixpanel: Bucket users by count of "player death" in first 7 days
 *    → Compare event volume after day 7 — 3+ deaths bucket has ~30% baseline
 *
 * 5. PURCHASE VALUE: Lucky Charm LTV
 *    Users who purchase "Lucky Charm Pack" get 2x price_usd on subsequent
 *    real-money purchases under $49.99 + 35% chance of bonus cloned purchase.
 *    → Mixpanel: Cohort A = users with any "real money purchase" where product="Lucky Charm Pack"
 *    → Compare avg price_usd and total revenue between A and rest
 *    → Expected: A ~ 1.5x avg purchase price
 *
 * 6. STRATEGIC EXPLORERS (BEHAVIORS TOGETHER — everything)
 *
 *    PATTERN: Players who fire BOTH "inspect" AND "search for clues" events
 *    have 85% dungeon completion (vs 45% baseline) and earn 2x treasure value.
 *    No flag — derive cohort by joining users who did both event types.
 *
 *    HOW TO FIND IT IN MIXPANEL:
 *
 *      Report 1: Dungeon Completion by Strategic Cohort
 *      - Cohort A: users who fired BOTH "inspect" AND "search for clues"
 *      - Cohort B: rest
 *      - Event: "exit dungeon"
 *      - Filter: completion_status = "completed", divide by total exit dungeon
 *      - Expected: A ~ 85% completion vs B ~ 45%
 *
 *      Report 2: Treasure Value by Strategic Cohort
 *      - Cohort A vs B (as above)
 *      - Event: "find treasure"
 *      - Measure: Average of "treasure_value"
 *      - Expected: A ~ 2x B
 *
 *    REAL-WORLD ANALOGUE: Players who scout and prepare before encounters
 *    consistently outperform those who rush in.
 *
 * 7. SHADOWMOURNE LEGENDARY WEAPON (TIMED RELEASE — event)
 *
 *    PATTERN: At day 45, the "Shadowmourne Legendary" weapon releases.
 *    2% of players find it after release. Equipped wielders get 90%
 *    combat win rate (vs 60%) and complete dungeons 40% faster.
 *
 *    HOW TO FIND IT IN MIXPANEL:
 *
 *      Report 1: Legendary Drop Adoption Over Time
 *      - Report type: Insights
 *      - Event: "find treasure"
 *      - Measure: Total
 *      - Filter: treasure_type = "Shadowmourne Legendary"
 *      - Line chart by day
 *      - Expected: zero before day 45, then small steady stream after
 *
 *      Report 2: Combat Win Rate by Legendary Cohort
 *      - Cohort A: users who fired "find treasure" with treasure_type="Shadowmourne Legendary"
 *      - Cohort B: rest
 *      - Event: "combat completed"
 *      - Measure: count where outcome="Victory" / total combat completed
 *      - Expected: A ~ 90% wins vs B ~ baseline
 *
 *    REAL-WORLD ANALOGUE: Patch-day legendary drops create a small power-
 *    user cohort that dominates leaderboards and PvP for weeks after.
 *
 * 8. PREMIUM / ELITE SUBSCRIBER ADVANTAGE (SUBSCRIPTION TIER — everything)
 *
 *    PATTERN: Premium subscribers get 50% better combat wins, 1.4x rewards,
 *    45% higher dungeon completion. Elite subscribers get 70% better combat
 *    wins, 1.8x rewards, 65% higher dungeon completion, bonus treasure events,
 *    and reduced death rates. No flag — discover via subscription_tier breakdown.
 *
 *    HOW TO FIND IT IN MIXPANEL:
 *
 *      Report 1: Quest Rewards by Subscription Tier
 *      - Report type: Insights
 *      - Event: "quest turned in"
 *      - Measure: Average of "reward_gold"
 *      - Breakdown: "subscription_tier"
 *      - Expected: Premium ~ 1.4x, Elite ~ 1.8x vs Free baseline
 *
 *      Report 2: Dungeon Completion by Tier
 *      - Report type: Insights
 *      - Event: "exit dungeon"
 *      - Measure: completion_status="completed" / total exit dungeon
 *      - Breakdown: "subscription_tier"
 *      - Expected: Free ~ 45%, Premium ~ 65%, Elite ~ 75%
 *
 *    REAL-WORLD ANALOGUE: Subscription tiers in live-service games confer
 *    XP/loot/rest bonuses that translate into measurable progress speed.
 *
 * 9. GOLD REWARD BY LEVEL (PROGRESSION SCALING — everything)
 *
 *    PATTERN: Quest gold reward scales with player level using
 *    reward_gold *= (1 + level * 0.15). Level-10 earns ~2.5x, level-20
 *    earns ~4x vs level-1. No flag — discover via user-property level breakdown.
 *
 *    HOW TO FIND IT IN MIXPANEL:
 *
 *      Report 1: Avg Gold per Quest by Player Level
 *      - Report type: Insights
 *      - Event: "quest turned in"
 *      - Measure: Average of "reward_gold"
 *      - Breakdown: user property "level" (bucketed)
 *      - Expected: linear ramp; level-10 ~ 2.5x, level-20 ~ 4x vs level-1
 *
 *    REAL-WORLD ANALOGUE: Quest economies scale rewards with player level
 *    so high-level zones remain meaningfully lucrative.
 *
 * 10. WHALE PURCHASES (TOP-SPENDER COHORT — everything)
 *
 *     PATTERN: ~33% of users (deterministic via user_id char % 3 hash) are
 *     "whales" who get 1.8x price_usd on real money purchases. No flag —
 *     derive cohort by ranking users by total purchase volume.
 *
 *     HOW TO FIND IT IN MIXPANEL:
 *
 *       Report 1: Avg Purchase by Spend Decile
 *       - Cohort A: top 33% of users by SUM(price_usd) on "real money purchase"
 *       - Cohort B: rest
 *       - Event: "real money purchase"
 *       - Measure: Average of "price_usd"
 *       - Expected: A ~ 1.8x B
 *
 *       Report 2: Revenue Concentration
 *       - Sum price_usd by user, plot distribution
 *       - Expected: ~33% of users contribute the majority of revenue
 *
 *     REAL-WORLD ANALOGUE: A small cohort of high-spending players
 *     ("whales") accounts for the majority of mobile-game revenue.
 *
 * 11. HERO / VILLAIN / NEUTRAL ARCHETYPE (USER ENRICHMENT — user)
 *
 *     PATTERN: User profiles are enriched with an "archetype" derived
 *     from D&D alignment: Good -> "hero" (~22%), Evil -> "villain" (~22%),
 *     other -> "neutral" (~56%).
 *
 *     HOW TO FIND IT IN MIXPANEL:
 *
 *       Report 1: User Distribution by Archetype
 *       - Report type: Insights
 *       - Event: any event
 *       - Measure: Total unique users
 *       - Breakdown: "archetype" (user property)
 *       - Expected: hero ~ 22%, villain ~ 22%, neutral ~ 56%
 *
 *       Report 2: Engagement by Archetype
 *       - Report type: Insights
 *       - Event: any event
 *       - Measure: Total per user (average)
 *       - Breakdown: "archetype"
 *       - Expected: similar volume per user across archetypes
 *
 *     REAL-WORLD ANALOGUE: Player-character moral alignment is a useful
 *     audience segmentation lens for narrative design and content tuning.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 12. COMBAT FUNNEL TIME-TO-CONVERT (everything)
 *
 *     PATTERN: Elite tier completes the Combat funnel ~3.3x faster (factor
 *     0.30); Free tier ~1.4x slower (factor 1.40). Finds combat funnel
 *     sequences (combat initiated → combat completed → use item) and scales
 *     the inter-step time gaps in the everything hook.
 *
 *     HOW TO FIND IT IN MIXPANEL:
 *
 *       Report 1: Combat Funnel Median Time-to-Convert by Tier
 *       - Funnels > "combat initiated" -> "combat completed" -> "use item"
 *       - Measure: Median time to convert
 *       - Breakdown: subscription_tier
 *       - Expected: Elite ~ 0.30x; Free ~ 1.40x vs Premium baseline
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 13. COMBAT-PREP MAGIC NUMBER (in-funnel, everything)
 *
 *     PATTERN: Sweet 3-6 inspect+search-for-clues events between
 *     quest-accepted and fight-boss → +30% on find-treasure
 *     treasure_value. Over 7+ → 25% of fight-boss victories flip to
 *     defeat (analysis paralysis). No flag.
 *
 *     HOW TO FIND IT IN MIXPANEL:
 *
 *       Report 1: Avg Treasure Value by Combat-Prep Bucket
 *       - Cohort A: users with 3-6 inspect+search between quest-accepted and fight-boss
 *       - Cohort B: users with 0-2
 *       - Event: "find treasure"
 *       - Measure: Average of "treasure_value"
 *       - Expected: A ~ 1.3x B
 *
 *       Report 2: Boss Victory Rate on Heavy Preppers
 *       - Cohort C: users with >= 7 prep events
 *       - Cohort A: users with 3-6
 *       - Event: "fight boss"
 *       - Measure: Total filtered to victory=true / Total
 *       - Expected: C ~ 25% lower victory rate
 *
 *     REAL-WORLD ANALOGUE: Calculated prep wins; over-prep is paralysis.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * EXPECTED METRICS SUMMARY
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Hook                  | Metric               | Baseline | Hook Effect | Ratio
 * ----------------------|----------------------|----------|-------------|------
 * Ancient Compass       | Quest reward (compass)| 1x       | 1.5x        | 1.5x
 * Cursed Week           | Death rate days 40-47| 1x       | ~ 5x        | 5x
 * Early Guild Join      | D30 Retention        | 20%      | 80%         | 4x
 * Death Spiral          | Retention (3+ deaths)| 100%     | 30%         | 0.3x
 * Lucky Charm           | Avg purchase amt     | 1x       | 2x          | 2x
 * Strategic Explorer    | Dungeon completion   | 45%      | 85%         | ~ 1.9x
 * Legendary Weapon      | Combat win rate      | 60%      | 90%         | 1.5x
 * Premium Tier          | Quest reward         | 1x       | 1.4x        | 1.4x
 * Elite Tier            | Quest reward         | 1x       | 1.8x        | 1.8x
 * Gold Scaling (lvl 10) | Avg quest gold       | ~ 100    | ~ 250       | 2.5x
 * Whale Purchases       | Avg real money spend | 1x       | 1.8x        | 1.8x
 * Hero/Villain/Neutral  | User share           | --       | 22/22/56%   | n/a
 * Combat T2C            | median min by tier   | 1x       | 0.30/1.40x  | ~ 4.7x range
 * Combat-Prep Magic Num | sweet treasure_value | 1x       | 1.3x        | 1.3x
 * Combat-Prep Magic Num | over boss victory    | 1x       | 0.75x       | -25%
 */

// Generate consistent item/location IDs for lookup tables
const dungeonIds = v.range(1, 51).map(n => `dungeon_${v.uid(6)}`);
const questIds = v.range(1, 201).map(n => `quest_${v.uid(8)}`);
const itemIds = v.range(1, 301).map(n => `item_${v.uid(7)}`);

/** @type {Config} */
const config = {
	version: 2,
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-05-01T23:59:59Z",
	// numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: true,
	avgDevicePerUser: 2,
	hasSessionIds: true,
	format: "json",
	gzip: true,
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
			properties: {
				"dungeon_id": dungeonIds,
				"time_spent_mins": u.weighNumRange(5, 120, 0.6, 30),
				"completion_status": ["completed", "abandoned", "died"],
			}
		},
		{
			event: "find treasure",
			weight: 16,
			properties: {
				"treasure_type": ["Gold", "Weapon", "Armor", "Potion", "Scroll", "Rare Artifact"],
				"treasure_value": u.weighNumRange(5, 1000, 1.2, 50),
			}
		},
		{
			event: "player death",
			weight: 8,
			properties: {
				"cause_of_death": ["Monster", "Trap", "Fall Damage", "Poison", "Friendly Fire"],
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
			properties: {
				"inspect_target": ["NPC", "Monster", "Treasure Chest", "Door", "Statue", "Bookshelf"],
			}
		},
		{
			event: "search for clues",
			weight: 8,
			properties: {
				"location_type": ["Dungeon Entrance", "Hidden Room", "Quest Location", "Town Square"],
				"clue_found": [false, false, true, true, true],
			}
		},
		{
			event: "use item",
			weight: 14,
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

	/**
	 * 🎯 ARCHITECTED ANALYTICS HOOKS — 13 patterns
	 *
	 * 1. CONVERSION: Ancient Compass users have 3x quest completion + 1.5x rewards
	 * 2. TIME-BASED: "Cursed Week" (days 40-47) has 5x death rates
	 * 3. RETENTION: Early guild joiners (first 3 days) have 80% D30 retention vs 20%
	 * 4. CHURN: Players with 3+ deaths in first week have 70% churn rate
	 * 5. PURCHASE VALUE: Lucky Charm buyers spend 5x more (LTV pattern)
	 * 6. BEHAVIORS TOGETHER: inspect + search before dungeon = 85% completion vs 45%
	 * 7. TIMED RELEASE: Legendary weapon released day 45, early adopters dominate
	 * 8. SUBSCRIPTION TIER: Premium/Elite users have higher engagement and success
	 * 9. PROGRESSION SCALING: Quest gold scales with player level (1 + level * 0.15)
	 * 10. WHALE PURCHASES: ~33% of users via deterministic hash spend 1.8x more
	 * 11. ALIGNMENT ARCHETYPE: Good=hero, Evil=villain, other=neutral (user hook)
	 * 12. COMBAT FUNNEL TTC: Elite 0.30x faster, Free 1.40x slower combat funnel T2C
	 * 13. COMBAT-PREP MAGIC NUMBER: 3-6 prep events = +30% treasure; 7+ = -25% boss wins
	 */
	hook: function (record, type, meta) {
		// Hook #11: ALIGNMENT ARCHETYPE — derive archetype on user profile
		if (type === "user") {
			if (record.alignment === "Chaotic Evil" || record.alignment === "Neutral Evil") {
				record.archetype = "villain";
			} else if (record.alignment === "Lawful Good" || record.alignment === "Neutral Good") {
				record.archetype = "hero";
			} else {
				record.archetype = "neutral";
			}
		}

		// Hook #2 event-level part removed — cursed week now handled in everything hook

		// Hook #7: TIMED RELEASE — Legendary Weapon
		// (moved to everything hook — event hook fires before bunchIntoSessions
		// reshuffles timestamps, causing tagged events to leak across the d45 boundary)

		// HOOK 12 (T2C): moved to everything hook — funnel-post effects
		// were invisible to SQL verification.

		// Hooks #1, #3, #4, #5, #6, #8, #9, #10: per-user behavioral patterns
		if (type === "everything") {
			const userEvents = record;
			const profile = meta.profile;
			const datasetStart = dayjs.unix(meta.datasetStart);
			const LEGENDARY_WEAPON_RELEASE = datasetStart.add(45, 'days');

			// Stamp superProps from profile for consistency
			userEvents.forEach(e => {
				e.Platform = profile.Platform;
				e.graphics_quality = profile.graphics_quality;
				e.subscription_tier = profile.subscription_tier;
			});

			// Hook #7: TIMED RELEASE — Shadowmourne Legendary post-d45.
			// Runs in everything hook so timestamps are post-bunchIntoSessions.
			userEvents.forEach(e => {
				if (e.event === "find treasure" && dayjs(e.time).isAfter(LEGENDARY_WEAPON_RELEASE) && chance.bool({ likelihood: 2 })) {
					e.treasure_type = "Shadowmourne Legendary";
					e.treasure_value = 50000;
				}
			});

			// Hook #12: COMBAT T2C — scale time gaps in combat funnel
			// sequences (combat initiated → combat completed → use item).
			// Elite ~0.30x (faster), Premium ~0.70x, Free ~1.40x (slower).
			// Finds all 3-step sequences and shifts step 2/3 timestamps.
			const tier = profile.subscription_tier;
			const t2cFactor = (
				tier === "Elite" ? 0.30 :
				tier === "Premium" ? 0.70 :
				tier === "Free" ? 1.40 :
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

			const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;
			const userLevel = profile.level || 1;

			// Track user behaviors
			let usedAncientCompass = false;
			let boughtLuckyCharm = false;
			let joinedGuildEarly = false;
			let earlyDeaths = 0;
			let hasLegendaryWeapon = false;
			let inspectedBeforeDungeon = false;
			let searchedBeforeDungeon = false;
			let subscriptionTier = "Free";

			// Hook #10: Whale segmentation — deterministic via user_id hash (~33%)
			const userId = userEvents.length > 0 ? (userEvents[0].user_id || userEvents[0].distinct_id || "") : "";
			const isWhale = userId.length > 0 && userId.charCodeAt(0) % 3 === 0;

			// First pass: identify user patterns
			userEvents.forEach((event) => {
				const eventTime = dayjs(event.time);
				const daysSinceStart = firstEventTime ? eventTime.diff(firstEventTime, 'days', true) : 0;

				if (event.subscription_tier) {
					subscriptionTier = event.subscription_tier;
				}

				if (event.event === "use item" && event.item_type === "Ancient Compass") {
					usedAncientCompass = true;
				}

				if (event.event === "real money purchase" && event.product === "Lucky Charm Pack") {
					boughtLuckyCharm = true;
				}

				if (event.event === "guild joined" && daysSinceStart < 3) {
					joinedGuildEarly = true;
				}

				if (event.event === "player death" && daysSinceStart < 7) {
					earlyDeaths++;
				}

				if (event.event === "find treasure" && event.treasure_type === "Shadowmourne Legendary") {
					hasLegendaryWeapon = true;
				}

				if (event.event === "inspect") {
					inspectedBeforeDungeon = true;
				}
				if (event.event === "search for clues") {
					searchedBeforeDungeon = true;
				}
			});

			// Second pass: raw mutations + cloning, no flag stamping
			userEvents.forEach((event, idx) => {
				const eventTime = dayjs(event.time);

				// Hook 9: PROGRESSION SCALING — Quest gold scales with level.
				// Power curve so bucket-averaged high-level/low-level ratio >= 2.0x.
				if (event.event === "quest turned in") {
					const baseGold = event.reward_gold || 100;
					event.reward_gold = Math.floor(baseGold * (1 + userLevel * 0.15));
				}

				// Hook 1: CONVERSION — Ancient Compass users earn 1.5x quest
				// rewards plus 40% chance of bonus cloned quest.
				if (usedAncientCompass && event.event === "quest turned in") {
					event.reward_gold = Math.floor((event.reward_gold || 100) * 1.5);
					event.reward_xp = Math.floor((event.reward_xp || 500) * 1.5);

					if (chance.bool({ likelihood: 40 })) {
						userEvents.splice(idx + 1, 0, {
							...event,
							time: eventTime.add(chance.integer({ min: 10, max: 120 }), 'minutes').toISOString(),
							quest_id: chance.pickone(questIds),
							reward_gold: chance.integer({ min: 100, max: 500 }),
							reward_xp: chance.integer({ min: 500, max: 2000 }),
						});
					}
				}

				// Hook 5: PURCHASE VALUE — Lucky charm buyers see 2x prices
				// and 35% chance of bonus high-value cloned purchase.
				if (boughtLuckyCharm) {
					if (event.event === "real money purchase" && event.price_usd) {
						event.price_usd = Math.round(event.price_usd * 2.5 * 100) / 100;
					}
					if (event.event === "item purchased" && chance.bool({ likelihood: 35 })) {
						const purchaseTemplate = userEvents.find(e => e.event === "real money purchase");
						if (purchaseTemplate) {
							userEvents.splice(idx + 1, 0, {
								...purchaseTemplate,
								time: eventTime.add(chance.integer({ min: 1, max: 3 }), 'days').toISOString(),
								user_id: event.user_id,
								product: chance.pickone(["Premium Currency (5000)", "Legendary Weapon Chest", "Season Pass"]),
								price_usd: chance.pickone([19.99, 49.99, 99.99]),
								payment_method: chance.pickone(["Credit Card", "PayPal"]),
							});
						}
					}
				}

				// Hook 10: WHALE PURCHASES — 1.8x price for whale cohort.
				if (isWhale && event.event === "real money purchase" && event.price_usd) {
					event.price_usd = Math.round(event.price_usd * 1.8 * 100) / 100;
				}

				// Hook 6: BEHAVIORS TOGETHER — inspect+search dungeons get
				// 85% completion rate + 2x treasure value.
				if (inspectedBeforeDungeon && searchedBeforeDungeon) {
					if (event.event === "exit dungeon" && event.completion_status !== "completed" && chance.bool({ likelihood: 85 })) {
						event.completion_status = "completed";
					}
					if (event.event === "find treasure") {
						event.treasure_value = Math.floor((event.treasure_value || 50) * 2);
					}
				}

				// Hook 7: TIMED RELEASE — Legendary owners get 90% combat
				// wins + 0.6x dungeon time.
				if (hasLegendaryWeapon) {
					if (event.event === "combat completed" && event.outcome !== "Victory" && chance.bool({ likelihood: 90 })) {
						event.outcome = "Victory";
					}
					if (event.event === "exit dungeon") {
						event.completion_status = "completed";
						event.time_spent_mins = Math.floor((event.time_spent_mins || 60) * 0.6);
					}
				}

				// Hook 8: SUBSCRIPTION TIER — Premium/Elite get win+reward+
				// completion+treasure boosts. Reads tier from profile.
				if (subscriptionTier === "Premium" || subscriptionTier === "Elite") {
					const isElite = subscriptionTier === "Elite";
					if (event.event === "combat completed" && event.outcome !== "Victory") {
						const winBoost = isElite ? 70 : 50;
						if (chance.bool({ likelihood: winBoost })) {
							event.outcome = "Victory";
							event.loot_gained = true;
						}
					}
					if (event.event === "quest turned in") {
						const rewardMultiplier = isElite ? 1.8 : 1.4;
						event.reward_gold = Math.floor((event.reward_gold || 100) * rewardMultiplier);
						event.reward_xp = Math.floor((event.reward_xp || 500) * rewardMultiplier);
					}
					if (event.event === "exit dungeon") {
						if (event.completion_status !== "completed") {
							const completionBoost = isElite ? 65 : 45;
							if (chance.bool({ likelihood: completionBoost })) {
								event.completion_status = "completed";
							}
						}
						if (event.completion_status === "completed") {
							const speedBoost = isElite ? 0.7 : 0.85;
							event.time_spent_mins = Math.floor((event.time_spent_mins || 60) * speedBoost);
						}
					}
					if (event.event === "find treasure") {
						const treasureBoost = isElite ? 2.0 : 1.5;
						event.treasure_value = Math.floor((event.treasure_value || 50) * treasureBoost);
					}
					if (event.event === "player death") {
						const survivalLikelihood = isElite ? 50 : 30;
						if (chance.bool({ likelihood: survivalLikelihood })) {
							event.event = "combat completed";
							event.outcome = "Victory";
							event.loot_gained = true;
						}
					}
					if (isElite && chance.bool({ likelihood: 5 })) {
						if (event.event === "quest turned in" || event.event === "exit dungeon") {
							const treasureTemplate = userEvents.find(e => e.event === "find treasure");
							if (treasureTemplate) {
								const treasureTypes = ["Rare Artifact", "Gold", "Weapon", "Armor"];
								userEvents.splice(idx + 1, 0, {
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

			// Hook 2: CURSED WEEK — inject extra deaths in days 40-47 of
			// user's timeline. Cause_of_death set to "Curse" on injected.
			// Discover via line-chart of player-death by day-of-user-life.
			if (firstEventTime) {
				const deathTemplate = userEvents.find(e => e.event === "player death");
				if (deathTemplate) {
					const cursedStart = firstEventTime.add(40, 'days');
					const cursedEnd = firstEventTime.add(47, 'days');
					const cursedEvents = userEvents.filter(e => {
						const t = dayjs(e.time);
						return t.isAfter(cursedStart) && t.isBefore(cursedEnd);
					});
					const deathsToInject = Math.floor(cursedEvents.length * 0.6);
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

			// Hook 3 RETENTION + Hook 4 CHURN — early guild-joiners get
			// extra cloned combat events; non-joiners with 3+ deaths in
			// first week lose 70% of post-week events. No flag.
			const shouldChurn = (!joinedGuildEarly && earlyDeaths >= 2) || (earlyDeaths >= 4);
			if (shouldChurn) {
				const firstWeekEnd = firstEventTime ? firstEventTime.add(7, 'days') : null;
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (firstWeekEnd && dayjs(userEvents[i].time).isAfter(firstWeekEnd) && chance.bool({ likelihood: 80 })) {
						userEvents.splice(i, 1);
					}
				}
			} else if (joinedGuildEarly) {
				const lastEvent = userEvents[userEvents.length - 1];
				const combatTemplate = userEvents.find(e => e.event === "combat completed");
				if (lastEvent && combatTemplate && chance.bool({ likelihood: 60 })) {
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
				if (prepCount >= 3 && prepCount <= 6) {
					userEvents.forEach(e => {
						if (e.event === "find treasure" && typeof e.treasure_value === "number") {
							e.treasure_value = Math.round(e.treasure_value * 1.3);
						}
					});
				} else if (prepCount >= 7) {
					for (let i = userEvents.length - 1; i >= 0; i--) {
						const ev = userEvents[i];
						if (ev.event === "fight boss" && ev.victory === true && chance.bool({ likelihood: 25 })) {
							ev.victory = false;
						}
					}
				}
			}
		}

		return record;
	}
};

export default config;
