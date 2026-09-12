import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('OS-denied network preflight', () => {
  it.each(['bind', 'connect'])('denies local TCP %s in an inherited child sandbox', (operation) => {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import net from 'node:net';
      const operation = ${JSON.stringify(operation)};
      const endpoint = operation === 'bind' ? net.createServer() : new net.Socket();
      endpoint.once('error', (error) => {
        console.log(error.code);
        process.exit(['EPERM', 'EACCES'].includes(error.code) ? 0 : 1);
      });
      endpoint.once(operation === 'bind' ? 'listening' : 'connect', () => process.exit(2));
      if (operation === 'bind') endpoint.listen(0, '127.0.0.1');
      else endpoint.connect(9, '127.0.0.1');
      setTimeout(() => process.exit(3), 2000);
    `], { encoding: 'utf8', timeout: 4000 });

    expect(probe.error).toBeUndefined();
    expect(probe.signal).toBeNull();
    expect(probe.status, probe.stderr || probe.stdout).toBe(0);
    expect(probe.stdout.trim()).toMatch(/^(EPERM|EACCES)$/);
  });
});