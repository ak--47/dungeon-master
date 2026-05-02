/**
 * Phase 4 reference dungeon — conversions attributed by source.
 *
 * Touch events carry one of three random sources; conversions are stamped with
 * the user's first-touch source weighted google:facebook:twitter = 10:5:1.
 * Verified via the attributedBy emulator.
 */

import dayjs from 'dayjs';
import { applyAttributedBySource } from '../../lib/hook-patterns/index.js';

const FIXED_NOW = dayjs('2024-02-02').unix();

export default {
	name: 'pattern-attributed-by-source',
	seed: 'phase4-attrib',
	datasetStart: FIXED_NOW - 30 * 86400,
	datasetEnd: FIXED_NOW,
	numUsers: 1_000,
	avgEventsPerUserPerDay: 4,
	percentUsersBornInDataset: 50,
	hasAnonIds: false,
	format: 'json',
	concurrency: 1,
	writeToDisk: true,
	verbose: false,
	events: [
		{ event: 'Touch', weight: 5, properties: { source: ['google', 'facebook', 'twitter'] } },
		{ event: 'Convert', weight: 2, properties: { source: ['unknown'] } },
	],
	hook: function (record, type) {
		if (type !== 'everything' || !Array.isArray(record)) return record;
		applyAttributedBySource(record, null, {
			sourceEvent: 'Touch',
			sourceProperty: 'source',
			downstreamEvent: 'Convert',
			weights: { google: 10, facebook: 5, twitter: 1 },
			model: 'firstTouch',
		});
		return record;
	},
};
