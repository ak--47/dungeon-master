//@ts-nocheck
/**
 * Import-phase progress reaches onProgress consumers.
 *
 * mixpanel-import >= 3.3.2 fires `progressCallback` independently of
 * verbose/showProgress (confirmed network-free via dryRun). This test mocks
 * mixpanel-import so the import path runs fully offline, and asserts that DM's
 * makeProgressCallback wiring (mixpanel-sender.js) forwards each import callback
 * to `onProgress` as a `{ phase:'import', recordType, processed, total }` update —
 * with verbose:false (no stdout bar).
 */
import { describe, test, expect, vi } from 'vitest';

// The mock mirrors mixpanel-import's callback contract:
//   progressCallback(recordType, processed, requests, eps, bytesProcessed)
vi.mock('mixpanel-import', () => ({
	default: vi.fn(async (creds, data, opts) => {
		const n = Array.isArray(data) ? data.length : 0;
		if (typeof opts?.progressCallback === 'function') {
			opts.progressCallback(opts.recordType, n, 1, '1000', n * 80);
		}
		return { success: n, failed: 0, total: n, requests: 1, duration: 1, recordType: opts?.recordType };
	}),
}));

import generate from '../../index.js';

const timeout = 30_000;

describe('import progress → onProgress', () => {
	test('emits phase:import updates for event and user (verbose:false)', async () => {
		const updates = [];
		await generate({
			seed: 'import-progress',
			numUsers: 30,
			numEvents: 300,
			numDays: 30,
			datasetStart: '2024-01-01T00:00:00Z',
			datasetEnd: '2024-01-31T00:00:00Z',
			format: 'json',
			writeToDisk: false,
			verbose: false,
			token: 'a'.repeat(32), // 32-hex → index.js runs the (mocked) import
			progressInterval: 0, // don't throttle the back-to-back import updates
			onProgress: (u) => updates.push(structuredClone(u)),
			events: [
				{ event: 'page_view', weight: 5 },
				{ event: 'click', weight: 3 },
				{ event: 'purchase', weight: 1 },
			],
			funnels: [{ sequence: ['page_view', 'click', 'purchase'], conversionRate: 60, isFirstFunnel: true }],
			userProps: { plan: ['free', 'pro'] },
		});

		const importUpdates = updates.filter((u) => u.phase === 'import');
		expect(importUpdates.length).toBeGreaterThan(0);

		const eventUpdate = importUpdates.find((u) => u.recordType === 'event');
		const userUpdate = importUpdates.find((u) => u.recordType === 'user');

		expect(eventUpdate).toMatchObject({
			phase: 'import',
			recordType: 'event',
			processed: expect.any(Number),
			total: expect.any(Number),
		});
		expect(userUpdate).toMatchObject({
			phase: 'import',
			recordType: 'user',
			processed: expect.any(Number),
			total: expect.any(Number),
		});
	}, timeout);
});
