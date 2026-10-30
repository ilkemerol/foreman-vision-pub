import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tempDir } from './helpers.ts';
import { fileURLToPath } from 'node:url';
import { addHooks, doctor, EVENTS, hookBash, hookCommand, install, isOurs, removeHooks, uninstall } from '../src/install.ts';

const CMD = 'bash "/repo/hook/fv-hook.sh" "/h/.claude/foreman-vision/spool"';
const ASK = 'bash "/repo/hook/fv-ask.sh" "/h/.claude/foreman-vision/port"';
const theirs = () => ({
  model: 'opus',
  hooks: {
    PreToolUse: [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: 'bash ~/.claude/skills/foreman/hooks/nested-agent-guard.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'claude-office-hook stop' }] }],
  },
});

test('addHooks: every event gets our group after the existing ones', () => {
  const out = addHooks(theirs(), CMD, ASK);
  for (const ev of EVENTS) assert.equal(out.hooks![ev].at(-1)!.hooks[0].command, CMD, ev);
  assert.deepEqual(out.hooks!.PreToolUse[0], theirs().hooks.PreToolUse[0]);
  assert.equal(out.hooks!.PreToolUse.at(-1)!.matcher, '*');
  assert.equal(out.hooks!.Stop.at(-1)!.matcher, undefined);
  assert.equal(out.model, 'opus');
});

test('addHooks is idempotent and replaces an old command path', () => {
  const once = addHooks(theirs(), CMD, ASK);
  assert.deepEqual(addHooks(once, CMD, ASK), once);
  const moved = addHooks(once, CMD.replace('/repo/', '/new/'), ASK);
  assert.equal(moved.hooks!.Stop.filter(g => g.hooks.some(h => h.command?.includes('fv-hook'))).length, 1);
});

test('addHooks: PermissionRequest also gets the answer hook for AskUserQuestion with a 3600 s timeout, before our spool group; removeHooks takes it off', () => {
  const out = addHooks(theirs(), CMD, ASK);
  assert.deepEqual(out.hooks!.PermissionRequest.at(-2), { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: ASK, timeout: 3600 }] });
  assert.equal(out.hooks!.PermissionRequest.at(-1)!.matcher, '*');
  assert.equal(out.hooks!.PreToolUse.filter(g => g.hooks.some(isOurs)).length, 1);
  assert.deepEqual(removeHooks(out), theirs());
  assert.deepEqual(addHooks(out, CMD, ASK), out);
});

test('removeHooks undoes addHooks and keeps foreign hooks in a mixed group', () => {
  assert.deepEqual(removeHooks(addHooks(theirs(), CMD, ASK)), theirs());
  assert.deepEqual(removeHooks(addHooks({}, CMD, ASK)), {});
  const mixed = { hooks: { Stop: [{ hooks: [{ type: 'command', command: CMD }, { type: 'command', command: 'other' }] }] } };
  assert.deepEqual(removeHooks(mixed), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] } });
});

test('removeHooks takes only the command hookCommand writes, not one that merely mentions the script name', () => {
  const foreign = ['bash "/x/my-fv-hook.sh" "/s"', 'bash "/x/fv-hook.sh.bak" "/s"', 'echo fv-hook.sh', 'bash "/x/fv-hook.sh" "/s" && rm -rf /tmp/x', 'node fv-spike-hook.sh'];
  const s = { hooks: { Stop: foreign.map(command => ({ hooks: [{ type: 'command', command }] })) } };
  assert.deepEqual(removeHooks(s), s);
  for (const cmd of [CMD, hookCommand('C:\\r\\spike\\fv-spike-hook.sh', 'C:\\h\\spool')])
    assert.deepEqual(removeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd }] }] } }), {});
});

test('hookBash: plain bash off Windows, CLAUDE_CODE_GIT_BASH_PATH when set', () => {
  assert.equal(hookBash({}, 'linux'), 'bash');
  assert.equal(hookBash({ CLAUDE_CODE_GIT_BASH_PATH: 'D:\\G\\bin\\bash.exe' }, 'win32'), 'D:\\G\\bin\\bash.exe');
});

