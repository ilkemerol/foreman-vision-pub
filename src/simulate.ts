import { randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AskQuestion, HookPayload } from '../shared/types.ts';
import { flag, num, type Config } from './config.ts';
import { askScenario, doneScenario, fireScenario, hybridScenario, pixelScenario, type ScriptFloor } from './scenario.ts';
import { serve } from './server.ts';

/** A spool line, a foreman board snapshot a recorded session saw (event "__board"), a board end (event "__end", as
 *  foreman-state.sh end), a main context use (event "__usage"), a sub-agent's tokens, its context now (event "__agentOut"),
 *  or an AskUserQuestion (event "__ask", see askLine). A tool line's `input` and `output` replace the sample call and result. */
export type FixtureLine = { ts: number; event: string; payload: HookPayload & { text?: string; used?: number; out?: number;
  input?: Record<string, unknown>; output?: string; questions?: AskQuestion[]; terminal?: number } };

const FIXTURES = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
const MAX_GAP_MS = 5000; // long idle stretches in a recording are cut to 5 s

export function loadFixture(path: string): FixtureLine[] {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** Directories for session `sid` under `root`, with the fixture's subagent meta.json files; returns the subagents dir. */
export function sandbox(root: string, sid: string, fixturePath?: string) {
  for (const d of ['spool', 'state']) mkdirSync(join(root, d), { recursive: true });
  const dest = join(root, 'projects', sid, 'subagents');
  mkdirSync(dest, { recursive: true });
  const metas = fixturePath && join(fixturePath.replace(/\.jsonl$/, ''), 'subagents');
  if (metas && existsSync(metas)) for (const f of readdirSync(metas)) copyFileSync(join(metas, f), join(dest, f));
  return dest;
}

/** A tool call's input and its result texts as the CLI writes them, so the simulated pop-up terminal looks real. */
function sample(tool: string, label: string): { input: object; ok: string; fail: string } {
  const fail = `${tool} failed`;
  switch (tool) {
    case 'Bash': return { input: { command: label, description: 'Run ' + label },
      ok: [...Array.from({ length: 9 }, (_, i) => `✔ test ${i + 1}`), 'ℹ tests 9', 'ℹ pass 9', 'ℹ fail 0'].join('\n'),
      fail: 'Exit code 1\n✖ test 3 failed\nℹ fail 1' };
    case 'Read': return { input: { file_path: label }, ok: Array.from({ length: 140 }, (_, i) => `${i + 1}\t// line ${i + 1}`).join('\n'), fail };
    case 'Edit': return { input: { file_path: label, old_string: 'const a = 1;\nconst b = 2;\nexport { a };', new_string: 'const a = 1;\nconst b = 3;\nconst c = 4;\nexport { a, c };' },
      ok: `The file ${label} has been updated successfully.`, fail };
    case 'Grep': return { input: { pattern: label }, ok: 'Found 3 files\nsrc/view.ts\nsrc/server.ts\nshared/types.ts', fail };
    case 'Glob': return { input: { pattern: label }, ok: 'src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts', fail };
    default: return { input: { description: label }, ok: `${tool} ✓\n${label}`.trim(), fail };
  }
}

export function place(root: string, sid: string, line: FixtureLine, ts: number) {
  if (line.event === '__board') {
    writeFileSync(join(root, 'state', `board-${sid}`), line.payload.text ?? '');
    writeFileSync(join(root, 'state', `active-${sid}`), 'on');
    return;
  }
  if (line.event === '__end') {
    for (const f of [`board-${sid}`, `active-${sid}`]) rmSync(join(root, 'state', f), { force: true });
    return;
  }
  if (line.event === '__usage') {
    const used = line.payload.used ?? 0;
    const message = { id: `sim-${ts}-${used}`, model: 'claude-opus-5-5',
      usage: { input_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: used - 4, output_tokens: 40 } };
    appendFileSync(join(root, 'projects', `${sid}.jsonl`), JSON.stringify({ type: 'assistant', message }) + '\n');
    return;
  }
  if (line.event === '__agentOut') {
    const out = line.payload.out ?? 0;
    const message = { id: `sim-out-${randomUUID()}`, model: 'claude-opus-5-5',
      usage: { input_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: out - 44, output_tokens: 40 } };
    appendFileSync(join(root, 'projects', sid, 'subagents', `agent-${line.payload.agent_id}.jsonl`), JSON.stringify({ type: 'assistant', message }) + '\n');
    return;
  }
  const payload = { ...line.payload, session_id: sid, transcript_path: join(root, 'projects', `${sid}.jsonl`) };
  appendFileSync(join(root, 'spool', `${sid}.jsonl`), JSON.stringify({ ts, event: line.event, payload }) + '\n');
  // the pop-up terminal (GET /api/term) reads the transcript: each tool call and its result, as Claude Code writes them
  const { agent_id: aid, tool_name: tool, tool_use_id: id, label } = line.payload;
  if (!tool || !['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(line.event)) return;
  const timestamp = new Date(ts).toISOString();
  const s = sample(tool, label ?? '');
  const rows = line.event === 'PreToolUse'
    ? [{ type: 'assistant', timestamp, message: { content: [{ type: 'text', text: `Next: ${tool}${label ? ' ' + label : ''}` }, { type: 'tool_use', id, name: tool, input: line.payload.input ?? s.input }] } }]
    : [{ type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: line.event === 'PostToolUseFailure',
        content: line.payload.output ?? (line.event === 'PostToolUse' ? s.ok : s.fail) }] } }];
  const file = aid ? join(root, 'projects', sid, 'subagents', `agent-${aid}.jsonl`) : join(root, 'projects', `${sid}.jsonl`);
  appendFileSync(file, rows.map(r => JSON.stringify(r) + '\n').join(''));
}

