import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { SessionView } from '../../../shared/types.ts';
import { blockAt, collapseBlocks, cracked, dustAt, FADE_MS, shakeAt, type Block } from '../logic/collapse.ts';
import { bowlFood, CAT_HIT, catDraw, heartsAt, mealSlot, perches, pet, seedCat, someoneWaits, stepCat, type Cat, type Heart } from '../logic/cat.ts';
import { bowlsOf, walkBlocks } from '../logic/decor.ts';
import { failFx, medicPts } from '../logic/fx.ts';
import { armFire, fireAt, fireGeom, fireMemory, fireMet, fireTimes, loadFireLog, logFire, saveFireLog, sootAt, stepFire } from '../logic/fire.ts';
import { coffeeRooms, renameCoffee, stepRooms } from '../logic/coffee.ts';
import { stepCoins, tickCoins, type Piles } from '../logic/coins.ts';
import { canVisit, ctxPct, seedGauge, stepGauge, visitPath } from '../logic/corner.ts';
import { busyCalls, courierPoses, courierSpots, deskBusy, foremanAtDesk, noteCalls, seedCouriers, stepCouriers } from '../logic/couriers.ts';
import { agentKey } from '../logic/model.ts';
import { advanceWalkers, awayGap, nearDoor, stepBurns, stepDoor, syncWalkers, walksAt, type DoorState, type Walker } from '../logic/motion.ts';
import { DASH, dashFrame, doneSeats, isoFit, officeLayout, platePos, zoomLayout, type Style } from '../logic/layout.ts';
import { BOARD_HIT, hasTerminal } from '../logic/board.ts';
import { shownLabels } from '../logic/labels.ts';
import { chargeAt, dockOf, robotAt, robotRoute } from '../logic/robot.ts';
import { deskDemand, deskMemory, doneMemory, hitAt, keepFloors, officeScene, rememberDone, themeOf, type DeskMemory, type DoneMemory, type Hit, type Scene } from '../logic/scene.ts';
import type { CtxWindow } from '../logic/settings.ts';
import { serverNow } from '../store.ts';
import { scrollbarSize, useDpr } from '../useSize.ts';
import { shown, zoomCentre, zoomScroll } from '../logic/zoom.ts';
import { syncOverlay } from './office/overlay.ts';
import { drawHearts } from './office/pets.ts';
import type { Renderer } from './office/renderer.ts';
import { Terminal } from './office/Terminal.tsx';
import { BoardPop } from './office/BoardPop.tsx';
import type { ViewProps } from './view-props.ts';

const FRAME_INK = '#3b4a78';
const DUST = '#b9b2a3', FALL_BLOCK = 12;   // a collapse's dust and block size (office px)   // the office frame's faded navy (the theme's --line/--accent family)
// prefers-reduced-motion, read every frame, so turning the OS setting on takes effect at once
const CALM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
// per floor, for the page's lifetime: a view or floor change keeps it, a reload does not; a floor
// that leaves the snapshot drops it (keepDoneMems)
const doneMems = new Map<string, DoneMemory>(), deskMems = new Map<string, DeskMemory>();
const doneMemOf = (sid: string) => doneMems.get(sid) ?? doneMems.set(sid, doneMemory()).get(sid)!;
const deskMemOf = (sid: string) => deskMems.get(sid) ?? deskMems.set(sid, deskMemory()).get(sid)!;
export const keepDoneMems = (sessions: SessionView[]): void => { keepFloors(doneMems, sessions); keepFloors(deskMems, sessions); };

