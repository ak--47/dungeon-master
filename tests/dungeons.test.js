//@ts-nocheck
/**
 * Dungeon Validation Tests
 *
 * Validates that all dungeon configs in ./dungeons/ are structurally valid
 * without running them. Checks imports, config shape, event/funnel consistency,
 * hook presence, and packaging rules (no tokens, writeToDisk: false).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateDungeonConfig } from '../lib/core/config-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dungeonDir = path.join(__dirname, '..', 'dungeons');

// Recursively discover all .js dungeon files in subdirectories
function findDungeonFiles(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	let files = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files = files.concat(findDungeonFiles(fullPath));
		} else if (entry.name.endsWith('.js')) {
			files.push(fullPath);
		}
	}
	return files;
}

const dungeonFiles = findDungeonFiles(dungeonDir).sort();

describe('Dungeon Validation', () => {
	it('has dungeons to test', () => {
		expect(dungeonFiles.length).toBeGreaterThan(0);
	});

	for (const filePath of dungeonFiles) {
		const name = path.relative(dungeonDir, filePath).replace('.js', '');

		describe(name, () => {
			let config;

			it('imports without error', async () => {
				const mod = await import(filePath);
				config = mod.default;
				expect(config).toBeDefined();
			});

			it('has required config fields', () => {
				if (!config) return;
				expect(config.numEvents !== undefined || config.avgEventsPerUserPerDay !== undefined).toBe(true);
				expect(config.numUsers).toBeDefined();
				// Time window: numDays alone OR datasetStart+datasetEnd pair
				expect(config.numDays !== undefined || (config.datasetStart !== undefined && config.datasetEnd !== undefined)).toBe(true);
				expect(config.events).toBeDefined();
				expect(Array.isArray(config.events)).toBe(true);
				expect(config.events.length).toBeGreaterThan(0);
			});

			it('has no real token', () => {
				if (!config) return;
				const token = config.token || '';
				// Token should be empty, the placeholder, or unset — never a real Mixpanel token
				expect(token === '' || token === 'your-mixpanel-token').toBe(true);
			});

			it('has writeToDisk: false (vertical dungeons)', () => {
				if (!config) return;
				// Technical fixtures may use writeToDisk: true for their own tests
				const isVertical = filePath.includes('/vertical/');
				if (isVertical && config.writeToDisk !== undefined) {
					expect(config.writeToDisk).toBe(false);
				}
			});

			it('has lowercase-hyphen filename', () => {
				const baseName = path.basename(name);
				expect(baseName).toMatch(/^[a-z0-9-]+$/);
			});

			it('isFirstEvent is valid if present', () => {
				if (!config) return;
				const firstEvents = config.events.filter(e => e.isFirstEvent);
				// isFirstEvent is optional — if present, should be boolean
				for (const ev of firstEvents) {
					expect(ev.isFirstEvent).toBe(true);
				}
			});

			it('funnel event names exist in events array', () => {
				if (!config || !config.funnels || config.funnels.length === 0) return;
				const eventNames = new Set(config.events.map(e => e.event));
				for (const funnel of config.funnels) {
					if (!funnel.sequence) continue;
					for (const step of funnel.sequence) {
						expect(eventNames.has(step), `Funnel step "${step}" not found in events`).toBe(true);
					}
				}
			});

			it('passes validateDungeonConfig', () => {
				if (!config) return;
				// Override placeholder token to avoid the no-op guard during testing
				expect(() => validateDungeonConfig({ ...config, token: "" })).not.toThrow();
			});
		});
	}
});
