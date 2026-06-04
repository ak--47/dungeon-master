#!/usr/bin/env node

/**
 * create-project orchestrator.
 *
 * Given an existing dungeon file, provisions a fresh Mixpanel project via the
 * power-tools API and writes the resulting credentials back into the dungeon so
 * it can "just run":
 *
 *   1. createProject       (sets timezone UTC as a follow-up)
 *   2. mintServiceAccount  (admin, +30d) — scoped to the new project
 *   3. addGroupKey         (only if the dungeon declares groupKeys)
 *   4. setBusinessContext  (OVERVIEW + HOOK STORIES + schema summary)
 *   5. write `credentials: { token, projectId, serviceAccount, serviceSecret, region }`
 *      back into the dungeon (gitignored user dungeons — plaintext is fine)
 *
 * Auth: all calls use the OAuth BEARER_TOKEN from .env. The minted service
 * account is for the dungeon to SEND data later, not for setup.
 *
 * Usage:
 *   node .claude/skills/create-project/provision.mjs <dungeon-path> [--dry-run]
 *
 * Env (.env at repo root):
 *   BEARER_TOKEN=<oauth token>
 *   ORG_ID=<organization id>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { loadFromFile, extractComments } from '../../../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../');

dotenv.config({ path: resolve(REPO_ROOT, '.env') });

const BASE = 'https://mixpanel-power-tools-api-lmozz6xkha-uc.a.run.app';
const CLIENT_ID = 'dungeon-master';
const REGION = 'US';
const SA_TTL_DAYS = 30;

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dungeonArg = args.find((a) => !a.startsWith('--'));

if (!dungeonArg) {
	fail('Usage: node .claude/skills/create-project/provision.mjs <dungeon-path> [--dry-run]');
}

const dungeonPath = resolve(process.cwd(), dungeonArg);
if (!existsSync(dungeonPath)) fail(`dungeon file not found: ${dungeonPath}`);

// ── main ──────────────────────────────────────────────────────────────────
const config = await loadFromFile(dungeonPath);
const comments = extractComments(dungeonPath);

const name = deriveName(comments, dungeonPath);
const groupKeys = Array.isArray(config.groupKeys)
	? config.groupKeys.filter(Boolean).map(([prop]) => ({ property_name: prop, display_name: titleize(prop) }))
	: [];
const saName = `${slug(name)}-dungeon-sa`.slice(0, 64);
const content = buildContext(name, config, comments, groupKeys);

if (dryRun) {
	printPlan();
	process.exit(0);
}

// Live run needs auth.
const { BEARER_TOKEN, ORG_ID } = process.env;
if (!BEARER_TOKEN) fail('BEARER_TOKEN missing from .env (OAuth token required to create projects).');
if (!ORG_ID) fail('ORG_ID missing from .env (organization id required to create projects).');

const warnings = [];

// 1. create project (timezone set to UTC as a follow-up by the endpoint)
let project;
try {
	project = await post('/crud/createProject', { org_id: ORG_ID, name, timezone: 'UTC' });
} catch (err) {
	fail(`createProject failed — nothing provisioned.\n  ${err.message}`);
}
const projectId = String(project.id);
const projectToken = project.token;

// 2. mint service account (admin, +30d)
let sa = null;
const expires = isoInDays(SA_TTL_DAYS);
try {
	sa = await post('/crud/mintServiceAccount', {
		org_id: ORG_ID,
		project_id: projectId,
		name: saName,
		role: 'admin',
		expires,
	});
} catch (err) {
	warnings.push(`mintServiceAccount failed: ${err.message}`);
}

// 3. group keys (only if declared)
let groupKeyResult = null;
if (groupKeys.length) {
	try {
		groupKeyResult = await post('/crud/addGroupKey', { project_id: projectId, group_keys: groupKeys });
	} catch (err) {
		warnings.push(`addGroupKey failed: ${err.message}`);
	}
}

// 4. business context
try {
	await post('/crud/setBusinessContext', { project_id: projectId, content });
} catch (err) {
	warnings.push(`setBusinessContext failed: ${err.message}`);
}

// 5. write credentials back into the dungeon
const creds = {
	token: projectToken,
	projectId,
	serviceAccount: sa?.username || '',
	serviceSecret: sa?.secret || '',
	region: REGION,
};
let wroteBack = true;
try {
	writeBackCredentials(dungeonPath, creds);
} catch (err) {
	wroteBack = false;
	warnings.push(`credentials write-back failed: ${err.message}`);
}

printSummary();

// ── helpers ─────────────────────────────────────────────────────────────────

async function post(pathname, body) {
	const res = await fetch(BASE + pathname, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.BEARER_TOKEN}` },
		body: JSON.stringify({ client_id: CLIENT_ID, region: REGION, ...body }),
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text };
	}
	if (!res.ok) {
		const detail = Array.isArray(json.errors)
			? json.errors.map((e) => `${e.param}: ${e.message}`).join('; ')
			: json.error || text || `HTTP ${res.status}`;
		throw new Error(`${res.status} ${detail}`);
	}
	return json;
}

function deriveName(comments, p) {
	const m = (comments.overview || '').match(/^NAME:\s*(.+)$/m);
	if (m) return m[1].trim();
	return path.basename(p).replace(/\.(js|mjs|json)$/i, '');
}

function titleize(s) {
	return String(s)
		.split(/[_\s-]+/)
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
		.join(' ');
}

function slug(s) {
	return String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function isoInDays(days) {
	const ms = Date.now() + days * 24 * 60 * 60 * 1000;
	return new Date(ms).toISOString();
}

function buildContext(name, config, comments, groupKeys) {
	const parts = [`# ${name}`, ''];
	if (comments.overview) parts.push(comments.overview, '');
	if (comments.hookStories) parts.push('## Engineered Behaviors', '', comments.hookStories, '');

	parts.push('## Schema', '');
	const events = config.events || [];
	parts.push(`### Events (${events.length})`);
	for (const e of events) {
		const props = e.properties ? Object.keys(e.properties).join(', ') : '';
		const weight = e.weight != null ? ` (weight ${e.weight})` : '';
		parts.push(`- ${e.event}${weight}${props ? ` — ${props}` : ''}`);
	}
	parts.push('');

	const funnels = config.funnels || [];
	if (funnels.length) {
		parts.push(`### Funnels (${funnels.length})`);
		for (const f of funnels) {
			const seq = (f.sequence || []).join(' → ');
			const rate = f.conversionRate != null ? ` (${f.conversionRate}%)` : '';
			parts.push(`- ${f.name || '(unnamed)'}: ${seq}${rate}`);
		}
		parts.push('');
	}

	if (groupKeys.length) {
		parts.push('### Group keys', ...groupKeys.map((g) => `- ${g.property_name} (${g.display_name})`), '');
	}

	let md = parts.join('\n');
	if (md.length > 50000) md = md.slice(0, 49900) + '\n\n…(truncated to 50,000 chars)';
	return md;
}

function writeBackCredentials(p, creds) {
	let src = readFileSync(p, 'utf-8');
	const block =
		`credentials: { token: ${q(creds.token)}, projectId: ${q(creds.projectId)}, ` +
		`serviceAccount: ${q(creds.serviceAccount)}, serviceSecret: ${q(creds.serviceSecret)}, region: ${q(creds.region)} }`;

	const existing = /credentials\s*:\s*\{[\s\S]*?\}/;
	if (existing.test(src)) {
		src = src.replace(existing, block);
	} else {
		const opener = /(const\s+\w+\s*=\s*\{)/;
		if (opener.test(src)) {
			src = src.replace(opener, `$1\n\t${block},`);
		} else {
			throw new Error('no `credentials` block or `const X = {` opener found — add a credentials block manually.');
		}
	}
	writeFileSync(p, src, 'utf-8');
}

function q(v) {
	return JSON.stringify(String(v ?? ''));
}

function printPlan() {
	const preview = content.length > 600 ? content.slice(0, 600) + ' …' : content;
	console.log('── create-project plan (dry run) ────────────────────────────');
	console.log(`dungeon:        ${path.relative(process.cwd(), dungeonPath)}`);
	console.log(`project name:   ${name}`);
	console.log(`region:         ${REGION}    timezone: UTC`);
	console.log(`service acct:   ${saName}  (role admin, expires +${SA_TTL_DAYS}d)`);
	console.log(`group keys:     ${groupKeys.length ? groupKeys.map((g) => `${g.property_name} → "${g.display_name}"`).join(', ') : '(none)'}`);
	console.log(`business ctx:   ${content.length} chars`);
	console.log('');
	console.log('would POST: createProject → mintServiceAccount' + (groupKeys.length ? ' → addGroupKey' : '') + ' → setBusinessContext');
	console.log('then write credentials back into the dungeon.');
	console.log('');
	console.log('── business context preview ─────────────────────────────────');
	console.log(preview);
}

function printSummary() {
	console.log('── create-project: provisioned ──────────────────────────────');
	console.log(`project:        ${name} (id ${projectId})`);
	if (project.url) console.log(`url:            ${project.url}`);
	console.log(`region:         ${REGION}    timezone: UTC`);
	console.log(`service acct:   ${sa ? `${sa.username} (role ${sa.role}, expires ${sa.expires})` : '(FAILED — see warnings)'}`);
	if (groupKeys.length) {
		const added = groupKeyResult?.added?.map((g) => g.property_name).join(', ') || '(none)';
		const skipped = groupKeyResult?.skipped?.join(', ') || '(none)';
		console.log(`group keys:     added [${added}]  skipped [${skipped}]`);
	}
	console.log(`business ctx:   ${content.length} chars uploaded`);
	console.log(`credentials:    ${wroteBack ? 'written back into dungeon ✓' : 'NOT written (see warnings)'}`);
	if (warnings.length) {
		console.log('');
		console.log('⚠ warnings:');
		for (const w of warnings) console.log(`  - ${w}`);
	}
	console.log('');
	console.log(`next: node scripts/run-dungeon.mjs ${path.relative(process.cwd(), dungeonPath)}`);
}

function fail(msg) {
	console.error(`✖ ${msg}`);
	process.exit(1);
}
