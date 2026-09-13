import { resolve } from 'node:path';
import { artifactRoot, readJson, saveJson, revision } from './harness.mjs';

const runId = process.argv[2] || readJson(resolve(artifactRoot, 'latest-shapes.json')).runId;
const directory = resolve(artifactRoot, runId);
const cells = readJson(resolve(directory, 'cells.json'));
const sessions = readJson(resolve(directory, 'sessions.json'));
const checks = [];
const effects = [];
const record = (name, actual, expected) => checks.push({ name, actual, expected, pass: actual === expected });
for (const cell of cells) {
  const keys = sessions.response.meta.report_sections.show.map(metric => metric.metric_key);
  const liveSessions = sessions.response.series[keys[0]][cell.cell].all;
  const liveEvents = sessions.response.series[keys[1]][cell.cell].all;
  record(`${cell.cell}:sessions`, liveSessions, cell.sessions);
  record(`${cell.cell}:events`, liveEvents, cell.events);
  if (cell.shape === 'session') {
    record(`${cell.cell}:preserved`, liveEvents, cell.beforeEvents);
    if (cell.treatment) effects.push({ cell: cell.cell, before: cell.beforeSessions, after: liveSessions,
      pass: liveSessions < cell.beforeSessions * 0.8 && liveSessions > 0 });
  } else {
    const flow = readJson(resolve(directory, `${cell.cell}.json`)).response;
    const nodeCount = (step, event) => (flow.steps[step]?.nodes || []).filter(node => node.event === event)
      .reduce((sum, node) => sum + Number(node.totalCount), 0);
    record(`${cell.cell}:anchors`, nodeCount(0, 'Browse'), cell.flowEligible);
    record(`${cell.cell}:firstSearch`, nodeCount(1, 'Search'), cell.firstSearch);
    record(`${cell.cell}:secondHelp`, nodeCount(2, 'Help'), cell.secondHelp);
    if (cell.treatment) {
      const share = nodeCount(2, 'Help') / nodeCount(0, 'Browse');
      const before = cell.beforeTargetBranches / cell.beforeFlowEligible;
      effects.push({ cell: cell.cell, share, before, lift: share - before, pass: share >= 0.95 && share - before >= 0.15 });
    }
  }
}
const result = { runId, source: revision(), checks, effects, passed: checks.filter(check => check.pass).length,
  failed: checks.filter(check => !check.pass).length, effectsPassed: effects.filter(effect => effect.pass).length,
  effectsFailed: effects.filter(effect => !effect.pass).length };
saveJson(resolve(directory, 'shape-comparison.json'), result);
console.log(JSON.stringify({ ...result, checks: undefined, failures: checks.filter(check => !check.pass) }, null, 2));
if (result.failed || result.effectsFailed) process.exitCode = 1;