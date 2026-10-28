// The couriers' pixels: cap, satchel, letter and the product icons; data only, no DOM.
export type Company = 'ms' | 'g';
export type Product = 'teams' | 'outlook' | 'sharepoint' | 'microsoft' | 'gmail' | 'calendar' | 'drive' | 'docs' | 'sheets' | 'slides';
export type View = 'front' | 'back' | 'side';
/** char_N per company. */
export const COURIER_SHEET: Record<Company, number> = { ms: 2, g: 3 };
/** Both sheets' head-top row per sprite row (front 0, back 1, side 2) for cols 0–2 (walk, still): measured from the PNGs. */
export const HEAD_TOP: Record<0 | 1 | 2, [number, number, number]> = { 0: [2, 3, 2], 1: [2, 3, 2], 2: [4, 3, 4] };
const BACK = ['......CCCCCC....', '....CCCCCCCCCC..', '...CCCCCCCCCCCC.', '...CCCCCCCCCCCC.', '...CCCCCCCCCCCC.', '...CCCCCCCCCCCC.', '...CCCCKKKKCCCC.', '................'];
/** The courier caps, 16 wide, their first row 4 px above the head top (a 5×5 badge on a
 *  taller crown). Microsoft's badge: four 2×2 squares a b / c d with a 1 px gap; Google's a G in R Y B G. V the visor,
 *  K the strap. */
export const CAP: Record<Company, Record<View, string[]>> = {
  ms: {
    front: ['.....CCCCCC.....', '...CCCCCCCCCC...', '..CCCaaCbbCCCC..', '..CCCaaCbbCCCC..', '..CCCCCCCCCCCC..', '..CCCccCddCCCC..', '..CCCccCddCCCC..', '.VVVVVVVVVVVVVV.'],
    back: BACK,
    side: ['......CCCCC.....', '.....CCCCCCC....', '....CCCCCCCaCb..', '....CCCCCCCaCb..', '....CCCCCCCCCC..', '....CCCCCCCcCd..', '....CCCCCCCcCd..', '....KKKKKKKKVVVV'],
  },
  g: {
    front: ['.....CCCCCC.....', '...CCCCCCCCCC...', '..CCCCRRRCCCCC..', '..CCCRCCCCCCCC..', '..CCCYCCBBCCCC..', '..CCCYCCCBCCCC..', '..CCCCGGGCCCCC..', '.VVVVVVVVVVVVVV.'],
    back: BACK,
    side: ['......CCCCC.....', '.....CCCCCCC....', '....CCCCCCCCRR..', '....CCCCCCCRCC..', '....CCCCCCCYBB..', '....CCCCCCCYCB..', '....CCCCCCCCGG..', '....KKKKKKKKVVVV'],
  },
};
/** A blank row on top, and `o` on every blank cell next to a filled one (4 ways); no row below (the face). */
export function withOutline(rows: string[]): string[] {
  const m = [''.padEnd(rows[0].length, '.'), ...rows], on = (i: number, j: number) => (m[j]?.[i] ?? '.') !== '.';
  return m.map((r, j) => [...r].map((ch, i) => ch === '.' && (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1)) ? 'o' : ch).join(''));
}
/** The company's cap, outlined, its first row 5 px above the head top: Google's visor takes the four colour stripes by
 *  column (1–4 B, 5–7 R, 8–10 Y, 11–14 G). */
