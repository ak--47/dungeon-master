// ── IMPORTS ──
/** @typedef {import('../../types').Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       warehouse
 * PURPOSE:    Minimal warehouse-metrics fixture covering the three canonical table shapes.
 * SCALE:      200 users, 120 events, 60 days
 * EVENTS (4): page_view (14) > subscription_started (2) > new_booking (1) > subscription_cancelled (1)
 * FUNNELS:     none
 * USER PROPS:  none
 * SUPER PROPS: none
 * GROUPS:      none
 */

// ── SCALE ──
const SEED = 'warehouse-fixture';
const DATASET_START = '2025-01-01T00:00:00Z';
const DATASET_END = '2025-03-01T23:59:59Z';

// ── CONFIG ──
/** @type {Config} */
const config = {
	name: 'warehouse',
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	numUsers: 200,
	numEvents: 120,
	format: 'csv',
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	credentials: {
		token: '',
		region: 'US',
	},
	switches: {
		hasSessionIds: false,
		hasAdSpend: false,
		hasLocation: false,
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		alsoInferFunnels: false,
	},
	events: [
		{
			event: 'page_view',
			weight: 14,
			isStrictEvent: false,
			properties: {
				page: ['/', '/pricing', '/reports', '/billing'],
			},
		},
		{
			event: 'new_booking',
			weight: 1,
			isStrictEvent: false,
			properties: {
				booking_value: [1200, 1800, 2400, 3600],
			},
		},
		{
			event: 'subscription_started',
			weight: 2,
			isStrictEvent: false,
			properties: {
				monthly_value: [100, 250, 500],
			},
		},
		{
			event: 'subscription_cancelled',
			weight: 1,
			isStrictEvent: false,
			properties: {
				monthly_value: [100, 250, 500],
			},
		},
	],
	warehouseMetrics: [
		{
			name: 'daily_new_bookings',
			type: 'additive',
			grain: 'day',
			source: {
				event: 'new_booking',
				measure: 'sum',
				property: 'booking_value',
			},
			timeColumn: 'date',
			valueColumn: 'bookings',
		},
		{
			name: 'daily_active_subscriptions',
			type: 'point-in-time',
			grain: 'day',
			source: {
				event: 'subscription_started',
				minus: 'subscription_cancelled',
				measure: 'count',
			},
			baseline: 40,
			timeColumn: 'date',
			valueColumn: 'active_subscriptions',
		},
		{
			name: 'monthly_arr_snapshot',
			type: 'point-in-time',
			grain: 'month',
			sparse: true,
			history: 18,
			source: {
				event: 'subscription_started',
				minus: 'subscription_cancelled',
				measure: 'sum',
				property: 'monthly_value',
			},
			baseline: 24000,
			scale: 12,
			timeColumn: 'month',
			valueColumn: 'arr_usd',
		},
	],
};

export default config;