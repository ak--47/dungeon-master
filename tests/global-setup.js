// Vitest globalSetup: runs ONCE before the suite and ONCE after.
// Prunes ./data and ./tmp to keep the workspace clean even when a test
// accidentally writes to a shared dir (per-test isolation lives in OS tmp).

import { execSync } from 'child_process';

function prune() {
	try {
		execSync('npm run prune', { stdio: 'ignore' });
	} catch (_) { /* best effort */ }
}

export function setup() { prune(); }
export function teardown() { prune(); }
