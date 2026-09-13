import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { artifactRoot, readJson, saveJson, revision, fingerprint } from './harness.mjs';

const runId = process.argv[2] || readJson(resolve(artifactRoot, 'latest-generated.json')).runId;
const directory = resolve(artifactRoot, runId);
const events = readJson(resolve(directory, 'events.json'));
const scenarioNames = process.argv.slice(3);
const cells = readJson(resolve(directory, 'cells.json')).filter(cell => !scenarioNames.length || scenarioNames.includes(cell.scenario));
assert.ok(cells.length, 'No selected generated cells');
const findings = [];
const record = (name, actual, expected, tolerance = 0) => {
  const pass = typeof expected === 'number' && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
  findings.push({ name, actual, expected, tolerance, pass });
};
for (const cell of cells) {
  const totals = readJson(resolve(directory, `totals-${cell.treatment ? 'treatment' : 'neutral'}.json`))
    || readJson(resolve(directory, 'totals.json'));
  const subset = events.filter(event => event.alignment_cell === cell.cell);
  for (const [index, metric] of totals.specification.metrics.entries()) {
    const metricKey = totals.response.meta.report_sections.show[index].metric_key;
    const actual = totals.response.series[metricKey]?.[cell.cell]?.all || 0;
    const expected = subset.filter(event => event.event === metric.event).length;
    record(`${cell.cell}:total:${metric.event}`, actual, expected);
  }
}
for (const scenario of [...new Set(cells.map(cell => cell.scenario))]) {
  const evidence = readJson(resolve(directory, `${scenario}.json`));
  if (!evidence) continue;
  const metric = Object.values(evidence.response.series)[0];
  for (const cell of cells.filter(cell => cell.scenario === scenario)) for (const segment of ['target', 'control']) {
    const series = metric[`${cell.cell}:${segment}`];
    assert.ok(series, `Missing live segment ${cell.cell}:${segment}`);
    const counts = Object.values(series.count).map(value => value.all);
    record(`${cell.cell}:${segment}:entrants`, counts[0], cell.summary[segment].entrants);
    record(`${cell.cell}:${segment}:converted`, counts.at(-1), cell.summary[segment].converted);
    const time = Object.values(series.avg_time_from_start).at(-1).all;
    record(`${cell.cell}:${segment}:meanSeconds`, time, cell.summary[segment].meanHours * 3600, 1);
  }
}
const effects = [];
for (const cell of cells.filter(cell => ['conditions', 'persona-conversion', 'persona-ttc', 'hook-ttc', 'experiment'].includes(cell.scenario))) {
  const evidence = readJson(resolve(directory, `${cell.scenario}.json`));
  if (!evidence) continue;
  const metric = Object.values(evidence.response.series)[0];
  const report = segment => {
    const series = metric[`${cell.cell}:${segment}`];
    const counts = Object.values(series.count).map(value => value.all);
    return { entrants: counts[0], converted: counts.at(-1), rate: counts.at(-1) / counts[0],
      time: Object.values(series.avg_time_from_start).at(-1).all };
  };
  const target = report('target');
  const control = report('control');
  const timing = cell.scenario.includes('ttc');
  let effect = timing ? target.time / control.time : target.rate - control.rate;
  if (cell.scenario === 'hook-ttc') effect /= cell.baseline.target.meanHours / cell.baseline.control.meanHours;
  const band = cell.treatment ? cell.thresholds.effect : cell.thresholds.neutral;
  const denominator = Math.min(target[timing ? 'converted' : 'entrants'], control[timing ? 'converted' : 'entrants']);
  const pass = denominator >= cell.thresholds.minimum && effect >= band[0] && effect <= band[1];
  effects.push({ cell: cell.cell, effect, band, denominator, minimum: cell.thresholds.minimum, pass });
  if (cell.scenario === 'experiment') {
    const timingEffect = target.time / control.time;
    const timingBand = cell.treatment ? cell.thresholds.ttcEffect : cell.thresholds.ttcNeutral;
    const converters = Math.min(target.converted, control.converted);
    effects.push({ cell: `${cell.cell}:timing`, effect: timingEffect, band: timingBand, denominator: converters, minimum: 70,
      pass: converters >= 70 && timingEffect >= timingBand[0] && timingEffect <= timingBand[1] });
  }
}
const result = { runId, source: revision(), events: events.length, eventHash: fingerprint(events),
  selectedScenarios: [...new Set(cells.map(cell => cell.scenario))],
  passed: findings.filter(finding => finding.pass).length, failed: findings.filter(finding => !finding.pass).length,
  effectsPassed: effects.filter(effect => effect.pass).length, effectsFailed: effects.filter(effect => !effect.pass).length,
  findings, effects };
saveJson(resolve(directory, scenarioNames.length ? `comparison-${scenarioNames.join('-')}.json` : 'comparison.json'), result);
console.log(JSON.stringify({ runId, passed: result.passed, failed: result.failed, effectsPassed: result.effectsPassed,
  effectsFailed: result.effectsFailed, failures: findings.filter(finding => !finding.pass).slice(0,12), effects }, null, 2));
if (result.failed || result.effectsFailed) process.exitCode = 1;