import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { hookBash } from '../src/install.ts';

const HOOK = fileURLToPath(new URL('../hook/fv-hook.sh', import.meta.url));
const BASH = hookBash();   // the bash Claude Code runs the hook in, never WSL's

function run(input: unknown) {
  const dir = tempDir('fv-hook-');
  const r = spawnSync(BASH, [HOOK, dir.replaceAll('\\', '/')], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  });
  const file = join(dir, 's1.jsonl');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return { r, text, lines: text.split('\n').filter(Boolean).map(l => JSON.parse(l)) };
}

test('PreToolUse: one trimmed line, silent stdout, exit 0', () => {
  const { r, lines } = run({
    session_id: 's1', hook_event_name: 'PreToolUse', cwd: '/w/proj', transcript_path: '/t/s1.jsonl',
    tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: 'npm test', description: 'Run tests' },
    permission_mode: 'default',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, 'PreToolUse');
  assert.equal(typeof lines[0].ts, 'number');
  assert.deepEqual(lines[0].payload, {
    session_id: 's1', cwd: '/w/proj', tool_name: 'Bash', tool_use_id: 'toolu_1',
    transcript_path: '/t/s1.jsonl', label: 'npm test',
  });
});

test('long multiline non-ASCII input stays one valid line under 4KB', () => {
  const big = 'naïve café ñ 日本語\n"quoted"\t'.repeat(500);
  const { r, text, lines } = run({
    session_id: 's1', hook_event_name: 'Notification', notification_type: 'permission_prompt',
    message: big, tool_input: { command: big },
  });
  assert.equal(r.status, 0);
  assert.equal(text.split('\n').length, 2); // one line + trailing newline
  assert.ok(Buffer.byteLength(text) < 4096);
  assert.ok(lines[0].payload.message.endsWith('…'));
  assert.equal(lines[0].payload.notification_type, 'permission_prompt');
});

test('Agent call fields and tool_response agentId; a string tool_response is harmless', () => {
  const post = run({
    session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_2',
    tool_input: { description: 'read files', subagent_type: 'Explore', run_in_background: true, prompt: 'long' },
    tool_response: { agentId: 'a123', status: 'async_launched' },
  });
  assert.deepEqual(
    [post.lines[0].payload.label, post.lines[0].payload.subagent_type, post.lines[0].payload.background, post.lines[0].payload.response_agent_id],
    ['read files', 'Explore', true, 'a123'],
  );
  const str = run({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: 'text' });
  assert.equal(str.r.status, 0);
  assert.equal(str.lines[0].payload.response_agent_id, undefined);
});

test('no session id or broken JSON: nothing written, exit 0, silent', () => {
  for (const input of [{ hook_event_name: 'Stop' }, '{not json']) {
    const { r, text } = run(input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(text, '');
  }
});

test('a non-string command or message gives no label or message', () => {
  const { lines } = run({
    session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'X', tool_use_id: 't1',
    tool_input: { command: { a: 1 } }, message: { b: 2 },
  });
  assert.equal(lines.length, 1);
  assert.equal('label' in lines[0].payload, false);
  assert.equal('message' in lines[0].payload, false);
});

test('without a spool arg (the plugin): spool-dir from foreman-vision.conf, else <config>/foreman-vision/spool', () => {
  const cfg = tempDir('fv-cfg-');
  const runIn = () => spawnSync(BASH, [HOOK], {
    input: JSON.stringify({ session_id: 's1', hook_event_name: 'Stop' }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg.replaceAll('\\', '/') },
  });
  assert.equal(runIn().stdout, '');
  assert.ok(existsSync(join(cfg, 'foreman-vision', 'spool', 's1.jsonl')));
  const own = join(cfg, 'my spool');
  writeFileSync(join(cfg, 'foreman-vision.conf'), `port=4799\r\n# spool-dir=/nowhere\r\n  spool-dir = ${own}  \r\n`);
  assert.equal(loadConfig([], { CLAUDE_CONFIG_DIR: cfg }).spoolDir, own);   // the server reads the same folder
  assert.equal(runIn().status, 0);
  assert.equal(readFileSync(join(own, 's1.jsonl'), 'utf8').split('\n').filter(Boolean).length, 1);
});
