# Collection and diagnostic recipes

These are workflow examples, not a fixed snapshot of DM4's APIs. Inspect the current implementation first. Keep raw evidence private; do not paste metadata or source files into model output before checking for credentials.

## Paths and provenance

Resolve `ENGINE_ROOT`, `DM4_ROOT`, and a new ignored `AUDIT_DIR`. Use `date +%F` for the plan date and a UTC timestamp plus a unique suffix for evidence. Check existing plans and Git state. Record both commits and package versions without reading `.env`.

Relevant current owners:

| Behavior | DM4 path |
| --- | --- |
| GCS selection and source intake | `scripts/audit-dungeons.mjs`, `server/v5/storage/paths.js` |
| Static parse and source equality | `server/v5/render/parse.js`, `render/index.js`, `render/hash.js` |
| Model instructions and normalization | `server/v5/skills/build-spec.md`, `server/v5/agents/build.js` |
| Report compilation | `server/v5/reports.js`, `server/v5/trends/` |
| Isolated local replay | `server/v5/smoke/index.js`, `worker.js` |
| Identity, report evaluation, precision | `server/v5/smoke/measurement.js`, `experiment-measurement.js`, `evidence.js` |
| Bounded calibration and invalidation | `server/v5/agents/repair.js`, `server/v5/smoke/calibration.js` |
| Serialized verification and import separation | `server/services/dungeon-artifact.js`, `dungeon-artifact-files.js` |
| Findings presentation and history | `server/v5/handlers.js`, `execute.js`, `storage/index.js`, `render/header.js` |
| Acceptance commands | `scripts/alignment-acceptance.mjs`, `scripts/live-alignment.mjs` |

## Collect without executing

Structured listing example:

```sh
gcloud storage ls --json 'gs://dungeon_master_4/DUNGEONS/**'
```

Capture stdout directly into the private evidence file with a trusted local script, not into the chat. Parse JSON using structured APIs. Ignore the prefix marker and non-version objects for dungeon selection. For large prefixes use the existing paginated Storage SDK collector; retain all page metadata required for selection.

The existing DM4 collector can perform source intake without execution:

```sh
node scripts/audit-dungeons.mjs --help
node scripts/audit-dungeons.mjs --limit 8 --since 2026-09-08T00:00:00Z --output /absolute/new/audit/intake
```

Replace the date and directory for each run. Omit `--check` during intake. Inspect whether the current collector retains source and metadata generations/checksums. Supplement missing metadata with a structured listing and generation-pinned downloads. Each download should use `bucket.file(name, { generation }).download()` or an equivalent generation-specific GCS URI. Never write to the bucket.

If access errors occur, diagnose authentication through the relevant GCP skill. Do not ask for token text or treat auth failure as an empty corpus. Download into an existing new directory; `gcloud storage cp --recursive` requires that destination directory to exist.

Hash raw files before parsing. Keep SHA-256 for provenance; compare provider checksums where available. Downloading first and matching every file to a later metadata checksum is a documented fallback, not generation-pinned collection. Record the method honestly.

## Parse safely and select checks

```js
import { readFile } from 'node:fs/promises';
import { parse } from '/absolute/dm4/server/v5/render/parse.js';

const source = await readFile(sourceFile, 'utf8');
const parsed = parse(source);
```

Do not import `sourceFile` during inspection. Ejection can mean editing or renderer drift; compare bytes and version before assigning blame. A current render match does not make arbitrary property expressions safe. Review the AST/imports/top-level code and any carried code. Avoid model inference or external requests during checks.

Use the existing collector's `--local ... --check` only after this review, under the offline execution boundary. For a fixed-window or full-scale comparison, a small private orchestration script may call the existing worker API:

```js
const result = await smokeCheck(spec, {
    source,
    users: requestedUsers,
    stage: requestedUsers >= spec.scale.numUsers ? 'full' : 'preview',
    window: { datasetStart, datasetEnd },
    timeoutMs: 120_000,
});
```

