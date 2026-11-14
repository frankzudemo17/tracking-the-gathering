// Abzeichen-Fakten (P4, spec-p4-abzeichen.md Entscheide 23–25, Nachtrag 2/3): Replay-Ergebnisse beendeter Spiele
// gerätelokal je Konto + Gruppe, damit ein zweiter Besuch nichts mehr lädt. Abgelegt im device-store
// (Objektspeicher `fakten`, Schlüssel `konto|gruppe|bf.<FACTS_VERSION>.<spiel>` über cacheKey), nicht in localStorage.
// Leeren bei Abmelden/Kontowechsel: clearCaches() ⇒ deviceStore.clearAll() (alle Konten, alle Versionen) und
// clearBadgeFacts() (Arbeitsspeicher-Kopie, Epoche + 1). Riegel: eine Ladung, die vor dem Leeren oder vor einem
// Kontowechsel begann, schreibt danach nichts mehr (Epoche hier, Generation + Konto im device-store).
// Keine DOM-Importe; der Speicher kommt als Parameter (Vorgabe: die App-Instanz `deviceStore`).
import { gameFacts, FACTS_VERSION } from './badges.js';
import { cacheKey } from './cache.js';
import { deviceStore } from './device-store.js';

/** @typedef {import('./badges.js').GameFacts} GameFacts */
/** @typedef {import('./history-data.js').GroupData} GroupData */
/** @typedef {import('./history-data.js').EventRow} EventRow */
/** @typedef {{ generation: () => number, putFacts: (key: string, value: any, riegel: { gen: any }) => void, factsOf: (account: string, group: string) => Promise<Array<{ key: string, name: string, value: any }>>, dropFacts: (keys: string[]) => void }} FactsStore */

/** Nachtrag 1/2: dauerhaft auf dem Gerät (false ⇒ nur Arbeitsspeicher der Sitzung). */
export const PERSIST = true;
/** Spiele je Abfrage von game_events. */
export const FACTS_BATCH = 10;
/** Höchstens so viele Spiele je Ansicht-Besuch (Rest beim nächsten Besuch). */
export const FACTS_LIMIT = 200;

const NAME = `bf.${FACTS_VERSION}.`;
const NAME_RE = /^bf\.(\d+)\.(.+)$/;

let epoch = 0;
/** @type {string|null|undefined} Konto, dem die Arbeitsspeicher-Kopie gehört */
let owner;
/** @type {Map<string, GameFacts>} */
const memory = new Map();
/** @type {Map<string, Promise<GameFacts|null>>} gemeinsame Ladungen je Spiel */
const inflight = new Map();

/**
 * @param {string|null|undefined} account @param {string|null|undefined} group @param {string|null|undefined} gameId
 * @returns {string|null} `konto|gruppe|bf.<v>.<spiel>`; ohne Konto, Gruppe oder Spiel ⇒ null
 */
export function factsKey(account, group, gameId) {
  if (!gameId) return null;
  return cacheKey(account || '', group || '', `${NAME}${gameId}`);
}
const memKey = (/** @type {any} */ a, /** @type {any} */ g, /** @type {string} */ id) => `${a ?? ''}|${g ?? ''}|${id}`;

/** Gültige Fakten dieser Logik-Version? @param {any} f @returns {f is GameFacts} */
function valid(f) {
  if (!f || typeof f !== 'object' || f.v !== FACTS_VERSION) return false;
  if (f.ok === false) return f.reason === 'none' || f.reason === 'error';
  const obj = (/** @type {any} */ x) => !!x && typeof x === 'object' && !Array.isArray(x);
  return f.ok === true && obj(f.min) && obj(f.gained) && Array.isArray(f.kos) && (f.startWinner === null || typeof f.startWinner === 'string');
}

