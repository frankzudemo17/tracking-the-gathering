// Edge Function `spellbook` — reine Logik ohne Deno-Bezug (in Node testbar: tests/unit/spellbook-proxy.test.mjs).
// Weg: Browser ⇒ diese Function ⇒ Commander Spellbook (POST /estimate-bracket + POST /find-my-combos).
// Grund: Spellbook sendet keine CORS-Header (gemessen 2026-11-10). Öffentliche API, kein Schlüssel.
//
// Schutz: CORS nur für die App (Pages + lokal) · JWT (Gateway prüft die Signatur, verify_jwt = true;
// hier zusätzlich: Nutzlast lesen, anonyme Konten ⇒ 403) · Eingabegrenzen · Zeitgrenze je Aufruf ·
// Drossel je Nutzer. Zwischenspeicher und Drossel liegen im Speicher des Isolats: „bestes Bemühen“,
// sie gelten nur, solange dasselbe Isolat antwortet, und sind nach einem Kaltstart leer.
// Datenschutz: keine Kartenlisten und keine Nutzer-IDs im Log — höchstens Art und Status eines Fehlers.

export const PAGES_ORIGIN = 'https://frankzudemo17.github.io';
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
export const SPELLBOOK = 'https://backend.commanderspellbook.com';

export const LIMITS = Object.freeze({
  bodyBytes: 64 * 1024, // Body ≤ 64 KB ⇒ sonst 413
  entries: 250, // Einträge gesamt (commanders + main)
  cardMin: 1,
  cardMax: 200, // Zeichen je Kartenname
  qtyMin: 1,
  qtyMax: 99,
  timeoutMs: 12_000, // je Spellbook-Aufruf ⇒ 504
  cacheMs: 10 * 60_000, // Zwischenspeicher 10 min
  cacheMax: 500, // Einträge im Zwischenspeicher (älteste fliegen zuerst)
  rateMax: 20, // Anfragen je Nutzer …
  rateWindowMs: 60_000, // … je Minute ⇒ 429
  almostMax: 10, // „fast fertig“-Kombos in der Antwort
  unknownMax: 50, // Namen unbekannter Karten in der Antwort
});

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';

/** Darf dieser Origin die Antwort lesen? Pages oder lokale Vorschau/E2E. */
export function allowedOrigin(origin) {
  return typeof origin === 'string' && (origin === PAGES_ORIGIN || LOCAL_ORIGIN.test(origin));
}

/** CORS-Header für jede Antwort (auch Fehler). ACAO nur bei erlaubtem Origin. */
export function corsHeaders(origin) {
  /** @type {Record<string, string>} */
  const h = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (allowedOrigin(origin)) h['Access-Control-Allow-Origin'] = /** @type {string} */ (origin);
  return h;
}

