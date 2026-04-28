/**
 * Sweep runner — runs the bunchiness experiment over a matrix of configs.
 *
 * Usage:
 *   node scripts/experiments/sweep.mjs --config scripts/experiments/sweeps/phase-a.json
 *
 * Sweep config schema:
 * {
 *   "dungeons": ["dungeons/vertical/ai-platform.js", ...],
 *   "numDays": 90,
 *   "numUsers": 1000,
 *   "numEvents": 100000,
 *   "configs": [
 *     { "label": "baseline", "overrides": {} },
 *     { "label": "bias0", "overrides": { "bornRecentBias": 0 } },
 *     ...
 *   ],
 *   "outFile": "research/sweeps/phase-a.jsonl"
 * }
 */
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

const configPath = getArg('config');
if (!configPath) {
  console.error('Missing --config');
  process.exit(1);
}

const sweep = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
const numUsers = sweep.numUsers || 1000;
const numEvents = sweep.numEvents || 100000;

const outFile = path.resolve(sweep.outFile || 'research/sweeps/sweep-results.jsonl');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, ''); // truncate

const total = sweep.dungeons.length * sweep.configs.length;
let i = 0;
const startMs = Date.now();

for (const dungeon of sweep.dungeons) {
  for (const cfg of sweep.configs) {
    i++;
    const dungeonName = path.basename(dungeon, '.js');
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    process.stderr.write(`[${i}/${total}] ${elapsed}s ${dungeonName}/${cfg.label} ... `);
    const cliArgs = [
      'scripts/experiments/bunchiness-experiment.mjs',
      '--dungeon', dungeon,
      '--label', cfg.label,
      '--numUsers', String(numUsers),
      '--numEvents', String(numEvents),
      '--overrides', JSON.stringify(cfg.overrides || {}),
    ];
    if (sweep.numDays) {
      cliArgs.push('--numDays', String(sweep.numDays));
    }
    const r = spawnSync('node', cliArgs, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
    });
    if (r.status !== 0) {
      process.stderr.write(`FAILED (exit ${r.status})\n`);
      process.stderr.write((r.stderr || '').slice(-500) + '\n');
      continue;
    }
    const lines = r.stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    try {
      const parsed = JSON.parse(lastLine);
      const m = parsed.metrics;
      fs.appendFileSync(outFile, lastLine + '\n');
      process.stderr.write(`tail=${m.tail_ratio?.toFixed(2)} spike=${m.right_edge_spike?.toFixed(2)} last7%=${(m.last7_share*100)?.toFixed(1)} fut=${m.future_events}\n`);
    } catch (e) {
      process.stderr.write(`PARSE FAIL: ${e.message}\n`);
      process.stderr.write(lastLine.slice(0, 200) + '\n');
    }
  }
}

const totalElapsed = ((Date.now() - startMs) / 1000).toFixed(0);
process.stderr.write(`\nDone in ${totalElapsed}s. Results: ${outFile}\n`);
