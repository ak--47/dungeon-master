//@ts-nocheck
/**
 * Engine-shape full sweep — gated e2e regression gate. Wraps
 * `scripts/sweep-engine.mjs` (~5 min wall with --workers 4) and asserts every
 * combo in the 194-combo matrix passes its per-macro strict bar.
 *
 * SKIP by default. Opt in via env var:
 *
 *   RUN_FULL_SWEEP=1 npx vitest run tests/e2e/engine-shape-full-sweep.test.js
 *
 * Run pre-release as part of the 1.5.0 ship gate.
 */
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUN = process.env.RUN_FULL_SWEEP === '1';
const describer = RUN ? describe : describe.skip;

describer('engine-shape full sweep (gated by RUN_FULL_SWEEP=1)', () => {
	test('all combos in the matrix pass the per-macro strict bar', () => {
		const repoRoot = path.resolve(__dirname, '..', '..');
		const sweepScript = path.join(repoRoot, 'scripts', 'sweep-engine.mjs');
		const outFile = path.join(os.tmpdir(), `engine-sweep-e2e-${Date.now()}.json`);
		try {
			execFileSync(
				process.execPath,
				[sweepScript, '--workers', '4', '--out', outFile],
				{ cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'], timeout: 15 * 60 * 1000 }
			);
		} catch (err) {
			// sweep-engine.mjs exits with the failure count. We surface that.
			const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile)) : null;
			if (!out) throw err;
			const fails = (out.results || []).filter(r => !r.pass);
			const summary = fails.slice(0, 10).map(f => {
				const c = f.combo;
				return `  ${c.macro}/${c.numDays}d/r${c.rate}/b${c.born ?? '-'}/ad${c.activeDays ?? '-'} → ${(f.failures || []).join(' | ')}`;
			}).join('\n');
			throw new Error(
				`engine-shape full sweep had ${fails.length} failures (out of ${out.matrix?.length ?? '?'}):\n${summary}` +
				(fails.length > 10 ? `\n  ...and ${fails.length - 10} more` : '')
			);
		}
		const out = JSON.parse(fs.readFileSync(outFile));
		expect(out.summary.fail).toBe(0);
		expect(out.summary.pass).toBe(out.summary.matrixSize);
	}, 20 * 60 * 1000);
});