/** The tool result Claude Code writes for an answered AskUserQuestion. */
const answered = (a: Record<string, string>) =>
  `Your questions have been answered: ${Object.entries(a).map(([q, v]) => `"${q}"="${v}"`).join(', ')}. You can now continue with these answers in mind.`;

/** `--scenario ask`'s "__ask" line: returns the server's answer to the hook's request (200 answered from the pop-up, 204 no decision). */
export async function askLine(root: string, sid: string, line: FixtureLine, port: number): Promise<number> {
  const { questions = [], terminal, ...rest } = line.payload;
  const p = { ...rest, tool_name: 'AskUserQuestion', input: { questions } };
  const post = (a: Record<string, string>) => place(root, sid, { ...line, event: 'PostToolUse', payload: { ...p, output: answered(a) } }, Date.now());
  for (const event of ['PreToolUse', 'PermissionRequest']) place(root, sid, { ...line, event, payload: p }, Date.now());
  // answered in the terminal: each question takes its first option
  const timer = terminal === undefined ? undefined
    : setTimeout(() => post(Object.fromEntries(questions.map(q => [q.question, q.options[0].label]))), terminal);
  // what hook/fv-ask.sh sends
  const r = await fetch(`http://127.0.0.1:${port}/api/ask`, { method: 'POST', headers: { 'X-Foreman-Vision': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sid, hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions },
      ...(p.agent_id && { agent_id: p.agent_id }) }) });
  if (r.status === 200) {
    clearTimeout(timer);   // the pop-up answered: no second PostToolUse for this tool_use_id
    const { answers } = (await r.json()).hookSpecificOutput.decision.updatedInput as { answers: Record<string, string> };
    post(answers);
    console.log(`question answered (${sid}):`, answers);
  }
  return r.status;
}

/** Serve a sandbox and replay fixtures into it in real time, one floor per fixture copy (or per scenario floor). */
export async function simulate(cfg: Config, args: string[]) {
  const speed = num('speed', flag(args, 'speed'), 1, n => n > 0 && Number.isFinite(n));
  const copies = num('copies', flag(args, 'copies'), 1, n => Number.isInteger(n) && n >= 1);
  const scenario = flag(args, 'scenario');
  if (scenario) return playScenario(cfg, scenario, speed);
  const named = args.filter(a => a.endsWith('.jsonl'));
  const files = named.length ? named : readdirSync(FIXTURES).filter(f => f.endsWith('.jsonl')).map(f => join(FIXTURES, f));
  const root = mkdtempSync(join(tmpdir(), 'fv-sim-'));
  const plan: { sid: string; file: string }[] = [];
  for (let c = 0; c < copies; c++) for (const file of files) plan.push({ sid: `sim${plan.length}-${basename(file, '.jsonl')}`, file });
  for (const p of plan) sandbox(root, p.sid, p.file);
  const { port } = await serve({ ...cfg, spoolDir: join(root, 'spool'), stateDir: join(root, 'state') });
  console.log(`simulation: http://127.0.0.1:${port}/ · ${plan.length} floors · sandbox ${root}`);
  plan.forEach(({ sid, file }, i) => {
    let at = i * 3000; // floors open 3 s apart
    let prev: number | null = null;
    for (const line of loadFixture(file)) {
      // concurrent hooks append slightly out of ts order: clamp negative gaps, keep file order
      at += Math.min(Math.max(0, prev === null ? 0 : line.ts - prev), MAX_GAP_MS) / speed;
      prev = line.ts;
      setTimeout(() => place(root, sid, line, Date.now()), at);
    }
  });
}

const SCENARIOS: Record<string, () => ScriptFloor[]> = { pixel: pixelScenario, hybrid: hybridScenario, done: doneScenario, fire: fireScenario, ask: askScenario };

/** `--scenario <name>`: scripted floors (pixel: the office tour, hybrid: crowded floors, done: a full Done lounge, fire: the server-room fire,
 *  ask: answering questions from the pop-up), each line placed at (startAt + at) / speed. */
async function playScenario(cfg: Config, name: string, speed: number) {
  const make = Object.hasOwn(SCENARIOS, name) ? SCENARIOS[name] : undefined;
  if (!make) throw new Error(`unknown scenario: ${name} (available: ${Object.keys(SCENARIOS).join(', ')})`);
  const floors = make();
  const root = mkdtempSync(join(tmpdir(), 'fv-sim-'));
  for (const f of floors) {
    const dir = sandbox(root, f.sid);
    for (const [agentId, toolUseId] of Object.entries(f.metas)) writeFileSync(join(dir, `agent-${agentId}.meta.json`), JSON.stringify({ toolUseId }));
  }
  const { port } = await serve({ ...cfg, spoolDir: join(root, 'spool'), stateDir: join(root, 'state') });
  console.log(`simulation: http://127.0.0.1:${port}/ · ${floors.length} floors · sandbox ${root}`);
  for (const f of floors) {
    if (f.foreman) writeFileSync(join(root, 'state', `active-${f.sid}`), 'on');
    for (const l of f.lines) {
      const line = { ts: 0, event: l.event, payload: { ...l.payload, session_id: f.sid, cwd: f.cwd } };
      setTimeout(() => {
        // shortcut: fetch gives up on a question unanswered for 5 min (undici's headers timeout), as Esc would; enough for a demo
        if (l.event === '__ask') askLine(root, f.sid, line, port).catch(e => console.error(`question (${f.sid}): ${(e as Error).message}`));
        else place(root, f.sid, line, Date.now() - (l.backdate ?? 0));
      }, (f.startAt + l.at) / speed);
    }
  }
}
