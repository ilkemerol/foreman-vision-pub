import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { tempDir } from './helpers.ts';
import { DONE_STAY_MS, type AgentView, type Snapshot, type SseMessage, type TermPage } from '../shared/types.ts';
import { serve } from '../src/server.ts';

function sseReader(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return async (): Promise<Snapshot> => {
    for (;;) {
      const end = buf.indexOf('\n\n');
      if (end >= 0) {
        const frame = buf.slice(0, end);
        buf = buf.slice(end + 2);
        if (frame.startsWith('data: ')) return (JSON.parse(frame.slice(6)) as SseMessage).data;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SSE closed');
      buf += dec.decode(value, { stream: true });
    }
  };
}

test('SSE: snapshot on connect, update after a spool line, localhost only', { timeout: 15_000 }, async () => {
  const root = tempDir('fv-server-');
  const cfg = { port: 0, abandonMs: 600_000, spoolDir: join(root, 'spool'), stateDir: join(root, 'state'), settingsPath: join(root, 'settings.json') };
  const running = await serve(cfg);
  try {
    assert.equal(running.host, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${running.port}/events`);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const next = sseReader(res);
    assert.deepEqual((await next()).sessions, []);
    appendFileSync(join(cfg.spoolDir, 's1.jsonl'),
      JSON.stringify({ ts: Date.now(), event: 'SessionStart', payload: { session_id: 's1', cwd: '/w/proj' } }) + '\n');
    let snap: Snapshot;
    do snap = await next(); while (snap.sessions.length === 0);
    assert.equal(snap.sessions[0].project, 'proj');
    assert.equal((await fetch(`http://127.0.0.1:${running.port}/nope`)).status, 404);
  } finally {
    running.stop();
  }
});

test('serve rejects with a clear message when the port is busy', { timeout: 5000 }, async () => {
  const root = tempDir('fv-server-');
  const cfg = { port: 0, abandonMs: 600_000, spoolDir: join(root, 'spool'), stateDir: join(root, 'state'), settingsPath: join(root, 'settings.json') };
  const running = await serve(cfg);
  try {
    await assert.rejects(serve({ ...cfg, port: running.port }), /in use/);
  } finally {
    running.stop();
  }
});

/** GET with a chosen Host header: fetch() does not let us set Host. */
function get(port: number, path: string, host = `127.0.0.1:${port}`) {
  return new Promise<{ status: number; type: string | undefined; body: string }>((ok, fail) => {
    request({ host: '127.0.0.1', port, path, headers: { host } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => ok({ status: res.statusCode!, type: res.headers['content-type'], body }));
    }).on('error', fail).end();
  });
}

function cfgIn(root: string) {
  return { port: 0, abandonMs: 600_000, spoolDir: join(root, 'spool'), stateDir: join(root, 'state'), settingsPath: join(root, 'settings.json') };
}

test('static: serves web/dist, rejects a foreign Host and paths that escape it', { timeout: 10_000 }, async () => {
  const root = tempDir('fv-static-');
  const web = join(root, 'web');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>fv</title>');
  writeFileSync(join(web, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'secret.txt'), 'classified');
  const running = await serve(cfgIn(root), web);
  try {
    const p = running.port;
    const home = await get(p, '/');
    assert.equal(home.status, 200);
    assert.match(home.type!, /text\/html/);
    assert.match(home.body, /<title>fv/);
    assert.match((await get(p, '/assets/app.js')).type!, /javascript/);
    assert.equal((await get(p, '/', `localhost:${p}`)).status, 200);
    assert.equal((await get(p, '/', `LOCALHOST:${p}`)).status, 200);
    assert.equal((await get(p, '/', 'evil.example')).status, 403);
    assert.equal((await get(p, '/events', `evil.example:${p}`)).status, 403);
    assert.equal((await get(p, '/', `127.0.0.1:${p + 1}`)).status, 403);
    assert.equal((await get(p, '/..%2Fsecret.txt')).status, 404);
    assert.equal((await get(p, '/assets/../../secret.txt')).status, 404);
    assert.equal((await get(p, '/missing.js')).status, 404);
    assert.equal((await get(p, '/%E0%A4%A')).status, 400);
  } finally {
    running.stop();
  }
});

test('static: without a build, / says how to make one', { timeout: 5000 }, async () => {
  const root = tempDir('fv-static-');
  const running = await serve(cfgIn(root), join(root, 'no-dist'));
  try {
    const home = await get(running.port, '/');
    assert.equal(home.status, 503);
    assert.match(home.body, /npm run build/);
  } finally {
    running.stop();
  }
});

test('SSE: a client that stops reading skips to the newest snapshot instead of queueing every frame', { timeout: 60_000 }, async () => {
  const root = tempDir('fv-server-');
  const cfg = cfgIn(root);
  mkdirSync(cfg.spoolDir, { recursive: true });
  const start = (sid: string, cwd = '/w/' + sid) => appendFileSync(join(cfg.spoolDir, `${sid}.jsonl`),
    JSON.stringify({ ts: Date.now(), event: 'SessionStart', payload: { session_id: sid, cwd } }) + '\n');
  start('big', '/w/' + 'x'.repeat(2_000_000));   // ~4 MB a frame (cwd and project): a few fill the socket buffers
  const running = await serve(cfg);
  const sock = connect(running.port, '127.0.0.1');
  try {
    sock.setEncoding('utf8');
    sock.write(`GET /events HTTP/1.1\r\nHost: 127.0.0.1:${running.port}\r\n\r\n`);
    sock.pause();
    const UPDATES = 12;
    for (let i = 0; i < UPDATES; i++) { start(`s${i}`); await sleep(300); }   // one flush each (200 ms throttle)
    let text = '';
    const MARK = 'data: {"type":"snapshot"';
    await new Promise<void>((ok, fail) => {
      sock.on('data', (c: string) => {
        text += c;
        const last = text.slice(text.lastIndexOf(MARK));   // chunked: the frame is followed by \r\n, not the end
        if (last.includes('\n\n') && last.includes(`"sid":"s${UPDATES - 1}"`)) ok();
      });
      sock.on('close', () => fail(new Error('SSE closed')));
      sock.setTimeout(20_000, () => sock.destroy());
      sock.resume();
    });
    const frames = text.split(MARK).length - 1;
    assert.ok(frames <= UPDATES / 2, `${frames} frames for ${UPDATES} updates`);
  } finally {
    sock.destroy();
    running.stop();
  }
});

test('restart: Done lounge leave times and stages survive it, so a leave is not moved earlier; a swept session\'s go', { timeout: 30_000 }, async () => {
  const root = tempDir('fv-server-');
  const cfg = cfgIn(root);
  mkdirSync(cfg.spoolDir, { recursive: true });
  mkdirSync(cfg.stateDir, { recursive: true });
  const spool = join(cfg.spoolDir, 's1.jsonl');
  const line = (ts: number, event: string, p: object = {}) =>
    appendFileSync(spool, JSON.stringify({ ts, event, payload: { session_id: 's1', ...p } }) + '\n');
  const now = Date.now();
  line(now - 200_000, 'SessionStart');
  line(now - 200_000, 'SubagentStart', { agent_id: 'H', agent_type: 'Explore' });   // a helper never on the board
  writeFileSync(join(cfg.stateDir, 'active-s1'), 'on');
  writeFileSync(join(cfg.stateDir, 'board-s1'), '1\t-\tgp\tjob\trunning\t\n');
  const h = async (running: { port: number }, until: (a: AgentView) => boolean) => {
    const next = sseReader(await fetch(`http://127.0.0.1:${running.port}/events`));
    for (;;) {
      const a = (await next()).sessions[0]?.agents.find(x => x.id === 'H');
      if (a && until(a)) return a;
    }
  };
  let running = await serve(cfg);
  let before: AgentView;
  try {
    await h(running, a => a.stage === 'running');
    line(now - 120_000, 'SubagentStop', { agent_id: 'H' });   // seen live: the "-" row holds it
    const done = await h(running, a => a.stage === 'done');
    assert.equal(done.leaveAt, done.stageSince + DONE_STAY_MS);   // only its ten minutes count
    writeFileSync(join(cfg.stateDir, 'board-s1'), '');   // the row goes: 60 s from now
    before = await h(running, a => a.leaveAt !== a.stageSince + DONE_STAY_MS);
    assert.ok(before.leaveAt! > Date.now());
  } finally {
    running.stop();
  }
  running = await serve(cfg);
  try {
    const after = await h(running, () => true);   // without the memory: first sight, ended 2 min ago, gone at once
    assert.deepEqual([after.leaveAt, after.stageSince], [before.leaveAt, before.stageSince]);
    line(Date.now(), 'PreToolUse', { agent_id: 'H', tool_name: 'Read', tool_use_id: 'r' });   // resumed: its desk went at the done seen live
    assert.equal((await h(running, a => a.breaks.length > 0)).breaks[0][0], before.stageSince);
  } finally {
    running.stop();
  }
  running = await serve(cfg);
  try {   // a past break's release survives a restart too
    assert.equal((await h(running, () => true)).breaks[0][0], before.stageSince);
  } finally {
    running.stop();
  }
  unlinkSync(spool);   // swept
  running = await serve(cfg);
  try {
    await fetch(`http://127.0.0.1:${running.port}/events`).then(r => sseReader(r)());
    assert.doesNotMatch(readFileSync(join(cfg.stateDir, 'foreman-vision-view.json'), 'utf8'), /s1/);
  } finally {
    running.stop();
  }
});

test('floor API: foremen list, hide/show behind the header, kept over a restart, a new SessionStart shows it again', { timeout: 30_000 }, async () => {
  const root = tempDir('fv-server-');
  const cfg = cfgIn(root);
  mkdirSync(cfg.spoolDir, { recursive: true });
  mkdirSync(cfg.stateDir, { recursive: true });
  const line = (sid: string, event: string, ts = Date.now()) =>
    appendFileSync(join(cfg.spoolDir, `${sid}.jsonl`), JSON.stringify({ ts, event, payload: { session_id: sid } }) + '\n');
  for (const sid of ['f1', 'plain', 'gone']) line(sid, 'SessionStart', Date.now() - 5000);
  line('gone', 'SessionEnd', Date.now() - 4000);
  for (const sid of ['f1', 'gone']) writeFileSync(join(cfg.stateDir, `active-${sid}`), 'on');
  const floor = async (running: { port: number }, sid: string, until: (h: number | null) => boolean) => {
    const next = sseReader(await fetch(`http://127.0.0.1:${running.port}/events`));
    for (;;) { const s = (await next()).sessions.find(x => x.sid === sid); if (s && until(s.hiddenAt)) return s.hiddenAt; }
  };
  const post = (running: { port: number }, path: string, header = true) =>
    fetch(`http://127.0.0.1:${running.port}${path}`, { method: 'POST', headers: header ? { 'X-Foreman-Vision': '1' } : {} }).then(r => r.status);
  let running = await serve(cfg);
  let at: number | null;
  try {
    const foremen = await fetch(`http://127.0.0.1:${running.port}/api/foremen`);
    assert.match(foremen.headers.get('content-type')!, /json/);
    assert.deepEqual(await foremen.json(), { sessions: ['f1'] });   // plain is off, gone ended
    assert.equal(await floor(running, 'f1', () => true), null);
    assert.equal(await post(running, '/api/floors/f1/hide', false), 403);
    assert.equal((await get(running.port, '/api/floors/f1/hide')).status, 405);
    assert.equal((await get(running.port, '/api/foremen', 'evil.example')).status, 403);
    assert.equal(await post(running, '/api/floors/f1/hide'), 204);
    assert.equal(await post(running, '/api/floors/early/hide'), 204);   // not seen yet: kept for when it shows up
    at = await floor(running, 'f1', h => h !== null);
    assert.ok(Math.abs(at! - Date.now()) < 5000);
    assert.equal(await post(running, '/api/floors/f1/hide'), 204);   // again: the first time stays
    assert.equal(await floor(running, 'f1', () => true), at);
  } finally {
    running.stop();
  }
  running = await serve(cfg);
  try {
    assert.equal(await floor(running, 'f1', () => true), at);
    line('early', 'SessionStart', at! - 1000);   // its start is older than the hide (a late read): stays hidden
    assert.notEqual(await floor(running, 'early', () => true), null);
    assert.equal(await post(running, '/api/floors/f1/show'), 204);
    assert.equal(await floor(running, 'f1', h => h === null), null);
    assert.equal(await post(running, '/api/floors/f1/hide'), 204);
    await floor(running, 'f1', h => h !== null);
    line('f1', 'SessionStart', Date.now() + 1);   // resumed: shown again
    assert.equal(await floor(running, 'f1', h => h === null), null);
  } finally {
    running.stop();
  }
  const saved = JSON.parse(readFileSync(join(cfg.stateDir, 'foreman-vision-view.json'), 'utf8'));
  assert.equal(saved.f1.hiddenAt, undefined);
  assert.equal(typeof saved.early.hiddenAt, 'number');
});

test('term API: behind the header, only a live session\'s agent, the tail first, then from the cursor, reset when the file shrank', { timeout: 15_000 }, async () => {
  const root = tempDir('fv-term-');
  const cfg = { ...cfgIn(root), sessionsDir: join(root, 'sessions') };
  for (const d of [cfg.spoolDir, cfg.sessionsDir, join(root, 'p', 's1', 'subagents')]) mkdirSync(d, { recursive: true });
  const main = join(root, 'p', 's1.jsonl'), sub = join(root, 'p', 's1', 'subagents', 'agent-a1.jsonl');
  for (const [event, p] of [['SessionStart', { transcript_path: main }], ['SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }]] as const)
    appendFileSync(join(cfg.spoolDir, 's1.jsonl'), JSON.stringify({ ts: Date.now(), event, payload: { session_id: 's1', ...p } }) + '\n');
  writeFileSync(join(cfg.sessionsDir, '123.json'), JSON.stringify({ pid: 123, sessionId: 's1', bridgeSessionId: 'session_01Abc', messagingSocketPath: 'classified' }));
  const text = (s: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: s }] } }) + '\n';
  writeFileSync(main, text('main says'));
  let big = '';
  for (let i = 0; big.length < 600_000; i++) big += text(`line ${i} ${'x'.repeat(100)}`);
  writeFileSync(sub, big);
  const running = await serve(cfg);
  const term = async (query: string, header = true) => {
    const r = await fetch(`http://127.0.0.1:${running.port}/api/term?${query}`, { headers: header ? { 'X-Foreman-Vision': '1' } : {} });
    return { status: r.status, cors: r.headers.get('access-control-allow-origin'), page: r.ok ? await r.json() as TermPage : null };
  };
  try {
    assert.equal((await term('session=s1&agent=a1', false)).status, 403);
    assert.equal((await get(running.port, '/api/term?session=s1&agent=a1')).status, 403);
    for (const q of ['session=nope&agent=a1', 'session=s1&agent=nope', 'session=s1&agent=pending:x', 'session=s1', 'agent=a1'])
      assert.equal((await term(q)).status, 404, q);
    for (const q of ['session=s1&agent=a1&from=-1', 'session=s1&agent=a1&from=1.5', 'session=s1&agent=a1&from=abc'])
      assert.equal((await term(q)).status, 400, q);

    const first = await term('session=s1&agent=a1');
    assert.equal(first.cors, null);
    const p = first.page!;
    assert.equal(p.cursor, Buffer.byteLength(big));
    assert.equal(p.remote, 'https://claude.ai/code/session_01Abc');
    assert.doesNotMatch(JSON.stringify(p), /classified/);
    assert.ok(p.lines.length > 1000 && p.lines.length < 2500, `${p.lines.length} lines from the last 256 KB`);
    assert.match(p.lines.at(-1)!.text, /^line \d+ x/);
    assert.ok(p.lines.every(l => l.kind === 'text'));   // the cut's half line dropped out

    appendFileSync(sub, text('new'));
    const next = (await term(`session=s1&agent=a1&from=${p.cursor}`)).page!;
    assert.deepEqual(next.lines, [{ kind: 'text', text: 'new' }]);
    assert.equal(next.remote, undefined);
    assert.deepEqual((await term(`session=s1&agent=a1&from=${next.cursor}`)).page, { lines: [], cursor: next.cursor });

    writeFileSync(sub, text('anew'));   // replaced by a shorter file
    assert.deepEqual((await term(`session=s1&agent=a1&from=${next.cursor}`)).page, { lines: [{ kind: 'text', text: 'anew' }], cursor: Buffer.byteLength(text('anew')), reset: true });

    assert.deepEqual((await term('session=s1&agent=main')).page!.lines, [{ kind: 'text', text: 'main says' }]);
  } finally {
    running.stop();
  }
});

