import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { agentOf, tempDir } from './helpers.ts';
import { createEngine } from '../src/engine.ts';
import { emptyState, reduce, type State } from '../src/reducer.ts';
import { readNew } from '../src/tail.ts';
import { scanTranscript } from '../src/transcript.ts';

function setup() {
  const root = tempDir('fv-engine-');
  const dirs = { spoolDir: join(root, 'spool'), stateDir: join(root, 'state') };
  mkdirSync(dirs.spoolDir);
  mkdirSync(dirs.stateDir);
  const transcript = join(root, 'projects', 'p', 's1.jsonl');
  const meta = join(root, 'projects', 'p', 's1', 'subagents');
  mkdirSync(meta, { recursive: true });
  const spool = (event: string, p: object = {}, ts = Date.now()) => appendFileSync(join(dirs.spoolDir, 's1.jsonl'),
    JSON.stringify({ ts, event, payload: { session_id: 's1', transcript_path: transcript, ...p } }) + '\n');
  return { dirs, transcript, meta, spool, engine: createEngine(dirs) };
}

test('spool: a half-written line waits for its newline; junk is counted', () => {
  const { dirs, engine } = setup();
  const file = join(dirs.spoolDir, 's1.jsonl');
  const line = JSON.stringify({ ts: 1, event: 'SessionStart', payload: { session_id: 's1' } });
  appendFileSync(file, line.slice(0, 20));
  engine.scan(0);
  assert.equal(engine.state.sessions.size, 0);
  appendFileSync(file, line.slice(20) + '\nnot json\n');
  engine.scan(0);
  engine.scan(0);
  assert.equal(engine.state.sessions.size, 1);
  assert.equal(engine.state.badLines, 1);
});

test('meta.json written after SubagentStart still binds on a later scan', () => {
  const { meta, spool, engine } = setup();
  spool('PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', label: 'late meta' });
  spool('SubagentStart', { agent_id: 'A1' });
  engine.scan(0);
  assert.ok(engine.state.sessions.get('s1')!.agents.has('pending:T1'));
  writeFileSync(join(meta, 'agent-A1.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 'T1' }));
  engine.scan(0);
  const s = engine.state.sessions.get('s1')!;
  assert.equal(s.agents.has('pending:T1'), false);
  assert.equal(s.agents.get('A1')!.description, 'late meta');
});

test('board and mode files feed the session; unchanged files are not re-applied', () => {
  const { dirs, spool, engine } = setup();
  spool('SessionStart');
  writeFileSync(join(dirs.stateDir, 'active-s1'), 'on');
  writeFileSync(join(dirs.stateDir, 'board-s1'), '1\t-\tExplore\tsearch\tqueued\t\n');
  engine.scan(0);
  const s = engine.state.sessions.get('s1')!;
  assert.deepEqual([s.foreman, s.board.length], ['on', 1]);
  const rows = s.board;
  engine.scan(0);
  assert.equal(s.board, rows); // same array: nothing re-applied
});

test('transcripts: model and tokens = the latest usage total, as the CLI shows it; a later scan without usage keeps it', () => {
  const { transcript, spool, engine } = setup();
  spool('SessionStart');
  const msg = (id: string, out: number) => JSON.stringify({ type: 'assistant',
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, cache_read_input_tokens: 1000, output_tokens: out } } }) + '\n';
  writeFileSync(transcript, msg('m1', 5) + msg('m1', 12));
  engine.scan(0);
  const main = engine.state.sessions.get('s1')!.agents.get('main')!;
  assert.equal(main.tokens, 1013);
  appendFileSync(transcript, msg('m2', 3));
  engine.scan(7);
  assert.deepEqual([main.model, main.tokens, main.transcriptAt], ['claude-opus-5-5', 1004, 7]);   // set, not added
  appendFileSync(transcript, JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n');
  engine.scan(8);
  assert.equal(main.tokens, 1004);
});

