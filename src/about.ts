import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

/** The `version:` under `metadata:` in a SKILL.md's front matter; null when it has none. */
export function skillVersion(text: string): string | null {
  const head = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  return /^metadata:[^\n]*\n(?:[ \t][^\n]*\n)*?[ \t]+version:[ \t]*["']?([^"'\s]+)/m.exec(head)?.[1] ?? null;
}

/** foreman's version, from a clone or else the plugin; null when it is not installed. */
export function foremanVersion(skillFile: string | undefined, pluginsFile?: string): string | null {
  try { if (skillFile) return skillVersion(readFileSync(skillFile, 'utf8')); } catch { /* no clone: try the plugin */ }
  try {
    // shortcut: reads Claude Code's undocumented registry, a new format shows foreman as not installed; replace it if foreman ever writes its own marker
    const root = (JSON.parse(readFileSync(pluginsFile ?? '', 'utf8')) as { plugins?: Record<string, { installPath?: string }[]> }).plugins?.['foreman@foreman']?.[0]?.installPath;
    return root ? skillVersion(readFileSync(join(root, 'SKILL.md'), 'utf8')) : null;
  } catch { return null; }
}

/** HEAD's short hash; null means a plugin install. Only `root`'s own .git counts: a plugin cache inside a larger repo
 *  would otherwise report that repo's commit. */
export function gitCommit(root = ROOT): string | null {
  if (!existsSync(join(root, '.git'))) return null;
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true }).trim() || null;
  } catch { return null; }
}
