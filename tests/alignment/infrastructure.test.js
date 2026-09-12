import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import alignmentConfig from './vitest.config.js';
import defaultConfig from '../../vitest.config.js';

const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));

describe('alignment infrastructure', () => {
  it('isolates collection and omits destructive setup', () => {
    expect(defaultConfig.test.exclude).toContain('tests/alignment/**');
    expect(alignmentConfig.test.globalSetup).toEqual([]);
    expect(alignmentConfig.test.setupFiles).toEqual([]);
    expect(alignmentConfig.test.include).toEqual(['tests/alignment/**/*.test.js']);
    expect(alignmentConfig.test.fileParallelism).toBe(false);
    expect(alignmentConfig.test.sequence.concurrent).toBe(false);
    expect(alignmentConfig.test.poolOptions.forks.maxForks).toBe(1);
  });

  it('rejects deadlines over 600 seconds', () => {
    const child = spawnSync(process.execPath, [runner, '--timeout-ms=600001'], { encoding: 'utf8', timeout: 3000 });
    expect(child.status).toBe(2);
    expect(child.stderr).toContain('Usage:');
  });

  it('fails closed on unsupported operating systems', () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      Object.defineProperty(process, 'platform', { value: 'linux' });
      await import(${JSON.stringify(new URL('./run.mjs', import.meta.url).href)});
    `], { encoding: 'utf8', timeout: 3000 });
    expect(child.status).toBe(2);
    expect(child.stderr).toContain('no unsandboxed fallback');
  });

  it('enforces the wall deadline during the build stage', () => {
    const child = spawnSync(process.execPath, [runner, '--timeout-ms=1'], { encoding: 'utf8', timeout: 3000 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(124);
  });
});