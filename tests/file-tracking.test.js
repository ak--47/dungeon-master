import { describe, test, expect, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import main from '../index.js';
import { Storage } from '@google-cloud/storage';

const require = createRequire(import.meta.url);
const { determineDataType } = require('mixpanel-import/components/parsers.js');
const Job = require('mixpanel-import/components/job.js');

const GCS_TEST_PREFIX = 'gs://dungeon_master_4/tests';
const gcs = new Storage();
const timeout = 120_000;

function clearData() {
	try {
		if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
		execSync('npm run prune', { stdio: 'ignore' });
	} catch { }
}

async function clearGCSPrefix(prefix) {
	const uri = prefix.replace('gs://', '');
	const slashIdx = uri.indexOf('/');
	const bucketName = uri.slice(0, slashIdx);
	const folderPrefix = uri.slice(slashIdx + 1);
	const [files] = await gcs.bucket(bucketName).getFiles({ prefix: folderPrefix });
	if (files.length > 0) {
		await Promise.allSettled(files.map(f => f.delete()));
	}
}

async function gcsFileExists(gcsPath) {
	const { bucket, file } = parseGCSPath(gcsPath);
	const [exists] = await gcs.bucket(bucket).file(file).exists();
	return exists;
}

function parseGCSPath(gcsPath) {
	const uri = gcsPath.replace('gs://', '');
	const slashIdx = uri.indexOf('/');
	return { bucket: uri.slice(0, slashIdx), file: uri.slice(slashIdx + 1) };
}

describe.sequential('file tracking', () => {
	beforeEach(() => { clearData(); });

	test('getWrittenFiles tracks local batch file paths', async () => {
		const results = await main({
			numUsers: 50,
			numEvents: 500,
			batchSize: 100,
			writeToDisk: true,
			format: 'json',
			verbose: false,
			seed: 'track-local-batch',
			name: 'track-local-batch'
		});

		const { files } = results;
		expect(files.length).toBeGreaterThan(0);

		for (const f of files) {
			expect(fs.existsSync(f)).toBe(true);
		}

		const eventFiles = files.filter(f => f.includes('-EVENTS'));
		expect(eventFiles.length).toBeGreaterThan(1);
		for (const f of eventFiles) {
			expect(f).toContain('part-');
		}
	}, timeout);

	test('getWrittenFiles tracks single flush (non-batch) files', async () => {
		const results = await main({
			numUsers: 10,
			numEvents: 50,
			writeToDisk: true,
			format: 'json',
			verbose: false,
			seed: 'track-no-batch',
			name: 'track-no-batch'
		});

		const { files } = results;
		expect(files.length).toBeGreaterThan(0);

		const eventFiles = files.filter(f => f.includes('-EVENTS'));
		const userFiles = files.filter(f => f.includes('-USERS'));
		expect(eventFiles.length).toBe(1);
		expect(userFiles.length).toBe(1);

		for (const f of files) {
			expect(fs.existsSync(f)).toBe(true);
		}
	}, timeout);

	test('cleanup: true deletes local files after run', async () => {
		const results = await main({
			numUsers: 10,
			numEvents: 50,
			writeToDisk: true,
			format: 'json',
			verbose: false,
			seed: 'cleanup-local',
			name: 'cleanup-local',
			cleanup: true
		});

		const { files } = results;
		expect(files.length).toBeGreaterThan(0);

		for (const f of files) {
			expect(fs.existsSync(f)).toBe(false);
		}
	}, timeout);
});

describe.sequential('GCS file tracking', () => {

	test('getWrittenFiles tracks GCS paths', async () => {
		const testDir = `${GCS_TEST_PREFIX}/gcs-track-${Date.now()}`;
		try {
			const results = await main({
				numUsers: 10,
				numEvents: 100,
				batchSize: 30,
				writeToDisk: testDir,
				format: 'json',
				verbose: false,
				seed: 'track-gcs',
				name: 'gcs-track'
			});

			const { files } = results;
			expect(files.length).toBeGreaterThan(0);

			for (const f of files) {
				expect(f.startsWith(testDir + '/')).toBe(true);
			}

			expect(files.some(f => f.includes('-EVENTS'))).toBe(true);
			expect(files.some(f => f.includes('-USERS'))).toBe(true);

			for (const f of files) {
				const exists = await gcsFileExists(f);
				expect(exists).toBe(true);
			}
		} finally {
			await clearGCSPrefix(testDir);
		}
	}, timeout);

	test('cleanup: true deletes GCS files after run', async () => {
		const testDir = `${GCS_TEST_PREFIX}/cleanup-gcs-${Date.now()}`;
		const results = await main({
			numUsers: 5,
			numEvents: 30,
			writeToDisk: testDir,
			format: 'json',
			verbose: false,
			seed: 'cleanup-gcs',
			name: 'cleanup-gcs',
			cleanup: true
		});

		const { files } = results;
		expect(files.length).toBeGreaterThan(0);

		for (const f of files) {
			const exists = await gcsFileExists(f);
			expect(exists).toBe(false);
		}
	}, timeout);
});

/**
 * GCS round-trip tests — verify files written to GCS can be read back and
 * parsed by mixpanel-import. This is the exact code path that failed in
 * production: dungeon-master wrote with createWriteStream({ gzip: true })
 * which set Content-Encoding: gzip on GCS objects, confusing mixpanel-import's
 * extension-based gzip detection. Fix: write without gzip so content matches
 * the .csv/.json extension and mixpanel-import reads plain text.
 */
describe.sequential('GCS round-trip (write → read → parse)', () => {

	async function drainStream(stream) {
		const records = [];
		for await (const record of stream) {
			records.push(record);
		}
		return records;
	}

	test('GCS defaults to JSONL format, round-trips through mixpanel-import', async () => {
		const testDir = `${GCS_TEST_PREFIX}/roundtrip-json-${Date.now()}`;
		try {
			const results = await main({
				numUsers: 5, numEvents: 30,
				writeToDisk: testDir,
				verbose: false, seed: 'rt-json', name: 'rt-json'
			});

			const { files } = results;
			expect(files.length).toBeGreaterThan(0);

			// GCS defaults to .json (JSONL), no .gz
			for (const f of files) {
				expect(f).toMatch(/\.json$/);
			}

			// no Content-Encoding: gzip on objects
			const eventFiles = files.filter(f => f.includes('-EVENTS'));
			for (const f of eventFiles) {
				const { bucket, file } = parseGCSPath(f);
				const [meta] = await gcs.bucket(bucket).file(file).getMetadata();
				expect(meta.contentEncoding).not.toBe('gzip');
			}

			// mixpanel-import can stream-parse the events file
			const job = new Job({ token: 'test' }, {
				recordType: 'event', streamFormat: 'jsonl',
				forceStream: true, verbose: false, dryRun: true
			});
			const stream = await determineDataType(eventFiles, job);
			const records = await drainStream(stream);
			expect(records.length).toBeGreaterThan(0);

			for (const r of records.slice(0, 3)) {
				expect(r).toHaveProperty('event');
				expect(typeof r.event).toBe('string');
			}
		} finally {
			await clearGCSPrefix(testDir);
		}
	}, timeout);

	test('GCS with gzip: true writes .json.gz, round-trips correctly', async () => {
		const testDir = `${GCS_TEST_PREFIX}/roundtrip-gz-${Date.now()}`;
		try {
			const results = await main({
				numUsers: 5, numEvents: 30,
				writeToDisk: testDir,
				gzip: true,
				verbose: false, seed: 'rt-gz', name: 'rt-gz'
			});

			const { files } = results;
			expect(files.length).toBeGreaterThan(0);

			// gzip: true → .json.gz extension
			for (const f of files) {
				expect(f).toMatch(/\.json\.gz$/);
			}

			// no Content-Encoding on object (gzip is application-level, not transport)
			const eventFiles = files.filter(f => f.includes('-EVENTS'));
			for (const f of eventFiles) {
				const { bucket, file } = parseGCSPath(f);
				const [meta] = await gcs.bucket(bucket).file(file).getMetadata();
				expect(meta.contentEncoding).not.toBe('gzip');
			}

			// mixpanel-import can stream-parse the gzipped events file
			const job = new Job({ token: 'test' }, {
				recordType: 'event', streamFormat: 'jsonl',
				forceStream: true, verbose: false, dryRun: true
			});
			const stream = await determineDataType(eventFiles, job);
			const records = await drainStream(stream);
			expect(records.length).toBeGreaterThan(0);

			for (const r of records.slice(0, 3)) {
				expect(r).toHaveProperty('event');
				expect(typeof r.event).toBe('string');
			}
		} finally {
			await clearGCSPrefix(testDir);
		}
	}, timeout);

	test('full dungeon round-trip: events + users + groups + SCDs + adspend', async () => {
		const testDir = `${GCS_TEST_PREFIX}/roundtrip-full-${Date.now()}`;
		try {
			const results = await main({
				numUsers: 10, numEvents: 100,
				writeToDisk: testDir,
				verbose: false, seed: 'roundtrip-full', name: 'rt-full',
				hasAdSpend: true,
				groupKeys: [['company', 1]],
				groupProps: { company: { name: ['Acme', 'Globex', 'Initech'], size: [10, 50, 100] } },
				scdProps: { plan: { values: ['free', 'pro', 'enterprise'] } },
				events: [
					{ event: 'page_view', weight: 5 },
					{ event: 'signup', weight: 1 }
				],
				userProps: { role: ['admin', 'user', 'viewer'] }
			});

			const { files } = results;
			expect(files.length).toBeGreaterThan(0);

			// GCS default → .json
			for (const f of files) {
				expect(f).toMatch(/\.json$/);
			}

			expect(files.some(f => f.includes('-EVENTS'))).toBe(true);
			expect(files.some(f => f.includes('-USERS'))).toBe(true);
			expect(files.some(f => f.includes('-GROUPS'))).toBe(true);
			expect(files.some(f => f.includes('-SCD'))).toBe(true);
			expect(files.some(f => f.includes('-ADSPEND'))).toBe(true);

			// round-trip events through mixpanel-import
			const eventFiles = files.filter(f => f.includes('-EVENTS'));
			const job = new Job({ token: 'test' }, {
				recordType: 'event', streamFormat: 'jsonl',
				forceStream: true, verbose: false, dryRun: true
			});
			const stream = await determineDataType(eventFiles, job);
			const records = await drainStream(stream);
			expect(records.length).toBeGreaterThan(0);
		} finally {
			await clearGCSPrefix(testDir);
		}
	}, timeout);
});
