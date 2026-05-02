/**
 * Hook helpers — timing atoms.
 *
 * Adjust gaps between specific events (or the whole funnel TTC) and detect ordered
 * sequences within a maximum gap. All times are normalized to unix milliseconds
 * internally; ISO strings are written back when the source was a string.
 */

/**
 * Find the FIRST `eventA` in time order, then the FIRST `eventB` after it, then
 * scale the time gap between them by `factor`. The B event is mutated to the new
 * timestamp (the A event is unchanged). Returns true on success, false if either
 * anchor is missing.
 *
 * @param {Array<{event:string,time:string|number}>} events
 * @param {string} eventA
 * @param {string} eventB
 * @param {number} factor - 0.5 halves the gap, 2.0 doubles it.
 * @returns {boolean}
 */
export function scaleTimingBetween(events, eventA, eventB, factor) {
	if (!events || !eventA || !eventB || typeof factor !== 'number') return false;
	const sorted = events.slice().sort((x, y) => toMs(x && x.time) - toMs(y && y.time));
	const aIdx = sorted.findIndex(e => e && e.event === eventA);
	if (aIdx < 0) return false;
	const tail = sorted.slice(aIdx + 1);
	const b = tail.find(e => e && e.event === eventB);
	if (!b) return false;
	const a = sorted[aIdx];
	const aT = toMs(a.time);
	const bT = toMs(b.time);
	if (!Number.isFinite(aT) || !Number.isFinite(bT)) return false;
	const newBT = aT + (bT - aT) * factor;
	writeTime(b, newBT);
	return true;
}

/**
 * Scale the time-to-convert (TTC) of an entire funnel. Each event's offset from
 * the funnel's first event is multiplied by `factor`. Mutates events in place.
 *
 * @param {Array<{event:string,time:string|number}>} funnelEvents
 * @param {number} factor
 * @returns {number} Count of events shifted (excludes the anchor).
 */
export function scaleFunnelTTC(funnelEvents, factor) {
	if (!funnelEvents || !funnelEvents.length || typeof factor !== 'number') return 0;
	const sorted = funnelEvents.slice().sort((x, y) => toMs(x && x.time) - toMs(y && y.time));
	const baseT = toMs(sorted[0].time);
	if (!Number.isFinite(baseT)) return 0;
	let n = 0;
	for (const ev of funnelEvents) {
		if (ev === sorted[0]) continue;
		const t = toMs(ev.time);
		if (!Number.isFinite(t)) continue;
		writeTime(ev, baseT + (t - baseT) * factor);
		n++;
	}
	return n;
}

/**
 * Detect the FIRST occurrence of an ordered sequence of event names within a
 * maximum gap. Returns the matching events (in order) or `null` if no run satisfies
 * the constraint. The gap is checked between *consecutive matched* events, not
 * between any two events in the stream.
 *
 * @param {Array<{event:string,time:string|number}>} events
 * @param {string[]} eventNames - Ordered sequence of event names to match.
 * @param {number} maxGapMin - Maximum allowable gap between consecutive matched events, in minutes.
 * @returns {Array<Object>|null}
 */
export function findFirstSequence(events, eventNames, maxGapMin) {
	if (!events || !eventNames || !eventNames.length || typeof maxGapMin !== 'number') return null;
	const sorted = events.slice().sort((x, y) => toMs(x && x.time) - toMs(y && y.time));
	const maxGapMs = maxGapMin * 60 * 1000;
	for (let i = 0; i < sorted.length; i++) {
		const head = sorted[i];
		if (!head || head.event !== eventNames[0]) continue;
		const matched = [head];
		let lastT = toMs(head.time);
		let stepIdx = 1;
		for (let j = i + 1; j < sorted.length && stepIdx < eventNames.length; j++) {
			const cur = sorted[j];
			if (!cur || cur.time === undefined) continue;
			const t = toMs(cur.time);
			if (!Number.isFinite(t) || t - lastT > maxGapMs) break;
			if (cur.event === eventNames[stepIdx]) {
				matched.push(cur);
				lastT = t;
				stepIdx++;
			}
		}
		if (matched.length === eventNames.length) return matched;
	}
	return null;
}

// ── internal helpers ──

function toMs(t) {
	if (typeof t === 'number') return t > 1e12 ? t : t > 1e9 ? t * 1000 : t;
	return Date.parse(t);
}

function writeTime(event, ms) {
	if (typeof event.time === 'string') {
		event.time = new Date(ms).toISOString();
	} else {
		// Preserve original numeric scale (seconds vs ms).
		if (event.time > 1e12) event.time = ms;
		else event.time = ms / 1000;
	}
}
