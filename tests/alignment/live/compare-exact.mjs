import { resolve } from 'node:path';
import { emulateBreakdown, frequencyHistogram } from '../../../lib/verify/index.js';
import { artifactRoot, readJson, saveJson, revision } from './harness.mjs';

const checks = [];
const record = (name, actual, expected) => checks.push({ name, actual, expected,
  pass: JSON.stringify(actual) === JSON.stringify(expected) });
const exact = readJson(resolve(artifactRoot, 'latest-exact.json')).runId;
const boundaries = readJson(resolve(artifactRoot, 'latest-boundaries.json')).runId;
const read = (runId, name) => readJson(resolve(artifactRoot, runId, `${name}.json`));
const events = read(exact, 'events');
const totals = read(exact, 'totals');
for (const [index, metric] of totals.specification.metrics.entries()) {
  const key = totals.response.meta.report_sections.show[index].metric_key;
  record(`total:${metric.event}`, totals.response.series[key].all, events.filter(event => event.event === metric.event).length);
}
record('numeric and unique metrics', Object.values(read(exact, 'uniques-sums').response.series).map(value => value.all), [4, 3, 10, 2.5, 2, 2]);
for (const [name, steps, options] of [
  ['funnel-unique', ['Align A', 'Align B'], { countMode: 'uniques' }],
  ['funnel-total', ['Align A', 'Align B'], { countMode: 'totals', reentry: true }],
  ['session-hpc', ['Align Session A', 'Align Session B'], { countMode: 'sessions', holdPropertyConstant: 'plan' }],
]) {
  const local = emulateBreakdown(events, { type: 'funnelFrequency', steps, breakdownByFrequencyOf: steps[0], ...options });
  const live = Object.values(read(exact, name).response.series)[0];
  record(name, Object.values(live.count).map(value => value.all), steps.map((step, index) => local.filter(row => row.step_index === index).reduce((sum, row) => sum + row.conversions, 0)));
}
const identity = Object.values(read(exact, 'identity').response.series)[0];
record('identity stitched', Object.values(identity.stitched.count).map(value => value.all), [1, 1]);
record('identity unstitched', Object.values(identity.unstitched.count).map(value => value.all), [1, 0]);
const retention = Object.values(read(exact, 'retention').response.series)[0]['2026-08-01T00:00:00+00:00'];
record('retention birth/D1/D7', [retention.first, retention.counts[1], retention.counts[7]], [3, 3, 2]);
const boundaryEvents = read(boundaries, 'events');
for (const [name, steps, options] of [
  ['list-unique', ['List A', 'List B'], { countMode: 'uniques' }],
  ['list-total', ['List A', 'List B'], { countMode: 'totals', reentry: true }],
  ['list-session', ['List Session A', 'List Session B'], { countMode: 'sessions' }],
]) {
  const local = emulateBreakdown(boundaryEvents, { type: 'funnelFrequency', steps, breakdownByFrequencyOf: steps[0], holdPropertyConstant: 'cart', ...options });
  const live = Object.values(read(boundaries, name).response.series)[0];
  record(name, Object.values(live.count).map(value => value.all), steps.map((step, index) => local.filter(row => row.step_index === index).reduce((sum, row) => sum + row.conversions, 0)));
}
const histogram = frequencyHistogram(boundaryEvents, { event: 'Boundary Frequency', unit: 'day', intervalDays: 31 })[0].histogram;
const cumulative = histogram.map((count, index) => histogram.slice(index).reduce((sum, value) => sum + value, 0));
record('rolling frequency cumulative', Object.values(read(boundaries, 'rolling-frequency').response.data)[0].slice(0, cumulative.length), cumulative);
for (const [name, model] of [['first_touch', 'firstTouch'], ['last_touch', 'lastTouch']]) {
  const local = emulateBreakdown(boundaryEvents, { type: 'attributedBy', conversionEvent: 'Attr Buy', attributionEvent: 'Attr Touch',
    attributionProperty: 'source', perConversion: 'all', model });
  const live = Object.values(read(boundaries, name).response.series)[0];
  for (const row of local) record(`${name}:${row.attribution_value}`, live[row.attribution_value === 'unknown' ? 'undefined' : row.attribution_value]?.all || 0, row.conversions);
  record(`${name}:total`, live.$overall.all, 3);
}
const result = { source: revision(), runs: [exact, boundaries], checks, passed: checks.filter(check => check.pass).length,
  failed: checks.filter(check => !check.pass).length };
saveJson(resolve(artifactRoot, 'exact-comparison.json'), result);
console.log(JSON.stringify({ ...result, checks: undefined, failures: checks.filter(check => !check.pass) }, null, 2));
if (result.failed) process.exitCode = 1;