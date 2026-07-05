#!/usr/bin/env node
/**
 * crypto.verify.mjs — thin wrapper around the story runner.
 *
 * All verification logic lives in the `stories` export of ./crypto.js;
 * this script just streams the shards and delegates. It is equivalent to:
 *
 *   node scripts/verify-stories.mjs dungeons/vertical/crypto/crypto.js --data-prefix verify-crypto
 *
 * Generate first:
 *   node scripts/verify-runner.mjs dungeons/vertical/crypto/crypto.js verify-crypto
 * Run:
 *   node dungeons/vertical/crypto/crypto.verify.mjs [prefix]   # default verify-crypto
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildIdentityMap, evaluateStories, VERDICT_RANK } from '@ak--47/dungeon-master/verify';
import config, { stories } from './crypto.js';

const PREFIX = process.argv[2] || 'verify-crypto';
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
	console.error(`no shards at ${prefixPath}-EVENTS*.json — run: node scripts/verify-runner.mjs dungeons/vertical/crypto/crypto.js ${PREFIX}`);
	process.exit(1);
}
console.log(`crypto — events=${events.length} users=${profiles.length} (${prefixPath})`);

const execFileP = promisify(execFile);
const runSql = async (sql) => {
	const { stdout } = await execFileP('duckdb', ['-json', '-c', sql.replaceAll('{{PREFIX}}', prefixPath)], { maxBuffer: 64 * 1024 * 1024 });
	return stdout.trim() ? JSON.parse(stdout) : [];
};

// Ten stories are DuckDB-backed (hash cohorts, temporal windows, per-user
// post/pre retention ratios, swap-count buckets, identity invariants). H9
// dispatches to emulateBreakdown's timeToConvert at a 6-HOUR window —
// funnel-post gap scaling is invisible to cross-event SQL, and the
// onboarding funnel's unique first step (`wallet connected`, isFirstEvent
// + isAuthEvent) anchors the greedy evaluator to the exact instance the
// hook touched, so the read is stable across 1h-24h windows. The trading
// and DeFi funnels are NOT scaled: they share the swap step, which H3/H5/
// H7 clone at arbitrary offsets — scaling them lets greedy evaluation
// assemble chains across unscaled clones and collapse the read.
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
