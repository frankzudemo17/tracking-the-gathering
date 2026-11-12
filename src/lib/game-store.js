// Spiel-Datenschicht (Spec P5): Spiel anlegen, laden (Replay), Ereignisse geordnet und
// idempotent schreiben, live_state veröffentlichen, Spiel beenden.
// Wahrheit ist game_events; der Zustand entsteht immer per replay der Engine.
// games.live_state / round / current_turn sind abgeleitete Kopien (nur hier geschrieben).
// `sb` wird übergeben (kein Import von src/supabase.js ⇒ in Node testbar).
//
// Mehrere Schreiber (Spec P4, Welle ttg-live-feinschliff-decks): „optimistische seq +
// Umnummerieren“. Jedes Ereignis trägt payload.cid (Identität über Geräte hinweg), seq ist
// nur die Reihenfolge. Geschrieben wird per insert (ein Stapel ganz oder gar nicht); bei
// 23505 entscheidet das Lesen der Server-Zeilen: eigene cid ⇒ bestätigt, fremde cid ⇒
// eigene Zeilen ab dort hinter das Server-Ende umnummerieren (Undo-Verweise ziehen mit).
// subscribe() hält per Realtime + Nachholen den neu abgespielten Zustand aktuell.
import { createGame, replay, act, snapshot, results } from '../game/engine.js';

const BATCH_MS = 300;
const PUBLISH_MS = 1000;
const BACKOFF_S = [1, 2, 4, 8, 16, 30];
const PAGE = 1000;
const MAX_REBASES = 5;
const UNIQUE_VIOLATION = '23505';
const EVENT_KEYS = ['seq', 'round', 'type', 'actor', 'source', 'target', 'amount', 'payload'];
const URGENT = new Set(['turn_end', 'eliminate', 'undo']);
const DECK_COLS = 'id, short_name, commander_name, partner_name, image_url, partner_image_url, color_identity, field_color, field_mode, counter_pins';
const GAME_COLS = 'id, playgroup_id, session_id, status, layout, starting_life, first_seat, current_turn, round, started_at, ended_at, created_by';
const GAME_KEYS = GAME_COLS.split(', ');

const queueKey = (gameId) => `ttg.queue.${gameId}`;

/** Nur die acht Ereignis-Felder (ohne id, game_id, created_at); payload flach kopiert. */
function toEvent(row) {
  const e = {};
  for (const k of EVENT_KEYS) e[k] = row[k] === undefined ? null : row[k];
  e.payload = e.payload == null ? {} : { ...e.payload };
  return e;
}

const toRow = (gameId, ev) => ({ game_id: gameId, ...toEvent(ev) });
const cidOf = (e) => e?.payload?.cid ?? null;
const actOf = (e) => (Number.isInteger(e?.payload?.act) ? e.payload.act : null);

/** Schlüsselreihenfolge-unabhängige Form (jsonb ordnet Schlüssel um). */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}

/** Gleicher Inhalt ohne cid (Server-Zeile einer früheren Version ohne cid ⇔ dieselbe Zeile). */
function sameContent(a, b) {
  const strip = (e) => { const x = toEvent(e); delete x.seq; const { cid: _c, ...rest } = x.payload; x.payload = rest; return x; };
  return canon(strip(a)) === canon(strip(b));
}

