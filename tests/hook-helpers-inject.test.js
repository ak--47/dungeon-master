//@ts-nocheck
import { describe, test, expect, beforeEach } from 'vitest';
import {
	injectAfterEvent,
	injectBetween,
	injectBurst,
} from '../lib/hook-helpers/inject.js';
import { initChance } from '../lib/utils/utils.js';

const t0 = Date.parse('2024-02-01T00:00:00Z');
const isoAt = (offsetMs) => new Date(t0 + offsetMs).toISOString();
const mkEv = (event, time) => ({ event, time });

beforeEach(() => initChance('inject-tests'));

describe('inject atoms', () => {
	test('injectAfterEvent: splices a clone right after the source with gapMs offset', () => {
		const a = mkEv('A', isoAt(0));
		const b = mkEv('B', isoAt(1000));
		const events = [a, b];
		const tpl = mkEv('Notify', isoAt(0));
		const inserted = injectAfterEvent(events, a, tpl, 500, { extra: 'tag' });
		expect(inserted).not.toBe(null);
		expect(inserted.extra).toBe('tag');
		expect(events.map(e => e.event)).toEqual(['A', 'Notify', 'B']);
		expect(Date.parse(inserted.time) - t0).toBe(500);
	});

	test('injectAfterEvent: returns null on bad inputs', () => {
		expect(injectAfterEvent(null, {time: 1}, {event: 'x'}, 0)).toBe(null);
		expect(injectAfterEvent([], null, {event: 'x'}, 0)).toBe(null);
		expect(injectAfterEvent([], {time: 1}, null, 0)).toBe(null);
	});

	test('injectBetween: splices midpoint between first A and first B after', () => {
		const events = [
			mkEv('A', isoAt(0)),
			mkEv('X', isoAt(500)),
			mkEv('B', isoAt(1000)),
		];
		const tpl = mkEv('Notify', isoAt(0));
		const inserted = injectBetween(events, 'A', 'B', tpl);
		expect(inserted).not.toBe(null);
		expect(Date.parse(inserted.time) - t0).toBe(500);
		// inserted should sit before B in the original array
		const eventNames = events.map(e => e.event);
		expect(eventNames.includes('Notify')).toBe(true);
		expect(eventNames.indexOf('Notify')).toBeLessThan(eventNames.indexOf('B'));
	});

	test('injectBetween: null on missing anchor', () => {
		const events = [mkEv('A', isoAt(0))];
		expect(injectBetween(events, 'A', 'Z', mkEv('Notify', isoAt(0)))).toBe(null);
	});

	test('injectBurst: pushes count events spread within ±spreadMs of anchor', () => {
		const events = [];
		const tpl = mkEv('viral', isoAt(0));
		const created = injectBurst(events, tpl, 50, isoAt(60_000), 30_000);
		expect(created.length).toBe(50);
		expect(events.length).toBe(50);
		for (const ev of created) {
			const t = Date.parse(ev.time);
			expect(t).toBeGreaterThanOrEqual(t0 + 60_000 - 30_000);
			expect(t).toBeLessThanOrEqual(t0 + 60_000 + 30_000);
		}
	});

	test('injectBurst: empty when count<=0', () => {
		expect(injectBurst([], {event: 'x', time: 0}, 0, 0, 1000)).toEqual([]);
	});
});
