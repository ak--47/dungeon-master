// ── IMPORTS ──
import Chance from 'chance';
import { weighNumRange, integer } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       sanity
 * PURPOSE:    lightweight dungeon for module integration testing — abstract foo-yak events, inferred funnels
 * SCALE:      500 users, ~50K events, 90 days
 * EVENTS (10): foo, bar, baz, qux, garply, durtle, linny, fonk, crumn, yak
 * FUNNELS (2): qux→garply→durtle→linny→fonk→crumn→yak; foo→bar→baz (first)
 */

// ── HOOK STORIES ──
/*
 * 1. TEMPERATURE TAGGING (event hook)
 *    foo/bar/baz = "hot", crumn/yak = "cold", everything else = "warm".
 *    (NOTE: current implementation stamps an integer engagement_score
 *    bucketed by event name — high/mid/low engagement bands.)
 *
 * 2. HASH-BASED POWER USERS (everything hook)
 *    ~10% of users (by distinct_id hash) get 3 extra duplicate events.
 *    (NOTE: current implementation trims the tail of users with 4-7
 *    events to simulate light-user churn.)
 */

// ── SCALE ──
const SEED = "foo bar";
const NUM_DAYS = 90;
const NUM_USERS = 500;
const EVENTS_PER_DAY = 1.11;
const token = process.env.MP_TOKEN || "";

const chance = new Chance();

// ── DATA ARRAYS ──
const spiritAnimals = ["duck", "dog", "otter", "penguin", "cat", "elephant", "lion", "cheetah", "giraffe", "zebra", "rhino", "hippo", "whale", "dolphin", "shark", "octopus", "squid", "jellyfish", "starfish", "seahorse", "crab", "lobster", "shrimp", "clam", "snail", "slug", "butterfly", "moth", "bee", "wasp", "ant", "beetle", "ladybug", "caterpillar", "centipede", "millipede", "scorpion", "spider", "tarantula", "tick", "mite", "mosquito", "fly", "dragonfly", "damselfly", "grasshopper", "cricket", "locust", "mantis", "cockroach", "termite", "praying mantis", "walking stick", "stick bug", "leaf insect", "lacewing", "aphid", "cicada", "thrips", "psyllid", "scale insect", "whitefly", "mealybug", "planthopper", "leafhopper", "treehopper", "flea", "louse", "bedbug", "flea beetle", "weevil", "longhorn beetle", "leaf beetle", "tiger beetle", "ground beetle", "lady beetle", "firefly", "click beetle", "rove beetle", "scarab beetle", "dung beetle", "stag beetle", "rhinoceros beetle", "hercules beetle", "goliath beetle", "jewel beetle", "tortoise beetle"];
const colors = ["red", "orange", "yellow", "green", "blue", "indigo", "violet"];

// ── HELPER FUNCTIONS ──
function handleUserHook(record) {
	// tag power users based on luckyNumber
	record.userTier = record.luckyNumber > 300 ? "power" : "regular";
	return record;
}

function handleEventHook(record) {
	// add an engagement score based on event type
	const highEngagement = ["fonk", "crumn", "yak"];
	const midEngagement = ["garply", "durtle", "linny"];
	if (highEngagement.includes(record.event)) {
		record.engagement_score = chance.integer({ min: 70, max: 100 });
	} else if (midEngagement.includes(record.event)) {
		record.engagement_score = chance.integer({ min: 30, max: 69 });
	} else {
		record.engagement_score = chance.integer({ min: 1, max: 29 });
	}
	return record;
}

function handleEverythingHook(record, meta) {
	// low-activity users lose their last few events (churn simulation)
	const profile = meta.profile;
	record.forEach(e => {
		e.color = profile.color;
		e.number = profile.number;
		// engagement_score intentionally varies per event (set by event hook)
	});
	if (record.length > 3 && record.length < 8) {
		// users with few events lose the tail end — simulates churn
		return record.slice(0, Math.ceil(record.length * 0.6));
	}
	return record;
}

// ── CONFIG ──
/** @type {import('../types.js').Dungeon} */
const config = {
	token,
	seed: SEED,
	numDays: NUM_DAYS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: 'json', //csv or json
	region: "US",
	hasAnonIds: false, //if true, anonymousIds are created for each user
	hasSessionIds: false, //if true, hasSessionIds are created for each user
	alsoInferFunnels: true, //if true, infer funnels from events
	writeToDisk: false,
	concurrency: 1,
	funnels: [
		{
			sequence: ["qux", "garply", "durtle", "linny", "fonk", "crumn", "yak"],
		},
		{
			sequence: ["foo", "bar", "baz"],
			isFirstFunnel: true,
		}
	],
	events: [
		{
			event: "foo",
			weight: 10,
			properties: {}
		},
		{
			event: "bar",
			weight: 9,
			isFirstEvent: true,
			properties: {}
		},
		{
			event: "baz",
			weight: 8,
			properties: {}
		},
		{
			event: "qux",
			weight: 7,
			properties: {}
		},
		{
			event: "garply",
			weight: 6,
			properties: {}
		},
		{
			event: "durtle",
			weight: 5,
			properties: {}
		},
		{
			event: "linny",
			weight: 4,
			properties: {}
		},
		{
			event: "fonk",
			weight: 3,
			properties: {}
		},
		{
			event: "crumn",
			weight: 2,
			properties: {}
		},
		{
			event: "yak",
			weight: 1,
			properties: {}
		}
	],
	superProps: {
		color: colors,
		number: integer,
		engagement_score: [0],
	},
	userProps: {
		title: chance.profession.bind(chance),
		luckyNumber: weighNumRange(42, 420),
		userTier: ["regular"],
		spiritAnimal: spiritAnimals,
		color: colors,
		number: integer,
		engagement_score: [0],
	},
	hook: function (record, type, meta) {
		if (type === "user") return handleUserHook(record);
		if (type === "event") return handleEventHook(record);
		if (type === "everything") return handleEverythingHook(record, meta);
		return record;
	}
};

export default config;
