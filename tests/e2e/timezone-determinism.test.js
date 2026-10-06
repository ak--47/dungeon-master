//@ts-nocheck
/**
 * Output must not depend on the machine's time zone.
 *
 * Same seed + same config under TZ=UTC, TZ=America/New_York, and
 * TZ=Asia/Kolkata must give byte-identical events, profiles, SCD rows, group
 * profiles, warehouse tables, ad spend, mirror rows, standalone rows, and
 * lookup tables. Node reads `TZ` at process start, so each zone runs in its
 * own child process (tests/e2e/tz-run.mjs) and the parent compares digests.
 */
import { describe, test, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'tz-run.mjs');
const ZONES = ['UTC', 'America/New_York', 'Asia/Kolkata'];

async function digestUnder(tz, mode) {
	const { stdout } = await run(process.execPath, [runner, mode], {
		env: { ...process.env, TZ: tz },
		maxBuffer: 16 * 1024 * 1024,
	});
	const line = stdout.trim().split('\n').pop();
	return JSON.parse(line);
}

describe('output is identical across machine time zones', () => {
	for (const mode of ['legacy', 'activeDays', 'retentionCurve']) {
		test(`${mode}: every output surface matches across ${ZONES.join(', ')}`, async () => {
			const digests = await Promise.all(ZONES.map((tz) => digestUnder(tz, mode)));
			const [base, ...rest] = digests;
			for (let i = 0; i < rest.length; i++) {
				expect({ tz: ZONES[i + 1], ...rest[i] }).toEqual({ tz: ZONES[i + 1], ...base });
			}
		}, 120_000);
	}
});