test('transcripts: a restart gives an agent that ended long before it the same tokens and model as live', () => {
  // A1 ended at 1 s with a transcript over two 8 MB chunks, A2 a minute before the restart at 30 min
  const MIN = 60_000, end = 30 * MIN;
  const { dirs, meta, spool } = setup();
  const usage = (id: string, out: number) => JSON.stringify({ type: 'assistant',
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, cache_read_input_tokens: 1000, output_tokens: out } } }) + '\n';
  const filler = (JSON.stringify({ type: 'user', text: 'x'.repeat(1000) }) + '\n').repeat(9 * 1024);
  writeFileSync(join(meta, 'agent-A1.jsonl'), usage('m1', 5) + filler + usage('m2', 9));
  writeFileSync(join(meta, 'agent-A2.jsonl'), usage('m3', 7));
  spool('SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 0);
  spool('SubagentStart', { agent_id: 'A2', agent_type: 'Explore' }, 0);
  spool('SubagentStop', { agent_id: 'A1' }, 1000);
  const live = createEngine(dirs);
  for (let t = 0; t < end - MIN; t += 5000) live.scan(t);
  spool('SubagentStop', { agent_id: 'A2' }, end - MIN);
  live.scan(end - MIN);
  const replay = createEngine(dirs);   // the restart: every scan after it is long past A1's end
  for (let t = end; t < end + 15_000; t += 5000) replay.scan(t);
  const facts = (st: State) => ['A1', 'A2'].map(id => {
    const a = st.sessions.get('s1')!.agents.get(id)!;
    return [a.hook, a.model, a.tokens];
  });
  assert.deepEqual(facts(replay.state), facts(live.state));
  assert.deepEqual(facts(live.state), [['stopped', 'claude-opus-5-5', 1010], ['stopped', 'claude-opus-5-5', 1008]]);
  appendFileSync(join(meta, 'agent-A1.jsonl'), usage('m4', 50));   // read to its end once: no reading afterwards
  replay.scan(end + 15_000);
  assert.equal(replay.state.sessions.get('s1')!.agents.get('A1')!.tokens, 1010);
});

test('sweep: ended sessions past the grace period and day-old spools are deleted; a fresh ended one is kept', () => {
  const { dirs, spool, engine } = setup();
  spool('SessionEnd');
  for (const sid of ['old', 'live']) appendFileSync(join(dirs.spoolDir, `${sid}.jsonl`),
    JSON.stringify({ ts: 1, event: 'SessionStart', payload: { session_id: sid } }) + '\n');
  appendFileSync(join(dirs.spoolDir, 'fresh.jsonl'),
    JSON.stringify({ ts: 1, event: 'SessionEnd', payload: { session_id: 'fresh' } }) + '\n');
  const ago = (ms: number) => (Date.now() - ms) / 1000;
  utimesSync(join(dirs.spoolDir, 'old.jsonl'), ago(25 * 3600_000), ago(25 * 3600_000));
  utimesSync(join(dirs.spoolDir, 's1.jsonl'), ago(120_000), ago(120_000));
  engine.scan(0);
  engine.sweep(Date.now());
  assert.deepEqual([...engine.state.sessions.keys()].sort(), ['fresh', 'live']);
  assert.equal(existsSync(join(dirs.spoolDir, 's1.jsonl')), false);
  assert.equal(existsSync(join(dirs.spoolDir, 'old.jsonl')), false);
  assert.equal(existsSync(join(dirs.spoolDir, 'fresh.jsonl')), true);
});

test('sweep: a session that comes back after its sweep counts its transcript from the start', () => {
  const { dirs, transcript, spool, engine } = setup();
  spool('SessionStart');
  const msg = (id: string, out: number) => JSON.stringify({ type: 'assistant',
    message: { id, model: 'm', usage: { output_tokens: out } } }) + '\n';
  writeFileSync(transcript, msg('m1', 5));
  engine.scan(1);
  spool('SessionEnd');
  const old = (Date.now() - 120_000) / 1000;
  utimesSync(join(dirs.spoolDir, 's1.jsonl'), old, old);
  engine.scan(1);
  engine.sweep(Date.now());
  assert.equal(engine.state.sessions.size, 0);
  spool('SessionStart');
  engine.scan(2);
  assert.equal(engine.state.sessions.get('s1')!.agents.get('main')!.tokens, 5);
});

