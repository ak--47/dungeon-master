export function toMs(t) {
	if (typeof t === 'number') return t > 1e12 ? t : t > 1e9 ? t * 1000 : t;
	return Date.parse(t);
}

export function writeTime(event, ms) {
	if (typeof event.time === 'string' || event.time === undefined) {
		event.time = new Date(ms).toISOString();
	} else if (event.time > 1e12) {
		event.time = ms;
	} else {
		event.time = ms / 1000;
	}
}

export function simpleHashFloat(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return ((h >>> 0) % 1000) / 1000;
}
