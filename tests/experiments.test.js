//@ts-nocheck
/**
 * Experiment API tests: backward compat, custom config, temporal gating,
 * deterministic variant assignment, hook meta exposure.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';
import dayjs from 'dayjs';

const FIXED_NOW = dayjs('2024-02-02').unix();
const baseConfig = (extra) => ({
	datasetStart: FIXED_NOW - 90 * 86400,
	datasetEnd: FIXED_NOW,
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	...extra,
});

describe('Experiment API', () => {
	test('experiment: true backward compat — 3 variants with standard names', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'exp-compat',
			numUsers: 200,
			avgEventsPerUserPerDay: 3,
			percentUsersBornInDataset: 50,
			events: [
				{ event: 'View', isFirstEvent: true, weight: 3 },
				{ event: 'Click', weight: 3 },
				{ event: 'Buy', weight: 2 },
			],
			funnels: [{
				sequence: ['View', 'Click', 'Buy'],
				conversionRate: 60,
				isFirstFunnel: true,
				timeToConvert: 2,
				experiment: true,
				name: 'Purchase Flow',
			}],
		}));
		const events = Array.from(result.eventData);
		const expEvents = events.filter(e => e.event === '$experiment_started');
		expect(expEvents.length).toBeGreaterThan(0);
		const names = new Set(expEvents.map(e => e['Variant name']));
		expect(names.has('Variant A')).toBe(true);
		expect(names.has('Variant B')).toBe(true);
		expect(names.has('Control')).toBe(true);
		expect(expEvents[0]['Experiment name']).toBe('Purchase Flow Experiment');
	}, 30000);

	test('experiment config: custom variant names and modifiers', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'exp-custom',
			numUsers: 200,
			avgEventsPerUserPerDay: 3,
			percentUsersBornInDataset: 50,
			events: [
				{ event: 'Land', isFirstEvent: true, weight: 3 },
				{ event: 'Signup', weight: 2 },
			],
			funnels: [{
				sequence: ['Land', 'Signup'],
				conversionRate: 50,
				isFirstFunnel: true,
				timeToConvert: 1,
				experiment: {
					name: 'Onboarding Redesign',
					variants: [
						{ name: 'Old Flow' },
						{ name: 'New Flow', conversionMultiplier: 1.5, ttcMultiplier: 0.5 },
					],
				},
			}],
		}));
		const events = Array.from(result.eventData);
		const expEvents = events.filter(e => e.event === '$experiment_started');
		expect(expEvents.length).toBeGreaterThan(0);
		const names = new Set(expEvents.map(e => e['Variant name']));
		expect(names.has('Old Flow')).toBe(true);
		expect(names.has('New Flow')).toBe(true);
		expect(expEvents[0]['Experiment name']).toBe('Onboarding Redesign');
	}, 30000);

	test('startDaysBeforeEnd: pre-start funnel runs have no experiment', async () => {
		const experimentMetas = [];
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'exp-temporal',
			numUsers: 100,
			avgEventsPerUserPerDay: 3,
			percentUsersBornInDataset: 100,
			events: [
				{ event: 'Step1', isFirstEvent: true, isStrictEvent: true },
				{ event: 'Step2', isStrictEvent: true },
				{ event: 'Browse', weight: 5 },
			],
			funnels: [
				{
					sequence: ['Step1', 'Step2'],
					conversionRate: 100,
					isFirstFunnel: true,
					timeToConvert: 1,
				},
				{
					sequence: ['Step1', 'Step2'],
					conversionRate: 80,
					timeToConvert: 1,
					weight: 2,
					experiment: {
						name: 'Late Experiment',
						startDaysBeforeEnd: 30,
						variants: [
							{ name: 'Control' },
							{ name: 'Treatment', conversionMultiplier: 1.3 },
						],
					},
				},
			],
			hook: function (record, type, meta) {
				if (type === 'funnel-pre') {
					experimentMetas.push({
						firstEventTime: meta.firstEventTime,
						experiment: meta.experiment,
					});
				}
			},
		}));

		const events = Array.from(result.eventData);
		const expEvents = events.filter(e => e.event === '$experiment_started');
		const EXPECTED_START = FIXED_NOW - 30 * 86400;

		// Pre-start funnel runs should have meta.experiment = null
		const preStart = experimentMetas.filter(m =>
			m.firstEventTime < EXPECTED_START && !m.experiment
		);
		const postStart = experimentMetas.filter(m =>
			m.firstEventTime >= EXPECTED_START && m.experiment
		);
		// Some funnel runs should be pre-start (no experiment)
		expect(preStart.length).toBeGreaterThan(0);
		// Some should be post-start (with experiment)
		expect(postStart.length).toBeGreaterThan(0);
		// $experiment_started events should only appear after start date
		for (const e of expEvents) {
			expect(dayjs(e.time).unix()).toBeGreaterThanOrEqual(EXPECTED_START - 300);
		}
	}, 30000);

	test('deterministic variant assignment: same user gets same variant', async () => {
		const variantsByUser = new Map();
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'exp-deterministic',
			numUsers: 100,
			avgEventsPerUserPerDay: 5,
			percentUsersBornInDataset: 100,
			events: [
				{ event: 'Start', isFirstEvent: true, isStrictEvent: true },
				{ event: 'End', isStrictEvent: true },
				{ event: 'Browse', weight: 5 },
			],
			funnels: [
				{
					sequence: ['Start', 'End'],
					conversionRate: 100,
					isFirstFunnel: true,
					timeToConvert: 1,
				},
				{
					sequence: ['Start', 'End'],
					conversionRate: 100,
					timeToConvert: 1,
					weight: 3,
					experiment: {
						name: 'Consistency Test',
						variants: [
							{ name: 'A' },
							{ name: 'B' },
							{ name: 'C' },
						],
					},
				},
			],
			hook: function (record, type, meta) {
				if (type === 'funnel-pre' && meta.experiment) {
					const uid = meta.user.distinct_id;
					if (!variantsByUser.has(uid)) variantsByUser.set(uid, new Set());
					variantsByUser.get(uid).add(meta.experiment.variantName);
				}
			},
		}));

		// Every user should be in exactly one variant across all their funnel runs
		let allConsistent = true;
		for (const [, variants] of variantsByUser) {
			if (variants.size !== 1) { allConsistent = false; break; }
		}
		expect(variantsByUser.size).toBeGreaterThan(0);
		expect(allConsistent).toBe(true);
	}, 30000);

	test('hook meta exposes experiment context in funnel-pre and funnel-post', async () => {
		let preExperiment = null;
		let postExperiment = null;
		await DUNGEON_MASTER(baseConfig({
			seed: 'exp-meta',
			numUsers: 50,
			avgEventsPerUserPerDay: 3,
			percentUsersBornInDataset: 50,
			events: [
				{ event: 'A', isFirstEvent: true, weight: 3 },
				{ event: 'B', weight: 2 },
			],
			funnels: [{
				sequence: ['A', 'B'],
				conversionRate: 80,
				isFirstFunnel: true,
				timeToConvert: 1,
				experiment: {
					name: 'Meta Test',
					variants: [
						{ name: 'Control' },
						{ name: 'Winner', conversionMultiplier: 1.5, ttcMultiplier: 0.8 },
					],
				},
			}],
			hook: function (record, type, meta) {
				if (type === 'funnel-pre' && meta.experiment && !preExperiment) {
					preExperiment = meta.experiment;
				}
				if (type === 'funnel-post' && meta.experiment && !postExperiment) {
					postExperiment = meta.experiment;
				}
			},
		}));

		expect(preExperiment).not.toBeNull();
		expect(preExperiment.name).toBe('Meta Test');
		expect(['Control', 'Winner']).toContain(preExperiment.variantName);
		expect(typeof preExperiment.variantIndex).toBe('number');
		expect(typeof preExperiment.conversionMultiplier).toBe('number');
		expect(typeof preExperiment.ttcMultiplier).toBe('number');

		expect(postExperiment).not.toBeNull();
		expect(postExperiment.name).toBe(preExperiment.name);
		expect(postExperiment.variantName).toBe(preExperiment.variantName);
	}, 30000);

	test('variant conversion multiplier actually affects conversion rate', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'exp-conversion',
			numUsers: 600,
			avgEventsPerUserPerDay: 3,
			percentUsersBornInDataset: 100,
			events: [
				{ event: 'Step1', isFirstEvent: true, isStrictEvent: true },
				{ event: 'Step2', isStrictEvent: true },
				{ event: 'Browse', weight: 5 },
			],
			funnels: [{
				sequence: ['Step1', 'Step2'],
				conversionRate: 50,
				isFirstFunnel: true,
				timeToConvert: 1,
				experiment: {
					name: 'Conversion Test',
					variants: [
						{ name: 'Low', conversionMultiplier: 0.5 },
						{ name: 'High', conversionMultiplier: 1.5 },
					],
				},
			}],
		}));

		const events = Array.from(result.eventData);
		const expEvents = events.filter(e => e.event === '$experiment_started');
		const step2Events = events.filter(e => e.event === 'Step2');

		// Users in each variant
		const lowUsers = new Set(expEvents.filter(e => e['Variant name'] === 'Low').map(e => e.user_id));
		const highUsers = new Set(expEvents.filter(e => e['Variant name'] === 'High').map(e => e.user_id));

		// Step2 completions per variant
		const lowStep2 = step2Events.filter(e => lowUsers.has(e.user_id)).length;
		const highStep2 = step2Events.filter(e => highUsers.has(e.user_id)).length;

		// High should convert more than Low
		expect(highStep2).toBeGreaterThan(lowStep2);
	}, 30000);
});
