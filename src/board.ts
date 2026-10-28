import type { BoardStage, ForemanMode } from '../shared/types.ts';
import type { BoardRow } from './reducer.ts';

const STAGES = new Set<string>(['queued', 'running', 'waiting', 'verifying', 'done', 'failed']);

/** foreman's board-<sid>: TSV rows `n, agentId|-, type, job, stage, note`. A bad row is skipped. */
export function parseBoard(text: string): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t');
    if (c.length !== 6 || !/^\d+$/.test(c[0]) || !STAGES.has(c[4])) continue;
    rows.push({ n: Number(c[0]), agentId: c[1] === '-' ? null : c[1], type: c[2], job: c[3], stage: c[4] as BoardStage, note: c[5] });
  }
  return rows;
}

/** foreman's active-<sid>: "on" or "task"; missing means off. */
export function parseMode(text: string | null): ForemanMode {
  const m = (text ?? '').trim().toLowerCase();
  return m === 'on' || m === 'task' ? m : 'off';
}
