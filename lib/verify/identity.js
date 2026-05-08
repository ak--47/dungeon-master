/**
 * Identity resolution for verifier — builds a device→user map from profiles
 * and resolves a canonical user id per event. Mirrors Mixpanel's ID merge
 * semantics: pre-auth events stamped with `device_id` and post-auth events
 * stamped with `user_id` belong to the same canonical identity.
 *
 * Reference: `mixpanel/analytics` — identity merge / profiles `device_ids`
 * inversion. We invert each profile's `device_ids` array into a flat
 * `Map<device_id, canonical_user_id>` so query-time event grouping resolves
 * pre-auth touches alongside post-auth events.
 */

/**
 * Build a `Map<device_id, canonical_user_id>` by inverting each profile's
 * device-pool array. Reads `device_ids` first, falling back to the legacy
 * `anonymousIds` field that user profiles use today (carved out for
 * backwards compat — see `lib/utils/utils.js`'s `generateUser`).
 *
 * Profiles without a pool are skipped. When two profiles claim the same
 * device id, the first profile wins (deterministic by profile order).
 *
 * @param {Array<Object>} profiles
 * @returns {Map<string, string>}
 */
export function buildIdentityMap(profiles) {
	const map = new Map();
	if (!Array.isArray(profiles)) return map;
	for (const p of profiles) {
		if (!p) continue;
		const uid = p.distinct_id || p.user_id;
		if (!uid) continue;
		const devices = Array.isArray(p.device_ids) ? p.device_ids
			: Array.isArray(p.anonymousIds) ? p.anonymousIds
			: null;
		if (!devices || !devices.length) continue;
		for (const d of devices) {
			if (!d || map.has(d)) continue;
			map.set(d, uid);
		}
	}
	return map;
}

/**
 * Resolve the canonical user id for an event. Lookup order:
 *   1. `identityMap.get(event.device_id)` (a device→user merge)
 *   2. `event.user_id`                    (already authed)
 *   3. `event.distinct_id`                (legacy / pre-stitch)
 *   4. `event.device_id`                  (anonymous fallback)
 *
 * Returns `undefined` if none of the above produces a value.
 *
 * @param {Object} event
 * @param {Map<string, string>} [identityMap]
 * @returns {string|undefined}
 */
export function resolveUserId(event, identityMap) {
	if (!event) return undefined;
	if (identityMap && event.device_id) {
		const merged = identityMap.get(event.device_id);
		if (merged) return merged;
	}
	return event.user_id || event.distinct_id || event.device_id || undefined;
}
