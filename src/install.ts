import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { Config } from './config.ts';

export type HookCmd = { type: string; command?: string; [k: string]: unknown };
export type Group = { matcher?: string; hooks: HookCmd[]; [k: string]: unknown };
export type Settings = { hooks?: Record<string, Group[]>; [k: string]: unknown };

export const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'PermissionRequest'] as const;
const TOOL_EVENTS = new Set<string>(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);
/** Our entries are recognized by the script name, never by position: exactly the command hookCommand writes. */
const MARK = /^bash "[^"]*\/fv-(spike-hook|hook|ask)\.sh" "[^"]*"$/;
/** The answer hook waits this long for the pop-up; hook/fv-ask.sh's curl gives up with it (hook/hooks.json repeats it). */
export const ASK_TIMEOUT_S = 3600;

export const isOurs = (h: HookCmd) => typeof h.command === 'string' && MARK.test(h.command);

export function hookCommand(hookPath: string, spoolDir: string): string {
  const fwd = (p: string) => p.replaceAll('\\', '/'); // Git Bash reads C:/x, not C:\x
  return `bash "${fwd(hookPath)}" "${fwd(spoolDir)}"`;
}

/** command: the spool hook on every event; ask: the answer hook for main's AskUserQuestion, before it in PermissionRequest. */
export function addHooks(settings: Settings, command: string, ask: string): Settings {
  const out = removeHooks(settings);
  const hooks = { ...(out.hooks ?? {}) };
  for (const ev of EVENTS) {
    const group: Group = TOOL_EVENTS.has(ev)
      ? { matcher: '*', hooks: [{ type: 'command', command }] }
      : { hooks: [{ type: 'command', command }] };
    const before: Group[] = ev === 'PermissionRequest'
      ? [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: ask, timeout: ASK_TIMEOUT_S }] }] : [];
    hooks[ev] = [...(hooks[ev] ?? []), ...before, group];
  }
  return { ...out, hooks };
}

export function removeHooks(settings: Settings): Settings {
  const out: Settings = structuredClone(settings);
  if (!out.hooks) return out;
  for (const [ev, groups] of Object.entries(out.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h)) }))
      .filter((g, i) => g.hooks.length > 0 || !(groups[i].hooks ?? []).some(isOurs));
    if (kept.length) out.hooks[ev] = kept;
    else if (groups.length) delete out.hooks[ev];
  }
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

export function install(settingsPath: string, command: string, ask: string, now = Date.now()): string {
  return rewrite(settingsPath, s => addHooks(s, command, ask), now);
}

export function uninstall(settingsPath: string, now = Date.now()): string {
  return rewrite(settingsPath, removeHooks, now);
}

/** Parse first, back up second, write last: a broken file is never touched. */
function rewrite(path: string, change: (s: Settings) => Settings, now: number): string {
  const text = existsSync(path) ? readFileSync(path, 'utf8').replace(/^\uFEFF/, '') : '{}';
  let before: Settings;
  try { before = JSON.parse(text); } catch (e) {
    throw new Error(`${path} is not JSON, nothing written: ${(e as Error).message}`);
  }
  const after = change(before);
  if (JSON.stringify(after) === JSON.stringify(before)) return 'no change';
  let backup = '';
  if (existsSync(path)) { backup = `${path}.fv-backup-${now}`; copyFileSync(path, backup); }
  writeFileSync(path, JSON.stringify(after, null, 2) + '\n');
  return backup ? `written, backup: ${backup}` : 'written';
}

/** The bash Claude Code runs hooks in. On Windows that is Git Bash, found as Claude Code finds it
 *  (CLAUDE_CODE_GIT_BASH_PATH, else bin\bash.exe next to git.exe): a bare `bash` may be System32\bash.exe, which is WSL. */
export function hookBash(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  if (platform !== 'win32') return 'bash';
  if (env.CLAUDE_CODE_GIT_BASH_PATH) return env.CLAUDE_CODE_GIT_BASH_PATH;
  const gits = (spawnSync('where', ['git'], { encoding: 'utf8', env }).stdout ?? '').split(/\r?\n/).filter(Boolean);
  return gits.map(g => join(dirname(g), '..', 'bin', 'bash.exe')).find(b => existsSync(b)) ?? 'bash';
}

const NO_ANSWER = 'the pop-up cannot answer questions; the terminal asks as usual';

export function doctor(cfg: Config): string {
  // Ask the same bash the hook runs in, not Node's PATH.
  const bash = hookBash();
  const jq = spawnSync(bash, ['-c', 'jq --version'], { encoding: 'utf8' });
  const curl = spawnSync(bash, ['-c', 'curl --version'], { encoding: 'utf8' });
  let installed = 0, ask = false;
  let plugin: [id: string, enabled: unknown] | undefined;
  try {
    const s: Settings = JSON.parse(readFileSync(cfg.settingsPath, 'utf8').replace(/^\uFEFF/, ''));
    installed = EVENTS.filter(ev => (s.hooks?.[ev] ?? []).some(g => (g.hooks ?? []).some(isOurs))).length;
    ask = (s.hooks?.PermissionRequest ?? []).some(g => g.matcher === 'AskUserQuestion' && (g.hooks ?? []).some(h => isOurs(h) && h.command!.includes('/fv-ask.sh"')));
    // shortcut: user-scope plugins only (`claude plugin install` default); a project-scope install is not seen
    plugin = Object.entries((s.enabledPlugins ?? {}) as Record<string, unknown>).find(([id]) => id.startsWith('foreman-vision@'));
  } catch { /* reported as 0 below */ }
  let root = '';
  try { root = readFileSync(cfg.pluginRootFile ?? '', 'utf8').trim(); } catch { /* not written yet */ }
  const on = plugin?.[1] === true;
  const spool = existsSync(cfg.spoolDir) ? readdirSync(cfg.spoolDir).filter(f => f.endsWith('.jsonl')).length : 0;
  return [
    `jq (${bash}): ${jq.status === 0 ? jq.stdout.trim() : 'MISSING — the hook silently writes nothing'}`,
    `curl (${bash}): ${curl.status === 0 ? curl.stdout.split(/\s+/).slice(0, 2).join(' ') : `MISSING — ${NO_ANSWER}`}`,
    !plugin ? 'plugin: not installed'
      : !on ? `plugin: ${plugin[0]} disabled`
      : root && existsSync(join(root, 'hook', 'fv-hook.sh')) ? `plugin: ${plugin[0]} enabled, folder ${root}`
      : `plugin: ${plugin[0]} enabled, folder not recorded yet (start a Claude Code session)`,
    on && installed === 0 ? `hook entries: none in ${cfg.settingsPath}; the plugin brings its own`
      : `hook entries: ${installed}/${EVENTS.length} events (${cfg.settingsPath})`,
    `answer hook (PermissionRequest · AskUserQuestion): ${ask ? 'installed' : on ? 'from the plugin' : `MISSING — ${NO_ANSWER}`}`,
    ...(on && installed > 0 ? ['WARNING: the plugin and the settings.json hook entries are both active, so every event is spooled twice. ' +
      `Keep one: node src/cli.ts uninstall, or claude plugin uninstall ${plugin?.[0]}`] : []),
    `spool: ${cfg.spoolDir} (${spool} session files)`,
  ].join('\n');
}
