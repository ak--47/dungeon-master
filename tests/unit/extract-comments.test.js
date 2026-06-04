//@ts-nocheck
/**
 * Unit tests for the `extractComments` export (lib/core/extract-comments.js).
 * Text-input only — pure string parsing, no file I/O. File input is covered in
 * tests/integration/json-interop.test.js.
 */
import { describe, test, expect } from 'vitest';
import { extractComments } from '../../index.js';

// Canonical dungeon header convention: `// ── LABEL ──` + a block comment.
const SRC = [
	'// ── IMPORTS ──',
	'import dayjs from "dayjs";',
	'',
	'// ── OVERVIEW ──',
	'/*',
	' * NAME:       Acme',
	' * APP:        widget tracker',
	' */',
	'',
	'// ── HOOK STORIES ──',
	'/*',
	' * 1. POWER USERS (everything)',
	' *    big spenders buy 3x',
	' */',
	'',
	'const config = { numUsers: 10 };',
	'export default config;',
].join('\n');

describe('extractComments (text input)', () => {
	test('extracts OVERVIEW + HOOK STORIES as cleaned prose', () => {
		const { overview, hookStories } = extractComments(SRC);
		expect(overview).toBe('NAME:       Acme\nAPP:        widget tracker');
		expect(hookStories).toContain('POWER USERS');
		expect(hookStories).toContain('big spenders buy 3x');
		// scaffolding stripped
		expect(overview).not.toContain('/*');
		expect(overview).not.toMatch(/^\s*\*/m);
	});

	test('sections map keyed by exact label — code-followed headers excluded', () => {
		const { sections } = extractComments(SRC);
		// IMPORTS is followed by code (not a block comment) → not captured.
		expect(Object.keys(sections).sort()).toEqual(['HOOK STORIES', 'OVERVIEW']);
	});

	test('inner ── dividers are not mistaken for section headers', () => {
		const withDivider = [
			'// ── HOOK STORIES ──',
			'/*',
			' * ─────────────────────────────',
			' * 1. THING (event)',
			' * ─────────────────────────────',
			' */',
		].join('\n');
		const { hookStories, sections } = extractComments(withDivider);
		expect(Object.keys(sections)).toEqual(['HOOK STORIES']);
		expect(hookStories).toContain('1. THING (event)');
	});

	test('missing blocks → null overview/hookStories, empty sections', () => {
		const r = extractComments('const x = 1;\nexport default {};');
		expect(r.overview).toBeNull();
		expect(r.hookStories).toBeNull();
		expect(r.sections).toEqual({});
	});

	test('throws on a config object (comments are lost once imported)', () => {
		expect(() => extractComments({ numUsers: 10 })).toThrow(/source text or a file path/);
	});
});