test('readNew: bounded chunks; an over-long line is dropped, the rest still arrives', () => {
  const dir = tempDir('fv-tail-');
  const file = join(dir, 'f.jsonl');
  const text = 'aaaa\nbbbb\n' + 'x'.repeat(40) + '\ncccc\n';
  writeFileSync(file, text);
  const got: string[] = [];
  let offset = 0;
  for (let i = 0; i < 50 && offset < text.length; i++) {
    const r = readNew(file, offset, 16);
    assert.ok(r.offset - offset <= 16, `call ${i} advanced ${r.offset - offset} bytes`);
    got.push(...r.lines);
    offset = r.offset;
  }
  assert.equal(offset, text.length);
  assert.ok(got.includes('aaaa') && got.includes('bbbb') && got.includes('cccc'));
});

test('transcripts: a skipped over-long chunk is not reread on every scan', () => {
  const { transcript, spool, engine } = setup();
  spool('SessionStart');
  writeFileSync(transcript, 'x'.repeat(9 * 1024 * 1024) + '\n' + JSON.stringify({ message: { id: 'm1', usage: { output_tokens: 7 } } }) + '\n');
  for (let i = 0; i < 6; i++) engine.scan(i);
  assert.equal(engine.state.sessions.get('s1')!.agents.get('main')!.tokens, 7);
});

test('scanTranscript: context = input + cache read + cache creation of the last assistant usage; sidechain, synthetic and zero lines are skipped', () => {
  const line = (o: object) => JSON.stringify(o);
  const u = (id: string, input: number, read = 0, create = 0, extra: object = {}) => line({ type: 'assistant', ...extra,
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 9 } } });
  const scan = (...l: string[]) => scanTranscript(l).context;
  assert.equal(scan(), null);
  assert.deepEqual(scan(u('m1', 10, 50_000, 2_000)), { used: 52_010, peak: 52_010 });
  assert.deepEqual(scan(u('m1', 10, 50_000), u('m1', 10, 60_000)), { used: 60_010, peak: 60_010 });   // one message, several lines: the last counts
  assert.deepEqual(scan(u('m1', 5, 150_000), u('m2', 5, 250_000), u('m3', 3, 30_000)), { used: 30_003, peak: 250_005 });   // a compact drop: peak stays
  assert.deepEqual(scan(u('m1', 5, 40_000), u('s1', 5, 90_000, 0, { isSidechain: true }),
    line({ message: { id: 'x', model: '<synthetic>', usage: { input_tokens: 99_000 } } }), u('m2', 0, 0, 0)), { used: 40_005, peak: 40_005 });
  assert.deepEqual(scan(line({ message: { id: 'm1', usage: { input_tokens: 7 } } })), { used: 7, peak: 7 });   // missing fields are 0
});

test('scanTranscript: tokens = input + cache read + cache creation + output of the last usage; sidechain counts, synthetic and zero lines are skipped', () => {
  const line = (o: object) => JSON.stringify(o);
  const u = (id: string, input: number, read: number, create: number, out: number, extra: object = {}) => line({ type: 'assistant', ...extra,
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: out } } });
  const scan = (...l: string[]) => scanTranscript(l).tokens;
  assert.equal(scan(), null);
  assert.equal(scan(line({ type: 'user', message: { content: 'x' } })), null);
  assert.equal(scan(u('m1', 3, 60_000, 500, 2_275)), 62_778);
  assert.equal(scan(u('m1', 3, 60_000, 500, 10), u('m1', 3, 60_000, 500, 900)), 61_403);   // one message, several lines: the last counts
  assert.equal(scan(u('m1', 3, 150_000, 0, 50), u('m2', 3, 20_000, 0, 50)), 20_053);       // not a sum: a compact drop drops it
  assert.equal(scan(u('m1', 1, 1, 1, 1), u('s1', 5, 90_000, 0, 5, { isSidechain: true })), 90_010);   // a sub-agent's own lines
  assert.equal(scan(u('m1', 1, 1, 1, 1), line({ message: { id: 'x', model: '<synthetic>', usage: { input_tokens: 99_000 } } }), u('m2', 0, 0, 0, 0)), 4);
  assert.equal(scan(line({ message: { id: 'm1', usage: { output_tokens: 7 } } })), 7);   // missing fields are 0
});

