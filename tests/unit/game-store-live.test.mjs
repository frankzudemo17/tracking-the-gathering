// Spec P4 (Welle ttg-live-feinschliff-decks): Mehrschreiber-Protokoll + Realtime in game-store.js.
// Jeder Fall lädt das Modul selbst per import() (Gegenprobe gegen den Stand ohne Protokoll).
//
// Attrappen-Server (Entscheid 3b): EINE Tabellenmenge für alle Geräte, Unique (game_id, seq),
// `insert` eines Stapels ganz oder gar nicht mit Fehlercode 23505 (HTTP 409), `upsert` mit
// ignoreDuplicates = ON CONFLICT DO NOTHING je Zeile (wie PostgREST — nur für die Gegenprobe).
// Realtime-Hub: jede geschriebene Zeile geht als postgres_changes INSERT an alle verbundenen
// Kanäle, deren Filter passt; games-Updates als UPDATE. Zustellung asynchron (setImmediate)
// oder von Hand (hub.manual = true, hub.flush()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/engine.js';

const load = () => import('../../src/lib/game-store.js');
const GAME = 'g1';
const STARTED = '2026-11-10T20:00:00.000Z';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

// ---------------------------------------------------------------------------
// Uhr, Speicher

function clock() {
  let now = 0; let nextId = 0; let q = [];
  return {
    get now() { return now; },
    get pending() { return q.length; },
    setTimeout(f, ms) { const id = ++nextId; q.push({ id, at: now + Math.max(0, ms || 0), f }); return id; },
    clearTimeout(id) { q = q.filter((t) => t.id !== id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await settle();
        const due = q.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        q = q.filter((t) => t !== due);
        now = due.at;
        due.f();
      }
      now = end;
      await settle();
    },
  };
}

