// Client für die Edge Function `spellbook` (supabase/functions/spellbook). Commander Spellbook selbst
// ist im Browser nicht erreichbar (keine CORS-Header) — nur über die Function.
// Keine Importe von src/supabase.js: der Supabase-Client `sb` kommt vom Aufrufer (testbar in Node).
// Ausgabe: gekürzte Antwort { tag, cards, combos, almost, unknown } — Eingabe für bracket.js.
// Fehler: SpellbookError mit `code` (für die Übersetzung in P5) und HTTP-`status`.

export const MAX_QTY = 99;

/** Fehlercodes für die Oberfläche. */
export const ERROR_CODES = Object.freeze([
  'empty', // keine Karten — kein Aufruf
  'network', // offline / Function nicht erreichbar
  'auth', // nicht angemeldet (401) oder anonymes Konto (403)
  'rate_limited', // 429 — `retryAfter` Sekunden
  'timeout', // 504 — Spellbook antwortet nicht rechtzeitig
  'unavailable', // 502 / sonstiger Serverfehler — Spellbook gestört
  'bad_input', // 400 / 413 — Liste zu groß oder ungültig
  'bad_response', // Antwort nicht in erwarteter Form
]);

export class SpellbookError extends Error {
  /**
   * @param {string} code einer aus ERROR_CODES
   * @param {number} [status] HTTP-Status (0 = keiner)
   * @param {{ serverCode?: string | null, retryAfter?: number | null }} [more]
   */
  constructor(code, status = 0, more = {}) {
    super(`spellbook: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'SpellbookError';
    this.code = code;
    this.status = status;
    this.serverCode = more.serverCode ?? null;
    this.retryAfter = more.retryAfter ?? null;
  }
}

const key = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * `deck_cards`-Zeilen (P1: `section` 'commander' | 'main', `qty`, `name`) ⇒ Spellbook-Eingabe.
 * Gleiche Namen je Abschnitt werden zusammengelegt (P1 ist eindeutig je Scryfall-ID, nicht je Name),
 * Mengen auf 1–99 begrenzt; Zeilen ohne Namen und andere Abschnitte fallen weg.
 * @param {{ section?: string, qty?: number, name?: string }[]} rows
 */
export function toRequest(rows) {
  /** @type {{ commanders: {card: string, quantity: number}[], main: {card: string, quantity: number}[] }} */
  const out = { commanders: [], main: [] };
  /** @type {Map<string, {card: string, quantity: number}>} */
  const seen = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const side = r?.section === 'commander' ? 'commanders' : r?.section === 'main' ? 'main' : null;
    const card = typeof r?.name === 'string' ? r.name.trim() : '';
    if (!side || !card) continue;
    const qty = Math.max(1, Math.floor(Number(r.qty) || 1));
    const k = `${side}\u0000${key(card)}`;
    const have = seen.get(k);
    if (have) have.quantity = Math.min(MAX_QTY, have.quantity + qty);
    else {
      const e = { card, quantity: Math.min(MAX_QTY, qty) };
      seen.set(k, e);
      out[side].push(e);
    }
  }
  return out;
}

function codeFor(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'timeout';
  if (status === 400 || status === 413) return 'bad_input';
  return 'unavailable';
}

/**
 * Deck bei Commander Spellbook prüfen (über die Edge Function).
 * @param {{ functions: { invoke: (name: string, opts: object) => Promise<{ data: any, error: any }> } }} sb Supabase-Client
 * @param {{ section?: string, qty?: number, name?: string }[]} rows `deck_cards`-Zeilen
 * @returns {Promise<{ tag: string | null, cards: object[], combos: object[], almost: object[], unknown?: { count: number, cards: string[] } }>}
 * @throws {SpellbookError}
 */
export async function checkDeck(sb, rows) {
  const body = toRequest(rows);
  if (!body.commanders.length && !body.main.length) throw new SpellbookError('empty');

  let res;
  try {
    res = await sb.functions.invoke('spellbook', { body });
  } catch {
    throw new SpellbookError('network');
  }
  const { data, error } = res || {};
  if (error) {
    // supabase-js: FunctionsHttpError trägt die Antwort in `context` (Response); FunctionsFetchError/RelayError nicht.
    const ctx = error.context;
    const status = typeof ctx?.status === 'number' ? ctx.status : 0;
    if (!status) throw new SpellbookError('network');
    let payload = null;
    try {
      payload = typeof ctx.json === 'function' ? await ctx.json() : null;
    } catch {
      payload = null;
    }
    const retry = Number(payload?.retryAfter ?? ctx.headers?.get?.('retry-after'));
    throw new SpellbookError(codeFor(status), status, {
      serverCode: typeof payload?.error === 'string' ? payload.error : null,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
    });
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.cards) || !Array.isArray(data.combos)) {
    throw new SpellbookError('bad_response', 200);
  }
  return data;
}