function reply(status, body, origin, extra = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      ...(body == null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}
const fail = (status, error, origin, more = {}, extra = {}) => reply(status, { error, ...more }, origin, extra);

// ---- Auth -------------------------------------------------------------------------------------

/**
 * Nutzlast eines `Authorization: Bearer <JWT>` lesen. Die Signatur prüft das Supabase-Gateway
 * (verify_jwt = true) — hier wird NICHT geprüft, nur gelesen. Kein/kaputter Token ⇒ null.
 */
export function jwtPayload(authorization) {
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/.exec(String(authorization || '').trim());
  if (!m) return null;
  try {
    const b64 = m[2].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

/** ⇒ { sub } oder { status, error }. Anonyme Konten 403; ohne Nutzer (kein sub, andere Rolle, abgelaufen) 401. */
export function authorize(authorization, nowMs) {
  const p = jwtPayload(authorization);
  if (!p) return { status: 401, error: 'unauthorized' };
  if (p.is_anonymous === true) return { status: 403, error: 'anonymous' };
  if (p.role !== 'authenticated' || typeof p.sub !== 'string' || !p.sub) return { status: 401, error: 'unauthorized' };
  if (typeof p.exp === 'number' && p.exp * 1000 <= nowMs) return { status: 401, error: 'unauthorized' };
  return { sub: p.sub };
}

// ---- Eingabe ----------------------------------------------------------------------------------

const chars = (s) => [...s].length;

function cleanEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return { error: 'bad_entry' };
  const card = typeof e.card === 'string' ? e.card.trim() : '';
  if (chars(card) < LIMITS.cardMin || chars(card) > LIMITS.cardMax) return { error: 'bad_card' };
  const q = e.quantity;
  if (!Number.isInteger(q) || q < LIMITS.qtyMin || q > LIMITS.qtyMax) return { error: 'bad_quantity' };
  return { value: { card, quantity: q } };
}

/**
 * Body (Text) prüfen ⇒ { value: { commanders, main } } oder { error: code }.
 * Codes: bad_json · bad_body · empty · too_many · bad_entry · bad_card · bad_quantity.
 * Weitergereicht werden nur `card` (getrimmt) und `quantity`.
 */
export function validate(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: 'bad_json' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad_body' };
  const commanders = body.commanders ?? [];
  const main = body.main ?? [];
  if (!Array.isArray(commanders) || !Array.isArray(main)) return { error: 'bad_body' };
  const total = commanders.length + main.length;
  if (total === 0) return { error: 'empty' };
  if (total > LIMITS.entries) return { error: 'too_many' };
  const out = { commanders: [], main: [] };
  for (const [key, xs] of /** @type {const} */ ([['commanders', commanders], ['main', main]])) {
    for (const e of xs) {
      const r = cleanEntry(e);
      if (r.error) return { error: r.error };
      out[key].push(r.value);
    }
  }
  return { value: out };
}

/** Name vergleichbar machen: klein, NFC, typografische Apostrophe/Anführungen gerade, Leerraum einfach. */
export const normName = (s) =>
  String(s ?? '').normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ').trim().toLowerCase();
const frontFace = (s) => s.split(' // ')[0];

/** Normalisierte Eingabe für den Zwischenspeicher: sortiert, kleingeschrieben, Mengen dabei. */
export function normalizeInput(input) {
  const side = (xs) => xs.map((e) => `${e.quantity}\u0000${normName(e.card)}`).sort();
  return JSON.stringify({ c: side(input.commanders), m: side(input.main) });
}

/** SHA-256 (hex) der normalisierten Eingabe. */
export async function cacheKey(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeInput(input)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Kürzung ----------------------------------------------------------------------------------

const list = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === 'string' ? x : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const usesNames = (uses) => list(uses).map((u) => str(u?.card?.name)).filter(Boolean);
const producesNames = (produces) => list(produces).map((p) => str(p?.feature?.name)).filter(Boolean);

/**
 * Spellbook-Antworten auf das kürzen, was der Rechner braucht (keine Bild-URLs, keine Preise,
 * keine Legalitäten, keine Beschreibungen).
 * @param {any} estimate Antwort von POST /estimate-bracket
 * @param {any} fmc Antwort von POST /find-my-combos
 * @param {{ commanders: {card: string}[], main: {card: string}[] }} [input] gesendete Liste —
 *   nur damit lassen sich unbekannte Karten (`unknown`) und fehlende Kombo-Teile (`almost[].missing`) bestimmen.
 */
export function trim(estimate, fmc, input) {
  const est = estimate && typeof estimate === 'object' ? estimate : {};
  const estCards = list(est.cards).filter((c) => c && typeof c === 'object');

  const cards = estCards
    .filter((c) => c.gameChanger === true || c.massLandDenial === true || c.extraTurn === true || c.banned === true)
    .map((c) => ({
      name: str(c.card?.name),
      gameChanger: c.gameChanger === true,
      massLandDenial: c.massLandDenial === true,
      extraTurn: c.extraTurn === true,
      banned: c.banned === true,
    }))
    .filter((c) => c.name);

  const combos = list(est.combos).filter((x) => x && typeof x === 'object').map((x) => {
    const k = x.combo && typeof x.combo === 'object' ? x.combo : {};
    return {
      id: str(k.id),
      cards: usesNames(k.uses),
      produces: producesNames(k.produces),
      definitelyTwoCard: x.definitelyTwoCard === true,
      arguablyTwoCard: x.arguablyTwoCard === true,
      manaValueNeeded: num(k.manaValueNeeded),
      extraTurn: x.extraTurn === true,
      massLandDenial: x.massLandDenial === true,
      lock: x.lock === true,
      speed: num(x.speed),
      tag: str(k.bracketTag),
    };
  });

  // Was Spellbook als Karte im Deck erkannt hat (exakt, ohne Vorderseiten-Toleranz).
  const known = new Set(estCards.map((c) => normName(c.card?.name)).filter(Boolean));
  const sent = input ? [...input.commanders, ...input.main].map((e) => e.card) : [];
  // Fürs Anzeigen „fehlt noch“: auch Vorderseite eines doppelseitigen Namens zählt als vorhanden.
  const owned = new Set(known);
  for (const n of [...known, ...sent.map(normName)]) { owned.add(n); owned.add(frontFace(n)); }
  const isOwned = (name) => owned.has(normName(name)) || owned.has(frontFace(normName(name)));

  const almost = list(fmc?.results?.almostIncluded).filter((k) => k && typeof k === 'object')
    .slice(0, LIMITS.almostMax)
    .map((k) => {
      const kc = usesNames(k.uses);
      return { id: str(k.id), cards: kc, missing: kc.filter((n) => !isOwned(n)), produces: producesNames(k.produces) };
    });

  /** @type {any} */
  const out = { tag: str(est.bracketTag), cards, combos, almost };
  if (input) {
    // Spellbook lässt unbekannte Namen still weg (z. B. nur die Vorderseite „Sejiri Shelter“ statt
    // „Sejiri Shelter // Sejiri Glacier“, live geprüft 2026-11-10) ⇒ gesendet, aber nicht zurück.
    const seen = new Set();
    const missing = [];
    for (const name of sent) {
      const n = normName(name);
      if (seen.has(n)) continue;
      seen.add(n);
      if (!known.has(n)) missing.push(name);
    }
    out.unknown = { count: missing.length, cards: missing.slice(0, LIMITS.unknownMax) };
  }
  return out;
}

// ---- Weiterleitung ----------------------------------------------------------------------------

class UpstreamError extends Error {
  constructor(kind, status = 0) {
    super(`spellbook ${kind}${status ? ' ' + status : ''}`);
    this.kind = kind; // 'timeout' | 'status' | 'network'
    this.status = status;
  }
}

/** Ein Spellbook-Aufruf mit harter Zeitgrenze (gilt auch, wenn fetch das Abbrechen ignoriert). */
async function callUpstream(deps, path, payload) {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = deps.setTimer(() => {
      ctrl.abort();
      reject(new UpstreamError('timeout'));
    }, deps.timeoutMs);
  });
  try {
    const res = await Promise.race([
      deps.fetch(SPELLBOOK + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: payload,
        signal: ctrl.signal,
      }),
      timeout,
    ]);
    if (!res || !res.ok) throw new UpstreamError('status', res?.status || 0);
    return await Promise.race([res.json(), timeout]);
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError(ctrl.signal.aborted ? 'timeout' : 'network');
  } finally {
    deps.clearTimer(timer);
  }
}