function memStorage() {
  const m = new Map();
  return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

/** EventTarget mit Zählung der online-Listener (A8). */
function eventsTarget() {
  const t = new EventTarget();
  const fns = new Set();
  return {
    get onlineListeners() { return fns.size; },
    addEventListener(type, fn) { if (type === 'online') fns.add(fn); t.addEventListener(type, fn); },
    removeEventListener(type, fn) { if (type === 'online') fns.delete(fn); t.removeEventListener(type, fn); },
    dispatchEvent(ev) { return t.dispatchEvent(ev); },
  };
}

// ---------------------------------------------------------------------------
// Attrappen-Server

const PLAYERS = [{ id: 'A', name: 'Anna', seat: 0, deck: 'dA' }, { id: 'B', name: 'Ben', seat: 1, deck: 'dB' }];

function baseDb() {
  return {
    games: [{ id: GAME, playgroup_id: 'grp', session_id: 's1', status: 'live', layout: 'gegenueber', starting_life: 40, first_seat: 0,
      current_turn: 0, round: 1, live_state: {}, started_at: STARTED, ended_at: null, created_by: 'u1' }],
    game_players: PLAYERS.map((p) => ({ game_id: GAME, member_id: p.id, deck_id: p.deck, seat: p.seat, place: null,
      eliminated_round: null, eliminated_by: null, final_life: null })),
    members: PLAYERS.map((p) => ({ id: p.id, playgroup_id: 'grp', display_name: p.name, avatar_path: null, profile_id: null, claim_code: 'GEHEIM' })),
    decks: PLAYERS.map((p) => ({ id: p.deck, short_name: `K${p.id}`, commander_name: `Cmd ${p.id}`, partner_name: null,
      image_url: `https://img/${p.id}`, partner_image_url: null, color_identity: ['G'], field_color: null, field_mode: 'art', counter_pins: [] })),
    game_events: [],
  };
}

const freshState = () => E.createGame({ players: PLAYERS.map((p) => ({ id: p.id, name: p.name, seat: p.seat, partner: false })), startingLife: 40, firstSeat: 0, startedAt: Date.parse(STARTED) });

const filterFn = (f) => {
  if (!f) return () => true;
  const m = /^(\w+)=eq\.(.+)$/.exec(f);
  assert.ok(m, `Filterform ${f}`);
  return (row) => String(row[m[1]]) === m[2];
};

function fakeServer(db = baseDb()) {
  const tables = db;
  let nextId = tables.game_events.length + 1;
  const hub = { channels: new Set(), manual: false, queued: [] };
  const log = []; // je Schreibversuch: Server-Zeilen (seq, cid) danach
  function deliver(ch, h, msg) {
    const run = () => { if (ch.connected && !ch.removed) h.cb(structuredClone(msg)); };
    if (hub.manual) hub.queued.push(run); else setImmediate(run);
  }
  function broadcast(table, eventType, row) {
    for (const ch of hub.channels) {
      if (!ch.connected) continue;
      for (const h of ch.handlers) {
        if (h.filter.table === table && h.filter.event === eventType && filterFn(h.filter.filter)(row)) {
          deliver(ch, h, { schema: 'public', table, eventType, commit_timestamp: 'x', new: row, old: {}, errors: null });
        }
      }
    }
  }
  function addEvent(row) {
    const r = { id: nextId++, created_at: 'x', ...structuredClone(row) };
    tables.game_events.push(r);
    broadcast('game_events', 'INSERT', r);
    return r;
  }
  const server = {
    tables, hub, log, addEvent, broadcast,
    flush() { const q = hub.queued; hub.queued = []; for (const f of q) f(); },
    /** Zeile eines fremden Geräts (andere cid) direkt auf dem Server. */
    foreign(seq, { target = 'B', amount = -1, type = 'life', payload = {} } = {}) {
      return addEvent({ game_id: GAME, seq, round: 1, type, actor: 'B', source: null, target, amount, payload: { act: seq, cid: `fremd-${seq}`, ...payload } });
    },
    events() { return tables.game_events.filter((e) => e.game_id === GAME && e.seq != null).sort((a, b) => a.seq - b.seq); },
    seqs() { return server.events().map((e) => e.seq); },
    cids() { return server.events().map((e) => e.payload?.cid); },
  };
  return server;
}

class FakeChannel {
  constructor(server, name, sb) { this.server = server; this.name = name; this.sb = sb; this.handlers = []; this.connected = false; this.removed = false; this.statusCb = null; }
  on(type, filter, cb) { assert.equal(type, 'postgres_changes'); this.handlers.push({ filter, cb }); return this; }
  subscribe(cb) {
    this.statusCb = cb;
    this.server.hub.channels.add(this);
    setImmediate(() => { if (!this.removed && this.sb.autoSubscribe !== false) this.setStatus('SUBSCRIBED'); });
    return this;
  }
  setStatus(status, err) { this.connected = status === 'SUBSCRIBED'; this.statusCb?.(status, err); }
  unsubscribe() { this.connected = false; this.removed = true; return Promise.resolve('ok'); }
}

/**
 * Supabase-Attrappe eines Geräts auf dem gemeinsamen Server.
 * plan: Ergebnisse je Schreibaufruf ('ok' · 'lost' · { status, code } · { hang: true }).
 * beforeInsert(rows): läuft vor jedem Schreibversuch (fremdes Gerät schreibt dazwischen).
 */
function deviceSb(server, { plan = [], beforeInsert = null, rpc = {} } = {}) {
  const calls = [];
  const hanging = [];
  const { tables } = server;
  const sb = { calls, hanging, channels: [], removed: [], autoSubscribe: true };

  function insertAll(rows) {
    const seen = new Set();
    for (const r of rows) {
      const key = `${r.game_id}|${r.seq}`;
      const dup = seen.has(key) || tables.game_events.some((e) => e.game_id === r.game_id && e.seq === r.seq);
      if (dup) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "game_events_game_seq_key"' }, status: 409 };
      seen.add(key);
    }
    for (const r of rows) server.addEvent(r);
    return { data: null, error: null, status: 201 };
  }
  function upsertRows(rows, opts) {
    for (const r of rows) {
      const dup = tables.game_events.some((e) => e.game_id === r.game_id && e.seq === r.seq);
      if (dup && opts?.ignoreDuplicates) continue;
      if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' }, status: 409 };
      server.addEvent(r);
    }
    return { data: null, error: null, status: 201 };
  }

  async function exec(q) {
    calls.push({ op: q.op, table: q.table, rows: q.rows && structuredClone(q.rows), opts: q.opts, values: q.values, cols: q.cols, filters: q.desc.slice(), limit: q.limit });
    if (q.op === 'insert' || q.op === 'upsert') {
      if (beforeInsert) beforeInsert(q.rows);
      const plan1 = plan.length ? plan.shift() : 'ok';
      const write = () => {
        const res = q.op === 'insert' ? insertAll(q.rows) : upsertRows(q.rows, q.opts);
        server.log.push({ op: q.op, res: res.error?.code ?? 'ok', after: server.events().map((e) => [e.seq, e.payload?.cid]) });
        return res;
      };
      if (plan1 === 'ok') return write();
      if (plan1 === 'lost') { write(); throw new TypeError('Failed to fetch'); }
      if (plan1.hang) return new Promise((resolve) => hanging.push(() => resolve(write())));
      return { data: null, error: { code: plan1.code ?? '', message: `Fehler ${plan1.status}` }, status: plan1.status };
    }
    if (q.op === 'update') {
      for (const r of tables[q.table].filter((x) => q.filters.every((f) => f(x)))) {
        Object.assign(r, structuredClone(q.values));
        server.broadcast(q.table, 'UPDATE', structuredClone(r));
      }
      return { data: null, error: null, status: 204 };
    }
    let rows = tables[q.table].filter((x) => q.filters.every((f) => f(x)));
    if (q.order) { const [k, asc] = q.order; rows = rows.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1)); }
    if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
    if (q.limit != null) rows = rows.slice(0, q.limit);
    const cols = q.cols && q.cols !== '*' ? q.cols.split(',').map((c) => c.trim()) : null;
    rows = rows.map((r) => structuredClone(cols ? Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])) : r));
    if (q.single) return rows.length === 1 ? { data: rows[0], error: null, status: 200 } : { data: null, error: { code: 'PGRST116', message: 'nicht gefunden' }, status: 406 };
    if (q.maybeSingle) return { data: rows[0] ?? null, error: null, status: 200 };
    return { data: rows, error: null, status: 200 };
  }

  sb.from = (table) => {
    const q = { table, op: 'select', filters: [], desc: [], order: null, range: null, limit: null, single: false };
    const b = {
      select(c) { if (q.op === 'select') q.cols = c; return b; },
      eq(k, v) { q.filters.push((r) => r[k] === v); q.desc.push(`${k}=eq.${v}`); return b; },
      in(k, vs) { q.filters.push((r) => vs.includes(r[k])); q.desc.push(`${k}=in.${vs.join(',')}`); return b; },
      gt(k, v) { q.filters.push((r) => r[k] != null && r[k] > v); q.desc.push(`${k}=gt.${v}`); return b; },
      not(k, op, v) { assert.equal(op, 'is'); assert.equal(v, null); q.filters.push((r) => r[k] != null); q.desc.push(`${k}=not.is.null`); return b; },
      order(k, { ascending = true } = {}) { q.order = [k, ascending]; return b; },
      range(a, z) { q.range = [a, z]; return b; },
      limit(n) { q.limit = n; return b; },
      single() { q.single = true; return b; },
      maybeSingle() { q.maybeSingle = true; return b; },
      update(v) { q.op = 'update'; q.values = v; return b; },
      insert(rows) { q.op = 'insert'; q.rows = rows; return b; },
      upsert(rows, opts) { q.op = 'upsert'; q.rows = rows; q.opts = opts; return b; },
      then(ok, ko) { return exec(q).then(ok, ko); },
    };
    return b;
  };
  sb.rpc = async (name, params) => {
    calls.push({ op: 'rpc', name, params: structuredClone(params) });
    return rpc[name] ? rpc[name](params) : { data: null, error: null, status: 200 };
  };
  sb.channel = (name) => { const ch = new FakeChannel(server, name, sb); sb.channels.push(ch); return ch; };
  sb.removeChannel = (ch) => { sb.removed.push(ch); ch.unsubscribe(); server.hub.channels.delete(ch); return Promise.resolve('ok'); };
  sb.release = () => hanging.shift()();
  sb.writes = () => calls.filter((c) => c.op === 'insert' || c.op === 'upsert');
  sb.inserts = () => calls.filter((c) => c.op === 'insert');
  sb.eventReads = () => calls.filter((c) => c.op === 'select' && c.table === 'game_events');
  return sb;
}

