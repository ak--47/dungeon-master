import { describe, expect, test } from 'vitest';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { createContext } from '../../lib/core/context.js';
import { makeFunnel } from '../../lib/generators/funnels.js';
import { initChance } from '../../lib/utils/utils.js';

describe.sequential('funnel timestamp precision at dataset end', () => {
	test('marks sub-second future steps dropped without clamping their time', async () => {
		initChance('fractional-funnel-end');
		const config = validateDungeonConfig({
			seed: 'fractional-funnel-end',
			numUsers: 1,
			numEvents: 2,
			datasetStart: '2025-01-01T00:00:00Z',
			datasetEnd: '2025-01-31T00:00:00Z',
			events: [{ event: 'Entry' }, { event: 'Success' }],
			funnels: [{ sequence: ['Entry', 'Success'], conversionRate: 100, timeToConvert: 0.0001 }],
		});
		const context = createContext(config);
		const endpoint = Number(config.datasetEnd);
		const [events] = await makeFunnel(context, config.funnels[0], {
			distinct_id: 'boundary-user',
			created: '2025-01-01T00:00:00Z',
		}, endpoint, {}, {}, null, { latestTime: endpoint });
		expect(events).toHaveLength(2);
		const offset = Date.parse(events[1].time) - endpoint * 1000;
		expect(offset).toBeGreaterThan(0);
		expect(offset).toBeLessThan(1000);
		expect(events[1]._drop).toBe(true);
		expect(events[0]._drop).not.toBe(true);
	});
});