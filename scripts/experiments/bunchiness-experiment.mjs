/**
 * Bunchiness Experiment Runner
 *
 * Runs a single dungeon at constrained scale with a parameter override set,
 * then computes flatness metrics from the generated events.
 *
 * Usage:
 *   node scripts/experiments/bunchiness-experiment.mjs \
 *     --dungeon dungeons/vertical/ai-platform.js \
 *     --label baseline \
 *     --overrides '{"bornRecentBias":0,"percentUsersBornInDataset":15}'
 *
 * Output: prints a JSON line to stdout with all metrics.
 *
 * Constraints (hard-coded for fair comparison):
 *   - numUsers: 1000
 *   - numEvents: 100_000 (or derived from avgEventsPerUserPerDay if override sets it)
 *   - numDays: 90
 *   - format: json (uncompressed for duckdb)
 *   - writeToDisk: true
 *   - concurrency: 1
 */
import generate from '../../index.js';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

const dungeonRel = getArg('dungeon');
const label = getArg('label') || 'unlabeled';
const overridesJson = getArg('overrides') || '{}';
const numDaysArg = getArg('numDays'); // optional — falls back to dungeon's natural value
const numUsers = parseInt(getArg('numUsers') || '1000', 10);
const numEvents = parseInt(getArg('numEvents') || '100000', 10);

if (!dungeonRel) {
  console.error('Missing --dungeon');
  process.exit(1);
}

let overrides;
try {
  overrides = JSON.parse(overridesJson);
} catch (e) {
  console.error(`Invalid --overrides JSON: ${e.message}`);
  process.exit(1);
}

const dungeonPath = path.isAbsolute(dungeonRel)
  ? dungeonRel
  : path.resolve(process.cwd(), dungeonRel);

const dungeonName = path.basename(dungeonRel, '.js');
const runName = `bunchiness-${dungeonName}-${label}`;
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Pre-clean any prior output for this run name
for (const f of fs.readdirSync(dataDir)) {
  if (f.startsWith(runName + '-')) {
    fs.rmSync(path.join(dataDir, f), { force: true });
  }
}

const { default: dungeonConfig } = await import(dungeonPath);

const numDays = numDaysArg ? parseInt(numDaysArg, 10) : (dungeonConfig.numDays || 90);

const startMs = Date.now();
const results = await generate({
  ...dungeonConfig,
  ...overrides,
  token: '',
  numUsers,
  numEvents,
  numDays,
  format: 'json',
  gzip: false,
  writeToDisk: true,
  name: runName,
  concurrency: 1,
  verbose: false,
  hasAdSpend: false,
});
const durationMs = Date.now() - startMs;

const eventsFile = path.join(dataDir, `${runName}-EVENTS.json`);
if (!fs.existsSync(eventsFile)) {
  console.error('No events file produced. Expected:', eventsFile, '\nFiles:', results.files);
  process.exit(1);
}

