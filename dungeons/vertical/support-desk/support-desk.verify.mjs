#!/usr/bin/env node
/**
 * support-desk.verify.mjs — thin wrapper around the story runner.
 *
 * All verification logic lives in the `stories` export of ./support-desk.js;
 * this script just streams the shards and delegates. It is equivalent to:
 *
 *   node scripts/verify-stories.mjs dungeons/vertical/support-desk/support-desk.js --data-prefix verify-support-desk
 *
 * Generate first:
 *   node scripts/verify-runner.mjs dungeons/vertical/support-desk/support-desk.js verify-support-desk
 * Run:
 *   node dungeons/vertical/support-desk/support-desk.verify.mjs [prefix]   # default verify-support-desk
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildIdentityMap, evaluateStories, VERDICT_RANK } from '@ak--47/dungeon-master/verify';
import config, { stories } from './support-desk.js';

const PREFIX = process.argv[2] || 'verify-support-desk';
const prefixPath = path.join('data', PREFIX);

async function loadShards(suffix) {
	// streaming load: full-fidelity EVENTS shards exceed the readFileSync cap
	const dir = path.dirname(prefixPath), base = path.basename(prefixPath);
	const out = [];
	if (!fs.existsSync(dir)) return out;
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
	console.error(`no shards at ${prefixPath}-EVENTS*.json — run: node scripts/verify-runner.mjs dungeons/vertical/support-desk/support-desk.js ${PREFIX}`);
	process.exit(1);
}
console.log(`support-desk — events=${events.length} users=${profiles.length} (${prefixPath})`);

const execFileP = promisify(execFile);
const runSql = async (sql) => {
	const { stdout } = await execFileP('duckdb', ['-json', '-c', sql.replaceAll('{{PREFIX}}', prefixPath)], { maxBuffer: 64 * 1024 * 1024 });
	return stdout.trim() ? JSON.parse(stdout) : [];
};

// Stories are emulator-backed where Mixpanel-equivalent semantics matter
// (topPaths for the engineered path shares, funnelFrequency with session
// conversion windows for the 1-vs-4 session contrast, sessionMetrics and
// uniques-sessions for the role cadence split). The per-role session-cadence
// cross-check and the identity invariants are DuckDB-backed: `role` is
// pinned on every event by the hook, so SQL can sessionize per user (LAG
// > 30 min) and split by role without needing hashFloat.
const results = await evaluateStories(stories, events, {
	profiles,
	funnels: config.funnels,
	identityMap: buildIdentityMap(profiles),
	runSql,
});

let worst = 'NAILED';
for (const r of results) {
	console.log(`${r.verdict.padEnd(7)} ${r.id}`);
	for (const a of r.assertions) console.log(`        ${a.verdict.padEnd(7)} ${a.detail}`);
	if (VERDICT_RANK[r.verdict] < VERDICT_RANK[worst]) worst = r.verdict;
}
console.log(`\nworst verdict: ${worst}`);
process.exit(VERDICT_RANK[worst] >= VERDICT_RANK.STRONG ? 0 : 1);
