//@ts-nocheck
/**
 * Integration tests for the JSON/source interop exports against a shipped dungeon.
 * Exercises file-path + array input (file I/O via loadFromFile / readFileSync) —
 * no full generation pass, no writeToDisk.
 */
import { describe, test, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { dungeonToJSON, parseJSONDungeon, extractComments } from '../../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECOM = path.resolve(__dirname, '../../dungeons/vertical/ecommerce/ecommerce.js');

describe('dungeonToJSON (file input)', () => {
	test('serializes a shipped dungeon and round-trips through parseJSONDungeon', async () => {
		const json = await dungeonToJSON(ECOM);
		expect(json.version).toBe('4.0');
		expect(Array.isArray(json.schema.events)).toBe(true);
		expect(json.schema.events.length).toBeGreaterThan(0);
		// ecommerce.js defines a hook (method shorthand) → serialized to a string.
		expect(typeof json.hooks).toBe('string');
		// credentials never present in the shipped file, and stripped regardless.
		expect(json.schema).not.toHaveProperty('token');

		const config = parseJSONDungeon(json);
		expect(config.events.length).toBe(json.schema.events.length);
		expect(typeof config.hook).toBe('string');
	});

	test('array of paths → array of results', async () => {
		const arr = await dungeonToJSON([ECOM, ECOM]);
		expect(arr).toHaveLength(2);
		expect(arr[0].version).toBe('4.0');
		expect(arr[1].schema.events.length).toBeGreaterThan(0);
	});

	test('the `stories` named export is NOT carried into JSON (the .js file stays the story source of record)', async () => {
		// ecommerce.js exports `stories` alongside the default config; the
		// loader only reads the default export, so JSON output must not grow
		// a stories key. If story round-tripping is ever wanted, it needs a
		// deliberate wrapper field + json-to-dungeon support — not a silent
		// schema leak.
		const mod = await import(ECOM);
		expect(Array.isArray(mod.stories)).toBe(true);
		expect(mod.stories.length).toBeGreaterThan(0);

		const json = await dungeonToJSON(ECOM);
		expect(json.schema).not.toHaveProperty('stories');
	});
});

describe('extractComments (file input)', () => {
	test('pulls OVERVIEW + HOOK STORIES from a shipped dungeon', () => {
		const { overview, hookStories, sections } = extractComments(ECOM);
		expect(overview).toBeTruthy();
		expect(overview).toContain('NAME:');
		expect(overview).not.toContain('/*');
		expect(hookStories).toBeTruthy();
		expect(Object.keys(sections).length).toBeGreaterThanOrEqual(2);
		expect(sections).toHaveProperty('OVERVIEW');
		expect(sections).toHaveProperty('HOOK STORIES');
	});
});
