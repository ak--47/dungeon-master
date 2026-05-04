/**
 * Mixpanel Sender Orchestrator module
 * Handles sending all data types to Mixpanel
 */

/** @typedef {import('../../types').Context} Context */

import dayjs from "dayjs";
import { comma, rm } from "ak-tools";
import * as u from "../utils/utils.js";
import mp from "mixpanel-import";

/**
 * Sends the data to Mixpanel
 * @param {Context} context - Context object containing config, storage, etc.
 * @returns {Promise<Object>} Import results for all data types
 */
export { collectWrittenFiles };

export async function sendToMixpanel(context) {
	const { config, storage } = context;
	const {
		adSpendData,
		eventData,
		groupProfilesData,
		scdTableData,
		userProfilesData,
		groupEventData
	} = storage;

	const {
		token,
		region,
		writeToDisk = true,
		format,
		serviceAccount,
		projectId,
		serviceSecret
	} = config;

	const importResults = { events: {}, users: {}, groups: [] };
	const isBATCH_MODE = context.isBatchMode();
	_verbose = config.verbose !== false;

	/** @type {import('mixpanel-import').Creds} */
	const creds = { token };
	const mpImportFormat = format === "json" ? "jsonl" : "csv";

	/** @type {import('mixpanel-import').Options} */
	const commonOpts = {
		region,
		fixData: true,
		v2_compat: true,
		verbose: false,
		forceStream: true,
		strict: false,
		epochEnd: dayjs().unix(),
		dryRun: false,
		abridged: false,
		fixJson: false,
		showProgress: !!config.verbose,
		streamFormat: mpImportFormat,
		workers: 35
	};

	log(`\n${'─'.repeat(50)}`);
	log(`  Importing data to Mixpanel (${region})`);
	log(`${'─'.repeat(50)}\n`);

	// Import events
	if (eventData?.length > 0 || isBATCH_MODE) {
		log(`  Events`);
		let eventDataToImport = u.deepClone(eventData);
		const shouldReadFromFiles = isBATCH_MODE || (writeToDisk && eventData && eventData.length === 0);
		if (shouldReadFromFiles && eventData?.getWrittenFiles) {
			const files = eventData.getWrittenFiles();
			if (files.length > 0) eventDataToImport = files;
		}
		const imported = await mp(creds, eventDataToImport, {
			recordType: "event",
			...commonOpts,
		});
		log(`  -> ${comma(imported.success)} events sent\n`);
		importResults.events = imported;
	}

	// Import user profiles
	if (userProfilesData?.length > 0 || isBATCH_MODE) {
		log(`  User Profiles`);
		let userProfilesToImport = u.deepClone(userProfilesData);
		const shouldReadFromFiles = isBATCH_MODE || (writeToDisk && userProfilesData && userProfilesData.length === 0);
		if (shouldReadFromFiles && userProfilesData?.getWrittenFiles) {
			const files = userProfilesData.getWrittenFiles();
			if (files.length > 0) userProfilesToImport = files;
		}
		const imported = await mp(creds, userProfilesToImport, {
			recordType: "user",
			...commonOpts,
		});
		log(`  -> ${comma(imported.success)} user profiles sent\n`);
		importResults.users = imported;
	}

	// Import ad spend data
	if (adSpendData?.length > 0 || isBATCH_MODE) {
		log(`  Ad Spend`);
		let adSpendDataToImport = u.deepClone(adSpendData);
		const shouldReadFromFiles = isBATCH_MODE || (writeToDisk && adSpendData && adSpendData.length === 0);
		if (shouldReadFromFiles && adSpendData?.getWrittenFiles) {
			const files = adSpendData.getWrittenFiles();
			if (files.length > 0) adSpendDataToImport = files;
		}
		const imported = await mp(creds, adSpendDataToImport, {
			recordType: "event",
			...commonOpts,
		});
		log(`  -> ${comma(imported.success)} ad spend events sent\n`);
		importResults.adSpend = imported;
	}

	// Import group profiles
	if (groupProfilesData && Array.isArray(groupProfilesData) && groupProfilesData.length > 0) {
		for (const groupEntity of groupProfilesData) {
			if (!groupEntity || groupEntity.length === 0) continue;
			const groupKey = groupEntity?.groupKey;
			log(`  Group Profiles (${groupKey})`);
			let groupProfilesToImport = u.deepClone(groupEntity);
			const shouldReadFromFiles = isBATCH_MODE || (writeToDisk && groupEntity.length === 0);
			if (shouldReadFromFiles && groupEntity?.getWrittenFiles) {
				const files = groupEntity.getWrittenFiles();
				if (files.length > 0) groupProfilesToImport = files;
			}
			const imported = await mp({ token, groupKey }, groupProfilesToImport, {
				recordType: "group",
				...commonOpts,
				groupKey,
			});
			log(`  -> ${comma(imported.success)} ${groupKey} profiles sent\n`);
			importResults.groups.push(imported);
		}
	}

	// Import group events
	if (groupEventData?.length > 0) {
		log(`  Group Events`);
		let groupEventDataToImport = u.deepClone(groupEventData);
		const shouldReadFromFiles = isBATCH_MODE || (writeToDisk && groupEventData.length === 0);
		if (shouldReadFromFiles && groupEventData?.getWrittenFiles) {
			const files = groupEventData.getWrittenFiles();
			if (files.length > 0) groupEventDataToImport = files;
		}
		const imported = await mp(creds, groupEventDataToImport, {
			recordType: "event",
			...commonOpts,
		});
		log(`  -> ${comma(imported.success)} group events sent\n`);
		importResults.groupEvents = imported;
	}

	// Import SCD data (requires service account)
	if (serviceAccount && projectId && serviceSecret) {
		if (scdTableData && Array.isArray(scdTableData) && scdTableData.length > 0) {
			for (const scdEntity of scdTableData) {
				const scdKey = scdEntity?.scdKey;
				const entityType = scdEntity?.entityType || 'user';
				log(`  SCD: ${scdKey}`);
				let scdDataToImport = u.deepClone(scdEntity);
				const shouldReadFromFiles = isBATCH_MODE || (writeToDisk && scdEntity && scdEntity.length === 0);
				if (shouldReadFromFiles && scdEntity?.getWrittenFiles) {
					const files = scdEntity.getWrittenFiles();
					if (files.length > 0) scdDataToImport = files;
				}

				/** @type {"string" | "number" | "boolean"} */
				let scdType = 'string';
				const scdExamplesValues = context.config.scdProps[Object.keys(context.config.scdProps).find(k => k === scdKey)].values;
				if (scdExamplesValues) {
					if (typeof scdExamplesValues[0] === 'number') {
						scdType = 'number';
					} else if (typeof scdExamplesValues[0] === 'boolean') {
						scdType = 'boolean';
					}
				}

				/** @type {import('mixpanel-import').Options} */
				const options = {
					recordType: "scd",
					scdKey,
					scdType,
					scdLabel: `${scdKey}`,
					...commonOpts,
				};

				if (entityType !== "user") {
					options.groupKey = entityType;
				}

				try {
					const imported = await mp(
						{
							token,
							acct: serviceAccount,
							pass: serviceSecret,
							project: projectId
						},
						scdDataToImport,
						options
					);
					log(`  -> ${comma(imported.success)} ${scdKey} SCD entries sent\n`);
					importResults[`${scdKey}_scd`] = imported;
				} catch (err) {
					log(`  !! failed: ${scdKey} SCD — ${err.message}\n`);
					importResults[`${scdKey}_scd`] = { success: 0, failed: 0, error: err.message };
				}
			}
		}
	}

	importResults.problems = collectProblems(importResults);
	logProblems(importResults.problems);

	log(`${'─'.repeat(50)}\n`);

	// Clean up batch files if needed (writeToDisk=false but batch mode wrote temp files)
	if (!writeToDisk && isBATCH_MODE) {
		const allFiles = collectWrittenFiles(storage);
		for (const file of allFiles) {
			await rm(file);
		}
	}

	return importResults;
}

