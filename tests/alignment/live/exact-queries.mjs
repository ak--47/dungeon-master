import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { artifactRoot, root, readJson, saveJson } from './harness.mjs';

const { runId } = readJson(resolve(artifactRoot, 'latest-exact.json'));
const common = { runId, from: '2026-08-01', to: '2026-08-31' };
const queries = [
  { name: 'uniques-sums', kind: 'insights', metrics: [
    { event: 'Align A', math: 'unique' }, { event: 'Align B', math: 'unique' },
    { event: 'Align A', math: 'total', property: 'amount' }, { event: 'Align A', math: 'average', property: 'amount' },
    { event: 'Align Identity A', math: 'unique' }, { event: 'Align Identity B', math: 'unique' },
  ], options: { mode: 'total' } },
  { name: 'funnel-unique', kind: 'funnel', steps: ['Align A', 'Align B'], options: {
    math: 'conversion_rate_unique', conversion_window: 30, conversion_window_unit: 'day', mode: 'steps' } },
  { name: 'funnel-total', kind: 'funnel', steps: ['Align A', 'Align B'], options: {
    math: 'conversion_rate_total', conversion_window: 30, conversion_window_unit: 'day', reentry_mode: 'default', mode: 'steps' } },
  { name: 'identity', kind: 'funnel', steps: ['Align Identity A', 'Align Identity B'], options: {
    math: 'conversion_rate_unique', conversion_window: 30, conversion_window_unit: 'day', group_by: 'case', mode: 'steps' } },
  { name: 'session-hpc', kind: 'funnel', steps: ['Align Session A', 'Align Session B'], options: {
    math: 'conversion_rate_session', conversion_window: 1, conversion_window_unit: 'session', holding_constant: 'plan', mode: 'steps' } },
  { name: 'retention', kind: 'retention', birth: 'Align Birth', return: 'Align Return', options: {
    retention_unit: 'day', alignment: 'birth', unbounded_mode: 'none', retention_cumulative: false, mode: 'curve' } },
  { name: 'flow', kind: 'flow', anchor: 'Align A', options: {
    forward: 2, reverse: 0, count_type: 'unique', conversion_window: 30,
    conversion_window_unit: 'day', collapse_repeated: false, cardinality: 20, mode: 'sankey' } },
];
const selected = process.argv.slice(2);
for (const query of queries.filter(query => !selected.length || selected.includes(query.name))) {
  const specification = { ...common, ...query };
  const path = resolve(artifactRoot, runId, `${query.name}.spec.json`);
  saveJson(path, specification);
  const result = spawnSync(process.execPath, [resolve(root, 'tests/alignment/live/query.mjs'), path],
    { cwd: root, stdio: 'inherit', timeout: 190000 });
  if (result.error || result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}