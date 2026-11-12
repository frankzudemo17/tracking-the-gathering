// Deckliste: Einträge (aus parseManaBox) per Scryfall auflösen, speichern, laden, Kennzahlen.
// Rein bis auf die übergebenen Abhängigkeiten: `fetch`, `wait` und der Supabase-Client `sb`
// werden hereingereicht (keine Importe von src/supabase.js) ⇒ Node-testbar.
// Scryfall: https://scryfall.com/docs/api/cards/collection — höchstens 75 Kennungen je Anfrage,
// Scryfall bittet um ≤ ~10 Anfragen/s ⇒ mindestens 100 ms Abstand (wie src/lib/scryfall.js).

const COLLECTION = 'https://api.scryfall.com/cards/collection';
export const BATCH = 75;
const GAP_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const low = (s) => String(s ?? '').toLowerCase();

/** Spalten von deck_cards, die der Client schreibt (ohne id/deck_id). */
export const CARD_COLS = ['section', 'qty', 'name', 'scryfall_id', 'oracle_id', 'set_code', 'collector_number', 'type_line',
  'mana_value', 'colors', 'color_identity', 'image_small', 'image_normal', 'game_changer'];

/**
 * @typedef {{ qty: number, name: string, set?: string, number?: string }} Entry
 * @typedef {Entry & { section: 'commander' | 'main' }} SectionEntry
 * @typedef {{ section: 'commander' | 'main', qty: number, name: string, scryfall_id: string, oracle_id: string | null,
 *   set_code: string | null, collector_number: string | null, type_line: string | null, mana_value: number | null,
 *   colors: string[], color_identity: string[], image_small: string | null, image_normal: string | null,
 *   game_changer: boolean }} Row
 */

/**
 * Eingabe vereinheitlichen: Ergebnis von parseManaBox ({ commanders, main }) oder eine Liste von
 * Einträgen mit optionalem `section` (fehlt ⇒ 'main').
 * @returns {SectionEntry[]}
 */
function flatten(input) {
  const tag = (list, section) => (list || []).map((e) => ({ ...e, section }));
  if (Array.isArray(input)) return input.map((e) => ({ ...e, section: e?.section === 'commander' ? 'commander' : 'main' }));
  if (input && typeof input === 'object') return [...tag(input.commanders, 'commander'), ...tag(input.main, 'main')];
  return [];
}

/** Scryfall-Kennung: Set + Sammlernummer, wenn beides da ist, sonst der Name. */
const identOf = (e) => (e.set && e.number ? { set: low(e.set), collector_number: String(e.number) } : { name: e.name });
const keyOf = (idf) => (idf.name != null ? `n:${low(idf.name)}` : `s:${low(idf.set)}|${low(idf.collector_number)}`);

/**
 * Antwort einer Anfrage den Kennungen zuordnen — nach Schlüssel (Set+Nummer bzw. Name oder Seitenname),
 * nicht nach Reihenfolge. Rückfall nach Position nur, wenn Treffer + not_found genau aufgehen
 * (z. B. Name mit anderer Schreibweise, den Scryfall dennoch erkannt hat).
 */
function matcher(idents, json) {
  const data = json.data;
  const nf = new Set((json.not_found || []).map(keyOf));
  const byKey = new Map();
  for (const c of data) {
    byKey.set(`s:${low(c.set)}|${low(c.collector_number)}`, c);
    for (const nm of [c.name, ...(c.card_faces || []).map((f) => f.name)]) {
      if (nm && !byKey.has(`n:${low(nm)}`)) byKey.set(`n:${low(nm)}`, c);
    }
  }
  const found = idents.filter((i) => !nf.has(keyOf(i)));
  const positional = found.length === data.length;
  // Karten, die schon per Schlüssel einer Kennung gehören, nie per Position einer anderen geben
  // (sonst ordnet eine umsortierte Antwort still die falsche Karte zu).
  const claimed = new Set(found.map((i) => byKey.get(keyOf(i))).filter(Boolean));
  return (k) => {
    const idf = idents[k];
    if (nf.has(keyOf(idf))) return null;
    const hit = byKey.get(keyOf(idf));
    if (hit) return hit;
    const c = positional ? data[found.indexOf(idf)] : null;
    return c && !claimed.has(c) ? c : null;
  };
}

