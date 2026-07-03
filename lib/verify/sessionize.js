/**
 * Query-time sessionization — Mixpanel's session pre-pass, re-derived.
 *
 * Mixpanel sessions are computed at QUERY time from raw event timestamps and
 * emitted as synthetic $session_start/$session_end events; they are never
 * stored (backend/arb/reader/queries/session_query.cpp; sessions.go). The
 * verifier re-derives them the same way rather than trusting any
 * generator-stamped `session_id`.
 *
 * ARB rules implemented (all from session_query.cpp, TIMEOUT trigger mode):
 *   - Three split triggers (the timeout branch of
 *     session_query_params_process_event):
 *       1. gap:  time_ms − last_event_time_ms  >  session_timeout_ms (strict >)
 *       2. max:  time_ms  >  first_event_time_ms + session_max_time_ms
 *          (strict >, anchored to the session's FIRST event)
 *       3. UTC day-index change: floor(ms / DAY) differs from the previous
 *          event's ("an index to uniquely identify each day. this is used to
 *          ensure sessions terminate per day"). We are UTC-everywhere; the
 *          project-timezone projection (time_project_ms_to_query_ms) is the
 *          qtz seam — findings #10, deferred.
 *     A trigger disabled by 0/undefined follows ARB's `> 0` guards; the day
 *     trigger is unconditional. NOTE: with the day trigger active,
 *     maxSessionMs only ever fires when configured BELOW 24h — any ≥24h span
 *     crosses a UTC midnight first.
 *   - On split AND at end-of-scan, the session end is stamped at the
 *     PREVIOUS/LAST event's timestamp (sortable_event_create_session_end is
 *     called with event_order_state.time_ms = u->last_event_time_ms; see
 *     also finalize_sessions) — $duration_s never includes the idle tail.
 *   - $duration_s = integer division (last_ms − first_ms) / 1000
 *     (uint32_t duration_s in sortable_event_create_session_end).
 *   - $event_count = inclusive raw event count (u->event_count++ per event;
 *     reset to 0 by sortable_event_create_session_start).
 *   - $origin_start / $origin_end = first / last event names; all four
 *     computed props are stamped on BOTH the start and end synthetic events
 *     (the `is_computed_props_set` back-fill block).
 *   - Copy props are FIRST-wins across the session (copy_to_property_set_copy
 *     skips slots already set in the filled_properties bitset; undefined
 *     values never fill) over DEFAULT_COPY_PROPERTIES
 *     (api/version_2_0/segmentation/models.py:78-97), stamped on both
 *     synthetic events.
 *   - Namespace rule: synthetic session events are EVENT_TYPE_SESSION — a
 *     separate selector namespace from regular events
 *     (libquery/event/filter.h event_type enum). Name filters and
 *     "all events" never match them, so they are returned in a SEPARATE
 *     array; callers opt in explicitly.
 *   - Sort tiebreak at equal ms: session start < regular event < session end
 *     (canonical_event_sort_comparer_lazy, libquery/event/event.c).
 */

import { resolveUserId } from './identity.js';
import { toMs } from '../hook-helpers/_internal.js';

const DAY_MS = 86400 * 1000;

/**
 * The default session copy-property list —
 * api/version_2_0/segmentation/models.py:78-97 DEFAULT_COPY_PROPERTIES.
 * First non-undefined value per property across the session wins.
 */
export const SESSION_COPY_PROPERTIES = [
	'$app_build_number',
	'$app_version_string',
	'$browser',
	'$city',
	'$country_code',
	'$current_url',
	'$device',
	'$manufacturer',
	'$os',
	'$region',
	'mp_country_code',
	'mp_lib',
	'mp_platform',
	'utm_campaign',
	'utm_content',
	'utm_source',
	'$referring_domain',
	'utm_medium',
];

/**
 * @typedef {Object} Session
 * @property {string} userId       Resolved canonical user id.
 * @property {number} startMs      First event's timestamp (ms).
 * @property {number} endMs        LAST event's timestamp (ms) — never the idle tail.
 * @property {number} duration_s   floor((endMs − startMs) / 1000).
 * @property {number} event_count  Inclusive raw event count.
 * @property {string} origin_start First event's name.
 * @property {string} origin_end   Last event's name.
 * @property {Object} copyProps    First-wins values over SESSION_COPY_PROPERTIES.
 * @property {Array<Object>} events The raw event objects, time-ordered.
 */

