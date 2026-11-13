// Kartenbilder fürs Spielstart-Intro (Spec P8 Intro 2.0, Welle ttg-features, Entscheide 11 und 13).
// DOM-arm und in Node testbar (tests/unit/card-images.test.mjs): reine Ableitung der Scryfall-Adresse der ganzen
// Karte (`normal`, 488 × 680) und ein modulweiter Vorlade-Speicher (Setup und Intro teilen ihn, ES-Modul einmal geladen).
//
// Quelle je Kartenplatz (Commander, Partner), in dieser Reihenfolge:
//   1. aus decks.image_url / partner_image_url (Scryfall art_crop der gewählten Druckversion) abgeleitet: /art_crop/ ⇒ /normal/
//   2. deck_cards.image_normal der Commander-Zeile mit passendem Namen (Vorderseite, ohne Groß/Klein), nur cards.scryfall.io
//   3. aus decks.scryfall_ids[i] konstruiert
// Kein Scryfall-API-Aufruf (api.scryfall.com wird nie angefragt); fehlt einem Platz jede Quelle ⇒ null (Rückfall im Intro).

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ART_RE = new RegExp(`^https://cards\\.scryfall\\.io/art_crop/(front|back)/([0-9a-f])/([0-9a-f])/(${UUID})\\.jpg(\\?\\d+)?$`);
const ID_RE = new RegExp(`^${UUID}$`);
const CDN = 'https://cards.scryfall.io/';
const MAX = 24; // höchstens so viele Adressen im Vorlade-Speicher, älteste fällt heraus

/** art_crop-Adresse ⇒ dieselbe Adresse mit /normal/ (Abfrageteil unverändert); alles andere ⇒ null. */
export function normalFromArt(url) {
  if (typeof url !== 'string') return null;
  const m = ART_RE.exec(url);
  if (!m) return null;
  const [, side, a, b, id, q = ''] = m;
  if (id[0] !== a || id[1] !== b) return null;
  return `${CDN}normal/${side}/${a}/${b}/${id}.jpg${q}`;
}

/** Scryfall-ID (UUID in Kleinbuchstaben) ⇒ normal-Adresse der Vorderseite ohne Abfrageteil; sonst null. */
export function normalFromId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return `${CDN}normal/front/${id[0]}/${id[1]}/${id}.jpg`;
}

/** Name der Vorderseite (Teil vor „ // “), getrimmt, klein. */
const front = (name) => (typeof name === 'string' ? name.split(' // ')[0].trim().toLowerCase() : '');

/** Quelle 2: image_normal der Commander-Zeile mit passendem Namen (nur Bild-CDN). */
export function commanderNormal(name, cardRows) {
  const want = front(name);
  if (!want || !Array.isArray(cardRows)) return null;
  for (const r of cardRows) {
    if (r?.section !== 'commander' || front(r.name) !== want) continue;
    if (typeof r.image_normal === 'string' && r.image_normal.startsWith(CDN)) return r.image_normal;
  }
  return null;
}

/**
 * Adressen der ganzen Karte(n) eines Decks: [Commander] oder [Commander, Partner]; null ⇒ Rückfall.
 * Partner gilt als vorhanden, wenn partner_name ODER partner_image_url gesetzt ist; dann braucht jeder Platz eine Quelle.
 * @param {any} deck   Deckzeile (g.decks bzw. Setup), Felder image_url, partner_image_url, commander_name, partner_name
 * @param {any} row    frische decks-Zeile (select('*')) mit scryfall_ids, oder null
 * @param {any[] | null} cardRows  deck_cards-Zeilen, oder null
 * @returns {string[] | null}
 */
export function cardImages(deck, row, cardRows) {
  if (!deck) return null;
  const ids = Array.isArray(row?.scryfall_ids) ? row.scryfall_ids : Array.isArray(deck.scryfall_ids) ? deck.scryfall_ids : [];
  const slots = [[deck.image_url, deck.commander_name]];
  if (deck.partner_name || deck.partner_image_url) slots.push([deck.partner_image_url, deck.partner_name]);
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    const [art, name] = slots[i];
    const u = normalFromArt(art) || commanderNormal(name, cardRows) || normalFromId(ids[i]);
    if (!u) return null;
    out.push(u);
  }
  return out;
}

// ---------------------------------------------------------------- Vorlade-Speicher (modulweit)
/** @type {Map<string, { state: 'loading' | 'ok' | 'err', img: any, done: Promise<boolean> }>} */
const store = new Map();

function load(url) {
  const Img = globalThis.Image;
  if (typeof Img !== 'function') return null;
  const img = new Img();
  try { img.decoding = 'async'; } catch { /* Attrappe */ }
  const e = { state: /** @type {'loading' | 'ok' | 'err'} */ ('loading'), img, done: Promise.resolve(false) };
  const settle = (ok) => { if (e.state === 'loading') e.state = ok ? 'ok' : 'err'; return e.state === 'ok'; };
  const loaded = () => !!img.complete && Number(img.naturalWidth) > 0;
  e.done = new Promise((resolve) => {
    img.src = url;
    if (typeof img.decode === 'function') {
      // decode() kann trotz geladenem Bild verworfen werden (Browser-Eigenheit) ⇒ dann zählt complete + naturalWidth
      img.decode().then(() => resolve(settle(true)), () => resolve(settle(loaded())));
    } else {
      img.onload = () => resolve(settle(true));
      img.onerror = () => resolve(settle(false));
    }
  });
  return e;
}

/** Adressen vorladen und dekodieren (je Adresse ein Image, doppelte nur einmal). Ohne Image (Node) still nichts. */
export function preloadCardImages(urls) {
  if (!Array.isArray(urls)) return;
  for (const u of urls) {
    if (typeof u !== 'string' || !u) continue;
    const had = store.get(u);
    if (had) { store.delete(u); store.set(u, had); continue; } // zuletzt gebraucht ⇒ hinten
    const e = load(u);
    if (!e) return;
    store.set(u, e);
    while (store.size > MAX) store.delete(store.keys().next().value);
  }
}

/** Stand einer Adresse: 'loading' | 'ok' | 'err' | null (unbekannt). */
export function imageState(url) {
  return store.get(url)?.state ?? null;
}

/**
 * true, sobald alle Adressen 'ok' sind; false, sobald eine 'err' ist oder nach `ms` (Frist) bzw. ohne Image.
 * Unbekannte Adressen werden dabei vorgeladen.
 * @returns {Promise<boolean>}
 */
export function whenReady(urls, ms) {
  const list = Array.isArray(urls) ? urls.filter((u) => typeof u === 'string' && u) : [];
  if (!list.length) return Promise.resolve(true);
  preloadCardImages(list);
  const entries = list.map((u) => store.get(u));
  if (entries.some((e) => !e)) return Promise.resolve(false);
  return new Promise((resolve) => {
    let left = entries.length;
    let over = false;
    const end = (v) => { if (!over) { over = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => end(false), Math.max(0, Number(ms) || 0));
    for (const e of entries) e.done.then((ok) => { if (!ok) end(false); else if (--left === 0) end(true); });
  });
}