test('an ended floor goes on the tick once its 60 s grace is over, not at the hourly sweep', { timeout: 20_000 }, async () => {
  const root = tempDir('fv-server-');
  const cfg = cfgIn(root);
  mkdirSync(cfg.spoolDir, { recursive: true });
  const spool = join(cfg.spoolDir, 's1.jsonl');
  const line = (event: string) => appendFileSync(spool, JSON.stringify({ ts: Date.now(), event, payload: { session_id: 's1' } }) + '\n');
  line('SessionStart');
  const running = await serve(cfg);
  try {
    const next = sseReader(await fetch(`http://127.0.0.1:${running.port}/events`));
    line('SessionEnd');   // Ctrl+C at the prompt sends it too (reason prompt_input_exit)
    let snap: Snapshot;
    do snap = await next(); while (!snap.sessions[0]?.ended);   // faded
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(spool, old, old);   // its grace is over
    do snap = await next(); while (snap.sessions.length);
    assert.equal(existsSync(spool), false);
  } finally {
    running.stop();
  }
});

test('restart: a session whose remembered pid has no registry file ends on the first tick; a live one\'s pid is kept (power loss)', { timeout: 15_000 }, async () => {
  const root = tempDir('fv-server-');
  const cfg = { ...cfgIn(root), sessionsDir: join(root, 'sessions') };
  for (const d of [cfg.spoolDir, cfg.stateDir, cfg.sessionsDir]) mkdirSync(d, { recursive: true });
  for (const sid of ['ghost', 'live']) {
    appendFileSync(join(cfg.spoolDir, `${sid}.jsonl`), JSON.stringify({ ts: Date.now() - 5000, event: 'SessionStart', payload: { session_id: sid } }) + '\n');
    writeFileSync(join(cfg.stateDir, `active-${sid}`), 'on');
  }
  // the ghost was seen live before the machine went down; Claude Code's next start swept its pid's file
  writeFileSync(join(cfg.stateDir, 'foreman-vision-view.json'), JSON.stringify({ ghost: { stages: [], leave: [], holds: [], pid: 4242 } }));
  writeFileSync(join(cfg.sessionsDir, `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: 'live', pidDomain: `${process.platform}:${hostname().toLowerCase()}` }));
  const running = await serve(cfg);
  try {
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${running.port}/api/foremen`)).json(), { sessions: ['live'] });
    const snap = await sseReader(await fetch(`http://127.0.0.1:${running.port}/events`))();
    assert.equal(snap.sessions.find(s => s.sid === 'ghost')!.ended, true);
    assert.equal(JSON.parse(readFileSync(join(cfg.stateDir, 'foreman-vision-view.json'), 'utf8')).live.pid, process.pid);
  } finally {
    running.stop();
  }
});
