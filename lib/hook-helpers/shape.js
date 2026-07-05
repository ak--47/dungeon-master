/**
 * Hook helpers — analysis-shape atoms (v1.6).
 *
 * Higher-order atoms that sculpt a user's FULL event stream into the shapes
 * specific Mixpanel analyses read: a lifecycle dormancy-resurrection wave
 * (HOOKS.md §2.16), a biased Flows path branch (§2.17), and a deterministic
 * session cadence (§2.13). All three are `everything`-hook-only — they need
 * the whole stream — and obey the schema-first rules: clones only (spread
 * from the user's own events, `insert_id` stripped), no fabricated events,
 * seeded `chance` for all randomness. Timestamp rewrites are safe because
 * the engine re-derives `session_id` on the final event set (v1.6 P2.1).
 */

import { getChance } from '../utils/utils.js';
import { toMs, writeTime } from './_internal.js';
import { hashFloat } from './cohort.js';

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const MIN_MS = 60000;

/**
 * Engineer a clean dormancy gap + resurrection burst for one user.
 *
 * Drops the user's `valueMomentEvent` events (or ALL events with
 * `dropAll: true`) inside the window
 * `[birth + dormantFromDay days, birth + dormantFromDay + dormantDays days]`
 * (both ends inclusive; birth = the user's earliest event time), then clones
 * a burst of `resurrectBurst` value-moment events shortly after the window.
 *
 * Gap discipline is the whole point: Mixpanel's lifecycle "dormant" state is
 * an `EqualTo 0` filter over the period (HOOKS.md §2.16) — ONE stray value
 * moment inside the window destroys the Resurrected classification. The
 * sweep therefore filters by TIMESTAMP over the array as passed, which
 * includes events other hooks injected earlier in the same `everything`
 * pass. Size `dormantDays` to cover at least two whole lifecycle periods so
 * tiling can't clip the gap.
 *
 * Burst template: the surviving `valueMomentEvent` occurrence closest to the
 * window (preferring one that carries `user_id`). No template → no burst
 * (schema-first: never fabricate). Burst lands 1-3h after the window end
 * with 1-10min gaps — one tight resurrection session. If the window extends
 * past the dataset end, the engine's future-time guard will drop the clones;
 * keep `dormantFromDay + dormantDays` inside the user's lifespan.
 *
 * @param {Array<Object>} events - Full user event array (everything hook).
 * @param {string} uid - User id; stamped on clones that lack `user_id`.
 * @param {Object} opts
 * @param {number} opts.dormantFromDay - Window start, in days after birth.
 * @param {number} opts.dormantDays - Window length in days.
 * @param {number} [opts.resurrectBurst=3] - Clones in the post-gap burst.
 * @param {string} opts.valueMomentEvent - Event name that marks value; the
 *   drop target (unless `dropAll`) and the burst template.
 * @param {boolean} [opts.dropAll=false] - Drop ALL events in the window,
 *   not just value moments.
 * @returns {Array<Object>} NEW array: filtered + burst clones appended.
 */
export function applyLifecycleWave(events, uid, opts) {
	const { dormantFromDay, dormantDays, resurrectBurst = 3, valueMomentEvent, dropAll = false } = opts || {};
	if (!Array.isArray(events) || !events.length) return events;
	if (typeof dormantFromDay !== 'number' || typeof dormantDays !== 'number' || dormantDays <= 0) return events;
	if (!valueMomentEvent && !dropAll) return events;

	let birthMs = Infinity;
	for (const ev of events) {
		if (!ev) continue;
		const t = toMs(ev.time);
		if (Number.isFinite(t) && t < birthMs) birthMs = t;
	}
	if (!Number.isFinite(birthMs)) return events;

	const windowStart = birthMs + dormantFromDay * DAY_MS;
	const windowEnd = windowStart + dormantDays * DAY_MS;

	const kept = events.filter(ev => {
		if (!ev) return false;
		const t = toMs(ev.time);
		if (!Number.isFinite(t) || t < windowStart || t > windowEnd) return true;
		return !(dropAll || ev.event === valueMomentEvent);
	});

	// Burst template: surviving value moment closest to the window.
	let template = null;
	let bestDist = Infinity;
	for (const ev of kept) {
		if (!ev || ev.event !== valueMomentEvent) continue;
		const t = toMs(ev.time);
		if (!Number.isFinite(t)) continue;
		const dist = t < windowStart ? windowStart - t : t - windowEnd;
		// Prefer a template with user_id at equal-or-better distance.
		if (dist < bestDist || (dist === bestDist && !template?.user_id && ev.user_id)) {
			bestDist = dist;
			template = ev;
		}
	}
	if (!template || resurrectBurst <= 0) return kept;

	const chance = getChance();
	let t = windowEnd + chance.integer({ min: 60 * MIN_MS, max: 180 * MIN_MS });
	for (let i = 0; i < resurrectBurst; i++) {
		const clone = { ...template };
		writeTime(clone, t);
		delete clone.insert_id;
		if (!clone.user_id && uid) clone.user_id = uid;
		kept.push(clone);
		t += chance.integer({ min: MIN_MS, max: 10 * MIN_MS });
	}
	return kept;
}

