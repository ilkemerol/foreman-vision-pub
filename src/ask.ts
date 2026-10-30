import type { AskQuestion } from '../shared/types.ts';
import type { SessionFacts } from './reducer.ts';

/** The longest answer the pop-up may give one question (characters). */
export const ANSWER_MAX = 4000;

/** Main's AskUserQuestion the answer hook (hook/fv-ask.sh) handed over; input: tool_input as it came. */
export interface Ask { sid: string; input: Record<string, unknown>; questions: AskQuestion[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The hook's PermissionRequest input when it is main's AskUserQuestion with 1–4 well-formed questions of distinct
 *  texts; null: no decision. */
export function askOf(body: unknown): Ask | null {
  // a falsy agent_id is main's, as in the reducer
  if (!isObj(body) || body.hook_event_name !== 'PermissionRequest' || body.tool_name !== 'AskUserQuestion'
    || typeof body.session_id !== 'string' || body.agent_id || !isObj(body.tool_input)) return null;
  const qs = body.tool_input.questions;
  if (!Array.isArray(qs) || qs.length < 1 || qs.length > 4) return null;
  const questions: AskQuestion[] = [];
  for (const q of qs) {
    if (!isObj(q) || typeof q.question !== 'string' || !q.question.trim() || (q.header !== undefined && typeof q.header !== 'string')
      || (q.multiSelect !== undefined && typeof q.multiSelect !== 'boolean')
      || !Array.isArray(q.options) || !q.options.length || !q.options.every(o => isObj(o) && typeof o.label === 'string')) return null;
    questions.push({
      question: q.question,
      ...(q.header !== undefined && { header: q.header as string }),
      options: (q.options as Record<string, unknown>[]).map(o => ({
        label: o.label as string, ...(typeof o.description === 'string' && { description: o.description }),
      })),
      multiSelect: q.multiSelect === true,
    });
  }
  if (new Set(questions.map(q => q.question)).size !== questions.length) return null;
  return { sid: body.session_id, input: body.tool_input, questions };
}

/** The pop-up's `{ answers }`: exactly one non-empty answer of at most ANSWER_MAX characters per question text. */
export function answersOf(questions: AskQuestion[], body: unknown): Record<string, string> | null {
  const a = isObj(body) ? body.answers : null;
  if (!isObj(a) || Object.keys(a).length !== questions.length) return null;
  const out: Record<string, string> = {};
  for (const { question } of questions) {
    const v = Object.hasOwn(a, question) ? a[question] : undefined;
    if (typeof v !== 'string' || !v.trim() || v.length > ANSWER_MAX) return null;
    out[question] = v;
  }
  return out;
}

/** The hook's stdout: allow, the tool input whole with the answers added, as the terminal's own dialog answers it. */
export function decision(input: Record<string, unknown>, answers: Record<string, string>): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { ...input, answers } } } });
}

/** Main of a live foreman session is still inside its AskUserQuestion. Sets p.waited once main is seen in its question
 *  wait; after that, leaving the wait (Esc, then a new prompt: no PostToolUse comes) closes it. The dialog's
 *  permission_prompt Notification can recast the wait's reason, so only the hook stage counts, never the reason.
 *  p.tool: main's newest AskUserQuestion when the question is first checked (its PreToolUse just came); an older
 *  one cancelled with Esc stays in activeTools (no PostToolUse) and must not keep this question open. */
export function stillOpen(p: { waited: boolean; tool?: string }, s: SessionFacts | undefined): boolean {
  const main = s?.agents.get('main');
  if (!s || !main || s.ended || s.foreman === 'off') return false;
  p.tool ??= main.activeTools.findLast(t => t.name === 'AskUserQuestion')?.id;
  if (!main.activeTools.some(t => t.name === 'AskUserQuestion' && t.id === p.tool)) return false;
  if (main.hook === 'waiting') p.waited = true;
  return main.hook === 'waiting' || !p.waited;
}
