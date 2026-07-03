/**
 * Story runner (v1.6, P3.3) — mechanical evaluation of a dungeon's `stories`
 * export against emulator output. The five-tier verdict scale (SPEC P3.2,
 * mirrored in `.claude/skills/verify-dungeon/references/report-format.md`):
 *
 *   NAILED  — observed within ±10% of `target`
 *   STRONG  — passes `floor` (or `target` when no floor is given)
 *   WEAK    — fails floor but effect direction is correct, or any selection's
 *             cohort < `minCohort` (population cap: NAILED/STRONG demote to WEAK)
 *   NONE    — no measurable effect: selection empty, metric not computable,
 *             observed sits exactly at the neutral point, or a single-ref
 *             metric (no neutral point → no direction test) fails its floor
 *   INVERSE — effect direction opposite the assertion
 *
 * Story verdict = worst assertion (INVERSE < NONE < WEAK < STRONG < NAILED).
 *
 * Direction ("effect") is mechanical: ratio metrics have neutral point 1,
 * difference metrics 0, single-ref metrics none. For op '>='/'>' the effect
 * direction is correct when observed > neutral; for '<='/'<' when observed <
 * neutral. For 'between' the wanted side is where the band's midpoint sits
 * relative to the neutral point.
 *
 * Cohort size per named selection: sum of `user_count` over the selected rows
 * when any row carries one, else the row count. The SMALLEST selection is
 * compared against `minCohort`.
 */

import { emulateBreakdown } from './emulate-breakdown.js';
import { applyFunnelDefaults } from './verify-dungeon.js';

/** Closed archetype enum — MUST match lib/templates/story-spec.schema.json (unit-tested). */
export const STORY_ARCHETYPES = [
	'cohort-count-scale',
	'cohort-prop-scale',
	'temporal-inflection',
	'funnel-conversion-by-segment',
	'funnel-ttc-by-segment',
	'retention-divergence',
	'frequency-sweet-spot',
	'attribution-bias',
	'experiment-lift',
	'lifecycle-wave',
	'path-share',
	'session-shape',
	'composition-drift',
	'bespoke',
];

/** Verdict rank, worst → best. Story verdict = min rank across assertions. */
export const VERDICT_RANK = { INVERSE: 0, NONE: 1, WEAK: 2, STRONG: 3, NAILED: 4 };

const EXPECT_OPS = ['>=', '<=', '>', '<', 'between'];
const WHERE_OPS = ['==', '!=', '>=', '<=', '>', '<'];
const NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const HOOK_RE = /^(?:H|Hook\s*)?(\d+)$/i;
const NUM_RE = /^[0-9]+(\.[0-9]+)?$/;

// Columns that SUM across a multi-row selection. Everything else is
// value-like: multi-row selection is an authoring error (which row's avg?).
const COUNT_LIKE = new Set(['count', 'user_count', 'event_count', 'conversions', 'total', 'uniques', 'entries', 'sessions']);
const isCountLike = (col) => COUNT_LIKE.has(col) || /_count$/.test(col);

// ── metric grammar ──────────────────────────────────────────────────────────

/**
 * Parse the pinned metric grammar: single ref `'<name>.<col>'`, ratio
 * `'<a>.<col> / <b>.<col>'`, or difference `'<a>.<col> - <b>.<col>'`.
 * Operands are refs or unsigned numeric literals; at most one operator; at
 * least one ref. Identifiers can't contain `/` or `-`, so the first
 * occurrence of either IS the operator.
 * @param {string} metric
 * @returns {{ kind: 'single'|'ratio'|'difference', left: Object, right: Object|null }}
 */
