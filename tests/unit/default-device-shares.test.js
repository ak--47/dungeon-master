//@ts-nocheck
/**
 * 1.9.0: default device and browser shares match a North America / Europe
 * consumer + B2B audience. Before, pool weights came from random `weighArray`
 * copies: fitness showed 54% Android users, 34% of Apple users on an iPad only,
 * and desktop pools carried PureOS and Pop!_OS (~8% of desktop events) and
 * Opera GX (~6% of Windows events).
 *
 * Picks are pure hash functions of the device key, so the shares are measured
 * over synthetic keys without generating events.
 */
import { describe, test, expect } from 'vitest';
import { createContext } from '../../lib/core/context.js';
import { deviceFieldsFor } from '../../lib/generators/events.js';

const N = 20000;
const ALL = { hasIOSDevices: true, hasAndroidDevices: true, hasDesktopDevices: true, hasBrowser: true };

function defaultsFor(switches) {
	const config = { hasIOSDevices: false, hasAndroidDevices: false, hasDesktopDevices: false, hasBrowser: false, ...switches };
	return { config, defaults: createContext(config).defaults };
}

function share(values, predicate) {
	return values.filter(predicate).length / values.length;
}

const primaries = (defaults, config, salt = 'p') =>
	Array.from({ length: N }, (_, i) => deviceFieldsFor(defaults, config, `${salt}${i}`));

describe('default device shares', () => {
	test('mobile primaries are ~55% iOS / ~45% Android; an iPad is a rare primary', () => {
		const { config, defaults } = defaultsFor(ALL);
		const mobile = primaries(defaults, config).filter(f => f.os !== 'Windows' && f.os !== 'macOS' && f.os !== 'Linux');
		const apple = mobile.filter(f => f.os === 'iOS' || f.os === 'iPadOS');
		expect(apple.length / mobile.length).toBeGreaterThan(0.52);
		expect(apple.length / mobile.length).toBeLessThan(0.58);
		expect(share(apple, f => f.os === 'iPadOS')).toBeLessThan(0.07);
		expect(share(apple, f => f.os === 'iPadOS')).toBeGreaterThan(0.02);
	});

	test('desktops are ~70% Windows / ~25% macOS / 3-5% Linux with mainstream OS names', () => {
		const { config, defaults } = defaultsFor(ALL);
		const desktop = primaries(defaults, config).filter(f => !f.carrier);
		expect(new Set(desktop.map(f => f.os))).toEqual(new Set(['Windows', 'macOS', 'Linux']));
		expect(share(desktop, f => f.os === 'Windows')).toBeGreaterThan(0.66);
		expect(share(desktop, f => f.os === 'Windows')).toBeLessThan(0.74);
		expect(share(desktop, f => f.os === 'macOS')).toBeGreaterThan(0.21);
		expect(share(desktop, f => f.os === 'macOS')).toBeLessThan(0.29);
		expect(share(desktop, f => f.os === 'Linux')).toBeGreaterThan(0.025);
		expect(share(desktop, f => f.os === 'Linux')).toBeLessThan(0.055);
	});

	test('a tablet is mostly a second device', () => {
		const { config, defaults } = defaultsFor({ hasIOSDevices: true, hasAndroidDevices: true });
		const extras = [];
		for (let i = 0; i < N; i++) {
			const pool = [`p${i}`, `e${i}`];
			if (deviceFieldsFor(defaults, config, pool[0], pool).os !== 'iOS') continue;
			extras.push(deviceFieldsFor(defaults, config, pool[1], pool));
		}
		expect(share(extras, f => f.os === 'iPadOS')).toBeGreaterThan(0.4);
	});

	test('browsers follow mainstream shares per OS', () => {
		const { config, defaults } = defaultsFor(ALL);
		const byOs = {};
		for (const f of primaries(defaults, config)) (byOs[f.os] ||= []).push(f.browser);
		const s = (os, b) => share(byOs[os], x => x === b);
		const within = (v, lo, hi) => { expect(v).toBeGreaterThan(lo); expect(v).toBeLessThan(hi); };
		within(s('Windows', 'Chrome'), 0.6, 0.7);
		within(s('Windows', 'Microsoft Edge'), 0.16, 0.24);
		within(s('Windows', 'Firefox'), 0.05, 0.11);
		expect(s('Windows', 'Opera GX')).toBeLessThan(0.02);
		within(s('macOS', 'Safari'), 0.45, 0.55);
		within(s('macOS', 'Chrome'), 0.35, 0.45);
		within(s('iOS', 'Mobile Safari'), 0.8, 0.9);
		within(s('iOS', 'Chrome iOS'), 0.08, 0.16);
		within(s('Android', 'Chrome Mobile'), 0.7, 0.8);
		within(s('Android', 'Samsung Internet'), 0.15, 0.25);
		expect(byOs.Linux.includes('Vivaldi')).toBe(false);
	});

	test('one enabled family uses only that family', () => {
		for (const [sw, oses] of [
			[{ hasAndroidDevices: true }, ['Android']],
			[{ hasIOSDevices: true }, ['iOS', 'iPadOS']],
			[{ hasDesktopDevices: true }, ['Windows', 'macOS', 'Linux']],
		]) {
			const { config, defaults } = defaultsFor(sw);
			const seen = new Set(primaries(defaults, config).map(f => f.os));
			expect([...seen].every(os => oses.includes(os)), JSON.stringify([...seen])).toBe(true);
		}
	});
});
