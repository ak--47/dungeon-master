//@ts-nocheck
/**
 * The engine guarantees every generated event carries a unique `insert_id`.
 *
 * This is enforced in the user loop rather than only in the clone helpers,
 * because hooks are documented to inject events by spreading an existing one —
 * and a spread copies `insert_id` along with everything else. Mixpanel dedupes
 * on `insert_id` at ingest, so duplicated ids mean the events are accepted,
 * reported as successful, and then silently dropped. Local verification never
 * looks at `insert_id`, so nothing else in the pipeline can catch it.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

/**
 * Assert every event in a generated dataset has a distinct, non-empty insert_id.
 *
 * @param {Array<{insert_id?: string}>} events
 * @param {string} label
 */
function expectUniqueInsertIds(events, label) {
	const ids = events.map(e => e.insert_id);
	const missing = ids.filter(x => !x);
	expect(missing.length, `${label}: ${missing.length} events have no insert_id`).toBe(0);
	const distinct = new Set(ids);
	expect(distinct.size, `${label}: ${ids.length - distinct.size} duplicate insert_ids`).toBe(ids.length);
}

describe('insert_id uniqueness', () => {
	test('a hook that hand-rolls clones via spread still yields unique ids', async () => {
		// Deliberately does the thing hook authors naturally do — and that the
		// docs used to recommend — bypassing the clone helpers entirely.
		const result = await DUNGEON_MASTER({
			seed: 'insert-id-uniqueness',
			numUsers: 30,
			numDays: 30,
			numEvents: 2000,
			format: 'json',
			writeToDisk: false,
			verbose: false,
			concurrency: 1,
			events: [
				{ event: 'view', weight: 5, properties: { plan: ['free', 'pro'] } },
				{ event: 'purchase', weight: 2, properties: { amount: [10, 20, 30] } },
			],
			hook: function (record, type) {
				if (type !== 'everything' || !Array.isArray(record)) return record;
				const purchases = record.filter(e => e.event === 'purchase');
				// Raw spread — inherits insert_id from the source event.
				const clones = purchases.map(p => ({ ...p, amount: p.amount * 2 }));
				record.push(...clones);
				return record;
			},
		});

		const events = result.eventData || [];
		expect(events.length).toBeGreaterThan(0);
		expectUniqueInsertIds(events, 'hand-rolled clones');
	});

	test('a hook that clones the SAME event many times still yields unique ids', async () => {
		const result = await DUNGEON_MASTER({
			seed: 'insert-id-burst',
			numUsers: 20,
			numDays: 20,
			numEvents: 800,
			format: 'json',
			writeToDisk: false,
			verbose: false,
			concurrency: 1,
			events: [{ event: 'ping', weight: 5, properties: { ok: [true] } }],
			hook: function (record, type) {
				if (type !== 'everything' || !Array.isArray(record)) return record;
				const first = record[0];
				if (!first) return record;
				// Ten identical copies of one event — the worst case for both
				// id inheritance and the importer's content-hash fallback.
				for (let i = 0; i < 10; i++) record.push({ ...first });
				return record;
			},
		});

		const events = result.eventData || [];
		expectUniqueInsertIds(events, 'repeated clones of one event');
	});

	test('no-hook generation has unique ids', async () => {
		const result = await DUNGEON_MASTER({
			seed: 'insert-id-nohook',
			numUsers: 25,
			numDays: 20,
			numEvents: 1000,
			format: 'json',
			writeToDisk: false,
			verbose: false,
			concurrency: 1,
			events: [
				{ event: 'view', weight: 5, properties: {} },
				{ event: 'click', weight: 3, properties: {} },
			],
		});
		expectUniqueInsertIds(result.eventData || [], 'no hook');
	});
});
