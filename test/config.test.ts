import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.ts';
import { loadConfig } from '../src/config.ts';

test('CLI flag > conf file > default', () => {
  const base = tempDir('fv-conf-');
  const env = { CLAUDE_CONFIG_DIR: base };
  assert.deepEqual(loadConfig([], env), {
    port: 4780, abandonMs: 600_000,
    spoolDir: join(base, 'foreman-vision', 'spool'),
    stateDir: join(base, 'foreman', 'state'),
    settingsPath: join(base, 'settings.json'),
    sessionsDir: join(base, 'sessions'),
    pluginRootFile: join(base, 'foreman-vision', 'plugin-root'),
    portFile: join(base, 'foreman-vision', 'port'),
  });
  writeFileSync(join(base, 'foreman-vision.conf'), '# comment\nport = 5000\r\nabandon-minutes=2\n');
  assert.equal(loadConfig([], env).port, 5000);
  assert.equal(loadConfig([], env).abandonMs, 120_000);
  assert.equal(loadConfig(['--port', '6000'], env).port, 6000);
});

test('a non-numeric or out-of-range port or abandon time is a clear error, not NaN', () => {
  const env = { CLAUDE_CONFIG_DIR: tempDir('fv-conf-') };
  for (const port of ['abc', '', ' ', '70000', '1.5', '-1'])
    assert.throws(() => loadConfig(['--port', port], env), { message: `invalid --port: "${port}"` });
  for (const m of ['abc', '0', 'Infinity'])
    assert.throws(() => loadConfig(['--abandon-minutes', m], env), /invalid --abandon-minutes/);
  assert.equal(loadConfig(['--abandon-minutes', '0.5'], env).abandonMs, 30_000);
});

test('a flag given as the last argument with no value is an error, not the default', () => {
  const env = { CLAUDE_CONFIG_DIR: tempDir('fv-conf-') };
  assert.throws(() => loadConfig(['serve', '--port'], env), { message: 'missing value for --port' });
});

test('vite dev proxy targets the port from foreman-vision.conf, not a fixed 4780', async () => {
  const base = tempDir('fv-conf-');
  writeFileSync(join(base, 'foreman-vision.conf'), 'port=4791\n');
  const old = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = base;
  try {
    const { default: vite } = await import('../web/vite.config.ts');
    assert.equal((vite.server!.proxy!['/events'] as { target: string }).target, 'http://127.0.0.1:4791');
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = old;
  }
});

test('vite dev proxy: FV_PORT wins over foreman-vision.conf, for serve --port N', async () => {
  const base = tempDir('fv-conf-');
  writeFileSync(join(base, 'foreman-vision.conf'), 'port=4791\n');
  const old = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, FV_PORT: process.env.FV_PORT };
  Object.assign(process.env, { CLAUDE_CONFIG_DIR: base, FV_PORT: '4792' });
  try {
    const fresh = '../web/vite.config.ts?fv-port';   // a fresh copy: the import above is cached
    const { default: vite } = await import(fresh) as typeof import('../web/vite.config.ts');
    assert.equal((vite.server!.proxy!['/events'] as { target: string }).target, 'http://127.0.0.1:4792');
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('cli: a bad --port prints one line and exits 1, no stack trace', () => {
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'serve', '--port', 'abc'],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: tempDir('fv-conf-') } });
  assert.deepEqual([r.status, r.stderr.trim()], [1, 'invalid --port: "abc"']);
});