/**
 * Bias a share of users onto a specific Flows path after an anchor event.
 *
 * For users where `hashFloat(uid) < share`, injects the `path` sequence —
 * each step cloned from the user's OWN existing event of that name — right
 * after the user's FIRST `anchor` occurrence, with tight monotonic gaps.
 *
 * Why these rules (HOOKS.md §2.17): Flows' unique mode reads only the FIRST
 * flow per user, so the injection anchors on the first occurrence; gaps are
 * clamped to ≥1s because sub-second jitter scrambles step order in the
 * Sankey; and the engineered branch needs roughly ≥20-25% `share` to survive
 * Sankey's top-3-per-level pruning. If the user lacks a source event for ANY
 * path step, the user is skipped entirely — a partial path would pollute the
 * engineered share.
 *
 * @param {Array<Object>} events - Full user event array (everything hook).
 * @param {string} uid - User id (hashed for the share gate; stamped on
 *   clones that lack `user_id`).
 * @param {Object} opts
 * @param {string} opts.anchor - Event name the path follows.
 * @param {string[]} opts.path - Ordered event names to inject.
 * @param {number} opts.share - FRACTION of users in [0, 1] (unlike
 *   `hashCohort`'s 0-100 pct scale).
 * @param {[number, number]} [opts.gapSeconds=[2,30]] - Per-step gap range in
 *   seconds; lower bound clamped to ≥1.
 * @returns {Array<Object>} The SAME array, augmented in place for selected
 *   users (engine auto-sorts after the everything hook).
 */
export function applyPathBias(events, uid, opts) {
	const { anchor, path, share, gapSeconds = [2, 30] } = opts || {};
	if (!Array.isArray(events) || !events.length || !anchor) return events;
	if (!Array.isArray(path) || !path.length || typeof share !== 'number') return events;
	if (hashFloat(uid) >= share) return events;

	// First anchor occurrence in TIME order.
	let anchorMs = Infinity;
	for (const ev of events) {
		if (!ev || ev.event !== anchor) continue;
		const t = toMs(ev.time);
		if (Number.isFinite(t) && t < anchorMs) anchorMs = t;
	}
	if (!Number.isFinite(anchorMs)) return events;

	// One template per path step, from the user's own stream. Any missing →
	// skip the user entirely.
	const templates = [];
	for (const name of path) {
		const tpl = events.find(e => e && e.event === name);
		if (!tpl) return events;
		templates.push(tpl);
	}

	const lo = Math.max(1, Number(gapSeconds[0]) || 1);
	const hi = Math.max(lo, Number(gapSeconds[1]) || lo);
	const chance = getChance();
	let t = anchorMs;
	for (const tpl of templates) {
		t += chance.integer({ min: lo, max: hi }) * 1000;
		const clone = { ...tpl };
		writeTime(clone, t);
		delete clone.insert_id;
		if (!clone.user_id && uid) clone.user_id = uid;
		events.push(clone);
	}
	return events;
}

/**
 * Rewrite a user's event TIMESTAMPS into a deterministic session cadence:
 * `sessionsPerWeek` clusters per week, each compressed into a
 * `[start, start + sessionMinutes]` window.
 *
 * Retiming only — no events are added or dropped; the same objects are
 * mutated in place. Session count = `min(sessionsPerWeek × weeks,
 * ceil(N / eventsPerSession))` (weeks tile forward from the user's first
 * event): plentiful streams get exactly `sessionsPerWeek` clusters per week
 * with events split evenly; scarce streams get fewer, `eventsPerSession`-
 * sized clusters spread across weeks. Session days prefer the user's
 * ORIGINAL active days in each week, so the engine's day distribution
 * survives where possible.
 *
 * Boundary guarantees (what makes derived sessions deterministic against
 * jitter — HOOKS.md §2.13): intra-session gaps stay well under Mixpanel's
 * 30-min timeout (even spacing capped at 20min + bounded jitter, worst case
 * <28min); inter-session gaps stay well over it (sessions land on distinct
 * days when possible; same-day sessions are centered in equal partitions of
 * the day, spaced ≥¼ partition — guaranteed >30min up to 8 sessions/day);
 * and no engineered session crosses UTC midnight (a day-boundary split would
 * cut it — `session_query.cpp` daySplit). Valid precisely because of P2.1:
 * session_ids are re-derived after the everything hook.
 *
 * @param {Array<Object>} events - Full user event array (everything hook).
 * @param {string} uid - Unused for hashing here; kept for atom-signature
 *   symmetry (cohort gating belongs to the caller — combine with
 *   `hashCohort`).
 * @param {Object} opts
 * @param {number} opts.sessionsPerWeek - Target clusters per week (≥1).
 * @param {number} opts.eventsPerSession - Target events per cluster (≥1).
 * @param {number} opts.sessionMinutes - Max cluster span in minutes.
 * @returns {Array<Object>} The SAME array, timestamps rewritten.
 */
