import type { TermLine } from '../../../shared/types.ts';
import { diffCount, lineDiff } from './diff.ts';
import { t } from './i18n.ts';

/** A transcript line, or a tool call with its result paired by id; `key` the id (or '#<index>' for a result without one). */
export type TermItem = { line: TermLine } | { key: string; tool: TermLine | null; out: TermLine | null };

export function termItems(lines: TermLine[]): TermItem[] {
  const items: TermItem[] = [], calls = new Map<string, { key: string; tool: TermLine | null; out: TermLine | null }>();
  lines.forEach((l, i) => {
    if (l.kind === 'tool' && l.id) {
      const b = { key: l.id, tool: l, out: null };
      calls.set(l.id, b);
      items.push(b);
    } else if (l.kind === 'out' || l.kind === 'err') {
      const b = l.id ? calls.get(l.id) : undefined;
      if (b && !b.out) b.out = l;
      else items.push({ key: l.id && !b ? l.id : '#' + i, tool: null, out: l });
    } else items.push({ line: l });
  });
  return items;
}

/** The collapsed result under a tool line: `more` hidden lines for "… +N", `open` whether a click shows more. null: no result yet. */
export interface Brief { text: string; more: number; open: boolean }

const rows = (s: string) => s.replace(/(\r?\n)+$/, '').split(/\r?\n/);
const firstFull = (s: string) => rows(s).find(r => r.trim()) ?? '';
const ROW_CHARS = 300, OUTCOME_CHARS = 200;
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
const images = (l: TermLine) => Array(l.images ?? 0).fill(t('term.image')).join(' ');

export function brief(tool: TermLine | null, out: TermLine | null): Brief | null {
  if (!out) return null;
  if (!out.text) return { text: images(out) || t('term.none'), more: 0, open: false };
  const head = (): Brief => {
    const r = rows(out.text), more = Math.max(0, r.length - 3) + (out.more ?? 0), shown = r.slice(0, 3).map(x => clamp(x, ROW_CHARS));
    // a long row is cut too: one 20 000-char line wraps to hundreds of rows
    return { text: shown.join('\n'), more, open: more > 0 || shown.some((x, i) => x !== r[i]) };
  };
  const name = tool?.name, edits = tool?.edits;
  let b: Brief;
  if (out.kind === 'err') b = head();
  // shortcut: the server's cut `more` also counts the trailing <system-reminder> lines, a few too many on a big read
  else if (name === 'Read') b = { text: t('term.read', { n: rows(out.text).filter(r => /^\s*\d+[\t→]/.test(r)).length + (out.more ?? 0) }), more: 0, open: true };
  else if ((name === 'Edit' || name === 'MultiEdit') && edits) {
    const c = edits.map(e => diffCount(lineDiff(e.old, e.new))).reduce((s, d) => ({ add: s.add + d.add, del: s.del + d.del }), { add: 0, del: 0 });
    b = { text: t('term.diff', { a: c.add, d: c.del }), more: 0, open: true };
  } else if (name === 'Write' && edits) b = { text: t('term.wrote', { n: edits.reduce((s, e) => s + (e.new ? rows(e.new).length : 0), 0) + (tool!.more ?? 0) }), more: 0, open: true };
  else if (name === 'Grep' || name === 'Glob') {
    const found = /^Found (\d+)/.exec(out.text);
    const n = found ? Number(found[1]) : /^No (files|matches) found/.test(out.text) ? 0 : rows(out.text).filter(r => r.trim()).length;
    b = { text: t('term.found', { n }), more: 0, open: n > 0 };
  } else b = head();
  const im = images(out);
  return im ? { ...b, text: b.text + ' ' + im } : b;
}

const SUMMED = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'Grep', 'Glob']);

/** The card's one-line result; null: no result yet. */
export function outcome(tool: TermLine | null, out: TermLine | null): string | null {
  if (!out) return null;
  const line = out.kind === 'err' ? firstFull(out.text)
    : !out.text || SUMMED.has(tool?.name ?? '') ? brief(tool, out)!.text
    : tool?.name === 'Bash' ? out.last ?? rows(out.text).filter(r => r.trim()).at(-1) ?? ''
    : firstFull(out.text);
  return clamp(line, OUTCOME_CHARS);
}

/** A label or path with the session folder dropped (either slash, any case), as the CLI shows it. */
export function shortPath(label: string, cwd: string | null): string {
  if (!cwd) return label;
  const slash = (s: string) => s.replace(/\\/g, '/'), l = slash(label), c = slash(cwd).replace(/\/+$/, '') + '/';
  // slashes are evened out only to compare: a label outside the folder (a Bash command) keeps its backslashes
  return l.toLowerCase().startsWith(c.toLowerCase()) ? l.slice(c.length) : label;
}
