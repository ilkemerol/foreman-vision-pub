import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { DetailPanel, StageList } from './components/DetailPanel.tsx';
import { Header } from './components/Header.tsx';
import { HybridView } from './components/HybridView.tsx';
import { KanbanView } from './components/KanbanView.tsx';
import { PixelView } from './components/PixelView.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import type { ViewProps } from './components/view-props.ts';
import { alertKeys, newAlerts, titleFor } from './logic/alerts.ts';
import { COLLAPSE_MS, FADE_MS, newlyHidden, nextFloor, visibleSessions } from './logic/collapse.ts';
import { byFloor, pickFloor, urlFloor, type FloorNumbers } from './logic/floors.ts';
import type { Room } from './logic/hybrid.ts';
import { setLang, t } from './logic/i18n.ts';
import { agentKey, findAgent, totalAlerts } from './logic/model.ts';
import { loadSettings, saveSettings, withPrefs, type Settings, type ViewName } from './logic/settings.ts';
import { beep, desktopNotify, setFavicon } from './notify.ts';
import { useLive } from './store.ts';
import { useFloors } from './useFloors.ts';
import { useHeld } from './useHeld.ts';

// a view that is not built yet falls back to Kanban
const VIEWS: Partial<Record<ViewName, ComponentType<ViewProps>>> = {
  kanban: KanbanView,
  hybrid: HybridView,
  pixel: PixelView,
};

