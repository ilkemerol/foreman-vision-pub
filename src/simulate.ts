import { randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HookPayload } from '../shared/types.ts';
import { flag, num, type Config } from './config.ts';
import { doneScenario, fireScenario, hybridScenario, pixelScenario, type ScriptFloor } from './scenario.ts';
import { serve } from './server.ts';

/** A spool line, a foreman board snapshot a recorded session saw (event "__board"), a board end (event "__end", as
 *  foreman-state.sh end), a main context use (event "__usage"), or a sub-agent's tokens, its context now (event "__agentOut"). */
export type FixtureLine = { ts: number; event: string; payload: HookPayload & { text?: string; used?: number; out?: number } };

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
  const rows = line.event === 'PreToolUse'
    ? [{ type: 'assistant', timestamp, message: { content: [{ type: 'text', text: `Next: ${tool}${label ? ' ' + label : ''}` }, { type: 'tool_use', id, name: tool, input: { description: label ?? '' } }] } }]
    : [{ type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: line.event === 'PostToolUseFailure',
        content: line.event === 'PostToolUse' ? `${tool} ✓\n${label ?? ''}`.trim() : `${tool} failed` }] } }];
  const file = aid ? join(root, 'projects', sid, 'subagents', `agent-${aid}.jsonl`) : join(root, 'projects', `${sid}.jsonl`);
  appendFileSync(file, rows.map(r => JSON.stringify(r) + '\n').join(''));
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

const SCENARIOS: Record<string, () => ScriptFloor[]> = { pixel: pixelScenario, hybrid: hybridScenario, done: doneScenario, fire: fireScenario };

/** `--scenario <name>`: scripted floors (pixel: the office tour, hybrid: crowded floors, done: a full Done lounge, fire: the server-room fire), each line placed at (startAt + at) / speed. */
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
      setTimeout(() => place(root, f.sid, line, Date.now() - (l.backdate ?? 0)), (f.startAt + l.at) / speed);
    }
  }
}
