// ── TWEAK THESE ──
const SEED = "questforge";
const num_days = 100;
const num_users = 5_000;
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
 * ANALYTICS HOOKS (11 architected patterns)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. CONVERSION: Ancient Compass Effect
 *    Players who use the "Ancient Compass" item have 3x quest completion rate
 *    and earn 1.5x more rewards.
 *    → Mixpanel: Segment users by "use item" where item_type = "Ancient Compass"
 *    → Compare quest completion rate and average reward_gold / reward_xp
 *    → Look for compass_user = true on quest turned in events
 *
 * 2. TIME-BASED: Cursed Week (days 40-47)
 *    Death rates spike 5x, dungeon completion plummets, resurrection usage 4x.
 *    → Mixpanel: Chart "player death" count by day — clear spike days 40-47
 *    → Filter cause_of_death = "Curse" and cursed_week = true
 *
 * 3. RETENTION: Early Guild Joiners
 *    Players who join a guild within first 3 days have 80% D30 retention vs 20%.
 *    → Mixpanel: Cohort users who did "guild joined" within first 3 days
 *    → Compare D30 retention rate; look for guild_member_retained = true
 *
 * 4. CHURN: Death Spiral
 *    Players with 3+ deaths in first week have 70% churn rate (events removed).
 *    → Mixpanel: Segment users by count of "player death" in first 7 days
 *    → Bucket: 0-2, 3-4, 5+ deaths — compare events after day 7
 *
 * 5. PURCHASE VALUE: Lucky Charm LTV
 *    Lucky Charm Pack buyers become 5x higher LTV customers.
 *    → Mixpanel: Segment by "real money purchase" where product = "Lucky Charm Pack"
 *    → Compare total revenue, purchase frequency; look for lucky_charm_effect = true
 *
 * 6. BEHAVIORS TOGETHER: Strategic Explorers
 *    Players who both "inspect" AND "search for clues" before dungeons have
 *    85% dungeon completion (vs 45%) and 2x treasure value.
 *    → Look for strategic_explorer = true on exit dungeon / find treasure events
 *
 * 7. TIMED RELEASE: Shadowmourne Legendary Weapon (day 45)
 *    2% of players find the legendary weapon after release. They get 90% combat
 *    win rate (vs 60%) and complete dungeons 40% faster.
 *    → Filter "find treasure" where treasure_type = "Shadowmourne Legendary"
 *    → Look for legendary_weapon_equipped = true
 *
 * 8. SUBSCRIPTION TIER: Premium/Elite Advantage
 *    Premium: 50% better combat wins, 1.4x rewards, 45% higher dungeon completion
 *    Elite: 70% better combat wins, 1.8x rewards, 65% higher dungeon completion,
 *    bonus treasure events, reduced death rates.
 *    → Segment by subscription_tier super property
 *    → Look for subscriber_advantage = "Premium" or "Elite"
 *
 * 9. PROGRESSION SCALING: Gold Reward by Level
 *    Quest gold reward scales with player level: reward_gold *= (1 + level * 0.1).
 *    A level-10 player earns 2x gold and a level-20 player earns 3x gold vs level-1.
 *    → Mixpanel: Insights on "quest turned in", avg of reward_gold, breakdown by level
 *    → Expected: linear positive correlation between level and avg reward_gold
 *
 * 10. WHALE PURCHASES: Top-Spender Cohort
 *     ~33% of users (deterministic via user_id hash) are "whales" who spend 1.8x
 *     on real money purchases and are tagged is_whale: true.
 *     → Mixpanel: Insights on "real money purchase", avg of price_usd, breakdown by is_whale
 *     → Expected: is_whale=true ~1.8x higher avg purchase amount than is_whale=false
 *
 * 11. ALIGNMENT ARCHETYPE: Hero / Villain / Neutral
 *     User profiles are enriched with an "archetype" derived from alignment:
 *     Good → "hero" (~22%), Evil → "villain" (~22%), other → "neutral" (~56%).
 *     → Mixpanel: Insights, total unique users, breakdown by user profile "archetype"
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * EXPECTED METRICS SUMMARY
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Hook                  | Metric               | Baseline | Hook Effect | Ratio
 * ──────────────────────|──────────────────────|──────────|─────────────|──────
 * Ancient Compass       | Quest completion     | 55%      | 85-90%      | ~1.6x
 * Cursed Week           | Death rate           | 8%       | 40%         | 5x
 * Early Guild Join      | D30 Retention        | 20%      | 80%         | 4x
 * Death Spiral          | Retention (3+ deaths)| 100%     | 30%         | 0.3x
 * Lucky Charm           | LTV                  | $15      | $75         | 5x
 * Strategic Explorer    | Dungeon completion   | 45%      | 85%         | ~1.9x
 * Legendary Weapon      | Combat win rate      | 60%      | 90%         | 1.5x
 * Premium Tier          | Combat win rate      | 60%      | 90%         | 1.5x
 * Elite Tier            | Combat win rate      | 60%      | 102%        | 1.7x
 * Gold Scaling (lvl 10) | Avg quest gold       | ~100     | ~200        | 2.0x
 * Gold Scaling (lvl 20) | Avg quest gold       | ~100     | ~300        | 3.0x
 * Whale Purchases       | Avg real money spend | ~$15     | ~$27        | 1.8x
 * Hero archetype        | User share           | —        | ~22%        | 2/9
 * Villain archetype     | User share           | —        | ~22%        | 2/9
 * Neutral archetype     | User share           | —        | ~56%        | 5/9
 */

