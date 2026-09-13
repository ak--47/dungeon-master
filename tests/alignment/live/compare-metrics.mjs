import { resolve } from 'node:path';
import { emulateBreakdown } from '../../../lib/verify/emulate-breakdown.js';
import { artifactRoot, readJson, saveJson, revision } from './harness.mjs';

const runId = process.argv[2] || 'dm182-generated-1789304162559-85a7cbdc';
const directory = resolve(artifactRoot, runId);
const events = readJson(resolve(directory, 'events.json'));
const profiles = readJson(resolve(directory, 'profiles.json'));
const cells = readJson(resolve(directory, 'cells.json'));
const checks = [];
const record = (name, actual, expected, tolerance = 0) => checks.push({ name, actual, expected, tolerance,
  pass: Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance });
const metricTotals = (evidence, cell, event) => {
  const index = evidence.specification.metrics.findIndex(metric => metric.event === event);
  return evidence.response.series[evidence.response.meta.report_sections.show[index].metric_key]?.[cell]?.all || 0;
};
const volume = readJson(resolve(directory, 'volume.json'));
const volumeEffects = [];
for (const cell of cells.filter(cell => cell.scenario === 'persona-volume')) {
  const measured = {};
  for (const segment of ['target', 'control']) {
    const group = `${cell.cell}:${segment}`;
    const expected = events.filter(event => event.alignment_group === group).length;
    const actual = volume.specification.metrics.reduce((sum, metric) => sum + metricTotals(volume, group, metric.event), 0);
    record(`${group}:volume`, actual, expected);
    const population = profiles.filter(profile => profile.alignment_cell === cell.cell && profile.segment === segment).length;
    measured[segment] = actual / population;
  }
  const effect = measured.target / measured.control;
  const band = cell.treatment ? cell.thresholds.effect : cell.thresholds.neutral;
  volumeEffects.push({ cell: cell.cell, effect, band, pass: effect >= band[0] && effect <= band[1] });
}
const weights = readJson(resolve(directory, 'weights.json'));
const weightSeries = Object.values(weights.response.series)[0];
const weightEffects = [];
for (const cell of cells.filter(cell => cell.scenario === 'weights')) {
  const selected = events.filter(event => event.alignment_cell === cell.cell && event.event === 'Browse');
  for (const choice of ['common', 'rare']) record(`${cell.cell}:${choice}`, weightSeries[cell.cell][choice].all,
    selected.filter(event => event.choice === choice).length);
  const effect = weightSeries[cell.cell].common.all / weightSeries[cell.cell].$overall.all;
  const band = cell.treatment ? cell.thresholds.effect : cell.thresholds.neutral;
  weightEffects.push({ cell: cell.cell, effect, band, pass: effect >= band[0] && effect <= band[1] });
}
const world = readJson(resolve(directory, 'world.json'));
const worldEffects = [];
for (const cell of cells.filter(cell => cell.scenario === 'world')) {
  for (const eventName of ['Browse', 'Search']) record(`${cell.cell}:${eventName}`, metricTotals(world, cell.cell, eventName),
    events.filter(event => event.alignment_cell === cell.cell && event.event === eventName && event.time >= '2026-08-06' && event.time < '2026-08-21').length);
  if (cell.treatment) {
    const neutral = `${cell.scenario}-${cell.seed}-neutral`;
    const lift = metricTotals(world, cell.cell, 'Browse') / metricTotals(world, neutral, 'Browse');
    const control = metricTotals(world, cell.cell, 'Search') / metricTotals(world, neutral, 'Search');
    worldEffects.push({ cell: cell.cell, effect: lift, control, band: cell.thresholds.effect,
      pass: lift >= 2 && lift <= 4.1 && control >= 0.7 && control <= 1.4 });
  }
}
const retention = readJson(resolve(directory, 'retention.json'));
const retentionSeries = Object.values(retention.response.series)[0];
const retentionEffects = [];
for (const cell of cells.filter(cell => cell.scenario === 'retention')) {
  const selected = events.filter(event => event.alignment_cell === cell.cell);
  const local = emulateBreakdown(selected, { type: 'retention', cohortEvent: 'First Entry', returnEvent: '$any_event',
    dayBuckets: [1, 7, 14], bucketAlignment: 'birth', timeBucket: 'day' });
  let eligible = 0;
  let returned = 0;
  for (const row of local) {
    if (row._empty) continue;
    const live = retentionSeries[`${row.period}T00:00:00+00:00`]?.[cell.cell];
    if (!live) { record(`${cell.cell}:${row.period}:missing`, NaN, row.cohort_size); continue; }
    record(`${cell.cell}:${row.period}:cohort`, live.first, row.cohort_size);
    record(`${cell.cell}:${row.period}:D${row.day}`, live.counts[row.day], row.retained_count);
    if (row.day === 7 && row.period <= '2026-08-22') { eligible += live.first; returned += live.counts[7]; }
  }
  retentionEffects.push({ cell: cell.cell, seed: cell.seed, treatment: cell.treatment, eligible, returned, rate: returned / eligible });
}
const retentionLifts = retentionEffects.filter(cell => cell.treatment).map(cell => {
  const neutral = retentionEffects.find(other => !other.treatment && other.seed === cell.seed);
  const effect = cell.rate - neutral.rate;
  return { cell: cell.cell, effect, band: [0.1, 0.65], eligible: Math.min(cell.eligible, neutral.eligible),
    pass: effect >= 0.1 && effect <= 0.65 && Math.min(cell.eligible, neutral.eligible) >= 250 };
});
const effects = [...volumeEffects, ...weightEffects, ...worldEffects, ...retentionLifts];
const result = { runId, source: revision(), checks, effects, retentionCohorts: retentionEffects,
  passed: checks.filter(check => check.pass).length, failed: checks.filter(check => !check.pass).length,
  effectsPassed: effects.filter(effect => effect.pass).length, effectsFailed: effects.filter(effect => !effect.pass).length };
saveJson(resolve(directory, 'metric-comparison.json'), result);
console.log(JSON.stringify({ ...result, checks: undefined, failures: checks.filter(check => !check.pass).slice(0, 12) }, null, 2));
if (result.failed || result.effectsFailed) process.exitCode = 1;