//@ts-nocheck
/**
 * P3.2: story-spec schema integrity. The archetype enum, verdict tiers, and
 * expect grammar are PINNED by the 1.6.0 spec — the expected values below are
 * hand-copied from the spec, not read from the implementation, so drift in
 * either the schema file or types.d.ts fails here.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const schema = JSON.parse(readFileSync(path.join(ROOT, 'lib/templates/story-spec.schema.json'), 'utf-8'));
const typesSource = readFileSync(path.join(ROOT, 'types.d.ts'), 'utf-8');

// Hand-copied from SPEC P3.2 — the closed enum, in spec order.
const ARCHETYPES = [
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

const VERDICTS = ['NAILED', 'STRONG', 'WEAK', 'NONE', 'INVERSE'];

describe('P3.2 story-spec schema', () => {
	test('archetype enum matches the spec (14 values, closed)', () => {
		expect(schema.definitions.story.properties.archetype.enum).toEqual(ARCHETYPES);
	});

	test('story requires id, hook, archetype, narrative, assertions', () => {
		expect(schema.definitions.story.required.sort()).toEqual(
			['archetype', 'assertions', 'hook', 'id', 'narrative'],
		);
		expect(schema.definitions.story.additionalProperties).toBe(false);
	});

	test('expect grammar: op enum and required fields pinned', () => {
		expect(schema.definitions.expect.properties.op.enum).toEqual(['>=', '<=', '>', '<', 'between']);
		expect(schema.definitions.expect.required.sort()).toEqual(['metric', 'op', 'target']);
	});

	test('assertion requires breakdown plus expect-or-assert', () => {
		expect(schema.definitions.assertion.required).toEqual(['breakdown']);
		expect(schema.definitions.assertion.anyOf).toEqual([
			{ required: ['expect'] },
			{ required: ['assert'] },
		]);
	});

	test('metric pattern accepts exactly the three pinned forms', () => {
		const re = new RegExp(schema.definitions.expect.properties.metric.pattern);
		// Valid: single ref, ratio, difference, numeric-literal operand.
		expect(re.test('fraud.avg')).toBe(true);
		expect(re.test('fraud.avg / clean.avg')).toBe(true);
		expect(re.test('post.user_count - pre.user_count')).toBe(true);
		expect(re.test('fraud.avg / 2')).toBe(true);
		// Invalid: other operators, chained operators, free-form expressions.
		expect(re.test('a.b + c.d')).toBe(false);
		expect(re.test('a.b * c.d')).toBe(false);
		expect(re.test('a.b / c.d / e.f')).toBe(false);
		expect(re.test('rows[0].x')).toBe(false);
		expect(re.test('a.b.c')).toBe(false);
		expect(re.test('Math.max(a.b, 1)')).toBe(false);
	});

	test('where-clause comparison op set pinned', () => {
		const whereSchema = schema.definitions.assertion.properties.select
			.additionalProperties.properties.where.additionalProperties;
		expect(whereSchema.oneOf[1].properties.op.enum).toEqual(['==', '!=', '>=', '<=', '>', '<']);
	});

	test('duckdb escape hatch requires sql; {{PREFIX}} convention documented', () => {
		const bd = schema.definitions.breakdown;
		expect(bd.then.required).toEqual(['type', 'sql']);
		expect(bd.then.properties.sql.description).toContain('{{PREFIX}}');
	});

	test('types.d.ts declares the same archetypes and verdict tiers', () => {
		for (const a of ARCHETYPES) expect(typesSource).toContain(`"${a}"`);
		for (const v of VERDICTS) expect(typesSource).toContain(`"${v}"`);
		expect(typesSource).toContain('export interface DungeonStory');
		expect(typesSource).toContain('export interface StoryAssertion');
	});
});