// ---------------------------------------------------------------------------
// Geräte

/** Server mit n Ereignissen (Leben −1 abwechselnd A/B), von einem Gerät mit cid geschrieben. */
function seeded(n) {
  const server = fakeServer();
  let s = freshState();
  for (let i = 0; i < n; i++) {
    const r = E.act(s, { type: 'life', target: PLAYERS[i % 2].id, d: -1 }, { actor: 'A' });
    s = r.state;
    for (const ev of r.events) server.addEvent({ game_id: GAME, ...ev, payload: { ...ev.payload, cid: `srv-${ev.seq}` } });
  }
  return server;
}

async function device(server, t, { sbOpts = {}, online = () => true, events = eventsTarget(), storage = memStorage(), actor = 'A' } = {}) {
  const { createStore } = await load();
  const sb = deviceSb(server, sbOpts);
  const store = createStore(sb, { storage, online, timers: t, events });
  const loaded = await store.loadGame(GAME);
  const dev = { sb, store, storage, events, rec: store.recorder(GAME), state: loaded.state, seen: [], statuses: [] };
  dev.act = (action) => { const r = E.act(dev.state, action, { actor }); dev.state = r.state; dev.rec.push(r.events); return r.events; };
  dev.subscribe = () => {
    dev.unsub = store.subscribe(GAME, (s, info) => { dev.state = s; dev.seen.push(info); }, { onStatus: (st) => dev.statuses.push(st) });
    return dev.unsub;
  };
  return dev;
}

const toEv = (r) => ({ seq: r.seq, round: r.round, type: r.type, actor: r.actor ?? null, source: r.source ?? null, target: r.target ?? null, amount: r.amount ?? null, payload: r.payload ?? {} });
const serverReplay = (server) => E.replay(freshState(), server.events().map(toEv));
const view = (s) => ({
  round: s.round, turn: s.turn,
  players: s.players.map((p) => ({ id: p.id, life: p.life, poison: p.poison, cmd: p.cmd, out: p.out })),
});
const queueOf = (dev) => JSON.parse(dev.storage.getItem(`ttg.queue.${GAME}`) || '[]');

// ---------------------------------------------------------------------------
// A1 · A2 · Stapel

test('A1 zwei Schreiber, je life −1 auf seq 5 ⇒ Server {5,6}, zwei cid, beide saved, pending 0', async () => {
  const server = seeded(4);
  const t = clock();
  const x = await device(server, t);
  const y = await device(server, t, { actor: 'B' });
  assert.equal(x.state.nextSeq, 5);
  assert.equal(y.state.nextSeq, 5);
  const [ex] = x.act({ type: 'life', target: 'A', d: -1 });
  const [ey] = y.act({ type: 'life', target: 'B', d: -1 });
  assert.equal(ex.seq, 5);
  assert.equal(ey.seq, 5);
  await t.advance(5000);
  assert.deepEqual(server.seqs(), [1, 2, 3, 4, 5, 6], 'seq eindeutig und lückenlos');
  const cx = ex.payload?.cid; const cy = ey.payload?.cid;
  assert.ok(typeof cx === 'string' && cx.length >= 16, 'push stempelt cid');
  assert.ok(typeof cy === 'string' && cy !== cx);
  assert.deepEqual(server.cids().slice(4).sort(), [cx, cy].sort(), 'beide Ereignisse auf dem Server');
  assert.deepEqual(x.rec.status, { state: 'saved', pending: 0 });
  assert.deepEqual(y.rec.status, { state: 'saved', pending: 0 });
  // beide Ereignisse wirken: A 40−2−1 = 37, B 40−2−1 = 37
  assert.deepEqual(serverReplay(server).players.map((p) => p.life), [37, 37]);
});

