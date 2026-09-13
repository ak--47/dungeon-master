import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { artifactRoot, root, readJson, saveJson } from './harness.mjs';

const runId = process.argv[2] || 'dm182-generated-1789304162559-85a7cbdc';
const queries = [
  { name: 'volume', kind: 'insights', metrics: ['First Entry', 'First Success', 'Repeat Entry', 'Repeat Success', 'Browse', 'Search', 'Help', 'Background Activity'].map(event => ({ event, math: 'total' })),
    filters: { alignment_scenario: 'persona-volume' }, options: { mode: 'total', group_by: 'alignment_group' } },
  { name: 'weights', kind: 'insights', metrics: [{ event: 'Browse', math: 'total' }], filters: { alignment_scenario: 'weights' },
    options: { mode: 'total', group_by: ['alignment_cell', 'choice'] } },
  { name: 'world', kind: 'insights', metrics: [{ event: 'Browse', math: 'total' }, { event: 'Search', math: 'total' }],
    from: '2026-08-06', to: '2026-08-20', filters: { alignment_scenario: 'world' }, options: { mode: 'total', group_by: 'alignment_cell' } },
  { name: 'retention', kind: 'retention', birth: 'First Entry', return: '$any_event', filters: { alignment_scenario: 'retention' },
    options: { retention_unit: 'day', alignment: 'birth', unbounded_mode: 'none', retention_cumulative: false,
      group_by: 'alignment_cell', mode: 'curve' } },
];
for (const query of queries) {
  if (readJson(resolve(artifactRoot, runId, `${query.name}.json`))?.response) continue;
  const path = resolve(artifactRoot, runId, `${query.name}.spec.json`);
  saveJson(path, { runId, from: '2026-08-01', to: '2026-08-31', ...query });
  const result = spawnSync(process.execPath, [resolve(root, 'tests/alignment/live/query.mjs'), path], { stdio: 'inherit', timeout: 190000 });
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}