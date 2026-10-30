import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookPayload, Snapshot, SseMessage } from '../shared/types.ts';
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

/** Reads one SSE snapshot frame per call. */
export function sseReader(res: Response) {
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

// AskUserQuestion fixtures: two questions, main's PermissionRequest hook input, their answers
export const Q = [{ question: 'Which color?', header: 'Color', options: [{ label: 'Blue', description: 'blue' }, { label: 'Red' }], multiSelect: false },
  { question: 'Which ones?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }];
export const input = { questions: Q, metadata: { source: 'x' } };
export const hookIn = (o: object = {}) => ({ session_id: 's1', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: input, permission_mode: 'default', ...o });
export const A = { 'Which color?': 'Blue', 'Which ones?': 'A, B' };
