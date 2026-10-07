// ── IMPORTS ──
import { hashCohort, cloneEvent, dropEventsWhere } from '../../lib/hook-helpers/index.js';
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       stories-verify
 * PURPOSE:    P3.3 fixture — exercises the story runner (scripts/verify-stories.mjs)
 *             in both disk and in-memory modes. Small scale, fixed seed, and
 *             DETERMINISTIC hooks (index parity, hash cohorts — no RNG) so the
 *             story verdicts are stable run-to-run.
 * SCALE:      200 users, ~12K events, 14 days
 * EVENTS (2): browse, purchase
 * FUNNELS (0): none
 *
 * Verified by: node scripts/verify-stories.mjs dungeons/technical/stories-verify.js
 */

// ── HOOK STORIES ──
/*
 * One `everything` hook, plan pinned per user via hashCohort (the engine stamps
 * the `plan` superProp randomly per event; the hook overwrites it per-user):
 *
 * H1: pro-plan browse amplification — every pro browse event is cloned
 *     BROWSE_CLONES more times, so pro browse volume is exactly
 *     (BROWSE_CLONES + 1)x its base. Aggregate pro/free count ratio also
 *     absorbs the hash-split cohort-size noise (Binomial(200, 0.5): the
 *     pro/free user ratio sits within ~[0.8, 1.25] at 3σ), so the a-priori
 *     floor is (BROWSE_CLONES + 1) * 0.8 rounded down to 2.0 — derived from
 *     the knobs, not tuned to observations.
 * H2: free-plan purchase suppression — every 2nd free purchase is dropped
 *     (index parity, deterministic). Free purchase volume halves (keep =
 *     ceil(n/2) per user, so slightly over half survives at small n), putting
 *     the pro/free purchase ratio a bit under 2.0 — floor 1.5.
 */

// ── KNOBS (stories compute their thresholds from these) ──
const PRO_PCT = 50;        // hashCohort split: ~half the users are plan=pro
const BROWSE_CLONES = 2;   // pro browse volume = (BROWSE_CLONES + 1) x base

// ── CONFIG ──
/** @type {Config} */
const config = {
	name: 'stories-verify',
	seed: 'p33-stories-verify',
	numUsers: 200,
	numDays: 14,
	avgEventsPerUserPerDay: 4,
	percentUsersBornInDataset: 0,
	format: 'json',
	concurrency: 1,
	writeToDisk: false,
	verbose: false,
	superProps: { plan: ['free', 'pro'] },
	events: [
		{ event: 'browse', weight: 8, properties: { surface: ['home', 'category', 'search'] } },
		{ event: 'purchase', weight: 2, properties: { amount: [10, 20, 30, 40, 50] } },
	],
	hook: function (record, type, _meta) {
		if (type !== 'everything' || !Array.isArray(record) || !record.length) return record;
		const uid = record[0].user_id || record[0].distinct_id;
		if (!uid) return record;
		const isPro = hashCohort(uid, PRO_PCT);
		const plan = isPro ? 'pro' : 'free';
		for (const ev of record) ev.plan = plan;
		if (isPro) {
			// H1: clone each pro browse BROWSE_CLONES times (same timestamp —
			// auto-sort after `everything` keeps the stream ordered).
			const clones = [];
			for (const ev of record) {
				if (ev.event !== 'browse') continue;
				for (let i = 0; i < BROWSE_CLONES; i++) clones.push(cloneEvent(ev));
			}
			record.push(...clones);
		} else {
			// H2: drop every 2nd free purchase (parity — deterministic, no RNG).
			let n = 0;
			dropEventsWhere(record, (e) => e.event === 'purchase' && (n++ % 2 === 1));
		}
		return record;
	},
};

// ── STORIES ──
/** @type {import("../../types").DungeonStory[]} */
export const stories = [
	{
		id: 'H1-pro-browse-3x',
		hook: 'H1',
		archetype: 'cohort-count-scale',
		narrative: `pro-plan users generate ${BROWSE_CLONES + 1}x browse volume (each pro browse cloned ${BROWSE_CLONES} more times)`,
		assertions: [
			{
				breakdown: { type: 'eventBreakdown', event: 'browse', breakdownProperty: 'plan' },
				select: {
					pro: { where: { value: 'pro' } },
					free: { where: { value: 'free' } },
				},
				// target from the knob; floor = target * 0.8 hash-split bound (see HOOK STORIES)
				expect: { metric: 'pro.count / free.count', op: '>=', target: BROWSE_CLONES + 1, floor: 2.0 },
			},
			{
				// single-ref sanity: the pro cohort is roughly half of 200 users
				breakdown: { type: 'eventBreakdown', event: 'browse', breakdownProperty: 'plan' },
				select: { pro: { where: { value: 'pro' } } },
				expect: { metric: 'pro.total_users', op: 'between', target: [60, 140] },
			},
		],
	},
	{
		id: 'H2-free-purchase-drop',
		hook: 'H2',
		archetype: 'composition-drift',
		narrative: 'every 2nd free purchase dropped — pro/free purchases per purchaser approach 2x (ceil-keep parity and purchasers left with zero purchases keep it a bit under)',
		assertions: [
			{
				breakdown: { type: 'eventBreakdown', event: 'purchase', breakdownProperty: 'plan' },
				select: {
					pro: { where: { value: 'pro' } },
					free: { where: { value: 'free' } },
				},
				// per-purchaser rates, so the hashCohort split size (≈50% at scale, but
				// 40-60% at 200 users) does not leak into the H2 ratio
				assert: (rows) => {
					const pro = (rows || []).find(r => r.value === 'pro');
					const free = (rows || []).find(r => r.value === 'free');
					if (!pro || !free || !pro.total_users || !free.total_users) return { pass: false, verdict: 'NONE', detail: 'missing plan segment' };
					const ratio = (pro.count / pro.total_users) / (free.count / free.total_users);
					const verdict = ratio >= 1.8 ? 'NAILED' : ratio >= 1.5 ? 'STRONG' : ratio > 1 ? 'WEAK' : 'INVERSE';
					return { pass: ratio >= 1.5, verdict, detail: `pro/free purchases per purchaser ${ratio.toFixed(3)} (target 2.0, floor 1.5)` };
				},
			},
		],
	},
	{
		id: 'H2-duckdb-crosscheck',
		hook: 'H2',
		archetype: 'bespoke',
		narrative: 'raw-shard SQL cross-check of the purchase suppression (duckdb escape hatch; disk mode only — skipped in-memory)',
		assertions: [
			{
				breakdown: {
					type: 'duckdb',
					sql: "SELECT plan, count(*) AS n, count(DISTINCT user_id) AS users FROM read_json_auto('{{PREFIX}}-EVENTS*.json*') WHERE event = 'purchase' GROUP BY plan",
				},
				assert: (rows) => {
					// per-purchaser rates: the 200-user hashCohort split is not exactly 50/50
					const by = Object.fromEntries((rows || []).map(r => [r.plan, Number(r.n) / Number(r.users)]));
					const ratio = by.pro / by.free;
					const pass = Number.isFinite(ratio) && ratio >= 1.5;
					return {
						pass,
						verdict: pass ? (ratio >= 1.8 ? 'NAILED' : 'STRONG') : 'NONE',
						detail: `pro=${by.pro?.toFixed(2)} free=${by.free?.toFixed(2)} per purchaser, ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : 'n/a'}`,
					};
				},
			},
		],
	},
];

export default config;
