// ── IMPORTS ──
import dayjs from 'dayjs';

// ── OVERVIEW ──
/*
 * NAME:       identity-model-verify
 * PURPOSE:    Phase 2 identity model verification fixture (intentionally simple).
 *             1K born-in-dataset users with isAuthEvent on `Sign Up` (the stitch
 *             step) and a 3-step first funnel. avgDevicePerUser:2 exercises the
 *             multi-device sticky-per-session model. Used by the phase 2
 *             verification gate (DuckDB queries against the events output).
 * SCALE:      1,000 users, ~90K events, 30 days
 * EVENTS (6): Browse (5) > Save Item (2) > Land (1) > View Pricing (1) > Sign Up (1) > Onboarding (1)
 * FUNNELS (1): Acquisition: Land → View Pricing → Sign Up → Onboarding (80%, attempts 0-2)
 */

// ── SCALE ──
const FIXED_NOW = dayjs('2024-02-02').unix();

// ── CONFIG ──
export default {
	name: 'identity-model-verify',
	seed: 'phase2-identity-verify',
	datasetStart: FIXED_NOW - 30 * 86400,
	datasetEnd: FIXED_NOW,
	numUsers: 1_000,
	avgEventsPerUserPerDay: 3,
	percentUsersBornInDataset: 100,
	hasAnonIds: true,
	avgDevicePerUser: 2,
	hasSessionIds: true,
	format: 'json',
	concurrency: 1,
	writeToDisk: true,
	verbose: false,
	events: [
		{ event: 'Land', isFirstEvent: true, isStrictEvent: true },
		{ event: 'View Pricing', isStrictEvent: true },
		{ event: 'Sign Up', isAuthEvent: true, isStrictEvent: true },
		{ event: 'Onboarding', isStrictEvent: true },
		{ event: 'Browse', weight: 5 },
		{ event: 'Save Item', weight: 2 },
	],
	funnels: [
		{
			name: 'Acquisition',
			sequence: ['Land', 'View Pricing', 'Sign Up', 'Onboarding'],
			conversionRate: 80,
			isFirstFunnel: true,
			timeToConvert: 2,
			attempts: { min: 0, max: 2 },
		},
	],
};