test('A1b zwei Handys offline, gleichzeitig online ⇒ beide Stapel vollständig, Reihenfolge je Gerät erhalten', async () => {
  const server = seeded(2);
  const t = clock();
  let on = false;
  const tx = eventsTarget(); const ty = eventsTarget();
  const x = await device(server, t, { online: () => on, events: tx });
  const y = await device(server, t, { online: () => on, events: ty, actor: 'B' });
  const xs = [...x.act({ type: 'life', target: 'A', d: -1 }), ...x.act({ type: 'life', target: 'A', d: -2 })];
  const ys = [...y.act({ type: 'life', target: 'B', d: -3 }), ...y.act({ type: 'poison', target: 'A', d: 1 })];
  await t.advance(2000);
  assert.equal(x.sb.writes().length + y.sb.writes().length, 0, 'offline kein Schreiben');
  on = true;
  tx.dispatchEvent(new Event('online')); ty.dispatchEvent(new Event('online'));
  await t.advance(5000);
  assert.deepEqual(server.seqs(), [1, 2, 3, 4, 5, 6]);
  const order = server.cids();
  const pos = (ev) => order.indexOf(ev.payload.cid);
  assert.ok(xs.every((e) => pos(e) >= 0) && ys.every((e) => pos(e) >= 0), 'kein Ereignis verloren');
  assert.ok(pos(xs[0]) < pos(xs[1]) && pos(ys[0]) < pos(ys[1]), 'Reihenfolge je Gerät erhalten');
  assert.equal(x.rec.status.state, 'saved');
  assert.equal(y.rec.status.state, 'saved');
});

test('A2 Antwort des ersten Schreibens geht verloren, Zeile ist auf dem Server ⇒ kein Umnummerieren, keine Dublette, saved', async () => {
  const server = seeded(4);
  const t = clock();
  const x = await device(server, t, { sbOpts: { plan: ['lost'] } });
  const [ev] = x.act({ type: 'life', target: 'A', d: -1 });
  await t.advance(300);
  assert.equal(x.sb.inserts().length, 1);
  assert.equal(x.rec.status.pending, 1, 'ohne Antwort bleibt das Ereignis ausstehend');
  await t.advance(5000);
  assert.deepEqual(server.seqs(), [1, 2, 3, 4, 5], 'genau eine Server-Zeile, keine Dublette');
  assert.equal(server.events()[4].payload.cid, ev.payload.cid);
  assert.ok(x.sb.inserts().every((c) => c.rows.length === 1 && c.rows[0].seq === 5), '0 Umnummerierungen: immer seq 5');
  assert.equal(x.sb.inserts().length, 2, 'eine Wiederholung, dann bestätigt');
  assert.deepEqual(x.rec.status, { state: 'saved', pending: 0 });
  assert.deepEqual(queueOf(x), []);
});

test('Stapel 5,6,7 + fremde Zeile auf 5 ⇒ Server 5 fremd, 6,7,8 eigen in Reihenfolge; kein Zwischenstand mit eigener 6', async () => {
  const server = seeded(4);
  const t = clock();
  let first = true;
  const x = await device(server, t, { sbOpts: { beforeInsert: () => { if (first) { first = false; server.foreign(5); } } } });
  const evs = [
    ...x.act({ type: 'life', target: 'A', d: -1 }),
    ...x.act({ type: 'life', target: 'B', d: -2 }),
    ...x.act({ type: 'life', target: 'A', d: -3 }),
  ];
  assert.deepEqual(evs.map((e) => e.seq), [5, 6, 7]);
  await t.advance(5000);
  assert.deepEqual(server.seqs(), [1, 2, 3, 4, 5, 6, 7, 8]);
  const rows = server.events();
  assert.equal(rows[4].payload.cid, 'fremd-5');
  assert.deepEqual(rows.slice(5).map((r) => r.payload.cid), evs.map((e) => e.payload.cid), 'eigene Reihenfolge erhalten');
  assert.deepEqual(rows.slice(5).map((r) => r.amount), [-1, -2, -3]);
  const firstWrite = server.log[0];
  assert.equal(firstWrite.res, '23505', 'erster Schreibversuch scheitert als Ganzes');
  assert.deepEqual(firstWrite.after.map(([s]) => s), [1, 2, 3, 4, 5], 'kein Zwischenstand mit eigener 6 oder 7');
  assert.deepEqual(x.rec.status, { state: 'saved', pending: 0 });
});

// ---------------------------------------------------------------------------
// A3 · A3b Undo zieht mit, veralteter Aufrufer

test('A3 Undo zieht mit: life (5) + undo(payload.seq 5), Konflikt auf 5 ⇒ 6/7, undo.payload.seq 6', async () => {
  const server = seeded(4);
  const t = clock();
  let first = true;
  const x = await device(server, t, { sbOpts: { beforeInsert: () => { if (first) { first = false; server.foreign(5); } } } });
  const [life] = x.act({ type: 'life', target: 'A', d: -5 });
  const [undo] = x.act({ type: 'undo' });
  assert.equal(life.seq, 5);
  assert.equal(undo.type, 'undo');
  assert.equal(undo.payload.seq, 5);
  await t.advance(5000);
  const rows = server.events();
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(rows[5].payload.cid, life.payload.cid);
  assert.equal(rows[6].payload.cid, undo.payload.cid);
  assert.equal(rows[6].type, 'undo');
  assert.equal(rows[6].payload.seq, 6, 'undo zeigt auf die neue seq seines Ereignisses');
  // Wirkung: fremdes −1 auf B bleibt, eigenes −5 auf A ist rückgängig
  assert.deepEqual(serverReplay(server).players.map((p) => p.life), [38, 37]);
});