/** Scryfall-Karte ⇒ Zeile der Tabelle deck_cards. Bild/Farben bei Doppelkarten von der Vorderseite. */
function toRow(c, e) {
  const front = c.card_faces?.[0] || {};
  const img = c.image_uris || front.image_uris || {};
  const typeLine = c.type_line || (c.card_faces || []).map((f) => f.type_line).filter(Boolean).join(' // ') || null;
  const cmc = typeof c.cmc === 'number' ? c.cmc : typeof front.cmc === 'number' ? front.cmc : null;
  return {
    section: e.section,
    qty: e.qty,
    name: c.name,
    scryfall_id: c.id,
    oracle_id: c.oracle_id ?? front.oracle_id ?? null,
    set_code: c.set ?? null,
    collector_number: c.collector_number ?? null,
    type_line: typeLine,
    mana_value: cmc,
    colors: c.colors ?? front.colors ?? [],
    color_identity: c.color_identity ?? [],
    image_small: img.small ?? null,
    image_normal: img.normal ?? null,
    game_changer: c.game_changer === true,
  };
}

/**
 * Einträge per Scryfall /cards/collection auflösen.
 * - je Anfrage höchstens 75 Kennungen, zwischen zwei Anfragen `wait(100)`;
 * - Einträge mit Set+Nummer, die Scryfall nicht findet, gehen in einen zweiten Durchgang mit { name };
 * - danach werden Zeilen mit gleichem (section, scryfall_id) zusammengelegt (Anzahl addiert);
 * - HTTP-Fehler (429, 5xx, …) ⇒ Error mit `status`, kein Teilergebnis.
 * @param {{ commanders?: Entry[], main?: Entry[] } | (Entry & { section?: string })[]} input
 * @param {{ fetch?: typeof fetch, wait?: (ms: number) => Promise<unknown>,
 *   onProgress?: (done: number, total: number) => void }} [deps]
 *   onProgress (optional, für die Fortschrittsanzeige): nach jeder Anfrage des ersten Durchgangs.
 * @returns {Promise<{ cards: Row[], notFound: SectionEntry[] }>}
 */