export function App() {
  const live = useLive();
  const [settings, setSettings] = useState(loadSettings);
  const [selected, setSelected] = useState<string | null>(null);
  // Hybrid's "+N" list in the detail panel; any selection (or closing it) drops the list
  const [list, setList] = useState<{ sid: string; room: Room } | null>(null);
  const select = (key: string | null) => { setList(null); setSelected(key); };
  // the latest settings, also for a notification click, which runs from a stale closure
  const latest = useRef(settings);
  latest.current = settings;
  // write to localStorage, then run what reads back from there (outside the state updater: no side effect in it)
  // the language is set before the rerender, so the whole tree draws in it (no context: logic/i18n.ts)
  const store = (n: Settings) => { saveSettings(n); const s = loadSettings(n); setLang(s.lang); setSettings(latest.current = s); };
  // the ⚙ drawer's Save: its prefs onto the latest floor
  // leaving the floor or the view closes Hybrid's "+N" list
  const save = (draft: Settings) => { if (draft.view !== latest.current.view) setList(null); store(withPrefs(latest.current, draft)); };
  // the header's iso zoom steps are stored at once, like the floor
  const zoomTo = (z: number | null) => store({ ...latest.current, isoZoom: z });
  const [isoAuto, setIsoAuto] = useState<number | null>(null);
  const pickSid = (floor: string) => { if (floor !== latest.current.floor) setList(null); store({ ...latest.current, floor }); };
  // a sidebar or notification pick before the `?session=` floor shows up cancels it
  const urlPending = useRef(true);
  const userPick = (floor: string) => { urlPending.current = false; pickSid(floor); };
  // a hidden floor is gone from the page; a fresh hide first collapses for COLLAPSE_MS
  const [collapsing, setCollapsing] = useState<ReadonlySet<string>>(new Set());
  const [cut, setCut] = useState(0);   // bumped when the floor on screen collapsed: the view remounts, no elevator slide
  const hiddenSeen = useRef<Set<string> | null>(null);
  const rawSessions = useRef(live.snap?.sessions ?? []);
  rawSessions.current = live.snap?.sessions ?? [];
  const floorNums = useRef<FloorNumbers>({});   // the F numbers of the last render: the sidebar's order
  useEffect(() => {
    if (!live.snap) return;
    const { seen, collapse } = newlyHidden(hiddenSeen.current, live.snap.sessions, live.snap.serverTime);
    hiddenSeen.current = seen;
    if (collapse.length === 0) return;
    setCollapsing(c => new Set([...c, ...collapse]));
    for (const sid of collapse) setTimeout(() => {
      setCollapsing(c => new Set([...c].filter(x => x !== sid)));
      const now = rawSessions.current, gone = now.find(s => s.sid === sid);
      if (sid !== latest.current.floor || gone?.hiddenAt == null) return;   // shown again meanwhile: it stays
      setCut(n => n + 1);
      const next = nextFloor(byFloor(now.filter(s => s.hiddenAt === null || s.sid === sid), floorNums.current), sid);
      if (next) pickSid(next);
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? FADE_MS : COLLAPSE_MS);
  }, [live.snap]);
  // a hide in this snapshot collapses from this render on, before the effect above adds it: no floor switch in between
  const justHidden = live.snap ? newlyHidden(hiddenSeen.current, live.snap.sessions, live.snap.serverTime).collapse.join() : '';
  const falling = useMemo(() => new Set([...collapsing, ...justHidden.split(',').filter(Boolean)]), [collapsing, justHidden]);
  const held = useHeld(live.snap);
  const snap = useMemo(() => held && { ...held, sessions: visibleSessions(held.sessions, falling) }, [held, falling]);
  const { numbers, fresh: freshFloors } = useFloors(snap);
  floorNums.current = numbers;
  const prevAlerts = useRef<Set<string> | null>(null);
  useEffect(() => {
    // alerts use the raw snapshot: a hold must not delay a notification; a hidden floor's waiting agents alert nobody
    const raw = live.snap && { ...live.snap, sessions: visibleSessions(live.snap.sessions, new Set()) };
    if (!raw) return;
    const fresh = newAlerts(prevAlerts.current, raw);
    prevAlerts.current = alertKeys(raw);
    const n = totalAlerts(raw);
    document.title = titleFor(n);
    setFavicon(n > 0);
    if (settings.notify) for (const a of fresh) desktopNotify(a, () => {
      // pick the agent's floor (it slides in) and the agent (opens the detail panel)
      userPick(a.sid);
      select(a.key);
    });
    if (fresh.length > 0 && settings.sound) beep();
  }, [live.snap, settings.notify, settings.sound]);
  const sessions = snap?.sessions ?? [];
  const sid = pickFloor(sessions, settings.floor);
  // pin the fallback floor, so a newer session never takes the screen on its own (no automatic switch)
  useEffect(() => { if (sid && sid !== settings.floor) pickSid(sid); }, [sid]);
  // `?session=<sid>` picks that floor once, when it first shows up
  useEffect(() => {
    const want = urlPending.current ? urlFloor(location.search, sessions) : null;
    if (want) { urlPending.current = false; pickSid(want); }
  }, [sessions]);
  const floor = sessions.find(s => s.sid === sid) ?? null;
  const View = VIEWS[settings.view] ?? KanbanView;
  const sel = snap ? findAgent(snap, selected) : null;
  const listFloor = !sel && list ? sessions.find(s => s.sid === list.sid) : undefined;
  // a closed pop-up fades out like the ⚙ drawer: it keeps its last agent for .28 s, a pick
  // meanwhile takes it over
  const detail = sel && snap ? { s: sel.s, a: sel.a, now: snap.serverTime } : null;
  const lastDetail = useRef(detail);
  const [gone, setGone] = useState<typeof detail>(null);
  if (detail ? gone : !gone && lastDetail.current) setGone(detail ? null : lastDetail.current);
  useEffect(() => { lastDetail.current = detail; });
  useEffect(() => {
    if (!gone) return;
    const id = setTimeout(() => setGone(null), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280);
    return () => clearTimeout(id);
  }, [gone]);
  const pop = detail ?? gone;
  return (
    <div className="app">
      <Sidebar sessions={sessions} numbers={numbers} fresh={freshFloors} collapsing={falling} floor={sid} onPick={userPick} />
      <main className="main">
        <Header live={live} floor={floor} numbers={numbers} settings={settings} onSave={save}
          zoom={settings.view === 'pixel' && settings.style === 'iso' && isoAuto !== null ? { z: settings.isoZoom, auto: isoAuto } : null} onZoom={zoomTo} />
        <div className={`view view-${settings.view}`}>
          {!snap ? <p className="empty">{t('app.waitServer')} (<code>node src/cli.ts serve</code>)</p>
            : !floor ? <p className="empty">{t('app.noSession')}</p>
            : <View key={cut} sessions={sessions} floor={floor} collapsing={falling} numbers={numbers} style={settings.style} ctxWindow={settings.ctxWindow} isoZoom={settings.isoZoom} onIsoAuto={setIsoAuto} selected={selected}
                onSelect={(sid, key) => select(agentKey(sid, key))} onList={(sid, room) => { setSelected(null); setList({ sid, room }); }} />}
        </div>
      </main>
      {pop && <DetailPanel s={pop.s} a={pop.a} now={pop.now} closing={!detail} onClose={() => select(null)} />}
      {listFloor && list && <StageList s={listFloor} room={list.room} onPick={key => select(agentKey(listFloor.sid, key))} onClose={() => setList(null)} />}
    </div>
  );
}
