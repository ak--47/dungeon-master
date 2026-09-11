//@ts-nocheck
import { beforeEach, afterEach, describe, test, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import generate from '../../index.js';

const timeout = 120_000;
const DATA_DIR = path.join(os.tmpdir(), 'dungeon-master-warehouse-metrics');
const ROOT = path.resolve(import.meta.dirname, '../..');
const VERIFY_STORIES = path.join(ROOT, 'scripts/verify-stories.mjs');
const FIXTURE = path.join(ROOT, 'dungeons/technical/warehouse.js');

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

function runVerifyStories(args) {
	return spawnSync(process.execPath, [VERIFY_STORIES, ...args], {
		cwd: ROOT,
		encoding: 'utf-8',
		timeout,
	});
}

function makeTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'dm-wh-verify-'));
}

function writeFixture(filePath, content) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
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

	test('verify-stories warehouse CLI matches disk and in-memory reports from temp-dir artifacts', async () => {
		const fixture = await loadFixture({ bustCache: true });
		const tmpDir = makeTempDir();
		const prefix = 'warehouse-cli-parity';
		try {
			await generate({
				...fixture,
				name: prefix,
				writeToDisk: tmpDir,
				format: 'json',
				gzip: false,
				verbose: false,
				credentials: { ...(fixture.credentials || {}), token: '' },
			});

			const inMemory = runVerifyStories([FIXTURE, '--in-memory', '--json']);
			const disk = runVerifyStories([FIXTURE, '--data-prefix', path.join(tmpDir, prefix), '--json']);

			expect(inMemory.status).toBe(0);
			expect(disk.status).toBe(0);

			const inMemoryReport = JSON.parse(inMemory.stdout);
			const diskReport = JSON.parse(disk.stdout);

			expect(diskReport.pass).toBe(true);
			expect(diskReport.warehouseAudits).toEqual(inMemoryReport.warehouseAudits);
			expect(diskReport.stories.map((story) => [story.id, story.verdict])).toEqual(
				inMemoryReport.stories.map((story) => [story.id, story.verdict]),
			);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}, timeout);

	test('verify-stories runs warehouse audit with no stories present', async () => {
		const tmpDir = makeTempDir();
		const fixturePath = path.join(tmpDir, 'warehouse-no-stories.mjs');
		const prefix = 'warehouse-no-stories';
		writeFixture(fixturePath, `import base from ${JSON.stringify(pathToFileURL(FIXTURE).href)};
export default { ...base, credentials: { ...(base.credentials || {}), token: '' } };
`);
		try {
			const { default: fixture } = await import(`${pathToFileURL(fixturePath).href}?t=${Date.now()}`);
			await generate({
				...fixture,
				name: prefix,
				writeToDisk: tmpDir,
				format: 'json',
				gzip: false,
				verbose: false,
			});

			const report = runVerifyStories([fixturePath, '--data-prefix', path.join(tmpDir, prefix), '--json']);

			expect(report.status).toBe(0);
			const parsed = JSON.parse(report.stdout);
			expect(parsed.stories).toEqual([]);
			expect(parsed.warehouseAudits.length).toBeGreaterThan(0);
			expect(parsed.pass).toBe(true);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}, timeout);

	test('verify-stories exits nonzero when warehouse audit fails on temp-dir disk artifacts', async () => {
		const tmpDir = makeTempDir();
		const fixturePath = path.join(tmpDir, 'warehouse-audit-fail.mjs');
		const prefix = 'warehouse-audit-fail';
		writeFixture(fixturePath, `import base from ${JSON.stringify(pathToFileURL(FIXTURE).href)};
export default {
	...base,
	credentials: { ...(base.credentials || {}), token: '' },
	stories: undefined,
	warehouseMetrics: [
		{
			...base.warehouseMetrics[0],
			columns: { revenue_quality: 0 },
		},
	],
	hook(row, type) {
		if (type !== 'warehouse') return row;
		row.revenue_quality = '';
		return row;
	},
};
`);
		try {
			const { default: fixture } = await import(`${pathToFileURL(fixturePath).href}?t=${Date.now()}`);
			await generate({
				...fixture,
				name: prefix,
				writeToDisk: tmpDir,
				format: 'json',
				gzip: false,
				verbose: false,
			});

			const report = runVerifyStories([fixturePath, '--data-prefix', path.join(tmpDir, prefix), '--json']);

			expect(report.status).toBe(1);
			const parsed = JSON.parse(report.stdout);
			expect(parsed.pass).toBe(false);
			expect(parsed.warehouseAudits[0].failures.join(' | ')).toMatch(/empty numeric cell/i);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}, timeout);

	test('verify-stories preserves multiline CSV string columns, empty numeric cells, and audit parity between disk and in-memory', async () => {
		const tmpDir = makeTempDir();
		const fixturePath = path.join(tmpDir, 'warehouse-multiline-csv-parity.mjs');
		const prefix = 'warehouse-multiline-csv-parity';
		const trickyNote = 'north, "enterprise"\r\nrenewal\nline';
		writeFixture(fixturePath, `export default {
	name: 'warehouse-multiline-csv-parity',
	seed: 'warehouse-multiline-csv-parity',
	datasetStart: '2024-01-01T00:00:00Z',
	datasetEnd: '2024-01-03T23:59:59Z',
	numUsers: 3,
	numEvents: 6,
	format: 'csv',
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	credentials: { token: '', region: 'US' },
	switches: {
		hasSessionIds: false,
		hasAdSpend: false,
		hasLocation: false,
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		alsoInferFunnels: false,
	},
	events: [
		{ event: 'subscribe', weight: 3, isStrictEvent: false, properties: { plan: ['pro'], note_seed: ['x'] } },
		{ event: 'cancel', weight: 1, isStrictEvent: false, properties: { plan: ['pro'], note_seed: ['x'] } },
	],
	warehouseMetrics: [{
		name: 'multiline_notes',
		type: 'point-in-time',
		grain: 'day',
		format: 'csv',
		timeColumn: 'date',
		valueColumn: 'active',
		baseline: 10,
		columns: {
			note: '',
			quality_score: 0,
		},
		source: {
			event: 'subscribe',
			minus: 'cancel',
			measure: 'count',
		},
	}],
	hook(row, type, meta) {
		if (type !== 'warehouse' || meta.metricName !== 'multiline_notes') return row;
		if (row.date === '2024-01-02') {
			row.note = ${JSON.stringify(trickyNote)};
			row.quality_score = '';
		}
		return row;
	},
};
export const stories = [];
`);
		try {
			const { default: fixture } = await import(`${pathToFileURL(fixturePath).href}?t=${Date.now()}`);
			await generate({
				...fixture,
				name: prefix,
				writeToDisk: tmpDir,
				format: 'json',
				gzip: false,
				verbose: false,
			});

			const csvPath = path.join(tmpDir, `${prefix}-WAREHOUSE-multiline_notes.csv`);
			const csvBody = fs.readFileSync(csvPath, 'utf8');
			expect(csvBody).toContain('north, ""enterprise""');
			expect(csvBody).toContain('renewal\nline');

			const inMemory = runVerifyStories([fixturePath, '--in-memory', '--json']);
			const disk = runVerifyStories([fixturePath, '--data-prefix', path.join(tmpDir, prefix), '--json']);

			expect(inMemory.status).toBe(1);
			expect(disk.status).toBe(1);

			const inMemoryReport = JSON.parse(inMemory.stdout);
			const diskReport = JSON.parse(disk.stdout);

			expect(inMemoryReport.pass).toBe(false);
			expect(diskReport.pass).toBe(false);
			expect(inMemoryReport.warehouseAudits).toEqual(diskReport.warehouseAudits);
			expect(diskReport.warehouseAudits[0].stats.emptyNumericCells).toBe(1);
			expect(diskReport.warehouseAudits[0].failures.join(' | ')).toMatch(/empty numeric cell/i);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}, timeout);
});