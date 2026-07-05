#!/usr/bin/env node
/**
 * education.verify.mjs — thin wrapper around the story runner.
 *
 * All verification logic lives in the `stories` export of ./education.js;
 * this script just streams the shards and delegates. It is equivalent to:
 *
 *   node scripts/verify-stories.mjs dungeons/vertical/education/education.js --data-prefix verify-education
 *
 * Generate first:
 *   node scripts/verify-runner.mjs dungeons/vertical/education/education.js verify-education
 * Run:
 *   node dungeons/vertical/education/education.verify.mjs [prefix]   # default verify-education
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildIdentityMap, evaluateStories, VERDICT_RANK } from '@ak--47/dungeon-master/verify';
import config, { stories } from './education.js';

const PREFIX = process.argv[2] || 'verify-education';
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
	console.error(`no shards at ${prefixPath}-EVENTS*.json — run: node scripts/verify-runner.mjs dungeons/vertical/education/education.js ${PREFIX}`);
	process.exit(1);
}
console.log(`education — events=${events.length} users=${profiles.length} (${prefixPath})`);

const execFileP = promisify(execFile);
const runSql = async (sql) => {
	const { stdout } = await execFileP('duckdb', ['-json', '-c', sql.replaceAll('{{PREFIX}}', prefixPath)], { maxBuffer: 64 * 1024 * 1024 });
	return stdout.trim() ? JSON.parse(stdout) : [];
};

// funnels passed raw (unvalidated) — the emulator stories carry their own
// explicit conversion windows (H7/H9: 86.4h = 48h generative × the 1.8 free
// TTC stretch, on the 2-step enrolled→cert read; the 4-step doc funnel would
// break because H9's annual ×0.5 compression can move a cert before the
// interior quiz step). H10 pairs in SQL anchored at funnel ENTRY (first
// 'discussion posted' at/after $experiment_started, conversion within 12h of
// entry) because the exp→entry lag is arm-dependent.
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