export async function resolveCards(input, { fetch: doFetch = globalThis.fetch, wait = sleep, onProgress } = {}) {
  const entries = flatten(input);
  const hits = new Array(entries.length).fill(null);
  let requests = 0;

  async function post(identifiers) {
    if (requests++ > 0) await wait(GAP_MS);
    const res = await doFetch(COLLECTION, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !Array.isArray(json.data)) {
      const err = new Error(json?.details || `Scryfall ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async function pass(indexes, mkIdent, progress) {
    for (let s = 0; s < indexes.length; s += BATCH) {
      const part = indexes.slice(s, s + BATCH);
      const idents = part.map((i) => mkIdent(entries[i]));
      const match = matcher(idents, await post(idents));
      part.forEach((ei, k) => { hits[ei] = match(k) || hits[ei]; });
      progress?.(Math.min(s + BATCH, indexes.length));
    }
  }

  await pass(entries.map((_, i) => i), identOf, onProgress && ((done) => onProgress(done, entries.length)));
  const retry = entries.map((e, i) => i).filter((i) => !hits[i] && entries[i].set && entries[i].number);
  await pass(retry, (e) => ({ name: e.name }));

  /** @type {Row[]} */
  const cards = [];
  const notFound = [];
  const byKey = new Map();
  entries.forEach((e, i) => {
    const c = hits[i];
    if (!c) { notFound.push(e); return; }
    const key = `${e.section}|${c.id}`;
    const prev = byKey.get(key);
    if (prev) { prev.qty += e.qty; return; }
    const row = toRow(c, e);
    byKey.set(key, row);
    cards.push(row);
  });
  return { cards, notFound };
}

const asError = (error) => (error instanceof Error ? error : Object.assign(new Error(error?.message || String(error)), error));

/**
 * Deckliste ersetzen (RPC replace_deck_cards: prüft Rechte und Inhalt, löscht und schreibt in einer
 * Transaktion, setzt cards_updated_at und bracket_check = null). Es gehen nur die Tabellenspalten mit.
 * @returns {Promise<number>} Anzahl geschriebener Zeilen
 */
export async function saveDeckCards(sb, deckId, rows) {
  const p_cards = (rows || []).map((r) => Object.fromEntries(CARD_COLS.filter((k) => k in r).map((k) => [k, r[k]])));
  const { data, error } = await sb.rpc('replace_deck_cards', { p_deck: deckId, p_cards });
  if (error) throw asError(error);
  return data;
}

/** Deckliste laden (RLS: nur sichtbar, wenn das Deck sichtbar ist). Leer ⇒ []. */
export async function loadDeckCards(sb, deckId) {
  const { data, error } = await sb.from('deck_cards').select('*').eq('deck_id', deckId).order('section').order('id');
  if (error) throw asError(error);
  return data || [];
}

const TYPES = ['creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment'];

/**
 * Haupttyp einer Karte nach der Vorderseite (Teil vor „ // “, ohne Untertypen):
 * enthält „Land“ ⇒ 'land', sonst erster Treffer aus creature, planeswalker, battle, instant, sorcery,
 * artifact, enchantment, sonst 'other'.
 */
export function cardType(typeLine) {
  const words = low(String(typeLine ?? '').split(' // ')[0].split(' — ')[0]).split(/\s+/);
  if (words.includes('land')) return 'land';
  return TYPES.find((t) => words.includes(t)) || 'other';
}

/**
 * Kennzahlen einer Deckliste. Gezählt wird nur section = 'main', gewichtet mit qty.
 * - byType: Haupttyp je Karte (cardType), nur vorkommende Typen;
 * - curve: Nicht-Länder nach Manawert, Schlüssel '0'…'6' und '7+', nur vorkommende Werte;
 * - colors: Nicht-Länder je Farbe W/U/B/R/G aus `colors` (mehrfarbig zählt je Farbe), farblos ⇒ 'C';
 * - commanders: Anzahl Commander-Karten; lands: Anzahl Länder; total: Karten im Hauptdeck.
 * @param {Pick<Row, 'section' | 'qty' | 'type_line' | 'mana_value' | 'colors'>[]} rows
 */
export function deckSummary(rows) {
  const out = { total: 0, commanders: 0, byType: {}, curve: {}, colors: {}, lands: 0 };
  const add = (obj, k, n) => { obj[k] = (obj[k] || 0) + n; };
  for (const r of rows || []) {
    const n = Number(r.qty) || 0;
    if (r.section === 'commander') { out.commanders += n; continue; }
    if (r.section !== 'main') continue;
    out.total += n;
    const type = cardType(r.type_line);
    add(out.byType, type, n);
    if (type === 'land') { out.lands += n; continue; }
    const mv = Math.max(0, Number(r.mana_value) || 0);
    add(out.curve, mv >= 7 ? '7+' : String(Math.floor(mv)), n);
    const cols = (r.colors || []).filter((c) => ['W', 'U', 'B', 'R', 'G'].includes(c));
    if (cols.length) for (const c of cols) add(out.colors, c, n);
    else add(out.colors, 'C', n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spec P3 (Welle ttg-features, Entscheid 9): Fakten für die automatische Zeile im Spielstart-Intro.

const WUBRG = ['W', 'U', 'B', 'R', 'G'];
const TRIBE_MIN = 8; // häufigster Untertyp zählt ab 8 Karten …
const TRIBE_SHARE = 0.5; // … und mindestens der Hälfte aller Kreaturen
const CURVE_LOW = 2.8; // Ø Manawert ≤ 2,8 ⇒ niedrig
const CURVE_HIGH = 3.6; // Ø Manawert ≥ 3,6 ⇒ hoch

/** Untertypen der Vorderseite (Wörter nach „ — “ im Teil vor „ // “), je Karte einmal. */
function frontSubtypes(typeLine) {
  const front = String(typeLine ?? '').split(' // ')[0];
  const i = front.indexOf(' — ');
  return i < 0 ? [] : [...new Set(front.slice(i + 3).split(/\s+/).filter(Boolean))];
}

/**
 * Fakten eines Decks aus seiner Kartenliste (rein, ohne Zufall).
 * Grundlage nur section = 'main', gewichtet mit qty; Nicht-Länder nach cardType (Vorderseite).
 * Ohne Nicht-Länder (leere Liste, nur Commander, nur Länder) ⇒ null (keine Zeile).
 * - colors: deck.color_identity, nur W U B R G in dieser Reihenfolge, ohne Dubletten;
 * - infinite: Kombos aus deck.bracket_check.combos mit einem produces-Eintrag /\binfinite\b/i; ohne Prüfung ⇒ null;
 * - gameChangers: Summe qty aller Zeilen (alle Abschnitte) mit game_changer;
 * - tribe: häufigster Untertyp der Kreaturen (≥ 8, ≥ 50 % der Kreaturen, echt größer als der zweite) oder null;
 * - creatureShare: Kreaturen / Nicht-Länder; avgMv und curve 'low' | 'mid' | 'high'.
 * @param {Pick<Row, 'section' | 'qty' | 'type_line' | 'mana_value' | 'game_changer'>[] | null | undefined} rows
 * @param {{ color_identity?: string[] | null, bracket_check?: any } | null | undefined} deck
 */
export function deckTraits(rows, deck) {
  let nonlands = 0;
  let creatures = 0;
  let mvSum = 0;
  let gameChangers = 0;
  /** @type {Map<string, number>} */
  const subs = new Map();
  for (const r of rows || []) {
    const n = Number(r.qty) || 0;
    if (r.game_changer === true) gameChangers += n;
    if (r.section !== 'main') continue;
    const type = cardType(r.type_line);
    if (type === 'land') continue;
    nonlands += n;
    mvSum += Math.max(0, Number(r.mana_value) || 0) * n;
    if (type !== 'creature') continue;
    creatures += n;
    for (const s of frontSubtypes(r.type_line)) subs.set(s, (subs.get(s) || 0) + n);
  }
  if (nonlands <= 0) return null;

  const ranked = [...subs].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const tribe = top && top[1] >= TRIBE_MIN && top[1] >= TRIBE_SHARE * creatures && top[1] > (second ? second[1] : 0) ? top[0] : null;

  const avgMv = Number((mvSum / nonlands).toFixed(9));
  const curve = avgMv <= CURVE_LOW ? 'low' : avgMv >= CURVE_HIGH ? 'high' : 'mid';

  const ci = Array.isArray(deck?.color_identity) ? deck.color_identity : [];
  const colors = WUBRG.filter((c) => ci.includes(c));

  const bc = deck?.bracket_check;
  const combos = bc && typeof bc === 'object' && !Array.isArray(bc) && Array.isArray(bc.combos) ? bc.combos : null;
  const infinite = combos
    ? combos.filter((c) => Array.isArray(c?.produces) && c.produces.some((p) => /\binfinite\b/i.test(String(p)))).length
    : null;

  return { colors, infinite, gameChangers, tribe, creatureShare: creatures / nonlands, avgMv, curve, nonlands, creatures };
}
