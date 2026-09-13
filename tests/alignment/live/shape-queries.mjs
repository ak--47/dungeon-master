import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { artifactRoot, root, readJson, saveJson } from './harness.mjs';

const runId = process.argv[2] || readJson(resolve(artifactRoot, 'latest-shapes.json')).runId;
const cells = readJson(resolve(artifactRoot, runId, 'cells.json'));
const queries = [{ name: 'sessions', kind: 'insights', metrics: [{ event: '$all_events', math: 'sessions' },
  { event: '$all_events', math: 'total' }], options: { mode: 'total', group_by: 'alignment_cell' } },
...cells.filter(cell => cell.shape === 'path').map(cell => ({ name: cell.cell, kind: 'flow', anchor: 'Browse',
  filters: { alignment_cell: cell.cell }, options: { forward: 2, reverse: 0, count_type: 'unique',
    collapse_repeated: false, conversion_window: 30, conversion_window_unit: 'day', cardinality: 30, mode: 'sankey' } }))];
for (const query of queries) {
  if (readJson(resolve(artifactRoot, runId, `${query.name}.json`))?.response) continue;
  const path = resolve(artifactRoot, runId, `${query.name}.spec.json`);
  saveJson(path, { runId, from: '2026-08-01', to: '2026-08-31', ...query });
  const result = spawnSync(process.execPath, [resolve(root, 'tests/alignment/live/query.mjs'), path], { stdio: 'inherit', timeout: 190000 });
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}