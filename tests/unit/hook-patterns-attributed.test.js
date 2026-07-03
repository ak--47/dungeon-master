//@ts-nocheck
/**
 * P2.4 applyAttributedBySource rewrite (recipe 4.26 as code): overwrite
 * engine-stamped touches, never stamp fresh. Fixtures hand-built; the
 * single-key weights cases are fully deterministic (chance.weighted over one
 * value), so expected outcomes are derived from the contract by hand.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { applyAttributedBySource } from '../../lib/hook-patterns/index.js';
import { initChance } from '../../lib/utils/utils.js';

const T0 = Date.parse('2024-01-01T00:00:00Z');
const H = 3600_000;
const mk = (event, ms, extra = {}) => ({ event, time: new Date(ms).toISOString(), ...extra });

// 3 engine-stamped touches (utm_source) — deliberately OUT of array order so
// time-sorting is exercised — plus 3 unstamped events.
const mkStream = () => [
	mk('page_view', T0 + 5 * H, { utm_source: 'organic', id: 'mid' }),
	mk('page_view', T0 + 1 * H, { utm_source: 'organic', id: 'first' }),
	mk('purchase', T0 + 6 * H),
	mk('page_view', T0 + 9 * H, { utm_source: 'organic', id: 'last' }),
	mk('page_view', T0 + 2 * H),
	mk('page_view', T0 + 8 * H),
];

beforeEach(() => initChance('attrib-tests'));

describe('applyAttributedBySource (overwrite engine-stamped touches)', () => {
	test('firstTouch: overwrites the EARLIEST stamped touch only', () => {
		const events = mkStream();
		const r = applyAttributedBySource(events, null, { weights: { google: 1 } });
		expect(r).toEqual({ overwritten: 1, touches: 3 });
		const byId = id => events.find(e => e.id === id);
		expect(byId('first').utm_source).toBe('google'); // earliest in TIME, not array order
		expect(byId('mid').utm_source).toBe('organic');
		expect(byId('last').utm_source).toBe('organic');
	});

	test('lastTouch: overwrites the LATEST stamped touch only', () => {
		const events = mkStream();
		const r = applyAttributedBySource(events, null, { weights: { google: 1 }, model: 'lastTouch' });
		expect(r.overwritten).toBe(1);
		const byId = id => events.find(e => e.id === id);
		expect(byId('last').utm_source).toBe('google');
		expect(byId('first').utm_source).toBe('organic');
	});

	test('both: overwrites first AND last; middle untouched', () => {
		const events = mkStream();
		const r = applyAttributedBySource(events, null, { weights: { google: 1 }, model: 'both' });
		expect(r.overwritten).toBe(2);
		const byId = id => events.find(e => e.id === id);
		expect(byId('first').utm_source).toBe('google');
		expect(byId('last').utm_source).toBe('google');
		expect(byId('mid').utm_source).toBe('organic');
	});

	test('never stamps fresh: unstamped events stay unstamped, count unchanged', () => {
		const events = mkStream();
		applyAttributedBySource(events, null, { weights: { google: 1 }, model: 'both' });
		const stampedCount = events.filter(e => e.utm_source !== undefined).length;
		expect(stampedCount).toBe(3); // engine stamped 3, hook added zero
	});

	test('no stamped touches → no-op, nothing gains the property', () => {
		const events = [mk('page_view', T0), mk('purchase', T0 + H)];
		const r = applyAttributedBySource(events, null, { weights: { google: 1 } });
		expect(r).toEqual({ overwritten: 0, touches: 0 });
		for (const e of events) expect('utm_source' in e).toBe(false);
	});

	test('custom property + weighted pick lands in the weight key set, seeded-deterministic', () => {
		const weights = { google: 10, facebook: 5, twitter: 1 };
		const run = () => {
			initChance('attrib-tests');
			const events = mkStream().map(e => ({ ...e, utm_medium: e.utm_source ? 'cpc' : undefined }));
			applyAttributedBySource(events, null, { weights, property: 'utm_medium' });
			return events.filter(e => e.utm_medium !== undefined).sort((a, b) => Date.parse(a.time) - Date.parse(b.time))[0].utm_medium;
		};
		const v1 = run();
		expect(Object.keys(weights)).toContain(v1);
		expect(run()).toBe(v1); // same seed → same pick
	});

	test('invalid inputs → no-op result', () => {
		expect(applyAttributedBySource([], null, { weights: { google: 1 } })).toEqual({ overwritten: 0, touches: 0 });
		expect(applyAttributedBySource(mkStream(), null, {})).toEqual({ overwritten: 0, touches: 0 });
		expect(applyAttributedBySource(mkStream(), null, { weights: { google: 0 } })).toEqual({ overwritten: 0, touches: 0 });
	});
});
