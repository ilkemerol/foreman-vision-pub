import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AskQuestion, TermLine, TermPage } from '../shared/types.ts';
import { readNew } from './tail.ts';

const TAIL_BYTES = 256 * 1024;   // a first look reads this much of the end: transcripts run to tens of MB
const CHUNK = 1024 * 1024;       // at most this much a call after that
const OUT_LINES = 400;      // a tool result shows its first lines, "+N lines" for the rest
const MAX_CHARS = 20_000;   // any text, so one long output cannot fill the terminal
const INPUT_CHARS = 200;

type Block = { type?: string; text?: unknown; name?: unknown; id?: unknown; tool_use_id?: unknown; input?: unknown; content?: unknown; is_error?: unknown };

const cut = (s: string, n = MAX_CHARS) => (s.length > n ? s.slice(0, n) + '…' : s);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A text's first OUT_LINES lines (cut at MAX_CHARS), the count of lines after them, and its last line when either cut dropped it. */
function clip(text: string): { head: string; more: number; last?: string } {
  const all = text.replace(/\s+$/, '').split('\n');
  const lines = text.trim() ? all.slice(0, OUT_LINES) : [];
  const joined = lines.join('\n');
  const head = cut(joined);
  const more = lines.length ? all.length - lines.length : 0;
  return more > 0 || head !== joined ? { head, more, last: cut(all[all.length - 1], INPUT_CHARS) } : { head, more };
}

/** A content value's text and image count: a string, or an array of text / image blocks. */
function flatten(c: unknown): { text: string; images: number } {
  if (typeof c === 'string') return { text: c, images: 0 };
  if (!Array.isArray(c)) return { text: '', images: 0 };
  const texts: string[] = [];
  let images = 0;
  for (const b of c as Block[]) {
    if (b?.type === 'image') images++;
    else if (typeof b?.text === 'string') texts.push(b.text);
  }
  return { text: texts.join('\n'), images };
}

/** A tool input in short, the same fields fv-hook.sh labels with. */
function summary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const v = [o.command, o.description, o.file_path, o.pattern, o.url, o.skill, o.prompt,
    Array.isArray(o.questions) ? (o.questions[0] as { question?: unknown })?.question : undefined].find(x => typeof x === 'string') as string | undefined;
  return cut((v ?? '').replace(/\s+/g, ' ').trim(), INPUT_CHARS);
}

/** AskUserQuestion's questions for the terminal's list, header, labels and descriptions cut; a malformed question or option is left out. */
function questions(qs: unknown[]): AskQuestion[] {
  const obj = (v: unknown) => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
  return qs.map(obj).filter(q => typeof q.question === 'string').map(q => ({
    question: cut(q.question as string),
    ...(typeof q.header === 'string' && { header: cut(q.header, INPUT_CHARS) }),
    options: (Array.isArray(q.options) ? q.options : []).map(obj).filter(o => typeof o.label === 'string').map(o => ({
      label: cut(o.label as string, INPUT_CHARS), ...(typeof o.description === 'string' && { description: cut(o.description, INPUT_CHARS) }),
    })),
    multiSelect: q.multiSelect === true,
  }));
}

function result(b: Block): TermLine {
  const { text, images } = flatten(b.content);
  const { head, more, last } = clip(text);
  const line: TermLine = { kind: b.is_error === true ? 'err' : 'out', text: head };
  if (typeof b.tool_use_id === 'string') line.id = b.tool_use_id;
  if (more) line.more = more;
  if (last !== undefined) line.last = last;
  if (images) line.images = images;
  return line;
}

