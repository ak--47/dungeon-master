import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { artifactRoot, root, readJson } from './harness.mjs';

const [runId, ...names] = process.argv.slice(2);
if (!runId?.startsWith('dm182-') || !names.length) throw new Error('Pass a run ID and query names');
for (const name of names) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid query name');
  const path = resolve(artifactRoot, runId, `${name}.spec.json`);
  const spec = readJson(path);
  if (!spec || spec.runId !== runId) throw new Error('Retained query run ID mismatch');
  const result = spawnSync(process.execPath, [resolve(root, 'tests/alignment/live/query.mjs'), path], { stdio: 'inherit', timeout: 190000 });
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}