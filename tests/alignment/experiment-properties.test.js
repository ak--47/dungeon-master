import { describe, expect, it } from 'vitest';
import generate from '../../index.js';

describe.sequential('experiment exposure report filters', () => {
  it('carries declared global properties on synthetic exposure markers', async () => {
    const result = await generate({
      name: 'exposure-properties', seed: 'exposure-properties', numUsers: 20, numEvents: 300,
      numDays: 30, datasetStart: '2026-08-01', datasetEnd: '2026-08-31', concurrency: 1,
      credentials: { token: '' }, writeToDisk: false, verbose: false, macro: {},
      percentUsersBornInDataset: 100,
      superProps: { alignment_run_id: ['run-a'], channel: ['test'], context_user: context => context.profile.distinct_id },
      events: [{ event: 'Entry', isFirstEvent: true }, { event: 'Success' }, { event: 'Browse', weight: 2 }],
      funnels: [{ sequence: ['Entry', 'Success'], isFirstFunnel: true, conversionRate: 100,
        timeToConvert: 0.1, experiment: { name: 'Trial', variants: [{ name: 'Control' }, { name: 'Treatment' }] } }],
    });
    const markers = result.eventData.filter(event => event.event === '$experiment_started');
    expect(markers).toHaveLength(20);
    for (const marker of markers) {
      expect(marker.alignment_run_id).toBe('run-a');
      expect(marker.channel).toBe('test');
      expect(marker.context_user).toBe(marker.user_id);
      expect(marker['Experiment name']).toBe('Trial');
      expect(['Control', 'Treatment']).toContain(marker['Variant name']);
      expect(marker.insert_id).toBeTruthy();
    }
  });
});