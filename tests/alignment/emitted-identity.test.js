import fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import generate from '../../index.js';
import * as identity from '../../lib/verify/identity.js';
import { buildEventIdentityMap, buildIdentityMap, resolveUserId } from '../../lib/verify/identity.js';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';
import { frequencyHistogram } from '../../lib/verify/counting.js';
import { verifyDungeon } from '../../lib/verify/verify-dungeon.js';
import { evaluateStories } from '../../lib/verify/story-runner.js';

vi.mock('../../index.js', () => ({ default: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const profiles = [{ distinct_id: 'user-1', device_ids: ['device-a', 'device-b'], plan: 'paid' }];
const firstDay = '2026-01-01T10:00:00.000Z';
const secondDay = '2026-01-02T10:00:00.000Z';
const breakdown = { type: 'eventBreakdown', event: 'Browse', breakdownProperty: 'channel' };

function browse(identity, time = firstDay) {
	return { event: 'Browse', channel: 'web', time, ...identity };
}

describe('automatic emitted identity', () => {
	test('profile device pools do not join unlinked devices in breakdowns', () => {
		const events = [browse({ device_id: 'device-a' }), browse({ device_id: 'device-b' })];
		expect(emulateBreakdown(events, { ...breakdown, profiles })).toEqual(
			emulateBreakdown(events, { ...breakdown, identityMap: new Map() }),
		);
	});

	test('unlinked devices from one profile cannot complete a cross-device funnel', () => {
		const events = [
			{ event: 'Start', device_id: 'device-a', time: firstDay },
			{ event: 'Finish', device_id: 'device-b', time: '2026-01-01T10:01:00.000Z' },
		];
		const funnel = { type: 'funnelFrequency', steps: ['Start', 'Finish'], breakdownByFrequencyOf: 'Start' };

		expect(emulateBreakdown(events, { ...funnel, profiles })).toEqual(
			emulateBreakdown(events, { ...funnel, identityMap: new Map() }),
		);
	});

	test('frequencyHistogram counts unlinked profile devices separately', () => {
		const events = [browse({ device_id: 'device-a' }), browse({ device_id: 'device-b' })];

		expect(frequencyHistogram(events, { event: 'Browse', intervalDays: 1, profiles })).toEqual([
			{ interval: '2026-01-01', histogram: [2] },
		]);
	});

	test('an ordinary both-ID event joins earlier anonymous events before time bucketing', () => {
		const events = [
			browse({ device_id: 'device-a' }),
			browse({ user_id: 'user-1' }),
			{ event: 'Telemetry', device_id: 'device-a', user_id: 'user-1', time: secondDay },
		];
		const bucketed = { ...breakdown, timeBucket: 'day' };

		expect(emulateBreakdown(events, bucketed)).toEqual(
			emulateBreakdown(events, { ...bucketed, identityMap: new Map([['device-a', 'user-1']]) }),
		);
		expect(frequencyHistogram(events, { event: 'Browse', intervalDays: 1 })).toEqual([
			{ interval: '2026-01-01', histogram: [1] },
			{ interval: '2026-01-02', histogram: [0] },
		]);
	});

	test('bare user_id is already identified without a device or profile', () => {
		expect(resolveUserId({ user_id: 'user-1' })).toBe('user-1');
		expect(frequencyHistogram([
			browse({ user_id: 'user-1' }),
			browse({ user_id: 'user-1' }),
		], { event: 'Browse', intervalDays: 1 })).toEqual([
			{ interval: '2026-01-01', histogram: [1] },
		]);
	});
});

describe('explicit identity overrides', () => {
	test('the public profile helper still links device pools when explicitly supplied', () => {
		const identityMap = buildIdentityMap(profiles);
		const events = [browse({ device_id: 'device-a' }), browse({ device_id: 'device-b' })];

		expect(identityMap).toEqual(new Map([['device-a', 'user-1'], ['device-b', 'user-1']]));
		expect(emulateBreakdown(events, { ...breakdown, profiles, identityMap })).not.toEqual(
			emulateBreakdown(events, { ...breakdown, identityMap: new Map() }),
		);
	});

	test('an explicit empty map suppresses automatic emitted links', () => {
		const anonymous = browse({ device_id: 'device-a' });
		const identified = browse({ user_id: 'user-1' });
		const events = [
			anonymous,
			identified,
			{ event: 'Telemetry', device_id: 'device-a', user_id: 'user-1', time: secondDay },
		];

		expect(emulateBreakdown(events, { ...breakdown, profiles, identityMap: new Map() })).toEqual(
			emulateBreakdown([anonymous, identified], { ...breakdown, identityMap: new Map() }),
		);
	});

	test('an explicit conflicting map wins over emitted pairs and profile pools', () => {
		const events = [
			browse({ device_id: 'device-a' }),
			browse({ user_id: 'user-1' }),
			{ event: 'Telemetry', device_id: 'device-a', user_id: 'user-1', time: secondDay },
		];
		const identityMap = new Map([['device-a', 'caller-user']]);

		expect(emulateBreakdown(events, { ...breakdown, profiles, identityMap })).toEqual([
			{ value: 'web', count: 2, total_users: 2 },
		]);
		expect(identityMap).toEqual(new Map([['device-a', 'caller-user']]));
	});
});

describe('emitted mapping input contract', () => {
	test.each([undefined, null, '', ' \t', 0, 7, false, true, NaN, [], {}])(
		'invalid ID %j cannot establish either side of a link', (invalidId) => {
			expect(buildEventIdentityMap([
				{ device_id: invalidId, user_id: 'user-1' },
				{ device_id: 'device-a', user_id: invalidId },
			])).toEqual(new Map());
		},
	);

	test('missing IDs and distinct_id-only records do not establish device links', () => {
		expect(buildEventIdentityMap([
			null, undefined, {},
			{ device_id: 'device-a' },
			{ user_id: 'user-1' },
			{ distinct_id: 'user-1', device_id: 'device-a' },
		])).toEqual(new Map());
		expect(buildEventIdentityMap(null)).toEqual(new Map());
		expect(buildEventIdentityMap(undefined)).toEqual(new Map());
	});

	test('reserved $device: user IDs cannot claim a device or block a later valid pair', () => {
		const events = [
			{ device_id: 'device-a', user_id: '$device:reserved' },
			{ device_id: 'device-b', user_id: '$device:' },
			{ device_id: 'device-a', user_id: 'user-1' },
		];
		expect(buildEventIdentityMap(events)).toEqual(new Map([['device-a', 'user-1']]));
	});

	test('first valid emitted pair wins a conflicting device claim without merging users', () => {
		const events = [
			Object.freeze({ device_id: 'device-a', user_id: 'user-1' }),
			Object.freeze({ device_id: 'device-a', user_id: 'user-2' }),
			Object.freeze({ device_id: 'device-b', user_id: 'user-2' }),
		];
		const identityMap = buildEventIdentityMap(Object.freeze(events));

		expect(identityMap).toEqual(new Map([['device-a', 'user-1'], ['device-b', 'user-2']]));
		expect(resolveUserId({ device_id: 'device-a' }, identityMap)).toBe('user-1');
		expect(resolveUserId({ user_id: 'user-2' }, identityMap)).toBe('user-2');
	});

	test('a valid device ID may use the v3 $device: prefix', () => {
		expect(buildEventIdentityMap([
			{ device_id: '$device:device-a', user_id: 'user-1' },
		])).toEqual(new Map([['$device:device-a', 'user-1']]));
	});
});

describe('automatic verification entry points', () => {
	test('linked anonymous events retain profile segmentation alongside bare identified users', () => {
		const events = [
			{ event: 'Start', device_id: 'device-a', time: firstDay },
			{ event: 'Finish', user_id: 'user-1', time: '2026-01-01T10:01:00.000Z' },
			{ event: 'Start', user_id: 'user-2', time: firstDay },
			{ event: 'Finish', user_id: 'user-2', time: '2026-01-01T10:02:00.000Z' },
			{ event: 'Telemetry', device_id: 'device-a', user_id: 'user-1', time: secondDay },
		];
		const rows = emulateBreakdown(events, {
			type: 'timeToConvert', steps: ['Start', 'Finish'], breakdownByUserProperty: 'plan',
			profiles: [...profiles, { distinct_id: 'user-2', plan: 'free' }],
			conversionWindowMs: 300_000, timeBucket: 'day',
		});

		expect(rows.filter(row => !row._empty)).toEqual([
			expect.objectContaining({ period: '2026-01-01', segment_value: 'free', user_count: 1, avg_ttc_s: 120 }),
			expect.objectContaining({ period: '2026-01-01', segment_value: 'paid', user_count: 1, avg_ttc_s: 60 }),
		]);
	});

	test('verifyDungeon builds one full-stream map across checks and preserves each override', async () => {
		const events = [
			browse({ device_id: 'device-a' }),
			browse({ user_id: 'user-1' }),
			{ event: 'Telemetry', device_id: 'device-a', user_id: 'user-1', time: secondDay },
		];
		vi.mocked(generate).mockResolvedValueOnce({
			eventData: events, userProfilesData: profiles,
			validatedConfig: { events: [{ event: 'Browse', properties: { channel: ['web'] } }, { event: 'Telemetry' }] },
		});
		const buildMap = vi.spyOn(identity, 'buildEventIdentityMap');
		const report = await verifyDungeon({}, [
			{ name: 'auto', breakdown, assert: rows => ({ pass: rows[0].total_users === 1 }) },
			{ name: 'auto bucket', breakdown: { ...breakdown, timeBucket: 'day' }, assert: rows => ({ pass: rows[0].total_users === 1 }) },
			{ name: 'override', breakdown: { ...breakdown, identityMap: new Map() }, assert: rows => ({ pass: rows[0].total_users === 2 }) },
		]);

		expect(report.results.map(result => result.pass)).toEqual([true, true, true]);
		expect(buildMap).toHaveBeenCalledTimes(1);
		expect(buildMap).toHaveBeenCalledWith(events);
	});

	test.each([false, true])('story evaluation honors explicit overrides: %s', async (override) => {
		const events = [
			browse({ device_id: 'device-a' }),
			browse({ user_id: 'user-1' }),
			{ event: 'Telemetry', device_id: 'device-a', user_id: 'user-1', time: secondDay },
		];
		const stories = [{
			id: 'emitted-identity', hook: 'H1', archetype: 'bespoke',
			narrative: 'Only an emitted both-ID pair joins anonymous events to a user.',
			assertions: [{
				breakdown, select: { all: { where: { value: 'web' } } },
				expect: { metric: 'all.total_users', op: '>=', target: override ? 2 : 1 }, minCohort: 1,
			}],
		}];
		const results = await evaluateStories(stories, events, {
			profiles, ...(override ? { identityMap: new Map() } : {}),
		});

		expect(results[0].verdict).toBe('NAILED');
	});
});

describe.sequential('verify-stories CLI emitted identity', () => {
	test.each(['in-memory', 'disk'])('%s mode uses emitted links once and preserves assertion overrides', async (mode) => {
		vi.resetModules();
		const events = [
			browse({ device_id: 'device-a' }),
			browse({ device_id: 'device-b' }),
			browse({ device_id: 'device-c' }),
			browse({ user_id: 'user-1' }),
			{ event: 'Telemetry', device_id: 'device-c', user_id: 'user-1', time: secondDay },
		];
		const config = {
			avgDevicePerUser: 1,
			events: [{ event: 'Browse', properties: { channel: ['web'] } }, { event: 'Telemetry' }],
		};
		const stories = [{
			id: 'emitted-identity', hook: 'H1', archetype: 'bespoke',
			narrative: 'Only emitted links join devices, even when profiles list a shared pool.',
			assertions: [false, true].map(override => ({
				breakdown: { ...breakdown, timeBucket: 'day', ...(override ? { identityMap: new Map() } : {}) },
				select: { all: { where: { value: 'web' } } },
				expect: { metric: 'all.total_users', op: '>=', target: override ? 4 : 3 }, minCohort: 1,
			})),
		}];
		vi.doMock('../../dungeons/technical/stories-verify.js', () => ({ default: config, stories }));
		vi.doMock('../../lib/core/extract-comments.js', () => ({ extractComments: () => ({ hookStories: '' }) }));
		vi.doMock('../../lib/core/config-validator.js', () => ({ validateDungeonConfig: () => config }));
		const { default: generateCli } = await import('../../index.js');
		vi.mocked(generateCli).mockResolvedValueOnce({
			eventData: events, userProfilesData: profiles, validatedConfig: config,
		});
		const identityModule = await import('../../lib/verify/identity.js');
		const buildMap = vi.spyOn(identityModule, 'buildEventIdentityMap');
		const fixturePath = fileURLToPath(new URL('../../dungeons/technical/stories-verify.js', import.meta.url));
		const prefix = '/emitted-identity-fixture/run';
		const shards = new Map([
			[`${prefix}-EVENTS-part-1.json`, events],
			[`${prefix}-USERS-part-1.json`, profiles],
		]);
		const existsSync = fs.existsSync.bind(fs);
		const readdirSync = fs.readdirSync.bind(fs);
		const createReadStream = fs.createReadStream.bind(fs);
		vi.spyOn(fs, 'existsSync').mockImplementation(filePath => filePath === '/emitted-identity-fixture' || existsSync(filePath));
		vi.spyOn(fs, 'readdirSync').mockImplementation(directory => directory === '/emitted-identity-fixture'
			? ['run-EVENTS-part-1.json', 'run-USERS-part-1.json'] : readdirSync(directory));
		vi.spyOn(fs, 'createReadStream').mockImplementation(filePath => shards.has(filePath)
			? Readable.from(shards.get(filePath).map(record => `${JSON.stringify(record)}\n`)) : createReadStream(filePath));
		const output = vi.spyOn(console, 'log').mockImplementation(() => {});
		const exitSignal = new Error('CLI exit');
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw exitSignal; });
		const originalArgv = process.argv;
		process.argv = [process.execPath, 'verify-stories.mjs', fixturePath, '--json',
			...(mode === 'in-memory' ? ['--in-memory'] : ['--data-prefix', prefix])];
		try {
			await expect(import('../../scripts/verify-stories.mjs')).rejects.toBe(exitSignal);
			const report = JSON.parse(output.mock.calls[0][0]);
			expect(report.stories[0].assertions.map(assertion => assertion.observed)).toEqual([3, 4]);
			expect(report.pass).toBe(true);
			expect(exit).toHaveBeenCalledWith(0);
			expect(buildMap).toHaveBeenCalledTimes(1);
			expect(buildMap).toHaveBeenCalledWith(events);
		} finally {
			process.argv = originalArgv;
			vi.doUnmock('../../dungeons/technical/stories-verify.js');
			vi.doUnmock('../../lib/core/extract-comments.js');
			vi.doUnmock('../../lib/core/config-validator.js');
		}
	});
});