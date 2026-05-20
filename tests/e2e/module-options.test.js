// @ts-nocheck
/* eslint-disable no-undef */
import generate from '../../index.js';
import simplest from '../../dungeons/technical/simplest.js';

const timeout = 60000;

// Date pinning for determinism — without these, FIXED_NOW anchors to today
// and shifts across runs. Required for byte-equal repeatability.
const PINNED_DATES = { datasetStart: '2025-09-01T00:00:00Z', datasetEnd: '2025-10-01T00:00:00Z' };

function validateEvent(event) {
	if (!event.event) return false;
	if (!event.device_id && !event.user_id) return false;
	if (!event.time) return false;
	if (!event.insert_id) return false;
	return true;
}

function validateUser(user) {
	if (!user.distinct_id) return false;
	if (!user.name) return false;
	if (!user.email) return false;
	return true;
}

function validTime(str) {
	if (!str) return false;
	if (str.startsWith('-')) return false;
	if (!str.startsWith('20')) return false;
	return true;
}

describe.sequential('validation + identity', () => {

	test('creates anonymousIds', async () => {
		// v1.5.1: pin `percentUsersBornInDataset: 0` so every user is pre-existing
		// and `userAuthed` starts true (Phase 2 identity model). Without this,
		// born-in-dataset users without an `isAuthEvent` step stay anonymous and
		// their standalone events are device-only — breaking the user_id assertion.
		const results = await generate({ ...PINNED_DATES, writeToDisk: false, numEvents: 1000, numUsers: 100, hasAnonIds: true, percentUsersBornInDataset: 0 });
		const { eventData } = results;
		expect(eventData.map(a => a.device_id).filter(a => a).length).toBe(eventData.length);
		expect(eventData.map(a => a.user_id).filter(a => a).length).toBe(eventData.length);
	}, timeout);

	test('no anonymousIds', async () => {
		const results = await generate({ ...PINNED_DATES, writeToDisk: false, numEvents: 1000, numUsers: 100, hasAnonIds: false });
		const { eventData } = results;
		expect(eventData.map(a => a.device_id).filter(a => a).length).toBe(0);
	}, timeout);

	test('every record is valid', async () => {
		const results = await generate({ ...PINNED_DATES, verbose: false, writeToDisk: false, numEvents: 1000, numUsers: 100 });
		const { eventData, userProfilesData } = results;
		expect(eventData.every(validateEvent)).toBe(true);
		expect(userProfilesData.every(validateUser)).toBe(true);
	}, timeout);

	test('every date is valid', async () => {
		const results = await generate({ ...PINNED_DATES, ...simplest, writeToDisk: false, verbose: false, numEvents: 1000, numUsers: 100, token: "" });
		const { eventData } = results;
		expect(eventData.every(e => validTime(e.time))).toBe(true);
	}, timeout);

	test('no avatars (default)', async () => {
		const results = await generate({ ...PINNED_DATES, ...simplest, writeToDisk: false, verbose: false, numEvents: 1000, numUsers: 100, token: "" });
		const { userProfilesData } = results;
		expect(userProfilesData.every(u => !u.avatar)).toBe(true);
	}, timeout);

	test('yes avatars', async () => {
		const results = await generate({ ...PINNED_DATES, ...simplest, writeToDisk: false, verbose: false, numEvents: 1000, numUsers: 100, hasAvatar: true, token: "" });
		const { userProfilesData } = results;
		expect(userProfilesData.every(u => u.avatar)).toBe(true);
	}, timeout);

});
