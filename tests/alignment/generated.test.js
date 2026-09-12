import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { makeFixture, runFixture, SEEDS } from './fixtures.mjs';
import { measureFunnel, mean, range, wilson } from './measures.mjs';
import { runScenario, SCENARIOS, scenarioConfig, measureScenario } from './scenarios.mjs';
import { buildCoverage, writeCoverage } from './coverage-registry.mjs';

const summaries = [];
const outcomes = [];
const controls = [];
const runtimeFiles = ['lib/orchestrators/user-loop.js', 'lib/generators/funnels.js'];
const runtimeHashes = () => Object.fromEntries(runtimeFiles.map(file => [file,
  createHash('sha256').update(readFileSync(new URL(`../../${file}`, import.meta.url))).digest('hex')]));
const runtimeAtStart = runtimeHashes();
afterEach(context => {
  outcomes.push({ name: context.task.name, state: context.task.result?.state,
    errors: context.task.result?.errors?.map(error => error.message) ?? [] });
});
afterAll(() => {
  const report = { seeds: SEEDS, timezone: 'UTC', users: 1500, days: 30,
    runtimeAtStart, runtimeAtEnd: runtimeHashes(),
    densityDiagnosticEnabled: process.env.ALIGNMENT_DENSITY_DIAGNOSTIC === '1',
    inference: 'Descriptive three-seed regression evidence only; Wilson intervals are user-level binomial summaries, not universal power or engine probability calibration.',
    thresholds: SCENARIOS, outcomes, summaries, controls };
  writeFileSync(new URL('./generated-results.json', import.meta.url),
    JSON.stringify(report) + '\n');
  writeCoverage();
});