/** Konto der Kopie wechselt ⇒ wie Leeren (Riegel für Ladungen des alten Kontos). @param {string|null|undefined} account */
function claim(account) {
  const a = account || null;
  if (owner !== undefined && owner !== a) { epoch++; memory.clear(); inflight.clear(); }
  owner = a;
}

/** Abmelden/Kontowechsel (aus state.js clearCaches): Arbeitsspeicher-Kopie weg, Epoche + 1. Den Gerätespeicher leert clearAll. */
export function clearBadgeFacts() {
  epoch++;
  memory.clear();
  inflight.clear();
  owner = undefined;
}

/**
 * Gespeicherte Fakten (Arbeitsspeicher-Kopie, dann Gerätespeicher). Andere Version oder ungültiger Wert ⇒ ignoriert
 * und entfernt. Nie ein Wurf.
 * @param {FactsStore|null|undefined} storage @param {string|null} account @param {string|null} group @param {string[]} gameIds
 * @returns {Promise<Map<string, GameFacts>>}
 */
export async function readFacts(storage, account, group, gameIds) {
  /** @type {Map<string, GameFacts>} */
  const out = new Map();
  const want = new Set(gameIds || []);
  for (const id of want) { const f = memory.get(memKey(account, group, id)); if (f) out.set(id, f); }
  if (!storage || !account || !group) return out;
  const e0 = epoch;
  try {
    const recs = await storage.factsOf(account, group);
    /** @type {string[]} */ const drop = [];
    for (const r of recs) {
      const m = NAME_RE.exec(String(r.name));
      if (!m || Number(m[1]) !== FACTS_VERSION || !valid(r.value)) { drop.push(r.key); continue; }
      const id = m[2];
      if (!want.has(id) || out.has(id)) continue;
      out.set(id, r.value);
      if (epoch === e0) memory.set(memKey(account, group, id), r.value);
    }
    if (drop.length) storage.dropFacts(drop);
  } catch { /* leer weiter */ }
  return out;
}

/**
 * Fakten eines Spiels ablegen (Arbeitsspeicher-Kopie + Gerätespeicher). Still bei Fehler.
 * @param {FactsStore|null|undefined} storage @param {string|null} account @param {string|null} group @param {string} gameId
 * @param {GameFacts} facts @param {{ gen?: any }} [riegel] Generation vom Beginn der Ladung
 */
export function writeFacts(storage, account, group, gameId, facts, riegel = {}) {
  try {
    if (!valid(facts)) return;
    memory.set(memKey(account, group, gameId), facts);
    const key = factsKey(account, group, gameId);
    if (storage && key) storage.putFacts(key, facts, { gen: 'gen' in riegel ? riegel.gen : storage.generation() });
  } catch { /* still */ }
}

/**
 * Einträge dieser Gruppe ohne Spiel in `keepIds` entfernen (jede Version). Nie ein Wurf.
 * @param {FactsStore|null|undefined} storage @param {string|null} account @param {string|null} group @param {Iterable<string>} keepIds
 */
export async function pruneFacts(storage, account, group, keepIds) {
  const keep = new Set(keepIds || []);
  const prefix = `${account ?? ''}|${group ?? ''}|`;
  for (const k of [...memory.keys()]) if (k.startsWith(prefix) && !keep.has(k.slice(prefix.length))) memory.delete(k);
  if (!storage || !account || !group) return;
  try {
    const recs = await storage.factsOf(account, group);
    const drop = recs.filter((r) => { const m = NAME_RE.exec(String(r.name)); return !m || !keep.has(m[2]); }).map((r) => r.key);
    if (drop.length) storage.dropFacts(drop);
  } catch { /* still */ }
}

const ts = (/** @type {any} */ iso) => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };

