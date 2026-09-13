import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { artifactRoot, readJson, saveJson } from './harness.mjs';

dotenv.config({ path: resolve(artifactRoot, 'auth.env') });
for (const pointer of ['latest-exact', 'latest-identity-wire']) {
  const { runId } = readJson(resolve(artifactRoot, `${pointer}.json`));
  const parameters = new URLSearchParams({ from_date: '2026-08-01', to_date: '2026-08-31',
    where: `properties["alignment_run_id"] == ${JSON.stringify(runId)}` });
  const response = await fetch(`https://data.mixpanel.com/api/2.0/export?${parameters}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.ALIGNMENT_API_SECRET}:`).toString('base64')}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Scoped export: HTTP ${response.status}`);
  const events = (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  saveJson(resolve(artifactRoot, runId, 'export.json'), { request: Object.fromEntries(parameters), response: { events } });
  console.log(JSON.stringify({ runId, events: events.filter(event => /Identity|Login|Wire/.test(event.event)).map(event => ({
    event: event.event, distinct_id: event.properties?.distinct_id, user_id: event.properties?.$user_id,
    device_id: event.properties?.$device_id, mode: event.properties?.mode, case: event.properties?.case,
  })) }));
}