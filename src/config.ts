import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  port: number;
  abandonMs: number;
  spoolDir: string;
  stateDir: string;     // foreman's state dir: board-<sid>, active-<sid>
  settingsPath: string;
  sessionsDir?: string; // Claude Code's session registry (<pid>.json): the Remote Control link; none, no link
  pluginRootFile?: string; // the plugin's SessionStart hook writes its folder here (read by doctor and foreman)
  portFile?: string;    // the serving port for hook/fv-ask.sh: cli serve writes it, the hook reads it
  foremanSkill?: string; // a cloned foreman's SKILL.md, the source of its version
  pluginsFile?: string;  // Claude Code's plugin registry: the plugin foreman's folder; neither, foreman shows as not installed
}

/** Value of `--key value` in argv; a `--key` as the last argument is an error. */
export function flag(argv: string[], key: string): string | undefined {
  const i = argv.indexOf('--' + key);
  if (i < 0) return undefined;
  if (i + 1 === argv.length) throw new Error(`missing value for --${key}`);
  return argv[i + 1];
}

/** `--key` value `v` as a number, `def` when not given; a value `ok` rejects is an error. */
export function num(key: string, v: string | undefined, def: number, ok: (n: number) => boolean): number {
  if (v === undefined) return def;
  if (v.trim() === '' || !ok(Number(v))) throw new Error(`invalid --${key}: "${v}"`);
  return Number(v);
}

/** Precedence: CLI flag (`--port 4780`) > ~/.claude/foreman-vision.conf (`port=4780`) > default. */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv = process.env): Config {
  const base = env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const conf = readConf(join(base, 'foreman-vision.conf'));
  const pick = (key: string) => flag(argv, key) ?? conf[key];
  return {
    port: num('port', pick('port'), 4780, n => Number.isInteger(n) && n >= 0 && n <= 65535),
    abandonMs: num('abandon-minutes', pick('abandon-minutes'), 10, n => n > 0 && Number.isFinite(n)) * 60_000,
    spoolDir: pick('spool-dir') ?? join(base, 'foreman-vision', 'spool'),
    stateDir: pick('state-dir') ?? join(base, 'foreman', 'state'),
    settingsPath: pick('settings') ?? join(base, 'settings.json'),
    sessionsDir: join(base, 'sessions'),
    pluginRootFile: join(base, 'foreman-vision', 'plugin-root'),
    portFile: join(base, 'foreman-vision', 'port'),
    foremanSkill: join(base, 'skills', 'foreman', 'SKILL.md'),
    pluginsFile: join(base, 'plugins', 'installed_plugins.json'),
  };
}

function readConf(path: string): Record<string, string> {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return {}; }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