export function parseMetric(metric) {
	const s = String(metric || '').trim();
	if (!s) throw new Error('metric is empty');
	let opChar = null, idx = s.indexOf('/');
	if (idx >= 0) opChar = '/';
	else { idx = s.indexOf('-'); if (idx >= 0) opChar = '-'; }

	const parseOperand = (tok) => {
		const t = tok.trim();
		if (NUM_RE.test(t)) return { literal: Number(t) };
		const dot = t.split('.');
		if (dot.length === 2 && NAME_RE.test(dot[0]) && NAME_RE.test(dot[1])) {
			return { name: dot[0], column: dot[1] };
		}
		throw new Error(`metric operand "${t}" is neither a <name>.<column> ref nor a numeric literal`);
	};

	if (opChar === null) {
		const left = parseOperand(s);
		if (left.literal !== undefined) throw new Error(`metric "${s}" has no ref — a bare literal asserts nothing`);
		return { kind: 'single', left, right: null };
	}
	const leftTok = s.slice(0, idx);
	const rightTok = s.slice(idx + 1);
	if (rightTok.includes('/') || rightTok.includes('-')) {
		throw new Error(`metric "${s}" has more than one operator — at most one of / or - is allowed`);
	}
	const left = parseOperand(leftTok);
	const right = parseOperand(rightTok);
	if (left.literal !== undefined && right.literal !== undefined) {
		throw new Error(`metric "${s}" has no ref — a pure-literal expression asserts nothing`);
	}
	return { kind: opChar === '/' ? 'ratio' : 'difference', left, right };
}

// ── select ──────────────────────────────────────────────────────────────────

function compareValues(rowVal, op, val) {
	switch (op) {
		case '==': return rowVal === val;
		case '!=': return rowVal !== val;
		case '>=': return rowVal >= val;
		case '<=': return rowVal <= val;
		case '>': return rowVal > val;
		case '<': return rowVal < val;
		default: throw new Error(`unknown where op "${op}"`);
	}
}

/**
 * Apply a story `select` to breakdown rows → named row-sets. All where-clauses
 * AND together; a plain value means strict equality.
 * @param {Array<Object>} rows
 * @param {Object} select
 * @returns {Record<string, Array<Object>>}
 */
export function selectRows(rows, select) {
	/** @type {Record<string, Array<Object>>} */
	const out = {};
	for (const [name, spec] of Object.entries(select || {})) {
		const where = (spec && spec.where) || {};
		out[name] = (rows || []).filter(row => {
			for (const [col, cond] of Object.entries(where)) {
				if (cond !== null && typeof cond === 'object') {
					if (!compareValues(row[col], cond.op, cond.value)) return false;
				} else if (row[col] !== cond) {
					return false;
				}
			}
			return true;
		});
	}
	return out;
}

function resolveRef(ref, selected) {
	if (ref.literal !== undefined) return ref.literal;
	const rows = selected[ref.name];
	if (!rows) throw new Error(`metric references "${ref.name}" but select has no such row-set`);
	if (!rows.length) throw new Error(`selection "${ref.name}" is empty`);
	if (rows.length > 1 && !isCountLike(ref.column)) {
		throw new Error(`selection "${ref.name}" matched ${rows.length} rows but "${ref.column}" is value-like — single-row selection required`);
	}
	let sum = 0;
	for (const row of rows) {
		const v = row[ref.column];
		if (typeof v !== 'number' || !Number.isFinite(v)) {
			throw new Error(`"${ref.name}.${ref.column}" is not a finite number (got ${JSON.stringify(v)})`);
		}
		sum += v;
	}
	return sum;
}

function cohortOf(rows) {
	if (rows.some(r => typeof r.user_count === 'number')) {
		return rows.reduce((s, r) => s + (typeof r.user_count === 'number' ? r.user_count : 0), 0);
	}
	return rows.length;
}

// ── verdicts ────────────────────────────────────────────────────────────────

function compareOp(obs, op, bound) {
	switch (op) {
		case '>=': return obs >= bound;
		case '<=': return obs <= bound;
		case '>': return obs > bound;
		case '<': return obs < bound;
		default: throw new Error(`unknown op "${op}"`);
	}
}

/**
 * Verdict for one observed value against an expect spec — the mechanical
 * five-tier scale (see module doc). `neutral` is 1 for ratios, 0 for
 * differences, null for single refs.
 * @param {number} observed
 * @param {import('../../types').StoryExpect} expectSpec
 * @param {number|null} neutral
 * @returns {{ verdict: string, detail: string }}
 */
