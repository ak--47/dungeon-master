import { writeFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { makeFixture, runFixture, SEEDS } from './fixtures.mjs';
import { measureFunnel, mean } from './measures.mjs';
import { runScenario, SCENARIOS, scenarioConfig, measureScenario } from './scenarios.mjs';
import { writeCoverage } from './coverage-registry.mjs';

const summaries = [];
const outcomes = [];
afterEach(context => {
  outcomes.push({ name: context.task.name, state: context.task.result?.state,
    errors: context.task.result?.errors?.map(error => error.message) ?? [] });
});
afterAll(() => {
  const report = { seeds: SEEDS, timezone: 'UTC', users: 1500, days: 30,
    thresholds: SCENARIOS, outcomes, summaries };
  writeFileSync(new URL('./generated-results.json', import.meta.url),
    JSON.stringify(report) + '\n');
  writeCoverage();
});

describe.sequential('generated alignment proofs', () => {
  it('calibrates a first funnel while retaining organic and repeated traffic', async () => {
    for (const seed of SEEDS) {
      const sample = await runFixture(makeFixture(seed));
      const first = measureFunnel(sample.events, { entry: 'First Entry', outcome: 'First Success', windowHours: 24 * 30 });
      const repeat = measureFunnel(sample.events, { entry: 'Repeat Entry', outcome: 'Repeat Success', windowHours: 24 });
      console.log(JSON.stringify({ scenario: 'baseline', seed, events: sample.events.length, first, repeat }));
      expect(first.entrants).toBeGreaterThanOrEqual(500);
      expect(first.rate).toBeGreaterThan(0.30);
      expect(first.rate).toBeLessThan(0.50);
      expect(repeat.attempts).toBeGreaterThan(repeat.entrants * 1.2);
      expect(sample.events.filter(event => event.event === 'Browse').length).toBeGreaterThan(300);
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
      if (scenario.kind === 'world') {
        effect = mean(observations.map(row => row.treatment.affected / row.neutral.affected));
        unaffectedRatio = mean(observations.map(row => row.treatment.unaffected / row.neutral.unaffected));
        const controls = [];
        for (const seed of SEEDS) {
          const config = scenarioConfig(scenario.id, seed, strength, false);
          config.worldEvents = [];
          controls.push(measureScenario(scenario.id, await runFixture(config)).affected);
        }
        neutralEffect = mean(controls.map((count, index) => observations[index].neutral.affected / count));
      }
      if (scenario.kind === 'retention') {
        effect = mean(observations.map(row => row.treatment.retention.rate - row.neutral.retention.rate));
        const controls = [];
        for (const seed of SEEDS) {
          const config = scenarioConfig(scenario.id, seed, strength, false);
          config.retentionCurve = { ...config.retentionCurve };
          const control = measureScenario(scenario.id, await runFixture(config));
          controls.push(control.retention.rate);
        }
        neutralEffect = mean(controls.map((rate, index) => rate - observations[index].neutral.retention.rate));
      }
      const summary = { scenario: scenario.id, strength, effect, neutralEffect, unaffectedRatio,
        seeds: observations.map(row => ({ seed: row.seed,
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
        for (const sample of [row.treatment, row.neutral]) {
          expect(sample.events).toBeGreaterThan(1500);
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
        expect(unaffectedRatio).toBeGreaterThanOrEqual(scenario.neutral[0]);
        expect(unaffectedRatio).toBeLessThanOrEqual(scenario.neutral[1]);
      }
      if (scenario.kind === 'experiment') {
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