// Generate consistent item/location IDs for lookup tables
const dungeonIds = v.range(1, 51).map(n => `dungeon_${v.uid(6)}`);
const questIds = v.range(1, 201).map(n => `quest_${v.uid(8)}`);
const itemIds = v.range(1, 301).map(n => `item_${v.uid(7)}`);

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
				"compass_user": [false],
				"subscriber_advantage": ["Free"],
				"level_scaled": [false],
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
				"strategic_explorer": [false],
				"legendary_weapon_equipped": [false],
				"subscriber_advantage": ["Free"],
			}
		},
		{
			event: "find treasure",
			weight: 16,
			properties: {
				"treasure_type": ["Gold", "Weapon", "Armor", "Potion", "Scroll", "Rare Artifact"],
				"treasure_value": u.weighNumRange(5, 1000, 1.2, 50),
				"legendary_drop": [false],
				"strategic_explorer": [false],
				"subscriber_advantage": ["Free"],
				"elite_bonus": [false],
			}
		},
		{
			event: "player death",
			weight: 8,
			properties: {
				"cause_of_death": ["Monster", "Trap", "Fall Damage", "Poison", "Friendly Fire"],
				"player_level": u.weighNumRange(1, 50),
				"resurrection_used": [false, false, false, true],
				"cursed_week": [false],
				"near_death_survival": [false],
				"subscriber_advantage": ["Free"],
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
				"lucky_charm_effect": [false],
				"is_whale": [false],
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
				"legendary_weapon_equipped": [false],
				"subscriber_advantage": ["Free"],
				"near_death_survival": [false],
				"guild_member_retained": [false],
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
	 * 🎯 ARCHITECTED ANALYTICS HOOKS — 11 patterns
	 *
	 * 1. CONVERSION: Ancient Compass users have 3x quest completion + 1.5x rewards
	 * 2. TIME-BASED: "Cursed Week" (days 40-47) has 5x death rates
	 * 3. RETENTION: Early guild joiners (first 3 days) have 80% D30 retention vs 20%
	 * 4. CHURN: Players with 3+ deaths in first week have 70% churn rate
	 * 5. PURCHASE VALUE: Lucky Charm buyers spend 5x more (LTV pattern)
	 * 6. BEHAVIORS TOGETHER: inspect + search before dungeon = 85% completion vs 45%
	 * 7. TIMED RELEASE: Legendary weapon released day 45, early adopters dominate
	 * 8. SUBSCRIPTION TIER: Premium/Elite users have higher engagement and success
	 * 9. PROGRESSION SCALING: Quest gold scales with player level (1 + level * 0.1)
	 * 10. WHALE PURCHASES: ~33% of users via deterministic hash spend 1.8x more
	 * 11. ALIGNMENT ARCHETYPE: Good=hero, Evil=villain, other=neutral (user hook)
	 */
	hook: function (record, type, meta) {
		const NOW = dayjs();
		const DATASET_START = NOW.subtract(num_days, 'days');
		const CURSED_WEEK_START = DATASET_START.add(40, 'days');
		const CURSED_WEEK_END = DATASET_START.add(47, 'days');
		const LEGENDARY_WEAPON_RELEASE = DATASET_START.add(45, 'days');

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
		if (type === "event") {
			const EVENT_TIME = dayjs(record.time);

			if (record.event === "find treasure") {
				if (EVENT_TIME.isAfter(LEGENDARY_WEAPON_RELEASE) && chance.bool({ likelihood: 2 })) {
					record.treasure_type = "Shadowmourne Legendary";
					record.treasure_value = 50000;
					record.legendary_drop = true;
				} else {
					record.legendary_drop = false;
				}
			}
		}

		// Hooks #1, #3, #4, #5, #6, #8, #9, #10: per-user behavioral patterns
		if (type === "everything") {
			const userEvents = record;
			const profile = meta.profile;

			// Stamp superProps from profile for consistency
			userEvents.forEach(e => {
				e.Platform = profile.Platform;
				e.graphics_quality = profile.graphics_quality;
				e.subscription_tier = profile.subscription_tier;
			});

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

				if (event.event === "find treasure" && event.legendary_drop) {
					hasLegendaryWeapon = true;
				}

				if (event.event === "inspect") {
					inspectedBeforeDungeon = true;
				}
				if (event.event === "search for clues") {
					searchedBeforeDungeon = true;
				}
			});

			// Second pass: modify events based on patterns
			userEvents.forEach((event, idx) => {
				const eventTime = dayjs(event.time);

				// Set schema defaults for conditional properties
				if (event.event === "quest turned in") {
					event.compass_user = false;
					event.subscriber_advantage = "Free";
					event.level_scaled = false;
				}
				if (event.event === "exit dungeon") {
					event.strategic_explorer = false;
					event.legendary_weapon_equipped = false;
					event.subscriber_advantage = "Free";
				}
				if (event.event === "find treasure") {
					event.strategic_explorer = false;
					event.subscriber_advantage = "Free";
				}
				if (event.event === "combat completed") {
					event.legendary_weapon_equipped = false;
					event.subscriber_advantage = "Free";
					event.near_death_survival = false;
				}
				if (event.event === "player death") {
					event.near_death_survival = false;
					event.subscriber_advantage = "Free";
				}
				if (event.event === "real money purchase") {
					event.is_whale = false;
				}

				// Hook #9: PROGRESSION SCALING — Quest gold scales with level
				if (event.event === "quest turned in") {
					const baseGold = event.reward_gold || 100;
					event.reward_gold = Math.floor(baseGold * (1 + userLevel * 0.1));
					event.level_scaled = true;
				}

				// Hook #1: CONVERSION — Ancient Compass users complete more quests
				if (usedAncientCompass && event.event === "quest turned in") {
					event.reward_gold = Math.floor((event.reward_gold || 100) * 1.5);
					event.reward_xp = Math.floor((event.reward_xp || 500) * 1.5);
					event.compass_user = true;

					if (chance.bool({ likelihood: 40 })) {
						const extraQuest = {
							...event,
							time: eventTime.add(chance.integer({ min: 10, max: 120 }), 'minutes').toISOString(),
							quest_id: chance.pickone(questIds),
							reward_gold: chance.integer({ min: 100, max: 500 }),
							reward_xp: chance.integer({ min: 500, max: 2000 }),
							compass_user: true,
						};
						userEvents.splice(idx + 1, 0, extraQuest);
					}
				}

				// Hook #5: PURCHASE VALUE — Lucky charm buyers spend 5x more
				if (boughtLuckyCharm) {
					if (event.event === "real money purchase") {
						if (event.price_usd) {
							const currentPrice = event.price_usd;
							if (currentPrice < 49.99) {
								event.price_usd = currentPrice * 2;
							}
							event.lucky_charm_effect = true;
						}
					}

					if (event.event === "item purchased" && chance.bool({ likelihood: 35 })) {
						const purchaseTemplate = userEvents.find(e => e.event === "real money purchase");
						if (purchaseTemplate) {
							const extraPurchase = {
								...purchaseTemplate,
								time: eventTime.add(chance.integer({ min: 1, max: 3 }), 'days').toISOString(),
								user_id: event.user_id,
								product: chance.pickone([
									"Premium Currency (5000)",
									"Legendary Weapon Chest",
									"Season Pass"
								]),
								price_usd: chance.pickone([19.99, 49.99, 99.99]),
								payment_method: chance.pickone(["Credit Card", "PayPal"]),
								lucky_charm_effect: true,
							};
							userEvents.splice(idx + 1, 0, extraPurchase);
						}
					}
				}

				// Hook #10: WHALE PURCHASES — boost real money purchase amounts
				if (isWhale && event.event === "real money purchase") {
					if (event.price_usd) {
						event.price_usd = Math.round(event.price_usd * 1.8 * 100) / 100;
					}
					event.is_whale = true;
				}

				// Hook #6: BEHAVIORS TOGETHER — Inspect + Search before dungeon
				if (inspectedBeforeDungeon && searchedBeforeDungeon) {
					if (event.event === "exit dungeon") {
						if (event.completion_status !== "completed") {
							if (chance.bool({ likelihood: 85 })) {
								event.completion_status = "completed";
								event.strategic_explorer = true;
							}
						}
					}

					if (event.event === "find treasure") {
						event.treasure_value = Math.floor((event.treasure_value || 50) * 2);
						event.strategic_explorer = true;
					}
				}

				// Hook #7: TIMED RELEASE — Legendary weapon owners dominate
				if (hasLegendaryWeapon) {
					if (event.event === "combat completed") {
						if (event.outcome !== "Victory") {
							if (chance.bool({ likelihood: 90 })) {
								event.outcome = "Victory";
								event.legendary_weapon_equipped = true;
							}
						}
					}

					if (event.event === "exit dungeon") {
						event.completion_status = "completed";
						event.time_spent_mins = Math.floor((event.time_spent_mins || 60) * 0.6);
						event.legendary_weapon_equipped = true;
					}
				}

				// Hook #8: SUBSCRIPTION TIER — Premium/Elite advantages
				if (subscriptionTier === "Premium" || subscriptionTier === "Elite") {
					const isElite = subscriptionTier === "Elite";

					if (event.event === "combat completed") {
						if (event.outcome !== "Victory") {
							const winBoost = isElite ? 70 : 50;
							if (Math.random() * 100 < winBoost) {
								event.outcome = "Victory";
								event.loot_gained = true;
								event.subscriber_advantage = subscriptionTier;
							}
						}
					}

					if (event.event === "quest turned in") {
						const rewardMultiplier = isElite ? 1.8 : 1.4;
						event.reward_gold = Math.floor((event.reward_gold || 100) * rewardMultiplier);
						event.reward_xp = Math.floor((event.reward_xp || 500) * rewardMultiplier);
						event.subscriber_advantage = subscriptionTier;
					}

					if (event.event === "exit dungeon") {
						if (event.completion_status !== "completed") {
							const completionBoost = isElite ? 65 : 45;
							if (Math.random() * 100 < completionBoost) {
								event.completion_status = "completed";
								event.subscriber_advantage = subscriptionTier;
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
						event.subscriber_advantage = subscriptionTier;
					}

					if (event.event === "player death" && !event.cursed_week) {
						const survivalChance = isElite ? 50 : 30;
						if (Math.random() * 100 < survivalChance) {
							event.event = "combat completed";
							event.outcome = "Victory";
							event.loot_gained = true;
							event.subscriber_advantage = subscriptionTier;
							event.near_death_survival = true;
						}
					}

					if (isElite && Math.random() * 100 < 15) {
						if (event.event === "quest turned in" || event.event === "exit dungeon") {
							const treasureTemplate = userEvents.find(e => e.event === "find treasure");
							if (treasureTemplate) {
								const treasureTypes = ["Rare Artifact", "Gold", "Weapon", "Armor"];
								const bonusEvent = {
									...treasureTemplate,
									time: eventTime.add(Math.floor(Math.random() * 26) + 5, 'minutes').toISOString(),
									user_id: event.user_id,
									treasure_type: treasureTypes[Math.floor(Math.random() * treasureTypes.length)],
									treasure_value: Math.floor(Math.random() * 601) + 200,
									subscriber_advantage: "Elite",
									elite_bonus: true,
								};
								userEvents.splice(idx + 1, 0, bonusEvent);
							}
						}
					}
				}
			});

			// Hook #2: CURSED WEEK — inject death events for days 40-47 of each user's timeline
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
						const injected = {
							...deathTemplate,
							time: dayjs(sourceEvent.time).add(chance.integer({ min: 1, max: 30 }), 'minutes').toISOString(),
							user_id: sourceEvent.user_id,
							event: "player death",
							cause_of_death: "Curse",
							player_level: chance.integer({ min: 1, max: 50 }),
							resurrection_used: chance.bool({ likelihood: 80 }),
							cursed_week: true,
							near_death_survival: false,
							subscriber_advantage: "Free",
						};
						userEvents.push(injected);
					}
				}
			}

			// Hook #3 RETENTION + Hook #4 CHURN
			const shouldChurn = (!joinedGuildEarly && earlyDeaths >= 3) || (earlyDeaths >= 5);

			if (shouldChurn) {
				const firstWeekEnd = firstEventTime ? firstEventTime.add(7, 'days') : null;
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const evt = userEvents[i];
					if (firstWeekEnd && dayjs(evt.time).isAfter(firstWeekEnd)) {
						if (chance.bool({ likelihood: 70 })) {
							userEvents.splice(i, 1);
						}
					}
				}
			} else if (joinedGuildEarly) {
				const lastEvent = userEvents[userEvents.length - 1];
				const combatTemplate = userEvents.find(e => e.event === "combat completed");
				if (lastEvent && combatTemplate && chance.bool({ likelihood: 60 })) {
					const retentionEvent = {
						...combatTemplate,
						time: dayjs(lastEvent.time).add(chance.integer({ min: 1, max: 5 }), 'days').toISOString(),
						user_id: lastEvent.user_id,
						outcome: "Victory",
						loot_gained: true,
						guild_member_retained: true,
					};
					userEvents.push(retentionEvent);
				}
			}
		}

		return record;
	}
};

export default config;
