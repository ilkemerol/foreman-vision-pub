import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webSourcesHash } from '../src/dist-stamp.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('the committed web/dist is built from the current web sources', () => {
  const stamp = join(ROOT, 'web/dist/sources.sha256');
  assert.ok(existsSync(stamp), 'web/dist/sources.sha256 is missing: run npm run build');
  assert.equal(readFileSync(stamp, 'utf8').trim(), webSourcesHash(ROOT), 'web/dist is stale: run npm run build');
});

test('every asset web/dist/index.html loads is in web/dist', () => {
  const html = readFileSync(join(ROOT, 'web/dist/index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\/([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) assert.ok(existsSync(join(ROOT, 'web/dist', r)), r);
});
