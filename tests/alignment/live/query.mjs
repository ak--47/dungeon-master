import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import dotenv from 'dotenv';
import { root } from './harness.mjs';

dotenv.config({ path: resolve(root, '.env') });
if (!process.env.BEARER_TOKEN) throw new Error('BEARER_TOKEN is required');
if (!process.argv[2]) throw new Error('Pass a retained query specification');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MP_')));
env.MP_OAUTH_TOKEN = process.env.BEARER_TOKEN;
env.MP_PROJECT_ID = '4063241';
env.MP_REGION = 'us';
const interpreter = process.env.ALIGNMENT_HEADLESS_PYTHON || resolve(homedir(), 'code/mixpanel-headless/.venv/bin/python');
const result = spawnSync(interpreter,
  [resolve(root, 'tests/alignment/live/query.py'), resolve(process.argv[2])],
  { cwd: root, env, stdio: 'inherit', timeout: 180000 });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;