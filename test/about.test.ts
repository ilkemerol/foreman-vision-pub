import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers.ts';
import { foremanVersion, gitCommit, skillVersion, VERSION } from '../src/about.ts';
import { serve } from '../src/server.ts';

const skill = (lines: string[], eol = '\n') => ['---', ...lines, '---', '', '# Foreman', 'version: "9.9.9"'].join(eol);

test('skillVersion: the version under metadata, quoted or not, in LF or CRLF', () => {
  const meta = ['name: foreman', 'metadata:', '  version: "1.13.3"', '  tags: [a]'];
  assert.equal(skillVersion(skill(meta)), '1.13.3');
  assert.equal(skillVersion(skill(meta, '\r\n')), '1.13.3');
  assert.equal(skillVersion(skill(['metadata:', '  tags: [a]', '  version: 2.0.1'])), '2.0.1');
  assert.equal(skillVersion('﻿' + skill(meta)), '1.13.3');
});

test('skillVersion: null with no version under metadata; the body and other keys do not count', () => {
  assert.equal(skillVersion(skill(['name: foreman'])), null);
  assert.equal(skillVersion(skill(['version: 1.0.0', 'metadata:', '  tags: [a]'])), null);
  assert.equal(skillVersion(skill(['metadata:', '  tags: [a]', 'other:', '  version: 1.0.0'])), null);
  assert.equal(skillVersion('# no front matter\nversion: 1.0.0'), null);
});

test('foremanVersion: a missing file or none configured is not installed', () => {
  assert.equal(foremanVersion(join(tempDir('fv-about-'), 'SKILL.md')), null);
  assert.equal(foremanVersion(undefined), null);
});

test('foremanVersion: the plugin\'s folder from the registry; a clone wins; a broken registry is not installed', () => {
  const root = tempDir('fv-about-');
  const pluginsFile = join(root, 'installed_plugins.json'), clone = join(root, 'SKILL.md');
  const missing = join(root, 'skills', 'SKILL.md');
  const plugin = join(root, 'cache');
  mkdirSync(plugin);
  writeFileSync(join(plugin, 'SKILL.md'), skill(['metadata:', '  version: "2.0.0"']));
  writeFileSync(pluginsFile, JSON.stringify({ version: 2, plugins: { 'foreman@foreman': [{ scope: 'user', installPath: plugin }] } }));
  assert.equal(foremanVersion(missing, pluginsFile), '2.0.0');
  writeFileSync(clone, skill(['metadata:', '  version: "1.0.0"']));
  assert.equal(foremanVersion(clone, pluginsFile), '1.0.0');
  writeFileSync(pluginsFile, JSON.stringify({ version: 2, plugins: { 'foreman@claude-community': [{ installPath: plugin }] } }));
  assert.equal(foremanVersion(missing, pluginsFile), '2.0.0');
  writeFileSync(pluginsFile, JSON.stringify({ version: 2, plugins: { 'foreman-vision@foreman-vision': [{ installPath: plugin }], 'other@other': [{ installPath: plugin }] } }));
  assert.equal(foremanVersion(missing, pluginsFile), null);
  writeFileSync(pluginsFile, 'not json');
  assert.equal(foremanVersion(missing, pluginsFile), null);
});

test('gitCommit: the root\'s own .git only; a failing git is a plugin install', () => {
  const root = tempDir('fv-about-');
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' }).stdout.trim();
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'x');
  assert.equal(gitCommit(root), git('rev-parse', '--short', 'HEAD'));
  // the case that matters: a plugin cache inside a larger repo must not report that repo's commit
  const inside = join(root, 'cache');
  mkdirSync(inside);
  assert.equal(gitCommit(inside), null);
  writeFileSync(join(inside, '.git'), 'gitdir: nowhere');
  assert.equal(gitCommit(inside), null);
});

test('/api/about: the custom header or 403; foreman read per request', { timeout: 10_000 }, async () => {
  const root = tempDir('fv-about-');
  const foremanSkill = join(root, 'SKILL.md');
  const running = await serve({ port: 0, abandonMs: 600_000, spoolDir: join(root, 'spool'), stateDir: join(root, 'state'), settingsPath: join(root, 'settings.json'), foremanSkill });
  try {
    const url = `http://127.0.0.1:${running.port}/api/about`, headers = { 'x-foreman-vision': '1' };
    assert.equal((await fetch(url)).status, 403);
    const res = await fetch(url, { headers });
    assert.equal(res.status, 200);
    const about = await res.json() as { version: string; commit: string | null; foreman: string | null };
    assert.equal(about.version, VERSION);
    assert.equal(about.foreman, null);
    writeFileSync(foremanSkill, skill(['metadata:', '  version: "1.13.3"']));
    assert.equal((await (await fetch(url, { headers })).json() as typeof about).foreman, '1.13.3');
  } finally {
    running.stop();
  }
});
