/**
 * "First time ever" event filter.
 *
 * In Mixpanel this is a two-query API rewrite, not an engine primitive
 * (`backend/util/behaviors/event_selector.py:59-149`;
 * `backend/util/arb_selector.py` `extract_nth_time_filter` :1874-1936):
 *
 *   1. PRE-filters define the event universe the "first" is picked from —
 *      a per-user `first_event_time` aggregation runs over
 *      (event + pre_filters) (event_selector.py:125-142,
 *      `aggregation_operator: "first_event_time"`).
 *   2. The query is then rewritten to
 *      `properties["$time"] == <first_event_time>` AND'ed with the
 *      POST-filters (event_selector.py:126, :143-145). Post-filters test
 *      only the picked event; if the user's first-ever match fails them,
 *      the user contributes nothing — NOT their first post-matching event
 *      (event_selector.py:59-63: "we want to find the first time a user
 *      viewed an insights report and then if that event happens to be
 *      from a chrome browser").
 *
 *   Filter ORDER in the UI decides pre vs post: filters listed before the
 *   nth-time marker are pre, after are post (arb_selector.py:1935-1936).
 *
 *   Faithful consequence of the rewrite: the second query scans events by
 *   name + timestamp only — pre-filters are NOT re-applied. If two
 *   same-name events share the user's first-event timestamp exactly, BOTH
 *   pass (even one that fails the pre-filter).
 *
 *   "Ever" here = the full dataset. Mixpanel bounds the lookback at ~5
 *   years (`date_range.py:744-781` via `get_first_time_filter_date_range`),
 *   which always covers a generated dungeon's window.
 *
 * This is the `$nth_time_event` machinery that powers Lifecycle's "New"
 * class (see P1.8).
 */

import { toMs } from '../hook-helpers/_internal.js';
import { resolveUserId } from './identity.js';
import { matchesWhere } from './coerce.js';

/**
 * Return the subset of `events` that are each user's FIRST-EVER match of
 * (event + preWhere), post-filtered by `postWhere`. Input order preserved.
 *
 * @param {Object[]} events
 * @param {Object} options
 * @param {string} [options.event] - Event name; omit to match any event name.
 * @param {Object<string, *>} [options.preWhere] - Defines the universe the
 *   first is picked from (`{ prop: value | { op, value } }`, see coerce.js).
 * @param {Object<string, *>} [options.postWhere] - Tests only the picked
 *   event(s).
 * @param {Map<string, string>} [options.identityMap] - device_id → canonical
 *   user id map (see identity.js).
 * @returns {Object[]}
 */
export function filterFirstTimeEver(events, options = {}) {
	if (!Array.isArray(events)) throw new Error('filterFirstTimeEver: events must be an array');
	const { event, preWhere, postWhere, identityMap } = options;

	// Pass 1 — per-user first_event_time over (event + preWhere).
	const firstTimeByUser = new Map(); // uid → ms
	for (const e of events) {
		if (!e || (event && e.event !== event)) continue;
		if (!matchesWhere(e, preWhere)) continue;
		const uid = resolveUserId(e, identityMap);
		if (!uid) continue;
		const ms = toMs(e.time);
		if (!Number.isFinite(ms)) continue;
		const prev = firstTimeByUser.get(uid);
		if (prev === undefined || ms < prev) firstTimeByUser.set(uid, ms);
	}
	if (!firstTimeByUser.size) return [];

	// Pass 2 — the rewritten query: event name + $time == first_event_time
	// + postWhere. preWhere intentionally NOT re-applied (see header).
	const out = [];
	for (const e of events) {
		if (!e || (event && e.event !== event)) continue;
		const uid = resolveUserId(e, identityMap);
		if (!uid) continue;
		const first = firstTimeByUser.get(uid);
		if (first === undefined) continue;
		const ms = toMs(e.time);
		if (ms !== first) continue;
		if (!matchesWhere(e, postWhere)) continue;
		out.push(e);
	}
	return out;
}