test('transcripts: the session context comes from main\'s transcript only', () => {
  const { transcript, meta, spool, engine } = setup();
  spool('SessionStart');
  spool('SubagentStart', { agent_id: 'A1', agent_type: 'Explore' });
  const msg = (id: string, n: number) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage: { input_tokens: n, output_tokens: 1 } } }) + '\n';
  writeFileSync(join(meta, 'agent-A1.jsonl'), msg('a1', 90_000));
  engine.scan(0);
  assert.equal(engine.state.sessions.get('s1')!.context, null);
  writeFileSync(transcript, msg('m1', 50_000));
  engine.scan(1);
  assert.deepEqual(engine.state.sessions.get('s1')!.context, { used: 50_000, peak: 50_000 });
});

test('replay: a silence abandon and its return come back from the spool alone, as the live ticks gave them', () => {
  // A1 goes silent after 2000 and returns at 20 min; A2 goes silent after 1000 for good. Live ticks every 5 s
  const MIN = 60_000, abandonMs = 10 * MIN, end = 20 * MIN;
  const lines: [number, string, object][] = [
    [0, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }],
    [0, 'SubagentStart', { agent_id: 'A2', agent_type: 'Explore' }],
    [1000, 'PreToolUse', { agent_id: 'A2', tool_name: 'Read', tool_use_id: 'r2' }],
    [1000, 'PostToolUse', { agent_id: 'A2', tool_name: 'Read', tool_use_id: 'r2' }],
    [2000, 'PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r1' }],
    [2000, 'PostToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r1' }],
    [end, 'PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r3' }],
  ];
  const live = emptyState();
  for (let t = 0, i = 0; t <= end; t += 5000) {
    for (; i < lines.length && lines[i][0] <= t; i++) {
      const [ts, event, p] = lines[i];
      reduce(live, { kind: 'hook', line: { ts, event, payload: { session_id: 's1', ...p } } });
    }
    reduce(live, { kind: 'tick', now: t, abandonMs });
  }
  const { dirs, spool } = setup();
  for (const [ts, event, p] of lines) spool(event, p, ts);
  const engine = createEngine({ ...dirs, abandonMs });   // a restart: the spool at once, no ticks in between
  engine.scan(end);
  engine.tick(end, abandonMs);
  const facts = (st: State) => ['A1', 'A2'].map(id => {
    const a = st.sessions.get('s1')!.agents.get(id)!;
    return [a.hook, a.endedAt, a.activeSince, a.breaks];
  });
  assert.deepEqual(facts(engine.state), facts(live));
  assert.deepEqual(facts(live), [['running', null, end, [[2000 + abandonMs, end]]], ['abandoned', 1000 + abandonMs, null, []]]);
});

