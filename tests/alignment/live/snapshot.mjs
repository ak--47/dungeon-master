import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { artifactRoot, root, readJson, saveJson, revision, fingerprint } from './harness.mjs';

const accepted = [
  ['exact-comparison.json', 'exact boundaries'],
  ['dm182-generated-1789278406018-6b923eef/comparison.json', 'conditions, persona TTC, V2 TTC'],
  ['dm182-generated-1789304162559-85a7cbdc/comparison-persona-conversion.json', 'persona conversion'],
  ['dm182-generated-1789304162559-85a7cbdc/metric-comparison.json', 'volume, weights, incidents, retention'],
  ['dm182-generated-1789304781298-f53a6bce/comparison.json', 'corrected experiments'],
  ['dm182-patterns-1789305308516-f9bbcfe0/pattern-comparison-aggregate-funnel-frequency-legacy-ttc.json', 'aggregate, funnel frequency, legacy TTC'],
  ['dm182-patterns-1789306376113-2e202848/pattern-comparison.json', 'capacity-bounded frequency, distinct-time attribution'],
  ['dm182-shapes-1789307262067-7b8ca9fd/shape-comparison.json', 'sessions and paths'],
];
const reports = accepted.map(([path, label]) => {
  const result = readJson(resolve(artifactRoot, path));
  assert.ok(result, `Missing acceptance ${path}`);
  assert.equal(result.failed, 0, `Failed acceptance ${path}`);
  assert.equal(result.effectsFailed || 0, 0, `Failed effect ${path}`);
  return { label, artifact: path, ...result };
});
const imports = readJson(resolve(artifactRoot, 'imports.json'));
const queryLedger = readJson(resolve(artifactRoot, 'queries.json'));
const queryEvidence = [];
for (const run of imports.runs) {
  const directory = resolve(artifactRoot, run.runId);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const file = resolve(directory, name);
    const data = readJson(file);
    if (!data?.request || !data?.response || name.startsWith('export')) continue;
    queryEvidence.push({ runId: run.runId, file: name, at: data.at, specification: data.specification,
      request: data.request, computedAt: data.response.computed_at,
      responseHash: fingerprint(data.response), metadata: data.response.meta || data.response.metadata,
      response: data.response });
  }
}
const sourcePaths = ['lib/verify/identity.js', 'lib/verify/emulate-breakdown.js', 'lib/verify/counting.js',
  'lib/verify/funnel-engine.js', 'lib/verify/story-runner.js', 'lib/verify/verify-dungeon.js',
  'lib/generators/funnels.js', 'lib/hook-patterns/funnel-frequency-breakdown.js'];
const evidence = { version: '1.8.2', generatedAt: new Date().toISOString(), source: revision(),
  sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, fingerprint(readFileSync(resolve(root, path), 'utf8'))])),
  analyticsRevision: '717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a', projectId: 4063241,
  imported: imports.runs.reduce((sum, run) => sum + (run.success || 0), 0),
  reserved: imports.runs.reduce((sum, run) => sum + run.reserved, 0), eventLimit: 25000000,
  queryAttempts: queryLedger.length, reports, queries: queryEvidence,
  comparisons: reports.reduce((sum, report) => sum + report.passed, 0),
  effects: reports.reduce((sum, report) => sum + (report.effectsPassed || 0), 0),
  historicalPatternFailures: readJson(resolve(artifactRoot, 'dm182-patterns-1789305308516-f9bbcfe0/pattern-comparison.json')),
  scope: 'Selected UTC report contracts on fixed-seed mixed traffic. Timing tolerance is one integer second. Counts require exact equality. Query records include early incomplete snapshots. Accepted reports identify the final checks; early snapshots are not passes.' };
const serialized = JSON.stringify(evidence);
const privateEnv = readFileSync(resolve(artifactRoot, 'auth.env'), 'utf8');
for (const line of privateEnv.split('\n')) {
  const value = line.slice(line.indexOf('=') + 1);
  if (value.length > 12) assert.ok(!serialized.includes(value), 'Credential found in evidence');
}
saveJson(resolve(root, 'tests/alignment/live/evidence.json'), evidence);
console.log(JSON.stringify({ comparisons: evidence.comparisons, effects: evidence.effects, imported: evidence.imported,
  queryAttempts: evidence.queryAttempts, recordedResponses: queryEvidence.length }));