/** Body lesen, höchstens `max` Bytes; mehr ⇒ null. */
async function readCapped(request, max) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

/**
 * Handler bauen. Abhängigkeiten sind austauschbar (Tests): fetch, Uhr, Zeitgrenze, Timer, Log.
 * Jeder Handler hat eigenen Zwischenspeicher und eigene Drossel.
 */
export function createHandler(opts = {}) {
  const deps = {
    fetch: opts.fetch || ((url, init) => globalThis.fetch(url, init)),
    now: opts.now || (() => Date.now()),
    timeoutMs: opts.timeoutMs ?? LIMITS.timeoutMs,
    setTimer: opts.setTimer || ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: opts.clearTimer || ((t) => clearTimeout(t)),
    log: opts.log || ((msg) => console.warn(msg)),
  };
  /** @type {Map<string, { at: number, body: string }>} */
  const cache = new Map();
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  function throttled(sub, now) {
    const since = now - LIMITS.rateWindowMs;
    const recent = (hits.get(sub) || []).filter((t) => t > since);
    if (recent.length >= LIMITS.rateMax) {
      hits.set(sub, recent);
      return Math.max(1, Math.ceil((recent[0] + LIMITS.rateWindowMs - now) / 1000));
    }
    recent.push(now);
    hits.set(sub, recent);
    if (hits.size > 1000) for (const [k, ts] of hits) if (!ts.some((t) => t > since)) hits.delete(k);
    return 0;
  }

  function cacheGet(key, now) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (now - hit.at > LIMITS.cacheMs) {
      cache.delete(key);
      return null;
    }
    return hit.body;
  }

  function cachePut(key, body, now) {
    for (const [k, v] of cache) if (now - v.at > LIMITS.cacheMs) cache.delete(k);
    while (cache.size >= LIMITS.cacheMax) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now, body });
  }

  return async function handle(request) {
    const origin = request.headers.get('origin');
    if (request.method === 'OPTIONS') return reply(204, null, origin);
    if (request.method !== 'POST') return fail(405, 'method', origin, {}, { Allow: 'POST, OPTIONS' });

    const now = deps.now();
    const auth = authorize(request.headers.get('authorization'), now);
    if (!auth.sub) return fail(auth.status, auth.error, origin);

    const wait = throttled(auth.sub, now);
    if (wait) return fail(429, 'rate_limited', origin, { retryAfter: wait }, { 'Retry-After': String(wait) });

    const text = await readCapped(request, LIMITS.bodyBytes).catch(() => undefined);
    if (text === null) return fail(413, 'too_large', origin);
    if (text === undefined) return fail(400, 'bad_body', origin);
    const v = validate(text);
    if (v.error) return fail(400, v.error, origin);
    const input = v.value;

    const key = await cacheKey(input);
    const cached = cacheGet(key, now);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'hit' },
      });
    }

    const payload = JSON.stringify(input);
    const [est, fmc] = await Promise.allSettled([
      callUpstream(deps, '/estimate-bracket', payload),
      callUpstream(deps, '/find-my-combos', payload),
    ]);
    const errors = [est, fmc].filter((r) => r.status === 'rejected').map((r) => /** @type {any} */ (r).reason);
    if (errors.length) {
      const e = errors.find((x) => x?.kind === 'timeout') || errors[0];
      deps.log(`spellbook: ${e?.message || 'upstream'}`); // nur Art + Status, keine Liste, keine Nutzer-ID
      if (e?.kind === 'timeout') return fail(504, 'timeout', origin);
      return fail(502, 'upstream', origin, { status: e?.status || 0 });
    }

    const body = JSON.stringify(trim(/** @type {any} */ (est).value, /** @type {any} */ (fmc).value, input));
    cachePut(key, body, deps.now());
    return new Response(body, {
      status: 200,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'miss' },
    });
  };
}

/** Standard-Handler für Deno.serve (index.js). */
export const handle = createHandler();
