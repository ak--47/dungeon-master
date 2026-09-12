import { describe, expect, it } from 'vitest';
import { classify, wilson } from './sweep.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCell, candidateGroups, estimateGroup, nextGroup, writeReport, seedSpreads, coverageAudit, SEEDS, POLICY } from './sweep.mjs';
import { evaluateCell } from './sweep-worker.mjs';

describe('sweep evidence', () => {
  it('uses users as the binomial denominator and handles empty cohorts', () => {
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(11, 10)).toBeNull();
    expect(wilson(5, 10)[0]).toBeCloseTo(0.236593, 5);
    expect(wilson(5, 10)[1]).toBeCloseTo(0.763407, 5);
  });

  it('keeps strict thresholds but reports small samples without throwing', () => {
    const baseline = { effect: 0.4, neutral: 0, effectBand: [0.25, 0.55], neutralBand: [-0.12, 0.12], users: 300, minimum: 200 };
    expect(classify(baseline)).toBe('supported');
    expect(classify({ ...baseline, users: 30 })).toBe('insufficient-evidence');
    expect(classify({ ...baseline, effect: 0.249 })).toBe('diluted');
    expect(classify({ ...baseline, effect: -0.01 })).toBe('inverse');
    expect(classify({ ...baseline, effect: 0.551 })).toBe('contractfail');
    expect(classify({ ...baseline, neutral: 0.121 })).toBe('contractfail');
    expect(classify({ ...baseline, users: 0, contractErrors: ['bad identity'] })).toBe('contractfail');
  });

  it('classifies lower-is-better TTC ratios', () => {
    const baseline = { effect: 0.25, neutral: 1, effectBand: [0.15, 0.4], neutralBand: [0.75, 1.3], users: 100, minimum: 70, nullValue: 1 };
    expect(classify(baseline)).toBe('supported');
    expect(classify({ ...baseline, effect: 0.6 })).toBe('diluted');
    expect(classify({ ...baseline, effect: 1.1 })).toBe('inverse');
    expect(classify({ ...baseline, effect: 0.1 })).toBe('contractfail');
  });
});

