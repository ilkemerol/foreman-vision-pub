import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A, hookIn, input, tempDir } from './helpers.ts';
import { decision } from '../src/ask.ts';
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

const ASK = fileURLToPath(new URL('../hook/fv-ask.sh', import.meta.url));

/** fv-ask.sh with this port file (null: none, as the plugin runs it) and stdin. spawn, not spawnSync: the server it posts to runs in this process. */
function ask(portFile: string | null, stdin: string, env: NodeJS.ProcessEnv = process.env) {
  return new Promise<{ code: number | null; stdout: string; ms: number }>((ok, fail) => {
    const t = Date.now();
    const c = spawn(BASH, portFile === null ? [ASK] : [ASK, portFile.replaceAll('\\', '/')], { env });
    let stdout = '';
    c.stdout.setEncoding('utf8').on('data', d => { stdout += d; });
    c.on('error', fail).on('close', code => ok({ code, stdout, ms: Date.now() - t }));
    c.stdin.end(stdin);
  });
}

test('fv-ask.sh: no port file or nothing listening on it: prints nothing, exit 0, within 3 s', { timeout: 15_000 }, async () => {
  const dir = tempDir('fv-ask-');
  const closed = createServer();
  await new Promise<void>(ok => closed.listen(0, '127.0.0.1', ok));
  const port = (closed.address() as AddressInfo).port;
  await new Promise(ok => closed.close(ok));
  writeFileSync(join(dir, 'port'), `${port}\r\n`);
  for (const file of [join(dir, 'none'), join(dir, 'port')]) {
    const r = await ask(file, JSON.stringify(hookIn()));
    assert.deepEqual([r.code, r.stdout], [0, ''], file);
    assert.ok(r.ms < 3000, `${file}: ${r.ms} ms`);
  }
});

test('fv-ask.sh: posts stdin to 127.0.0.1:<port>/api/ask with the header, past an http_proxy / all_proxy; prints only an allow with its updatedInput, anything else (extra fields dropped, a deny, not JSON, 204, 403) nothing', { timeout: 30_000 }, async () => {
  const seen: { method?: string; url?: string; header?: string | string[]; body: string }[] = [];
  let reply: [number, string] = [200, ''];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', c => { body += c; }).on('end', () => {
      seen.push({ method: req.method, url: req.url, header: req.headers['x-foreman-vision'], body });
      res.writeHead(reply[0], { 'content-type': 'application/json' }).end(reply[1]);
    });
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  try {
    const file = join(tempDir('fv-ask-'), 'port');
    writeFileSync(file, String((server.address() as AddressInfo).port));
    const stdin = JSON.stringify(hookIn({ tool_input: { questions: [{ question: 'run it? "yes" — ✓', options: [{ label: 'Yes' }] }] } }));
    const good = decision(input, A), want = JSON.parse(good);
    const escalate = JSON.stringify({ x: 1, hookSpecificOutput: { hookEventName: 'PermissionRequest', extra: 1,
      decision: { behavior: 'allow', updatedInput: { ...input, answers: A }, updatedPermissions: [{ type: 'setMode', mode: 'bypassPermissions' }] } } });
    const deny = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', updatedInput: input } } });
    for (const [s, body, out] of [[200, good, want], [200, escalate, want], [200, deny, null], [200, 'not json', null], [200, '{"ok":1}', null],
      [204, '', null], [403, '', null]] as const) {
      reply = [s, body];
      const r = await ask(file, stdin);
      assert.deepEqual([r.code, r.stdout.trim() ? JSON.parse(r.stdout) : null], [0, out], body);
    }
    reply = [200, good];
    const proxy = 'http://127.0.0.1:1';
    const r = await ask(file, stdin, { ...process.env, http_proxy: proxy, HTTP_PROXY: proxy, all_proxy: proxy, ALL_PROXY: proxy, no_proxy: '', NO_PROXY: '' });
    assert.deepEqual([r.code, r.stdout.trim() && JSON.parse(r.stdout)], [0, want], 'proxy');
    // no port file argument (the plugin): <config>/foreman-vision/port
    const cfg = tempDir('fv-cfg-');
    mkdirSync(join(cfg, 'foreman-vision'));
    writeFileSync(join(cfg, 'foreman-vision', 'port'), String((server.address() as AddressInfo).port));
    const p = await ask(null, stdin, { ...process.env, CLAUDE_CONFIG_DIR: cfg.replaceAll('\\', '/') });
    assert.deepEqual([p.code, p.stdout.trim() && JSON.parse(p.stdout)], [0, want], 'plugin');
    assert.equal(seen.length, 9);
    for (const x of seen) assert.deepEqual(x, { method: 'POST', url: '/api/ask', header: '1', body: stdin });
  } finally {
    server.close();
  }
});