test('replay: an agent silent in hooks but writing its transcript is not abandoned, live or replayed', () => {
  // A1 sends no hook from 2000 to 20 min but writes its transcript every minute up to 15 min; A2 goes silent for good
  const MIN = 60_000, abandonMs = 10 * MIN, end = 20 * MIN;
  const lines: [number, string, object][] = [
    [0, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }],
    [0, 'SubagentStart', { agent_id: 'A2', agent_type: 'Explore' }],
    [1000, 'PreToolUse', { agent_id: 'A2', tool_name: 'Read', tool_use_id: 'r2' }],
    [1000, 'PostToolUse', { agent_id: 'A2', tool_name: 'Read', tool_use_id: 'r2' }],
    [2000, 'PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r1' }],
    [2000, 'PostToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r1' }],
    [end, 'PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r3' }],
  ];
  const writes = Array.from({ length: 15 }, (_, i) => (i + 1) * MIN);
  const { dirs, meta, spool } = setup();
  const live = createEngine({ ...dirs, abandonMs });   // the server: tick then scan every 5 s while both files grow
  for (let t = 0, i = 0, w = 0; t <= end; t += 5000) {
    for (; i < lines.length && lines[i][0] <= t; i++) spool(lines[i][1], lines[i][2], lines[i][0]);
    for (; w < writes.length && writes[w] <= t; w++) appendFileSync(join(meta, 'agent-A1.jsonl'), JSON.stringify({ type: 'assistant',
      timestamp: new Date(writes[w]).toISOString(), message: { id: 'm' + w, model: 'claude-opus-5-5', usage: { output_tokens: 1 } } }) + '\n');
    live.tick(t, abandonMs);
    live.scan(t);
  }
  const replay = createEngine({ ...dirs, abandonMs });   // a restart: the spool and the transcript at once
  replay.scan(end);
  replay.tick(end, abandonMs);
  const facts = (st: State) => ['A1', 'A2'].map(id => {
    const a = st.sessions.get('s1')!.agents.get(id)!;
    return [a.hook, a.endedAt, a.activeSince, a.breaks];
  });
  assert.deepEqual(facts(replay.state), facts(live.state));
  assert.deepEqual(facts(live.state), [['running', null, null, []], ['abandoned', 1000 + abandonMs, null, []]]);
});

test('replay: a restart inside a silence still abandons at last write + limit, as live', () => {
  // A1's last hook is at 2000 and its last transcript line at 3000; the server restarts 5 min into the silence
  const MIN = 60_000, abandonMs = 10 * MIN, restart = 3000 + 5 * MIN, end = 3000 + 15 * MIN;
  const { dirs, meta, spool } = setup();
  const write = (ts: number) => appendFileSync(join(meta, 'agent-A1.jsonl'), JSON.stringify({ type: 'assistant',
    timestamp: new Date(ts).toISOString(), message: { id: 'm' + ts, model: 'claude-opus-5-5', usage: { output_tokens: 1 } } }) + '\n');
  const live = createEngine({ ...dirs, abandonMs });
  let replay: ReturnType<typeof createEngine> | null = null;
  for (let t = 0; t <= end; t += 5000) {
    if (t === 0) spool('SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 0);
    if (t === 5000) { spool('PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r1' }, 2000);
      spool('PostToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r1' }, 2000); write(3000); }
    if (t === restart + 2000) replay = createEngine({ ...dirs, abandonMs });   // the spool and the transcript at once
    for (const e of replay ? [live, replay] : [live]) { e.tick(t, abandonMs); e.scan(t); }
  }
  const facts = (st: State) => { const a = st.sessions.get('s1')!.agents.get('A1')!; return [a.hook, a.endedAt, a.breaks]; };
  assert.deepEqual(facts(replay!.state), facts(live.state));
  assert.deepEqual(facts(live.state), ['abandoned', 3000 + abandonMs, []]);
});

