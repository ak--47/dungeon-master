//@ts-nocheck
import { describe, test, expect } from 'vitest';
import { verifyDungeon } from '../../lib/verify/index.js';
import dayjs from 'dayjs';

const FIXED_NOW = dayjs('2024-02-02').unix();

describe('verifyDungeon', () => {
	test('runs a dungeon and applies emulator checks', async () => {
		const report = await verifyDungeon({
			datasetStart: FIXED_NOW - 30 * 86400,
			datasetEnd: FIXED_NOW,
			numUsers: 50,
			avgEventsPerUserPerDay: 3,
			writeToDisk: false,
			verbose: false,
			seed: 'verify-test',
			events: [
				{ event: 'Browse', weight: 5 },
				{ event: 'Purchase', weight: 2 },
			],
		}, [{
			name: 'browse and purchase exist',
			breakdown: {
				type: 'frequencyByFrequency',
				metricEvent: 'Purchase',
				breakdownByFrequencyOf: 'Browse',
			},
			assert: (rows) => ({
				pass: rows.length > 0,
				detail: `${rows.length} rows`,
			}),
		}]);
		expect(report.pass).toBe(true);
		expect(report.results).toHaveLength(1);
		expect(report.results[0].name).toBe('browse and purchase exist');
	}, 30000);
});