export function hatRows(co: Company, view: View): string[] {
  return withOutline(CAP[co][view].map(r => co === 'ms' ? r : r.replace(/V/g, (_m, i: number) => i <= 4 ? 'B' : i <= 7 ? 'R' : i <= 10 ? 'Y' : 'G')));
}
export const HAT_INK: Record<Company, Record<string, string>> = {
  ms: { o: '#1b1f2a', C: '#30333b', V: '#17181c', K: '#17181c', a: '#f25022', b: '#7fba00', c: '#00a4ef', d: '#ffb900' },
  g: { o: '#1b1f2a', C: '#f6f7f8', K: '#aeb4bc', B: '#4285f4', R: '#ea4335', Y: '#fbbc05', G: '#34a853' },
};
/** The satchel: strap pixels (S ink) and the bag (k ink, F flap, B bag) at a sprite-relative top-left; side faces right. */
export const BAG: Record<View, { strap: [number, number][]; bag: string[]; at: [number, number] }> = {
  front: { strap: [[10, 17], [9, 18], [8, 19], [7, 20]], bag: ['kkkkkk', 'kFFFFk', 'kBBBBk', 'kBBBBk', 'kkkkkk'], at: [1, 20] },
  back: { strap: [[5, 17], [6, 18], [7, 19], [8, 20]], bag: ['kkkkkk', 'kFFFFk', 'kBBBBk', 'kBBBBk', 'kkkkkk'], at: [9, 20] },
  side: { strap: [[8, 16], [8, 17], [8, 18], [8, 19]], bag: ['kkkkk', 'kFFFk', 'kBBBk', 'kBBBk', 'kkkkk'], at: [1, 19] },
};
export const BAG_INK: Record<Company, Record<string, string>> = {
  // Microsoft's bag in its logo blue and a grey strap, so neither reads as a blue sleeve
  ms: { k: '#1b1f2a', F: '#0078d4', B: '#00a4ef', S: '#737373' }, g: { k: '#1b1f2a', F: '#b3261e', B: '#ea4335', S: '#b3261e' },
};
/** The letter, 8×6: s the seal in the product's colour. */
export const LETTER = ['kkkkkkkk', 'kkwwwwkk', 'kwkwwkwk', 'kwwsswwk', 'kwwwwwwk', 'kkkkkkkk'];
export const LETTER_INK: Record<string, string> = { k: '#5c6375', w: '#f6f7f8' };
/** 8×8 product icons for iconBubble (Microsoft's logo for an unknown Microsoft 365 tool). */
export const ICON: Record<Product, string[]> = {
  teams: ['pppppppp', 'pwwwwwwp', 'pwwwwwwp', 'pppwwppp', 'pppwwppp', 'pppwwppp', 'pppwwppp', 'pppppppp'],
  outlook: ['OOOOOOOO', 'OOwwwwOO', 'OwwOOwwO', 'OwOOOOwO', 'OwOOOOwO', 'OwwOOwwO', 'OOwwwwOO', 'OOOOOOOO'],
  sharepoint: ['tttttttt', 'ttwwwwwt', 'twwttttt', 'ttwwwwtt', 'tttttwwt', 'tttttwwt', 'twwwwwtt', 'tttttttt'],
  microsoft: ['RRR.GGG.', 'RRR.GGG.', 'RRR.GGG.', '........', 'BBB.YYY.', 'BBB.YYY.', 'BBB.YYY.', '........'],
  gmail: ['rwwwwwwr', 'rrwwwwrr', 'rwrwwrwr', 'rwwrrwwr', 'rwwwwwwr', 'rwwwwwwr', 'rwwwwwwr', 'rrrrrrrr'],
  calendar: ['bbbbbbbb', 'bbbbbbbb', 'bwwwwwwb', 'bwbwbwwb', 'bwwwwwwb', 'bwbwbwwb', 'bwwwwwwb', 'bbbbbbbb'],
  drive: ['...yy...', '..gyyy..', '..ggyy..', '.gg..yy.', '.g....y.', 'gg....yy', 'bbbbbbbb', 'bbbbbbbb'],
  docs: ['bbbbbb..', 'bbbbbbb.', 'bwwwwwbb', 'bbbbbbbb', 'bwwwwwbb', 'bbbbbbbb', 'bwwwbbbb', 'bbbbbbbb'],
  sheets: ['gggggg..', 'ggggggg.', 'gwwwwwwg', 'gwgwgwwg', 'gwwwwwwg', 'gwgwgwwg', 'gwwwwwwg', 'gggggggg'],
  slides: ['yyyyyy..', 'yyyyyyy.', 'yyyyyyyy', 'ywwwwwwy', 'ywwwwwwy', 'ywwwwwwy', 'yyyyyyyy', 'yyyyyyyy'],
};
export const ICON_INK: Record<string, string> = { w: '#ffffff', p: '#5b5fc7', O: '#0f6cbd', t: '#038387', R: '#f25022', G: '#7fba00', B: '#00a4ef',
  Y: '#ffb900', r: '#ea4335', g: '#34a853', b: '#4285f4', y: '#fbbc05' };
/** The seal's colour: each product's main colour. */
export const SEAL: Record<Product, string> = { teams: '#5b5fc7', outlook: '#0f6cbd', sharepoint: '#038387', microsoft: '#00a4ef', gmail: '#ea4335',
  calendar: '#4285f4', drive: '#34a853', docs: '#4285f4', sheets: '#34a853', slides: '#fbbc05' };
