/* cSpell:disable */
// @ts-nocheck
/* eslint-disable no-undef */
/* eslint-disable no-debugger */
/* eslint-disable no-unused-vars */
import generate from '../../index.js';
import 'dotenv/config';

import simplest from '../../dungeons/technical/simplest.js';
import foobar from '../../dungeons/technical/foobar.js';

import fs from 'fs';
import os from 'os';
import path from 'path';

const timeout = 60000;

// Date pinning for determinism — without these, FIXED_NOW anchors to today
// and shifts across runs. Required for byte-equal repeatability.
const PINNED_DATES = { datasetStart: '2025-09-01T00:00:00Z', datasetEnd: '2025-10-01T00:00:00Z' };
// Isolated per-file tmp dir avoids races with parallel e2e files that wipe ./data.
const DATA_DIR = path.join(os.tmpdir(), 'dungeon-master-module-api');

function clearData() {
	try {
		fs.rmSync(DATA_DIR, { recursive: true, force: true });
		fs.mkdirSync(DATA_DIR, { recursive: true });
	} catch (_) { /* best effort */ }
}

describe.sequential('module', () => {

	beforeEach(() => { clearData(); });
	afterEach(() => { clearData(); });

	test('works as module (no config)', async () => {
		console.log('MODULE TEST');
		const results = await generate({ ...PINNED_DATES, verbose: false, writeToDisk: false, numEvents: 1100, numUsers: 100, seed: "deal with it" });
		const { eventData, groupProfilesData, lookupTableData, scdTableData, userProfilesData } = results;
		expect(eventData.length).toBeGreaterThan(100);
		expect(groupProfilesData.length).toBe(0);
		expect(lookupTableData.length).toBe(0);
		expect(scdTableData.length).toBe(0);
		expect(userProfilesData.length).toBe(100);

	}, timeout);

	test('works as module (simple)', async () => {
		console.log('MODULE TEST: SIMPLE');
		const results = await generate({ ...PINNED_DATES, ...simplest, verbose: false, writeToDisk: false, numEvents: 1100, numUsers: 100, seed: "deal with it", token: "" });
		const { eventData, groupProfilesData, lookupTableData, scdTableData, userProfilesData, adSpendData } = results;
		expect(eventData.length).toBeGreaterThan(0);
		expect(groupProfilesData.length).toBe(0);
		expect(lookupTableData.length).toBe(0);
		expect(scdTableData.length).toBe(0);
		expect(userProfilesData.length).toBeGreaterThan(90);
		expect(adSpendData.length).toBeGreaterThanOrEqual(0);

	}, timeout);

	test('works as module (foobar)', async () => {
		console.log('MODULE TEST: FOOBAR');
		const results = await generate({ ...PINNED_DATES, ...foobar, verbose: false, writeToDisk: false, numEvents: 1100, numUsers: 100, seed: "deal with it", token: "" });
		const { eventData, userProfilesData } = results;
		expect(eventData.length).toBeGreaterThan(980);
		expect(userProfilesData.length).toBe(100);

	}, timeout);

	test('fails with invalid configuration', async () => {
		try {
			await generate({ ...PINNED_DATES, numUsers: -10 });
		} catch (e) {
			expect(e).toBeDefined();
		}
	}, timeout);


	test('works with no params', async () => {
		const { eventData, userProfilesData, groupProfilesData, files, importResults, lookupTableData, mirrorEventData, scdTableData } = await generate({ ...PINNED_DATES, writeToDisk: false });
		expect(eventData.length).toBeGreaterThan(1000);
		expect(userProfilesData.length).toBe(1000);
		expect(groupProfilesData.length).toBe(0);
		expect(importResults).toBe(undefined);
		expect(scdTableData.length).toBe(0);
		expect(lookupTableData.length).toBe(0);
		expect(mirrorEventData.length).toBe(0);
	}, timeout);

	test('respects explicit name in file output', async () => {
		console.log('EXPLICIT NAME TEST');

		const customName = 'my-test-dataset';

		const results = await generate({ ...PINNED_DATES,
			name: customName,
			writeToDisk: DATA_DIR,
			numEvents: 100,
			numUsers: 10,
			seed: "explicit-name-test",
			verbose: false,
			format: 'csv'
		});

		const { files, eventCount, userCount } = results;

		expect(eventCount).toBeGreaterThan(0);
		expect(userCount).toBe(10);

		expect(files).toBeDefined();
		expect(files.length).toBeGreaterThan(0);

		const relevantFiles = files.filter(file =>
			file.includes('EVENTS') || file.includes('USERS')
		);

		expect(relevantFiles.length).toBeGreaterThan(0);

		for (const filePath of relevantFiles) {
			const fileName = filePath.split('/').pop();
			expect(fileName).toMatch(new RegExp(`^${customName}-`));
		}

		const eventFile = relevantFiles.find(f => f.includes('EVENTS'));
		const userFile = relevantFiles.find(f => f.includes('USERS'));

		expect(eventFile).toBeDefined();
		expect(userFile).toBeDefined();

		const eventFileName = eventFile.split('/').pop();
		const userFileName = userFile.split('/').pop();

		expect(eventFileName).toBe(`${customName}-EVENTS.csv`);
		expect(userFileName).toBe(`${customName}-USERS.csv`);

	}, timeout);

	test('generates random name when name is empty string', async () => {
		console.log('EMPTY NAME TEST');

		const results = await generate({ ...PINNED_DATES,
			name: "",
			writeToDisk: DATA_DIR,
			numEvents: 50,
			numUsers: 5,
			seed: "empty-name-test",
			verbose: false,
			format: 'csv'
		});

		const { files, eventCount, userCount } = results;

		expect(eventCount).toBeGreaterThan(5);
		expect(userCount).toBe(5);

		expect(files).toBeDefined();
		expect(files.length).toBeGreaterThan(0);

		const relevantFiles = files.filter(file =>
			file.includes('EVENTS') || file.includes('USERS')
		);

		expect(relevantFiles.length).toBeGreaterThan(0);

		for (const filePath of relevantFiles) {
			const fileName = filePath.split('/').pop();
			expect(fileName).not.toMatch(/^-/);
			expect(fileName).toMatch(/^[a-z]+-[a-z]+-[a-z]+-/);
		}

	}, timeout);

});
