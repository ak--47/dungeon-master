#!/usr/bin/env node

/**
 * pt.mjs — thin ad-hoc client for the Mixpanel Power Tools API.
 *
 * Usage:
 *   node .claude/skills/powertools/pt.mjs <path> ['<json-body>'] [--bearer <token>] [--get] [--region US]
 *
 * Examples:
 *   node .claude/skills/powertools/pt.mjs /auth '{}'
 *   node .claude/skills/powertools/pt.mjs /macro/get-schema '{"project_id":"123","include_metadata":true,"verbose":true}'
 *   node .claude/skills/powertools/pt.mjs /query/getTopEvents --get     # endpoint docs, no auth
 *
 * POST bodies are merged with { client_id: "dungeon-master", region }.
 * Bearer defaults to BEARER_TOKEN in the repo .env (employee OAuth). Customer
 * OAuth tokens are accepted on non-ai endpoints; the ai-* family is
 * employee-only (see SKILL.md).
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const BASE = 'https://mixpanel-power-tools-api-lmozz6xkha-uc.a.run.app';
const CLIENT_ID = 'dungeon-master';

const args = process.argv.slice(2);
const getMode = popFlag('--get');
const bearer = popOpt('--bearer') ?? process.env.BEARER_TOKEN;
const region = popOpt('--region') ?? 'US';
const [pathArg, bodyArg] = args;

if (!pathArg || !pathArg.startsWith('/')) {
	console.error('Usage: node pt.mjs <path starting with /> [\'<json-body>\'] [--bearer <token>] [--get] [--region US]');
	process.exit(1);
}

if (getMode) {
	const res = await fetch(BASE + pathArg);
	console.log(JSON.stringify(await res.json(), null, 2));
	process.exit(res.ok ? 0 : 1);
}

if (!bearer) {
	console.error('No bearer token: pass --bearer or set BEARER_TOKEN in .env');
	process.exit(1);
}

let body = {};
if (bodyArg) {
	try {
		body = JSON.parse(bodyArg);
	} catch (err) {
		console.error(`Body is not valid JSON: ${err.message}`);
		process.exit(1);
	}
}

const res = await fetch(BASE + pathArg, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
	body: JSON.stringify({ client_id: CLIENT_ID, region, ...body }),
});

const text = await res.text();
try {
	console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
	console.log(text);
}
if (!res.ok) {
	console.error(`\nHTTP ${res.status} ${res.statusText}`);
	process.exit(1);
}

function popFlag(name) {
	const i = args.indexOf(name);
	if (i === -1) return false;
	args.splice(i, 1);
	return true;
}

function popOpt(name) {
	const i = args.indexOf(name);
	if (i === -1) return undefined;
	const [, value] = args.splice(i, 2);
	return value;
}
