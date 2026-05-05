//@ts-nocheck
import { describe, test, expect } from 'vitest';
import {
	scaleTimingBetween,
	scaleFunnelTTC,
	findFirstSequence,
} from '../lib/hook-helpers/timing.js';

const t0 = Date.parse('2024-02-01T00:00:00Z');
const isoAt = (offsetMs) => new Date(t0 + offsetMs).toISOString();
const mkEv = (event, time) => ({ event, time });

describe('timing atoms', () => {
	test('scaleTimingBetween: halves the gap between A and the next B', () => {
		const events = [
			mkEv('A', isoAt(0)),
			mkEv('B', isoAt(1_000_000)),
			mkEv('C', isoAt(2_000_000)),
		];
		const ok = scaleTimingBetween(events, 'A', 'B', 0.5);
		expect(ok).toBe(true);
		const b = events.find(e => e.event === 'B');
		expect(Date.parse(b.time) - t0).toBe(500_000);
	});

	test('scaleTimingBetween: returns false on missing anchors', () => {
		const events = [mkEv('A', isoAt(0))];
		expect(scaleTimingBetween(events, 'A', 'Z', 2)).toBe(false);
		expect(scaleTimingBetween(events, 'Z', 'A', 2)).toBe(false);
	});

	test('scaleFunnelTTC: scales offsets from the first event', () => {
		const events = [
			mkEv('s1', isoAt(0)),
			mkEv('s2', isoAt(60_000)),
			mkEv('s3', isoAt(120_000)),
		];
		const n = scaleFunnelTTC(events, 2);
		expect(n).toBe(2); // 2 events shifted (anchor unchanged)
		expect(Date.parse(events[0].time) - t0).toBe(0);
		expect(Date.parse(events[1].time) - t0).toBe(120_000);
		expect(Date.parse(events[2].time) - t0).toBe(240_000);
	});

	test('findFirstSequence: detects ordered run within max gap', () => {
		const events = [
			mkEv('open', isoAt(0)),
			mkEv('search', isoAt(60_000)),       // 1 min after open
			mkEv('view', isoAt(180_000)),        // 2 min after search
			mkEv('checkout', isoAt(240_000)),    // 1 min after view
		];
		const matched = findFirstSequence(events, ['open', 'search', 'checkout'], 5); // 5-min gap
		expect(matched).not.toBe(null);
		expect(matched.length).toBe(3);
		expect(matched.map(e => e.event)).toEqual(['open', 'search', 'checkout']);
	});

	test('findFirstSequence: returns null when gap exceeds limit', () => {
		const events = [
			mkEv('open', isoAt(0)),
			mkEv('checkout', isoAt(10 * 60_000)), // 10 min after open
		];
		expect(findFirstSequence(events, ['open', 'checkout'], 5)).toBe(null);
	});
});
