#!/usr/bin/env node
/**
 * gaming.verify.mjs — runs the story checks in ./gaming.js against generated data.
 *
 * Generate full-fidelity data first (repo root):
 *   node scripts/verify-runner.mjs dungeons/vertical/gaming/gaming.js verify-gaming
 * Run (default prefix data/verify-gaming):
 *   node dungeons/vertical/gaming/gaming.verify.mjs [--data-prefix <path-prefix>] [--json]
 *
 * --data-prefix accepts a bare name under ./data or a path prefix, e.g.
 * ~/Desktop/dungeons/gaming/data/gaming for the gzipped export.
 * This wrapper delegates to the package's scripts/verify-stories.mjs, so
 * the verdicts match `node scripts/verify-stories.mjs <dungeon> --data-prefix <prefix>`.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dungeon = fileURLToPath(new URL('./gaming.js', import.meta.url));
const pkgRoot = path.dirname(fileURLToPath(import.meta.resolve('@ak--47/dungeon-master')));
const cli = path.join(pkgRoot, 'scripts', 'verify-stories.mjs');

const args = process.argv.slice(2);
if (!args.includes('--data-prefix')) args.push('--data-prefix', 'verify-gaming');

const run = spawnSync(process.execPath, [cli, dungeon, ...args], { stdio: 'inherit' });
process.exit(run.status ?? 1);