describe.sequential('sweep execution', () => {
  it('runs a real sandboxed cell and returns compact user evidence', async () => {
    const result = await runCell({ id: 'conditions', users: 100, traffic: 'sparse', targetPercent: 5,
      seed: 'alignment-generated-17' }, { deadline: Date.now() + 10000 });
    expect(result.execution, result.error).toBe('complete');
    expect(result.verdict).toBe('insufficient-evidence');
    expect(result.samples).toHaveLength(2);
    for (const sample of result.samples) {
      expect(sample.events).toBeGreaterThan(0);
      expect(sample.requested.numUsers).toBe(100);
      expect(sample.resolved.numUsers).toBe(100);
      expect(sample.requested).not.toHaveProperty('credentials');
      expect(sample.resolved).not.toHaveProperty('token');
      expect(sample.target.interval95).toHaveLength(2);
      expect(sample.countErrors).toEqual([]);
    }
    expect(result.samples[0]).not.toHaveProperty('profiles');
  }, 15000);

  it('stratifies sizes, traffic and both rarity directions with conservative estimates', () => {
    const groups = candidateGroups();
    expect([...new Set(groups.map(group => group.users))].sort((left, right) => left - right)).toEqual([100, 300, 1000, 3000, 10000, 11111]);
    expect(new Set(groups.map(group => group.targetPercent))).toEqual(new Set([5, 50, 95]));
    expect(estimateGroup({ id: 'conditions', users: 10000, traffic: 'dense' }, [{ id: 'conditions', users: 300, traffic: 'sparse', elapsedMs: 1000, execution: 'complete' }])).toBeGreaterThan(100000);
  });

  it('dynamic budget uses updated actual costs and schedules whole seed groups', () => {
    const group = { id: 'hook-ttc', users: 3000, traffic: 'dense', targetPercent: 50 };
    const slowPilot = [{ ...group, users: 300, elapsedMs: 1000, execution: 'complete' }];
    expect(nextGroup([group], slowPilot, 20000)).toBeUndefined();
    const actual = [...slowPilot, ...SEEDS.map(seed => ({ ...group, seed, elapsedMs: 1000, execution: 'complete' }))];
    expect(nextGroup([group], actual, 20000)).toEqual(group);
    expect(nextGroup([group], actual, 5000)).toBeUndefined();
  });

  it('paired metrics use Q and N, retain baseline, and enforce retention segment minima', () => {
    const sample = { target: { converted: 80, entrants: 300 }, control: { converted: 90, entrants: 300 }, countErrors: [],
      ttcRatio: 0.6, baselineTtcRatio: 2.4, baselineAdjustedTtcRatio: 0.25, interventionNeutralTtcRatio: 1,
      retention: { entrants: 300, rate: 0.4 }, neutralRetentionCohorts: [{ entrants: 150, rate: 0.2 }, { entrants: 150, rate: 0.25 }] };
    const hook = evaluateCell({ id: 'hook-ttc' }, [sample, sample]);
    expect(hook.metrics.primary).toMatchObject({ effect: 0.25, neutral: 1, baselineRatio: 2.4, verdict: 'supported' });
    expect(evaluateCell({ id: 'hook-ttc' }, [{ ...sample, target: { converted: 69 } }, sample]).verdict).toBe('insufficient-evidence');
    const low = { ...sample, retention: { entrants: 300, rate: 0.2 } };
    const retention = evaluateCell({ id: 'retention' }, [sample, low]);
    expect(retention.samples).toHaveLength(2);
    expect(retention.metrics.primary.neutral).toBeCloseTo(-0.05);
    expect(retention.verdict).toBe('supported');
    expect(evaluateCell({ id: 'retention' }, [sample, { ...low, neutralRetentionCohorts: [{ entrants: 99, rate: 0.2 }, { entrants: 201, rate: 0.25 }] }]).verdict).toBe('insufficient-evidence');
    expect(evaluateCell({ id: 'retention' }, [sample, { ...low, retention: { entrants: 249, rate: 0.2 } }]).verdict).toBe('insufficient-evidence');
  });

  it('runs real paired hook and same-low retention cells under the network sandbox', async () => {
    for (const id of ['hook-ttc', 'retention']) {
      const result = await runCell({ id, users: 3000, traffic: 'dense', targetPercent: 50, seed: SEEDS[0] }, { deadline: Date.now() + 20000 });
      expect(result.execution, result.error).toBe('complete');
      expect(result.samples).toHaveLength(2);
      expect(result.samples.every(sample => sample.standaloneCount > 100)).toBe(true);
      if (id === 'hook-ttc') {
        expect(result.metrics.primary.effect).toBe(result.samples[0].baselineAdjustedTtcRatio);
        expect(result.metrics.primary.neutral).toBe(1);
        expect(result.samples[0].pairing.exactCompletionMembership).toBe(true);
      } else {
        expect(result.metrics.primary.neutral).toBe(result.samples[1].neutralRetentionCohorts[0].rate - result.samples[1].neutralRetentionCohorts[1].rate);
      }
    }
  }, 45000);

  it('persists explicit partial reports without inventing completed evidence', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'alignment-sweep-')), 'partial');
    const report = { status: 'partial', budgetMs: 600000, elapsedMs: 25, scheduledCells: 3,
      cells: [{ id: 'conditions', execution: 'deadline' }] };
    writeReport(report, output);
    const saved = JSON.parse(readFileSync(`${output}.json`, 'utf8'));
    expect(saved.status).toBe('partial');
    expect(saved.summary.completedCells).toBe(0);
    expect(saved.summary.events).toBe(0);
    expect(readFileSync(`${output}.md`, 'utf8')).toContain('0/3');
    expect(seedSpreads([1, 2, 3].map(effect => ({ execution: 'complete', id: 'conditions', users: 100,
      traffic: 'sparse', targetPercent: 50, metrics: { primary: { effect } }, verdict: 'supported' })))[0].effect).toEqual({ min: 1, max: 3, mean: 2 });
  });

  it('requires practical-size focus evidence and prioritizes it before large-cell expansion', () => {
    const groups = candidateGroups();
    expect(groups.slice(0, 14).every(group => group.users === 1000 && group.targetPercent === 50)).toBe(true);
    const cells = groups.flatMap(group => SEEDS.map(seed => ({ ...group, seed, execution: 'complete' })));
    expect(coverageAudit(cells).complete).toBe(true);
    const incomplete = coverageAudit(cells.filter(row => row.id !== 'retention' || row.users < 1000));
    expect(incomplete.complete).toBe(false);
    expect(incomplete.missing).toContain('focus:retention/dense/users>=1000');
    expect(coverageAudit(cells.filter(row => row.seed !== SEEDS[2])).complete).toBe(false);
  });

  it('kills a started hanging worker and its descendant at the runner deadline after preflight', async () => {
    const output = join(mkdtempSync(join(tmpdir(), 'alignment-sweep-')), 'probe');
    const child = spawn('/usr/bin/sandbox-exec', ['-p', POLICY, process.execPath, fileURLToPath(new URL('./run.mjs', import.meta.url)), '--sweep', '--probe-hang',
      '--timeout-ms=12000', `--output=${output}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    expect(code, stderr).toBe(124);
    expect(stdout).toContain('offline preflight');
    expect(stdout).toContain('Sweep hanging worker started:');
    expect(stdout).not.toContain('regression gate');
    const report = JSON.parse(readFileSync(`${output}.json`, 'utf8'));
    expect(report.status).toBe('deadline');
    expect(report.phase).toBe('hanging-worker-probe');
    expect(report.active.pid).toBeGreaterThan(0);
    expect(report.active.descendantPid).toBeGreaterThan(0);
    for (const pid of [report.active.pid, report.active.descendantPid]) {
      await expect.poll(() => {
        try { process.kill(pid, 0); return 'alive'; }
        catch (error) { return error.code; }
      }, { timeout: 2000 }).toBe('ESRCH');
    }
  }, 20000);
});