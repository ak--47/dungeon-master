/**
 * Schema validation for dungeon output.
 *
 * Derives the expected set of property keys per event type from a dungeon
 * config, then compares against actual output to catch hooks that introduce
 * undeclared columns ("flag stamping").
 *
 * Rule: a hook-introduced column is acceptable (PASS) only if it appears on
 * 100% of events of that type. Partial coverage is a FAIL.
 */

/** @typedef {import('../../types.js').Dungeon} Dungeon */

const CORE_KEYS = new Set(['event', 'time', 'insert_id', 'user_id']);
const LOCATION_KEYS = ['city', 'region', 'country', 'country_code'];
const DEVICE_KEYS = ['model', 'screen_height', 'screen_width', 'os', 'Platform', 'carrier', 'radio'];
const CAMPAIGN_KEYS = ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'];

/**
 * Derive the expected property keys per event type from config alone.
 * @param {Dungeon} config
 * @returns {Map<string, Set<string>>} eventName → set of expected property keys
 */
export function deriveExpectedSchema(config) {
	const globalKeys = new Set(CORE_KEYS);
	/** @type {Map<string, Set<string>>} */
	const perType = new Map();

	if (config.avgDevicePerUser > 0 || config.hasAnonIds) {
		globalKeys.add('device_id');
	}
	if (config.hasSessionIds) {
		globalKeys.add('session_id');
	}

	if (config.superProps) {
		for (const key of Object.keys(config.superProps)) {
			globalKeys.add(key);
		}
	}

	if (config.hasLocation) {
		for (const k of LOCATION_KEYS) globalKeys.add(k);
	}
	if (config.hasBrowser) {
		globalKeys.add('browser');
	}

	const hasDevices = config.hasAndroidDevices || config.hasIOSDevices ||
		config.hasDesktopDevices || (config.avgDevicePerUser && config.avgDevicePerUser > 0);
	if (hasDevices) {
		for (const k of DEVICE_KEYS) globalKeys.add(k);
	}

	if (config.hasCampaigns) {
		for (const k of CAMPAIGN_KEYS) globalKeys.add(k);
	}

	if (config.personas) {
		globalKeys.add('_persona');
	}

	if (config.dataQuality) {
		globalKeys.add('_drop');
	}

	const events = config.events || [];
	for (const ev of events) {
		const keys = new Set();
		if (ev.properties) {
			for (const k of Object.keys(ev.properties)) {
				keys.add(k);
			}
		}
		perType.set(ev.event, keys);
	}

	// Group keys — per event type or global
	if (config.groupKeys && Array.isArray(config.groupKeys)) {
		for (const groupPair of config.groupKeys) {
			const groupKey = groupPair[0];
			const groupEvents = groupPair[2] || [];
			if (!groupEvents.length) {
				globalKeys.add(groupKey);
			} else {
				for (const eventName of groupEvents) {
					ensurePerType(perType, eventName).add(groupKey);
				}
			}
		}
	}

	// Funnel props — applied to events in funnel sequences
	if (config.funnels && Array.isArray(config.funnels)) {
		for (const funnel of config.funnels) {
			if (funnel.props && Object.keys(funnel.props).length) {
				const funnelPropKeys = Object.keys(funnel.props);
				for (const eventName of (funnel.sequence || [])) {
					if (eventName === '$experiment_started') continue;
					for (const k of funnelPropKeys) {
						ensurePerType(perType, eventName).add(k);
					}
				}
			}
			// $experiment_started event from experiment funnels
			if (funnel.experiment) {
				const expKeys = ensurePerType(perType, '$experiment_started');
				expKeys.add('Experiment name');
				expKeys.add('Variant name');
			}
		}
	}

	// World event injected props
	if (config.worldEvents && Array.isArray(config.worldEvents)) {
		for (const we of config.worldEvents) {
			if (we.injectProps) {
				const injectedKeys = Object.keys(we.injectProps);
				const affects = we.affectsEvents;
				if (affects === '*') {
					for (const k of injectedKeys) globalKeys.add(k);
				} else if (Array.isArray(affects)) {
					for (const eventName of affects) {
						for (const k of injectedKeys) {
							ensurePerType(perType, eventName).add(k);
						}
					}
				}
			}
		}
	}

	// Build final schema: for each event type, merge global + per-type
	const schema = new Map();
	for (const [eventName, typeKeys] of perType) {
		const merged = new Set(globalKeys);
		for (const k of typeKeys) merged.add(k);
		schema.set(eventName, merged);
	}

	// Event types that only appear in funnels but not in events[] config
	// (e.g. $experiment_started) should still be in the schema
	for (const [eventName, typeKeys] of perType) {
		if (!schema.has(eventName)) {
			const merged = new Set(globalKeys);
			for (const k of typeKeys) merged.add(k);
			schema.set(eventName, merged);
		}
	}

	return schema;
}

