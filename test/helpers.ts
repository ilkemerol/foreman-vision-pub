import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookPayload } from '../shared/types.ts';
import { reduce, type State } from '../src/reducer.ts';

const temps: string[] = [];
// node --test runs each file in its own process: its temp dirs go when it exits, whether the tests passed or not
process.on('exit', () => { for (const d of temps) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

/** A fresh dir under os.tmpdir(), removed when this test file's process exits. */
export function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

let clock = 1000;

/** Feed one hook event for session s1 (unless the payload names another). */
export function hook(state: State, event: string, p: Partial<HookPayload> = {}, ts = (clock += 100)) {
  return reduce(state, { kind: 'hook', line: { ts, event, payload: { session_id: 's1', ...p } } });
}

export const agentOf = (st: State, id: string, sid = 's1') => st.sessions.get(sid)!.agents.get(id)!;