/** One floor's office: scene per snapshot, walkers and doors per animation frame, text as a DOM overlay. */
export function OfficeFloor({ s, plate, collapse = false, renderer, ctxWindow, avail, selected, onSelect, zoom, onAuto }: {
  s: SessionView; plate: string; collapse?: boolean; renderer: Renderer; ctxWindow: CtxWindow; avail: { w: number; h: number }; selected: string | null; onSelect: ViewProps['onSelect'];
  zoom: number | null; onAuto?: (css: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLDivElement>(null), frameCv = useRef<HTMLCanvasElement>(null), hearts = useRef<HTMLCanvasElement>(null);
  // a fresh mount (reload, view or floor change) starts empty and seeds: nobody walks in again
  const st = useRef({ walkers: new Map<string, Walker>(), doors: [] as DoorState[], coffee: coffeeRooms(), gauge: seedGauge(null), key: '', seeded: false, hits: [] as Hit[], cat: null as Cat | null, hearts: [] as Heart[], couriers: seedCouriers([]), coins: new Map() as Piles,
    fall: null as { copy: HTMLCanvasElement; blocks: Block[]; t0: number } | null, fire: fireMemory(), fireT0: null as number | null }).current;
  const demand = useMemo(() => deskDemand(s.agents, { mem: deskMemOf(s.sid), now: serverNow() }), [s]);
  const dpr = useDpr();   // another monitor or a browser zoom: the scales change, so the layout does
  // with no zoom iso fills the area on officeLayout's grid (layout.ts isoFit); flat and the grid as before
  const fit = { w: avail.w, h: avail.h, dpr, demand, sb: scrollbarSize(), frame: true };
  const auto = useMemo(() => isoFit(officeLayout(fit), avail.w, avail.h, dpr), [avail.w, avail.h, demand, dpr]);
  useEffect(() => { onAuto?.(auto.views.iso.css); }, [onAuto, auto.views.iso.css]);
  // a stored step lays iso out anew, as a smaller or bigger window would; flat,
  // no step or auto's own draw auto, which does not depend on the style (a style change keeps everyone where they are)
  const l = useMemo(() => renderer.style === 'iso' && zoom !== null ? zoomLayout(fit, zoom, auto) : auto, [auto, renderer.style, zoom]);
  const scene = useMemo(() => officeScene(s.agents, serverNow(), l, rememberDone(doneMemOf(s.sid), s.agents), deskMemOf(s.sid)), [s, l]);
  const agents = useMemo(() => new Map(s.agents.map(a => [a.id, a])), [s]);
  const route = useMemo(() => robotRoute(l), [l]);
  // where the fire happens and its timeline, once per grid
  const fireG = useMemo(() => fireGeom(l), [l]), fireT = useMemo(() => fireTimes(fireG), [fireG]);
  const sp = useMemo(() => courierSpots(l), [l]);
  // the gauge's target; a new setting (Kaydet) only moves the target, the visit rule runs as usual (not a seed)
  const target = ctxPct(s.context, ctxWindow);
  // a seed puts everyone at their place at once and resets the doors, the coffee schedules, the gauge and the couriers
  // (nobody out), and drops every burn
  const seedAt = (sc: Scene, now: number, fresh: boolean) => {
    syncWalkers(st.walkers, sc.places, sc.layout, true, now);
    stepCoins(st.coins, sc, st.walkers, latest.current.agents, now, { seed: true, calm: CALM?.matches ?? false });
    // fresh (a mount, a new grid) she rests somewhere at random; a tab return ends her step
    const { agents } = latest.current;
    // the visit slot due now is owed only after a tab return (one visit for all it missed)
    st.cat = seedCat(fresh ? null : st.cat, sc.layout, perches(sc, agents, st.walkers), someoneWaits(sc), now, Math.random, mealSlot(latest.current.sid, serverNow()));
    st.hearts = [];   // a pet's hearts are never kept
    st.doors = sc.layout.doors.map(() => ({ k: 0, last: 0 })); st.coffee = coffeeRooms();
    st.gauge = seedGauge(latest.current.target);
    // on a mount or a tab return the calls so far bring nobody; a new grid keeps what was seen, so a
    // call in the snapshot that grew it still sends its courier
    st.couriers = seedCouriers(latest.current.connectors, fresh && st.seeded ? st.couriers : undefined);
    // a bind ends a fire under way (its soot stays) and arms the next only if the condition is not
    // met now: one met before the load, on a tab return or on another floor never plays; the last fire from this browser
    if (fresh) st.fire = fireMemory(loadFireLog()[latest.current.sid] ?? null);
    st.fireT0 = null;
    armFire(st.fire, fireMet(latest.current.agents.values(), serverNow()));
  };
  useLayoutEffect(() => {
    // a new grid (window resized, more desks needed) seeds too: everyone appears at their new place
    if (!st.seeded || st.key !== l.key) seedAt(scene, performance.now(), true);
    else {
      // coins: before syncWalkers, which reads the old walker for payday (logic/coins.ts stepCoins)
      const now = performance.now();
      stepCoins(st.coins, scene, st.walkers, agents, now, { seed: false, calm: CALM?.matches ?? false });
      // a hand-over keeps its agent's coffee schedule
      for (const [from, to] of syncWalkers(st.walkers, scene.places, l, false, now, walkBlocks(l), id => agents.get(id)?.stageSince)) { renameCoffee(st.coffee.wait, from, to); renameCoffee(st.coffee.done, from, to); }
    }
    st.key = l.key; st.seeded = true;
  }, [scene]);

  const size = renderer.size(l.cols, l.rows);
  // the layout at its own scale: today's numbers, or whole CSS px for a fitted or zoomed iso (zoom.ts shown)
  const v = useMemo(() => shown(l, renderer.style, avail.w, avail.h, dpr, scrollbarSize()), [l, renderer.style, avail.w, avail.h, dpr]), { device, css, text, textK } = v;
  // the user's outer shell: a faded navy pixel dashed line, its blocks at this style's own scale
  const fr = useMemo(() => v.frame ? dashFrame(size.w, size.h) : null, [v.frame, size.w, size.h]);
  const platePt = platePos(l, renderer.style, avail.w, avail.h, scrollbarSize(), plate.length, v);   // the big faded floor plate, clear of the frame
  useLayoutEffect(() => {
    const g = frameCv.current?.getContext('2d');
    if (!g || !fr) return;
    g.setTransform(device, 0, 0, device, 0, 0);
    g.clearRect(0, 0, fr.w, fr.h);
    g.fillStyle = FRAME_INK;
    for (const b of fr.blocks) g.fillRect(b.x, b.y, DASH, DASH);
  }, [fr, device]);
  // a fitted or zoomed iso keeps the office point at the visible centre on
  // a new size; a new floor or a new grid (a step, a load's first snapshots, a resize) starts at the office's middle;
  // a whole device px scale keeps today's pane scroll
  const shellEl = useRef<HTMLDivElement>(null), centre = useRef<{ x: number; y: number; key: string } | null>(null);
  useLayoutEffect(() => {
    const p = shellEl.current?.parentElement, c = canvas.current;
    if (!p || !c || !v.at) { centre.current = null; return; }
    const pr = p.getBoundingClientRect(), cr = c.getBoundingClientRect();   // the slide's transform moves both alike
    const ox = cr.left - pr.left - p.clientLeft + p.scrollLeft, oy = cr.top - pr.top - p.clientTop + p.scrollTop;
    const to = centre.current?.key === l.key ? centre.current : { x: size.w / 2, y: size.h / 2 };
    p.scrollLeft = zoomScroll(to.x, css, ox, p.clientWidth, p.scrollWidth - p.clientWidth);
    p.scrollTop = zoomScroll(to.y, css, oy, p.clientHeight, p.scrollHeight - p.clientHeight);
    const keep = () => { centre.current = { x: zoomCentre(p.scrollLeft, css, ox, p.clientWidth), y: zoomCentre(p.scrollTop, css, oy, p.clientHeight), key: l.key }; };
    keep();
    p.addEventListener('scroll', keep, { passive: true });
    return () => p.removeEventListener('scroll', keep);
  }, [v]);
  const selectedId = s.agents.find(a => agentKey(s.sid, a.key) === selected)?.id ?? null;
  // the terminal follows the hover, a click pins it; either resets once the agent leaves its spot
  const [hover, setHover] = useState<string | null>(null), [pinned, setPinned] = useState<string | null>(null);
  const latest = useRef({ scene, agents, renderer, device, css, text, textK, selectedId, hover, pinned, target, route, sid: s.sid, sp, connectors: s.connectors, main: agents.get('main'), collapse, size, fireG, fireT });
  latest.current = { scene, agents, renderer, device, css, text, textK, selectedId, hover, pinned, target, route, sid: s.sid, sp, connectors: s.connectors, main: agents.get('main'), collapse, size, fireG, fireT };

  useEffect(() => {
    let raf = 0, last = performance.now(), styles: Style[] = [];
    const loop = (t: number) => {
      const { scene, agents, renderer, device, css, text, textK, selectedId, hover, pinned, target, route, sid, sp, connectors, main, collapse, size, fireG, fireT } = latest.current;
      const g = canvas.current?.getContext('2d'), calm = CALM?.matches ?? false;
      if (collapse && g) { fallFrame(g, t, device, size, calm); last = t; raf = requestAnimationFrame(loop); return; }
      if (st.fall) { st.fall = null; overlay.current?.style.removeProperty('visibility'); }   // shown again meanwhile
      // a hidden or occluded tab gets about a frame a second: reseed so nobody is still walking on return (a style
      // switch's long frame never does)
      styles = [renderer.style, ...styles].slice(0, 3);
      const away = awayGap(t - last, styles);
      if (away) seedAt(scene, t, false);
      // a newer call sends a courier; before the gauge, so a box visit never starts as one hands over
      noteCalls(st.couriers, connectors);
      if (!away) stepCouriers(st.couriers, sp, t, Math.max(0, Math.min(100, t - last)), busyCalls(main), foremanAtDesk(scene, st.walkers, st.gauge.visit !== null));
      const corner = stepGauge(st.gauge, target, canVisit(scene, agents, st.walkers) && !deskBusy(st.couriers, sp), visitPath(scene.layout), t);
      const trips = stepRooms(st.coffee, scene.places, st.walkers, scene.layout, t);   // before walking: one cut short walks on now
      if (!away) advanceWalkers(st.walkers, Math.max(0, Math.min(100, t - last)), t);
      stepBurns(scene.places, st.walkers, t);
      tickCoins(st.coins, scene, st.walkers, t, calm);
      // office-cat-robot: the robot is where the server clock says; one step of Smooth (none on a tab return: the seed ended it)
      const sNow = serverNow(), robot = robotAt(route, sid, sNow);
      // the condition formed in sight starts the fire (its time kept in this browser for the cooldown)
      if (stepFire(st.fire, fireMet(agents.values(), sNow), sNow)) { st.fireT0 = t; saveFireLog(logFire(loadFireLog(), sid, sNow)); }
      const fx = st.fireT0 === null ? null : fireAt(fireG, fireT, t - st.fireT0, calm);
      if (!fx) st.fireT0 = null;
      // she runs away: while it burns Smooth keeps out of the server room, its desks too
      const perched = perches(scene, agents, st.walkers).filter(p => !fx || p === 'foreman' || scene.layout.desks[p].room !== 'server');
      if (!away) stepCat(st.cat!, scene.layout, { perched, waiting: someoneWaits(scene), robot, bowls: bowlsOf(scene.layout), meal: mealSlot(sid, sNow), noServer: fx !== null }, t, Math.max(0, Math.min(100, t - last)), Math.random);
      // a door opens only for someone walking, never for whoever sits next to it; the medics too; Smooth, the robot and the couriers too
      const couriers = courierPoses(st.couriers, sp, t);
      const walking = [...st.walkers.values()].filter(w => walksAt(w, t)).map(w => w.pt).concat([...failFx(scene, st.walkers, t).values()].flatMap(medicPts),
        st.cat!.mode === 'walk' || st.cat!.mode === 'run' ? [st.cat!.pt] : [], robot.moving ? [robot.pt] : [], couriers.filter(c => c.walking).map(c => c.pt), fx ? fx.crew.filter(c => c.moving).map(c => c.pt) : []);
      scene.layout.doors.forEach((d, i) => stepDoor(st.doors[i], nearDoor(d, walking), t));
      if (g && overlay.current) {
        g.setTransform(device, 0, 0, device, 0, 0);
        g.imageSmoothingEnabled = false;
        const out = renderer.draw(g, { scene, agents, walkers: st.walkers, trips, doors: st.doors, theme: themeOf(sid), selectedId, now: t, serverNow: serverNow(), textK, corner,
          pets: { cat: catDraw(st.cat!, t, robot.pt), robot, dock: dockOf(scene.layout), charge: chargeAt(route, sid, sNow), food: bowlFood(st.cat!, t) }, couriers, coins: st.coins,
          ambient: { date: new Date(), calm },
          fire: { geom: fireG, fx, soot: sootAt(sNow, st.fire.last) },
        });
        // Smooth's tag (pets.ts catTag) and a Done lounge agent's name show only while the pointer is on them
        syncOverlay(overlay.current, shownLabels(out.labels, hover, CAT_HIT), css, out.bodies, text);
        st.hits = out.hits;
        // a pet's hearts over her head, on their own canvas over the text: a desk's agent tag would hide them
        const fg = hearts.current?.getContext('2d'), cat = out.hits.find(h => h.id === CAT_HIT);
        if (fg) {
          fg.setTransform(1, 0, 0, 1, 0, 0); fg.clearRect(0, 0, fg.canvas.width, fg.canvas.height);
          fg.setTransform(device, 0, 0, device, 0, 0);
          if (cat) drawHearts(fg, heartsAt(st.hearts, t), (cat.x0 + cat.x1) / 2, cat.y0);
        }
        if (hover && !out.hits.some(h => h.id === hover)) setHover(null);
        if (pinned && !out.hits.some(h => h.id === pinned)) setPinned(null);
      }
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** The floor caves in (logic/collapse.ts): the last frame drawn, cut into blocks that fall off the canvas; the text,
   *  the terminal and the hearts go at once. Reduced motion: the frame fades. */
  const fallFrame = (g: CanvasRenderingContext2D, t: number, device: number, size: { w: number; h: number }, calm: boolean) => {
    if (!st.fall) {
      const copy = document.createElement('canvas');
      copy.width = g.canvas.width; copy.height = g.canvas.height;
      copy.getContext('2d')!.drawImage(g.canvas, 0, 0);
      st.fall = { copy, blocks: collapseBlocks(size.w, size.h, FALL_BLOCK, Math.random), t0: t };
      overlay.current?.style.setProperty('visibility', 'hidden');
      const fg = hearts.current?.getContext('2d');
      fg?.setTransform(1, 0, 0, 1, 0, 0); fg?.clearRect(0, 0, fg.canvas.width, fg.canvas.height);
      setHover(null); setPinned(null);
    }
    const { copy, blocks, t0 } = st.fall, e = t - t0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.imageSmoothingEnabled = false;
    if (calm) { g.globalAlpha = Math.max(0, 1 - e / FADE_MS); g.drawImage(copy, 0, 0); g.globalAlpha = 1; return; }
    g.setTransform(device, 0, 0, device, 0, 0);
    const sh = shakeAt(e), seam = cracked(e) ? 1 : 0;
    for (const b of blocks) {
      const { dx, dy } = blockAt(b, e, size.h);
      if (b.y + dy >= size.h) continue;
      const w = b.w - seam, h = b.h - seam;
      g.drawImage(copy, b.x * device, b.y * device, w * device, h * device, b.x + dx + sh.x, b.y + dy + sh.y, w, h);
    }
    g.fillStyle = DUST;
    for (const p of dustAt(blocks, size.h, e)) g.fillRect(p.x + sh.x, p.y + sh.y, p.s, p.s);
  };

  const at = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return hitAt(st.hits, { x: (e.clientX - r.left) * size.w / r.width, y: (e.clientY - r.top) * size.h / r.height });
  };
  const click = (e: MouseEvent<HTMLCanvasElement>) => {
    const id = at(e);
    // a click on Smooth pets her, the agent behind is not selected
    if (id === CAT_HIT) { st.hearts = pet(st.hearts, performance.now(), Math.random); return; }
    if (id === BOARD_HIT) return;   // the board's balloon follows the hover; a click there selects nobody
    setPinned(p => (id && p !== id ? id : null));   // empty floor unpins
    if (id) onSelect(s.sid, agents.get(id)?.key ?? id);
  };

  const cssW = v.W, cssH = v.H;
  const termId = pinned ?? hover, termA = termId && hasTerminal(scene.places.get(termId)) ? agents.get(termId) : undefined, termHit = st.hits.find(h => h.id === termId);
  const boardHit = hover === BOARD_HIT ? st.hits.find(h => h.id === BOARD_HIT) : undefined;
  const inDone = boardHit ? [...scene.places].filter(([, p]) => p.kind === 'done').flatMap(([id]) => agents.get(id) ?? []) : [];
  return (
    // this style's margin and frame (layout.ts officeLayout, zoom.ts shown), kept inside the scroll area too; zoomed, whole px from the pane's corner
    <div ref={shellEl} className="shell" style={{ padding: `${v.pad.t}px ${v.pad.r}px ${v.pad.b}px ${v.pad.l}px`, margin: v.at ? `${v.at.y}px 0 0 ${v.at.x}px` : undefined }}>
      {platePt && <div className={`plate${collapse ? ' fall' : ''}`} style={{ left: platePt.x, top: platePt.y }}>{plate}</div>}
      {fr &&<canvas ref={frameCv} className="frame" width={fr.w * device} height={fr.h * device} style={{ left: v.mx, top: v.my, width: v.fw, height: v.fh }} />}
      <div className="stage" style={{ width: cssW, height: cssH }}>
        <canvas ref={canvas} className="office" width={size.w * device} height={size.h * device} style={{ width: cssW, height: cssH, cursor: hover === CAT_HIT ? 'pointer' : undefined }} onClick={click}
          onMouseMove={e => setHover(at(e))} onMouseLeave={() => setHover(null)} />
        <div ref={overlay} className="ov" />
        <canvas ref={hearts} className="hearts" width={size.w * device} height={size.h * device} style={{ width: cssW, height: cssH }} />
        {termA && termHit && <Terminal key={termId} a={termA} hit={termHit} scale={css} stageW={cssW} stageH={cssH} pinned={pinned === termId} />}
        {boardHit && <BoardPop done={inDone} cap={doneSeats(l).length} hit={boardHit} scale={css} stageW={cssW} stageH={cssH} now={serverNow()} />}
      </div>
    </div>
  );
}