test('hookBash: on Windows, Git Bash even when System32 (WSL bash) comes first in PATH', { skip: process.platform !== 'win32' }, () => {
  // Windows' own PATH order: System32 before Git
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(path|claude_code_git_bash_path)$/i.test(k)));
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.PATH}`;
  const bare = spawnSync('where', ['bash'], { encoding: 'utf8', env }).stdout.split(/\r?\n/)[0].trim();
  assert.match(bare, /System32\\bash\.exe$/i);   // what spawnSync('bash') would run
  const bash = hookBash(env);
  assert.doesNotMatch(bash, /System32/i);
  assert.match(spawnSync(bash, ['-c', 'uname -s'], { encoding: 'utf8' }).stdout, /MINGW|MSYS/);
});

test('hookCommand uses forward slashes for Git Bash', () => {
  assert.equal(hookCommand('C:\\r\\hook\\fv-hook.sh', 'C:\\h\\spool'), 'bash "C:/r/hook/fv-hook.sh" "C:/h/spool"');
});

test('install: backup then merge; second run writes nothing; uninstall restores', () => {
  const dir = tempDir('fv-inst-');
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(theirs(), null, 2));
  assert.match(install(path, CMD, ASK, 1), /backup/);
  assert.ok(existsSync(`${path}.fv-backup-1`));
  assert.equal(install(path, CMD, ASK, 2), 'no change');
  assert.equal(existsSync(`${path}.fv-backup-2`), false);
  uninstall(path, 3);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), theirs());
});

test('BOM is tolerated; broken JSON writes nothing, not even a backup', () => {
  const dir = tempDir('fv-inst-');
  const bom = join(dir, 'bom.json');
  writeFileSync(bom, '\uFEFF{"model":"opus"}');
  install(bom, CMD, ASK, 1);
  assert.equal(JSON.parse(readFileSync(bom, 'utf8')).model, 'opus');
  const bad = join(dir, 'settings.json');
  writeFileSync(bad, '{"hooks": ');
  assert.throws(() => install(bad, CMD, ASK, 1), /is not JSON/);
  assert.equal(readFileSync(bad, 'utf8'), '{"hooks": ');
  assert.deepEqual(readdirSync(dir).filter(f => f.startsWith('settings.json.')), []);
});

test('doctor: reports whether the answer hook (PermissionRequest · AskUserQuestion) is installed', () => {
  const dir = tempDir('fv-doc-'), settingsPath = join(dir, 'settings.json');
  const cfg = { port: 0, abandonMs: 1, spoolDir: join(dir, 'spool'), stateDir: dir, settingsPath, sessionsDir: dir };
  writeFileSync(settingsPath, JSON.stringify(addHooks({}, CMD, ASK)));
  assert.match(doctor(cfg), /^answer hook \(PermissionRequest · AskUserQuestion\): installed$/m);
  writeFileSync(settingsPath, JSON.stringify(addHooks({}, CMD, CMD)));
  assert.match(doctor(cfg), /^answer hook \(PermissionRequest · AskUserQuestion\): MISSING/m);
});

test('missing settings.json is created without a backup', () => {
  const path = join(tempDir('fv-inst-'), 'settings.json');
  assert.equal(install(path, CMD, ASK, 1), 'written');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).hooks.SessionStart[0].hooks[0].command, CMD);
});

test('doctor: reports the plugin and the folder it recorded, and warns when settings.json hooks run as well', () => {
  const dir = tempDir('fv-doc-');
  const settingsPath = join(dir, 'settings.json');
  const pluginRootFile = join(dir, 'plugin-root');
  const cfg = { port: 0, abandonMs: 1, spoolDir: join(dir, 'spool'), stateDir: dir, settingsPath, pluginRootFile };
  const lines = () => doctor(cfg).split('\n').slice(2, -1);   // without the jq, curl and spool lines
  const answer = 'answer hook (PermissionRequest · AskUserQuestion): ';
  const plugin = (on: boolean, s = {}) => writeFileSync(settingsPath, JSON.stringify({ ...s, enabledPlugins: { 'other@x': true, 'foreman-vision@foreman-vision': on } }));

  writeFileSync(settingsPath, JSON.stringify(addHooks({}, CMD, ASK)));
  assert.deepEqual(lines(), ['plugin: not installed', `hook entries: 11/11 events (${settingsPath})`, answer + 'installed']);
  plugin(true);
  assert.deepEqual(lines(), ['plugin: foreman-vision@foreman-vision enabled, folder not recorded yet (start a Claude Code session)',
    `hook entries: none in ${settingsPath}; the plugin brings its own`, answer + 'from the plugin']);
  const root = fileURLToPath(new URL('..', import.meta.url));   // has hook/fv-hook.sh
  writeFileSync(pluginRootFile, root);
  assert.equal(lines()[0], `plugin: foreman-vision@foreman-vision enabled, folder ${root.trim()}`);
  plugin(true, addHooks({}, CMD, ASK));
  assert.match(lines()[3], /^WARNING: the plugin and the settings.json hook entries are both active/);
  plugin(false, addHooks({}, CMD, ASK));
  assert.deepEqual(lines(), ['plugin: foreman-vision@foreman-vision disabled', `hook entries: 11/11 events (${settingsPath})`, answer + 'installed']);
});