describe.sequential('generated alignment proofs', () => {
  it('inventories author inputs and all hook exports without output field inflation', () => {
    const entries = buildCoverage();
    expect(entries.filter(entry => entry.id.startsWith('hook-helpers.'))).toHaveLength(23);
    expect(entries.filter(entry => entry.id.startsWith('hook-patterns.'))).toHaveLength(6);
    expect(entries.some(entry => /^(Result|HookMeta|Resolved|Context|RuntimeState|UserProfile|README|HOOKS)/.test(entry.id))).toBe(false);
    expect(entries.filter(entry => entry.id === 'Dungeon.campaignPerUser')).toHaveLength(1);
    expect(entries.find(entry => entry.id === 'Dungeon.retentionCurve').group).toBe('dungeon controls / cadence/retention');
    expect(entries.find(entry => entry.id === 'FunnelConditionOperators.nin').classification).toBe('exact');
  });
  it('checks user-level Wilson interval reference values', () => {
    expect(wilson(50, 100)[0]).toBeCloseTo(0.4038315, 6);
    expect(wilson(50, 100)[1]).toBeCloseTo(0.5961685, 6);
    expect(wilson(0, 100)[0]).toBeCloseTo(0, 12);
    expect(wilson(100, 100)[1]).toBeCloseTo(1, 12);
  });

  it('direct condition operators select the exact generated profile subset', async () => {
    const cases = [
      ['eq', 2, value => value === 2], ['neq', 2, value => value !== 2],
      ['in', [2, 3], value => [2, 3].includes(value)], ['nin', [2, 3], value => ![2, 3].includes(value)],
      ['gt', 2, value => value > 2], ['gte', 2, value => value >= 2],
      ['lt', 2, value => value < 2], ['lte', 2, value => value <= 2],
    ];
    for (const seed of SEEDS) for (const [operator, operand, predicate] of cases) {
      const config = makeFixture(seed);
      config.userProps.score = [1, 2, 3, 4];
      config.funnels[0].conditions = { score: { [operator]: operand } };
      const sample = await runFixture(config);
      const expected = new Set(sample.profiles.filter(profile => predicate(profile.score)).map(profile => profile.distinct_id));
      const actual = new Set(sample.events.filter(event => event.event === 'First Entry').map(event => event.user_id));
      controls.push({ id: 'condition-operators', seed, operator, expected: expected.size, observed: actual.size });
      expect(expected.size).toBeGreaterThan(200);
      expect(expected.size).toBeLessThan(1300);
      expect(actual).toEqual(expected);
      expect(sample.events.filter(event => event.event === 'Background Activity').length).toBeGreaterThan(100);
    }
  }, 90000);

  it('direct sticky properties and context functions correlate with generated profiles', async () => {
    for (const seed of SEEDS) {
      const config = makeFixture(seed);
      config.superProps = { segment: ['unset'], context_segment: context => context.profile.segment };
      config.switches.stickyEventProps = ['segment'];
      const sample = await runFixture(config);
      const profiles = new Map(sample.profiles.map(profile => [profile.distinct_id, profile]));
      expect(new Set(sample.profiles.map(profile => profile.segment)).size).toBe(2);
      const mismatches = sample.events.filter(event => event.segment !== profiles.get(event.user_id)?.segment ||
        event.context_segment !== profiles.get(event.user_id)?.segment);
      controls.push({ id: 'sticky-context', seed, rows: sample.events.length, mismatches: mismatches.length });
      expect(sample.events.length).toBeGreaterThan(1500);
      expect(mismatches).toEqual([]);
    }
  }, 90000);

  it('direct campaignPerUser enforces sticky eligible capped touchpoints', async () => {
    for (const seed of SEEDS) {
      const config = makeFixture(seed);
      config.switches.hasCampaigns = true;
      config.switches.campaignPerUser = true;
      config.maxTouchpointsPerUser = 2;
      config.events.find(event => event.event === 'Browse').isAttributionEvent = true;
      const sample = await runFixture(config);
      const touches = sample.events.filter(event => event.utm_source !== undefined);
      const byUser = new Map();
      for (const event of touches) {
        if (!byUser.has(event.user_id)) byUser.set(event.user_id, []);
        byUser.get(event.user_id).push(event);
      }
      controls.push({ id: 'campaign', seed, touches: touches.length, users: byUser.size,
        repeatedUsers: [...byUser.values()].filter(events => events.length > 1).length });
      expect(touches.length).toBeGreaterThan(100);
      expect([...byUser.values()].filter(events => events.length > 1).length).toBeGreaterThan(30);
      expect(touches.every(event => event.event === 'Browse')).toBe(true);
      for (const events of byUser.values()) {
        expect(events.length).toBeLessThanOrEqual(2);
        expect(new Set(events.map(event => JSON.stringify(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
          .map(key => event[key])))).size).toBe(1);
      }
    }
  }, 90000);

  it('direct world injection preserves unaffected properties and event windows', async () => {
    for (const seed of SEEDS) {
      const config = makeFixture(seed);
      config.superProps = { incident: [false], stable: [17] };
      config.worldEvents = [{ name: 'Property incident', startDay: 5, duration: 15,
        affectsEvents: ['Browse'], injectProps: { incident: true } }];
      const sample = await runFixture(config);
      const start = Date.parse(config.datasetStart) + 5 * 86400000;
      const stop = start + 15 * 86400000;
      const affected = sample.events.filter(event => event.incident);
      controls.push({ id: 'world-properties', seed, affected: affected.length, rows: sample.events.length });
      expect(affected.length).toBeGreaterThan(100);
      for (const event of sample.events) {
        expect(event.stable).toBe(17);
        expect(event.incident).toBe(event.event === 'Browse' && Date.parse(event.time) >= start && Date.parse(event.time) <= stop);
      }
    }
  }, 90000);

  it('direct event weights change event share independently of property weights', async () => {
    for (const seed of SEEDS) {
      const shares = [];
      for (const weight of [5, 20]) {
        const config = makeFixture(seed);
        config.events.find(event => event.event === 'Background Activity').weight = weight;
        const sample = await runFixture(config);
        const browse = sample.events.filter(event => event.event === 'Browse');
        const common = browse.filter(event => event.choice === 'common').length / browse.length;
        const share = sample.events.filter(event => event.event === 'Background Activity').length / sample.events.length;
        shares.push(share);
        controls.push({ id: 'event-weights', seed, weight, share, common, browse: browse.length });
        expect(browse.length).toBeGreaterThan(300);
        expect(common).toBeGreaterThan(0.74);
        expect(common).toBeLessThan(0.86);
      }
      expect(shares[1]).toBeGreaterThan(shares[0] * 1.5);
    }
  }, 90000);

  if (process.env.ALIGNMENT_DENSITY_DIAGNOSTIC === '1') {
    it('optional higher-density retention diagnostic preserves sparse acceptance cases', async () => {
      for (const seed of SEEDS) {
        const treatment = await runScenario({ id: 'retention', seed, strength: 'diagnostic' });
        const neutral = await runScenario({ id: 'retention', seed, strength: 'diagnostic', treatment: false });
        controls.push({ id: 'retention-density-diagnostic', seed, configuredRate: 5, treatment, neutral,
          lift: treatment.retention.rate - neutral.retention.rate });
        expect(treatment.standaloneCount).toBeGreaterThan(1000);
        expect(neutral.standaloneCount).toBeGreaterThan(1000);
      }
    }, 90000);
  }
  it('calibrates a first funnel while retaining organic and repeated traffic', async () => {
    for (const seed of SEEDS) {
      const sample = await runFixture(makeFixture(seed));
      const first = measureFunnel(sample.events, { entry: 'First Entry', outcome: 'First Success', windowHours: 24 * 30 });
      const repeat = measureFunnel(sample.events, { entry: 'Repeat Entry', outcome: 'Repeat Success', windowHours: 24 });
      controls.push({ id: 'baseline', seed, events: sample.events.length, first, repeat,
        standaloneCount: sample.events.filter(event => event.event === 'Background Activity').length });
      console.log(JSON.stringify({ scenario: 'baseline', seed, events: sample.events.length, first, repeat }));
      expect(first.entrants).toBeGreaterThanOrEqual(500);
      expect(first.rate).toBeGreaterThan(0.30);
      expect(first.rate).toBeLessThan(0.50);
      expect(repeat.attempts).toBeGreaterThan(repeat.entrants * 1.2);
      expect(sample.events.filter(event => event.event === 'Browse').length).toBeGreaterThan(300);
      expect(sample.events.filter(event => event.event === 'Background Activity').length).toBeGreaterThan(300);
    }
  }, 90000);

  for (const scenario of SCENARIOS) {
    it.each(['mixed', 'dense'])(`${scenario.id}: treatment and neutral at %s noise`, async strength => {
      const observations = [];
      for (const seed of SEEDS) {
        const treatment = await runScenario({ id: scenario.id, seed, strength });
        const neutral = await runScenario({ id: scenario.id, seed, strength, treatment: false });
        observations.push({ seed, treatment, neutral });
      }
      const statistic = sample => {
        if (scenario.kind === 'conversion' || scenario.kind === 'experiment') return sample.conversionDifference;
        if (scenario.kind === 'ttc') return sample.ttcRatio;
        if (scenario.kind === 'volume') return sample.volumeRatio;
        if (scenario.kind === 'weights') return sample.commonShare;
        return sample.retention.rate;
      };
      let effect = mean(observations.map(row => statistic(row.treatment)));
      let neutralEffect = mean(observations.map(row => statistic(row.neutral)));
      let unaffectedRatio;
      let worldNeutralRatios;
      if (scenario.kind === 'world') {
        effect = mean(observations.map(row => row.treatment.affected / row.neutral.affected));
        unaffectedRatio = mean(observations.map(row => row.treatment.unaffected / row.neutral.unaffected));
        const controls = [];
        for (const seed of SEEDS) {
          const config = scenarioConfig(scenario.id, seed, strength, false);
          config.worldEvents = [];
          controls.push(measureScenario(scenario.id, await runFixture(config)).affected);
        }
        worldNeutralRatios = controls.map((count, index) => observations[index].neutral.affected / count);
        neutralEffect = mean(worldNeutralRatios);
      }
      if (scenario.kind === 'retention') {
        effect = mean(observations.map(row => row.treatment.retention.rate - row.neutral.retention.rate));
        neutralEffect = mean(observations.map(row => row.neutral.neutralRetentionCohorts[0].rate - row.neutral.neutralRetentionCohorts[1].rate));
      }
      const direction = row => {
        if (scenario.kind === 'world') return row.treatment.affected / row.neutral.affected - 1;
        if (scenario.kind === 'retention') return row.treatment.retention.rate - row.neutral.retention.rate;
        if (scenario.kind === 'ttc') return statistic(row.neutral) - statistic(row.treatment);
        return statistic(row.treatment) - statistic(row.neutral);
      };
      const summary = { scenario: scenario.id, strength, effect, neutralEffect, unaffectedRatio, worldNeutralRatios,
        seedDirectionRange: range(observations.map(direction)),
        ttcSeedRanges: Object.fromEntries(['treatment', 'neutral'].map(arm => [arm,
          Object.fromEntries(['target', 'control'].map(group => [group, {
            perUserMeanHours: range(observations.map(row => row[arm][group].perUserMeanHours)),
            perUserMedianHours: range(observations.map(row => row[arm][group].perUserMedianHours)),
          }]))])),
        seeds: observations.map(row => ({ seed: row.seed,
          direction: direction(row), directionPass: direction(row) > 0,
          conversion: [row.treatment.target, row.treatment.control, row.neutral.target, row.neutral.control],
          neutralRetentionCohorts: row.neutral.neutralRetentionCohorts,
          standaloneCounts: [row.treatment.standaloneCount, row.neutral.standaloneCount],
          treatment: statistic(row.treatment), neutral: statistic(row.neutral),
          treatmentEntrants: row.treatment.target.entrants, controlEntrants: row.treatment.control.entrants,
          treatmentConverted: row.treatment.target.converted, controlConverted: row.treatment.control.converted,
          ttcRatio: row.treatment.ttcRatio, neutralTtcRatio: row.neutral.ttcRatio,
          affected: [row.treatment.affected, row.neutral.affected], unaffected: [row.treatment.unaffected, row.neutral.unaffected],
          retention: [row.treatment.retention, row.neutral.retention],
          repeat: [row.treatment.repeat, row.treatment.repeatTotals],
          events: [row.treatment.events, row.neutral.events] })) };
      summaries.push(summary);
      console.log(JSON.stringify({ scenario: scenario.id, strength, effect, neutralEffect }));
      for (const row of observations) {
        expect(direction(row), `${row.seed}: treatment must beat the neutral config`).toBeGreaterThan(0);
        if (['conversion', 'experiment'].includes(scenario.kind)) expect(row.treatment.conversionDifference).toBeGreaterThan(0);
        if (['ttc', 'experiment'].includes(scenario.kind)) expect(row.treatment.ttcRatio).toBeLessThan(1);
        if (scenario.kind === 'volume') expect(row.treatment.volumeRatio).toBeGreaterThan(1);
        if (scenario.kind === 'retention') {
          for (const cohort of row.neutral.neutralRetentionCohorts) expect(cohort.entrants).toBeGreaterThanOrEqual(100);
          const neutralDifference = row.neutral.neutralRetentionCohorts[0].rate - row.neutral.neutralRetentionCohorts[1].rate;
          expect(neutralDifference).toBeGreaterThanOrEqual(scenario.neutral[0]);
          expect(neutralDifference).toBeLessThanOrEqual(scenario.neutral[1]);
        } else if (scenario.kind !== 'world') {
          expect(statistic(row.neutral)).toBeGreaterThanOrEqual(scenario.neutral[0]);
          expect(statistic(row.neutral)).toBeLessThanOrEqual(scenario.neutral[1]);
        }
        for (const sample of [row.treatment, row.neutral]) {
          expect(sample.events).toBeGreaterThan(1500);
          expect(sample.standaloneCount).toBeGreaterThanOrEqual(100);
          expect(sample.repeatTotals.entrants).toBeGreaterThan(80);
          expect(sample.repeat.entrants).toBeGreaterThan(80);
          if (scenario.kind === 'weights') expect(sample.weightedCount).toBeGreaterThanOrEqual(scenario.minimum);
          else if (scenario.kind === 'world') {
            expect(sample.affected).toBeGreaterThanOrEqual(scenario.minimum);
            expect(sample.unaffected).toBeGreaterThanOrEqual(scenario.minimum);
          } else if (scenario.kind === 'retention') expect(sample.retention.entrants).toBeGreaterThanOrEqual(scenario.minimum);
          else for (const group of [sample.target, sample.control]) {
            expect(scenario.kind === 'ttc' ? group.converted : group.entrants).toBeGreaterThanOrEqual(scenario.minimum);
            expect(group.rate).toBeLessThan(0.9);
          }
        }
      }
      expect(effect).toBeGreaterThanOrEqual(scenario.effect[0]);
      expect(effect).toBeLessThanOrEqual(scenario.effect[1]);
      expect(neutralEffect).toBeGreaterThanOrEqual(scenario.neutral[0]);
      expect(neutralEffect).toBeLessThanOrEqual(scenario.neutral[1]);
      if (scenario.kind === 'world') {
        for (const ratio of [...worldNeutralRatios, ...observations.map(row => row.treatment.unaffected / row.neutral.unaffected)]) {
          expect(ratio).toBeGreaterThanOrEqual(scenario.neutral[0]);
          expect(ratio).toBeLessThanOrEqual(scenario.neutral[1]);
        }
        expect(unaffectedRatio).toBeGreaterThanOrEqual(scenario.neutral[0]);
        expect(unaffectedRatio).toBeLessThanOrEqual(scenario.neutral[1]);
      }
      if (scenario.kind === 'experiment') {
        for (const row of observations) expect(row.treatment.ttcRatio).toBeLessThan(row.neutral.ttcRatio);
        for (const row of observations) for (const sample of [row.treatment, row.neutral]) {
          expect(sample.target.converted).toBeGreaterThanOrEqual(70);
          expect(sample.control.converted).toBeGreaterThanOrEqual(70);
        }
        const ttc = mean(observations.map(row => row.treatment.ttcRatio));
        const neutralTtc = mean(observations.map(row => row.neutral.ttcRatio));
        expect(ttc).toBeGreaterThanOrEqual(scenario.ttcEffect[0]);
        expect(ttc).toBeLessThanOrEqual(scenario.ttcEffect[1]);
        expect(neutralTtc).toBeGreaterThanOrEqual(scenario.ttcNeutral[0]);
        expect(neutralTtc).toBeLessThanOrEqual(scenario.ttcNeutral[1]);
      }
    }, 90000);
  }
});