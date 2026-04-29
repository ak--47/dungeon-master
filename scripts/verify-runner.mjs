/**
 * Verify Runner — runs a dungeon for hook verification.
 *
 * Default mode: FULL FIDELITY — runs the dungeon with its own configured
 *   numUsers / avgEventsPerUserPerDay / numDays. This is the only way to
 *   verify the trends a benchmark consumer will actually see.
 *
 * --small mode: ~1K users with avgEventsPerUserPerDay scaled proportionally
 *   so total events stay near 100K. Use only for fast smoke checks; do NOT
 *   ship verification verdicts based on --small runs.
 *
 * Usage:
 *   node scripts/verify-runner.mjs <dungeon-path> [run-name] [--small]
 *
 * Examples:
 *   node scripts/verify-runner.mjs dungeons/vertical/gaming.js verify-gaming
 *   node scripts/verify-runner.mjs dungeons/vertical/gaming.js verify-gaming --small
 */
import generate from '../index.js';
import path from 'path';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));

const dungeonPath = positional[0];
if (!dungeonPath) {
	console.error('Usage: node scripts/verify-runner.mjs <dungeon-path> [run-name] [--small]');
	process.exit(1);
}

const runName = positional[1] || 'verify-hooks';
const isSmall = flags.has('--small');
const absolutePath = path.isAbsolute(dungeonPath)
	? dungeonPath
	: path.resolve(process.cwd(), dungeonPath);

const { default: config } = await import(absolutePath);

let override;

if (isSmall) {
	// SMALL mode: 1K users, scaled per-day rate so total events ≈ 100K.
	// Preserves the dungeon's per-user-per-day shape while shrinking the dataset.
	// Use only for quick smoke checks — verdicts must come from full fidelity.
	const numUsers = 1000;
	const numDays = config.numDays || 100;
	const targetTotal = 100_000;
	const scaledRate = targetTotal / (numUsers * numDays);
	override = {
		...config,
		token: '',
		numUsers,
		numDays,
		avgEventsPerUserPerDay: scaledRate,
		numEvents: undefined,
		format: 'json',
		gzip: false,
		writeToDisk: true,
		name: runName,
		concurrency: 1,
		verbose: false,
	};
} else {
	// FULL FIDELITY: use the dungeon's own scale settings as-shipped.
	// Full-scale runs can take minutes for 50K-user dungeons; that's expected.
	override = {
		...config,
		token: '',
		format: 'json',
		gzip: false,
		writeToDisk: true,
		name: runName,
		concurrency: config.concurrency || 1,
		verbose: false,
	};
}

const t0 = Date.now();
const results = await generate(override);
const wallMs = Date.now() - t0;

console.log(JSON.stringify({
	mode: isSmall ? 'small' : 'full',
	eventCount: results.eventCount,
	userCount: results.userCount,
	files: results.files,
	duration: results.time?.human || `${wallMs}ms`,
	wallMs,
}));
