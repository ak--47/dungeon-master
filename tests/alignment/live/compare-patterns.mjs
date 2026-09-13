import { resolve } from 'node:path';
import { emulateBreakdown } from '../../../lib/verify/emulate-breakdown.js';
import { artifactRoot, readJson, saveJson, revision } from './harness.mjs';

const runId = process.argv[2] || readJson(resolve(artifactRoot, 'latest-patterns.json')).runId;
const directory = resolve(artifactRoot, runId);
const events = readJson(resolve(directory, 'events.json'));
const selectedPatterns = process.argv.slice(3);
const cells = readJson(resolve(directory, 'cells.json')).filter(cell => !selectedPatterns.length || selectedPatterns.includes(cell.pattern));
if (!cells.length) throw new Error('No selected pattern cells');
const patterns = new Set(cells.map(cell => cell.pattern));
const checks = [];
const effects = [];
const record = (name, actual, expected, tolerance = 0) => checks.push({ name, actual, expected, tolerance,
  pass: Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance });
const metricValue = (evidence, index, group) => evidence.response.series[evidence.response.meta.report_sections.show[index].metric_key]?.[group]?.all || 0;
for (const pattern of ['frequency', 'aggregate']) {
  if (!patterns.has(pattern)) continue;
  const evidence = readJson(resolve(directory, `${pattern}.json`));
  for (const cell of cells.filter(cell => cell.pattern === pattern)) for (const bin of ['low', 'high']) {
    const group = `${cell.cell}:${bin}`;
    const summary = cell.summary[bin];
    const rows = events.filter(event => event.alignment_group === group && event.event === 'Browse');
    record(`${group}:count`, metricValue(evidence, 0, group), rows.length);
    record(`${group}:users`, metricValue(evidence, 1, group), new Set(rows.map(event => event.user_id)).size);
    record(`${group}:sum`, metricValue(evidence, 2, group), summary.amount);
    record(`${group}:average`, metricValue(evidence, 3, group), summary.amount / rows.length, 0.00001);
    const effect = pattern === 'frequency' ? metricValue(evidence, 0, group) / summary.beforeBrowse
      : metricValue(evidence, 2, group) / summary.beforeAmount;
    const expected = cell.treatment && bin === 'high' ? 2 : 1;
    effects.push({ cell: cell.cell, bin, effect, expected, population: summary.users,
      pass: Math.abs(effect - expected) < 0.001 && summary.users >= 100 });
  }
}
for (const pattern of ['funnel-frequency', 'legacy-ttc']) {
  if (!patterns.has(pattern)) continue;
  const evidence = readJson(resolve(directory, `${pattern}.json`));
  const series = Object.values(evidence.response.series)[0];
  for (const cell of cells.filter(cell => cell.pattern === pattern)) {
    const groups = pattern === 'legacy-ttc' ? ['target', 'control'] : ['high', 'low'];
    const live = {};
    for (const group of groups) {
      const result = series[`${cell.cell}:${group}`];
      const counts = Object.values(result.count).map(value => value.all);
      const time = Object.values(result.avg_time_from_start).at(-1).all;
      const local = cell.summary[group].report;
      record(`${cell.cell}:${group}:entrants`, counts[0], local.entrants);
      record(`${cell.cell}:${group}:converted`, counts.at(-1), local.converted);
      record(`${cell.cell}:${group}:TTC`, time, local.meanHours * 3600, 1);
      live[group] = { rate: counts.at(-1) / counts[0], time, entrants: counts[0] };
    }
    const effect = pattern === 'legacy-ttc' ? live.target.time / live.control.time : live.high.rate - live.low.rate;
    const band = pattern === 'legacy-ttc' ? (cell.treatment ? [0.4, 0.6] : [0.8, 1.2])
      : (cell.treatment ? [0.35, 0.75] : [-0.12, 0.12]);
    effects.push({ cell: cell.cell, effect, band, population: Math.min(...Object.values(live).map(value => value.entrants)),
      pass: effect >= band[0] && effect <= band[1] && Math.min(...Object.values(live).map(value => value.entrants)) >= 100 });
  }
}
const histogram = patterns.has('frequency') ? Object.values(readJson(resolve(directory, 'frequency-histogram.json')).response.series)[0] : {};
for (const [group, buckets] of Object.entries(histogram).filter(([group]) => group !== '$overall')) {
  const counts = new Map();
  for (const event of events.filter(event => event.alignment_group === group && event.event === 'Browse')) {
    counts.set(event.user_id, (counts.get(event.user_id) || 0) + 1);
  }
  record(`${group}:histogramPopulation`, buckets.$overall.all, counts.size);
  for (const [label, value] of Object.entries(buckets).filter(([label]) => label !== '$overall')) {
    const bounds = label.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (!bounds) throw new Error(`Unrecognized histogram label: ${label}`);
    const matches = count => label.startsWith('>=') ? count >= bounds[0]
      : label.startsWith('<') ? count < bounds[0]
      : bounds.length === 2 ? count >= bounds[0] && count < bounds[1] : count === bounds[0];
    record(`${group}:histogram:${label}`, value.all, [...counts.values()].filter(matches).length);
  }
}
const attribution = patterns.has('attribution') ? Object.values(readJson(resolve(directory, 'attribution.json')).response.series)[0] : {};
for (const cell of cells.filter(cell => cell.pattern === 'attribution')) {
  const selected = events.filter(event => event.alignment_cell === cell.cell);
  const local = emulateBreakdown(selected, { type: 'attributedBy', conversionEvent: 'Browse', attributionEvent: 'Search',
    attributionProperty: 'utm_source', perConversion: 'all', model: 'firstTouch' });
  const sourceCounts = new Map(local.map(row => [row.attribution_value === 'unknown' ? 'undefined' : row.attribution_value, row.conversions]));
  const live = attribution[cell.cell];
  for (const source of new Set([...sourceCounts.keys(), ...Object.keys(live).filter(key => key !== '$overall')])) {
    record(`${cell.cell}:attribution:${source}`, live[source]?.all || 0, sourceCounts.get(source) || 0);
  }
  const eligible = live.$overall.all - (live.undefined?.all || 0);
  const effect = (live.engineered?.all || 0) / eligible;
  effects.push({ cell: cell.cell, effect, eligible, pass: eligible >= 100 && (cell.treatment ? effect >= 0.9 : effect === 0) });
}
const result = { runId, source: revision(), checks, effects,
  selectedPatterns: [...patterns],
  passed: checks.filter(check => check.pass).length, failed: checks.filter(check => !check.pass).length,
  effectsPassed: effects.filter(effect => effect.pass).length, effectsFailed: effects.filter(effect => !effect.pass).length };
saveJson(resolve(directory, selectedPatterns.length ? `pattern-comparison-${selectedPatterns.join('-')}.json` : 'pattern-comparison.json'), result);
console.log(JSON.stringify({ ...result, checks: undefined, failures: checks.filter(check => !check.pass).slice(0, 20) }, null, 2));
if (result.failed || result.effectsFailed) process.exitCode = 1;