//@ts-nocheck
/**
 * P3.3 e2e: scripts/verify-stories.mjs against the stories-verify fixture in
 * BOTH modes (disk shard-streaming + --in-memory), plus the failure paths
 * (INVERSE verdict, hook-coverage discipline).
 *
 * Single sequential test block — this suite runs `test` blocks concurrently
 * (vitest sequence.concurrent) and the phases share generated shards.
 */
import { describe, test, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import generate from '../../index.js';
import dungeonConfig from '../../dungeons/technical/stories-verify.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLI = path.join(ROOT, 'scripts/verify-stories.mjs');
const DUNGEON = path.join(ROOT, 'dungeons/technical/stories-verify.js');
const PREFIX = 'verify-stories-e2e';

const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 120_000 });
const duckdbAvailable = spawnSync('duckdb', ['--version'], { encoding: 'utf-8' }).status === 0;

describe('P3.3 verify-stories CLI', () => {
	test('disk + in-memory + failure paths (single sequential block)', async () => {
		// ── in-memory mode: runs the dungeon fresh inside the CLI ──
		const mem = runCli([DUNGEON, '--in-memory', '--json']);
		expect(mem.status).toBe(0);
		const memReport = JSON.parse(mem.stdout);
		expect(memReport.mode).toBe('in-memory');
		expect(memReport.pass).toBe(true);
		expect(memReport.coverage).toMatchObject({ declared: [1, 2], missing: [] });
		const memById = Object.fromEntries(memReport.stories.map(s => [s.id, s]));
		expect(['NAILED', 'STRONG']).toContain(memById['H1-pro-browse-3x'].verdict);
		expect(['NAILED', 'STRONG']).toContain(memById['H2-free-purchase-drop'].verdict);
		// duckdb assertions are disk-mode-only: skipped, warned on stderr, and
		// NOT counted against the verdict tally.
		expect(memById['H2-duckdb-crosscheck'].verdict).toBe('SKIPPED');
		expect(mem.stderr).toMatch(/disk mode/);

		// ── generate shards for disk mode (same seed → identical event set) ──
		await generate({ ...dungeonConfig, token: '', writeToDisk: true, format: 'json', gzip: false, name: PREFIX, verbose: false });
		expect(fs.readdirSync(path.join(ROOT, 'data')).some(f => f.startsWith(`${PREFIX}-EVENTS`))).toBe(true);

		// ── disk mode: shard streaming + duckdb escape hatch ──
		const disk = runCli([DUNGEON, '--data-prefix', PREFIX, '--json']);
		const diskReport = JSON.parse(disk.stdout);
		expect(diskReport.mode).toBe('disk');
		expect(diskReport.coverage).toMatchObject({ declared: [1, 2], missing: [] });
		const diskById = Object.fromEntries(diskReport.stories.map(s => [s.id, s]));
		// Same seed + same emulator in both modes → verdicts must agree.
		expect(diskById['H1-pro-browse-3x'].verdict).toBe(memById['H1-pro-browse-3x'].verdict);
		expect(diskById['H2-free-purchase-drop'].verdict).toBe(memById['H2-free-purchase-drop'].verdict);
		if (duckdbAvailable) {
			expect(disk.status).toBe(0);
			expect(diskReport.pass).toBe(true);
			expect(['NAILED', 'STRONG']).toContain(diskById['H2-duckdb-crosscheck'].verdict);
		} else {
			// No duckdb CLI on PATH → the duckdb assertion lands NONE and the
			// run honestly fails (nothing silently swallowed).
			expect(disk.status).toBe(1);
			expect(diskById['H2-duckdb-crosscheck'].verdict).toBe('NONE');
			expect(diskById['H2-duckdb-crosscheck'].assertions[0].detail).toMatch(/duckdb/);
		}

		// ── failure paths: INVERSE verdict + uncovered hook ──
		const failPath = path.join(ROOT, 'tmp', 'stories-e2e-fail.fixture.mjs');
		fs.mkdirSync(path.dirname(failPath), { recursive: true });
		fs.writeFileSync(failPath, `
// ── HOOK STORIES ──
/*
 * H1: pro browse amplification
 * H2: free purchase suppression (left uncovered on purpose — coverage must fail)
 */
import base from ${JSON.stringify(pathToFileURL(DUNGEON).href)};
export default base;
export const stories = [
	{
		id: 'H1-inverted',
		hook: 'H1',
		archetype: 'cohort-count-scale',
		narrative: 'ref order inverted on purpose — INVERSE expected',
		assertions: [{
			breakdown: { type: 'eventBreakdown', event: 'browse', breakdownProperty: 'plan' },
			select: { pro: { where: { value: 'pro' } }, free: { where: { value: 'free' } } },
			expect: { metric: 'free.count / pro.count', op: '>=', target: 3, floor: 2 },
		}],
	},
];
`);
		try {
			const fail = runCli([failPath, '--data-prefix', PREFIX, '--json']);
			expect(fail.status).toBe(1);
			const failReport = JSON.parse(fail.stdout);
			expect(failReport.pass).toBe(false);
			expect(failReport.coverage.missing).toEqual([2]);
			expect(failReport.stories[0].verdict).toBe('INVERSE');
		} finally {
			fs.rmSync(failPath, { force: true });
		}
	}, 120_000);
});
