/**
 * Child-process runner for tests/e2e/timezone-determinism.test.js.
 *
 * Generates one in-memory dungeon (no hooks, every output surface on) and
 * prints a JSON digest per output. The parent spawns this script under
 * different `TZ` values; the digests must match.
 *
 * Usage: TZ=<zone> node tests/e2e/tz-run.mjs <mode>
 *   mode: legacy | activeDays | retentionCurve
 */
import crypto from 'node:crypto';
import DUNGEON_MASTER from '../../index.js';

const mode = process.argv[2] || 'legacy';

/** @param {string} m */
function config(m) {
	return {
		seed: `tz-determinism-${m}`,
		// The window crosses the US DST change (2025-11-02) so day arithmetic in a
		// local time zone shows up as an hour shift, not only as a fixed offset.
		datasetStart: '2025-10-15T00:00:00Z',
		datasetEnd: '2025-11-20T23:59:59Z',
		numUsers: 60,
		avgEventsPerUserPerDay: 2,
		concurrency: 1,
		writeToDisk: false,
		verbose: false,
		macro: { percentUsersBornInDataset: 60, bornRecentBias: 0, preExistingSpread: 'uniform' },
		...(m === 'activeDays' ? { avgActiveDaysPerUser: 6 } : {}),
		...(m === 'retentionCurve' ? { retentionCurve: { type: 'logarithmic', day1: 0.6, day7: 0.4, day30: 0.3 } } : {}),
		switches: { hasSessionIds: true, hasCampaigns: true, hasAdSpend: true, hasLocation: true },
		identity: { avgDevicePerUser: 2 },
		events: [
			{ event: 'sign up', isFirstEvent: true, isAuthEvent: true, isAttributionEvent: true },
			{ event: 'page view', weight: 6, properties: { page: ['home', 'pricing', 'docs'] } },
			{ event: 'purchase', weight: 2, properties: { amount: [10, 20, 50], region: ['us', 'eu'] } },
			{ event: 'subscribe', weight: 1, properties: { region: ['us', 'eu'] } },
		],
		funnels: [
			{ sequence: ['sign up', 'page view'], isFirstFunnel: true, conversionRate: 80, timeToConvert: 2 },
			{ sequence: ['page view', 'purchase'], conversionRate: 40, timeToConvert: 24 },
		],
		userProps: { plan: ['free', 'pro'] },
		scdProps: {
			tier: { values: ['bronze', 'silver', 'gold'], frequency: 'week', timing: 'fuzzy', max: 6 },
			seat_band: { values: ['1-10', '11-50'], frequency: 'week', timing: 'fixed', max: 4 },
		},
		groupKeys: [['company_id', 12, ['purchase']]],
		groupProps: { company_id: { industry: ['tech', 'retail'] } },
		mirrorProps: { page: { events: ['page view'], strategy: 'fill', values: ['landing'], daysUnfilled: 10 } },
		lookupTables: [{ key: 'sku', entries: 5, attributes: { price: [1, 2, 3] } }],
		standaloneEvents: [{ event: 'cdn_egress', cadence: 'day', dimensions: { region: ['us', 'eu'] }, distinctIdFrom: 'region', properties: { gb_out: [100, 200] } }],
		warehouseMetrics: [
			{ name: 'bookings', source: { event: 'purchase', measure: 'sum', property: 'amount', groupBy: 'region' } },
			{ name: 'arr', type: 'point-in-time', grain: 'month', sparse: true, history: 3, source: { event: 'subscribe', groupBy: 'region' }, baseline: 100, scale: 10, valueColumn: 'arr_usd' },
			{ name: 'subs_weekly', grain: 'week', source: { event: 'subscribe', groupBy: 'region' } },
		],
	};
}

const r = await DUNGEON_MASTER(config(mode));
const digest = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex');
const all = (arr) => (arr || []).map((a) => Array.from(a));
console.log(JSON.stringify({
	events: digest(Array.from(r.eventData)),
	users: digest(Array.from(r.userProfilesData)),
	scd: digest(all(r.scdTableData)),
	groups: digest(all(r.groupProfilesData)),
	warehouse: digest(r.warehouseMetricData),
	adSpend: digest(Array.from(r.adSpendData)),
	mirror: digest(Array.from(r.mirrorEventData)),
	standalone: digest(Array.from(r.standaloneEventData)),
	lookup: digest(all(r.lookupTableData)),
	counts: { events: r.eventData.length, users: r.userProfilesData.length },
}));
