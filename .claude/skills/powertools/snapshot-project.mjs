#!/usr/bin/env node

/**
 * snapshot-project.mjs — export a Mixpanel project's schema + relative event
 * volumes into one normalized JSON snapshot, for authoring a synthetic
 * dungeon-master "copy" of the project.
 *
 * Usage:
 *   node .claude/skills/powertools/snapshot-project.mjs <project_id> --bearer <token> \
 *     [--region US|EU|IN] [--out <file>]
 *
 * Uses the Power Tools API: /macro/get-schema (include_metadata + verbose) +
 * /query/getTopEvents. The bearer token (customer or employee OAuth) needs
 * data access to the project — /auth reporting accessible: true is not enough.
 *
 * Output shape (events sorted by count desc):
 *   {
 *     projectId, projectName, fetchedAt, region, totalCount,
 *     events:    [{ name, count, pct, properties: [{ name, type, description }] }],
 *     userProps: [{ name, type, description }],
 *     groups:    {}
 *   }
 *
 * Privacy: captures schema + volumes ONLY — never property values.
 */

import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const PT_BASE = 'https://mixpanel-power-tools-api-lmozz6xkha-uc.a.run.app';
const CLIENT_ID = 'dungeon-master';
const REGIONS = ['US', 'EU', 'IN'];

const args = process.argv.slice(2);
const bearer = popOpt('--bearer') ?? process.env.BEARER_TOKEN;
const region = (popOpt('--region') ?? 'US').toUpperCase();
const outArg = popOpt('--out');
const projectId = args.find((a) => !a.startsWith('--'));

if (!projectId || !/^\d+$/.test(projectId)) fail('Usage: snapshot-project.mjs <project_id> --bearer <token> [--region US] [--out file]');
if (!bearer) fail('No bearer token: pass --bearer or set BEARER_TOKEN in .env');
if (!REGIONS.includes(region)) fail(`Unknown --region "${region}"`);

const outPath = resolve(process.cwd(), outArg ?? `snapshot-${projectId}.json`);

const snapshot = await snapshotViaPowertools();

snapshot.events.sort((a, b) => b.count - a.count);
snapshot.totalCount = snapshot.events.reduce((s, e) => s + e.count, 0);
for (const e of snapshot.events) e.pct = snapshot.totalCount ? +(e.count / snapshot.totalCount * 100).toFixed(4) : 0;

writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

const zeros = snapshot.events.filter((e) => e.count === 0).length;
console.log(`✓ snapshot → ${outPath}`);
console.log(`  project:    ${snapshot.projectName ?? '(name unknown)'} (${snapshot.projectId})`);
console.log(`  events:     ${snapshot.events.length} (${zeros} with zero volume)`);
console.log(`  userProps:  ${snapshot.userProps.length}`);
console.log(`  total vol:  ${snapshot.totalCount.toLocaleString()} events`);
console.log('  top 10:');
for (const e of snapshot.events.slice(0, 10)) console.log(`    ${e.pct.toFixed(2).padStart(6)}%  ${e.count.toLocaleString().padStart(12)}  ${e.name}`);

async function snapshotViaPowertools() {
	const schema = await ptPost('/macro/get-schema', { project_id: projectId, include_metadata: true, verbose: true });
	const top = await ptPost('/query/getTopEvents', { project_id: projectId, limit: 500 });

	const counts = {};
	for (const r of top.results ?? []) counts[r.event] = r.count;

	// dependencies.events maps eventName → [propertyNames]; property defs live in schema.properties
	const propDefs = new Map();
	for (const p of schema.properties ?? []) propDefs.set(p.name, p);
	const deps = schema.dependencies?.events ?? {};

	const events = (schema.events ?? []).map((ev) => {
		const name = ev.name ?? ev;
		const propNames = deps[name] ?? [];
		return {
			name,
			count: counts[name] ?? 0,
			pct: 0,
			properties: propNames.map((pn) => {
				const def = propDefs.get(pn) ?? {};
				return { name: pn, type: def.type ?? 'string', description: def.description ?? '' };
			}),
		};
	});

	const userProps = (schema.users ?? []).map((p) => ({
		name: p.name ?? p,
		type: p.type ?? 'string',
		description: p.description ?? '',
	}));

	return { projectId, projectName: null, fetchedAt: new Date().toISOString(), region, totalCount: 0, events, userProps, groups: schema.groups ?? {} };
}

async function ptPost(pathname, body) {
	const res = await fetch(PT_BASE + pathname, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
		body: JSON.stringify({ client_id: CLIENT_ID, region, ...body }),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`POST ${pathname} → HTTP ${res.status}: ${json.error ?? JSON.stringify(json).slice(0, 300)}`);
	return json;
}

function popOpt(name) {
	const i = args.indexOf(name);
	if (i === -1) return undefined;
	const [, value] = args.splice(i, 2);
	return value;
}

function fail(msg) {
	console.error(`✖ ${msg}`);
	process.exit(1);
}