test('A3 Undo auf eine Server-seq bleibt unverändert, Undo auf eigene Zeile zieht mit', async () => {
  const server = seeded(4);
  const t = clock();
  let first = true;
  const x = await device(server, t, { sbOpts: { beforeInsert: () => { if (first) { first = false; server.foreign(5); } } } });
  const [u1] = x.act({ type: 'undo' }); // macht Server-Ereignis seq 4 rückgängig
  assert.equal(u1.seq, 5);
  assert.equal(u1.payload.seq, 4);
  const [life] = x.act({ type: 'life', target: 'A', d: -7 });
  const [u2] = x.act({ type: 'undo' });
  assert.deepEqual([life.seq, u2.seq, u2.payload.seq], [6, 7, 6]);
  await t.advance(5000);
  const rows = server.events();
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(rows.slice(5).map((r) => r.payload.cid), [u1, life, u2].map((e) => e.payload.cid));
  assert.equal(rows[5].payload.seq, 4, 'Undo auf Server-seq 4 unverändert');
  assert.equal(rows[7].payload.seq, 7, 'Undo auf eigene Zeile 6 → 7 mitgezogen');
});

test('A3b veralteter Aufrufer: nach Umnummerieren 5→7 pusht er seq 6 + undo(payload.seq 5) ⇒ 8/9, undo.payload.seq 7; Server lückenlos', async () => {
  const server = seeded(4);
  const t = clock();
  let first = true;
  const x = await device(server, t, { sbOpts: { beforeInsert: () => { if (first) { first = false; server.foreign(5); server.foreign(6); } } } });
  const stale0 = x.state;
  const [life5] = x.act({ type: 'life', target: 'A', d: -5 });
  const staleState = x.state; // Aufrufer übernimmt den neuen Zustand NICHT
  await t.advance(5000);
  assert.deepEqual(server.seqs(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(server.events()[6].payload.cid, life5.payload.cid, 'eigene 5 → 7');
  // veralteter Aufrufer: nächstes Ereignis mit seq 6, Undo zeigt auf seine alte 5
  const { events: [life6] } = E.act(staleState, { type: 'life', target: 'B', d: -2 }, { actor: 'A' });
  assert.equal(life6.seq, 6);
  const undo = { seq: 7, round: 1, type: 'undo', actor: 'A', source: null, target: null, amount: null, payload: { seq: 5, act: 7 } };
  x.rec.push([life6, undo]);
  await t.advance(5000);
  const rows = server.events();
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'lückenlos');
  assert.equal(rows[7].payload.cid, life6.payload.cid);
  assert.equal(rows[8].type, 'undo');
  assert.equal(rows[8].payload.seq, 7, 'undo.payload.seq über die Abbildung übersetzt');
  const conflicts = server.log.filter((l) => l.res === '23505').length;
  assert.equal(conflicts, 1, 'keine 23505-Schleife: nur der erste Konflikt');
  assert.deepEqual(x.rec.status, { state: 'saved', pending: 0 });
  // frischer Aufrufer (neuer Zustand): Undo auf die FREMDE Server-seq 5 bleibt 5
  const fresh = await device(server, t);
  void stale0;
  const undoForeign = { seq: fresh.state.nextSeq, round: 1, type: 'undo', actor: 'A', source: null, target: null, amount: null, payload: { seq: 5, act: 99 } };
  x.rec.push([undoForeign]);
  await t.advance(5000);
  const last = server.events().at(-1);
  assert.equal(last.seq, 10);
  assert.equal(last.payload.seq, 5, 'nicht veraltet ⇒ keine Übersetzung');
});

// ---------------------------------------------------------------------------
// A4 Gleicher Endzustand
//
// Aktionsliste (Startleben 40, zwei Spieler A = Spieler 1, B = Spieler 2), je Runde
// tippen beide Geräte gleichzeitig (gleiche seq ⇒ Konflikt):
//   Runde 1: X life A −1        · Y life B −1
//   Runde 2: X Angriff A→B Commander 1 · Y Gift A +1
//   Runde 3: X Zug beenden      · Y life A −2
// Erwartung von Hand: A = 40 − 1 − 2 = 37, B = 40 − 1 − 1 = 38, Gift A = 1,
// Commander-Schaden auf B von A = 1, Zug bei Sitz 1, Runde 1.

test('A4 gleicher Endzustand: zwei Geräte, je 3 Aktionen verschränkt mit Konflikten ⇒ subscribe-Zustände deepEqual und = Server-Replay', async () => {
  const server = seeded(0);
  const t = clock();
  const x = await device(server, t);
  const y = await device(server, t, { actor: 'B' });
  x.subscribe(); y.subscribe();
  await t.advance(0);
  const rounds = [
    [{ type: 'life', target: 'A', d: -1 }, { type: 'life', target: 'B', d: -1 }],
    [{ type: 'attack', from: 'A', to: ['B'], kind: 'cmd', amount: 1 }, { type: 'poison', target: 'A', d: 1 }],
    [{ type: 'endTurn', at: Date.parse(STARTED) + 30_000 }, { type: 'life', target: 'A', d: -2 }],
  ];
  for (const [ax, ay] of rounds) {
    const a = x.act(ax); const b = y.act(ay);
    assert.equal(a[0].seq, b[0].seq, 'gleiche seq ⇒ Konflikt');
    await t.advance(3000);
  }
  await t.advance(10_000);
  assert.equal(server.seqs().length, 6);
  assert.deepEqual(server.seqs(), [1, 2, 3, 4, 5, 6]);
  const want = serverReplay(server);
  assert.deepEqual(view(x.state), view(y.state));
  assert.deepEqual(x.state, y.state, 'beide Geräte: vollständig gleicher Zustand');
  assert.deepEqual(x.state, want, 'gleich replay(init, Server-Ereignisse)');
  assert.deepEqual(want.players.map((p) => p.life), [37, 38]);
  assert.equal(want.players[0].poison, 1);
  assert.equal(want.players[1].cmd.A, 1);
  assert.equal(want.round, 1);
  assert.equal(want.turn, 1);
  const reasons = new Set([...x.seen, ...y.seen].map((i) => i.reason));
  assert.ok(reasons.has('rebase'), 'mindestens eine Umnummerierung');
  assert.ok(reasons.has('remote'), 'Fremd-Ereignisse per Realtime');
  assert.equal(x.rec.status.state, 'saved');
  assert.equal(y.rec.status.state, 'saved');
});

// ---------------------------------------------------------------------------
// A5 Nachholen

test('A5 Nachholen: offline, 4 Fremd-Ereignisse, online ⇒ genau ein Nachhol-Lesen ab höchster seq, reason catchup, keine Dubletten', async () => {
  const server = seeded(3);
  const t = clock();
  let on = true;
  const target = eventsTarget();
  const d = await device(server, t, { online: () => on, events: target });
  const w = await device(server, t, { actor: 'B' });
  d.subscribe();
  await t.advance(0);
  const ch = d.sb.channels[0];
  assert.ok(ch.connected);
  // offline: Kanal bricht ab
  on = false;
  ch.setStatus('CHANNEL_ERROR', new Error('weg'));
  assert.ok(d.statuses.includes('CHANNEL_ERROR'), 'Status sichtbar über onStatus');
  for (let i = 0; i < 4; i++) w.act({ type: 'life', target: 'B', d: -1 });
  await t.advance(3000);
  assert.deepEqual(server.seqs(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(d.state.events.length, 3, 'offline nichts empfangen');
  const readsBefore = d.sb.eventReads().length;
  d.seen.length = 0;
  on = true;
  target.dispatchEvent(new Event('online'));
  await t.advance(0);
  const reads = d.sb.eventReads().slice(readsBefore);
  assert.equal(reads.length, 1, 'genau ein Nachhol-Lesen');
  assert.ok(reads[0].filters.includes('seq=gt.3'), `ab höchster bekannter seq: ${reads[0].filters}`);
  assert.deepEqual(d.seen.map((i) => i.reason), ['catchup']);
  assert.equal(d.seen[0].game.id, GAME);
  assert.deepEqual(d.state.events.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7]);
  // dieselbe Zeile kommt zusätzlich per Realtime
  ch.connected = true;
  const h = ch.handlers.find((x) => x.filter.table === 'game_events');
  h.cb({ schema: 'public', table: 'game_events', eventType: 'INSERT', new: structuredClone(server.events()[5]), old: {} });
  await t.advance(0);
  assert.deepEqual(d.state.events.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7], 'keine Dublette');
  assert.deepEqual(d.seen.map((i) => i.reason), ['catchup'], 'kein weiteres onState für bekannte Zeile');
  assert.deepEqual(d.state, serverReplay(server));
});

test('A5b Kanal-Fehler ⇒ Nachholen beim nächsten SUBSCRIBED; Abonnement vor dem ersten Ereignis', async () => {
  const server = seeded(0);
  const t = clock();
  const d = await device(server, t);
  const w = await device(server, t, { actor: 'B' });
  d.subscribe();
  await t.advance(0);
  assert.deepEqual(d.seen, [], 'leeres Spiel: kein onState ohne Ereignis');
  const ch = d.sb.channels[0];
  ch.setStatus('TIMED_OUT');
  assert.deepEqual(d.statuses.slice(-1), ['TIMED_OUT']);
  w.act({ type: 'life', target: 'A', d: -4 });
  await t.advance(1000);
  assert.equal(d.state.events.length, 0);
  ch.setStatus('SUBSCRIBED');
  await t.advance(0);
  assert.deepEqual(d.seen.map((i) => i.reason), ['catchup']);
  assert.equal(d.state.players[0].life, 36);
  // danach: Realtime-Ereignis ⇒ remote
  w.act({ type: 'life', target: 'A', d: -1 });
  await t.advance(1000);
  assert.deepEqual(d.seen.map((i) => i.reason), ['catchup', 'remote']);
  assert.equal(d.state.players[0].life, 35);
});

// ---------------------------------------------------------------------------
// A6 Begrenzung

test('A6 jede Schreibung kollidiert ⇒ nach 5 Umnummerierungen error, Warteschlange persistiert, kein Versuch ohne flush()', async () => {
  const server = seeded(4);
  const t = clock();
  const x = await device(server, t, {
    sbOpts: { beforeInsert: (rows) => { const s = Math.min(...rows.map((r) => r.seq)); if (!server.seqs().includes(s)) server.foreign(s); } },
  });
  const [ev] = x.act({ type: 'life', target: 'A', d: -1 });
  await t.advance(300);
  await t.advance(1000);
  assert.equal(x.sb.inserts().length, 6, 'erster Versuch + 5 nach je einer Umnummerierung');
  assert.equal(x.rec.status.state, 'error');
  assert.match(x.rec.status.error, /Konflikt nicht auflösbar/);
  assert.equal(x.rec.status.pending, 1);
  const q = queueOf(x);
  assert.equal(q.length, 1, 'Warteschlange persistiert');
  assert.equal(q[0].payload.cid, ev.payload.cid, 'dasselbe Ereignis');
  assert.equal(q[0].amount, -1);
  await t.advance(60_000);
  assert.equal(x.sb.inserts().length, 6, 'kein weiterer Versuch');
  assert.equal(t.pending, 0);
  await assert.rejects(x.rec.flush(), /Konflikt nicht auflösbar/);
  assert.ok(x.sb.inserts().length > 6, 'flush() versucht es erneut');
});

// ---------------------------------------------------------------------------
// A8 Aufräumen

test('A8 unsubscribe ⇒ removeChannel, keine onState danach, online-Listener entfernt', async () => {
  const server = seeded(1);
  const t = clock();
  const target = eventsTarget();
  const d = await device(server, t, { events: target });
  const w = await device(server, t, { actor: 'B' });
  const before = target.onlineListeners;
  const unsub = d.subscribe();
  await t.advance(0);
  assert.equal(target.onlineListeners, before + 1, 'Abonnement hört auf online');
  assert.equal(d.sb.channels.length, 1);
  assert.equal(d.sb.channels[0].name, `game:${GAME}`);
  const filters = d.sb.channels[0].handlers.map((h) => h.filter);
  assert.deepEqual(filters, [
    { event: 'INSERT', schema: 'public', table: 'game_events', filter: `game_id=eq.${GAME}` },
    { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${GAME}` },
  ]);
  w.act({ type: 'life', target: 'A', d: -1 });
  await t.advance(1000);
  assert.equal(d.seen.length, 1);
  unsub();
  assert.deepEqual(d.sb.removed, [d.sb.channels[0]], 'removeChannel mit dem Kanal');
  assert.equal(target.onlineListeners, before, 'online-Listener entfernt');
  const reads = d.sb.eventReads().length;
  w.act({ type: 'life', target: 'A', d: -1 });
  await t.advance(1000);
  target.dispatchEvent(new Event('online'));
  const h = d.sb.channels[0].handlers[0];
  h.cb({ schema: 'public', table: 'game_events', eventType: 'INSERT', new: structuredClone(server.events().at(-1)), old: {} });
  d.sb.channels[0].statusCb('SUBSCRIBED');
  await t.advance(1000);
  assert.equal(d.seen.length, 1, 'keine onState-Aufrufe nach unsubscribe');
  assert.equal(d.sb.eventReads().length, reads, 'kein Nachholen nach unsubscribe');
  assert.doesNotThrow(() => unsub(), 'zweimal abmelden schadet nicht');
});

// ---------------------------------------------------------------------------
// Weitere Fälle (Negativraum)

test('Status: games UPDATE mit Statuswechsel ⇒ onState reason status mit game; live_state-Update allein ⇒ nichts', async () => {
  const server = seeded(1);
  const t = clock();
  const d = await device(server, t);
  const w = await device(server, t, { actor: 'B' });
  d.subscribe();
  await t.advance(0);
  w.store.publish(GAME, w.state);
  await t.advance(2000);
  assert.deepEqual(d.seen, [], 'nur live_state geändert');
  server.tables.games[0].status = 'finished';
  server.broadcast('games', 'UPDATE', structuredClone(server.tables.games[0]));
  await t.advance(0);
  assert.deepEqual(d.seen.map((i) => i.reason), ['status']);
  assert.equal(d.seen[0].game.status, 'finished');
});

test('Eigenes Echo per Realtime ⇒ kein onState remote, keine Dublette', async () => {
  const server = seeded(2);
  const t = clock();
  const d = await device(server, t);
  d.subscribe();
  await t.advance(0);
  d.act({ type: 'life', target: 'A', d: -3 });
  await t.advance(2000);
  assert.deepEqual(server.seqs(), [1, 2, 3]);
  assert.deepEqual(d.seen, [], 'eigenes Ereignis kommt zurück, ändert nichts');
  assert.deepEqual(d.state.events.map((e) => e.seq), [1, 2, 3]);
});

test('Echo kommt VOR der Schreib-Antwort an ⇒ trotzdem keine Dublette, saved', async () => {
  const server = seeded(2);
  const t = clock();
  const d = await device(server, t, { sbOpts: { plan: [{ hang: true }] } });
  d.subscribe();
  await t.advance(0);
  const [ev] = d.act({ type: 'life', target: 'A', d: -3 });
  await t.advance(300);
  // Server hat die Zeile (fremder Weg), Antwort hängt noch
  server.addEvent({ game_id: GAME, ...structuredClone(ev) });
  await t.advance(0);
  assert.deepEqual(d.seen, []);
  d.sb.release();
  await t.advance(2000);
  assert.deepEqual(d.rec.status, { state: 'saved', pending: 0 });
  assert.deepEqual(d.state.events.map((e) => e.seq), [1, 2, 3]);
});

test('Gleiches Ereignis zweimal gepusht (gleiche cid) ⇒ einmal gespeichert', async () => {
  const server = seeded(1);
  const t = clock();
  const d = await device(server, t);
  const evs = d.act({ type: 'life', target: 'A', d: -1 });
  d.rec.push(evs);
  await t.advance(2000);
  d.rec.push(evs);
  await t.advance(2000);
  assert.deepEqual(server.seqs(), [1, 2]);
});

test('Alte Warteschlange ohne cid ⇒ vor dem Senden nachgestempelt und persistiert; Laden wie bisher', async () => {
  const server = seeded(2);
  const t = clock();
  const storage = memStorage();
  let s = E.replay(freshState(), server.events().map(toEv));
  const legacy = [];
  for (const d of [-1, -2]) { const r = E.act(s, { type: 'life', target: 'B', d }, { actor: 'A' }); s = r.state; legacy.push(...r.events); }
  storage.setItem(`ttg.queue.${GAME}`, JSON.stringify(legacy.map((e) => ({ game_id: GAME, ...e }))));
  assert.ok(legacy.every((e) => !('cid' in e.payload)));
  const d = await device(server, t, { storage });
  assert.deepEqual(d.state.events.map((e) => e.seq), [1, 2, 3, 4]);
  await t.advance(2000);
  const sent = d.sb.inserts()[0].rows;
  assert.ok(sent.every((r) => typeof r.payload.cid === 'string' && r.payload.cid.length >= 16), 'nachgestempelt');
  assert.deepEqual(server.seqs(), [1, 2, 3, 4]);
  assert.deepEqual(d.rec.status, { state: 'saved', pending: 0 });
});

test('Alte Warteschlange ohne cid, Server hat dieselbe seq ohne cid (frühere Version) ⇒ bestätigt, nicht doppelt', async () => {
  const server = seeded(2);
  const t = clock();
  const storage = memStorage();
  const r = E.act(E.replay(freshState(), server.events().map(toEv)), { type: 'life', target: 'B', d: -1 }, { actor: 'A' });
  const ev = r.events[0];
  server.addEvent({ game_id: GAME, ...structuredClone(ev) }); // alte Version: geschrieben, Antwort verloren
  storage.setItem(`ttg.queue.${GAME}`, JSON.stringify([{ game_id: GAME, ...ev }]));
  const d = await device(server, t, { storage });
  await t.advance(3000);
  assert.deepEqual(server.seqs(), [1, 2, 3]);
  assert.deepEqual(d.rec.status, { state: 'saved', pending: 0 });
});

test('Laden: eigene ausstehende Zeile auf einer seq mit FREMDER cid ⇒ umnummeriert statt verworfen', async () => {
  const server = seeded(2);
  const t = clock();
  const storage = memStorage();
  const r = E.act(E.replay(freshState(), server.events().map(toEv)), { type: 'life', target: 'A', d: -9 }, { actor: 'A' });
  const mine = { game_id: GAME, ...r.events[0], payload: { ...r.events[0].payload, cid: 'meine-3' } };
  storage.setItem(`ttg.queue.${GAME}`, JSON.stringify([mine]));
  server.foreign(3);
  const d = await device(server, t, { storage });
  assert.deepEqual(d.state.events.map((e) => [e.seq, e.payload.cid]), [[1, 'srv-1'], [2, 'srv-2'], [3, 'fremd-3'], [4, 'meine-3']]);
  assert.equal(d.state.nextSeq, 5);
  await t.advance(3000);
  assert.deepEqual(server.cids(), ['srv-1', 'srv-2', 'fremd-3', 'meine-3']);
  assert.equal(server.log.filter((l) => l.res === '23505').length, 0, 'kein Konflikt mehr beim Senden');
});

test('Nach Umnummerieren veröffentlicht der Store den neuen Zustand selbst (live_state)', async () => {
  const server = seeded(4);
  const t = clock();
  let first = true;
  const x = await device(server, t, { sbOpts: { beforeInsert: () => { if (first) { first = false; server.foreign(5, { target: 'B', amount: -10 }); } } } });
  x.subscribe();
  await t.advance(0);
  x.act({ type: 'life', target: 'A', d: -1 });
  await t.advance(5000);
  const ls = server.tables.games[0].live_state;
  assert.deepEqual(ls.players.map((p) => p.life), [37, 28], 'live_state = Zustand nach Umnummerieren');
  assert.ok(x.seen.some((i) => i.reason === 'rebase'));
  assert.equal(x.state.nextSeq, 7, 'onState liefert nextSeq nach dem Umnummerieren');
});

test('Konflikt-Lesen scheitert ⇒ Backoff wie bisher, danach aufgelöst', async () => {
  const server = seeded(4);
  const t = clock();
  let first = true;
  const x = await device(server, t, { sbOpts: { beforeInsert: () => { if (first) { first = false; server.foreign(5); } } } });
  const orig = x.sb.from;
  let failRead = true;
  x.sb.from = (table) => {
    const b = orig(table);
    if (table !== 'game_events') return b;
    const gt = b.gt; const then = b.then; let bySeq = false;
    b.gt = (k, v) => { if (k === 'seq') bySeq = true; return gt(k, v); };
    b.then = (ok, ko) => {
      if (bySeq && failRead) { failRead = false; return Promise.resolve({ data: null, error: { message: 'Netz weg' }, status: 0 }).then(ok, ko); }
      return then(ok, ko);
    };
    return b;
  };
  x.act({ type: 'life', target: 'A', d: -1 });
  await t.advance(300);
  assert.equal(x.rec.status.state, 'saving');
  assert.equal(x.rec.status.error, 'Netz weg');
  await t.advance(999);
  assert.equal(x.sb.inserts().length, 1, 'Wiederholung nicht vor 1 s');
  await t.advance(5000);
  assert.deepEqual(server.seqs(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(x.rec.status, { state: 'saved', pending: 0 });
});
