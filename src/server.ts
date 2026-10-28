import { createReadStream, mkdirSync, readFileSync, realpathSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SseMessage } from '../shared/types.ts';
import type { Config } from './config.ts';
import { createEngine, transcriptFile } from './engine.ts';
import type { State } from './reducer.ts';
import { remoteLink, termPage } from './term.ts';
import { toSnapshot } from './view.ts';

const MEMORY_FILE = 'foreman-vision-view.json';   // in the state dir: the view memory a restart reloads (loadMemory)
const THROTTLE_MS = 200;
const TICK_MS = 5000;       // abandoned check, the sweep (an ended floor goes 60 s after its last line), a scan in case fs.watch missed an event
const PING_MS = 15_000;
const DAY_MS = 24 * 3600_000;
const FLOOR_API = /^\/api\/floors\/([\w-]+)\/(hide|show)$/;

export interface Running { port: number; host: string; stop(): void }

export const WEB_DIR = fileURLToPath(new URL('../web/dist/', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon',
};

function sendFile(res: ServerResponse, root: string, pathname: string) {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/') rel = '/index.html';
  const base = resolve(root);
  const file = resolve(base, '.' + rel);
  if (!file.startsWith(base + sep)) { res.writeHead(404).end(); return; } // %2F-encoded ../ lands here
  let size = -1;
  try { const st = statSync(file); if (st.isFile()) size = st.size; } catch { /* missing */ }
  if (size < 0) {
    if (rel === '/index.html') res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('web/dist missing: run npm run build first');
    else res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': size });
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

/** The view memory (`stages`, `leave`, `holds`) of the sessions the spool still has, so a restart is no
 *  first sight: who left the Done lounge stays gone, who is held stays, no leave moves earlier. */
function loadMemory(state: State, path: string, now: number) {
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as
      Record<string, { stages?: [string, { stage: string; since: number }][]; leave?: [string, number][]; holds?: [string, number | null][]; hiddenAt?: number; pid?: number }>;
    for (const [sid, m] of Object.entries(saved)) {
      const s = state.sessions.get(sid);   // a swept session's entries go with it
      // the pid: a session that died with the machine has no registry file once Claude Code starts again (engine endGone)
      if (s) { s.stages = new Map(m.stages); s.leave = new Map(m.leave); s.holds = new Map(m.holds); s.pid = m.pid; }
      // a hide before its session showed up waits a day for it; a swept session's goes
      if (typeof m.hiddenAt === 'number' && (s || now - m.hiddenAt < DAY_MS)) state.hidden.set(sid, m.hiddenAt);
    }
  } catch { /* none yet, or unreadable: first sight as before */ }
}

export async function serve(cfg: Config, webDir = WEB_DIR): Promise<Running> {
  const engine = createEngine(cfg);
  const clients = new Set<ServerResponse>();
  let flushTimer: NodeJS.Timeout | undefined;
  let scanTimer: NodeJS.Timeout | undefined;

  const memoryPath = join(cfg.stateDir, MEMORY_FILE);
  let memorySaved = '';
  // toSnapshot changes the view memory; written only when it changed, so at most once a (throttled) frame
  const saveMemory = () => {
    const { sessions, hidden } = engine.state;
    const saved: Record<string, object> = Object.fromEntries([...hidden].map(([sid, hiddenAt]) => [sid, { hiddenAt }]));
    for (const s of sessions.values()) saved[s.sid] = { stages: [...s.stages], leave: [...s.leave], holds: [...s.holds], hiddenAt: hidden.get(s.sid), pid: s.pid };
    const text = JSON.stringify(saved);
    if (text === memorySaved) return;
    memorySaved = text;
    try {
      mkdirSync(cfg.stateDir, { recursive: true });
      writeFileSync(memoryPath + '.tmp', text);
      renameSync(memoryPath + '.tmp', memoryPath);   // atomic: a crash mid-write leaves the old file
    } catch { /* best effort: a lost write costs one restart's first-sight guess */ }
  };
  // ponytail: every update is a full snapshot (a few KB for ~20 agents); send diffs if it ever gets big
  const frame = () => {
    const data = toSnapshot(engine.state, Date.now());
    saveMemory();
    return `data: ${JSON.stringify({ type: 'snapshot', data } satisfies SseMessage)}\n\n`;
  };
  // A client still draining an older frame skips the frames in between and gets the newest one on 'drain':
  // every frame is a full snapshot, so nothing is lost and a slow client's buffer never grows past one frame.
  const behind = new Set<ServerResponse>();
  const flush = () => {
    flushTimer = undefined;
    const text = frame();
    for (const c of clients) if (c.writableNeedDrain) behind.add(c); else c.write(text);
  };
  const changed = () => { flushTimer ??= setTimeout(flush, THROTTLE_MS); };
  const scan = () => { scanTimer = undefined; engine.scan(Date.now()); changed(); };

  mkdirSync(cfg.spoolDir, { recursive: true });
  engine.sweep(Date.now()); // day-old spools go before they are replayed
  engine.scan(Date.now()); // a late start rebuilds the state from the spool
  engine.sweep(Date.now());
  loadMemory(engine.state, memoryPath, Date.now());   // before the tick: a remembered pid whose file is gone ends now
  engine.tick(Date.now(), cfg.abandonMs);   // an agent abandoned before the restart is so in the first snapshot too

  const watchers: FSWatcher[] = [];
  for (const dir of [cfg.spoolDir, cfg.stateDir]) {
    try {
      // fs.watch on an 8.3 short path (C:\Users\ABCDEF~1) aborts libuv on Windows; watch the long path
      watchers.push(watch(realpathSync.native(dir), () => { scanTimer ??= setTimeout(scan, 50); }).on('error', () => {}));
    } catch { /* foreman never ran here: the tick still scans */ }
  }
  const timers = [
    // ponytail: a readdir + a stat per spool every tick; a handful of files
    setInterval(() => { engine.tick(Date.now(), cfg.abandonMs); engine.sweep(Date.now()); scan(); }, TICK_MS),
    setInterval(() => { for (const c of clients) if (!c.writableNeedDrain) c.write(': ping\n\n'); }, PING_MS),
  ];

  const server = createServer((req, res) => {
    // DNS rebinding: a page on another origin can point its name at 127.0.0.1; only our own Host gets in
    const port = (server.address() as AddressInfo).port;
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403).end(); return; }
    const { pathname, searchParams: q } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/api/term') {
      // transcripts hold tool output and secrets: the custom header keeps another origin's page out (no CORS headers here)
      if (req.headers['x-foreman-vision'] !== '1') { res.writeHead(403).end(); return; }
      const sid = q.get('session') ?? '', id = q.get('agent') ?? '', raw = q.get('from');
      const from = raw === null ? null : Number(raw);
      if (from !== null && !(Number.isSafeInteger(from) && from >= 0)) { res.writeHead(400).end(); return; }
      // the path comes from the live state, never from the query; 'pending:…' and odd ids fail the pattern
      const s = engine.state.sessions.get(sid);
      if (!s?.transcriptPath || !s.agents.has(id) || !/^[\w-]+$/.test(id)) { res.writeHead(404).end(); return; }
      const page = termPage(transcriptFile(s, id), from);
      if (from === null) page.remote = remoteLink(cfg.sessionsDir, sid);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(page));
      return;
    }
    if (pathname === '/api/foremen') {
      engine.scan(Date.now()); changed();   // a foreman just switched off is off in the answer, not after the next watch event
      const sessions = [...engine.state.sessions.values()].filter(s => s.foreman !== 'off' && !s.ended).map(s => s.sid);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sessions }));
      return;
    }
    const api = FLOOR_API.exec(pathname);
    if (api) {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      // a custom header: a web page cannot send it without a CORS preflight, which gets no CORS headers here
      if (req.headers['x-foreman-vision'] !== '1') { res.writeHead(403).end(); return; }
      if (api[2] === 'hide') { if (!engine.state.hidden.has(api[1])) engine.state.hidden.set(api[1], Date.now()); } else engine.state.hidden.delete(api[1]);
      saveMemory();
      changed();
      res.writeHead(204).end();
      return;
    }
    if (pathname !== '/events') { sendFile(res, webDir, pathname); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    clients.add(res);
    res.on('close', () => { clients.delete(res); behind.delete(res); });
    res.on('drain', () => { if (behind.delete(res)) res.write(frame()); });
    res.write(frame());
  });
  const stop = () => {
    for (const t of timers) clearInterval(t);
    clearTimeout(flushTimer);
    clearTimeout(scanTimer);
    for (const w of watchers) w.close();
    server.closeAllConnections();
    server.close();
  };
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, '127.0.0.1', resolve); });
  } catch (e) {
    stop();
    throw (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? new Error(`port ${cfg.port} in use`) : e;
  }
  const addr = server.address() as AddressInfo;
  return { port: addr.port, host: addr.address, stop };
}
