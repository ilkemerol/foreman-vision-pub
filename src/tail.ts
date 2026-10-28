import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

export const MAX_CHUNK = 8 * 1024 * 1024;

/** Complete lines appended after `offset`; the new offset stops after the last newline, so a half-written line waits. */
export function readNew(path: string, offset: number, maxChunk = MAX_CHUNK): { lines: string[]; offset: number } {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return { lines: [], offset }; }
  try {
    const size = fstatSync(fd).size;
    if (size < offset) offset = 0; // truncated or replaced: start over
    if (size === offset) return { lines: [], offset };
    const buf = Buffer.alloc(Math.min(size - offset, maxChunk));
    readSync(fd, buf, 0, buf.length, offset);
    const end = buf.lastIndexOf(0x0a);
    if (end < 0) return { lines: [], offset: buf.length === maxChunk ? offset + buf.length : offset }; // a full chunk with no newline: skip it, the line's tail is a bad line
    return { lines: buf.subarray(0, end).toString('utf8').split('\n').filter(Boolean), offset: offset + end + 1 };
  } catch {
    return { lines: [], offset };
  } finally {
    closeSync(fd);
  }
}
