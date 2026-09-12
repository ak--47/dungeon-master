import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runSweep, runCell, writeReport } from './sweep.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sandbox = '/usr/bin/sandbox-exec';
const policy = '(version 1) (allow default) (deny network*)';
const maxDurationMs = 600000;
const args = process.argv.slice(2);
const timeoutArgs = args.filter((arg) => arg.startsWith('--timeout-ms='));
const outputArgs = args.filter((arg) => arg.startsWith('--output='));
const probeHang = args.includes('--probe-hang');
const modes = args.filter((arg) => !arg.startsWith('--timeout-ms=') && !arg.startsWith('--output=') && arg !== '--probe-hang');
const durationMs = timeoutArgs.length ? Number(timeoutArgs[0].split('=')[1]) : maxDurationMs;

if (modes.length > 1 || modes.some((arg) => !['--preflight', '--sweep'].includes(arg)) ||
    timeoutArgs.length > 1 || outputArgs.length > 1 || (probeHang && modes[0] !== '--sweep') ||
    (outputArgs.length && modes[0] !== '--sweep') || args.filter(arg => arg === '--probe-hang').length > 1 ||
    !Number.isInteger(durationMs) || durationMs < 1 || durationMs > maxDurationMs) {
  console.error('Usage: node tests/alignment/run.mjs [--preflight|--sweep] [--timeout-ms=1..600000] [--output=path-prefix] [--probe-hang]');
  process.exit(2);
}
if (process.platform !== 'darwin') {
  console.error('Alignment tests require macOS sandbox-exec; no unsandboxed fallback is permitted.');
  process.exit(2);
}
accessSync(sandbox, constants.X_OK);
const tsc = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
const vitest = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));
accessSync(tsc, constants.R_OK);
accessSync(vitest, constants.R_OK);
const compiler = JSON.parse(readFileSync(new URL('../../node_modules/typescript/package.json', import.meta.url), 'utf8'));
const buildArgs = [tsc, '--project', 'tsconfig.build.json', '--noEmit'];
if (Number(compiler.version.split('.')[0]) >= 6) buildArgs.push('--ignoreDeprecations', '6.0');

let activeChild;
const startedAt = Date.now();
const deadline = startedAt + durationMs;
const output = resolve(root, outputArgs[0]?.slice('--output='.length) || 'tests/alignment/sweep-results');
const report = modes[0] === '--sweep' ? { version: 1, status: 'running', phase: 'build', budgetMs: durationMs,
  offline: 'macOS sandbox-exec deny network*; inherited by all descendants', cells: [], scheduledCells: 0 } : null;
function persist(status, failure) {
  if (!report) return;
  report.status = status;
  report.elapsedMs = Date.now() - startedAt;
  if (failure) report.failure = failure;
  writeReport(report, output);
}
function killGroup() {
  if (!activeChild?.pid) return;
  try {
    process.kill(-activeChild.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
const watchdog = setTimeout(() => {
  console.error(`Alignment deadline exceeded (${durationMs}ms); killing the process group.`);
  killGroup();
  persist('deadline', `hard deadline during ${report?.phase}; active worker and descendants killed`);
  process.exit(124);
}, durationMs);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    killGroup();
    persist('interrupted', signal);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

async function runStage(label, stageArgs, sweep = false) {
  if (Date.now() >= deadline) return 124;
  if (report) { report.phase = label; persist('running'); }
  console.log(`Alignment: ${label} (OS network denied)`);
  return new Promise((resolve, reject) => {
    activeChild = spawn(sandbox, ['-p', policy, process.execPath, ...stageArgs], {
      cwd: root,
      detached: true,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test', NODE_OPTIONS: '', VSCODE_INSPECTOR_OPTIONS: '', ALIGNMENT_SWEEP: sweep ? '1' : '0' },
    });
    activeChild.once('error', reject);
    activeChild.once('close', (code) => {
      killGroup();
      activeChild = undefined;
      resolve(code ?? 1);
    });
  });
}

try {
  let code = await runStage('build gate', buildArgs);
  const testArgs = [vitest, 'run', '--config', 'tests/alignment/vitest.config.js'];
  if (code === 0) code = await runStage('offline preflight', [...testArgs, 'tests/alignment/offline-preflight.test.js']);
  if (code === 0 && !modes.length) code = await runStage('regression gate', testArgs);
  if (code === 0 && modes[0] === '--sweep') {
    if (probeHang) {
      report.phase = 'hanging-worker-probe';
      report.scheduledCells = 1;
      const cell = await runCell({ id: 'probe' }, { deadline, probeHang: true,
        onChild: child => { activeChild = child; }, onStarted: message => {
          report.active = message;
          persist('running');
          console.log(`Sweep hanging worker started: ${message.pid} descendant=${message.descendantPid}`);
        } });
      report.cells.push(cell);
      code = 124;
      persist('deadline', 'hanging worker terminated');
    } else {
      code = await runStage('sweep infrastructure tests', [...testArgs, 'tests/alignment/sweep.test.js',
        '--testNamePattern=^(?!.*kills a started hanging worker)']);
      if (code === 0) {
        const finished = await runSweep(report, { deadline, output, onChild: child => { activeChild = child; } });
        const diagnosticFailure = report.cells.some(cell => ['diluted', 'inverse', 'contractfail'].includes(cell.verdict));
        code = !finished || !report.coverageComplete ? 2 : diagnosticFailure ? 1 : 0;
        persist(!finished || !report.coverageComplete ? 'partial' : diagnosticFailure ? 'complete-with-findings' : 'complete');
      }
    }
  }
  if (report?.status === 'running') persist('failed', `stage ${report.phase} exited ${code}`);
  process.exitCode = code;
} catch (error) {
  persist('failed', error.message);
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  killGroup();
}