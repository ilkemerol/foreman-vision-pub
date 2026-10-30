import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.ts';
import { addHooks, ASK_TIMEOUT_S, EVENTS, hookBash, type Settings } from '../src/install.ts';

const ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url))).replaceAll('\\', '/').replace(/\/$/, '');
const FV = 'bash "${CLAUDE_PLUGIN_ROOT}/hook/fv-hook.sh"';

test('the plugin hooks cover the events and matchers install writes, each running fv-hook.sh with no spool arg, and the answer hook with no port file arg', () => {
  const plugin: Settings = JSON.parse(readFileSync(join(ROOT, 'hook/hooks.json'), 'utf8'));
  const installed = addHooks({}, 'x', 'y');
  assert.deepEqual(Object.keys(plugin.hooks!), [...EVENTS]);
  for (const ev of EVENTS) {
    assert.deepEqual(plugin.hooks![ev].map(g => g.matcher), installed.hooks![ev].map(g => g.matcher), ev);
    const g = plugin.hooks![ev].at(-1)!;
    assert.equal(g.hooks[0].command, FV, ev);
    assert.deepEqual(g.hooks.slice(1).map(h => h.command), ev === 'SessionStart' ? ['bash "${CLAUDE_PLUGIN_ROOT}/hook/plugin-root.sh"'] : [], ev);
  }
  assert.deepEqual(plugin.hooks!.PermissionRequest[0].hooks, [{ type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hook/fv-ask.sh"', timeout: ASK_TIMEOUT_S }]);
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.hooks, './hook/hooks.json');
});

test('plugin-root.sh writes the plugin folder to <config>/foreman-vision/plugin-root, only when it changed, silently', () => {
  const cfg = tempDir('fv-root-');
  const marker = join(cfg, 'foreman-vision', 'plugin-root');
  const run = () => spawnSync(hookBash(), [join(ROOT, 'hook/plugin-root.sh')], {
    input: '{"session_id":"s1","hook_event_name":"SessionStart"}', encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg.replaceAll('\\', '/') },
  });
  let r = run();
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  assert.equal(readFileSync(marker, 'utf8'), ROOT);
  utimesSync(marker, 1000, 1000);
  run();
  assert.equal(statSync(marker).mtimeMs, 1000 * 1000);   // same content: not rewritten
  writeFileSync(marker, '/old/plugin/version');
  r = run();
  assert.equal(r.status, 0);
  assert.equal(readFileSync(marker, 'utf8'), ROOT);
});
