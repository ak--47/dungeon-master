//@ts-nocheck
import { beforeEach, afterEach, describe, test, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import generate from '../../index.js';

const timeout = 120_000;
const DATA_DIR = path.join(os.tmpdir(), 'dungeon-master-warehouse-metrics');

function clearData() {
	try {
		fs.rmSync(DATA_DIR, { recursive: true, force: true });
		fs.mkdirSync(DATA_DIR, { recursive: true });
	} catch (_) { /* best effort */ }
}

async function loadFixture({ bustCache = false } = {}) {
	const moduleUrl = pathToFileURL(path.resolve('dungeons/technical/warehouse.js'));
	if (bustCache) {
		moduleUrl.searchParams.set('t', `${Date.now()}-${Math.random()}`);
	}
	const module = await import(moduleUrl.href);
	return module.default;
}

function readLines(filePath) {
	return fs.readFileSync(filePath, 'utf8').trim().split('\n');
}

function readNdjson(filePath) {
	return readLines(filePath).map((line) => JSON.parse(line));
}

function countInclusiveDays(startIso, endIso) {
	const start = Date.parse(startIso);
	const end = Date.parse(endIso);
	return Math.floor((end - start) / 86_400_000) + 1;
}

describe.sequential('warehouse metrics e2e', () => {
	beforeEach(() => { clearData(); });
	afterEach(() => {
		clearData();
		delete process.env.MP_TOKEN;
	});

	test('writes the three canonical CSV tables plus manifest with exact headers and zero cells', async () => {
		process.env.MP_TOKEN = 'ambient-fixture-token';
		const fixture = await loadFixture({ bustCache: true });
		expect(fixture.credentials?.token).toBe('');
		const result = await generate({
			...fixture,
			name: 'warehouse-e2e-csv',
			writeToDisk: DATA_DIR,
			verbose: false,
			format: 'csv',
			gzip: false,
			credentials: { ...(fixture.credentials || {}), token: '' },
		});

		const bookingsPath = path.join(DATA_DIR, 'warehouse-e2e-csv-WAREHOUSE-daily_new_bookings.csv');
		const subsPath = path.join(DATA_DIR, 'warehouse-e2e-csv-WAREHOUSE-daily_active_subscriptions.csv');
		const arrPath = path.join(DATA_DIR, 'warehouse-e2e-csv-WAREHOUSE-monthly_arr_snapshot.csv');
		const manifestPath = path.join(DATA_DIR, 'warehouse-e2e-csv-WAREHOUSE-MANIFEST.json');

		expect(result.files).toEqual(expect.arrayContaining([
			bookingsPath,
			subsPath,
			arrPath,
			manifestPath,
		]));

		for (const filePath of [bookingsPath, subsPath, arrPath, manifestPath]) {
			expect(fs.existsSync(filePath)).toBe(true);
		}

		const bookingsLines = readLines(bookingsPath);
		const subsLines = readLines(subsPath);
		const arrLines = readLines(arrPath);

		expect(bookingsLines[0]).toBe('date,bookings');
		expect(subsLines[0]).toBe('date,active_subscriptions');
		expect(arrLines[0]).toBe('month,arr_usd');
		expect(bookingsLines.slice(1).some((line) => /,"0(?:\.0+)?"$/.test(line))).toBe(true);

		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		expect(manifest.tables.map((table) => table.table)).toEqual([
			'daily_new_bookings',
			'daily_active_subscriptions',
			'monthly_arr_snapshot',
		]);
		expect(manifest.tables.every((table) => table.sql.includes('{{DATASET}}'))).toBe(true);
	}, timeout);

	test('format=json writes parseable warehouse rows with dense day buckets and ordered sparse monthly snapshots', async () => {
		const fixture = await loadFixture();
		const result = await generate({
			...fixture,
			name: 'warehouse-e2e-json',
			writeToDisk: DATA_DIR,
			verbose: false,
			format: 'json',
			gzip: false,
			credentials: { ...(fixture.credentials || {}), token: '' },
		});

		const bookingsPath = path.join(DATA_DIR, 'warehouse-e2e-json-WAREHOUSE-daily_new_bookings.json');
		const subsPath = path.join(DATA_DIR, 'warehouse-e2e-json-WAREHOUSE-daily_active_subscriptions.json');
		const arrPath = path.join(DATA_DIR, 'warehouse-e2e-json-WAREHOUSE-monthly_arr_snapshot.json');
		const manifestPath = path.join(DATA_DIR, 'warehouse-e2e-json-WAREHOUSE-MANIFEST.json');

		expect(result.files).toEqual(expect.arrayContaining([
			bookingsPath,
			subsPath,
			arrPath,
			manifestPath,
		]));

		for (const filePath of [bookingsPath, subsPath, arrPath, manifestPath]) {
			expect(fs.existsSync(filePath)).toBe(true);
		}

		const bookingsRows = readNdjson(bookingsPath);
		const subsRows = readNdjson(subsPath);
		const arrRows = readNdjson(arrPath);
		const denseDayCount = countInclusiveDays(fixture.datasetStart, fixture.datasetEnd);

		expect(bookingsRows.length).toBe(denseDayCount);
		expect(subsRows.length).toBe(denseDayCount);
		expect(bookingsRows[0]).toMatchObject({ date: '2025-01-01', bookings: expect.any(Number) });
		expect(bookingsRows.at(-1)).toMatchObject({ date: '2025-03-01', bookings: expect.any(Number) });
		expect(subsRows[0]).toMatchObject({ date: '2025-01-01', active_subscriptions: expect.any(Number) });
		expect(subsRows.at(-1)).toMatchObject({ date: '2025-03-01', active_subscriptions: expect.any(Number) });

		const months = arrRows.map((row) => row.month);
		const inWindowMonths = months.filter((month) => month >= '2025-01-01');
		expect(arrRows.length).toBeGreaterThan(18);
		expect(months).toEqual([...months].sort());
		expect(inWindowMonths.length).toBeGreaterThanOrEqual(2);
		expect(inWindowMonths).toEqual(expect.arrayContaining(['2025-01-01', '2025-02-01']));
		for (let index = 1; index < arrRows.length; index += 1) {
			expect(arrRows[index].arr_usd).not.toBe(arrRows[index - 1].arr_usd);
		}

		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		expect(manifest.tables.map((table) => table.table)).toEqual([
			'daily_new_bookings',
			'daily_active_subscriptions',
			'monthly_arr_snapshot',
		]);
	}, timeout);
});