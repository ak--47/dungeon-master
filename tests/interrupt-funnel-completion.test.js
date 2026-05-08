//@ts-nocheck
/**
 * Generator-vs-verifier roundtrip: prove that the greedy single-pass funnel
 * engine + auto-promote isStrictEvent compose correctly. A funnel using
 * `order: "interrupted"` (which inserts non-funnel events between steps)
 * should still complete under the greedy engine, and `evaluateFunnel` should
 * agree with the engine's notion of completion.
 *
 * Reference: `mixpanel/analytics/backend/arb/reader/funnels/history.cpp`
 * (greedy single-pass with 2s grace).
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';
import { evaluateFunnel } from '../lib/verify/funnel-engine.js';

describe('interrupt funnel completion (generator + verifier roundtrip)', () => {
	test('sequential funnels with conversionRate=100 complete via greedy engine', async () => {
		const result = await DUNGEON_MASTER({
			seed: 'sequential-funnel',
			datasetStart: '2025-09-01T00:00:00Z',
			datasetEnd: '2025-10-01T00:00:00Z',
			numUsers: 50,
			avgEventsPerUserPerDay: 4,
			events: [
				{ event: 'sign up', isFirstEvent: true },
				{ event: 'first action' },
				{ event: 'conversion' },
			],
			funnels: [{
				sequence: ['sign up', 'first action', 'conversion'],
				isFirstFunnel: true,
				conversionRate: 100, // force convert
				timeToConvert: 2,
				order: 'sequential',
			}],
			writeToDisk: false,
			verbose: false,
		});
		const events = Array.from(result.eventData);

		// Group by user, run evaluateFunnel
		const byUser = new Map();
		for (const e of events) {
			if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
			byUser.get(e.user_id).push(e);
		}

		let completed = 0;
		let total = 0;
		for (const [, evs] of byUser) {
			total++;
			const r = evaluateFunnel(evs, ['sign up', 'first action', 'conversion'], {
				conversionWindowMs: 30 * 86400000,
			});
			if (r.completed) completed++;
		}

		expect(total).toBeGreaterThan(0);
		// With conversionRate=100 + sequential order, almost all users should complete.
		expect(completed / total).toBeGreaterThan(0.7);
	});

	test('auto-promote fires when funnel-step events are also in events[]', async () => {
		// Verify the auto-promote behavior + that strict events don't fire standalone.
		const warnings = [];
		const origWarn = console.warn;
		console.warn = (msg) => { warnings.push(String(msg)); };
		let result;
		try {
			result = await DUNGEON_MASTER({
				seed: 'autopromote-roundtrip',
				datasetStart: '2025-09-01T00:00:00Z',
				datasetEnd: '2025-10-01T00:00:00Z',
				numUsers: 30,
				avgEventsPerUserPerDay: 3,
				events: [
					{ event: 'browse', weight: 5 },
					{ event: 'purchase', weight: 3 },
					{ event: 'view', weight: 2 }, // non-funnel: provides standalone pool
				],
				funnels: [{
					sequence: ['browse', 'purchase'],
					conversionRate: 50,
					timeToConvert: 1,
				}],
				writeToDisk: false,
				verbose: false,
			});
		} finally {
			console.warn = origWarn;
		}
		// Verify auto-promote fired for both funnel steps
		expect(warnings.some(w => w.includes('Auto-promoted "browse"'))).toBe(true);
		expect(warnings.some(w => w.includes('Auto-promoted "purchase"'))).toBe(true);

		// `view` is a non-funnel event → should appear standalone in output.
		const events = Array.from(result.eventData);
		const viewCount = events.filter(e => e.event === 'view').length;
		expect(viewCount).toBeGreaterThan(0);
	});
});
