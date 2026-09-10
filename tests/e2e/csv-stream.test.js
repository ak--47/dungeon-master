// @ts-nocheck
import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as u from '../../lib/utils/utils.js';

const DATA_DIR = path.join(os.tmpdir(), 'dungeon-master-csv-stream');

function clearData() {
	try {
		fs.rmSync(DATA_DIR, { recursive: true, force: true });
		fs.mkdirSync(DATA_DIR, { recursive: true });
	} catch (_) { /* best effort */ }
}

describe.sequential('streamCSV disk behavior', () => {
	beforeEach(() => { clearData(); });
	afterEach(() => { clearData(); });

	test('respects fixedColumns order and preserves escaping', async () => {
		const data = [
			{ b: 'say "hi"', a: { nested: true }, c: '' },
		];
		const filePath = path.join(DATA_DIR, `dm-stream-fixed-${process.pid}.csv`);

		await u.streamCSV(filePath, data, { fixedColumns: ['c', 'a', 'b'] });

		const content = fs.readFileSync(filePath, 'utf8').trim();
		const lines = content.split('\n');
		expect(lines).toEqual([
			'c,a,b',
			'"","{""nested"":true}","say ""hi"""'
		]);
	});
});