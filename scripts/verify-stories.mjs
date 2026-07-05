#!/usr/bin/env node
/**
 * verify-stories — evaluate a dungeon's `stories` named export against its
 * generated data and print a five-tier verdict table (v1.6, P3.3).
 *
 * Stories are JS-dungeon-only: `stories` must be a NAMED export of a .js/.mjs
 * dungeon file (JSON dungeons cannot carry `assert` functions or comment-block
 * hook stories). The dungeon is loaded with dynamic import(), not the
 * dungeon-loader.
 *
 * Modes:
 *   disk (default) — streams already-generated shards from
 *     ./data/<prefix>-EVENTS*.json and ./data/<prefix>-USERS*.json
 *     (generate first: node scripts/verify-runner.mjs <dungeon-path> <prefix>).
 *     duckdb assertions shell out to the `duckdb` CLI with {{PREFIX}}
 *     substituted by the data prefix path.
 *   --in-memory — runs the dungeon fresh at its configured scale via
 *     verifyDungeon(config, storiesToChecks(stories)). duckdb assertions are
 *     disk-mode-only and are skipped with a warning.
 *
 * Coverage discipline: every numbered hook in the dungeon's HOOK STORIES
 * comment block (lines mentioning `H<n>` / `Hook <n>`) must be targeted by at
 * least one story. Missing hooks fail the run with a coverage report.
 *
 * Exit code: non-zero when any story lands WEAK / NONE / INVERSE, when
 * coverage is incomplete, or (in-memory) when the schema report fails.
 *
 * Usage:
 *   node scripts/verify-stories.mjs <dungeon-path> [--data-prefix <prefix>] [--in-memory] [--json]
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import { extractComments } from '../lib/core/extract-comments.js';
import { validateDungeonConfig } from '../lib/core/config-validator.js';
import {
	buildIdentityMap,
	verifyDungeon,
	VERDICT_RANK,
	validateStories,
	storiesToChecks,
	evaluateStories,
} from '../lib/verify/index.js';

const USAGE = `Usage: node scripts/verify-stories.mjs <dungeon-path> [--data-prefix <prefix>] [--in-memory] [--json]

  <dungeon-path>          .js/.mjs dungeon with a \`stories\` named export (JS-only —
                          JSON dungeons cannot carry stories).
  --data-prefix <prefix>  shard prefix under ./data (default: verify-<dungeon-name>).
                          Disk mode reads ./data/<prefix>-EVENTS*.json + -USERS*.json.
  --in-memory             run the dungeon fresh via verifyDungeon instead of reading
                          shards. duckdb assertions are skipped (disk-mode-only).
  --json                  print machine-readable JSON instead of the verdict table.`;

// ── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
let dungeonPath = null, dataPrefix = null, inMemory = false, asJson = false;
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
	else if (a === '--in-memory') inMemory = true;
	else if (a === '--json') asJson = true;
	else if (a === '--data-prefix') {
		dataPrefix = argv[++i];
		if (!dataPrefix || dataPrefix.startsWith('--')) die('--data-prefix requires a value');
	}
	else if (a.startsWith('--')) die(`unknown flag ${a}`);
	else if (!dungeonPath) dungeonPath = a;
	else die(`unexpected argument ${a}`);
}
if (!dungeonPath) die(USAGE);

function die(msg) {
	console.error(msg);
	process.exit(1);
}

// ── load dungeon + stories ──────────────────────────────────────────────────

const abs = path.isAbsolute(dungeonPath) ? dungeonPath : path.resolve(process.cwd(), dungeonPath);
if (!/\.(js|mjs)$/.test(abs)) {
	die(`verify-stories: "${dungeonPath}" is not a .js/.mjs dungeon — stories are JS-dungeon-only (a JSON dungeon cannot carry a \`stories\` export).`);
}
if (!fs.existsSync(abs)) die(`verify-stories: dungeon not found at ${abs}`);

const mod = await import(pathToFileURL(abs).href);
const config = mod.default;
const stories = mod.stories;
if (!config || typeof config !== 'object') die(`verify-stories: ${dungeonPath} has no default-exported config object`);
if (!Array.isArray(stories) || !stories.length) {
	die(`verify-stories: ${dungeonPath} has no \`stories\` named export — add one (see lib/templates/story-spec.schema.json) or use scripts/verify-runner.mjs for ad-hoc checks.`);
}
const sv = validateStories(stories);
if (!sv.valid) die(`verify-stories: invalid stories:\n  ${sv.errors.join('\n  ')}`);

// ── coverage discipline ─────────────────────────────────────────────────────
// Every numbered hook in the HOOK STORIES comment block needs >=1 story. One
// id per line (first match): hook-story blocks lead each entry with its label.

const HOOK_LINE_RE = /\b(?:H|Hook\s*)(\d+)\b/i;
const STORY_HOOK_RE = /^(?:H|Hook\s*)?(\d+)$/i;
const declared = new Set();
const comments = extractComments(abs);
const hookStoriesText = Array.isArray(comments) ? null : comments.hookStories;
if (hookStoriesText) {
	for (const line of hookStoriesText.split('\n')) {
		const m = line.match(HOOK_LINE_RE);
		if (m) declared.add(Number(m[1]));
	}
}
const covered = new Set();
for (const s of stories) {
	const m = String(s.hook || '').trim().match(STORY_HOOK_RE);
	if (m) covered.add(Number(m[1]));
}
const missing = [...declared].filter(n => !covered.has(n)).sort((a, b) => a - b);
const coverage = {
	declared: [...declared].sort((a, b) => a - b),
	covered: [...covered].sort((a, b) => a - b),
	missing,
	note: hookStoriesText ? undefined : 'no HOOK STORIES comment block found — coverage check skipped',
};

// ── evaluate ────────────────────────────────────────────────────────────────

let storyResults;   // Array<{ id, hook, archetype, verdict, assertions }>
let schemaPass = true;

if (inMemory) {
	const checks = storiesToChecks(stories); // warns + skips duckdb assertions
	if (!checks.length) die('verify-stories: every assertion is duckdb (disk-mode-only) — nothing to run in-memory. Drop --in-memory.');
	// token: '' prevents any Mixpanel send; in-memory verification never writes.
	const report = await verifyDungeon({ ...config, token: '', writeToDisk: false }, checks);
	schemaPass = !!report.schemaReport?.pass;
	const byStory = new Map(stories.map(s => [s.id, { id: s.id, hook: s.hook, archetype: s.archetype, verdict: null, assertions: [] }]));
	for (const r of report.results) {
		const m = /^(.+)\[(\d+)\]$/.exec(r.name);
		const st = m && byStory.get(m[1]);
		if (!st) continue;
		const verdict = (/^([A-Z]+) — /.exec(r.detail || '') || [])[1] || (r.pass ? 'STRONG' : 'NONE');
		st.assertions.push({ name: r.name, verdict, observed: null, detail: r.detail || '' });
	}
	for (const st of byStory.values()) {
		// duckdb-only stories have zero in-memory assertions: informational SKIPPED.
		st.verdict = st.assertions.length
			? st.assertions.reduce((w, a) => VERDICT_RANK[a.verdict] < VERDICT_RANK[w] ? a.verdict : w, 'NAILED')
			: 'SKIPPED';
	}
	storyResults = [...byStory.values()];
} else {
	const prefix = dataPrefix || `verify-${path.basename(abs).replace(/\.(js|mjs)$/, '')}`;
	const prefixPath = prefix.includes('/') ? prefix : path.join('data', prefix);
	const dir = path.dirname(prefixPath), base = path.basename(prefixPath);
	async function loadShards(suffix) {
		// streaming load: full-fidelity event shards can exceed the readFileSync cap
		if (!fs.existsSync(dir)) return [];
		const out = [];
		for (const f of fs.readdirSync(dir).filter(f => f.startsWith(`${base}-${suffix}`) && f.endsWith('.json')).sort()) {
			const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
			for await (const line of rl) {
				if (line.trim()) out.push(JSON.parse(line));
			}
		}
		return out;
	}
	const events = await loadShards('EVENTS');
	const profiles = await loadShards('USERS');
	if (!events.length) {
		die(`verify-stories: no shards at ${prefixPath}-EVENTS*.json — generate first:\n  node scripts/verify-runner.mjs ${dungeonPath} ${base}`);
	}
	if (!asJson) console.log(`${path.basename(abs)} — events=${events.length} users=${profiles.length} (${prefixPath})`);

	// Funnel auto-threading reads VALIDATED funnel fields (conversionWindowDays,
	// order). The dungeon was not run in this process, so validate the config
	// here — validateDungeonConfig resolves those defaults in place.
	const validated = validateDungeonConfig({ ...config, token: '' });
	const identityMap = buildIdentityMap(profiles);

	const execFileP = promisify(execFile);
	const runSql = async (sql) => {
		const substituted = sql.replaceAll('{{PREFIX}}', prefixPath);
		let stdout;
		try {
			({ stdout } = await execFileP('duckdb', ['-json', '-c', substituted], { maxBuffer: 512 * 1024 * 1024 }));
		} catch (err) {
			if (err.code === 'ENOENT') throw new Error('duckdb CLI not found on PATH (required for duckdb assertions)');
			throw new Error(`duckdb failed: ${(err.stderr || err.message || '').trim().slice(0, 500)}`);
		}
		const trimmed = (stdout || '').trim();
		return trimmed ? JSON.parse(trimmed) : [];
	};

	storyResults = await evaluateStories(stories, events, {
		profiles,
		funnels: Array.isArray(validated.funnels) ? validated.funnels : [],
		identityMap,
		runSql,
	});
}

// ── report ──────────────────────────────────────────────────────────────────

const counted = storyResults.filter(s => s.verdict !== 'SKIPPED');
const failing = counted.filter(s => VERDICT_RANK[s.verdict] < VERDICT_RANK.STRONG);
const pass = failing.length === 0 && missing.length === 0 && schemaPass;

if (asJson) {
	console.log(JSON.stringify({
		dungeon: path.relative(process.cwd(), abs),
		mode: inMemory ? 'in-memory' : 'disk',
		coverage,
		stories: storyResults,
		schemaPass,
		pass,
	}, null, 2));
} else {
	const wId = Math.max(5, ...storyResults.map(s => s.id.length));
	const wHook = Math.max(4, ...storyResults.map(s => String(s.hook).length));
	const wArch = Math.max(9, ...storyResults.map(s => s.archetype.length));
	console.log('');
	console.log(`${'STORY'.padEnd(wId)}  ${'HOOK'.padEnd(wHook)}  ${'ARCHETYPE'.padEnd(wArch)}  VERDICT`);
	for (const s of storyResults) {
		console.log(`${s.id.padEnd(wId)}  ${String(s.hook).padEnd(wHook)}  ${s.archetype.padEnd(wArch)}  ${s.verdict}`);
		for (const a of s.assertions) {
			console.log(`  ${a.name.padEnd(wId)}  ${a.verdict} — ${a.detail.replace(/^[A-Z]+ — /, '')}`);
		}
	}
	console.log('');
	const tally = {};
	for (const s of counted) tally[s.verdict] = (tally[s.verdict] || 0) + 1;
	const skipped = storyResults.length - counted.length;
	console.log(`${counted.length} stories: ${Object.entries(tally).map(([v, n]) => `${n} ${v}`).join(', ') || 'none'}${skipped ? ` (${skipped} skipped — duckdb-only, disk mode required)` : ''}`);
	if (coverage.note) console.log(`coverage: ${coverage.note}`);
	else if (missing.length) console.log(`coverage: FAIL — hooks with no story: ${missing.map(n => `H${n}`).join(', ')} (declared H${coverage.declared.join(', H')})`);
	else console.log(`coverage: ${coverage.declared.length} hooks declared in HOOK STORIES, all covered`);
	if (!schemaPass) console.log('schema report: FAIL (see verifyDungeon output)');
	console.log(pass ? 'PASS' : 'FAIL');
}

process.exit(pass ? 0 : 1);