test('tick: a session whose Claude process is gone without a SessionEnd ends; a live, unregistered, foreign or resumed one stays', () => {
  const root = tempDir('fv-gone-');
  const dirs = { spoolDir: join(root, 'spool'), stateDir: join(root, 'state'), sessionsDir: join(root, 'sessions') };
  for (const d of Object.values(dirs)) mkdirSync(d);
  const here = `${process.platform}:${hostname().toLowerCase()}`;
  const dead = spawnSync(process.execPath, ['-e', '']).pid!;   // exited: no process has this pid now
  let n = 0;
  const reg = (sessionId: string, pid: number, pidDomain = here) =>
    writeFileSync(join(dirs.sessionsDir, `${++n}.json`), JSON.stringify({ pid, sessionId, pidDomain, messagingSocketPath: 'x' }));
  for (const sid of ['killed', 'live', 'unregistered', 'foreign', 'resumed']) appendFileSync(join(dirs.spoolDir, `${sid}.jsonl`),
    JSON.stringify({ ts: 1, event: 'SessionStart', payload: { session_id: sid } }) + '\n');
  appendFileSync(join(dirs.spoolDir, 'killed.jsonl'), JSON.stringify({ ts: 2, event: 'SubagentStart', payload: { session_id: 'killed', agent_id: 'A', agent_type: 'Explore' } }) + '\n');
  reg('killed', dead);                     // a closed terminal: Claude Code's registry file stays behind
  reg('live', process.pid);                // also a dead pid reused by another process: it only keeps the floor
  reg('foreign', dead, 'linux:another');   // another machine's pid cannot be checked here
  reg('resumed', dead);                    // the killed process's file beside the resumed one's
  reg('resumed', process.pid);
  writeFileSync(join(dirs.sessionsDir, `${++n}.json`), '{"pid":');   // a file being rewritten
  const engine = createEngine(dirs);
  engine.scan(10);
  engine.tick(10, 600_000);
  const ended = Object.fromEntries([...engine.state.sessions.values()].map(s => [s.sid, s.ended]));
  assert.deepEqual(ended, { killed: true, live: false, unregistered: false, foreign: false, resumed: false });
  assert.deepEqual([agentOf(engine.state, 'A', 'killed').hook, agentOf(engine.state, 'A', 'killed').endedAt], ['abandoned', 10]);   // as a SessionEnd does
  const fresh = createEngine({ spoolDir: dirs.spoolDir, stateDir: dirs.stateDir });   // no registry: today's rules
  fresh.scan(10);
  fresh.tick(10, 600_000);
  assert.equal(fresh.state.sessions.get('killed')!.ended, false);
});

test('tick: a session seen in the registry ends once its file is gone (the next Claude Code start sweeps a dead pid\'s) or names another session; a torn file or one never seen keeps it', () => {
  const root = tempDir('fv-vanished-');
  const dirs = { spoolDir: join(root, 'spool'), stateDir: join(root, 'state'), sessionsDir: join(root, 'sessions') };
  for (const d of Object.values(dirs)) mkdirSync(d);
  const here = `${process.platform}:${hostname().toLowerCase()}`;
  const seen = ['crashed', 'torn', 'switched'];
  const kids = seen.map(() => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));   // live pids, one file each
  try {
    const pid = (sid: string) => kids[seen.indexOf(sid)].pid!;
    const file = (sid: string) => join(dirs.sessionsDir, `${pid(sid)}.json`);
    for (const sid of [...seen, 'unregistered']) appendFileSync(join(dirs.spoolDir, `${sid}.jsonl`),
      JSON.stringify({ ts: 1, event: 'SessionStart', payload: { session_id: sid } }) + '\n');
    for (const sid of seen) writeFileSync(file(sid), JSON.stringify({ pid: pid(sid), sessionId: sid, pidDomain: here }));
    const engine = createEngine(dirs);
    engine.scan(10);
    engine.tick(10, 600_000);   // all live: each pid is remembered
    assert.deepEqual([...seen, 'unregistered'].map(sid => engine.state.sessions.get(sid)!.pid), [...seen.map(pid), undefined]);
    unlinkSync(file('crashed'));                // a power loss: the next Claude Code start swept the dead pid's file
    writeFileSync(file('torn'), '{"pid":');     // being rewritten in place
    writeFileSync(file('switched'), JSON.stringify({ pid: pid('switched'), sessionId: 'next', pidDomain: here }));   // /clear, or the pid reused
    engine.tick(20, 600_000);
    const ended = Object.fromEntries([...engine.state.sessions.values()].map(s => [s.sid, s.ended]));
    assert.deepEqual(ended, { crashed: true, torn: false, switched: true, unregistered: false });
  } finally {
    for (const k of kids) k.kill();
  }
});
