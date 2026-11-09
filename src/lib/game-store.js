// Spiel-Datenschicht (Spec P5): Spiel anlegen, laden (Replay), Ereignisse geordnet und
// idempotent schreiben, live_state veröffentlichen, Spiel beenden.
// Wahrheit ist game_events; der Zustand entsteht immer per replay der Engine.
// games.live_state / round / current_turn sind abgeleitete Kopien (nur hier geschrieben).
// `sb` wird übergeben (kein Import von src/supabase.js ⇒ in Node testbar).
import { createGame, replay, act, snapshot, results } from '../game/engine.js';

const BATCH_MS = 300;
const PUBLISH_MS = 1000;
const BACKOFF_S = [1, 2, 4, 8, 16, 30];
const PAGE = 1000;
const EVENT_KEYS = ['seq', 'round', 'type', 'actor', 'source', 'target', 'amount', 'payload'];
const URGENT = new Set(['turn_end', 'eliminate', 'undo']);
const DECK_COLS = 'id, short_name, commander_name, partner_name, image_url, partner_image_url, color_identity, field_color, field_mode, counter_pins';
const GAME_COLS = 'id, playgroup_id, session_id, status, layout, starting_life, first_seat, current_turn, round, started_at, ended_at, created_by';

const queueKey = (gameId) => `ttg.queue.${gameId}`;

/** Nur die acht Ereignis-Felder (ohne id, game_id, created_at). */
function toEvent(row) {
  const e = {};
  for (const k of EVENT_KEYS) e[k] = row[k] === undefined ? null : row[k];
  if (e.payload == null) e.payload = {};
  return e;
}

const toRow = (gameId, ev) => ({ game_id: gameId, ...toEvent(ev) });

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

/**
 * @param {object} sb Supabase-Client (oder Attrappe)
 * @param {{ storage?: Storage, online?: () => boolean, timers?: { setTimeout: Function, clearTimeout: Function }, events?: EventTarget }} [opts]
 */
export function createStore(sb, {
  storage = defaultStorage(),
  online = () => globalThis.navigator?.onLine !== false,
  timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) },
  events = globalThis,
} = {}) {
  const store = safeStorage(storage);
  const recorders = new Map();
  const publishers = new Map();

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
    /** Unbestätigte Zeilen, nach seq sortiert, jede seq einmal. */
    let queue = readQueue(gameId).map((r) => toRow(gameId, r)).sort((a, b) => a.seq - b.seq);
    let inflight = null;
    let timer = null;
    let attempt = 0;
    let status = { state: 'saved', pending: 0 };
    let halted = false; // Dauerfehler: nur flush() versucht es erneut
    const listeners = new Set();

    const persist = () => {
      if (queue.length) store.set(queueKey(gameId), JSON.stringify(queue));
      else store.remove(queueKey(gameId));
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

    /** Ein Schreibvorgang über alle ausstehenden Zeilen. Wirft bei Fehlschlag. */
    async function send() {
      while (inflight) await inflight.catch(() => {});
      if (!queue.length) { setStatus('saved'); return; }
      if (online() === false) { setStatus('offline'); throw new Error('Offline'); }
      clearTimer();
      const rows = queue.slice();
      setStatus('saving');
      let res;
      inflight = (async () => {
        try {
          res = await sb.from('game_events').upsert(rows, { onConflict: 'game_id,seq', ignoreDuplicates: true });
        } catch (err) {
          res = { error: { message: err?.message || String(err) }, status: 0 };
        }
      })();
      try { await inflight; } finally { inflight = null; }

      if (!res?.error) {
        const sent = new Set(rows.map((r) => r.seq));
        queue = queue.filter((r) => !sent.has(r.seq));
        persist();
        attempt = 0;
        halted = false;
        if (queue.length) { setStatus('saving'); schedule(0); } else setStatus('saved');
        return;
      }
      const msg = res.error.message || 'Speichern fehlgeschlagen';
      if (online() === false) { setStatus('offline'); throw new Error(msg); }
      if (retryable(res.status)) {
        const wait = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)] * 1000;
        attempt++;
        setStatus('saving', msg);
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
        const have = new Set(queue.map((r) => r.seq));
        for (const ev of list) {
          if (!ev || !Number.isInteger(ev.seq) || have.has(ev.seq)) continue;
          queue.push(toRow(gameId, ev));
          have.add(ev.seq);
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
          if (inflight) { await inflight.catch(() => {}); continue; }
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

    // Server + lokale Warteschlange, nach seq vereinigt (Server gewinnt bei Dublette)
    const bySeq = new Map();
    for (const r of server) bySeq.set(r.seq, toEvent(r));
    for (const e of recorder(gameId).pendingEvents()) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
    const evs = [...bySeq.values()].sort((a, b) => a.seq - b.seq);

    const init = createGame({
      players: players.map((p) => ({ id: p.member_id, name: p.name, seat: p.seat, partner: !!decks[p.deck_id]?.partner_name })),
      startingLife: game.starting_life,
      firstSeat: game.first_seat,
      startedAt: Date.parse(game.started_at),
    });
    const state = replay(init, evs);
    return { game, players, decks, state };
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

  return { startGame, loadGame, recorder, publish, finishGame, liveGames, setFieldColor, setCounterPins };
}
