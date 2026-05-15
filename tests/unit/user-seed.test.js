// @ts-nocheck
/**
 * userSeed split-RNG tests (v1.5.1)
 *
 * Locks the contract that `Dungeon.userSeed`:
 *   - When set, generates the SAME pool of distinct_ids regardless of `seed`.
 *   - Different `seed` (same userSeed) → different events.
 *   - Different `userSeed` → different distinct_ids.
 *   - When unset, behavior is byte-identical to pre-v1.5.1 (controlled by `seed`).
 *
 * IMPORTANT: vitest config sets `sequence.concurrent: true` (parallel within
 * file), so multiple `it()` blocks would race on the shared in-process
 * `globalUserChance` state. We bundle every assertion into one serial test.
 */

import { describe, it, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const baseConfig = {
	token: '',
	numUsers: 8,
	numEvents: 800,
	format: 'json',
	writeToDisk: false,
	hasAnonIds: false,
	hasSessionIds: false,
	hasLocation: false,
	hasBrowser: false,
	hasCampaigns: false,
	concurrency: 1,
	events: [{ event: 'test_event', weight: 1, isStrictEvent: false, properties: { x: ['a', 'b', 'c'] } }],
	funnels: [],
	superProps: {},
	userProps: { spirit: ['fox', 'wolf', 'otter'] },
	scdProps: {},
	mirrorProps: {},
	groupKeys: [],
	groupProps: {},
	lookupTables: [],
	hook: () => undefined,
	datasetStart: '2025-01-01',
	datasetEnd: '2025-12-31',
};

const ids = (result) => (result.userProfilesData || []).map((u) => u.distinct_id);
const eventTimes = (result) => (result.eventData || []).map((e) => e.time).slice(0, 5);

describe('userSeed split-RNG (single sequential test — vitest runs `it` blocks concurrently)', () => {
	it('all engine + userSeed contracts (one block to avoid vitest parallel state interleaving)', async () => {
		// 1. Same userSeed + different seed → SAME distinct_ids, DIFFERENT events.
		const r1 = await DUNGEON_MASTER({ ...baseConfig, userSeed: 'pool-A', seed: 'events-X' });
		const r2 = await DUNGEON_MASTER({ ...baseConfig, userSeed: 'pool-A', seed: 'events-Y' });
		expect(ids(r1)).toEqual(ids(r2));            // exact pool match
		expect(eventTimes(r1)).not.toEqual(eventTimes(r2));

		// 2. Different userSeed → DIFFERENT distinct_ids.
		const r3 = await DUNGEON_MASTER({ ...baseConfig, userSeed: 'pool-B', seed: 'events-X' });
		expect(ids(r1)).not.toEqual(ids(r3));

		// 3. userSeed unset → distinct_ids controlled by seed (backwards compat).
		const r4 = await DUNGEON_MASTER({ ...baseConfig, seed: 'legacy-X' });
		const r5 = await DUNGEON_MASTER({ ...baseConfig, seed: 'legacy-X' });
		const r6 = await DUNGEON_MASTER({ ...baseConfig, seed: 'legacy-Y' });
		expect(ids(r4)).toEqual(ids(r5));            // same seed → same pool
		expect(ids(r4)).not.toEqual(ids(r6));        // different seed → different pool

		// 4. REGRESSION: large numUsers does not blow V8's ~65K Promise.all ceiling.
		// Engine batches userPromises in groups of 50K (user-loop.js). 60K verifies the
		// boundary. Triggered the kodiak Cloud Run failure on 2026-05-15.
		const big = await DUNGEON_MASTER({ ...baseConfig, numUsers: 60_000, numEvents: 100_000 });
		expect(big.userProfilesData?.length).toBeGreaterThan(0);
	}, 60_000);
});