export function verdictFor(observed, expectSpec, neutral) {
	const { op, target, floor } = expectSpec;
	if (op === 'between') {
		const [lo, hi] = /** @type {[number, number]} */ (target);
		if (observed >= lo && observed <= hi) {
			return { verdict: 'NAILED', detail: `observed ${fmt(observed)} within [${lo}, ${hi}]` };
		}
		if (neutral === null || observed === neutral) {
			return { verdict: 'NONE', detail: `observed ${fmt(observed)} outside [${lo}, ${hi}], no direction signal` };
		}
		const mid = (lo + hi) / 2;
		const wantAbove = mid > neutral;
		const isAbove = observed > neutral;
		return wantAbove === isAbove
			? { verdict: 'WEAK', detail: `observed ${fmt(observed)} outside [${lo}, ${hi}] but on the effect side of ${neutral}` }
			: { verdict: 'INVERSE', detail: `observed ${fmt(observed)} on the wrong side of ${neutral} for band [${lo}, ${hi}]` };
	}

	const targetNum = /** @type {number} */ (target);
	if (Math.abs(observed - targetNum) <= 0.1 * Math.abs(targetNum)) {
		return { verdict: 'NAILED', detail: `observed ${fmt(observed)} within ±10% of target ${targetNum}` };
	}
	const bound = typeof floor === 'number' ? floor : targetNum;
	if (compareOp(observed, op, bound)) {
		return { verdict: 'STRONG', detail: `observed ${fmt(observed)} passes ${op} ${bound}` };
	}
	if (neutral === null || observed === neutral) {
		return { verdict: 'NONE', detail: `observed ${fmt(observed)} fails ${op} ${bound}, no direction signal` };
	}
	const wantAbove = op === '>=' || op === '>';
	const isAbove = observed > neutral;
	return wantAbove === isAbove
		? { verdict: 'WEAK', detail: `observed ${fmt(observed)} fails ${op} ${bound} but direction vs ${neutral} is correct` }
		: { verdict: 'INVERSE', detail: `observed ${fmt(observed)} is on the wrong side of ${neutral}` };
}

const fmt = (n) => (typeof n === 'number' && Number.isFinite(n)) ? (Math.abs(n) >= 100 ? n.toFixed(0) : n.toPrecision(4)) : String(n);

/**
 * Evaluate one assertion against breakdown rows. Never throws — authoring or
 * data errors surface as verdict NONE with the error in `detail` (and NONE
 * fails the run, so nothing is silently swallowed).
 * @param {Array<Object>} rows
 * @param {import('../../types').StoryAssertion} assertion
 * @param {Object} [ctx]
 * @returns {{ verdict: string, observed: number|null, detail: string }}
 */
export function evaluateAssertion(rows, assertion, ctx) {
	try {
		if (typeof assertion.assert === 'function') {
			/** @type {{ pass?: boolean, detail?: string, verdict?: import('../../types').StoryVerdict }} */
			const res = assertion.assert(rows, ctx) || {};
			if (res.verdict && VERDICT_RANK[res.verdict] !== undefined) {
				return { verdict: res.verdict, observed: null, detail: res.detail || 'custom assert' };
			}
			return res.pass
				? { verdict: 'STRONG', observed: null, detail: res.detail || 'custom assert passed' }
				: { verdict: 'NONE', observed: null, detail: res.detail || 'custom assert failed' };
		}
		const parsed = parseMetric(assertion.expect.metric);
		const selected = selectRows(rows, assertion.select);
		const left = resolveRef(parsed.left, selected);
		let observed, neutral;
		if (parsed.kind === 'single') {
			observed = left; neutral = null;
		} else {
			const right = resolveRef(parsed.right, selected);
			if (parsed.kind === 'ratio') {
				if (right === 0) throw new Error('ratio denominator is 0');
				observed = left / right; neutral = 1;
			} else {
				observed = left - right; neutral = 0;
			}
		}
		let { verdict, detail } = verdictFor(observed, assertion.expect, neutral);
		if (typeof assertion.minCohort === 'number' && VERDICT_RANK[verdict] > VERDICT_RANK.WEAK) {
			const smallest = Math.min(...Object.values(selected).map(cohortOf));
			if (smallest < assertion.minCohort) {
				verdict = 'WEAK';
				detail += ` — capped: smallest cohort ${smallest} < minCohort ${assertion.minCohort}`;
			}
		}
		return { verdict, observed, detail };
	} catch (err) {
		return { verdict: 'NONE', observed: null, detail: `error: ${err.message}` };
	}
}

// ── validation (mirrors lib/templates/story-spec.schema.json) ───────────────