/**
 * Derive sessions from raw events the way Mixpanel's session query does.
 *
 * @param {Array<Object>} events
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=1800000]      Gap trigger, strict `>`. Falsy disables (ARB `> 0` guard).
 * @param {number} [options.maxSessionMs=86400000]  Max-length trigger from the session's FIRST event, strict `>`. Falsy disables.
 * @param {Map<string,string>} [options.identityMap] device_id → canonical id (see buildIdentityMap).
 * @returns {{ sessions: Array<Session>, syntheticEvents: Array<Object> }}
 *   `syntheticEvents` is separate on purpose — synthetic session events live
 *   outside the regular event-name namespace (libquery/event/filter.h).
 */
export function sessionize(events, { timeoutMs = 30 * 60_000, maxSessionMs = 24 * 3_600_000, identityMap } = {}) {
	if (!Array.isArray(events)) throw new Error('sessionize: events must be an array');

	// Group per resolved user, dropping events with no resolvable id
	// (empty-uid events are skipped by ARB's user-state container).
	const byUser = new Map();
	for (const e of events) {
		if (!e) continue;
		const uid = resolveUserId(e, identityMap);
		if (!uid) continue;
		const ms = toMs(e.time);
		if (!Number.isFinite(ms)) continue;
		if (!byUser.has(uid)) byUser.set(uid, []);
		byUser.get(uid).push({ e, ms });
	}

	/** @type {Array<Session>} */
	const sessions = [];

	for (const [uid, list] of byUser) {
		list.sort((a, b) => a.ms - b.ms);

		/** @type {Session | null} */
		let cur = null;

		const open = ({ e, ms }) => {
			cur = {
				userId: uid,
				startMs: ms,
				endMs: ms,
				duration_s: 0,
				event_count: 0,
				origin_start: e.event,
				origin_end: e.event,
				copyProps: {},
				events: [],
			};
		};
		const absorb = ({ e, ms }) => {
			cur.endMs = ms;
			cur.origin_end = e.event;
			cur.event_count += 1;
			cur.events.push(e);
			// First-wins copy props (copy_to_property_set_copy — filled slots
			// are skipped; undefined never fills).
			for (const p of SESSION_COPY_PROPERTIES) {
				if (p in cur.copyProps) continue;
				const v = e[p];
				if (v !== undefined && v !== null) cur.copyProps[p] = v;
			}
		};
		const close = () => {
			// End stamped at the LAST event's timestamp — never the idle tail.
			cur.duration_s = Math.floor((cur.endMs - cur.startMs) / 1000);
			sessions.push(cur);
			cur = null;
		};

		for (const item of list) {
			if (!cur) {
				open(item);
			} else {
				const gapSplit = !!timeoutMs && (item.ms - cur.endMs > timeoutMs);
				const maxSplit = !!maxSessionMs && (item.ms > cur.startMs + maxSessionMs);
				const daySplit = Math.floor(item.ms / DAY_MS) !== Math.floor(cur.endMs / DAY_MS);
				if (gapSplit || maxSplit || daySplit) {
					close();
					open(item);
				}
			}
			absorb(item);
		}
		if (cur) close();
	}

	// Deterministic global order: by start time, then user id.
	sessions.sort((a, b) => a.startMs - b.startMs || String(a.userId).localeCompare(String(b.userId)));

	// Synthetic $session_start/$session_end pairs. All four computed props +
	// copy props are stamped on BOTH events (the is_computed_props_set
	// back-fill in sortable_event_create_session_end).
	const syntheticEvents = [];
	for (const s of sessions) {
		const shared = {
			$duration_s: s.duration_s,
			$event_count: s.event_count,
			$origin_start: s.origin_start,
			$origin_end: s.origin_end,
			...s.copyProps,
		};
		syntheticEvents.push({
			event: '$session_start',
			time: new Date(s.startMs).toISOString(),
			user_id: s.userId,
			...shared,
		});
		syntheticEvents.push({
			event: '$session_end',
			time: new Date(s.endMs).toISOString(),
			user_id: s.userId,
			...shared,
		});
	}
	// Canonical tiebreak at equal ms: start < end
	// (canonical_event_sort_comparer_lazy).
	syntheticEvents.sort((a, b) =>
		toMs(a.time) - toMs(b.time)
		|| (a.event === b.event ? 0 : a.event === '$session_start' ? -1 : 1));

	return { sessions, syntheticEvents };
}