/** A tool call: its input in short, for Edit / MultiEdit / Write the text the pop-up's diff shows, for AskUserQuestion its questions. */
function call(b: Block & { name: string }): TermLine {
  const line: TermLine = { kind: 'tool', name: b.name, text: summary(b.input) };
  if (typeof b.id === 'string') line.id = b.id;
  const o = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
  // shortcut: Edit/MultiEdit sides are cut only at MAX_CHARS, so an edit past 20 000 chars diffs what was sent; move to a line cut if a real case shows up
  const edit = (e: { old_string?: unknown; new_string?: unknown } | null) => ({ old: cut(str(e?.old_string)), new: cut(str(e?.new_string)) });
  if (b.name === 'Edit') line.edits = [edit(o)];
  else if (b.name === 'MultiEdit') line.edits = (Array.isArray(o.edits) ? o.edits : []).map(edit);
  else if (b.name === 'Write') {
    const { head, more } = clip(str(o.content));
    line.edits = [{ old: '', new: head }];
    if (more) line.more = more;
  } else if (b.name === 'AskUserQuestion' && Array.isArray(o.questions)) {
    const qs = questions(o.questions);
    if (qs.length) line.questions = qs;
  }
  return line;
}

/** Transcript lines (JSONL) → terminal lines: assistant text and tool calls, tool results, the user's and queued
 *  messages. Thinking (empty in transcripts), meta messages, other attachments and api-request* lines are left out. */
export function termLines(raw: string[]): TermLine[] {
  const out: TermLine[] = [];
  for (const r of raw) {
    if (r.startsWith('{"type":"api-request')) continue;   // 2.1.310 request dumps: a third of the bytes, nothing to show
    let o: { type?: string; isMeta?: boolean; message?: { content?: unknown }; attachment?: { type?: string; prompt?: unknown; origin?: { kind?: unknown } } };
    try { o = JSON.parse(r); } catch { continue; }   // a half line after a cut
    if (o?.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content as Block[]) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ kind: 'text', text: cut(b.text.trim()) });
        else if (b?.type === 'tool_use' && typeof b.name === 'string') out.push(call(b as Block & { name: string }));
      }
    } else if (o?.type === 'user' && !o.isMeta) {
      const c = o.message?.content;
      if (Array.isArray(c) && (c as Block[]).some(b => b?.type === 'tool_result')) {
        for (const b of c as Block[]) if (b?.type === 'tool_result') out.push(result(b));
      } else {
        const { text } = flatten(c);
        if (text.trim()) out.push({ kind: 'user', from: 'prompt', text: cut(text.trim()) });
      }
    } else if (o?.type === 'attachment' && o.attachment?.type === 'queued_command') {
      const { text } = flatten(o.attachment.prompt);
      const kind = o.attachment.origin?.kind;
      if (text.trim()) out.push({ kind: 'user', from: typeof kind === 'string' ? kind : 'queued', text: cut(text.trim()) });
    }
  }
  return out;
}

/** The terminal lines of `path` after byte `from`; `from` null (or past the end: the file shrank) reads its last
 *  TAIL_BYTES. The half line such a cut starts in fails JSON.parse and drops out. */
export function termPage(path: string, from: number | null, chunk = CHUNK): TermPage {
  let size: number;
  try { size = statSync(path).size; } catch { return { lines: [], cursor: 0 }; }   // not written yet
  const reset = from !== null && from > size;
  const start = from === null || reset ? Math.max(0, size - TAIL_BYTES) : from;
  const r = readNew(path, start, chunk);
  const page: TermPage = { lines: termLines(r.lines), cursor: r.offset };
  if (!r.lines.length && r.offset > start) page.lines.push({ kind: 'big', text: '' });   // a whole chunk without a newline: readNew skipped it
  if (reset) page.reset = true;
  return page;
}

/** Claude Code's session registry (`<config>/sessions/<pid>.json`), one parsed object per file; the `.key` files are
 *  never read. Callers take only the fields they need, never the messaging socket. */
export function registry(dir: string | undefined): Record<string, unknown>[] {
  if (!dir) return [];
  let files: string[];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return []; }
  const out: Record<string, unknown>[] = [];
  for (const f of files) {
    try {
      const o = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (o && typeof o === 'object') out.push(o);
    } catch { /* a file being rewritten: the next look sees it */ }
  }
  return out;
}

/** Session `sid`'s Remote Control link from the registry (bridgeSessionId); only the id goes out. */
export function remoteLink(dir: string | undefined, sid: string): string | undefined {
  const id = registry(dir).find(o => o.sessionId === sid && typeof o.bridgeSessionId === 'string' && /^session_\w+$/.test(o.bridgeSessionId))?.bridgeSessionId;
  return id ? `https://claude.ai/code/${id}` : undefined;
}
