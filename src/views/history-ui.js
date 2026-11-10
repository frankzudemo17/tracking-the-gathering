// Reine Hilfen für Historie + Spieldetail (P16). Keine DOM-, keine Netz-Importe ⇒ in Node testbar
// (tests/unit/history-ui.test.mjs). Rechnen bleibt in src/lib/stats.js — hier nur Ordnen, Nachschlagen, Formatieren.
import { evenings } from '../lib/stats.js';

/** @typedef {import('../lib/history-data.js').GroupData} GroupData */
/** @typedef {import('../lib/history-data.js').DeckRow} DeckRow */
/** @typedef {import('../lib/history-data.js').DamageRow} DamageRow */
/** @typedef {import('../lib/stats.js').Evening} Evening */

/** Filter-Schlüssel wie `evenings()` in stats.js (Reihenfolge = Chips). */
export const FILTERS = /** @type {const} */ (['alle', 'siege', 'salt', 'foto']);
export const FILTER_KEY = 'ttg.histFilter';
/** Kunst-Abend für Spiele ohne Abend (`sessionId = null`), nur innerhalb der Historie. */
export const NO_SESSION = '__ohne-abend';
/** Siegbedingungen (DB-Enum `win_condition`, init.sql:15) ⇒ i18n-Schlüssel `history.wincon.<w>`. */
export const WINCONS = ['kampfschaden', 'commander', 'kombo', 'gift', 'alternativ', 'aufgabe'];

/** @param {unknown} f @returns {string} gültiger Filter, sonst 'alle' */
export const validFilter = (f) => (typeof f === 'string' && /** @type {readonly string[]} */ (FILTERS).includes(f) ? f : 'alle');

/** Filter aus sessionStorage (privat/gesperrt ⇒ 'alle'). @param {{ getItem(k: string): string|null }|null|undefined} store */
export function readFilter(store) {
  try { return validFilter(store?.getItem(FILTER_KEY)); } catch { return 'alle'; }
}

/** @param {{ setItem(k: string, v: string): void }|null|undefined} store @param {string} f */
export function writeFilter(store, f) {
  try { store?.setItem(FILTER_KEY, validFilter(f)); } catch { /* egal: nur Bequemlichkeit */ }
}

/**
 * Abende für die Historie: `evenings()` aus stats.js, plus die Spiele ohne Abend als eigene Gruppe am Ende
 * (stats.js lässt sie aus). Filter und Reihenfolge rechnet weiter stats.js — die Spiele ohne Abend bekommen
 * dafür nur einen Kunst-Abend; dessen Tageskönig wird nicht gezeigt (kein echter Abend).
 * @param {GroupData} data
 * @param {{ filter?: string, meMemberId?: string|null }} [opts]
 * @returns {Evening[]}
 */
export function historyEvenings(data, opts = {}) {
  const games = data?.games || [];
  const loose = games.some((g) => g.sessionId == null);
  const input = loose ? { ...data, games: games.map((g) => (g.sessionId == null ? { ...g, sessionId: NO_SESSION } : g)) } : data;
  const list = evenings(input, opts);
  const real = list.filter((e) => e.sessionId !== NO_SESSION);
  const rest = list.filter((e) => e.sessionId === NO_SESSION).map((e) => ({ ...e, location: null, dayWinnerId: null }));
  return [...real, ...rest];
}

/** Nachschlagen per id (Map), fehlende ⇒ undefined. @template {{ id: string }} T @param {T[]|undefined} rows */
export const byId = (rows) => new Map((rows || []).map((r) => [r.id, r]));

/**
 * Bildfläche eines Decks als CSS-Variablen: `--art` = Commander-Bild (ungetönt), darunter `--art-fb` = Farbfläche
 * aus den Mana-Token der Commander-Farben (scheint durch, wenn das Bild fehlt oder nicht lädt — nie leer).
 * Ohne Bild ist die Farbfläche selbst `--art`.
 * @param {DeckRow|null|undefined} deck
 */
export function deckArt(deck) {
  const cols = ['W', 'U', 'B', 'R', 'G'].filter((c) => (deck?.colors || []).includes(c));
  const stops = cols.length ? cols.map((c) => `var(--mana-${c})`) : ['var(--p-c)'];
  // Ein Ton läuft in die Fläche aus (sonst Vollton), mehrere Töne als Verlauf in WUBRG-Reihenfolge
  if (stops.length === 1) stops.push(`color-mix(in srgb, ${stops[0]} 40%, var(--sf2))`);
  const fb = `linear-gradient(135deg, ${stops.join(', ')})`;
  const url = deck?.imageUrl;
  return url ? `--art:url('${String(url).replace(/'/g, '%27')}');--art-fb:${fb}` : `--art:${fb}`;
}

/** Deck in die Form, die `playerColor()` (src/lib/decks.js) erwartet. @param {DeckRow|null|undefined} deck */
export const colorDeck = (deck) => ({ color_identity: deck?.colors || [] });

/**
 * Schadensmatrix: Zeilen = Quelle, Spalten = Ziel, in der Reihenfolge `ids` (Platzierung). Nur Nachschlagen.
 * @param {string[]} ids
 * @param {DamageRow[]|null|undefined} rows
 * @returns {{ ids: string[], cell: (source: string, target: string) => DamageRow|null, empty: boolean }}
 */
export function damageGrid(ids, rows) {
  const list = (rows || []).filter((r) => r && (r.damage || r.commanderDamage || r.poison));
  const map = new Map(list.map((r) => [`${r.source}>${r.target}`, r]));
  return { ids, cell: (s, t) => map.get(`${s}>${t}`) || null, empty: list.length === 0 };
}

/** @param {string|null|undefined} lang */
const locale = (lang) => (lang === 'en' ? 'en-GB' : 'de-DE');

/** Abenddatum lang, z. B. „Freitag, 6. November 2026“ (`playedOn` ist ein reines Datum ⇒ UTC). */
export function fmtDayLong(day, lang = 'de') {
  if (!day) return '–';
  const d = new Date(`${String(day).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString(locale(lang), { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Spielbeginn als Datum + Uhrzeit, z. B. „6. November 2026, 19:30“ (Ortszeit des Geräts). */
export function fmtDateTime(iso, lang = 'de') {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '–';
  const day = d.toLocaleDateString(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

/** Ganze Zahl für die Anzeige, fehlt ⇒ „–“. @param {unknown} n */
export const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '–');