/**
 * Fakten aller beendeten Spiele der Gruppe sicherstellen: gespeicherte lesen, fehlende laden (neueste zuerst,
 * Pakete à `batch`, höchstens `limit`), rechnen, speichern. Lade-Fehler ⇒ diese Spiele bleiben ohne Fakten.
 * @param {{ data: GroupData, account: string|null, storage?: FactsStore|null, loadEvents?: ((ids: string[]) => Promise<EventRow[]>)|null,
 *   onProgress?: ((facts: Map<string, GameFacts>) => void)|null, onPlan?: ((plan: { have: number, missing: number, total: number, loading: number }, facts: Map<string, GameFacts>) => void)|null, isStale?: (() => boolean)|null, limit?: number, batch?: number, persist?: boolean }} opts
 * @returns {Promise<{ facts: Map<string, GameFacts>, loaded: number, failed: number, rest: number }>}
 */
export async function ensureFacts({ data, account, storage = deviceStore, loadEvents = null, onProgress = null, onPlan = null, isStale = null, limit = FACTS_LIMIT, batch = FACTS_BATCH, persist = PERSIST }) {
  claim(account);
  const e0 = epoch;
  const store = persist ? storage : null;
  const g0 = store ? store.generation() : 0;
  const group = data?.groupId ?? null;
  const games = (data?.games || []).filter((g) => g && g.status === 'finished')
    .slice().sort((a, b) => ts(b.startedAt) - ts(a.startedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const facts = await readFacts(store, account, group, games.map((g) => g.id));
  if (store) await pruneFacts(store, account, group, (data?.games || []).map((g) => g.id));
  const missing = games.filter((g) => !facts.has(g.id));
  const take = missing.slice(0, Math.max(0, limit));
  // Zusatz für die Anzeige: nach dem Lesen, vor dem Laden — wie viele Spiele fehlen und gleich geladen werden
  if (onPlan && epoch === e0) {
    try { onPlan({ have: facts.size, missing: missing.length, total: games.length, loading: typeof loadEvents === 'function' ? take.length : 0 }, facts); } catch { /* Anzeige */ }
  }
  let loaded = 0; let failed = 0;
  const done = () => ({ facts, loaded, failed, rest: missing.length - loaded - failed });
  if (typeof loadEvents !== 'function' || !take.length) return done();
  const live = () => epoch === e0 && !(isStale && isStale());

  /** @param {import('./history-data.js').GameRow[]} part */
  const loadPart = (part) => {
    const own = part.filter((g) => !inflight.has(memKey(account, group, g.id)));
    if (own.length) {
      /** @type {Promise<EventRow[]|null>} */
      const shared = Promise.resolve().then(() => loadEvents(own.map((g) => g.id))).then((rows) => rows || [], () => null);
      for (const g of own) {
        const k = memKey(account, group, g.id);
        const p = shared.then((rows) => {
          if (!rows) return null;
          const players = (data.players || []).filter((r) => r.gameId === g.id).map((r) => ({ memberId: r.memberId, seat: r.seat }));
          const f = gameFacts({ players, startingLife: g.startingLife, events: rows.filter((e) => e.gameId === g.id) });
          if (epoch === e0) writeFacts(store, account, group, g.id, f, { gen: g0 });
          return f;
        }).finally(() => { if (inflight.get(k) === p) inflight.delete(k); });
        inflight.set(k, p);
      }
    }
    return Promise.all(part.map((g) => /** @type {Promise<GameFacts|null>} */ (inflight.get(memKey(account, group, g.id)) || Promise.resolve(memory.get(memKey(account, group, g.id)) || null))
      .then((f) => /** @type {[string, GameFacts|null]} */ ([g.id, f]))));
  };

  for (let i = 0; i < take.length; i += batch) {
    if (!live()) break;
    const results = await loadPart(take.slice(i, i + batch));
    if (epoch !== e0) break;
    for (const [id, f] of results) { if (f) { facts.set(id, f); loaded++; } else failed++; }
    if (!live()) break;
    if (onProgress) { try { onProgress(facts); } catch { /* Anzeige-Fehler bricht das Laden nicht */ } }
  }
  return done();
}