/**
 * Logging function that respects verbose config
 * @param {string} message - Message to log
 */
let _verbose = true;
function log(message) {
	if (_verbose) console.log(message);
}

/**
 * Walk importResults and collect any failure/error indicators per import.
 * Returns an array of problem objects (empty when all imports succeeded).
 * @param {Object} importResults
 * @returns {Array<{label: string, failed: number, unparsable: number, serverErrors: number, clientErrors: number, errorCount: number, error?: string, errors?: any[]}>}
 */
function collectProblems(importResults) {
	const entries = [];
	for (const [key, value] of Object.entries(importResults)) {
		if (!value || key === 'problems') continue;
		if (Array.isArray(value)) {
			value.forEach((v, i) => entries.push([`${key}[${i}]`, v]));
		} else {
			entries.push([key, value]);
		}
	}

	const problems = [];
	for (const [label, result] of entries) {
		if (!result || typeof result !== 'object') continue;
		const failed = result.failed || 0;
		const unparsable = result.unparsable || 0;
		const serverErrors = result.serverErrors || 0;
		const clientErrors = result.clientErrors || 0;
		const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
		const error = result.error;
		if (failed || unparsable || serverErrors || clientErrors || errorCount || error) {
			problems.push({ label, failed, unparsable, serverErrors, clientErrors, errorCount, error, errors: result.errors });
		}
	}
	return problems;
}

/**
 * Print the compact problem report. Silent when there are no problems.
 * @param {ReturnType<typeof collectProblems>} problems
 */
function logProblems(problems) {
	if (!problems || problems.length === 0) return;

	log(`  Problems`);
	for (const p of problems) {
		const parts = [];
		if (p.failed) parts.push(`${comma(p.failed)} failed`);
		if (p.unparsable) parts.push(`${comma(p.unparsable)} unparsable`);
		if (p.serverErrors) parts.push(`${comma(p.serverErrors)} 5xx (retried)`);
		if (p.clientErrors) parts.push(`${comma(p.clientErrors)} client errors (retried)`);
		if (p.errorCount) parts.push(`${comma(p.errorCount)} error records`);
		if (p.error) parts.push(`error: ${p.error}`);
		log(`  -> ${p.label}: ${parts.join(', ')}`);
		if (Array.isArray(p.errors) && p.errors.length > 0) {
			const sample = p.errors[0];
			const summary = typeof sample === 'string' ? sample : JSON.stringify(sample).slice(0, 200);
			log(`     sample: ${summary}`);
		}
	}
	log('');
}

/**
 * Collect all written file paths from every storage container.
 * @param {import('../../types').Storage} storage
 * @returns {string[]}
 */
function collectWrittenFiles(storage) {
	const files = [];
	for (const container of [storage.eventData, storage.userProfilesData, storage.adSpendData,
		storage.mirrorEventData, storage.groupEventData]) {
		if (container?.getWrittenFiles) files.push(...container.getWrittenFiles());
	}
	for (const arr of [storage.groupProfilesData, storage.scdTableData, storage.lookupTableData]) {
		if (Array.isArray(arr)) {
			for (const c of arr) {
				if (c?.getWrittenFiles) files.push(...c.getWrittenFiles());
			}
		}
	}
	return files;
}