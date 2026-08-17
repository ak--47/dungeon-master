//@ts-nocheck
/**
 * Every helper that produces a cloned event must give the clone its OWN
 * `insert_id`.
 *
 * This is a data-loss guard, not a style rule. A clone that inherits its
 * template's id — or carries none, since mixpanel-import runs `fixData: true`
 * and content-hashes a missing id — is deduplicated by Mixpanel on ingest. The
 * events are generated, they are sent, the importer reports zero failures, and
 * they are simply not in the project. An engineered 4x burst measured 1.17x that
 * way while local story verification still passed, because story verification
 * never looks at `insert_id`.
 *
 * The bug originally hid in three of the six clone sites, so this test sweeps
 * ALL of them rather than the one that happened to break.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { cloneEvent, scaleEventCount } from '../../lib/hook-helpers/mutate.js';
import { injectAfterEvent, injectBetween, injectBurst, injectOnNewDays } from '../../lib/hook-helpers/inject.js';
import { applyLifecycleWave, applyPathBias } from '../../lib/hook-helpers/shape.js';
import { initChance } from '../../lib/utils/utils.js';

const DAY = 86400000;
const T0 = Date.parse('2024-01-01T00:00:00Z');
const iso = ms => new Date(ms).toISOString();

const mk = (event, dayOffset, extra = {}) => ({
	event,
	time: iso(T0 + dayOffset * DAY + 12 * 3600_000),
	user_id: 'u1',
	insert_id: `seed-${event}-${dayOffset}`,
	...extra,
});

/**
 * Assert that every event carries a distinct, non-empty insert_id.
 *
 * @param {Array<{insert_id?: string}>} events
 * @param {string} label
 */
function expectUniqueIds(events, label) {
	const ids = events.map(e => e.insert_id);
	expect(ids.every(Boolean), `${label}: every clone needs an insert_id`).toBe(true);
	expect(new Set(ids).size, `${label}: insert_ids must be distinct`).toBe(ids.length);
}

describe('clone helpers stamp fresh insert_ids', () => {
	beforeEach(() => initChance('clone-insert-id'));

	test('cloneEvent: clone differs from template and from sibling clones', () => {
		const tpl = mk('purchase', 0);
		const a = cloneEvent(tpl, { time: iso(T0 + DAY) });
		const b = cloneEvent(tpl, { time: iso(T0 + 2 * DAY) });
		expect(a.insert_id).not.toBe(tpl.insert_id);
		expect(b.insert_id).not.toBe(tpl.insert_id);
		expect(a.insert_id).not.toBe(b.insert_id);
		expect(tpl.insert_id).toBe('seed-purchase-0'); // template untouched
	});

	test('cloneEvent: an explicit insert_id override still wins', () => {
		expect(cloneEvent(mk('purchase', 0), { insert_id: 'pinned' }).insert_id).toBe('pinned');
	});

	test('scaleEventCount: every clone is uniquely identified', () => {
		const events = [mk('purchase', 0), mk('purchase', 1)];
		scaleEventCount(events, 'purchase', 3);
		expect(events.length).toBe(6);
		expectUniqueIds(events, 'scaleEventCount');
	});

	test('injectAfterEvent / injectBetween / injectBurst: clones get their own ids', () => {
		const src = mk('login', 0);
		const tpl = mk('purchase', 0);

		const events = [src, mk('logout', 1)];
		injectAfterEvent(events, src, tpl, 60_000);
		injectBetween(events, 'login', 'logout', tpl);
		injectBurst(events, tpl, 4, T0 + 3 * DAY, 3600_000);

		const clones = events.filter(e => e.event === 'purchase');
		expect(clones.length).toBe(6); // 1 after + 1 between + 4 burst
		for (const c of clones) expect(c.insert_id).not.toBe(tpl.insert_id);
		expectUniqueIds(clones, 'inject*');
	});

	test('injectOnNewDays: clones get their own ids', () => {
		const events = [mk('purchase', 0), mk('browse', 5)];
		injectOnNewDays(events, 'purchase', 4);
		const clones = events.filter(e => e.event === 'purchase');
		expect(clones.length).toBeGreaterThan(1);
		expectUniqueIds(clones, 'injectOnNewDays');
	});

	test('applyLifecycleWave: resurrection burst clones get their own ids', () => {
		const stream = [0, 3, 6, 13, 20].map(d => mk('purchase', d)).concat([5, 16].map(d => mk('browse', d)));
		const out = applyLifecycleWave(stream, 'u1', {
			dormantFromDay: 5,
			dormantDays: 7,
			resurrectBurst: 3,
			valueMomentEvent: 'purchase',
		});
		expectUniqueIds(out.filter(e => e.event === 'purchase'), 'applyLifecycleWave');
	});

	test('applyPathBias: injected path steps get their own ids', () => {
		const events = [
			mk('view_item', 0),
			mk('add_to_cart', 1, { cart: 1 }),
			mk('checkout', 3, { co: 1 }),
		];
		applyPathBias(events, 'u1', { anchor: 'view_item', path: ['add_to_cart', 'checkout'], share: 1 });
		expect(events.length).toBe(5);
		expectUniqueIds(events, 'applyPathBias');
	});
});
