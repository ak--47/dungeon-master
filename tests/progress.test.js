//@ts-nocheck
import { describe, test, expect } from 'vitest';
import generate from '../index.js';

const timeout = 30_000;

function baseConfig(overrides = {}) {
	return {
		seed: 'progress-test',
		numUsers: 50,
		numEvents: 500,
		numDays: 30,
		datasetStart: '2024-01-01T00:00:00Z',
		datasetEnd: '2024-01-31T00:00:00Z',
		format: 'json',
		writeToDisk: false,
		verbose: false,
		events: [
			{ event: 'page_view', weight: 5 },
			{ event: 'click', weight: 3 },
			{ event: 'purchase', weight: 1 },
		],
		funnels: [{
			sequence: ['page_view', 'click', 'purchase'],
			conversionRate: 50,
			isFirstFunnel: true,
		}],
		...overrides,
	};
}

describe('progress callback', () => {

	test('receives generation updates with correct shape', async () => {
		const updates = [];
		const result = await generate(baseConfig({
			onProgress: (u) => updates.push(structuredClone(u)),
			progressInterval: 50,
		}));

		const genUpdates = updates.filter(u => u.phase === 'generation');
		expect(genUpdates.length).toBeGreaterThan(0);

		const sample = genUpdates[0];
		expect(sample).toMatchObject({
			phase: 'generation',
			users: expect.any(Number),
			events: expect.any(Number),
			eps: expect.any(Number),
			memory: expect.any(String),
			elapsed: expect.any(String),
			percentComplete: expect.any(Number),
		});
	}, timeout);

	test('receives step updates with start and complete pairs', async () => {
		const updates = [];
		const result = await generate(baseConfig({
			onProgress: (u) => updates.push(structuredClone(u)),
		}));

		const stepUpdates = updates.filter(u => u.phase === 'step');
		const usersStart = stepUpdates.find(u => u.step === 'users' && u.status === 'start');
		const usersComplete = stepUpdates.find(u => u.step === 'users' && u.status === 'complete');

		expect(usersStart).toBeDefined();
		expect(usersComplete).toBeDefined();
	}, timeout);

	test('step complete updates have numeric duration', async () => {
		const updates = [];
		await generate(baseConfig({
			onProgress: (u) => updates.push(structuredClone(u)),
		}));

		const completes = updates.filter(u => u.phase === 'step' && u.status === 'complete');
		expect(completes.length).toBeGreaterThan(0);
		for (const c of completes) {
			expect(typeof c.duration).toBe('number');
			expect(c.duration).toBeGreaterThanOrEqual(0);
		}
	}, timeout);

	test('throttle respects progressInterval', async () => {
		const timestamps = [];
		await generate(baseConfig({
			numUsers: 200,
			numEvents: 2000,
			progressInterval: 200,
			onProgress: (u) => {
				if (u.phase === 'generation') timestamps.push(Date.now());
			},
		}));

		if (timestamps.length >= 2) {
			const gaps = [];
			for (let i = 1; i < timestamps.length; i++) {
				gaps.push(timestamps[i] - timestamps[i - 1]);
			}
			const minGap = Math.min(...gaps);
			expect(minGap).toBeGreaterThanOrEqual(150);
		}
	}, timeout);

	test('more updates with shorter progressInterval', async () => {
		const fastUpdates = [];
		const slowUpdates = [];

		await generate(baseConfig({
			numUsers: 200,
			numEvents: 2000,
			progressInterval: 50,
			onProgress: (u) => { if (u.phase === 'generation') fastUpdates.push(u); },
		}));

		await generate(baseConfig({
			numUsers: 200,
			numEvents: 2000,
			progressInterval: 500,
			onProgress: (u) => { if (u.phase === 'generation') slowUpdates.push(u); },
		}));

		expect(fastUpdates.length).toBeGreaterThanOrEqual(slowUpdates.length);
	}, timeout);

	test('no callback = no errors', async () => {
		const result = await generate(baseConfig());
		expect(result.eventData.length).toBeGreaterThan(0);
	}, timeout);

	test('no progress field when no callback', async () => {
		const result = await generate(baseConfig());
		expect(result.progress).toBeUndefined();
	}, timeout);

	test('bad callback (not a function) does not break job', async () => {
		const result = await generate(baseConfig({
			onProgress: "not a function",
		}));
		expect(result.eventData.length).toBeGreaterThan(0);
		expect(result.progress).toBeUndefined();
	}, timeout);

	test('callback that throws sync does not break job', async () => {
		let callCount = 0;
		const result = await generate(baseConfig({
			progressInterval: 50,
			onProgress: () => { callCount++; throw new Error('sync boom'); },
		}));

		expect(result.eventData.length).toBeGreaterThan(0);
		expect(result.progress.errors).toBeGreaterThanOrEqual(1);
	}, timeout);

	test('callback that throws async does not break job', async () => {
		const result = await generate(baseConfig({
			progressInterval: 50,
			onProgress: async () => { throw new Error('async boom'); },
		}));

		expect(result.eventData.length).toBeGreaterThan(0);
	}, timeout);

	test('disable after 3 failures', async () => {
		let callCount = 0;
		const result = await generate(baseConfig({
			numUsers: 200,
			numEvents: 2000,
			progressInterval: 10,
			onProgress: () => {
				callCount++;
				throw new Error('always fail');
			},
		}));

		expect(result.eventData.length).toBeGreaterThan(0);
		expect(result.progress.errors).toBe(3);
		expect(result.progress.disabled).toBe(true);
		expect(callCount).toBe(3);
	}, timeout);

	test('return value includes progress summary', async () => {
		const result = await generate(baseConfig({
			progressInterval: 50,
			onProgress: () => {},
		}));

		expect(result.progress).toBeDefined();
		expect(result.progress.updates).toBeGreaterThan(0);
		expect(result.progress.errors).toBe(0);
		expect(result.progress.disabled).toBe(false);
	}, timeout);

	test('percentComplete reaches close to 100', async () => {
		const updates = [];
		await generate(baseConfig({
			progressInterval: 10,
			onProgress: (u) => { if (u.phase === 'generation') updates.push(u); },
		}));

		const lastGen = updates[updates.length - 1];
		expect(lastGen.percentComplete).toBeGreaterThanOrEqual(90);
	}, timeout);

	test('overrides merge onProgress into each dungeon', async () => {
		const updates = [];
		const result = await generate(
			baseConfig(),
			{ onProgress: (u) => updates.push(u), progressInterval: 50 }
		);

		const genUpdates = updates.filter(u => u.phase === 'generation');
		expect(genUpdates.length).toBeGreaterThan(0);
		expect(result.progress).toBeDefined();
		expect(result.progress.updates).toBeGreaterThan(0);
	}, timeout);

	test('step updates only fire for steps that run', async () => {
		const updates = [];
		await generate(baseConfig({
			onProgress: (u) => updates.push(structuredClone(u)),
			hasAdSpend: false,
		}));

		const stepNames = updates.filter(u => u.phase === 'step').map(u => u.step);
		expect(stepNames).toContain('users');
		expect(stepNames).not.toContain('adspend');
		expect(stepNames).not.toContain('mirrors');
		expect(stepNames).not.toContain('flush');
		expect(stepNames).not.toContain('import');
	}, timeout);

});
