// @ts-nocheck
/* eslint-disable no-undef */
import generate from '../index.js';
import fs from 'fs';
import path from 'path';

const timeout = 60000;

// Date pinning for determinism — without these, FIXED_NOW anchors to today
// and shifts across runs. Required for byte-equal repeatability.
const PINNED_DATES = { datasetStart: '2025-09-01T00:00:00Z', datasetEnd: '2025-10-01T00:00:00Z' };

function clearData() {
	const wipe = (dir) => {
		if (!fs.existsSync(dir)) return;
		for (const name of fs.readdirSync(dir)) {
			if (name === '.gitkeep') continue;
			try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); }
			catch (_) { /* best effort */ }
		}
	};
	wipe('./data');
	wipe('./tmp');
}

describe.sequential('output formats + validation', () => {

	beforeEach(() => { clearData(); });
	afterEach(() => { clearData(); });

	test('parquet format support', async () => {
		const results = await generate({ ...PINNED_DATES,
			writeToDisk: true, format: 'parquet', verbose: false,
			numEvents: 100, numUsers: 10, numDays: 5, seed: 'parquet-test',
			events: [{ event: 'test_event', weight: 10, properties: { value: [1, 2, 3, 4, 5] } }]
		});

		const { files } = results;
		expect(files.some(f => f.endsWith('.parquet'))).toBe(true);
		const parquetFiles = files.filter(f => f.endsWith('.parquet'));
		expect(parquetFiles.length).toBeGreaterThan(0);
		for (const file of parquetFiles) {
			expect(fs.existsSync(file)).toBe(true);
			expect(fs.statSync(file).size).toBeGreaterThan(0);
		}
	}, timeout);

	test('gzip compression for CSV', async () => {
		const results = await generate({ ...PINNED_DATES,
			writeToDisk: true, format: 'csv', gzip: true, verbose: false,
			numEvents: 100, numUsers: 10, numDays: 5, seed: 'gzip-csv-test',
			events: [{ event: 'test_event', weight: 10, properties: { value: [1, 2, 3, 4, 5] } }]
		});

		const { files } = results;
		expect(files.some(f => f.endsWith('.csv.gz'))).toBe(true);
		const gzipFiles = files.filter(f => f.endsWith('.csv.gz'));
		expect(gzipFiles.length).toBeGreaterThan(0);
		for (const file of gzipFiles) {
			expect(fs.existsSync(file)).toBe(true);
			expect(fs.statSync(file).size).toBeGreaterThan(0);
		}
	}, timeout);

	test('gzip compression for JSON', async () => {
		const results = await generate({ ...PINNED_DATES,
			writeToDisk: true, format: 'json', gzip: true, verbose: false,
			numEvents: 100, numUsers: 10, numDays: 5, seed: 'gzip-json-test',
			events: [{ event: 'test_event', weight: 10, properties: { value: [1, 2, 3, 4, 5] } }]
		});

		const { files } = results;
		expect(files.some(f => f.endsWith('.json.gz'))).toBe(true);
		const gzipFiles = files.filter(f => f.endsWith('.json.gz'));
		expect(gzipFiles.length).toBeGreaterThan(0);
		for (const file of gzipFiles) {
			expect(fs.existsSync(file)).toBe(true);
			expect(fs.statSync(file).size).toBeGreaterThan(0);
		}
	}, timeout);

	test('gzip compression for parquet', async () => {
		const results = await generate({ ...PINNED_DATES,
			writeToDisk: true, format: 'parquet', gzip: true, verbose: false,
			numEvents: 100, numUsers: 10, numDays: 5, seed: 'gzip-parquet-test',
			events: [{ event: 'test_event', weight: 10, properties: { value: [1, 2, 3, 4, 5] } }]
		});

		const { files } = results;
		expect(files.some(f => f.endsWith('.parquet.gz'))).toBe(true);
		const gzipFiles = files.filter(f => f.endsWith('.parquet.gz'));
		expect(gzipFiles.length).toBeGreaterThan(0);
		for (const file of gzipFiles) {
			expect(fs.existsSync(file)).toBe(true);
			expect(fs.statSync(file).size).toBeGreaterThan(0);
		}
	}, timeout);

	test('validation: writeToDisk=false with low batchSize warns but succeeds', async () => {
		clearData();
		const warnSpy = vi.spyOn(console, 'warn');

		const results = await generate({ ...PINNED_DATES,
			numUsers: 10, numEvents: 100, batchSize: 50,
			writeToDisk: false, verbose: true, seed: 'validation-test'
		});

		expect(results.eventCount).toBeGreaterThan(0);
		expect(results.userCount).toBe(10);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('batchSize'));

		warnSpy.mockRestore();
		clearData();
	}, timeout);

	test('validation: writeToDisk=false with adequate batchSize works', async () => {
		const results = await generate({ ...PINNED_DATES,
			numUsers: 10, numEvents: 100, batchSize: 150,
			writeToDisk: false, verbose: false, seed: 'validation-success-test'
		});

		expect(results.eventCount).toBeGreaterThan(0);
		expect(results.userCount).toBe(10);
	}, timeout);

});
