/**
 * Best-effort extraction of the human-readable doc blocks from a dungeon's SOURCE.
 *
 * Generated/authored dungeons separate sections with box-drawing headers followed by a
 * block comment, e.g.:
 *
 *   // ── OVERVIEW ──
 *   /* ... *\/
 *   // ── HOOK STORIES ──
 *   /* ... *\/
 *
 * This pulls those blocks out as cleaned prose. It operates on RAW SOURCE TEXT — it never
 * imports the dungeon, because importing a module discards its comments.
 *
 * Returns `{ overview, hookStories, sections }`:
 *   - `overview`    — cleaned text of the OVERVIEW block (or null)
 *   - `hookStories` — cleaned text of the HOOK STORIES block (or null)
 *   - `sections`    — every `// ── LABEL ──` header that is immediately followed by a
 *                     block comment, keyed by the exact label as written.
 */

import { readFileSync } from 'fs';
import { detectInputType } from './dungeon-loader.js';

// A `// ── LABEL ──` header line. Anchored to `//` at line start so that the inner
// ` * ───────` dividers inside a block comment are NOT mistaken for section headers.
const HEADER_RE = /^[ \t]*\/\/[ \t]*─+[ \t]*(.+?)[ \t]*─+[ \t]*$/gm;

/**
 * @param {string | string[]} input - A dungeon file path, raw dungeon source, or array of paths.
 * @returns {import('../../types').DungeonComments | import('../../types').DungeonComments[]}
 */
export function extractComments(input) {
	const { type, value } = detectInputType(input);

	switch (type) {
		case 'file':
			return parseSource(readFileSync(value, 'utf-8'));
		case 'text':
			return parseSource(value);
		case 'files':
			return value.map((p) => parseSource(readFileSync(p, 'utf-8')));
		case 'object':
			throw new Error(
				'dungeon-master: extractComments needs source text or a file path, not a config object (comments are lost once a dungeon is imported).'
			);
		default:
			throw new Error(`dungeon-master: extractComments cannot handle input type "${type}".`);
	}
}

/**
 * Parse a single source string into `{ overview, hookStories, sections }`.
 * @param {string} source
 * @returns {import('../../types').DungeonComments}
 */
function parseSource(source) {
	/** @type {Record<string, string>} */
	const sections = {};

	// Collect every header with its label and the position right after its line.
	const headers = [];
	HEADER_RE.lastIndex = 0;
	let m;
	while ((m = HEADER_RE.exec(source)) !== null) {
		headers.push({ label: m[1].trim(), end: HEADER_RE.lastIndex });
	}

	for (let i = 0; i < headers.length; i++) {
		const { label, end } = headers[i];
		// Only look between this header and the next one.
		const sliceEnd = i + 1 < headers.length ? headers[i + 1].end : source.length;
		const slice = source.slice(end, sliceEnd);

		// Accept the block only if a `/* ... */` comment is the first non-whitespace content
		// after the header (so headers followed by code — IMPORTS, SCALE — are skipped).
		const block = slice.match(/^\s*\/\*([\s\S]*?)\*\//);
		if (block) {
			sections[label] = cleanBlock(block[1]);
		}
	}

	return {
		overview: findSection(sections, ['OVERVIEW']),
		hookStories: findSection(sections, ['HOOK STORIES', 'HOOK STORY']),
		sections
	};
}

/**
 * Strip block-comment scaffolding (` * `) and trim blank edges, leaving readable prose.
 * @param {string} inner - The text between `/*` and `*\/`.
 * @returns {string}
 */
function cleanBlock(inner) {
	const lines = inner
		.split('\n')
		// Drop a leading ` * ` (or bare ` *`) from each line; preserve content indentation.
		.map((line) => line.replace(/^[ \t]*\*[ \t]?/, '').replace(/\s+$/, ''));

	// Trim leading/trailing blank lines.
	while (lines.length && lines[0] === '') lines.shift();
	while (lines.length && lines[lines.length - 1] === '') lines.pop();

	return lines.join('\n');
}

/**
 * Case-insensitive lookup of the first matching label.
 * @param {Record<string, string>} sections
 * @param {string[]} candidates
 * @returns {string | null}
 */
function findSection(sections, candidates) {
	const wanted = candidates.map((c) => c.toUpperCase());
	for (const [label, text] of Object.entries(sections)) {
		if (wanted.includes(label.toUpperCase())) return text;
	}
	return null;
}
