/**
 * Group Analytics — tests multiple group keys with varied entity counts.
 *
 * Exercises: 3 group keys (company, team, project) at different scales,
 * each with distinct event associations and group-level properties.
 *
 * - 500 users, 30K events, 60 days
 * - 3 group keys: company_id (50), team_id (200), project_id (500)
 * - groupProps with varied property types per key
 * - No hooks
 */

import Chance from 'chance';
let chance = new Chance();
import { weighNumRange, weighChoices } from "../../lib/utils/utils.js";

/** @type {import('../../types').Dungeon} */
const config = {
	token: "",
	seed: "group-analytics",
	numDays: 60,
	numEvents: 30_000,
	numUsers: 500,
	format: "json",
	region: "US",
	hasAnonIds: false,
	hasSessionIds: false,
	hasAdSpend: false,
	hasLocation: false,
	hasAndroidDevices: false,
	hasIOSDevices: false,
	hasDesktopDevices: true,
	hasBrowser: true,
	hasCampaigns: false,
	isAnonymous: false,
	alsoInferFunnels: false,
	concurrency: 1,
	batchSize: 2_500_000,
	writeToDisk: false,

	events: [
		{
			event: "feature used",
			weight: 8,
			properties: {
				feature: ["dashboard", "reports", "settings", "api", "integrations"],
			}
		},
		{
			event: "subscription change",
			weight: 2,
			properties: {
				plan: ["free", "starter", "business", "enterprise"],
				action: ["upgrade", "downgrade", "renew"],
			}
		},
		{
			event: "support ticket",
			weight: 3,
			properties: {
				priority: weighChoices(["low", "low", "medium", "medium", "high"]),
				category: ["billing", "technical", "onboarding", "feature request"],
			}
		},
		{
			event: "task completed",
			weight: 7,
			properties: {
				type: ["bug", "feature", "chore", "docs"],
				points: weighNumRange(1, 13),
			}
		},
		{
			event: "meeting scheduled",
			weight: 4,
			properties: {
				duration: [15, 30, 45, 60],
				type: ["standup", "planning", "retro", "1:1", "all-hands"],
			}
		},
		{
			event: "code committed",
			weight: 6,
			properties: {
				language: ["javascript", "python", "go", "rust", "java"],
				linesChanged: weighNumRange(1, 500, .25),
			}
		},
		{
			event: "deployment run",
			weight: 3,
			properties: {
				environment: ["dev", "staging", "production"],
				status: weighChoices(["success", "success", "success", "success", "failure"]),
				durationSec: weighNumRange(10, 300, .25),
			}
		},
		{
			event: "login",
			weight: 5,
			isFirstEvent: true,
			properties: {
				method: ["password", "sso", "oauth"],
			}
		},
	],

	funnels: [],

	superProps: {},

	userProps: {
		role: ["engineer", "designer", "pm", "manager", "exec"],
	},

	scdProps: {},
	mirrorProps: {},

	groupKeys: [
		["company_id", 50, ["feature used", "subscription change", "support ticket"]],
		["team_id", 200, ["feature used", "task completed", "meeting scheduled"]],
		["project_id", 500, ["task completed", "code committed", "deployment run"]],
	],

	groupProps: {
		company_id: {
			name: () => chance.company(),
			industry: ["technology", "finance", "healthcare", "retail", "education", "manufacturing"],
			plan: ["free", "starter", "business", "enterprise"],
			employee_count: weighNumRange(10, 5000, .25),
		},
		team_id: {
			name: () => `${chance.pickone(["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Theta", "Omega"])} ${chance.pickone(["Squad", "Team", "Pod", "Crew"])}`,
			department: ["engineering", "design", "product", "marketing", "sales", "support"],
			size: weighNumRange(3, 20),
		},
		project_id: {
			name: () => `${chance.pickone(["project", "initiative", "sprint"])} ${chance.word()}`,
			status: ["active", "paused", "completed", "archived"],
			priority: weighChoices(["low", "medium", "medium", "high", "critical"]),
		},
	},

	lookupTables: [],

	hook: function (record, type, meta) {
		return record;
	}
};

export default config;
