//@ts-nocheck
/**
 * P3.3 story-runner unit tests. Every expected verdict below is hand-derived
 * from the five-tier contract (SPEC P3.2), never from running the runner:
 *
 *   NAILED  |obs − target| ≤ 0.1·|target|  (between: obs in [lo, hi])
 *   STRONG  passes floor (or target when no floor)
 *   WEAK    fails floor, direction correct — or cohort < minCohort cap
 *   NONE    empty selection / not computable / at neutral / single-ref fail
 *   INVERSE direction opposite
 *
 * Fixture rows mimic an aggregatePerUser breakdown table.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
	STORY_ARCHETYPES,
	VERDICT_RANK,
	parseMetric,
	selectRows,
	evaluateAssertion,
	validateStories,
	storiesToChecks,
	evaluateStories,
} from '../../lib/verify/story-runner.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

// avg_aggregate ratio fraud/clean = 30/10 = 3.0 exactly — chosen so the
// NAILED / STRONG / WEAK boundaries below are hand-checkable.
const ROWS = [
	{ segment_value: 'fraud', avg_aggregate: 30, user_count: 200 },
	{ segment_value: 'clean', avg_aggregate: 10, user_count: 500 },
];
const SELECT = {
	fraud: { where: { segment_value: 'fraud' } },
	clean: { where: { segment_value: 'clean' } },
};
const RATIO = 'fraud.avg_aggregate / clean.avg_aggregate';
const assertion = (expectSpec, extra = {}) => ({
	breakdown: { type: 'aggregatePerUser' },
	select: SELECT,
	expect: expectSpec,
	...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('parseMetric — pinned grammar', () => {
	test('three forms parse; kind is correct', () => {
		expect(parseMetric('fraud.avg')).toEqual({ kind: 'single', left: { name: 'fraud', column: 'avg' }, right: null });
		expect(parseMetric(RATIO).kind).toBe('ratio');
		expect(parseMetric('a.x - b.y').kind).toBe('difference');
		expect(parseMetric('a.x / 2')).toEqual({ kind: 'ratio', left: { name: 'a', column: 'x' }, right: { literal: 2 } });
	});
	test('rejects: chained ops, other ops, no-ref, deep paths', () => {
		expect(() => parseMetric('a.b / c.d / e.f')).toThrow(/more than one operator/);
		expect(() => parseMetric('a.b + c.d')).toThrow();
		expect(() => parseMetric('3.5')).toThrow(/no ref/);
		expect(() => parseMetric('2 / 4')).toThrow(/no ref/);
		expect(() => parseMetric('a.b.c')).toThrow();
	});
});

describe('selectRows', () => {
	test('equality and comparison clauses AND together', () => {
		const sel = selectRows(ROWS, {
			big: { where: { user_count: { op: '>', value: 100 } } },
			fraudBig: { where: { segment_value: 'fraud', user_count: { op: '>', value: 100 } } },
			none: { where: { segment_value: 'nope' } },
		});
		expect(sel.big).toHaveLength(2);
		expect(sel.fraudBig).toHaveLength(1);
		expect(sel.none).toHaveLength(0);
	});
});

describe('evaluateAssertion — verdict bands (hand-computed)', () => {
	test('NAILED: obs 3.0, target 3.0 (±10% band [2.7, 3.3])', () => {
		const r = evaluateAssertion(ROWS, assertion({ metric: RATIO, op: '>=', target: 3.0, floor: 2.4 }));
		expect(r.verdict).toBe('NAILED');
		expect(r.observed).toBeCloseTo(3.0);
	});
	test('NAILED even slightly below target: obs 3.0 vs target 3.2 (band [2.88, 3.52])', () => {
		const r = evaluateAssertion(ROWS, assertion({ metric: RATIO, op: '>=', target: 3.2, floor: 2.4 }));
		expect(r.verdict).toBe('NAILED');
	});
	test('STRONG: obs 3.0 vs target 4.0 (band [3.6, 4.4] misses) but >= floor 2.4', () => {
		const r = evaluateAssertion(ROWS, assertion({ metric: RATIO, op: '>=', target: 4.0, floor: 2.4 }));
		expect(r.verdict).toBe('STRONG');
	});
	test('no floor → target doubles as floor: obs 3.0 vs target 2.0 → STRONG (band [1.8, 2.2] misses, 3 >= 2)', () => {
		const r = evaluateAssertion(ROWS, assertion({ metric: RATIO, op: '>=', target: 2.0 }));
		expect(r.verdict).toBe('STRONG');
	});
	test('WEAK: obs 3.0 fails floor 5 but ratio > 1 (direction correct)', () => {
		const r = evaluateAssertion(ROWS, assertion({ metric: RATIO, op: '>=', target: 6.0, floor: 5.0 }));
		expect(r.verdict).toBe('WEAK');
	});
	test('INVERSE: obs 1/3 < 1 with op >= (clean/fraud inverted ref order)', () => {
		const r = evaluateAssertion(ROWS, assertion({ metric: 'clean.avg_aggregate / fraud.avg_aggregate', op: '>=', target: 3.0, floor: 2.4 }));
		expect(r.observed).toBeCloseTo(1 / 3);
		expect(r.verdict).toBe('INVERSE');
	});
	test('NONE: empty selection', () => {
		const r = evaluateAssertion(ROWS, assertion(
			{ metric: 'ghost.avg_aggregate / clean.avg_aggregate', op: '>=', target: 3.0 },
			{ select: { ...SELECT, ghost: { where: { segment_value: 'nope' } } } },
		));
		expect(r.verdict).toBe('NONE');
		expect(r.detail).toMatch(/empty/);
	});
	test('NONE: single-ref fails floor (no neutral point, no direction test)', () => {
		// fraud.user_count = 200; target 1000, floor 900 → fails; single ref → NONE.
		const r = evaluateAssertion(ROWS, assertion({ metric: 'fraud.user_count', op: '>=', target: 1000, floor: 900 }));
		expect(r.observed).toBe(200);
		expect(r.verdict).toBe('NONE');
	});
	test('minCohort cap: NAILED demotes to WEAK when smallest cohort short', () => {
		// fraud cohort = 200 < 300 → cap. clean = 500 is fine; SMALLEST governs.
		const r = evaluateAssertion(ROWS, assertion(
			{ metric: RATIO, op: '>=', target: 3.0, floor: 2.4 },
			{ minCohort: 300 },
		));
		expect(r.verdict).toBe('WEAK');
		expect(r.detail).toMatch(/minCohort/);
	});
	test('minCohort does NOT rescue NONE/INVERSE (cap only demotes)', () => {
		const r = evaluateAssertion(ROWS, assertion(
			{ metric: 'clean.avg_aggregate / fraud.avg_aggregate', op: '>=', target: 3.0 },
			{ minCohort: 300 },
		));
		expect(r.verdict).toBe('INVERSE');
	});
	test('multi-row selection: count-like column sums, value-like errors → NONE', () => {
		const both = { all: { where: { user_count: { op: '>', value: 0 } } } };
		const sum = evaluateAssertion(ROWS, assertion(
			{ metric: 'all.user_count', op: '>=', target: 700 },
			{ select: both },
		));
		expect(sum.observed).toBe(700); // 200 + 500, hand-summed
		expect(sum.verdict).toBe('NAILED');
		const bad = evaluateAssertion(ROWS, assertion(
			{ metric: 'all.avg_aggregate', op: '>=', target: 20 },
			{ select: both },
		));
		expect(bad.verdict).toBe('NONE');
		expect(bad.detail).toMatch(/value-like/);
	});
	test('between: in band NAILED; outside band but right side of neutral WEAK; wrong side INVERSE', () => {
		expect(evaluateAssertion(ROWS, assertion({ metric: RATIO, op: 'between', target: [2.5, 3.5] })).verdict).toBe('NAILED');
		expect(evaluateAssertion(ROWS, assertion({ metric: RATIO, op: 'between', target: [4, 5] })).verdict).toBe('WEAK');
		expect(evaluateAssertion(ROWS, assertion({ metric: 'clean.avg_aggregate / fraud.avg_aggregate', op: 'between', target: [4, 5] })).verdict).toBe('INVERSE');
	});
	test('difference metric: neutral 0; obs 20 vs target 20 → NAILED', () => {
		const r = evaluateAssertion(ROWS, assertion({ metric: 'fraud.avg_aggregate - clean.avg_aggregate', op: '>=', target: 20 }));
		expect(r.observed).toBe(20);
		expect(r.verdict).toBe('NAILED');
	});
	test('custom assert escape hatch: verdict passthrough; pass maps STRONG / fail maps NONE', () => {
		const mk = (assertFn) => evaluateAssertion(ROWS, { breakdown: { type: 'x' }, assert: assertFn });
		expect(mk(() => ({ pass: true })).verdict).toBe('STRONG');
		expect(mk(() => ({ pass: false })).verdict).toBe('NONE');
		expect(mk(() => ({ pass: false, verdict: 'INVERSE' })).verdict).toBe('INVERSE');
	});
});

describe('validateStories — mirrors the JSON schema', () => {
	const goodStory = () => ({
		id: 'H1-test',
		hook: 'H1',
		archetype: 'cohort-count-scale',
		narrative: 'test story',
		assertions: [assertion({ metric: RATIO, op: '>=', target: 3.0, floor: 2.4 })],
	});
	test('valid story passes', () => {
		expect(validateStories([goodStory()])).toEqual({ valid: true, errors: [] });
	});
	test('catches: bad archetype, bad hook, duplicate id, metric ref not in select, between misuse, duckdb without sql', () => {
		const bad = [
			{ ...goodStory(), archetype: 'made-up' },
			{ ...goodStory(), hook: 'X9' },
			goodStory(),
			goodStory(), // duplicate id
			{ ...goodStory(), id: 'H2-refs', assertions: [assertion({ metric: 'ghost.x / clean.avg_aggregate', op: '>=', target: 1 })] },
			{ ...goodStory(), id: 'H3-between', assertions: [assertion({ metric: RATIO, op: '>=', target: [1, 2] })] },
			{ ...goodStory(), id: 'H4-duck', assertions: [{ breakdown: { type: 'duckdb' }, expect: { metric: RATIO, op: '>=', target: 1 }, select: SELECT }] },
		];
		const { valid, errors } = validateStories(bad);
		expect(valid).toBe(false);
		expect(errors.join('\n')).toMatch(/archetype/);
		expect(errors.join('\n')).toMatch(/hook/);
		expect(errors.join('\n')).toMatch(/duplicate/);
		expect(errors.join('\n')).toMatch(/"ghost"/);
		expect(errors.join('\n')).toMatch(/array form is between-only/);
		expect(errors.join('\n')).toMatch(/requires a non-empty `sql`/);
	});
	test('assertion needs expect or assert', () => {
		const { valid, errors } = validateStories([{ ...goodStory(), assertions: [{ breakdown: { type: 'x' } }] }]);
		expect(valid).toBe(false);
		expect(errors.join('\n')).toMatch(/`expect` or a function-valued `assert`/);
	});
});

describe('storiesToChecks / evaluateStories', () => {
	const story = {
		id: 'H1-ratio',
		hook: 'H1',
		archetype: 'cohort-prop-scale',
		narrative: 'fraud segment 3x avg',
		assertions: [
			assertion({ metric: RATIO, op: '>=', target: 3.0, floor: 2.4 }),
			assertion({ metric: RATIO, op: '>=', target: 6.0, floor: 5.0 }), // hand-computed WEAK
		],
	};
	test('storiesToChecks: one check per assertion, pass = NAILED|STRONG, verdict in detail', () => {
		const checks = storiesToChecks([story]);
		expect(checks.map(c => c.name)).toEqual(['H1-ratio[0]', 'H1-ratio[1]']);
		const r0 = checks[0].assert(ROWS, {});
		expect(r0.pass).toBe(true);
		expect(r0.detail).toMatch(/^NAILED/);
		const r1 = checks[1].assert(ROWS, {});
		expect(r1.pass).toBe(false);
		expect(r1.detail).toMatch(/^WEAK/);
	});
	test('storiesToChecks: duckdb assertions skipped with a warning; invalid stories throw', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const withDuck = {
			...story,
			assertions: [...story.assertions, { breakdown: { type: 'duckdb', sql: 'select 1' }, assert: () => ({ pass: true }) }],
		};
		expect(storiesToChecks([withDuck])).toHaveLength(2);
		expect(warn.mock.calls.some(c => String(c[0]).includes('disk mode'))).toBe(true);
		expect(() => storiesToChecks([{ ...story, archetype: 'nope' }])).toThrow(/invalid stories/);
	});
	test('evaluateStories: story verdict = worst assertion; duckdb without executor → NONE', async () => {
		// Events crafted so eventBreakdown(purchase by plan) yields
		// clean.count / fraud.count = 5 / 2 = 2.5 exactly (hand-computed).
		const events = [];
		let t = Date.parse('2024-01-01T00:00:00Z');
		const push = (uid, plan) => events.push({
			event: 'purchase', user_id: uid, distinct_id: uid, plan,
			time: new Date((t += 60_000)).toISOString(), insert_id: `e${events.length}`,
		});
		for (let i = 0; i < 2; i++) push(`fraud_${i}`, 'fraud');
		for (let i = 0; i < 5; i++) push(`clean_${i}`, 'clean');
		const st = {
			id: 'H2-breakdown',
			hook: 'H2',
			archetype: 'composition-drift',
			narrative: 'clean purchases outnumber fraud 2.5x',
			assertions: [
				{
					breakdown: { type: 'eventBreakdown', event: 'purchase', breakdownProperty: 'plan' },
					select: { fraud: { where: { value: 'fraud' } }, clean: { where: { value: 'clean' } } },
					expect: { metric: 'clean.count / fraud.count', op: '>=', target: 2.5, floor: 2.0 },
				},
				{ breakdown: { type: 'duckdb', sql: 'select 1' }, assert: () => ({ pass: true }) },
			],
		};
		const [res] = await evaluateStories([st], events, {});
		expect(res.assertions[0].observed).toBeCloseTo(2.5);
		expect(res.assertions[0].verdict).toBe('NAILED');
		expect(res.assertions[1].verdict).toBe('NONE');
		expect(res.assertions[1].detail).toMatch(/disk mode/);
		expect(res.verdict).toBe('NONE'); // worst of NAILED, NONE
	});
	test('VERDICT_RANK ordering pinned: INVERSE < NONE < WEAK < STRONG < NAILED', () => {
		expect(VERDICT_RANK).toEqual({ INVERSE: 0, NONE: 1, WEAK: 2, STRONG: 3, NAILED: 4 });
	});
	test('STORY_ARCHETYPES stays in sync with the JSON schema enum', () => {
		const schema = JSON.parse(readFileSync(path.join(ROOT, 'lib/templates/story-spec.schema.json'), 'utf-8'));
		expect(STORY_ARCHETYPES).toEqual(schema.definitions.story.properties.archetype.enum);
	});
});