/**
 * Validate a `stories` export against the pinned grammar. Pure + dependency-free
 * (no ajv): mirrors the JSON schema; a unit test keeps the two in sync.
 * @param {Array<import('../../types').DungeonStory>} stories
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStories(stories) {
	const errors = [];
	const err = (path, msg) => errors.push(`${path}: ${msg}`);
	if (!Array.isArray(stories) || !stories.length) {
		return { valid: false, errors: ['stories: must be a non-empty array'] };
	}
	const seenIds = new Set();
	stories.forEach((story, si) => {
		const sp = `stories[${si}]`;
		if (!story || typeof story !== 'object') return err(sp, 'must be an object');
		if (!story.id || typeof story.id !== 'string') err(sp, 'id: required non-empty string');
		else if (seenIds.has(story.id)) err(sp, `id: duplicate "${story.id}"`);
		else seenIds.add(story.id);
		if (typeof story.hook !== 'string' || !HOOK_RE.test(story.hook.trim())) {
			err(sp, `hook: must match 'H<n>' / 'Hook <n>' / '<n>' (got ${JSON.stringify(story.hook)})`);
		}
		if (!STORY_ARCHETYPES.includes(story.archetype)) {
			err(sp, `archetype: "${story.archetype}" not in the closed enum`);
		}
		if (!story.narrative || typeof story.narrative !== 'string') err(sp, 'narrative: required non-empty string');
		if (story.intentionalDeviations !== undefined && !Array.isArray(story.intentionalDeviations)) {
			err(sp, 'intentionalDeviations: must be an array of strings');
		}
		if (!Array.isArray(story.assertions) || !story.assertions.length) {
			return err(sp, 'assertions: required non-empty array');
		}
		story.assertions.forEach((a, ai) => {
			const ap = `${sp}.assertions[${ai}]`;
			if (!a || typeof a !== 'object') return err(ap, 'must be an object');
			if (!a.breakdown || typeof a.breakdown !== 'object' || typeof a.breakdown.type !== 'string' || !a.breakdown.type) {
				err(ap, 'breakdown: required object with a string `type`');
			} else if (a.breakdown.type === 'duckdb' && (typeof a.breakdown.sql !== 'string' || !a.breakdown.sql)) {
				err(ap, 'breakdown: type "duckdb" requires a non-empty `sql`');
			}
			if (a.expect === undefined && typeof a.assert !== 'function') {
				err(ap, 'requires `expect` or a function-valued `assert`');
			}
			if (a.assert !== undefined && typeof a.assert !== 'function') {
				err(ap, 'assert: must be a function');
			}
			if (a.minCohort !== undefined && (typeof a.minCohort !== 'number' || a.minCohort <= 0)) {
				err(ap, 'minCohort: must be a positive number');
			}
			const selectNames = new Set();
			if (a.select !== undefined) {
				if (!a.select || typeof a.select !== 'object') err(ap, 'select: must be an object');
				else {
					for (const [name, spec] of Object.entries(a.select)) {
						if (!NAME_RE.test(name)) err(ap, `select: name "${name}" must be an identifier`);
						selectNames.add(name);
						if (!spec || typeof spec !== 'object' || !spec.where || typeof spec.where !== 'object' || !Object.keys(spec.where).length) {
							err(ap, `select.${name}: requires a non-empty \`where\``);
							continue;
						}
						for (const [col, cond] of Object.entries(spec.where)) {
							if (cond !== null && typeof cond === 'object') {
								if (!WHERE_OPS.includes(cond.op)) err(ap, `select.${name}.where.${col}: op "${cond.op}" not in ${WHERE_OPS.join(' ')}`);
								if (cond.value === undefined) err(ap, `select.${name}.where.${col}: comparison requires \`value\``);
							}
						}
					}
				}
			}
			if (a.expect !== undefined) {
				const ep = `${ap}.expect`;
				if (!a.expect || typeof a.expect !== 'object') return err(ep, 'must be an object');
				let parsed = null;
				try {
					parsed = parseMetric(a.expect.metric);
				} catch (e) {
					err(ep, `metric: ${e.message}`);
				}
				if (parsed) {
					for (const ref of [parsed.left, parsed.right]) {
						if (ref && ref.name && !selectNames.has(ref.name)) {
							err(ep, `metric references "${ref.name}" — not a select row-set name`);
						}
					}
				}
				if (!EXPECT_OPS.includes(a.expect.op)) err(ep, `op: "${a.expect.op}" not in ${EXPECT_OPS.join(' ')}`);
				if (a.expect.op === 'between') {
					if (!Array.isArray(a.expect.target) || a.expect.target.length !== 2
						|| !a.expect.target.every(n => typeof n === 'number' && Number.isFinite(n))
						|| a.expect.target[0] > a.expect.target[1]) {
						err(ep, 'target: op "between" requires [lo, hi] with lo <= hi');
					}
				} else if (typeof a.expect.target !== 'number' || !Number.isFinite(a.expect.target)) {
					err(ep, `target: must be a finite number (array form is between-only)`);
				}
				if (a.expect.floor !== undefined && (typeof a.expect.floor !== 'number' || !Number.isFinite(a.expect.floor))) {
					err(ep, 'floor: must be a finite number');
				}
			}
		});
	});
	return { valid: errors.length === 0, errors };
}

// ── adapters ────────────────────────────────────────────────────────────────

/**
 * Convert stories into `verifyDungeon` checks for in-memory mode. Each
 * assertion becomes one check named `<storyId>[<i>]`; pass = NAILED or STRONG
 * (the verdict lands in `detail`). duckdb assertions are disk-mode-only —
 * skipped here with a warning. Throws on invalid stories.
 * @param {Array<import('../../types').DungeonStory>} stories
 * @returns {Array<Object>}
 */