Verify this signature and the worker's overrides in current source first. A safe worker disables sending, clears credentials, uses in-memory or private local files, sets `concurrency: 1`, kills timed-out children, and verifies source identity. MacOS example:

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' node /absolute/new/audit/replay.mjs
```

Network denial does not block filesystem effects. Only execute reviewed code; use stronger filesystem isolation for custom code, or report it unexecuted. Do not inherit secrets into untrusted execution.

Record and enforce the resource budget from SKILL.md before launching. Inspect the worker's `execArgv` and parent timeout, and verify that cancellation kills owned children. Check free disk and track only this job's new bytes; use an enforced quota or monitored cap for disk-backed generation. Do not treat a V8 heap cap as an RSS cap. If a job exceeds a limit, retain its completed evidence and classify it `budget-exceeded`; do not retry at smaller density and call it full scale. The audit-wide generation deadline also prevents ten individually bounded jobs from turning into an unbounded session.

Write results incrementally after each completed job. Retain exact source, original URI/generation, source hash, installed engine version, seed, requested/resolved scale, bounds, overrides, warnings, status, findings, and independent counts. Keep raw events only when needed and within the disk budget; record when only summaries were retained. Do not serialize credentials or unnecessary user properties into the public plan.

For disk-backed engine verification, reuse `scripts/verify-runner.mjs`, with reviewed imports and explicit local overrides verified in the current runner. Use a unique prefix, sending disabled, `format: 'json'`, `gzip: false`. Review all shards, not just part 1. When named engine stories exist, also run `scripts/verify-stories.mjs` and preserve its five-tier verdict separately from DM4's labels.

## What the first manual audit taught

These are regression questions, not permanent assertions that current code is broken:

- **Identity:** does the consumer reject emitted both-ID exposure rows even though the engine and ingestion link them? Remeasure identical raw rows using the correct policy. Preserve invalid-row checks, explicit user IDs, canonical IDs, and profile-only exclusions. An oracle that prepopulates canonical IDs does not test whether the adapter was repaired.
- **Repeated conversion:** do 30-50 entry events per person turn requested 20% versus 54% into two rates near 100%? Record both rates and repeated entries. Inspect global persona and shared-selector effects before calibrating.
- **Retention:** does a literal return event occur often enough on mature days? Curve weights are not probabilities of that named event. Check each anchor separately and do not turn Any Event into a hidden fallback.
- **Sparse incidents:** does a multiplier target an event with too few matched baseline occurrences? Total event volume is not the relevant denominator. Keep exact incident bounds, zero bins, weekday/hour support, and unaffected controls.
- **Capacity:** does serialized verification discard all stories when one projected-record buffer exceeds its cap? Count event and profile records correctly. Budget per report and preserve integrity scans; do not substitute samples for exact full proof.
- **Titles:** does a frequency or speed claim get a passing conversion verdict? Does a day-90 or week-3 title have the required buckets and observation horizon? The title, goal, generated mechanism, and report all need comparison.
- **Totals:** does `avgEventsPerUserPerDay` override `numEvents` despite total mode? Check the engine-resolved target before diagnosing final count error. Correct target resolution does not prove exact output count.
- **Bounds:** can a synthetic session marker at -15 seconds precede the start? Test lower and upper bounds. Preview success can differ from serialized integrity acceptance.
- **Composition:** can two global retention writers pass overlap checks, leaving the last curve and two claims? Label constructed cases separately. Validate final multiplied rates, not only original funnel rates.
- **Acceptance:** does a command exit zero merely because generation ran? Separate diagnostic execution from strict evidence acceptance, while preserving the product's chosen nonblocking-send policy for story misses.

## Reporting and checks

Every high-priority recommendation needs an original dungeon example, code owner, mechanism, measured evidence, proposed change, and regression. Use a table of sample coverage, then a prioritized list of `FOUND` sections. Keep exact numerator/denominator data in the plan and machine-readable evidence. Include failed and passing counterexamples.

For fixes to a counting adapter, test raw rows through that adapter against an independent oracle. For generation changes, keep candidate source separate and freeze it before held-out seeds. For full-file checks, prove the measured and imported artifact hashes are identical. Do not hand-roll funnel SQL when the supported engine verifier fits.

Use current focused tests, not the default pruning engine suite. Example engine skill validation:

```sh
set -o pipefail
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' node node_modules/vitest/vitest.mjs run --config vitest.editor.config.js tests/e2e/skills-contract.test.js 2>&1 | tail -50
```

Before finishing, resolve every Markdown link, verify excerpt locations and arithmetic, inspect Git changes for accidental runtime edits, and scan the plan for secrets. A fresh-context review should check causal claims and distinguish original production evidence, local replay, and constructed controls. Report missing live or full-scale work explicitly.