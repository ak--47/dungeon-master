#!/usr/bin/env node
/**
 * Smoke-test runner — runs every dungeon at tiny scale in parallel to verify it
 * loads, generates events, and writes output without crashing.
 *
 * Default scale: 100 users, 1000 events per dungeon. NOT for verification —
 * use scripts/verify-runner.mjs at full fidelity for that.
 *
 * Usage:
 *   node scripts/smoke-test-all.mjs
 *   node scripts/smoke-test-all.mjs --dir dungeons/vertical    # default
 *   node scripts/smoke-test-all.mjs --dir dungeons/technical
 *   node scripts/smoke-test-all.mjs --dir dungeons             # both subdirs
 *   node scripts/smoke-test-all.mjs --concurrency 4            # default: cpu count
 *   node scripts/smoke-test-all.mjs --users 500 --events 5000  # override scale
 *
 * Output: per-dungeon PASS/FAIL line + a final summary table. Spawns each
 * dungeon as a child node process so a crash in one doesn't abort the run.
 */
import { spawn } from 'child_process';
import { readdirSync, statSync, rmSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

const args = process.argv.slice(2);
function arg(name, fallback) {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dirArg = arg('dir', 'dungeons/vertical');
const numUsers = parseInt(arg('users', '100'), 10);
const numEvents = parseInt(arg('events', '1000'), 10);
const concurrency = parseInt(arg('concurrency', String(Math.max(2, os.cpus().length))), 10);
const keep = args.includes('--keep');

function findDungeons(dir) {
	const abs = path.resolve(ROOT, dir);
	if (!existsSync(abs)) return [];
	const stat = statSync(abs);
	if (stat.isFile()) return [abs];
	const out = [];
	for (const entry of readdirSync(abs)) {
		const full = path.join(abs, entry);
		const s = statSync(full);
		if (s.isDirectory()) out.push(...findDungeons(full));
		else if (entry.endsWith('.js')) out.push(full);
	}
	return out;
}

const dungeons = findDungeons(dirArg).sort();
if (dungeons.length === 0) {
	console.error(`No dungeons found under ${dirArg}`);
	process.exit(1);
}

const dataDir = path.join(ROOT, 'data');
mkdirSync(dataDir, { recursive: true });

const RUNNER = `
import generate from '${path.join(ROOT, 'index.js')}';
// With node -e, process.argv = [nodePath, ...userArgs] — no script slot.
const [dungeonPath, name, numUsers, numEvents] = process.argv.slice(1);
const r = await generate(dungeonPath, {
	numUsers: parseInt(numUsers, 10),
	numEvents: parseInt(numEvents, 10),
	avgEventsPerUserPerDay: undefined,  // force numEvents path
	writeToDisk: true,
	name,
	format: 'json',
	verbose: false,
	concurrency: 1,
	token: '',
	serviceAccount: 'fake', serviceSecret: 'fake', projectId: '1',
});
console.log(JSON.stringify({ eventCount: r.eventCount, userCount: r.userCount }));
`;

function runOne(dungeonPath) {
	const base = path.basename(dungeonPath, '.js');
	const namePrefix = `smoke-${base}`;
	return new Promise(resolve => {
		const start = Date.now();
		const child = spawn(
			process.execPath,
			['--input-type=module', '-e', RUNNER, dungeonPath, namePrefix, String(numUsers), String(numEvents)],
			{ cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
		);
		let out = '';
		let err = '';
		child.stdout.on('data', d => { out += d.toString(); });
		child.stderr.on('data', d => { err += d.toString(); });
		child.on('close', code => {
			const ms = Date.now() - start;
			let result;
			try {
				const lastLine = out.trim().split('\n').filter(Boolean).pop() || '{}';
				result = JSON.parse(lastLine);
			} catch {
				result = {};
			}
			const ok = code === 0 && result.eventCount > 0;
			if (!keep) {
				try {
					for (const f of readdirSync(dataDir)) {
						if (f.startsWith(`${namePrefix}-`)) rmSync(path.join(dataDir, f));
					}
				} catch {}
			}
			resolve({
				dungeon: path.relative(ROOT, dungeonPath),
				ok,
				code,
				ms,
				eventCount: result.eventCount || 0,
				userCount: result.userCount || 0,
				err: ok ? '' : (err.trim().split('\n').slice(-3).join(' | ') || `exit ${code}`),
			});
		});
	});
}

console.log(`Smoke test: ${dungeons.length} dungeons, ${numUsers} users / ${numEvents} events each, concurrency=${concurrency}`);
const queue = [...dungeons];
const results = [];
const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
	while (queue.length) {
		const d = queue.shift();
		const res = await runOne(d);
		const tag = res.ok ? 'PASS' : 'FAIL';
		console.log(`  [${tag}] ${path.basename(res.dungeon)} — ${res.eventCount} events, ${res.userCount} users, ${(res.ms / 1000).toFixed(2)}s${res.ok ? '' : ` — ${res.err}`}`);
		results.push(res);
	}
});
await Promise.all(workers);

results.sort((a, b) => a.dungeon.localeCompare(b.dungeon));
const fails = results.filter(r => !r.ok);

console.log('\n┌─────────────────────────────────────────────────┬───────┬────────┬───────┬──────┐');
console.log('│ Dungeon                                         │ State │ Events │ Users │   ms │');
console.log('├─────────────────────────────────────────────────┼───────┼────────┼───────┼──────┤');
for (const r of results) {
	const name = r.dungeon.padEnd(47).slice(0, 47);
	const state = (r.ok ? 'PASS' : 'FAIL').padEnd(5);
	const ev = String(r.eventCount).padStart(6);
	const u = String(r.userCount).padStart(5);
	const ms = String(r.ms).padStart(4);
	console.log(`│ ${name} │ ${state} │ ${ev} │ ${u} │ ${ms} │`);
}
console.log('└─────────────────────────────────────────────────┴───────┴────────┴───────┴──────┘');

console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length > 0) {
	console.log('\nFailures:');
	for (const f of fails) {
		console.log(`  ✗ ${f.dungeon}: ${f.err}`);
	}
	process.exit(1);
}
