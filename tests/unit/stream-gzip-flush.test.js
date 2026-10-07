//@ts-nocheck
/**
 * streamJSON / streamCSV with gzip must resolve only after the FILE is flushed,
 * not when the gzip transform has consumed its input. Before 1.9.0 the promise
 * resolved on the gzip stream's 'finish', so a reader that opened the file right
 * after `await` could see a truncated gzip member ("unexpected end of file").
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { streamJSON, streamCSV } from '../../lib/utils/utils.js';

const rows = Array.from({ length: 60_000 }, (_, i) => ({ i, event: 'page viewed', text: 'x'.repeat(200) + i }));

describe('gzip stream writers resolve after the file is flushed', () => {
	test('streamJSON gzip: file is a complete gzip member right after await', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-gz-'));
		for (let k = 0; k < 5; k++) {
			const f = path.join(dir, `e${k}.json.gz`);
			await streamJSON(f, rows, { gzip: true });
			const text = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
			expect(text.trimEnd().split('\n').length).toBe(rows.length);
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('streamCSV gzip: file is a complete gzip member right after await', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-gz-'));
		for (let k = 0; k < 5; k++) {
			const f = path.join(dir, `e${k}.csv.gz`);
			await streamCSV(f, rows, { gzip: true });
			const text = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
			expect(text.trimEnd().split('\n').length).toBe(rows.length + 1);
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
