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
import generate from '../index.js';
import { extractComments } from '../lib/core/extract-comments.js';
import { validateDungeonConfig } from '../lib/core/config-validator.js';
import {
	buildIdentityMap,
	VERDICT_RANK,
	validateStories,
	validateSchema,
	evaluateStories,
	auditWarehouseRows,
	computeWarehouseSourceRows,
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
const stories = Array.isArray(mod.stories) ? mod.stories : [];
if (!config || typeof config !== 'object') die(`verify-stories: ${dungeonPath} has no default-exported config object`);
const hasWarehouseMetrics = Array.isArray(config.warehouseMetrics) && config.warehouseMetrics.length > 0;
if (!stories.length && !hasWarehouseMetrics) {
	die(`verify-stories: ${dungeonPath} has no \`stories\` named export — add one (see lib/templates/story-spec.schema.json) or use scripts/verify-runner.mjs for ad-hoc checks.`);
}
if (stories.length) {
	const sv = validateStories(stories);
	if (!sv.valid) die(`verify-stories: invalid stories:\n  ${sv.errors.join('\n  ')}`);
}

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
let warehouseAudits = [];

if (inMemory) {
	const result = await generate({ ...config, token: '', writeToDisk: false });
	const events = Array.isArray(result.eventData) ? result.eventData : Array.from(result.eventData || []);
	const profiles = Array.isArray(result.userProfilesData) ? result.userProfilesData : Array.from(result.userProfilesData || []);
	const validated = result.validatedConfig || validateDungeonConfig({ ...config, token: '' });
	schemaPass = !!validateSchema(events, validated)?.pass;
	const warehouseSpecs = Object.fromEntries((validated.warehouseMetrics || []).map((spec) => [spec.name, spec]));
	const warehouseRows = result.warehouseMetricData || {};
	storyResults = stories.length
		? await evaluateStories(stories, events, {
			profiles,
			funnels: Array.isArray(validated.funnels) ? validated.funnels : [],
			identityMap: buildIdentityMap(profiles),
			warehouseRows,
			warehouseSpecs,
			datasetStart: validated.datasetStart,
			datasetEnd: validated.datasetEnd,
			skipDiskOnlyDuckdb: true,
			onWarning: (message) => console.error(message),
		})
		: [];
	warehouseAudits = buildWarehouseAudits(warehouseSpecs, warehouseRows, validated, events);
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
	// here and use the RETURN value — as of v1.6.2 validateDungeonConfig does not
	// enrich the object you hand it.
	const validated = validateDungeonConfig({ ...config, token: '' });
	const identityMap = buildIdentityMap(profiles);
	schemaPass = !!validateSchema(events, validated)?.pass;
	const warehouseSpecs = Object.fromEntries((validated.warehouseMetrics || []).map((spec) => [spec.name, spec]));
	const warehouseManifest = loadWarehouseManifest(prefixPath);
	const warehouseRows = Object.fromEntries(await Promise.all(
		Object.values(warehouseSpecs).map(async (spec) => [spec.name, await loadWarehouseRows(prefixPath, spec, warehouseManifest)])
	));

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

	storyResults = stories.length
		? await evaluateStories(stories, events, {
			profiles,
			funnels: Array.isArray(validated.funnels) ? validated.funnels : [],
			identityMap,
			runSql,
			warehouseRows,
			warehouseSpecs,
			datasetStart: validated.datasetStart,
			datasetEnd: validated.datasetEnd,
		})
		: [];
	warehouseAudits = buildWarehouseAudits(warehouseSpecs, warehouseRows, validated, events, warehouseManifest);
}

// ── report ──────────────────────────────────────────────────────────────────

const counted = storyResults.filter(s => s.verdict !== 'SKIPPED');
const failing = counted.filter(s => VERDICT_RANK[s.verdict] < VERDICT_RANK.STRONG);
const failingAudits = warehouseAudits.filter((audit) => !audit.pass);
const pass = failing.length === 0 && failingAudits.length === 0 && missing.length === 0 && schemaPass;

if (asJson) {
	console.log(JSON.stringify({
		dungeon: path.relative(process.cwd(), abs),
		mode: inMemory ? 'in-memory' : 'disk',
		coverage,
		stories: storyResults,
		warehouseAudits,
		schemaPass,
		pass,
	}, null, 2));
} else {
	if (storyResults.length) {
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
	}
	const tally = {};
	for (const s of counted) tally[s.verdict] = (tally[s.verdict] || 0) + 1;
	const skipped = storyResults.length - counted.length;
	console.log(`${counted.length} stories: ${Object.entries(tally).map(([v, n]) => `${n} ${v}`).join(', ') || 'none'}${skipped ? ` (${skipped} skipped — disk mode required)` : ''}`);
	if (warehouseAudits.length) {
		console.log('warehouse audit:');
		for (const audit of warehouseAudits) {
			const summary = `stats corr=${formatNumber(audit.stats.corr)} buckets=${audit.stats.buckets} gaps=${audit.stats.gaps} empty=${audit.stats.emptyNumericCells}`;
			console.log(`  ${audit.table}: ${audit.pass ? 'PASS' : 'FAIL'} — ${audit.failures.length ? audit.failures.join('; ') : summary}`);
		}
	}
	if (coverage.note) console.log(`coverage: ${coverage.note}`);
	else if (missing.length) console.log(`coverage: FAIL — hooks with no story: ${missing.map(n => `H${n}`).join(', ')} (declared H${coverage.declared.join(', H')})`);
	else console.log(`coverage: ${coverage.declared.length} hooks declared in HOOK STORIES, all covered`);
	if (!schemaPass) console.log('schema report: FAIL (see verifyDungeon output)');
	console.log(pass ? 'PASS' : 'FAIL');
}

process.exit(pass ? 0 : 1);

function buildWarehouseAudits(warehouseSpecs, warehouseRows, validated, events = [], warehouseManifest = null) {
	return Object.values(warehouseSpecs || {}).map((spec) => {
		const rows = warehouseRows?.[spec.name] || [];
		const sourceRows = events.length ? computeWarehouseSourceRows(events, spec) : [];
		const manifestColumns = warehouseManifest?.tables?.find((table) => table.table === spec.name)?.columns || [];
		return {
			table: spec.name,
			...auditWarehouseRows(rows, spec, {
				datasetStart: validated.datasetStart,
				datasetEnd: validated.datasetEnd,
				sourceRows,
				manifestColumns,
			}),
		};
	});
}

function loadWarehouseManifest(prefixPath) {
	const manifestPath = `${prefixPath}-WAREHOUSE-MANIFEST.json`;
	if (!fs.existsSync(manifestPath)) return null;
	return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

async function loadWarehouseRows(prefixPath, spec, manifest) {
	const manifestEntry = manifest?.tables?.find((table) => table.table === spec.name) || null;
	const fileBase = manifestEntry?.file || `${path.basename(prefixPath)}-WAREHOUSE-${spec.name}`;
	const format = manifestEntry?.format || spec.format || 'csv';
	const filePath = path.join(path.dirname(prefixPath), `${fileBase}.${format}`);
	if (!fs.existsSync(filePath)) return [];
	if (format === 'json') return loadNdjson(filePath);
	return loadCsv(filePath, manifestEntry?.columns || []);
}

async function loadNdjson(filePath) {
	const out = [];
	const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
	for await (const line of rl) {
		if (line.trim()) out.push(JSON.parse(line));
	}
	return out;
}

async function loadCsv(filePath, columns) {
	const out = [];
	const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
	let headers = null;
	for await (const line of rl) {
		if (!line.trim()) continue;
		if (!headers) {
			headers = parseCsvLine(line);
			continue;
		}
		const values = parseCsvLine(line);
		const row = {};
		for (let index = 0; index < headers.length; index += 1) {
			const header = headers[index];
			const type = columns.find((column) => column.name === header)?.bqType;
			row[header] = coerceWarehouseCell(values[index] ?? '', type);
		}
		out.push(row);
	}
	return out;
}

function parseCsvLine(line) {
	const cells = [];
	let current = '';
	let inQuotes = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '"') {
			if (inQuotes && line[index + 1] === '"') {
				current += '"';
				index += 1;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			cells.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	cells.push(current);
	return cells;
}

function coerceWarehouseCell(value, bqType) {
	if (bqType === 'FLOAT64') {
		if (value === '') return '';
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : value;
	}
	if (bqType === 'BOOL') return value === 'true';
	return value;
}

function formatNumber(value) {
	return Number.isFinite(value) ? value.toFixed(3) : String(value);
}
