import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** What `npm run build` reads. The build writes their hash to web/dist/sources.sha256, so a test can tell a stale web/dist. */
const INPUTS = ['web/index.html', 'web/vite.config.ts', 'web/tsconfig.json', 'web/src', 'web/public', 'shared', 'package-lock.json'];

const walk = (p: string): string[] =>
  statSync(p).isDirectory() ? readdirSync(p).filter(n => n !== '.DS_Store').flatMap(n => walk(join(p, n))) : [p];

export function webSourcesHash(root: string): string {
  const h = createHash('sha256');
  const files = INPUTS.flatMap(p => walk(join(root, p))).map(f => relative(root, f).replaceAll('\\', '/')).sort();
  for (const f of files) {
    let b = readFileSync(join(root, f));
    // as git's text=auto eol=lf stores it: no NUL in the first 8000 bytes means text, and text is hashed with LF
    if (!b.subarray(0, 8000).includes(0)) b = Buffer.from(b.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
    h.update(`${f}\0${b.length}\0`).update(b);
  }
  return h.digest('hex');
}
