#!/usr/bin/env node
/**
 * healthcare.verify.mjs — thin wrapper around the story runner.
 *
 * All verification logic lives in the `stories` export of ./healthcare.js;
 * this script just streams the shards and delegates. It is equivalent to:
 *
 *   node scripts/verify-stories.mjs dungeons/vertical/healthcare/healthcare.js --data-prefix verify-healthcare
 *
 * Generate first:
 *   node scripts/verify-runner.mjs dungeons/vertical/healthcare/healthcare.js verify-healthcare
 * Run:
 *   node dungeons/vertical/healthcare/healthcare.verify.mjs [prefix]   # default verify-healthcare
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildIdentityMap, evaluateStories, VERDICT_RANK } from '@ak--47/dungeon-master/verify';
import config, { stories } from './healthcare.js';

const PREFIX = process.argv[2] || 'verify-healthcare';
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
	console.error(`no shards at ${prefixPath}-EVENTS*.json — run: node scripts/verify-runner.mjs dungeons/vertical/healthcare/healthcare.js ${PREFIX}`);
	process.exit(1);
}
console.log(`healthcare — events=${events.length} users=${profiles.length} (${prefixPath})`);

const execFileP = promisify(execFile);
const runSql = async (sql) => {
	const { stdout } = await execFileP('duckdb', ['-json', '-c', sql.replaceAll('{{PREFIX}}', prefixPath)], { maxBuffer: 64 * 1024 * 1024 });
	return stdout.trim() ? JSON.parse(stdout) : [];
};

// funnels passed raw (unvalidated) — the H8/H9 stories carry their own
// explicit conversion windows (derived from the funnel's generative window
// × the max H9 stretch factor, covering the stretched support), so no
// funnel-default threading is needed
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
