/**
 * Standalone event generator module (v1.8.0)
 *
 * Standalone events are IDENTITY-LESS metric snapshots. They carry no `user_id`
 * and no `device_id` — they describe a system, not a person. Think daily CDN
 * egress per region, weekly billing rollups per plan tier, hourly queue depth
 * per cluster. `$ad_spend` is the same idea, hard-coded; this is the general form.
 *
 * One record is emitted per cadence tick per dimension cross-product row:
 *
 *   cadence: 'day', dimensions: { region: ['us','eu'], tier: ['a','b'] }
 *   → 4 records per day (us/a, us/b, eu/a, eu/b)
 *
 * `distinct_id` is synthetic. It is the value of the dimension named by
 * `distinctIdFrom`, or the event name when no dimension is named. It exists only
 * so Mixpanel accepts the record; it never maps to a person.
 */

/** @typedef {import('../../types').Context} Context */
/** @typedef {import('../../types').StandaloneEventConfig} StandaloneEventConfig */
/** @typedef {import('../../types').ResolvedStandaloneEventConfig} ResolvedStandaloneEventConfig */

import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import * as u from "../utils/utils.js";

dayjs.extend(utc);

/** Seconds per cadence tick. */
const CADENCE_SECONDS = {
	hour: 60 * 60,
	day: 24 * 60 * 60,
	week: 7 * 24 * 60 * 60,
};

/** Cadence names the validator accepts. */
export const VALID_CADENCES = Object.freeze(Object.keys(CADENCE_SECONDS));

/**
 * Expands a `dimensions` map into every combination of its values.
 * `{ a: [1,2], b: ['x'] }` → `[{a:1,b:'x'}, {a:2,b:'x'}]`.
 * An empty/absent map yields a single empty row, so an undimensioned
 * standalone event emits exactly one record per tick.
 *
 * @param {Record<string, any[]>} dimensions
 * @returns {Record<string, any>[]}
 */
export function expandDimensions(dimensions) {
	const keys = Object.keys(dimensions || {});
	if (keys.length === 0) return [{}];

	let rows = [{}];
	for (const key of keys) {
		const values = dimensions[key];
		/** @type {Record<string, any>[]} */
		const next = [];
		for (const row of rows) {
			for (const value of values) {
				next.push({ ...row, [key]: value });
			}
		}
		rows = next;
	}
	return rows;
}

/**
 * Every tick timestamp for one standalone event across the dataset window.
 *
 * Ticks start at `datasetStart` and step by the cadence. The final tick is the
 * last one that lands at or before `datasetEnd` — a standalone event never
 * emits a record in the future, matching the engine-wide future-time guard.
 *
 * @param {number} datasetStart - unix seconds
 * @param {number} datasetEnd - unix seconds
 * @param {'hour'|'day'|'week'} cadence
 * @returns {number[]} unix seconds, ascending
 */
export function buildTicks(datasetStart, datasetEnd, cadence) {
	const step = CADENCE_SECONDS[cadence];
	if (!step) throw new Error(`unknown cadence: ${cadence}`);

	/** @type {number[]} */
	const ticks = [];
	for (let t = datasetStart; t <= datasetEnd; t += step) {
		ticks.push(t);
	}
	return ticks;
}

/**
 * Builds every record for a single standalone event config.
 *
 * @param {Context} context
 * @param {ResolvedStandaloneEventConfig} spec
 * @returns {Record<string, any>[]}
 */
