import type { ContextUse } from '../shared/types.ts';

interface Usage { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number }

/**
 * Tokens, model and context use from new transcript lines; synthetic and zero lines are skipped.
 * Tokens (as the CLI's agent line shows them): input + cache read + cache creation + output of the last
 * valid usage, sidechain lines too (a sub-agent's own); null when these lines have none. One assistant message spans
 * several lines with the same id and growing usage: the last line wins.
 * Context: input + cache read + cache creation of the last valid usage, sidechain skipped.
 */
export function scanTranscript(lines: string[]): { model: string | null; tokens: number | null; context: ContextUse | null } {
  let model: string | null = null;
  let tokens: number | null = null;
  let context: ContextUse | null = null;
  let peak = 0;
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let o: { isSidechain?: boolean; message?: { id?: string; model?: string; usage?: Usage } };
    try { o = JSON.parse(line); } catch { continue; }
    const m = o?.message;
    if (!m?.usage) continue;
    if (m.model) model = m.model;
    if (m.model === '<synthetic>') continue;
    const u = m.usage;
    const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const total = used + (u.output_tokens ?? 0);
    if (total > 0) tokens = total;
    if (o.isSidechain !== true && used > 0) context = { used, peak: (peak = Math.max(peak, used)) };
  }
  return { model, tokens, context };
}
