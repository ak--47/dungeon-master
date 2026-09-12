import DUNGEON_MASTER from '../../index.js';

export const SEEDS = ['alignment-generated-17', 'alignment-generated-43', 'alignment-generated-89'];
export const WINDOW = { datasetStart: '2025-01-01T00:00:00Z', datasetEnd: '2025-01-31T00:00:00Z' };
export const NOISE = { mixed: 0.5, dense: 0.9 };

export function makeFixture(seed, strength = 'mixed') {
  return {
    name: 'alignment-generated', seed, ...WINDOW, numDays: 30, numUsers: 1500,
    avgEventsPerUserPerDay: NOISE[strength], numEvents: 1500 * 30 * NOISE[strength], concurrency: 1,
    credentials: { token: '', serviceAccount: '', serviceSecret: '', projectId: '' },
    writeToDisk: false, verbose: false, autoPowerLaw: false,
    percentUsersBornInDataset: 100, bornRecentBias: 0,
    macro: {},
    switches: { hasLocation: false, hasBrowser: false, hasSessionIds: true,
      hasCampaigns: false, hasAdSpend: false, alsoInferFunnels: false },
    events: [
      { event: 'First Entry', isFirstEvent: true },
      { event: 'First Success' },
      { event: 'Repeat Entry' },
      { event: 'Repeat Success' },
      { event: 'Browse', weight: 10, properties: { choice: { __weights: { common: 80, rare: 20 } }, amount: [10] } },
      { event: 'Search', weight: 7 },
      { event: 'Help', weight: 3 },
    ],
    funnels: [
      { name: 'First', sequence: ['First Entry', 'First Success'], isFirstFunnel: true,
        conversionRate: 40, timeToConvert: 1, weight: 1 },
      { name: 'Repeat', sequence: ['Repeat Entry', 'Repeat Success'], conversionRate: 35,
        timeToConvert: 0.2, weight: 3 },
      { name: 'Organic', sequence: ['Browse', 'Search', 'Help'], conversionRate: 70,
        timeToConvert: 0.1, weight: 5 },
    ],
    userProps: { segment: { __weights: { target: 50, control: 50 } } },
    superProps: {},
  };
}

export async function runFixture(config) {
  process.env.TZ = 'UTC';
  const result = await DUNGEON_MASTER(config);
  return { events: result.eventData, profiles: result.userProfilesData, warnings: result.warnings };
}