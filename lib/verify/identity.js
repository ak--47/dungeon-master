/**
 * Identity resolution for verifier. Automatic links come from emitted
 * both-ID events; profile pools are only an explicit caller override.
 *
 * Reference: analytics identity-manager v3 lookup_and_update_handler.go
 * and identity/device_and_user_records.go at 717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a.
 */

const emittedIdentityMap = Symbol('emittedIdentityMap');

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
 * Build automatic device-to-user links from the full emitted stream.
 * Event names do not gate linking. The first valid pair for a device wins;
 * v3 does not reassign an already-linked device to a conflicting user.
 * User IDs with the reserved $device: prefix cannot establish a link.
 *
 * @param {Array<Object>} events
 * @returns {Map<string, string>}
 */
export function buildEventIdentityMap(events) {
	const map = new Map();
	Object.defineProperty(map, emittedIdentityMap, { value: true });
	if (!Array.isArray(events)) return map;
	for (const event of events) {
		const deviceId = event?.device_id;
		const userId = event?.user_id;
		if (typeof deviceId !== 'string' || !deviceId.trim()
			|| typeof userId !== 'string' || !userId.trim()
			|| userId.startsWith('$device:') || map.has(deviceId)) continue;
		map.set(deviceId, userId);
	}
	return map;
}

/**
 * Resolve the canonical user id for an event. Lookup order:
 *   1. `event.distinct_id` — Mixpanel's canonical post-merge identifier. When
 *      a downstream pipeline has already stitched the cluster, this is the
 *      ground truth; never override it.
 *   2. `identityMap.get(event.device_id)` — emitted link or explicit override.
 *   3. `event.user_id` — already authed (pre-merge analog of distinct_id).
 *   4. `event.device_id` — anonymous fallback.
 *
 * Returns `undefined` if none of the above produces a value.
 *
 * Reference: Mixpanel identity-manager treats `distinct_id` as the canonical
 * cluster-anchor id (`go/.../v3/lookup_and_update_handler.go`). Verifier must
 * not demote a stitched id to the merge map's output.
 *
 * **Note:** the v1.5 generator does NOT stamp `distinct_id` on raw events —
 * it stamps `user_id` and/or `device_id`. The `event.distinct_id` short-circuit
 * exists for external callers feeding in already-stitched data. If you see
 * this branch firing on output from this generator, identity has been
 * corrupted upstream (a hook stamped `distinct_id` on event records, or
 * something carried it over from a profile clone).
 *
 * @param {Object} event
 * @param {Map<string, string>} [identityMap]
 * @returns {string|undefined}
 */
export function resolveUserId(event, identityMap) {
	if (!event) return undefined;
	if (event.distinct_id) return event.distinct_id;
	if (event.user_id && identityMap && Object.getOwnPropertyDescriptor(identityMap, emittedIdentityMap)) return event.user_id;
	if (identityMap && event.device_id) {
		const merged = identityMap.get(event.device_id);
		if (merged) return merged;
	}
	return event.user_id || event.device_id || undefined;
}
