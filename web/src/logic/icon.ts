/** The foreman-vision icon: a foreman's friendly face under a yellow hard hat. One map for the favicon and the sidebar. */
export const ICON_PX = 16;

export const ICON_PALETTE: Record<string, string> = {
  o: '#1c1306', // outline: dark enough for light and dark tab bars
  y: '#facc15', h: '#fef08a', s: '#ca8a04', // hat, highlight, shade (band, brim)
  k: '#f4c59c', p: '#111827', // the face: skin, eyes and smile
  d: '#f97316', // the waiting dot
};

const FACE = [
  '................',
  '......oooo......',
  '....oohhyyoo....',
  '...ohhyyyyyso...',
  '..ohyyyyyyyyso..',
  '..ohyyyyyyyyso..',
  'ooossssssssssooo',
  'ohhyyyyyyyyyyyso',
  'oooooooooooooooo',
  '..okkkkkkkkkko..',
  '..okkpkkkkpkko..',
  '..okkpkkkkpkko..',
  '..okkkkkkkkkko..',
  '..okkkpkkpkkko..',
  '...okkkppkkko...',
  '....oooooooo....',
];
export const EYE_ROWS = 2; // the eyes' rows, from EYE_TOP
const EYE_TOP = 10;
const LASH = '..okookkkkooko..'; // shut: a short dark line per eye on the eyes' last row
// top-right, over the hat's empty corner
const DOT = ['..oo..', '.oddo.', 'oddddo', 'oddddo', '.oddo.', '..oo..'];

/** The icon's rows ('.' clear). `lid` 0–EYE_ROWS eye rows shut from the top (all: closed, a lash line); `dot` adds the waiting dot. */
export function iconRows({ lid = 0, dot = false }: { lid?: number; dot?: boolean } = {}): string[] {
  return FACE.map((row, y) => {
    const e = y - EYE_TOP;
    if (e >= 0 && e < lid) row = lid === EYE_ROWS && e === EYE_ROWS - 1 ? LASH : row.replace(/p/g, 'k');
    const d = DOT[y];
    if (dot && d) row = row.slice(0, ICON_PX - d.length) + [...d].map((c, i) => c === '.' ? row[ICON_PX - d.length + i] : c).join('');
    return row;
  });
}

/** Paints the rows at an integer `scale` from 0,0. */
export function drawIcon(g: CanvasRenderingContext2D, rows: string[], scale: number) {
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    g.fillStyle = ICON_PALETTE[c];
    g.fillRect(x * scale, y * scale, scale, scale);
  }));
}
