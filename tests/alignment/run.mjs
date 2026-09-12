import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sandbox = '/usr/bin/sandbox-exec';
const policy = '(version 1) (allow default) (deny network*)';
const maxDurationMs = 600000;
const args = process.argv.slice(2);
const timeoutArgs = args.filter((arg) => arg.startsWith('--timeout-ms='));
const modes = args.filter((arg) => !arg.startsWith('--timeout-ms='));
const durationMs = timeoutArgs.length ? Number(timeoutArgs[0].split('=')[1]) : maxDurationMs;

if (modes.length > 1 || modes.some((arg) => !['--preflight', '--sweep'].includes(arg)) ||
    timeoutArgs.length > 1 || !Number.isInteger(durationMs) || durationMs < 1 || durationMs > maxDurationMs) {
  console.error('Usage: node tests/alignment/run.mjs [--preflight|--sweep] [--timeout-ms=1..600000]');
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
const deadline = Date.now() + durationMs;
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
  process.exit(124);
}, durationMs);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    killGroup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

async function runStage(label, stageArgs, sweep = false) {
  if (Date.now() >= deadline) return 124;
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
  if (code === 0 && modes[0] !== '--preflight') code = await runStage('regression gate', testArgs);
  if (code === 0 && modes[0] === '--sweep') code = await runStage('bounded sweep', testArgs, true);
  process.exitCode = code;
} finally {
  clearTimeout(watchdog);
  killGroup();
}