/**
 * @typedef {Object} EventTypeReport
 * @property {string[]} expected
 * @property {string[]} actual
 * @property {string[]} added
 * @property {string[]} missing
 * @property {Object<string, {count: number, total: number, pct: number}>} coverage
 * @property {'PASS'|'FAIL'} verdict
 */

/**
 * @typedef {Object} SchemaReport
 * @property {boolean} pass
 * @property {Object<string, EventTypeReport>} eventTypes
 * @property {{pass: number, fail: number}} summary
 * @property {Array<{eventType: string, column: string, coverage: number}>} flagStamping
 */

/**
 * Validate generated events against the config-derived schema.
 * @param {Object[]} events — flat event objects from dungeon output
 * @param {Dungeon} config — the dungeon config (pre- or post-validation)
 * @returns {SchemaReport}
 */
export function validateSchema(events, config) {
	const expectedSchema = deriveExpectedSchema(config);

	// Group events by type
	/** @type {Map<string, Object[]>} */
	const byType = new Map();
	for (const ev of events) {
		const name = ev.event;
		if (!name) continue;
		if (!byType.has(name)) byType.set(name, []);
		byType.get(name).push(ev);
	}

	/** @type {Object<string, EventTypeReport>} */
	const eventTypes = {};
	/** @type {Array<{eventType: string, column: string, coverage: number}>} */
	const flagStamping = [];
	let passCount = 0;
	let failCount = 0;

	for (const [eventName, eventsOfType] of byType) {
		const expected = expectedSchema.get(eventName) || new Set(CORE_KEYS);

		// Collect all actual keys across events of this type
		const actualKeys = new Set();
		for (const ev of eventsOfType) {
			for (const k of Object.keys(ev)) {
				actualKeys.add(k);
			}
		}

		const expectedArr = Array.from(expected).sort();
		const actualArr = Array.from(actualKeys).sort();
		const added = actualArr.filter(k => !expected.has(k));
		const missing = expectedArr.filter(k => !actualKeys.has(k));

		// Check coverage for added columns
		/** @type {Object<string, {count: number, total: number, pct: number}>} */
		const coverage = {};
		let hasFailure = false;
		const total = eventsOfType.length;

		for (const col of added) {
			let count = 0;
			for (const ev of eventsOfType) {
				if (ev[col] !== undefined) count++;
			}
			const pct = Math.round((count / total) * 10000) / 100;
			coverage[col] = { count, total, pct };
			if (pct < 100) {
				hasFailure = true;
				flagStamping.push({ eventType: eventName, column: col, coverage: pct });
			}
		}

		const verdict = hasFailure ? 'FAIL' : 'PASS';
		if (verdict === 'PASS') passCount++;
		else failCount++;

		eventTypes[eventName] = {
			expected: expectedArr,
			actual: actualArr,
			added,
			missing,
			coverage,
			verdict,
		};
	}

	return {
		pass: failCount === 0,
		eventTypes,
		summary: { pass: passCount, fail: failCount },
		flagStamping,
	};
}

function ensurePerType(perType, eventName) {
	if (!perType.has(eventName)) perType.set(eventName, new Set());
	return perType.get(eventName);
}
