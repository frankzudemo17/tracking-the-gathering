// Reine Hilfen der Rangliste (#/rangliste) · Besitzer: P17. Keine Importe, Node-testbar.
// Keine Kennzahlen-Logik hier: Zahlen kommen aus src/lib/stats.js, Anzeige über src/lib/format.js.

export const MODES = /** @type {const} */ (['players', 'decks', 'salt']);
export const RANGES = /** @type {const} */ (['all', '30d', 'year']);
export const PREF_KEY = 'ttg.board';
export const SALT_MAX = 5;

/** @typedef {{ mode: 'players'|'decks'|'salt', range: 'all'|'30d'|'year' }} BoardPrefs */

/**
 * Gemerkte Wahl lesen (sessionStorage; fehlt/kaputt ⇒ Spieler · Gesamt).
 * @param {{ getItem: (k: string) => string|null }|null} store
 * @returns {BoardPrefs}
 */
export function readPrefs(store) {
  /** @type {any} */
  let raw = null;
  try { raw = JSON.parse(store?.getItem(PREF_KEY) || 'null'); } catch { raw = null; }
  const mode = MODES.includes(raw?.mode) ? raw.mode : 'players';
  const range = RANGES.includes(raw?.range) ? raw.range : 'all';
  return { mode, range };
}

/**
 * @param {{ setItem: (k: string, v: string) => void }|null} store
 * @param {BoardPrefs} prefs
 */
export function writePrefs(store, prefs) {
  try { store?.setItem(PREF_KEY, JSON.stringify({ mode: prefs.mode, range: prefs.range })); } catch { /* egal */ }
}

/**
 * Bezugszeitpunkt für den Zeitraum. Testhaken window.__ttgNow wirkt NUR auf localhost
 * (wie __ttgRand in src/lib/rand.js), sonst immer die echte Uhr.
 * @param {string|undefined} hostname
 * @param {unknown} hook
 * @param {() => Date} [clock]
 * @returns {Date}
 */
export function pickNow(hostname, hook, clock = () => new Date()) {
  if (hostname === 'localhost' && hook) {
    const d = new Date(/** @type {any} */ (hook));
    if (Number.isFinite(d.getTime())) return d;
  }
  return clock();
}

/**
 * Podest = die ersten drei Einträge (Wettkampf-Rang bleibt, auch 1 · 1 · 3), Liste = der Rest.
 * @template T
 * @param {T[]} rows
 * @returns {{ podium: T[], rest: T[] }}
 */
export function splitPodium(rows) {
  const list = rows || [];
  return { podium: list.slice(0, 3), rest: list.slice(3) };
}

/** Podest-Stufe für die Höhe: Rang 1 hoch, 2 mittel, alles darüber niedrig. @param {number} rank */
export const stepOf = (rank) => (rank === 1 ? 1 : rank === 2 ? 2 : 3);

/**
 * Füllgrad je Salz-Icon (0…1) für einen Ø-Wert 0…5 — ohne Rundung, die Anzeige der Zahl macht fmtAvg.
 * @param {number|null|undefined} avg
 * @returns {number[]}
 */
export function saltFill(avg) {
  const v = typeof avg === 'number' && Number.isFinite(avg) ? avg : 0;
  const out = [];
  for (let i = 0; i < SALT_MAX; i++) out.push(v >= i + 1 ? 1 : v <= i ? 0 : v - i);
  return out;
}

/**
 * Besitzer eines Decks: Konto-Deck über ownerProfileId ⇒ Mitglied mit dieser profileId, sonst ownerMemberId.
 * @param {{ ownerProfileId?: string|null, ownerMemberId?: string|null }|null|undefined} deck
 * @param {{ id: string, profileId: string|null }[]} members
 * @returns {string|null} memberId
 */
export function deckOwnerId(deck, members) {
  if (!deck) return null;
  if (deck.ownerProfileId) {
    const m = (members || []).find((x) => x.profileId === deck.ownerProfileId);
    if (m) return m.id;
  }
  return deck.ownerMemberId || null;
}

/**
 * Leerzustand: 'none' (gar keine gewerteten Spiele) · 'range' (Zeitraum leer) · 'salt' (Spiele da, aber
 * kein Deck mit ≥ 2 Salz-Bewertungen) · null (es gibt Zeilen).
 * @param {{ allGames: number, rangeGames: number, rows: number }} n
 * @returns {'none'|'range'|'salt'|null}
 */
export function emptyKind({ allGames, rangeGames, rows }) {
  if (!allGames) return 'none';
  if (!rangeGames) return 'range';
  if (!rows) return 'salt';
  return null;
}

/** Hintergrund für ein Commander-Bild (ungetönt). @param {string|null|undefined} url */
export function artStyle(url) {
  return url ? `--art:url('${String(url).replace(/'/g, '%27')}')` : '';
}