export function applySessionShape(events, uid, opts) {
	const { sessionsPerWeek, eventsPerSession, sessionMinutes } = opts || {};
	if (!Array.isArray(events) || !events.length) return events;
	if (!isPos(sessionsPerWeek) || !isPos(eventsPerSession) || !isPos(sessionMinutes)) return events;

	const timed = events.filter(e => e && Number.isFinite(toMs(e.time)));
	if (!timed.length) return events;
	timed.sort((a, b) => toMs(a.time) - toMs(b.time));

	const N = timed.length;
	const firstMs = toMs(timed[0].time);
	const lastMs = toMs(timed[N - 1].time);
	const weeks = Math.max(1, Math.ceil((lastMs - firstMs + 1) / WEEK_MS));
	const numSessions = Math.max(1, Math.min(
		Math.floor(sessionsPerWeek) * weeks,
		Math.ceil(N / Math.floor(eventsPerSession)),
	));

	// Sessions per week and events per session, distributed evenly with the
	// remainder going to the EARLIEST weeks/sessions (chronological bias).
	const sessionsInWeek = splitEvenly(numSessions, weeks);
	const chunkSizes = splitEvenly(N, numSessions).filter(n => n > 0);

	const chance = getChance();
	const firstDay = Math.floor(firstMs / DAY_MS);
	const lastDay = Math.floor(lastMs / DAY_MS);

	// Pick one day per session, week by week: prefer the user's original
	// active days in the week, fill from the rest of the week's days, and
	// only reuse days when a week has more sessions than days.
	const sessionDays = [];
	for (let w = 0; w < weeks; w++) {
		const need = sessionsInWeek[w];
		if (!need) continue;
		const weekStartMs = firstMs + w * WEEK_MS;
		const dayLo = Math.max(firstDay, Math.floor(weekStartMs / DAY_MS));
		const dayHi = Math.min(lastDay, Math.floor((weekStartMs + WEEK_MS - 1) / DAY_MS));
		const originalDays = new Set();
		for (const ev of timed) {
			const t = toMs(ev.time);
			if (t >= weekStartMs && t < weekStartMs + WEEK_MS) originalDays.add(Math.floor(t / DAY_MS));
		}
		const pool = [...originalDays].filter(d => d >= dayLo && d <= dayHi);
		const others = [];
		for (let d = dayLo; d <= dayHi; d++) if (!originalDays.has(d)) others.push(d);
		const picked = chance.pickset(pool, Math.min(need, pool.length));
		if (picked.length < need) picked.push(...chance.pickset(others, Math.min(need - picked.length, others.length)));
		let i = 0;
		while (picked.length < need) picked.push(picked[i++ % Math.max(1, picked.length)]); // reuse days: > days/week sessions
		picked.sort((a, b) => a - b);
		sessionDays.push(...picked);
	}

	// Place sessions within days. Same-day sessions get equal partitions of
	// the day; the session is centered in its partition with bounded jitter,
	// which guarantees the inter-session and midnight invariants above.
	const perDayCount = new Map();
	for (const d of sessionDays) perDayCount.set(d, (perDayCount.get(d) || 0) + 1);
	const perDaySeen = new Map();
	const sesMs = sessionMinutes * MIN_MS;

	let cursor = 0;
	for (let s = 0; s < chunkSizes.length; s++) {
		const size = chunkSizes[s];
		const chunk = timed.slice(cursor, cursor + size);
		cursor += size;
		const day = sessionDays[Math.min(s, sessionDays.length - 1)];
		const m = perDayCount.get(day) || 1;
		const j = perDaySeen.get(day) || 0;
		perDaySeen.set(day, j + 1);

		const seg = DAY_MS / m;
		const span = Math.min(sesMs, seg * 0.5);
		const center = day * DAY_MS + j * seg + (seg - span) / 2;
		const q = Math.floor((seg - span) / 4);
		const start = center + (q > 0 ? chance.integer({ min: -q, max: q }) : 0);

		if (size === 1) {
			writeTime(chunk[0], start);
			continue;
		}
		// Even spacing capped at 20min so gap + jitter stays < 30min. Jitter is
		// also bounded by the window slack so no event escapes [start, start+span].
		const gap = Math.min(span / (size - 1), 20 * MIN_MS);
		const slack = span - (size - 1) * gap;
		const jitterMax = Math.floor(Math.max(0, Math.min(gap * 0.4, 5 * MIN_MS, slack)));
		for (let i = 0; i < size; i++) {
			const jitter = i > 0 && jitterMax > 0 ? chance.integer({ min: 0, max: jitterMax }) : 0;
			writeTime(chunk[i], start + i * gap + jitter);
		}
	}
	return events;
}

// ── internal helpers ──

function isPos(n) {
	return typeof n === 'number' && Number.isFinite(n) && n >= 1;
}

/** Split `total` into `parts` integers, remainder to the earliest parts. */
function splitEvenly(total, parts) {
	const base = Math.floor(total / parts);
	const extra = total % parts;
	const out = [];
	for (let i = 0; i < parts; i++) out.push(base + (i < extra ? 1 : 0));
	return out;
}
