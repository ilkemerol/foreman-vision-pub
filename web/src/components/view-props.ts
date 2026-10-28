import type { SessionView } from '../../../shared/types.ts';
import type { FloorNumbers } from '../logic/floors.ts';
import type { Room } from '../logic/hybrid.ts';
import type { CtxWindow, OfficeStyle } from '../logic/settings.ts';

export interface ViewProps {
  sessions: SessionView[];  // every floor, oldest first (Kanban draws them all as lanes)
  floor: SessionView;       // the floor picked in the sidebar
  numbers: FloorNumbers;
  style: OfficeStyle;       // Pixel office renderer: flat or iso
  ctxWindow: CtxWindow;     // Pixel office context gauge's window setting (Kanban and Hybrid ignore it)
  isoZoom: number | null;            // Pixel office: the iso zoom step (null: auto; Kanban and Hybrid ignore it)
  onIsoAuto: (css: number) => void;  // Pixel office: the floor on screen's auto iso scale, for the header's steps
  selected: string | null;  // agentKey(sid, AgentView.key) of the selected agent: it stays across a pending agent's bind
  onSelect: (sid: string, key: string) => void;   // key: AgentView.key
  collapsing: ReadonlySet<string>;   // floors caving in (logic/collapse.ts): Pixel draws the fall, the others ignore it
  onList: (sid: string, room: Room) => void;   // Hybrid's "+N": the full stage card in the detail panel (Kanban and Pixel ignore it)
}