/** Kennung eines Ereignisses: UUID v4 (Fallback: 128 bit aus getRandomValues). */
function newCid() {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  if (typeof c?.getRandomValues !== 'function') throw new Error('Web Crypto fehlt: keine Ereignis-Kennung möglich');
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Lokales Datum YYYY-MM-DD des Geräts. */
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Netzfehler, Zeitüberschreitung, Drosselung, Serverfehler ⇒ erneut versuchen. */
function retryable(status) {
  return status == null || status === 0 || status === 408 || status === 429 || status >= 500;
}

function fail(res, what) {
  const e = new Error(res.error?.message || `${what} fehlgeschlagen`);
  e.code = res.error?.code;
  e.status = res.status;
  throw e;
}

function safeStorage(storage) {
  return {
    get(k) { try { return storage ? storage.getItem(k) : null; } catch { return null; } },
    set(k, v) { try { storage?.setItem(k, v); } catch { /* voll oder gesperrt: Liste bleibt im Speicher */ } },
    remove(k) { try { storage?.removeItem(k); } catch { /* egal */ } },
  };
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

const pickGame = (row) => Object.fromEntries(GAME_KEYS.filter((k) => k in row).map((k) => [k, row[k]]));

// Spec P3 (Welle ttg-features, Entscheid 1 b): „dieses Gerät hat das Spiel gestartet“ — modulweit, nicht je
// Store-Instanz (setup.js und life.js haben verschiedene). Nur im Arbeitsspeicher: Neuladen vergisst ihn (gewollt).
const freshStarts = new Map(); // gameId ⇒ Date.now() nach erfolgreichem start_game

/** Zeitstempel des Starts auf diesem Gerät und Eintrag löschen (einmal verbraucht); sonst null. */
export function takeFreshStart(gameId) {
  const at = freshStarts.get(gameId);
  freshStarts.delete(gameId);
  return typeof at === 'number' ? at : null;
}

/**
 * @param {object} sb Supabase-Client (oder Attrappe)
 * @param {{ storage?: Storage, online?: () => boolean, timers?: { setTimeout: Function, clearTimeout: Function }, events?: EventTarget, realtime?: { channel: Function, removeChannel: Function } }} [opts]
 *   realtime: Quelle der Realtime-Kanäle (Standard: `sb` selbst, also sb.channel / sb.removeChannel).
 */
export function createStore(sb, {
  storage = defaultStorage(),
  online = () => globalThis.navigator?.onLine !== false,
  timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) },
  events = globalThis,
  realtime = sb,
} = {}) {
  const store = safeStorage(storage);
  const recorders = new Map();
  const publishers = new Map();
  /** Je Spiel: Startaufstellung, Spielzeile, bekannte Server-Ereignisse, Abonnenten. */
  const contexts = new Map();

  function ctxOf(gameId) {
    let c = contexts.get(gameId);
    if (!c) {
      c = { init: null, game: null, server: new Map(), cids: new Set(), maxSeq: 0, maxAct: 0,
        subs: new Set(), channel: null, onOnline: null, catching: null, catchAgain: false, pendingEmit: null };
      contexts.set(gameId, c);
    }
    return c;
  }

  /** Server-Zeile merken (Server-seq sind unveränderlich). true ⇒ war neu. */
  function addServer(ctx, ev) {
    if (!Number.isInteger(ev.seq) || ctx.server.has(ev.seq)) return false;
    ctx.server.set(ev.seq, ev);
    const c = cidOf(ev);
    if (c) ctx.cids.add(c);
    if (ev.seq > ctx.maxSeq) ctx.maxSeq = ev.seq;
    const a = actOf(ev);
    if (a !== null && a > ctx.maxAct) ctx.maxAct = a; // alle Typen (wie engine nextAct)
    return true;
  }

  /** Höchste seq, bis zu der alle Server-Ereignisse lückenlos bekannt sind. */
  function watermark(ctx) {
    let s = 0;
    while (ctx.server.has(s + 1)) s++;
    return s;
  }

  function readQueue(gameId) {
    const raw = store.get(queueKey(gameId));
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((r) => r && Number.isInteger(r.seq)) : [];
    } catch { return []; }
  }

  // -------------------------------------------------------------------------
  // Schreib-Warteschlange

  function makeRecorder(gameId) {
    const ctx = ctxOf(gameId);
    /** Unbestätigte Zeilen, nach seq sortiert, jede seq einmal. */
    let queue = readQueue(gameId).map((r) => toRow(gameId, r)).sort((a, b) => a.seq - b.seq);
    let inflight = null; // läuft ein Schreibvorgang (inkl. Konfliktauflösung)?
    let timer = null;
    let attempt = 0;
    let status = { state: 'saved', pending: 0 };
    let halted = false; // Dauerfehler: nur flush() versucht es erneut
    const listeners = new Set();
    /**
     * Veraltete Aufrufer (Entscheid 3a): alt → { to: neu, horizon } aller umnummerierten seq.
     * horizon = höchste seq, die ein Aufrufer vergeben kann, der das Umnummerieren noch nicht
     * kennt (max(nextFree, Server-Ende + 1) davor). Wer mit seq ≤ horizon pusht, meint mit der
     * alten seq seine eigene Zeile ⇒ übersetzen; wer darüber liegt, hat den umnummerierten
     * Zustand (seine seq ≥ Ende der neuen seq + 1 > horizon) und meint die Server-Zeile
     * (Befund B2). Pusht ein veralteter Aufrufer weiter (seq s ≤ horizon), rückt der Horizont
     * mit (s + 1): seine Kette bleibt veraltet, ein frischer Aufrufer liegt stets ≥ nextFree.
     */
    const seqMap = new Map();
    let nextFree = 1;
    for (const r of queue) nextFree = Math.max(nextFree, r.seq + 1);

    const persist = () => {
      if (queue.length) store.set(queueKey(gameId), JSON.stringify(queue));
      else store.remove(queueKey(gameId));
    };

    stampLegacy(); // direkt nach dem Lesen (Befund B3): Zustand und Warteschlange tragen cid

    /** Höchste act der Warteschlange (optional nur Zeilen, für die `keep` gilt). */
    const queueMaxAct = (keep = () => true) => {
      let m = 0;
      for (const r of queue) { const a = actOf(r); if (a !== null && keep(r) && a > m) m = a; }
      return m;
    };

    function setStatus(state, error) {
      status = error ? { state, pending: queue.length, error } : { state, pending: queue.length };
      for (const fn of listeners) { try { fn(status); } catch { /* Anzeige darf nicht stören */ } }
    }

    function clearTimer() {
      if (timer != null) { timers.clearTimeout(timer); timer = null; }
    }

    function schedule(ms) {
      if (timer != null || inflight || halted || !queue.length) return;
      timer = timers.setTimeout(() => { timer = null; send().catch(() => {}); }, ms);
    }

    /** Alte Warteschlange (vor P4) ohne cid: beim Lesen nachstempeln (Entscheid 8, Befund B3). */
    function stampLegacy() {
      let changed = false;
      for (const r of queue) if (!cidOf(r)) { r.payload = { ...r.payload, cid: newCid() }; changed = true; }
      if (changed) persist();
    }

    /** Geschriebene Zeilen aus der Warteschlange nehmen und als Server-Zeilen merken. */
    function confirm(rows) {
      const done = new Set(rows.map(cidOf));
      for (const r of rows) addServer(ctx, toEvent(r));
      queue = queue.filter((r) => !done.has(cidOf(r)));
      persist();
    }

    /**
     * Warteschlange gegen die bekannten Server-Zeilen abgleichen: eigene (gleiche cid; ohne
     * cid auf dem Server = frühere Version: gleiche seq UND gleicher Inhalt ⇒ dasselbe
     * Ereignis) bestätigen. Cid-lose Zeile mit anderem Inhalt gilt als fremd.
     * @returns {number|null} kleinste seq, auf der eine fremde Server-Zeile liegt
     */
    function reconcile() {
      const before = queue.length;
      queue = queue.filter((r) => {
        const c = cidOf(r);
        if (c && ctx.cids.has(c)) return false;
        const s = ctx.server.get(r.seq);
        return !(s && !cidOf(s) && sameContent(s, r));
      });
      if (queue.length !== before) persist();
      let min = null;
      for (const r of queue) if (ctx.server.has(r.seq) && (min === null || r.seq < min)) min = r.seq;
      return min;
    }

    /**
     * Umnummerieren (Entscheid 3): alle unbestätigten Zeilen ab `from` bekommen in gleicher
     * Reihenfolge neue seq hinter der höchsten bekannten Server-seq; Undo-Zeilen, die auf eine
     * umnummerierte Zeile zeigen, ziehen mit. Server-seq werden nie umnummeriert (Entscheid 4).
     */
    function rebase(from) {
      // Eine Aktion (gemeinsame act) wird nie geteilt: Vorgänger gleicher act ziehen mit.
      for (let i = queue.findIndex((r) => r.seq >= from); i > 0; i--) {
        const a = actOf(queue[i]);
        if (a === null || actOf(queue[i - 1]) !== a) break;
        from = queue[i - 1].seq;
      }
      const moved = queue.filter((r) => r.seq >= from);
      const horizon = Math.max(nextFree, ctx.maxSeq + 1, ...queue.map((r) => r.seq + 1));
      const map = new Map();
      let next = ctx.maxSeq + 1;
      for (const r of queue) if (r.seq < from) next = Math.max(next, r.seq + 1);
      for (const r of moved) map.set(r.seq, next++);
      // Neue act hinter der höchsten act auf dem Server (Befund B1, Weg a): die Engine wählt
      // das Undo-Ziel über act; Zeilen einer Aktion (gleiche act in Folge) teilen die neue act.
      let nextAct = Math.max(ctx.maxAct, queueMaxAct((r) => r.seq < from)) + 1;
      let lastOld = null;
      let lastNew = null;
      for (const r of moved) {
        const a = actOf(r);
        if (a === null) { lastOld = null; continue; }
        if (a !== lastOld) { lastOld = a; lastNew = nextAct++; }
        r.payload = { ...r.payload, act: lastNew };
      }
      for (const r of queue) {
        if (r.type === 'undo' && Number.isInteger(r.payload?.seq) && map.has(r.payload.seq)) {
          r.payload = { ...r.payload, seq: map.get(r.payload.seq) };
        }
      }
      for (const r of moved) r.seq = map.get(r.seq);
      for (const e of seqMap.values()) if (map.has(e.to)) e.to = map.get(e.to); // Horizont bleibt
      for (const [k, v] of map) seqMap.set(k, { to: v, horizon });
      nextFree = Math.max(nextFree, next);
      queue.sort((a, b) => a.seq - b.seq);
      persist();
    }

    /** Nach Umnummerieren: neuen Zustand melden und selbst veröffentlichen (Entscheid 7). */
    function announceRebase() {
      const state = emit(gameId, 'rebase');
      if (state) publish(gameId, state);
    }

    async function writeRows(rows) {
      try {
        return await sb.from('game_events').insert(rows);
      } catch (err) {
        return { error: { message: err?.message || String(err) }, status: 0 };
      }
    }

    /**
     * Ein Schreibvorgang über alle ausstehenden Zeilen, inkl. Konfliktauflösung
     * (höchstens MAX_REBASES Umnummerierungen). Wirft bei Fehlschlag.
     */
    async function sendLoop() {
      let rebases = 0;
      for (;;) {
        stampLegacy();
        const rows = queue.slice();
        let res = await writeRows(rows);
        if (!res?.error) {
          confirm(rows);
          return;
        }
        if (res.error.code === UNIQUE_VIOLATION) {
          // Ganz oder gar nicht: nichts aus dem Stapel steht. Server ab der kleinsten seq lesen.
          const from = Math.min(...rows.map((r) => r.seq));
          let server = null;
          try { server = await eventsAfter(gameId, from - 1); } catch (e) {
            res = { error: { message: e.message, code: e.code }, status: e.status };
          }
          if (server) {
            for (const r of server) addServer(ctx, toEvent(r));
            const before = queue.length;
            const conflict = reconcile();
            if (!queue.length) return;
            if (conflict === null) {
              if (queue.length < before) continue; // Wiederholung nach verlorener Antwort: Rest senden
              res = { error: { message: 'Konflikt nicht auflösbar', code: UNIQUE_VIOLATION }, status: 409 };
            } else if (rebases >= MAX_REBASES) {
              res = { error: { message: 'Konflikt nicht auflösbar', code: UNIQUE_VIOLATION }, status: 409 };
            } else {
              rebases++;
              rebase(conflict);
              announceRebase();
              continue;
            }
          }
        }
        const msg = res.error.message || 'Speichern fehlgeschlagen';
        if (online() === false) { setStatus('offline'); throw new Error(msg); }
        if (res.error.code !== UNIQUE_VIOLATION && retryable(res.status)) {
          const wait = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)] * 1000;
          attempt++;
          setStatus('saving', msg);
          inflight = null;
          schedule(wait);
        } else {
          halted = true;
          setStatus('error', msg);
        }
        const e = new Error(msg);
        e.status = res.status;
        e.code = res.error.code;
        throw e;
      }
    }

    async function send() {
      while (inflight) await inflight;
      if (!queue.length) { setStatus('saved'); return; }
      if (online() === false) { setStatus('offline'); throw new Error('Offline'); }
      clearTimer();
      setStatus('saving');
      let release;
      const mine = new Promise((r) => { release = r; });
      inflight = mine;
      let ok = false;
      try {
        await sendLoop();
        ok = true;
      } finally {
        if (inflight === mine) inflight = null;
        release();
        idle();
      }
      if (ok) {
        attempt = 0;
        halted = false;
        if (queue.length) { setStatus('saving'); schedule(0); } else setStatus('saved');
      }
    }

    /** Nach einem Schreibvorgang: währenddessen eingetroffene Fremd-Ereignisse abgleichen. */
    function idle() {
      const reason = ctx.pendingEmit;
      if (reason == null) return;
      ctx.pendingEmit = null;
      ingestDone(gameId, reason, true);
    }

    const onOnline = () => { if (!halted) schedule(0); };
    events?.addEventListener?.('online', onOnline);

    const rec = {
      get status() { return status; },
      onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      /** Ausstehende Ereignisse (für loadGame). */
      pendingEvents() { return queue.map(toEvent); },
      push(evs) {
        const list = Array.isArray(evs) ? evs : [evs];
        if (!list.length) return;
        const known = new Set(queue.map(cidOf));
        nextFree = Math.max(nextFree, ctx.maxSeq + 1);
        // act ≤ höchster bekannter act ⇒ veralteter Aufrufer: neue act dahinter (Befund B1);
        // aufeinanderfolgende Zeilen gleicher alter act bleiben eine Aktion.
        const actFloor = Math.max(ctx.maxAct, queueMaxAct());
        let nextAct = Math.max(actFloor, ...list.map((e) => actOf(e) ?? 0)) + 1;
        let lastOld = null;
        let lastNew = null;
        for (const ev of list) {
          if (!ev || !Number.isInteger(ev.seq)) continue;
          // Stempel am Ereignis selbst: der Zustand des Aufrufers trägt dieselbe cid
          if (ev.payload == null || typeof ev.payload !== 'object') ev.payload = {};
          if (!ev.payload.cid) ev.payload.cid = newCid();
          const cid = ev.payload.cid;
          if (known.has(cid) || ctx.cids.has(cid)) continue; // schon gepusht / schon auf dem Server
          const row = toRow(gameId, ev);
          const a = actOf(row);
          if (a !== null && a <= actFloor) {
            if (a !== lastOld) { lastOld = a; lastNew = nextAct++; }
            row.payload.act = lastNew;
          } else lastOld = null;
          if (row.seq < nextFree) {
            // Veralteter Aufrufer (Entscheid 3a): nächste freie seq, Undo-Verweis übersetzen —
            // nur wenn der Aufrufer vor dem jeweiligen Umnummerieren steht (Befund B2)
            const s = row.seq;
            const m = row.type === 'undo' && Number.isInteger(row.payload.seq) ? seqMap.get(row.payload.seq) : undefined;
            if (m && s <= m.horizon) row.payload.seq = m.to;
            for (const e of seqMap.values()) if (s <= e.horizon) e.horizon = Math.max(e.horizon, s + 1);
            seqMap.set(s, { to: nextFree, horizon: s + 1 });
            row.seq = nextFree;
          }
          nextFree = row.seq + 1;
          queue.push(row);
          known.add(cid);
        }
        queue.sort((a, b) => a.seq - b.seq);
        persist();
        if (halted) { setStatus('error', status.error); return; }
        if (online() === false) { setStatus('offline'); return; }
        if (status.state === 'offline' || status.state === 'saved') setStatus('saving');
        else setStatus(status.state, status.error);
        // nach Offline sofort; bei laufender Wiederholung bleibt deren Takt
        schedule(BATCH_MS);
      },
      /** Sofort schreiben, bis die Liste leer ist; wirft beim ersten Fehlschlag. */
      async flush() {
        halted = false;
        clearTimer();
        while (queue.length || inflight) {
          if (inflight) { await inflight; continue; }
          await send();
        }
        setStatus('saved');
      },
      /** Liste und Timer verwerfen (nach erfolgreichem Spielende). */
      discard() {
        clearTimer();
        queue = [];
        store.remove(queueKey(gameId));
        events?.removeEventListener?.('online', onOnline);
        setStatus('saved');
      },
    };
    /** Intern: Abgleich mit neuen Server-Zeilen. busy ⇒ später (nach dem Schreibvorgang). */
    rec._sync = {
      get busy() { return inflight != null; },
      reconcile,
      /** Lokal umnummerieren, falls eine bekannte Server-Zeile eine eigene seq belegt. */
      rebaseKnown() {
        const conflict = reconcile();
        if (conflict === null) return false;
        rebase(conflict);
        if (status.state === 'saved') setStatus('saving');
        schedule(0);
        return true;
      },
      rows() { return queue; },
    };
    status = { state: queue.length ? 'saving' : 'saved', pending: queue.length };
    // Nach Reload: Rest der Warteschlange nachsenden
    if (queue.length) { if (online() === false) status = { state: 'offline', pending: queue.length }; else schedule(BATCH_MS); }
    return rec;
  }

  function recorder(gameId) {
    let r = recorders.get(gameId);
    if (!r) { r = makeRecorder(gameId); recorders.set(gameId, r); }
    return r;
  }

  // -------------------------------------------------------------------------
  // Zustand aus Server ∪ Warteschlange, Abonnenten benachrichtigen

  function mergedEvents(gameId) {
    const ctx = ctxOf(gameId);
    const bySeq = new Map(ctx.server);
    const rec = recorders.get(gameId);
    for (const r of rec ? rec._sync.rows() : []) {
      if (bySeq.has(r.seq)) continue; // gleiche cid = Echo; fremde cid wird umnummeriert
      if (cidOf(r) && ctx.cids.has(cidOf(r))) continue;
      bySeq.set(r.seq, toEvent(r));
    }
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  }

  /** Neu abgespielten Zustand an alle Abonnenten; gibt ihn zurück (oder null). */
  function emit(gameId, reason) {
    const ctx = ctxOf(gameId);
    if (!ctx.init) return null;
    const state = replay(ctx.init, mergedEvents(gameId));
    const info = { reason, game: ctx.game };
    for (const sub of [...ctx.subs]) {
      if (!sub.active) continue;
      try { sub.onState(state, info); } catch { /* Anzeige darf nicht stören */ }
    }
    return state;
  }

  /** Abschluss nach neuen Server-Zeilen: abgleichen, ggf. umnummerieren, melden. */
  function ingestDone(gameId, reason, fresh) {
    const ctx = ctxOf(gameId);
    const rec = recorders.get(gameId);
    if (rec?._sync.busy) { if (fresh) ctx.pendingEmit = ctx.pendingEmit ?? reason; return; }
    const rebased = rec ? rec._sync.rebaseKnown() : false;
    if (!fresh && !rebased) return;
    const state = emit(gameId, rebased ? 'rebase' : reason);
    if (rebased && state) publish(gameId, state);
  }

  /** Eingehende Server-Zeilen (Realtime, Nachholen) — dedupliziert per seq + cid. */
  function ingest(gameId, rows, reason) {
    const ctx = ctxOf(gameId);
    const rec = recorders.get(gameId);
    const own = new Set(rec ? rec._sync.rows().map(cidOf) : []);
    let fresh = false;
    for (const r of rows) {
      if (!r || !Number.isInteger(r.seq) || (r.game_id != null && r.game_id !== gameId)) continue;
      const ev = toEvent(r);
      if (addServer(ctx, ev) && !own.has(cidOf(ev))) fresh = true;
    }
    ingestDone(gameId, reason, fresh);
  }

  // -------------------------------------------------------------------------
  // Start

  async function startGame({ groupId, layout, startingLife, firstSeat, players, playedOn = localDate(), startRoll = null }) {
    const res = await sb.rpc('start_game', {
      p_group: groupId,
      p_layout: layout,
      p_starting_life: startingLife,
      p_first_seat: firstSeat,
      p_players: players.map((p) => ({ member_id: p.memberId, deck_id: p.deckId, seat: p.seat })),
      p_played_on: playedOn,
    });
    if (res.error) fail(res, 'Spielstart');
    const game = res.data;
    const gameId = game.id;
    freshStarts.set(gameId, Date.now()); // P3: Spielstart-Intro nur auf diesem Gerät
    if (startRoll) {
      const init = createGame({
        players: players.map((p) => ({ id: p.memberId, seat: p.seat })),
        startingLife, firstSeat, startedAt: Date.parse(game.started_at) || 0,
      });
      const { events: evs } = act(init, { type: 'roll', kind: 'start', values: startRoll.values, winnerSeat: startRoll.winnerSeat });
      const rec = recorder(gameId);
      rec.push(evs);
      rec.flush().catch(() => {}); // Fehlschlag: bleibt in der Warteschlange
    }
    return gameId;
  }

  // -------------------------------------------------------------------------
  // Laden

  async function allEvents(gameId) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const res = await sb.from('game_events').select(EVENT_KEYS.join(', '))
        .eq('game_id', gameId).not('seq', 'is', null).order('seq', { ascending: true })
        .range(from, from + PAGE - 1);
      if (res.error) fail(res, 'Ereignisse laden');
      const rows = res.data || [];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  /** Server-Ereignisse mit seq > after, seitenweise. Wirft bei Fehler. */
  async function eventsAfter(gameId, after) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const res = await sb.from('game_events').select(EVENT_KEYS.join(', '))
        .eq('game_id', gameId).gt('seq', after).order('seq', { ascending: true })
        .range(from, from + PAGE - 1);
      if (res.error) fail(res, 'Ereignisse laden');
      const rows = res.data || [];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async function loadGame(gameId) {
    const g = await sb.from('games').select(GAME_COLS).eq('id', gameId).single();
    if (g.error) fail(g, 'Spiel laden');
    const game = g.data;
    const gp = await sb.from('game_players')
      .select('member_id, deck_id, seat, place, eliminated_round, eliminated_by, final_life')
      .eq('game_id', gameId).order('seat', { ascending: true });
    if (gp.error) fail(gp, 'Spieler laden');
    const rows = gp.data || [];
    const memberIds = rows.map((r) => r.member_id);
    const deckIds = [...new Set(rows.map((r) => r.deck_id).filter(Boolean))];
    // Recorder VOR dem Server-Lesen anlegen: bestätigt ein laufender Schreibvorgang zwischen
    // Lesen und Abgleich, steht die Zeile über confirm() im Spiel-Kontext (nichts fällt heraus).
    const rec = recorder(gameId);
    const [mres, dres, server] = await Promise.all([
      memberIds.length ? sb.from('members').select('id, display_name, avatar_path, profile_id').in('id', memberIds) : { data: [] },
      deckIds.length ? sb.from('decks').select(DECK_COLS).in('id', deckIds) : { data: [] },
      allEvents(gameId),
    ]);
    if (mres.error) fail(mres, 'Mitglieder laden');
    if (dres.error) fail(dres, 'Decks laden');
    const names = new Map((mres.data || []).map((m) => [m.id, m]));
    const decks = Object.fromEntries((dres.data || []).map((d) => [d.id, d]));
    const players = rows.map((r) => ({ ...r, name: names.get(r.member_id)?.display_name ?? '', member: names.get(r.member_id) ?? null }));

    const ctx = ctxOf(gameId);
    for (const r of server) addServer(ctx, toEvent(r));
    ctx.game = game;
    ctx.init = createGame({
      players: players.map((p) => ({ id: p.member_id, name: p.name, seat: p.seat, partner: !!decks[p.deck_id]?.partner_name })),
      startingLife: game.starting_life,
      firstSeat: game.first_seat,
      startedAt: Date.parse(game.started_at),
    });
    // Eigene bestätigen; eigene Zeile auf einer seq mit fremder cid ⇒ umnummerieren statt verwerfen
    if (!rec._sync.busy) rec._sync.rebaseKnown(); else rec._sync.reconcile();
    const state = replay(ctx.init, mergedEvents(gameId));
    return { game, players, decks, state };
  }

  // -------------------------------------------------------------------------
  // Abonnement (Realtime + Nachholen)

  /** Nachholen aller Server-Ereignisse ab der höchsten lückenlos bekannten seq (+ Spielstatus). */
  function catchup(gameId) {
    const ctx = ctxOf(gameId);
    if (ctx.catching) { ctx.catchAgain = true; return ctx.catching; }
    ctx.catching = (async () => {
      do {
        ctx.catchAgain = false;
        if (!ctx.subs.size) return;
        let rows; let g;
        try {
          [rows, g] = await Promise.all([
            eventsAfter(gameId, watermark(ctx)),
            sb.from('games').select(GAME_COLS).eq('id', gameId).maybeSingle(),
          ]);
        } catch (e) {
          for (const s of [...ctx.subs]) { try { s.onStatus?.('CATCHUP_ERROR', e); } catch { /* egal */ } }
          return;
        }
        if (!ctx.subs.size) return;
        ingest(gameId, rows, 'catchup');
        if (g && !g.error && g.data) onGameRow(gameId, g.data);
      } while (ctx.catchAgain);
    })().finally(() => { ctx.catching = null; });
    return ctx.catching;
  }

  function onGameRow(gameId, row) {
    const ctx = ctxOf(gameId);
    if (!row || (row.id != null && row.id !== gameId)) return;
    const prev = ctx.game?.status;
    ctx.game = { ...(ctx.game || {}), ...pickGame(row) };
    if (row.status !== undefined && row.status !== prev) emit(gameId, 'status');
  }

  function teardown(ctx) {
    const ch = ctx.channel;
    ctx.channel = null;
    if (ctx.onOnline) { events?.removeEventListener?.('online', ctx.onOnline); ctx.onOnline = null; }
    if (ch) { try { realtime.removeChannel(ch); } catch { /* Kanal schon weg */ } }
  }

  /**
   * Live-Zustand abonnieren. Vorher loadGame(gameId) (Startaufstellung + Server-Ereignisse).
   * onState(state, { reason: 'remote'|'rebase'|'catchup'|'status', game }) nach jedem
   * eingehenden Fremd-Ereignis, jeder Umnummerierung, jedem Nachholen mit neuen Zeilen und
   * jedem Statuswechsel des Spiels. onStatus(status, err) bekommt den Kanalstatus
   * (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED) und CATCHUP_ERROR.
   * @returns {() => void} unsubscribe
   */
  function subscribe(gameId, onState, { onStatus } = {}) {
    const ctx = ctxOf(gameId);
    if (!ctx.init) throw new Error('subscribe: Spiel zuerst mit loadGame laden');
    const sub = { onState, onStatus, active: true };
    ctx.subs.add(sub);
    if (!ctx.channel) {
      const ch = realtime.channel(`game:${gameId}`);
      ctx.channel = ch;
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_events', filter: `game_id=eq.${gameId}` },
        (msg) => { if (ctx.channel === ch && msg?.new) ingest(gameId, [msg.new], 'remote'); });
      ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (msg) => { if (ctx.channel === ch && msg?.new) onGameRow(gameId, msg.new); });
      ch.subscribe((st, err) => {
        if (ctx.channel !== ch) return;
        for (const s of [...ctx.subs]) { try { s.onStatus?.(st, err); } catch { /* egal */ } }
        if (st === 'SUBSCRIBED') catchup(gameId);
      });
      ctx.onOnline = () => { if (ctx.channel === ch) catchup(gameId); };
      events?.addEventListener?.('online', ctx.onOnline);
    }
    return () => {
      if (!sub.active) return;
      sub.active = false;
      ctx.subs.delete(sub);
      if (!ctx.subs.size) teardown(ctx);
    };
  }

  // -------------------------------------------------------------------------
  // live_state (gedrosselt, nachlaufend)

  function publisher(gameId) {
    let p = publishers.get(gameId);
    if (!p) { p = { timer: null, latest: null, chain: Promise.resolve() }; publishers.set(gameId, p); }
    return p;
  }

  function writeLive(gameId, p) {
    const state = p.latest;
    if (!state) return;
    p.latest = null;
    const snap = snapshot(state);
    p.chain = p.chain.then(async () => {
      try {
        const res = await sb.from('games').update({ live_state: snap, round: snap.round, current_turn: snap.turn }).eq('id', gameId);
        if (res?.error && !p.latest) p.latest = state; // beim nächsten Aufruf erneut
      } catch {
        if (!p.latest) p.latest = state;
      }
    });
  }

  /** „Letzter gewinnt“ (abgeleitete Kopie). */
  function publish(gameId, state) {
    const p = publisher(gameId);
    p.latest = state;
    const last = state.events?.[state.events.length - 1];
    if (last && URGENT.has(last.type)) {
      if (p.timer != null) { timers.clearTimeout(p.timer); p.timer = null; }
      writeLive(gameId, p);
      return;
    }
    if (p.timer != null) return;
    p.timer = timers.setTimeout(() => { p.timer = null; writeLive(gameId, p); }, PUBLISH_MS);
  }

  // -------------------------------------------------------------------------
  // Ende

  async function finishGame(gameId, state, status) {
    if (status !== 'finished' && status !== 'aborted') throw new Error(`Ungültiger Spielstatus '${status}'`);
    const rec = recorder(gameId);
    await rec.flush(); // scheitert ⇒ wirft, Spiel bleibt live
    const pResults = status === 'finished'
      ? results(state).map((r) => ({
        member_id: r.id, place: r.place, eliminated_round: r.eliminatedRound,
        eliminated_by: r.eliminatedBy, final_life: r.finalLife,
      }))
      : null;
    const res = await sb.rpc('finish_game', { p_game: gameId, p_status: status, p_round: state.round, p_results: pResults });
    if (res.error) fail(res, 'Spielende');
    rec.discard();
    recorders.delete(gameId);
    const p = publishers.get(gameId);
    if (p?.timer != null) timers.clearTimeout(p.timer);
    publishers.delete(gameId);
    return res.data;
  }

  // -------------------------------------------------------------------------
  // Anzeigetafel

  async function liveGames(groupId) {
    const g = await sb.from('games').select('id, playgroup_id, status, layout, round, current_turn, started_at, live_state')
      .eq('playgroup_id', groupId).eq('status', 'live').order('started_at', { ascending: false });
    if (g.error) fail(g, 'Laufende Spiele laden');
    const games = g.data || [];
    if (!games.length) return [];
    const gp = await sb.from('game_players').select('game_id, member_id, deck_id, seat').in('game_id', games.map((x) => x.id));
    if (gp.error) fail(gp, 'Spieler laden');
    const rows = gp.data || [];
    const memberIds = [...new Set(rows.map((r) => r.member_id))];
    const deckIds = [...new Set(rows.map((r) => r.deck_id).filter(Boolean))];
    const [mres, dres] = await Promise.all([
      memberIds.length ? sb.from('members').select('id, display_name').in('id', memberIds) : { data: [] },
      deckIds.length ? sb.from('decks').select('id, image_url, color_identity, short_name').in('id', deckIds) : { data: [] },
    ]);
    if (mres.error) fail(mres, 'Mitglieder laden');
    if (dres.error) fail(dres, 'Decks laden');
    const names = new Map((mres.data || []).map((m) => [m.id, m.display_name]));
    const decks = new Map((dres.data || []).map((d) => [d.id, d]));
    return games.map((x) => ({
      ...x,
      players: rows.filter((r) => r.game_id === x.id).sort((a, b) => a.seat - b.seat).map((r) => ({
        member_id: r.member_id, name: names.get(r.member_id) ?? '', seat: r.seat, deck: decks.get(r.deck_id) ?? null,
      })),
    }));
  }

  // -------------------------------------------------------------------------
  // Deck-Vorlieben (RPCs aus P4)

  /** Feldhintergrund: mode ∈ 'art' | 'color' | 'commander'; color bei 'color' Pflicht. */
  async function setFieldColor(deckId, mode, color = null) {
    const res = await sb.rpc('set_deck_field_color', { p_deck: deckId, p_mode: mode, p_color: color });
    if (res.error) fail(res, 'Feldhintergrund speichern');
    return res.data;
  }

  async function setCounterPins(deckId, pins) {
    const res = await sb.rpc('set_deck_counter_pins', { p_deck: deckId, p_pins: pins });
    if (res.error) fail(res, 'Zähler-Pins speichern');
    return res.data;
  }

  return { startGame, loadGame, recorder, subscribe, publish, finishGame, liveGames, setFieldColor, setCounterPins };
}