// Window: [now - numDays, now] — use this as the canonical dataset range so that
// dungeon hooks that emit events outside this range don't pollute the metrics.
const sql = `
WITH ev AS (
  SELECT CAST(time AS TIMESTAMPTZ) AS t,
         COALESCE(user_id, device_id, distinct_id) AS u
  FROM read_json('${eventsFile}',
                 format='newline_delimited',
                 union_by_name=true,
                 columns={time:'VARCHAR', user_id:'VARCHAR', device_id:'VARCHAR', distinct_id:'VARCHAR'})
), bounds AS (
  -- Canonical window: anchored at now, looking back numDays
  SELECT date_trunc('day', current_timestamp) AS d_max,
         date_trunc('day', current_timestamp) - INTERVAL '${numDays - 1}' DAY AS d_min
), in_window AS (
  SELECT t, u FROM ev, bounds WHERE t >= bounds.d_min AND t < bounds.d_max + INTERVAL '1' DAY
), all_days AS (
  -- Generate every day in the window, even zero-event ones, for honest mean/median
  SELECT generate_series AS d
  FROM generate_series(
    (SELECT d_min FROM bounds)::TIMESTAMP,
    (SELECT d_max FROM bounds)::TIMESTAMP,
    INTERVAL '1' DAY
  )
), daily AS (
  SELECT a.d,
         COUNT(e.t) AS events,
         COUNT(DISTINCT e.u) AS users
  FROM all_days a
  LEFT JOIN in_window e ON date_trunc('day', e.t) = a.d
  GROUP BY a.d
), tagged AS (
  SELECT d.d, d.events, d.users,
         (epoch(d.d) - epoch((SELECT d_min FROM bounds)::TIMESTAMP)) AS sec_from_start,
         (epoch((SELECT d_max FROM bounds)::TIMESTAMP) - epoch(d.d)) AS sec_from_end
  FROM daily d
), totals AS (
  SELECT SUM(events) AS total_events_in_window FROM daily
), summary AS (
  SELECT
    (SELECT COUNT(*) FROM daily) AS day_count,
    (SELECT total_events_in_window FROM totals) AS total_events_in_window,
    (SELECT COUNT(*) FROM ev WHERE t < (SELECT d_min FROM bounds) OR t >= (SELECT d_max FROM bounds) + INTERVAL '1' DAY) AS events_outside_window,
    (SELECT AVG(events) FROM tagged WHERE sec_from_start < 14*86400) AS first14_mean,
    (SELECT AVG(events) FROM tagged WHERE sec_from_end < 14*86400) AS last14_mean,
    (SELECT MEDIAN(events) FROM daily) AS median_daily,
    (SELECT MAX(events) FROM daily) AS max_daily,
    (SELECT MIN(events) FROM daily) AS min_daily,
    (SELECT AVG(events) FROM daily) AS mean_daily,
    (SELECT STDDEV_POP(events) FROM daily) AS stddev_daily,
    (SELECT SUM(events) FROM tagged WHERE sec_from_end < 7*86400) AS last7_events,
    (SELECT MAX(events) FROM tagged WHERE sec_from_end < 14*86400) AS last14_max,
    (SELECT AVG(events) FROM tagged WHERE sec_from_end >= 14*86400 AND sec_from_start >= 14*86400) AS middle_mean
), regr AS (
  SELECT
    REGR_SLOPE(events, sec_from_start / 86400.0) AS slope_per_day
  FROM tagged
), future_check AS (
  SELECT COUNT(*) AS future_events FROM ev WHERE t > current_timestamp
)
SELECT json_object(
  'day_count', summary.day_count,
  'total_events_in_window', summary.total_events_in_window,
  'events_outside_window', summary.events_outside_window,
  'first14_mean', summary.first14_mean,
  'last14_mean', summary.last14_mean,
  'middle_mean', summary.middle_mean,
  'mean_daily', summary.mean_daily,
  'median_daily', summary.median_daily,
  'max_daily', summary.max_daily,
  'min_daily', summary.min_daily,
  'stddev_daily', summary.stddev_daily,
  'last7_events', summary.last7_events,
  'last14_max', summary.last14_max,
  'tail_ratio', CASE WHEN summary.first14_mean > 0 THEN summary.last14_mean / summary.first14_mean END,
  'right_edge_spike', CASE WHEN summary.median_daily > 0 THEN summary.last14_max / summary.median_daily END,
  'last7_share', CASE WHEN summary.total_events_in_window > 0 THEN summary.last7_events::DOUBLE / summary.total_events_in_window END,
  'slope_per_day', regr.slope_per_day,
  'slope_normalized', CASE WHEN summary.mean_daily > 0 THEN regr.slope_per_day / summary.mean_daily END,
  'cv', CASE WHEN summary.mean_daily > 0 THEN summary.stddev_daily / summary.mean_daily END,
  'future_events', future_check.future_events
) AS metrics
FROM summary, regr, future_check;
`;

const tmpSql = path.join(dataDir, `${runName}-_bunchiness.sql`);
fs.writeFileSync(tmpSql, sql);

let metricsLine;
try {
  metricsLine = execSync(`duckdb -json :memory: < "${tmpSql}"`, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  }).trim();
} catch (e) {
  console.error('DuckDB query failed:', e.stderr || e.message);
  process.exit(1);
}

const parsed = JSON.parse(metricsLine);
const metrics = parsed[0].metrics; // duckdb -json returns the object inline

const out = {
  dungeon: dungeonName,
  label,
  overrides,
  numDays,
  numUsers,
  numEvents,
  durationMs,
  eventCount: results.eventCount,
  userCount: results.userCount,
  metrics,
};

console.log(JSON.stringify(out));
