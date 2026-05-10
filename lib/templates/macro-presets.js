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

/**
 * Tuned tail_ratio targets (foobar 89-day, post-engine-bunchiness fix):
 *
 *   flat:    ~1.1  (≈ 1.0 baseline + small cumulative-acquisition uptick)
 *   steady:  ~1.1  (slightly higher uptick from 0.1 bias)
 *   growth:  ~1.4  (clear visible uptrend)
 *   viral:   ~2.2  (hockey stick — clearly distinguishable)
 *   decline: ~1.0  (flat — pure-dungeon limitation, see decline JSDoc)
 *
 * All five remain DIRECTIONALLY distinguishable on aggregate event count over
 * time. Magnitude diverges from `research/end-bunchiness.md` v1.3 targets
 * (which were measured pre-engine-bunchiness-fix); the new targets are what's
 * achievable with the v1.5 engine fix's per-cluster trapezoidal shape.
 */

/** @type {Record<string, {bornRecentBias: number, percentUsersBornInDataset: number, preExistingSpread: 'pinned'|'uniform'}>} */
export const MACRO_PRESETS = {
	/**
	 * flat (DEFAULT) — Mature product, no growth narrative.
	 * Foobar tail_ratio ≈ 1.1 (very slight uptrend from 12% acquisition).
	 * Pure weekly oscillation dominates the visual.
	 */
	flat: {
		bornRecentBias: 0,
		percentUsersBornInDataset: 12,
		preExistingSpread: 'uniform',
	},

	/**
	 * steady — Lightly-growing SaaS.
	 * Foobar tail_ratio ≈ 1.1. Slight uptrend without any visible spike.
	 * Effectively similar to "flat" on a flat dungeon — the slight bornRecentBias
	 * shows up more clearly when paired with hooks that magnify late-cohort
	 * activity (e.g., engagement decay scoped to early users).
	 */
	steady: {
		bornRecentBias: 0.1,
		percentUsersBornInDataset: 12,
		preExistingSpread: 'uniform',
	},

	/**
	 * growth — Visible uptrend story without the meteoric blow-up.
	 * Foobar tail_ratio ≈ 1.4. Clearly distinguishable from flat/steady.
	 * Use when the dataset wants to show clear acquisition over time.
	 */
	growth: {
		bornRecentBias: 0.3,
		percentUsersBornInDataset: 30,
		preExistingSpread: 'pinned',
	},

	/**
	 * viral — Hockey-stick acquisition.
	 * Foobar tail_ratio ≈ 2.2. Strong late-window ramp.
	 * Pair with persona/feature hooks for the full effect.
	 */
	viral: {
		bornRecentBias: 0.6,
		percentUsersBornInDataset: 55,
		preExistingSpread: 'pinned',
	},

	/**
	 * decline — Sunsetting product, churning users.
	 * Foobar tail_ratio ≈ 1.0 — **the bornRecentBias mechanism alone CANNOT
	 * produce a downtrend** without a churn mechanism. Born-early users
	 * generate events throughout `[birth, FIXED_NOW]`, so they contribute to
	 * the right edge as much as the left. To get a real visible downtrend,
	 * pair this preset with `engagementDecay` or a hook that drops late
	 * events for early-cohort users (see HOOKS.md). On a pure dungeon
	 * (foobar) this preset is effectively flat with a slight early-cohort
	 * skew. v1.3-era pre-engine-fix verticals (ai-platform/sass/dating)
	 * measured tail_ratio ≈ 0.80 for decline because their hooks include
	 * implicit churn behavior.
	 */
	decline: {
		bornRecentBias: -0.3,
		percentUsersBornInDataset: 5,
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
