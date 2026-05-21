// @ts-nocheck
/* eslint-disable no-undef */
import generate from '../../index.js';

const timeout = 60000;

// Date pinning for determinism — without these, FIXED_NOW anchors to today
// and shifts across runs. Required for byte-equal repeatability.
const PINNED_DATES = { datasetStart: '2025-09-01T00:00:00Z', datasetEnd: '2025-10-01T00:00:00Z' };

describe.sequential('sessions', () => {

	test('creates sessionIds', async () => {
		const results = await generate({ ...PINNED_DATES, writeToDisk: false, numEvents: 1000, numUsers: 100, switches: { hasSessionIds: true } });
		const { eventData } = results;
		const sessionIds = eventData.map(a => a.session_id).filter(a => a);
		expect(sessionIds.length).toBe(eventData.length);
	}, timeout);

	test('no hasSessionIds', async () => {
		const results = await generate({ ...PINNED_DATES, writeToDisk: false, numEvents: 1000, numUsers: 100, switches: { hasSessionIds: false } });
		const { eventData } = results;
		const noSessionIds = eventData.map(a => a.session_id).filter(a => a);
		expect(noSessionIds.length).toBe(0);
	}, timeout);

	test('session IDs cluster temporally', async () => {
		const results = await generate({ ...PINNED_DATES,
			writeToDisk: false, numEvents: 5000, numUsers: 50,
			switches: { hasSessionIds: true }, numDays: 30, seed: 'session-cluster'
		});
		const { eventData } = results;

		const withSessionId = eventData.filter(e => e.session_id);
		expect(withSessionId.length).toBe(eventData.length);

		const userEvents = {};
		for (const ev of eventData) {
			const uid = ev.user_id || ev.device_id;
			if (!uid) continue;
			if (!userEvents[uid]) userEvents[uid] = [];
			userEvents[uid].push(ev);
		}

		let totalSessions = 0;
		let sessionsWithMultipleEvents = 0;

		for (const uid in userEvents) {
			const events = userEvents[uid].sort((a, b) => a.time < b.time ? -1 : 1);
			const sessions = {};
			for (const ev of events) {
				if (!sessions[ev.session_id]) sessions[ev.session_id] = [];
				sessions[ev.session_id].push(ev);
			}

			for (const [sid, sessionEvents] of Object.entries(sessions)) {
				totalSessions++;
				if (sessionEvents.length > 1) sessionsWithMultipleEvents++;

				for (let i = 1; i < sessionEvents.length; i++) {
					const gap = new Date(sessionEvents[i].time) - new Date(sessionEvents[i - 1].time);
					expect(gap).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
				}
			}
		}

		expect(sessionsWithMultipleEvents).toBeGreaterThan(0);
		expect(totalSessions).toBeGreaterThan(0);
	}, timeout);

	test('respects custom sessionTimeout', async () => {
		const results5 = await generate({ ...PINNED_DATES,
			writeToDisk: false, numEvents: 2000, numUsers: 20,
			switches: { hasSessionIds: true }, identity: { sessionTimeout: 5 }, numDays: 30, seed: 'session-timeout'
		});
		const sessions5 = new Set(results5.eventData.map(e => e.session_id));

		const results30 = await generate({ ...PINNED_DATES,
			writeToDisk: false, numEvents: 2000, numUsers: 20,
			switches: { hasSessionIds: true }, identity: { sessionTimeout: 30 }, numDays: 30, seed: 'session-timeout'
		});
		const sessions30 = new Set(results30.eventData.map(e => e.session_id));

		expect(sessions5.size).toBeGreaterThan(sessions30.size);
	}, timeout);

});
