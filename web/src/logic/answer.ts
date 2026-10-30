import type { AskQuestion } from '../../../shared/types.ts';

/** One question's state in the pop-up's answer area: the options picked and the Other box's text as typed. */
export interface Pick { labels: string[]; other: string }

export const blank = (qs: AskQuestion[]): Pick[] => qs.map(() => ({ labels: [], other: '' }));

const set = (p: Pick[], i: number, v: Pick) => p.map((x, k) => (k === i ? v : x));

/** Single-select: that option, Other cleared; multi-select: the option toggled. */
export function pick(qs: AskQuestion[], p: Pick[], i: number, label: string): Pick[] {
  if (!qs[i].multiSelect) return set(p, i, { labels: [label], other: '' });
  const on = p[i].labels.includes(label);
  return set(p, i, { ...p[i], labels: on ? p[i].labels.filter(l => l !== label) : [...p[i].labels, label] });
}

/** Other's text; on a single-select question a non-empty text clears the option. */
export function other(qs: AskQuestion[], p: Pick[], i: number, text: string): Pick[] {
  return set(p, i, { labels: !qs[i].multiSelect && text.trim() ? [] : p[i].labels, other: text });
}

/** Question text → answer, null until every question has one: single its label or Other; multi the labels in option order, Other last, ", ". */
export function answers(qs: AskQuestion[], p: Pick[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [i, q] of qs.entries()) {
    const parts = [...q.options.map(o => o.label).filter(l => p[i].labels.includes(l)), p[i].other.trim()].filter(Boolean);
    if (!parts.length) return null;
    out[q.question] = parts.join(', ');
  }
  return out;
}

const KEEP = 20;
const drafts = new Map<string, Pick[]>();

/** Question `id`'s half-made picks, so closing the pop-up or opening another agent keeps them while it is open. */
export const draft = (id: string, qs: AskQuestion[]): Pick[] => drafts.get(id) ?? blank(qs);

/** Keep question `id`'s picks; null drops them (sent). */
export function keep(id: string, p: Pick[] | null) {
  drafts.delete(id);
  if (p) drafts.set(id, p);
  // shortcut: a question answered in the terminal keeps its draft until KEEP newer ones push it out; prune by the open asks if that ever matters
  if (drafts.size > KEEP) drafts.delete(drafts.keys().next().value!);
}

export const recommended = (label: string) => /\(Recommended\)\s*$/i.test(label);
