/**
 * Macro preset configurations.
 *
 * Macro presets shape the BIG-PICTURE trend across the dataset window —
 * how user births are distributed in time and what fraction of users are
 * born inside the window vs already existing at its start. These are the
 * knobs that determine whether the chart tilts up, tilts down, or stays flat.
 *
 * Soup presets (lib/templates/soup-presets.js) are the orthogonal axis:
 * they shape intra-week and intra-day rhythm (DOW/HOD weights, peak count,
 * deviation). The two are independent — pick a macro and a soup separately.
 *
 * The default macro is "flat" so a brand-new dungeon produces a steady
 * baseline. Layer hooks on top to inject deliberate trends/spikes.
 *
 * Parameters:
 * - bornRecentBias: -1..1. Negative pushes births toward dataset start,
 *   positive toward the end. Power-function shaped in user-loop.js.
 * - percentUsersBornInDataset: 0..100. Fraction of users created inside the
 *   window. The rest are pre-existing (first event ≈ FIXED_BEGIN).
 * - preExistingSpread: "pinned" (current behavior — pre-existing users start
 *   at FIXED_BEGIN ± 1 day) | "uniform" (sample first event time uniformly
 *   across [FIXED_BEGIN - 30d, FIXED_BEGIN] so they don't all stack at day 0).
 */

/** @type {Record<string, {bornRecentBias: number, percentUsersBornInDataset: number, preExistingSpread: 'pinned'|'uniform'}>} */
export const MACRO_PRESETS = {
	/**
	 * flat (DEFAULT) — Mature product, no growth narrative.
	 * Tail ratio ≈ 1.0. Pure weekly oscillation, no net drift.
	 */
	flat: {
		bornRecentBias: 0,
		percentUsersBornInDataset: 50,
		preExistingSpread: 'uniform',
	},

	/**
	 * steady — Lightly-growing SaaS.
	 * Slight uptrend without any visible spike at the right edge.
	 */
	steady: {
		bornRecentBias: 0.1,
		percentUsersBornInDataset: 35,
		preExistingSpread: 'uniform',
	},

	/**
	 * growth — Visible uptrend story without the meteoric blow-up.
	 * Use when the dataset wants to show clear acquisition over time.
	 */
	growth: {
		bornRecentBias: 0.3,
		percentUsersBornInDataset: 60,
		preExistingSpread: 'pinned',
	},

	/**
	 * viral — Hockey-stick acquisition.
	 * Strong late-window ramp. Pair with persona/feature hooks for the full effect.
	 */
	viral: {
		bornRecentBias: 0.6,
		percentUsersBornInDataset: 95,
		preExistingSpread: 'pinned',
	},

	/**
	 * decline — Sunsetting product, churning users.
	 * Few new users, those that exist are born early. Pair with churn hooks.
	 */
	decline: {
		bornRecentBias: -0.3,
		percentUsersBornInDataset: 25,
		preExistingSpread: 'uniform',
	},
};

/** @type {string[]} */
export const MACRO_PRESET_NAMES = Object.keys(MACRO_PRESETS);

/**
 * Resolve a macro config — accepts string presets, preset+overrides objects, or raw objects.
 * Defaults to "flat" if nothing is provided.
 *
 * @param {string | object | undefined} macro - Macro config from dungeon
 * @returns {{bornRecentBias: number, percentUsersBornInDataset: number, preExistingSpread: 'pinned' | 'uniform'}}
 */
export function resolveMacro(macro) {
	if (!macro) return { ...MACRO_PRESETS.flat };

	if (typeof macro === 'string') {
		const preset = MACRO_PRESETS[macro];
		if (!preset) {
			throw new Error(`Unknown macro preset: "${macro}". Valid presets: ${MACRO_PRESET_NAMES.join(', ')}`);
		}
		return { ...preset };
	}

	if (typeof macro === 'object' && macro.preset) {
		const preset = MACRO_PRESETS[macro.preset];
		if (!preset) {
			throw new Error(`Unknown macro preset: "${macro.preset}". Valid presets: ${MACRO_PRESET_NAMES.join(', ')}`);
		}
		const { preset: _, ...overrides } = macro;
		return { ...preset, ...overrides };
	}

	// Raw object: pass through, filling in flat defaults for missing fields
	return { ...MACRO_PRESETS.flat, ...macro };
}