export function makeStandaloneEvents(context, spec) {
	const { config } = context;
	const datasetStart = context.FIXED_BEGIN;
	const datasetEnd = context.FIXED_NOW;

	const ticks = buildTicks(datasetStart, datasetEnd, spec.cadence);
	const rows = expandDimensions(spec.dimensions);
	const propKeys = Object.keys(spec.properties);

	/** @type {Record<string, any>[]} */
	const records = [];

	for (let tickIndex = 0; tickIndex < ticks.length; tickIndex++) {
		const tickUnix = ticks[tickIndex];
		const isoTime = dayjs.unix(tickUnix).utc().toISOString();

		for (const dimensions of rows) {
			context.incrementOperations();

			// distinct_id is synthetic: the named dimension's value, else the
			// event name. Never a person. Stable across the run so the record
			// series groups cleanly in Mixpanel.
			const distinctId = spec.distinctIdFrom
				? String(dimensions[spec.distinctIdFrom])
				: spec.event;

			/** @type {Record<string, any>} */
			const record = {
				event: spec.event,
				time: isoTime,
				insert_id: randomUUID(),
				distinct_id: distinctId,
				...dimensions,
			};

			// The context handed to every property function. Shares the
			// ValueContext members (`time`, `config`) so a function written for
			// a normal event property still works here, plus the standalone-only
			// members a snapshot needs to shape a trend.
			const valueContext = {
				time: tickUnix * 1000,
				config,
				dimensions,
				tickIndex,
				tickCount: ticks.length,
				cadence: spec.cadence,
				event: record,
			};

			for (const key of propKeys) {
				record[key] = u.choose(spec.properties[key], valueContext);
			}

			records.push(record);
		}
	}

	return records;
}

/**
 * Validates and normalizes the `standaloneEvents` config array.
 * Throws on anything malformed — a silent skip would hide a whole data stream.
 *
 * @param {unknown} standaloneEvents
 * @returns {ResolvedStandaloneEventConfig[]}
 */
export function validateStandaloneEvents(standaloneEvents) {
	if (standaloneEvents === undefined || standaloneEvents === null) return [];
	if (!Array.isArray(standaloneEvents)) {
		throw new Error("standaloneEvents must be an array");
	}

	const seen = new Set();

	return standaloneEvents.map((spec, index) => {
		const label = `standaloneEvents[${index}]`;

		if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
			throw new Error(`${label} must be an object`);
		}
		if (typeof spec.event !== "string" || !spec.event.trim()) {
			throw new Error(`${label}.event must be a non-empty string`);
		}
		if (seen.has(spec.event)) {
			throw new Error(`${label}.event "${spec.event}" is declared more than once`);
		}
		seen.add(spec.event);

		const cadence = spec.cadence || "day";
		if (!CADENCE_SECONDS[cadence]) {
			throw new Error(
				`${label}.cadence must be one of ${VALID_CADENCES.join(", ")} (got "${cadence}")`
			);
		}

		/** @type {Record<string, any[]>} */
		const dimensions = {};
		if (spec.dimensions !== undefined && spec.dimensions !== null) {
			if (typeof spec.dimensions !== "object" || Array.isArray(spec.dimensions)) {
				throw new Error(`${label}.dimensions must be an object of arrays`);
			}
			for (const [key, values] of Object.entries(spec.dimensions)) {
				if (!Array.isArray(values) || values.length === 0) {
					throw new Error(`${label}.dimensions.${key} must be a non-empty array`);
				}
				dimensions[key] = values;
			}
		}

		if (spec.distinctIdFrom !== undefined && spec.distinctIdFrom !== null) {
			if (typeof spec.distinctIdFrom !== "string") {
				throw new Error(`${label}.distinctIdFrom must be a string`);
			}
			if (!(spec.distinctIdFrom in dimensions)) {
				throw new Error(
					`${label}.distinctIdFrom "${spec.distinctIdFrom}" is not a declared dimension`
				);
			}
		}

		if (spec.properties !== undefined && spec.properties !== null) {
			if (typeof spec.properties !== "object" || Array.isArray(spec.properties)) {
				throw new Error(`${label}.properties must be an object`);
			}
		}

		// Schema-first: a property key must not collide with a dimension key or
		// with a reserved record key. A collision would silently overwrite one
		// of them and the author would never see it.
		const properties = spec.properties || {};
		const reserved = new Set(["event", "time", "insert_id", "distinct_id", "user_id", "device_id"]);
		for (const key of Object.keys(properties)) {
			if (reserved.has(key)) {
				throw new Error(`${label}.properties.${key} collides with a reserved record key`);
			}
			if (key in dimensions) {
				throw new Error(`${label}.properties.${key} collides with a dimension of the same name`);
			}
		}

		return {
			event: spec.event,
			cadence,
			dimensions,
			distinctIdFrom: spec.distinctIdFrom || null,
			properties,
		};
	});
}
