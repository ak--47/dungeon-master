/**
 * v1.5.1: retention-curve weight interpolation.
 *
 * A `retentionCurve` config knob defines a target retention shape via anchor
 * points (e.g. `day1: 0.40, day7: 0.20, day30: 0.08`). This module turns those
 * anchors into a function `(dayOffset) → weight` used by `buildActiveDayPlan`
 * in `lib/orchestrators/user-loop.js` to bias active-day selection.
 *
 * Interpolation modes:
 *   - 'logarithmic' (default) — log-linear between anchors. Matches typical
 *     real-world retention decay (large drop early, gentle tail).
 *   - 'linear' — straight-line interpolation. Simpler shape; rarely matches
 *     real data but useful for testing.
 *
 * Anchor semantics:
 *   - dayN keys (`day1`, `day7`, `day30`, etc.) → user's relative fraction
 *     active on day N from their birth. Values in [0, 1].
 *   - Day 0 (birth day) is implicitly 1.0 (every user is active on their birth
 *     day — that's when their first event fires). Not a configurable anchor.
 *   - Days beyond the largest anchor extrapolate from the last segment's slope.
 *
 * The curve is NOT normalized into a probability distribution — values
 * directly weight the day-selection sampler. A user with curve sum ≈ 5 will
 * average ~5 active days regardless of the dataset window size.
 *
 * Mixpanel parity note: this models the GENERATOR side. The
 * `emulateBreakdown({ type: 'retention' })` verifier measures per-event
 * retention using Mixpanel's bucketing rule (return_ms - birth_ms / DAY_MS).
 * Generator controls DAYS active; verifier reads EVENTS. Round-trip
 * verification (test-retention-curve.test.js) shows the per-day curve drives
 * the per-event retention shape to within ±5%.
 */

/**
 * @typedef {Object} RetentionCurveConfig
 * @property {('logarithmic'|'linear')} [type='logarithmic']
 * @property {number} [day1]
 * @property {number} [day3]
 * @property {number} [day7]
 * @property {number} [day14]
 * @property {number} [day30]
 * @property {number} [day60]
 * @property {number} [day90]
 */

/**
 * Extract `dayN` anchors from a curve config, sorted by N ascending.
 * Always includes (0, 1.0) — the birth-day anchor.
 *
 * @param {RetentionCurveConfig} curve
 * @returns {Array<{ day: number, weight: number }>}
 */
export function extractAnchors(curve) {
	if (!curve || typeof curve !== 'object') return [{ day: 0, weight: 1 }];
	const anchors = [{ day: 0, weight: 1 }];
	for (const key of Object.keys(curve)) {
		const m = /^day(\d+)$/.exec(key);
		if (!m) continue;
		const day = Number(m[1]);
		const weight = Number(curve[key]);
		if (!Number.isFinite(day) || day < 1) continue;
		if (!Number.isFinite(weight) || weight < 0) continue;
		anchors.push({ day, weight });
	}
	anchors.sort((a, b) => a.day - b.day);
	return anchors;
}

/**
 * Build a weight function `(dayOffset) → weight` from a curve config. Defaults
 * to logarithmic interpolation; pass `type: 'linear'` for straight-line.
 *
 * @param {RetentionCurveConfig} curve
 * @returns {(dayOffset: number) => number}
 */
export function buildCurveWeightFn(curve) {
	const anchors = extractAnchors(curve);
	const mode = (curve && curve.type === 'linear') ? 'linear' : 'logarithmic';

	if (anchors.length === 1) {
		// Only day-0 anchor — return constant 1.0 (effectively legacy uniform).
		return () => 1;
	}

	return function weightForDay(dayOffset) {
		if (!Number.isFinite(dayOffset) || dayOffset < 0) return 0;
		if (dayOffset <= anchors[0].day) return anchors[0].weight;
		if (dayOffset >= anchors[anchors.length - 1].day) {
			// Extrapolate from the last segment.
			if (anchors.length === 1) return anchors[0].weight;
			const last = anchors[anchors.length - 1];
			const prev = anchors[anchors.length - 2];
			return Math.max(0, interpolate(prev, last, dayOffset, mode));
		}
		// Find the bracketing anchors and interpolate.
		for (let i = 0; i < anchors.length - 1; i++) {
			if (dayOffset >= anchors[i].day && dayOffset <= anchors[i + 1].day) {
				return interpolate(anchors[i], anchors[i + 1], dayOffset, mode);
			}
		}
		return 0;
	};
}

/**
 * Log-linear or linear interpolation between two anchors `a` and `b`.
 *
 * @param {{ day: number, weight: number }} a
 * @param {{ day: number, weight: number }} b
 * @param {number} x
 * @param {'logarithmic'|'linear'} mode
 * @returns {number}
 */
function interpolate(a, b, x, mode) {
	if (a.day === b.day) return (a.weight + b.weight) / 2;
	if (mode === 'logarithmic' && a.weight > 0 && b.weight > 0 && a.day > 0 && b.day > 0 && x > 0) {
		// y = y_a * (y_b / y_a) ^ ((log(x) - log(x_a)) / (log(x_b) - log(x_a)))
		const t = (Math.log(x) - Math.log(a.day)) / (Math.log(b.day) - Math.log(a.day));
		return a.weight * Math.pow(b.weight / a.weight, t);
	}
	// Linear fallback (or when log doesn't apply because day=0 / weight=0).
	const t = (x - a.day) / (b.day - a.day);
	return a.weight + t * (b.weight - a.weight);
}

/**
 * Convenience: derive the expected active-day count from a curve over a span
 * of `maxDayOffset` days. Sum of weights across days [0, maxDayOffset].
 *
 * @param {RetentionCurveConfig} curve
 * @param {number} maxDayOffset - Number of days to sum over (exclusive upper).
 * @returns {number}
 */
export function expectedActiveDays(curve, maxDayOffset) {
	const fn = buildCurveWeightFn(curve);
	let sum = 0;
	const span = Math.max(0, Math.floor(maxDayOffset));
	for (let d = 0; d < span; d++) sum += fn(d);
	return sum;
}
