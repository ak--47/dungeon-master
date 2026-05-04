import { describe, test, expect, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import main from '../index.js';
import { Storage } from '@google-cloud/storage';

const GCS_TEST_PREFIX = 'gs://dungeon_master_4/tests';
const gcs = new Storage();
const timeout = 120_000;

function clearData() {
	try { execSync('npm run prune', { stdio: 'ignore' }); } catch { }
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
