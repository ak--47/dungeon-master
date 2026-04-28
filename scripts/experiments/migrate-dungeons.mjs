/**
 * One-shot migration: rename avg_events_per_user → avg_events_per_user_per_day,
 * switch to avgEventsPerUserPerDay config primitive, and remove explicit
 * percentUsersBornInDataset overrides in favor of the new "flat" macro default.
 *
 * Idempotent: skips files already migrated.
 *
 * Usage: node scripts/experiments/migrate-dungeons.mjs [--dry]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const dungeonDirs = ['dungeons/vertical', 'dungeons/technical', 'dungeons/user'];
const dry = process.argv.includes('--dry');

const files = [];
for (const d of dungeonDirs) {
  const abs = path.join(repoRoot, d);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (f.endsWith('.js')) files.push(path.join(abs, f));
  }
}

const report = [];

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  const rel = path.relative(repoRoot, file);

  // Skip files that don't use the pattern
  if (!/const avg_events_per_user(\b|\s|=)/.test(src)) {
    report.push({ file: rel, status: 'skipped (no avg_events_per_user)' });
    continue;
  }

  // Skip if already migrated
  if (/avg_events_per_user_per_day/.test(src)) {
    report.push({ file: rel, status: 'skipped (already migrated)' });
    continue;
  }

  // Find num_days for the rate calc
  const numDaysMatch = src.match(/const\s+num_days\s*=\s*(\d+)\s*;/);
  if (!numDaysMatch) {
    report.push({ file: rel, status: 'SKIPPED — could not find const num_days' });
    continue;
  }
  const numDays = parseInt(numDaysMatch[1], 10);

  // Find avg_events_per_user value
  const avgMatch = src.match(/const\s+avg_events_per_user\s*=\s*(\d+)\s*;/);
  if (!avgMatch) {
    report.push({ file: rel, status: 'SKIPPED — could not find const avg_events_per_user' });
    continue;
  }
  const avgPerUserTotal = parseInt(avgMatch[1], 10);

  // Compute per-day rate; round to 2 decimal places
  const ratePerDay = Math.round((avgPerUserTotal / numDays) * 100) / 100;

  // 1. Rename the const declaration. Use the per-day value.
  src = src.replace(
    /const\s+avg_events_per_user\s*=\s*\d+\s*;/,
    `const avg_events_per_user_per_day = ${ratePerDay};`
  );

  // 2. Replace numEvents:numUsers*avg_events_per_user with avgEventsPerUserPerDay:rate.
  // Do this in the context of any whitespace and trailing comma.
  src = src.replace(
    /numEvents:\s*num_users\s*\*\s*avg_events_per_user\s*,/,
    `avgEventsPerUserPerDay: avg_events_per_user_per_day,`
  );

  // 3. Replace any other reference to avg_events_per_user (defensive — should be rare)
  src = src.replace(/\bavg_events_per_user\b/g, 'avg_events_per_user_per_day');

  // 4. Remove top-level percentUsersBornInDataset override line. Only remove if it's
  //    on its own line in the config block (single-line "percentUsersBornInDataset: N,").
  //    We're letting the new "flat" macro default (15) take effect everywhere; dungeons
  //    that need a different shape can opt into macro: "growth" / "viral" etc.
  src = src.replace(/^[ \t]*percentUsersBornInDataset:\s*\d+\s*,?[ \t]*\n/m, '');

  if (src === before) {
    report.push({ file: rel, status: 'unchanged (no replacements made)' });
    continue;
  }

  if (!dry) fs.writeFileSync(file, src);
  report.push({
    file: rel,
    status: dry ? 'WOULD UPDATE' : 'updated',
    avgPerUserTotal,
    numDays,
    ratePerDay,
  });
}

for (const r of report) {
  if (r.status.startsWith('updated') || r.status.startsWith('WOULD')) {
    console.log(`${r.status}: ${r.file}  (${r.avgPerUserTotal}/${r.numDays} = ${r.ratePerDay}/day)`);
  } else {
    console.log(`${r.status}: ${r.file}`);
  }
}
