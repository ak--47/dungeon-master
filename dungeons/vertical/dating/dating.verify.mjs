#!/usr/bin/env node
/**
 * dating.verify.mjs — runs the story checks in ./dating.js against generated data.
 *
 * Generate full-fidelity data first (repo root):
 *   node scripts/verify-runner.mjs dungeons/vertical/dating/dating.js verify-dating
 * Run (default prefix data/verify-dating):
 *   node dungeons/vertical/dating/dating.verify.mjs [--data-prefix <path-prefix>] [--json]
 *
 * --data-prefix accepts a bare name under ./data or a path prefix, e.g.
 * ~/Desktop/dungeons/dating/data/dating for the gzipped export.
 * This wrapper delegates to the package's scripts/verify-stories.mjs, so
 * the verdicts match `node scripts/verify-stories.mjs <dungeon> --data-prefix <prefix>`.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dungeon = fileURLToPath(new URL('./dating.js', import.meta.url));
const pkgRoot = path.dirname(fileURLToPath(import.meta.resolve('@ak--47/dungeon-master')));
const cli = path.join(pkgRoot, 'scripts', 'verify-stories.mjs');

const args = process.argv.slice(2);
if (!args.includes('--data-prefix')) args.push('--data-prefix', 'verify-dating');

const run = spawnSync(process.execPath, [cli, dungeon, ...args], { stdio: 'inherit' });
process.exit(run.status ?? 1);
