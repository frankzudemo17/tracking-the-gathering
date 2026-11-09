// Sitzlayouts des Lifecounters: Rasterplätze je Spielerzahl und Layout.
// slotsFor wörtlich aus mockup/design-canvas-quellen/Main.dc.html:1706–1737 (Werte unverändert).
// Slot: c = Spalte, r = Zeile (ab 1), rot = Drehung in Grad, cs/rs = Spalten-/Zeilenspanne.

export const LAYOUTS = ['seiten', 'rundum', 'gegenueber', 'unten'];

export function slotsFor(n, L) {
  const S = (c, r, rot, cs, rs) => ({ c, r, rot, cs: cs || 1, rs: rs || 1 });
  if (n === 2 && (L === 'seiten' || L === 'rundum')) L = 'gegenueber';
  if (L === 'unten') {
    const cols = n <= 2 ? 1 : 2; const slots = [];
    for (let i = 0; i < n; i++) { const last = cols === 2 && n % 2 === 1 && i === n - 1; slots.push(S(cols === 1 ? 1 : (i % 2) + 1, Math.floor(i / cols) + 1, 0, last ? 2 : 1)); }
    return { cols, rows: Math.ceil(n / cols), slots };
  }
  if (L === 'gegenueber') {
    return ({
      2: { cols: 1, rows: 2, slots: [S(1, 1, 180), S(1, 2, 0)] },
      3: { cols: 2, rows: 2, slots: [S(1, 1, 180), S(2, 1, 180), S(1, 2, 0, 2)] },
      4: { cols: 2, rows: 2, slots: [S(1, 1, 180), S(2, 1, 180), S(2, 2, 0), S(1, 2, 0)] },
      5: { cols: 6, rows: 2, slots: [S(1, 1, 180, 2), S(3, 1, 180, 2), S(5, 1, 180, 2), S(4, 2, 0, 3), S(1, 2, 0, 3)] },
      6: { cols: 3, rows: 2, slots: [S(1, 1, 180), S(2, 1, 180), S(3, 1, 180), S(3, 2, 0), S(2, 2, 0), S(1, 2, 0)] }
    })[n];
  }
  if (L === 'rundum') {
    return ({
      3: { cols: 2, rows: 2, slots: [S(1, 1, 180, 2), S(2, 2, -90), S(1, 2, 90)] },
      4: { cols: 2, rows: 3, slots: [S(1, 1, 180, 2), S(2, 2, -90), S(1, 3, 0, 2), S(1, 2, 90)] },
      5: { cols: 2, rows: 4, slots: [S(1, 1, 180, 2), S(2, 2, -90), S(2, 3, -90), S(1, 4, 0, 2), S(1, 2, 90, 1, 2)] },
      6: { cols: 2, rows: 4, slots: [S(1, 1, 180, 2), S(2, 2, -90), S(2, 3, -90), S(1, 4, 0, 2), S(1, 3, 90), S(1, 2, 90)] }
    })[n];
  }
  return ({
    3: { cols: 2, rows: 2, slots: [S(1, 1, 90), S(2, 1, -90), S(1, 2, 0, 2)] },
    4: { cols: 2, rows: 2, slots: [S(1, 1, 90), S(2, 1, -90), S(2, 2, -90), S(1, 2, 90)] },
    5: { cols: 2, rows: 3, slots: [S(1, 1, 90), S(2, 1, -90), S(2, 2, -90), S(1, 3, 0, 2), S(1, 2, 90)] },
    6: { cols: 2, rows: 3, slots: [S(1, 1, 90), S(2, 1, -90), S(2, 2, -90), S(2, 3, -90), S(1, 3, 90), S(1, 2, 90)] }
  })[n];
}

/**
 * Effektives Layout mit Raster. n === 2 bei seiten/rundum ⇒ gegenueber (Main.dc.html:2320);
 * liefert slotsFor nichts ⇒ Rückfall auf 'unten' (Main.dc.html:2328).
 * @returns {{ layout: string, cols: number, rows: number, slots: object[] }}
 */
export function layoutFor(n, layout) {
  let eff = (n === 2 && (layout === 'seiten' || layout === 'rundum')) ? 'gegenueber' : layout;
  let r = slotsFor(n, eff);
  if (!r) { eff = 'unten'; r = slotsFor(n, 'unten'); }
  return { layout: eff, cols: r.cols, rows: r.rows, slots: r.slots };
}
