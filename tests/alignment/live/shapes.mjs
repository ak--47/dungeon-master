import { resolve } from 'node:path';
import generate from '../../../index.js';
import { applySessionShape, applyPathBias } from '../../../lib/hook-helpers/index.js';
import { sessionize } from '../../../lib/verify/sessionize.js';
import { extractFlows } from '../../../lib/verify/flows.js';
import { makeFixture } from '../fixtures.mjs';
import { artifactRoot, importRun, isolate, newRunId, saveJson, runProperty } from './harness.mjs';

const runId = newRunId('shapes');
const events = [];
const profiles = [];
const cells = [];
for (const shape of ['session', 'path']) for (const seed of [17, 43, 89]) for (const treatment of [false, true]) {
  const cell = `${shape}-${seed}-${treatment ? 'treatment' : 'neutral'}`;
  const config = makeFixture(`alignment-generated-${seed}`, 'dense', 300);
  Object.assign(config, { numEvents: 9000, avgEventsPerUserPerDay: 1, percentUsersBornInDataset: 0,
    datasetStart: '2026-08-01T00:00:00Z', datasetEnd: '2026-08-31T00:00:00Z' });
  config.superProps = { [runProperty]: [runId], alignment_cell: [cell] };
  const before = [];
  config.hook = (records, type, meta) => {
    if (type !== 'everything') return records;
    before.push(...structuredClone(records));
    if (treatment && shape === 'session') applySessionShape(records, meta.profile.distinct_id, {
      sessionsPerWeek: 3, eventsPerSession: 3, sessionMinutes: 5,
      datasetStart: meta.datasetStart, datasetEnd: meta.datasetEnd,
    });
    if (treatment && shape === 'path') applyPathBias(records, meta.profile.distinct_id, {
      anchor: 'Browse', path: ['Search', 'Help'], share: 1,
    });
    return records;
  };
  const output = await generate(config);
  const scoped = isolate(Array.from(output.eventData), Array.from(output.userProfilesData), `${runId}:${cell}`);
  scoped.events.forEach(event => { event[runProperty] = runId; });
  scoped.profiles.forEach(profile => { profile[runProperty] = runId; });
  const flows = extractFlows(scoped.events, { anchors: ['Browse'], forward: 2, countType: 'unique', collapseRepeated: false });
  const baselineFlows = extractFlows(before, { anchors: ['Browse'], forward: 2, countType: 'unique', collapseRepeated: false });
  const targetBranch = flow => flow.steps.map(step => step.label).join('>') === 'Browse>Search>Help';
  cells.push({ cell, shape, seed, treatment, events: scoped.events.length, users: scoped.profiles.length,
    beforeEvents: before.length, sessions: sessionize(scoped.events).sessions.length,
    beforeSessions: sessionize(before).sessions.length, flowEligible: flows.length, targetBranches: flows.filter(targetBranch).length,
    beforeFlowEligible: baselineFlows.length, beforeTargetBranches: baselineFlows.filter(targetBranch).length,
    firstSearch: flows.filter(flow => flow.steps[1]?.label === 'Search').length,
    secondHelp: flows.filter(flow => flow.steps[2]?.label === 'Help').length });
  events.push(...scoped.events);
  profiles.push(...scoped.profiles);
}
saveJson(resolve(artifactRoot, runId, 'cells.json'), cells);
await importRun(runId, events, profiles);
saveJson(resolve(artifactRoot, 'latest-shapes.json'), { runId });