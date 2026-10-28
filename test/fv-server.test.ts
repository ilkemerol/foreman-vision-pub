import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.ts';
import { hookBash } from '../src/install.ts';

const SCRIPT = fileURLToPath(new URL('../bin/fv-server.sh', import.meta.url));

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = s.address() as { port: number };
    s.close(() => resolve(port));
  });
});
const listening = (port: number) => new Promise<boolean>(resolve => {
  const c = createConnection(port, '127.0.0.1');
  c.once('connect', () => { c.destroy(); resolve(true); }).once('error', () => resolve(false));
});

test('fv-server.sh start returns with piped stdout (the server does not hold the pipe), and stop ends it', async () => {
  const port = await freePort();
  const cfg = tempDir('fv-server-');
  writeFileSync(join(cfg, 'foreman-vision.conf'), `port=${port}\n`);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg.replaceAll('\\', '/'), CLAUDE_CODE_SESSION_ID: '' };
  const run = (cmd: string) => spawnSync(hookBash(), [SCRIPT, cmd], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
  try {
    const child = spawn(hookBash(), [SCRIPT, 'start'], { env, stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    // 'close' fires only after the process exited AND its stdout/stderr ended
    const code = await new Promise<number | null | 'hung'>(resolve => {
      const t = setTimeout(() => { child.kill(); child.stdout.destroy(); child.stderr.destroy(); resolve('hung'); }, 20_000);
      child.once('close', c => { clearTimeout(t); resolve(c); });
    });
    assert.deepEqual([code, out], [0, `http://127.0.0.1:${port}/\n`]);
    assert.equal(run('stop').stdout, 'foreman-vision: stopped\n');
    assert.equal(await listening(port), false);
  } finally {
    run('stop');
  }
});