export function storiesToChecks(stories) {
	const v = validateStories(stories);
	if (!v.valid) {
		throw new Error(`storiesToChecks: invalid stories:\n  ${v.errors.join('\n  ')}`);
	}
	const checks = [];
	for (const story of stories) {
		story.assertions.forEach((assertion, i) => {
			const name = `${story.id}[${i}]`;
			if (assertion.breakdown.type === 'duckdb') {
				console.warn(`[dungeon-master] ${name}: duckdb assertions only run in disk mode (scripts/verify-stories.mjs) — skipped in-memory.`);
				return;
			}
			checks.push({
				name,
				breakdown: assertion.breakdown,
				assert: (rows, ctx) => {
					const res = evaluateAssertion(rows, assertion, ctx);
					return {
						pass: VERDICT_RANK[res.verdict] >= VERDICT_RANK.STRONG,
						detail: `${res.verdict} — ${res.detail}`,
					};
				},
			});
		});
	}
	return checks;
}

/**
 * Evaluate stories against an already-loaded event set (disk mode). Funnel
 * options auto-thread exactly as in `verifyDungeon` (via `applyFunnelDefaults`).
 * @param {Array<import('../../types').DungeonStory>} stories
 * @param {Array<Object>} events
 * @param {Object} [opts]
 * @param {Array<Object>} [opts.profiles]
 * @param {Array<Object>} [opts.funnels] - VALIDATED dungeon funnels.
 * @param {(sql: string) => Promise<Array<Object>>} [opts.runSql] - duckdb
 *   executor (provided by the CLI in disk mode). Absent → duckdb assertions
 *   report NONE with an explanatory detail.
 * @returns {Promise<Array<{ id: string, hook: string, archetype: string, verdict: string, assertions: Array<{ name: string, verdict: string, observed: number|null, detail: string }> }>>}
 */
export async function evaluateStories(stories, events, opts) {
	const { profiles, funnels, runSql } = opts || {};
	const v = validateStories(stories);
	if (!v.valid) {
		throw new Error(`evaluateStories: invalid stories:\n  ${v.errors.join('\n  ')}`);
	}
	const out = [];
	for (const story of stories) {
		const results = [];
		for (let i = 0; i < story.assertions.length; i++) {
			const assertion = story.assertions[i];
			const name = `${story.id}[${i}]`;
			let rows;
			try {
				if (assertion.breakdown.type === 'duckdb') {
					if (!runSql) {
						results.push({ name, verdict: 'NONE', observed: null, detail: 'duckdb assertion requires disk mode (no SQL executor available)' });
						continue;
					}
					rows = await runSql(assertion.breakdown.sql);
				} else {
					rows = emulateBreakdown(events, applyFunnelDefaults(assertion.breakdown, funnels, profiles));
				}
			} catch (err) {
				results.push({ name, verdict: 'NONE', observed: null, detail: `error: ${err.message}` });
				continue;
			}
			const res = evaluateAssertion(rows, assertion, { events, profiles });
			results.push({ name, ...res });
		}
		const worst = results.reduce((w, r) => VERDICT_RANK[r.verdict] < VERDICT_RANK[w] ? r.verdict : w, 'NAILED');
		out.push({ id: story.id, hook: story.hook, archetype: story.archetype, verdict: worst, assertions: results });
	}
	return out;
}
