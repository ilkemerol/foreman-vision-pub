export interface DiffLine { op: ' ' | '-' | '+'; text: string }

const split = (s: string) => (s === '' ? [] : s.split(/\r?\n/));

/** A line diff of an edit's old and new text: context, then each change as its removed then its added lines. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = split(a), y = split(b);
  let h = 0, t = 0;
  while (h < x.length && h < y.length && x[h] === y[h]) h++;
  while (t < x.length - h && t < y.length - h && x[x.length - 1 - t] === y[y.length - 1 - t]) t++;
  const xs = x.slice(h, x.length - t), ys = y.slice(h, y.length - t), n = xs.length, m = ys.length;
  const ctx = (l: string[]): DiffLine[] => l.map(text => ({ op: ' ', text }));
  const mid: DiffLine[] = [];
  if (n * m > 250_000) {
    // shortcut: a big middle is not diffed line by line; switch to Myers if a real 500+ line edit reads badly
    mid.push(...xs.map(text => ({ op: '-' as const, text })), ...ys.map(text => ({ op: '+' as const, text })));
  } else {
    const w = m + 1, L = new Int32Array((n + 1) * w);   // L[i*w+j]: LCS of xs[i..] and ys[j..]
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      L[i * w + j] = xs[i] === ys[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && xs[i] === ys[j]) { mid.push({ op: ' ', text: xs[i] }); i++; j++; }
      else if (j >= m || (i < n && L[(i + 1) * w + j] >= L[i * w + j + 1])) mid.push({ op: '-', text: xs[i++] });
      else mid.push({ op: '+', text: ys[j++] });
    }
  }
  return [...ctx(x.slice(0, h)), ...mid, ...ctx(x.slice(x.length - t))];
}

export function diffCount(d: DiffLine[]): { add: number; del: number } {
  return { add: d.filter(l => l.op === '+').length, del: d.filter(l => l.op === '-').length };
}
