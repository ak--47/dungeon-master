/**
 * Hook helpers — identity atoms.
 *
 * Wraps the Phase 2 identity primitives so hook authors can re-derive pre-auth /
 * post-auth / stitch info without having to grovel inside `meta`. The `everything`
 * hook already exposes `meta.authTime` and `meta.isPreAuth(event)`; these helpers
 * cover callers that operate on stored events outside that hook.
 */

/**
 * Returns true if the event happened strictly before the user's stitch event.
 * - `authTime === null | undefined` is interpreted as "user never authed" → every
 *   event is pre-auth (matches the `everything` hook's behavior for born-in-dataset
 *   users that never converted).
 * - Pre-existing users (already authed before the dataset window) won't have
 *   `authTime` populated by the engine; callers wanting "always false" semantics
 *   should pass `0` or `-Infinity`.
 *
 * @param {{time: string|number}} event
 * @param {number|null|undefined} authTime - Unix milliseconds.
 * @returns {boolean}
 */
export function isPreAuthEvent(event, authTime) {
	if (!event || event.time === undefined || event.time === null) return false;
	if (authTime === null || authTime === undefined) return true;
	const t = typeof event.time === 'number'
		? (event.time > 1e12 ? event.time : event.time * 1000)
		: Date.parse(event.time);
	return Number.isFinite(t) ? t < authTime : false;
}

/**
 * Partition `events` into pre-auth / post-auth / stitch buckets relative to
 * `authTime`. The stitch is the first post-auth event whose record carries BOTH
 * `user_id` and `device_id` (the engine stamps this exactly once per converted
 * born-in-dataset user). When no such event exists, `stitch` is `null`.
 *
 * @param {Array<{event:string,time:string|number,user_id?:string,device_id?:string}>} events
 * @param {number|null|undefined} authTime - Unix milliseconds.
 * @returns {{ preAuth: Object[], postAuth: Object[], stitch: Object|null }}
 */
export function splitByAuth(events, authTime) {
	const result = { preAuth: [], postAuth: [], stitch: null };
	if (!events) return result;
	for (const ev of events) {
		if (isPreAuthEvent(ev, authTime)) {
			result.preAuth.push(ev);
		} else {
			result.postAuth.push(ev);
			if (!result.stitch && ev && ev.user_id && ev.device_id) {
				result.stitch = ev;
			}
		}
	}
	return result;
}
