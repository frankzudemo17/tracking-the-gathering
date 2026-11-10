// Feldfarbe (HANDOFF 5.4a, WELLE E2 F1): Farben und Darstellung des Feldhintergrunds je Deck.
// Keine Importe, kein DOM ⇒ in Node testbar.
// Modus pro Deck (decks.field_mode): 'art' = Commander-Bild ungetönt (Standard) ·
// 'color' = eigene Farbe aus PALETTE (decks.field_color) · 'commander' = Commander-Farben getönt
// (eine Farbe per color-mix, mehrere als harte 135°-Streifen). Spielerfarben gibt es in der
// Oberfläche nicht mehr (WELLE E2 F1a) ⇒ Commander-Farben sind die Mana-Farben.
// Feldrahmen sind laut F1a für alle Felder neutral; --field-frame ist nur die dunklere Variante
// der Feldfarbe (HANDOFF 5.4c) für kleine Farbmarken wie den Farbkreis im Setup.

/** Eigene Farben, Reihenfolge und Werte wie HANDOFF 5.4a. Namen über i18n `setup.colors.<PALETTE_KEYS[i]>`. */
export const PALETTE = ['#C4452F', '#D9822B', '#C9A45C', '#2E7D50', '#1F8A8A', '#2D6DB5', '#6B4FB8', '#C2457A', '#8A5A3C', '#6B7480'];
export const PALETTE_KEYS = ['red', 'orange', 'gold', 'green', 'teal', 'blue', 'violet', 'pink', 'brown', 'grey'];

/** Mana-Pips (HANDOFF 4, gleiche Werte wie --mana-* in tokens.css). */
export const MANA = { W: '#EFE6C4', U: '#2D6DB5', B: '#3A3337', R: '#C4452F', G: '#2E7D50' };
export const COLORLESS = '#8A94A3';
export const MODES = ['art', 'color', 'commander'];

/** Mischanteil der Tönung je Look (Mockup P2, quelle.html TINT). */
export const TINT = { nacht: 58, arktis: 52, lachs: 52 };

const WUBRG = ['W', 'U', 'B', 'R', 'G'];
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Commander-Farben eines Decks in WUBRG-Reihenfolge als Mana-Farbwerte, farblos ⇒ grau. */
export function commanderColors(deck) {
  const ci = deck?.color_identity || [];
  const cols = WUBRG.filter((c) => ci.includes(c)).map((c) => MANA[c]);
  return cols.length ? cols : [COLORLESS];
}

/** Farbliste des Felds: eigene Farbe (field_color) gewinnt, sonst Commander-Farben. */
export function fieldColors(deck) {
  const own = deck?.field_color;
  if (typeof own === 'string' && HEX.test(own)) return [own];
  return commanderColors(deck);
}

/** Modus eines Decks; ältere Zeilen ohne field_mode: mit field_color ⇒ 'color', sonst 'art'. */
export function fieldMode(deck) {
  if (MODES.includes(deck?.field_mode)) return deck.field_mode;
  return deck?.field_color ? 'color' : 'art';
}

/** Farben, die der Modus tatsächlich zeigt ('color' ⇒ eigene Farbe, sonst Commander-Farben). */
export function modeColors(deck) {
  return fieldMode(deck) === 'color' ? fieldColors(deck) : commanderColors(deck);
}

/** Tönung (HANDOFF 5.4a fieldBg): eine Farbe per color-mix, mehrere als harte 135°-Streifen. */
export function fieldBg(cols, pct) {
  const mix = (c) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  if (cols.length === 1) return mix(cols[0]);
  const n = cols.length;
  return 'linear-gradient(135deg,' + cols.map((c, i) => `${mix(c)} ${(i / n * 100).toFixed(1)}% ${((i + 1) / n * 100).toFixed(1)}%`).join(',') + ')';
}

/** Dunklere Variante einer #RRGGBB-Farbe (78 % Farbe, Rest Schwarz). */
export function frameColor(col) {
  if (!HEX.test(col || '')) return col;
  const ch = [1, 3, 5].map((i) => Math.round(parseInt(col.slice(i, i + 2), 16) * 0.78));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * CSS-Variablen für ein Feld. cols aus fieldColors/modeColors, look = data-theme, mode = Feldmodus.
 * --field-accent erste Farbe · --field-frame dunklere Variante · --field-bg Tönung oder 'none' (art).
 */
export function fieldStyle(cols, look = 'nacht', mode = 'commander') {
  const list = cols && cols.length ? cols : [COLORLESS];
  return {
    '--field-accent': list[0],
    '--field-frame': frameColor(list[0]),
    '--field-bg': mode === 'art' ? 'none' : fieldBg(list, TINT[look] ?? TINT.nacht),
  };
}

/** Objekt aus fieldStyle als style-Attribut-Text. */
export const styleText = (vars) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

/** Farbkreis (Setup): eine Farbe voll, mehrere als Tortenstücke (Mockup P2). */
export function swatchBg(cols) {
  if (cols.length === 1) return cols[0];
  const n = cols.length;
  return 'conic-gradient(' + cols.map((c, j) => `${c} ${(j / n * 360).toFixed(1)}deg ${((j + 1) / n * 360).toFixed(1)}deg`).join(',') + ')';
}
