// Spec P5: Spiel-Datenschicht. Jeder Fall lädt das Modul selbst per import() — so bleibt die
// Datei auch ohne src/lib/game-store.js ladbar und jeder Fall schlägt einzeln fehl (Gegenprobe).
// Attrappen: Fake-sb (zeichnet Aufrufe auf, steuerbare upsert-Ergebnisse), Fake-storage (Map),
// injizierte Uhr (advance(ms) leert Mikrotasks zwischen den Timern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../../src/game/engine.js';

const load = () => import('../../src/lib/game-store.js');
const GAME = 'g1';

// ---------------------------------------------------------------------------
// Attrappen

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

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

function memStorage({ throws = false } = {}) {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (throws) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/**
 * Fake-Supabase. `upserts`: Liste der Ergebnisse je Schreibaufruf (danach 'ok'):
 *   'ok' · { status, code } (Fehler) · 'lost' (speichert, wirft dann) · { hang: true } (wartet auf release()).
 * Seit P4 (Welle ttg-live-feinschliff-decks) schreibt der Store per insert: ein Stapel ganz oder
 * gar nicht, Unique (game_id, seq) ⇒ { code: '23505' }, HTTP 409 (wie PostgREST).
 */
function fakeSb(db = {}, { upserts = [], rpc = {} } = {}) {
  const tables = { games: [], game_players: [], members: [], decks: [], game_events: [], ...db };
  const calls = [];
  const hanging = [];
  const store = (rows) => {
    const keys = rows.map((r) => `${r.game_id}|${r.seq}`);
    const dup = new Set(keys).size !== keys.length
      || rows.some((r) => tables.game_events.some((e) => e.game_id === r.game_id && e.seq === r.seq));
    if (dup) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "game_events_game_seq_key"' }, status: 409 };
    for (const r of rows) tables.game_events.push({ id: tables.game_events.length + 1, created_at: 'x', ...structuredClone(r) });
    return { data: null, error: null, status: 201 };
  };
  async function exec(q) {
    calls.push({ op: q.op, table: q.table, rows: q.rows && q.rows.map((r) => ({ ...r })), opts: q.opts, values: q.values, cols: q.cols });
    if (q.op === 'insert') {
      const plan = upserts.length ? upserts.shift() : 'ok';
      if (plan === 'ok') return store(q.rows);
      if (plan === 'lost') { store(q.rows); throw new TypeError('Failed to fetch'); }
      if (plan.hang) {
        return new Promise((resolve) => hanging.push(() => { resolve(store(q.rows)); }));
      }
      return { data: null, error: { code: plan.code ?? '', message: `Fehler ${plan.status}` }, status: plan.status };
    }
    if (q.op === 'update') {
      for (const r of tables[q.table].filter((x) => q.filters.every((f) => f(x)))) Object.assign(r, q.values);
      return { data: null, error: null, status: 204 };
    }
    let rows = tables[q.table].filter((x) => q.filters.every((f) => f(x)));
    if (q.order) { const [k, asc] = q.order; rows = rows.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1)); }
    if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
    const cols = q.cols && q.cols !== '*' ? q.cols.split(',').map((c) => c.trim()) : null;
    rows = rows.map((r) => structuredClone(cols ? Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])) : r));
    if (q.single) return rows.length === 1 ? { data: rows[0], error: null, status: 200 } : { data: null, error: { code: 'PGRST116', message: 'nicht gefunden' }, status: 406 };
    return { data: rows, error: null, status: 200 };
  }
  function from(table) {
    const q = { table, op: 'select', filters: [], order: null, range: null, single: false };
    const b = {
      select(c) { if (q.op === 'select') q.cols = c; return b; },
      eq(k, v) { q.filters.push((r) => r[k] === v); return b; },
      in(k, vs) { q.filters.push((r) => vs.includes(r[k])); return b; },
      not(k, op, v) { assert.equal(op, 'is'); assert.equal(v, null); q.filters.push((r) => r[k] != null); return b; },
      gt(k, v) { q.filters.push((r) => r[k] != null && r[k] > v); return b; },
      order(k, { ascending = true } = {}) { q.order = [k, ascending]; return b; },
      range(a, z) { q.range = [a, z]; return b; },
      single() { q.single = true; return b; },
      update(v) { q.op = 'update'; q.values = v; return b; },
      insert(rows, opts) { q.op = 'insert'; q.rows = rows; q.opts = opts; return b; },
      then(ok, ko) { return exec(q).then(ok, ko); },
    };
    return b;
  }
  return {
    tables, calls, hanging,
    release() { hanging.shift()(); },
    upserts: () => calls.filter((c) => c.op === 'insert'), // Schreibaufrufe (seit P4 insert)
    updates: () => calls.filter((c) => c.op === 'update'),
    rpcs: (name) => calls.filter((c) => c.op === 'rpc' && (!name || c.name === name)),
    from,
    async rpc(name, params) {
      calls.push({ op: 'rpc', name, params: structuredClone(params) });
      return rpc[name] ? rpc[name](params) : { data: null, error: null, status: 200 };
    },
  };
}

// ---------------------------------------------------------------------------
// Spielaufbau (Ereignisse aus der echten Engine)

const PLAYERS = [
  { id: 'A', name: 'Anna', seat: 0, deck: 'dA' },
  { id: 'B', name: 'Ben', seat: 1, deck: 'dB' },
  { id: 'C', name: 'Cem', seat: 2, deck: 'dC' },
  { id: 'D', name: 'Dana', seat: 3, deck: 'dD', partner: 'Partnerin' },
];
const STARTED = '2026-11-09T20:00:00.000Z';

function serverDb(events = []) {
  return {
    games: [{ id: GAME, playgroup_id: 'grp', session_id: 's1', status: 'live', layout: 'seiten', starting_life: 40, first_seat: 0,
      current_turn: 0, round: 1, live_state: { v: 1, round: 99, bogus: true }, started_at: STARTED, ended_at: null, created_by: 'u1' }],
    game_players: PLAYERS.map((p) => ({ game_id: GAME, member_id: p.id, deck_id: p.deck, seat: p.seat, place: null,
      eliminated_round: null, eliminated_by: null, final_life: null })),
    members: PLAYERS.map((p) => ({ id: p.id, playgroup_id: 'grp', display_name: p.name, avatar_path: null, profile_id: null })),
    decks: PLAYERS.map((p) => ({ id: p.deck, short_name: `K${p.id}`, commander_name: `Cmd ${p.id}`, partner_name: p.partner ?? null,
      image_url: `https://img/${p.id}`, partner_image_url: null, color_identity: ['G'], field_color: null, field_mode: 'art', counter_pins: ['poison', 'tax'] })),
    game_events: events.map((e, i) => ({ id: i + 1, game_id: GAME, created_at: 'x', ...structuredClone(e) })),
  };
}

function freshState() {
  return E.createGame({
    players: PLAYERS.map((p) => ({ id: p.id, name: p.name, seat: p.seat, partner: !!p.partner })),
    startingLife: 40, firstSeat: 0, startedAt: Date.parse(STARTED),
  });
}

/** Führt Aktionen aus, liefert { state, events }. */
function play(actions, from = freshState()) {
  let s = from; const all = [];
  for (const a of actions) { const r = E.act(s, a, { actor: 'A' }); s = r.state; all.push(...r.events); }
  return { state: s, events: all };
}

const lifeTaps = (n) => Array.from({ length: n }, (_, i) => ({ type: 'life', target: PLAYERS[i % 4].id, d: -1 }));
const seqs = (call) => call.rows.map((r) => r.seq);

async function setup({ db = {}, upserts, rpc, storage = memStorage(), online = () => true } = {}) {
  const { createStore } = await load();
  const sb = fakeSb(db, { upserts, rpc });
  const t = clock();
  const store = createStore(sb, { storage, online, timers: t, events: null });
  return { sb, t, store, storage, createStore };
}

// ---------------------------------------------------------------------------
// Warteschlange

test('G1 Reihenfolge + Bündeln: 3 push in 100 ms ⇒ genau 1 upsert [1,2,3] nach 300 ms', async () => {
  const { sb, t, store } = await setup();
  const { events } = play(lifeTaps(3));
  const rec = store.recorder(GAME);
  rec.push([events[0]]); await t.advance(50);
  rec.push([events[1]]); await t.advance(50);
  rec.push([events[2]]);
  await t.advance(199);
  assert.equal(sb.upserts().length, 0, 'vor 300 ms nach dem ersten push kein upsert');
  await t.advance(1);
  assert.equal(sb.upserts().length, 1);
  const u = sb.upserts()[0];
  assert.deepEqual(seqs(u), [1, 2, 3]);
  assert.equal(u.table, 'game_events');
  assert.equal(u.op, 'insert', 'insert statt upsert(ignoreDuplicates) (Spec P4 Entscheid 2)');
  assert.equal(u.opts, undefined);
  assert.deepEqual(Object.keys(u.rows[0]).sort(), ['actor', 'amount', 'game_id', 'payload', 'round', 'seq', 'source', 'target', 'type']);
  assert.equal(u.rows[0].game_id, GAME);
  await t.advance(5000);
  assert.equal(sb.upserts().length, 1, 'kein weiterer Schreibvorgang bei leerer Liste');
  assert.equal(t.pending, 0, 'keine Timer nach leerer Liste');
  assert.deepEqual(rec.status, { state: 'saved', pending: 0 });
});

test('G2 ein Schreibvorgang gleichzeitig: zweiter upsert erst nach Ende des ersten, nur [4]', async () => {
  const { sb, t, store } = await setup({ upserts: [{ hang: true }] });
  const { events } = play(lifeTaps(4));
  const rec = store.recorder(GAME);
  rec.push(events.slice(0, 3));
  await t.advance(300);
  assert.equal(sb.upserts().length, 1);
  rec.push([events[3]]);
  await t.advance(5000);
  assert.equal(sb.upserts().length, 1, 'kein zweiter upsert, solange der erste hängt');
  assert.equal(rec.status.state, 'saving');
  sb.release();
  await t.advance(300);
  assert.equal(sb.upserts().length, 2);
  assert.deepEqual(seqs(sb.upserts()[1]), [4]);
  assert.equal(rec.status.pending, 0);
  assert.equal(rec.status.state, 'saved');
});

test('G3 Wiederholung: 2× 503 ⇒ 3. Versuch nach 1 s + 2 s, dann pending 0, saved', async () => {
  const { sb, t, store } = await setup({ upserts: [{ status: 503 }, { status: 503 }] });
  const { events } = play(lifeTaps(2));
  const rec = store.recorder(GAME);
  const seen = [];
  rec.onStatus((s) => seen.push(s.state));
  rec.push(events);
  await t.advance(300);
  assert.equal(sb.upserts().length, 1);
  assert.equal(rec.status.pending, 2);
  await t.advance(999);
  assert.equal(sb.upserts().length, 1, 'zweiter Versuch nicht vor 1 s');
  await t.advance(1);
  assert.equal(sb.upserts().length, 2);
  await t.advance(1999);
  assert.equal(sb.upserts().length, 2, 'dritter Versuch nicht vor weiteren 2 s');
  await t.advance(1);
  assert.equal(sb.upserts().length, 3);
  assert.deepEqual(seqs(sb.upserts()[2]), [1, 2]);
  assert.deepEqual(rec.status, { state: 'saved', pending: 0 });
  assert.ok(seen.includes('saving'));
  assert.equal(sb.tables.game_events.length, 2);
});

test('G3b Wiederholungstakt 1, 2, 4, 8, 16, 30, 30 s', async () => {
  const fails = Array.from({ length: 7 }, () => ({ status: 500 }));
  const { sb, t, store } = await setup({ upserts: fails });
  const rec = store.recorder(GAME);
  rec.push(play(lifeTaps(1)).events);
  await t.advance(300);
  const at = [t.now];
  for (const gap of [1, 2, 4, 8, 16, 30, 30]) {
    await t.advance(gap * 1000 - 1);
    assert.equal(sb.upserts().length, at.length, `nicht vor ${gap} s`);
    await t.advance(1);
    assert.equal(sb.upserts().length, at.length + 1, `nach ${gap} s`);
    at.push(t.now);
  }
  assert.equal(rec.status.state, 'saved');
});

test('G4 Idempotenz: Antwort geht verloren ⇒ dieselben seq erneut, jede seq einmal in der Tabelle', async () => {
  const { sb, t, store } = await setup({ upserts: ['lost'] });
  const { events } = play(lifeTaps(3));
  const rec = store.recorder(GAME);
  rec.push(events);
  await t.advance(300);
  assert.equal(sb.upserts().length, 1);
  assert.equal(rec.status.pending, 3, 'ohne Antwort bleibt alles ausstehend');
  await t.advance(1000);
  assert.equal(sb.upserts().length, 2);
  assert.deepEqual(seqs(sb.upserts()[1]), seqs(sb.upserts()[0]));
  assert.deepEqual(sb.tables.game_events.map((e) => e.seq).sort(), [1, 2, 3]);
  assert.equal(rec.status.pending, 0);
});

for (const [name, status, code] of [['403', 403, '42501'], ['400 Spiel nicht live', 400, '42501']]) {
  test(`G5 Dauerfehler ${name}: error, keine weiteren Versuche nach 60 s, pending bleibt`, async () => {
    const { sb, t, store, storage } = await setup({ upserts: [{ status, code }] });
    const rec = store.recorder(GAME);
    rec.push(play(lifeTaps(2)).events);
    await t.advance(300);
    assert.equal(sb.upserts().length, 1);
    await t.advance(60_000);
    assert.equal(sb.upserts().length, 1, 'kein Wiederholen bei Dauerfehler');
    assert.equal(rec.status.state, 'error');
    assert.equal(rec.status.pending, 2);
    assert.ok(rec.status.error);
    assert.equal(JSON.parse(storage.getItem(`ttg.queue.${GAME}`)).length, 2, 'Liste bleibt gespeichert');
    assert.equal(t.pending, 0);
  });
}

test('G6 Offline: kein upsert, state offline; wieder online + push ⇒ alles gesendet', async () => {
  let on = false;
  const { sb, t, store } = await setup({ online: () => on });
  const { events } = play(lifeTaps(3));
  const rec = store.recorder(GAME);
  rec.push(events.slice(0, 2));
  await t.advance(10_000);
  assert.equal(sb.upserts().length, 0);
  assert.deepEqual(rec.status, { state: 'offline', pending: 2 });
  on = true;
  rec.push([events[2]]);
  await t.advance(300);
  assert.equal(sb.upserts().length, 1);
  assert.deepEqual(seqs(sb.upserts()[0]), [1, 2, 3]);
  assert.deepEqual(rec.status, { state: 'saved', pending: 0 });
});

test('G6b Online-Wechsel (Ereignis „online“) sendet ohne neues push', async () => {
  const { createStore } = await load();
  let on = false;
  const sb = fakeSb();
  const t = clock();
  const target = new EventTarget();
  const store = createStore(sb, { storage: memStorage(), online: () => on, timers: t, events: target });
  const rec = store.recorder(GAME);
  rec.push(play(lifeTaps(2)).events);
  await t.advance(1000);
  assert.equal(sb.upserts().length, 0);
  on = true;
  target.dispatchEvent(new Event('online'));
  await t.advance(0);
  assert.equal(sb.upserts().length, 1);
  assert.equal(rec.status.state, 'saved');
});

// ---------------------------------------------------------------------------
// Laden / Reload

test('G7 Reload: push 1..5, nur 1..3 bestätigt ⇒ neue Instanz: state = replay 1..5, sendet 4,5', async () => {
  const storage = memStorage();
  const { events, state: before } = play(lifeTaps(5));
  const a = await setup({ db: serverDb(), upserts: ['ok', { hang: true }], storage });
  const rec = a.store.recorder(GAME);
  rec.push(events.slice(0, 3));
  await a.t.advance(300);
  rec.push(events.slice(3));
  await a.t.advance(300);
  assert.equal(a.sb.upserts().length, 2, 'zweiter upsert hängt (Tab stirbt)');
  assert.deepEqual(a.sb.tables.game_events.map((e) => e.seq), [1, 2, 3]);

  // neue Instanz, gleiche storage, Server kennt 1..3
  const { createStore } = await load();
  const sb2 = fakeSb(serverDb(a.sb.tables.game_events));
  const t2 = clock();
  const store2 = createStore(sb2, { storage, online: () => true, timers: t2, events: null });
  const loaded = await store2.loadGame(GAME);
  assert.deepEqual(loaded.state, before);
  assert.equal(loaded.state.nextSeq, 6);
  await t2.advance(300);
  assert.equal(sb2.upserts().length, 1);
  assert.deepEqual(seqs(sb2.upserts()[0]), [4, 5]);
  assert.deepEqual(sb2.tables.game_events.map((e) => e.seq), [1, 2, 3, 4, 5]);
  assert.equal(storage.getItem(`ttg.queue.${GAME}`), null, 'Warteschlange leer ⇒ Schlüssel weg');
});

test('G7b Laden während laufendem Schreibvorgang: bestätigt zwischen Server-Lesen und Queue-Abzug ⇒ nichts fällt heraus', async () => {
  const { sb, t, store } = await setup({ db: serverDb(), upserts: [{ hang: true }] });
  const { events, state: before } = play(lifeTaps(3));
  const rec = store.recorder(GAME);
  rec.push(events);
  await t.advance(300);
  assert.equal(sb.upserts().length, 1, 'upsert hängt');
  // Server-Lesen der Ereignisse liefert den Stand VOR dem Commit; direkt danach kommt die Bestätigung an.
  const orig = sb.from;
  sb.from = (table) => {
    const b = orig(table);
    if (table !== 'game_events') return b;
    const then = b.then;
    b.then = (ok, ko) => then((res) => { sb.release(); return settle().then(() => res); }).then(ok, ko);
    return b;
  };
  const loaded = await store.loadGame(GAME);
  assert.equal(rec.status.pending, 0, 'Schreibvorgang während des Ladens bestätigt');
  assert.deepEqual(loaded.state.events.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(loaded.state, before);
});

test('G8 Dubletten beim Laden: Server 1..3, lokal 2..5 ⇒ replay 1..5 je einmal', async () => {
  const { events, state: before } = play(lifeTaps(5));
  const storage = memStorage();
  storage.setItem(`ttg.queue.${GAME}`, JSON.stringify(events.slice(1).map((e) => ({ game_id: GAME, ...e }))));
  const { store } = await setup({ db: serverDb(events.slice(0, 3)), storage });
  const { state } = await store.loadGame(GAME);
  assert.deepEqual(state.events.map((e) => e.seq), [1, 2, 3, 4, 5]);
  // Alte Warteschlange ohne cid wird beim Lesen nachgestempelt (P4 Befund B3): 4/5 tragen cid
  assert.ok(state.events.slice(3).every((e) => typeof e.payload.cid === 'string'));
  const noCid = (st) => ({ ...st, events: st.events.map(({ payload: { cid: _c, ...p }, ...e }) => ({ ...e, payload: p })) });
  assert.deepEqual(noCid(state), before);
});

test('G9 Undo übersteht Reload: gleicher Zustand (deep equal)', async () => {
  const { events, state: before } = play([
    { type: 'life', target: 'B', d: -5 },
    { type: 'attack', from: 'A', to: ['B', 'C'], kind: 'cmd', amount: 7, lifelink: true },
    { type: 'endTurn', at: Date.parse(STARTED) + 65_000 },
    { type: 'counter', target: 'C', key: 'energy', d: 3 },
    { type: 'undo' },
    { type: 'undo' },
  ]);
  assert.ok(events.some((e) => e.type === 'undo'));
  const storage = memStorage();
  const a = await setup({ db: serverDb(), storage });
  a.store.recorder(GAME).push(events);
  await a.t.advance(300);
  const { createStore } = await load();
  const store2 = createStore(fakeSb(serverDb(a.sb.tables.game_events)), { storage, online: () => true, timers: clock(), events: null });
  const loaded = await store2.loadGame(GAME);
  assert.deepEqual(loaded.state, before);
  assert.equal(loaded.state.players.find((p) => p.id === 'C').energy, 0);
});

test('G9b Laden: Rückgabeform, live_state nie als Quelle, Partner aus dem Deck', async () => {
  const { store, sb } = await setup({ db: serverDb() });
  const { game, players, decks, state } = await store.loadGame(GAME);
  assert.equal(game.id, GAME);
  assert.equal(game.live_state, undefined, 'live_state wird nicht gelesen');
  assert.ok(!sb.calls.some((c) => c.table === 'games' && /live_state/.test(c.cols || '')));
  assert.deepEqual(players.map((p) => [p.member_id, p.name, p.seat, p.deck_id]), PLAYERS.map((p) => [p.id, p.name, p.seat, p.deck]));
  assert.deepEqual(Object.keys(decks).sort(), ['dA', 'dB', 'dC', 'dD']);
  for (const k of ['short_name', 'commander_name', 'partner_name', 'image_url', 'partner_image_url', 'color_identity', 'field_color', 'counter_pins']) {
    assert.ok(k in decks.dA, `Deckspalte ${k}`);
  }
  assert.equal(state.round, 1);
  assert.equal(state.turnStartedAt, Date.parse(STARTED));
  assert.deepEqual(state.players.map((p) => p.partner), [false, false, false, true]);
  assert.deepEqual(state.players.map((p) => p.life), [40, 40, 40, 40]);
});

test('G9c Laden blättert über 1000 Ereignisse (PostgREST-Grenze)', async () => {
  const { events } = play(lifeTaps(1500));
  const { store, sb } = await setup({ db: serverDb(events) });
  const { state } = await store.loadGame(GAME);
  assert.equal(state.events.length, 1500);
  assert.equal(state.nextSeq, 1501);
  assert.ok(sb.calls.filter((c) => c.table === 'game_events' && c.op === 'select').length >= 2);
});

// ---------------------------------------------------------------------------
// live_state

test('G10 live_state gedrosselt: 10 publish in 500 ms ⇒ 1 update nach 1000 ms mit dem 10. Stand; turn_end ⇒ sofort', async () => {
  const { sb, t, store } = await setup({ db: serverDb() });
  let s = freshState();
  const states = [];
  for (let i = 0; i < 10; i++) {
    s = E.act(s, { type: 'life', target: 'A', d: -1 }).state;
    states.push(s);
    store.publish(GAME, s);
    if (i < 9) await t.advance(50);
  }
  assert.equal(t.now, 450);
  await t.advance(549);
  assert.equal(sb.updates().length, 0, 'vor 1000 ms kein update');
  await t.advance(1);
  assert.equal(sb.updates().length, 1);
  const u = sb.updates()[0];
  assert.equal(u.table, 'games');
  assert.deepEqual(u.values, { live_state: E.snapshot(states[9]), round: 1, current_turn: 0 });
  assert.equal(u.values.live_state.players[0].life, 30);

  const next = E.act(states[9], { type: 'endTurn', at: Date.parse(STARTED) + 1000 }).state;
  store.publish(GAME, next);
  await t.advance(0);
  assert.equal(sb.updates().length, 2, 'turn_end ⇒ sofort');
  assert.equal(sb.updates()[1].values.current_turn, 1);
  await t.advance(5000);
  assert.equal(sb.updates().length, 2, 'kein Nachlauf nach Sofort-Update');
});

test('G10b publish: Fehler blockiert nicht, nächster Aufruf versucht erneut', async () => {
  const { createStore } = await load();
  const sb = fakeSb(serverDb());
  let failNext = true;
  const orig = sb.from;
  sb.from = (table) => {
    const b = orig(table);
    if (table === 'games') {
      const upd = b.update;
      b.update = (v) => { if (failNext) { failNext = false; return { eq: async () => { throw new TypeError('Failed to fetch'); } }; } return upd(v); };
    }
    return b;
  };
  const t = clock();
  const store = createStore(sb, { storage: memStorage(), online: () => true, timers: t, events: null });
  const s1 = E.act(freshState(), { type: 'eliminate', target: 'D', by: 'B' }).state;
  assert.doesNotThrow(() => store.publish(GAME, s1));
  await t.advance(0);
  const s2 = E.act(s1, { type: 'eliminate', target: 'C', by: 'A' }).state;
  store.publish(GAME, s2);
  await t.advance(0);
  assert.equal(sb.tables.games[0].live_state.players.find((p) => p.id === 'C').out, true);
});

// ---------------------------------------------------------------------------
// Ende

const e15 = () => play([
  { type: 'eliminate', target: 'D', by: 'B' },
  { type: 'eliminate', target: 'C', by: 'A' },
  { type: 'eliminate', target: 'B', by: 'A' },
]);

test('G11 finish wartet: pending 2 ⇒ finish_game erst nach erfolgreichem Flush; Queue danach gelöscht', async () => {
  const storage = memStorage();
  const { sb, store } = await setup({ db: serverDb(), storage, upserts: [{ status: 503 }] });
  const { events, state } = play(lifeTaps(2));
  store.recorder(GAME).push(events);
  await assert.rejects(store.finishGame(GAME, state, 'finished'), 'erster Flush scheitert ⇒ Fehler');
  assert.equal(sb.rpcs('finish_game').length, 0, 'kein RPC ohne geleerte Warteschlange');
  await store.finishGame(GAME, state, 'finished');
  const order = sb.calls.filter((c) => c.op === 'insert' || c.op === 'rpc').map((c) => c.op);
  assert.deepEqual(order, ['insert', 'insert', 'rpc']);
  assert.equal(sb.tables.game_events.length, 2);
  assert.equal(storage.getItem(`ttg.queue.${GAME}`), null, 'Warteschlange nach Spielende gelöscht');
});

test('G11b Flush scheitert dauerhaft (403) ⇒ Fehler, kein RPC, Liste bleibt', async () => {
  const storage = memStorage();
  const { sb, store } = await setup({ storage, upserts: [{ status: 403, code: '42501' }, { status: 403, code: '42501' }] });
  const { events, state } = play(lifeTaps(2));
  store.recorder(GAME).push(events);
  await assert.rejects(store.finishGame(GAME, state, 'finished'));
  await assert.rejects(store.finishGame(GAME, state, 'aborted'));
  assert.equal(sb.rpcs('finish_game').length, 0);
  assert.equal(JSON.parse(storage.getItem(`ttg.queue.${GAME}`)).length, 2);
});

test('G11c Flush offline ⇒ Fehler, kein RPC', async () => {
  const { sb, store } = await setup({ online: () => false });
  const { events, state } = play(lifeTaps(1));
  store.recorder(GAME).push(events);
  await assert.rejects(store.finishGame(GAME, state, 'finished'));
  assert.equal(sb.rpcs().length, 0);
  assert.equal(sb.upserts().length, 0);
});

test('G12 results-Abbildung nach E15', async () => {
  const { sb, store } = await setup();
  const { state } = e15();
  await store.finishGame(GAME, state, 'finished');
  const [call] = sb.rpcs('finish_game');
  assert.deepEqual(call.params, {
    p_game: GAME, p_status: 'finished', p_round: 1,
    p_results: [
      { member_id: 'A', place: 1, eliminated_round: null, eliminated_by: null, final_life: 40 },
      { member_id: 'B', place: 2, eliminated_round: 1, eliminated_by: 'A', final_life: 40 },
      { member_id: 'C', place: 3, eliminated_round: 1, eliminated_by: 'A', final_life: 40 },
      { member_id: 'D', place: 4, eliminated_round: 1, eliminated_by: 'B', final_life: 40 },
    ],
  });
});

test('G12b aborted ⇒ p_results null; ungültiger Status ⇒ Fehler', async () => {
  const { sb, store } = await setup();
  const { state } = play([{ type: 'life', target: 'A', d: -3 }]);
  await store.finishGame(GAME, state, 'aborted');
  assert.deepEqual(sb.rpcs('finish_game')[0].params, { p_game: GAME, p_status: 'aborted', p_round: 1, p_results: null });
  await assert.rejects(store.finishGame(GAME, state, 'live'));
});

// ---------------------------------------------------------------------------
// Start

const startInput = (extra = {}) => ({
  groupId: 'grp', layout: 'seiten', startingLife: 40, firstSeat: 2,
  players: PLAYERS.map((p) => ({ memberId: p.id, deckId: p.deck, seat: p.seat })), playedOn: '2026-11-09', ...extra,
});
const startRpc = { start_game: () => ({ data: { id: 'g-new', started_at: STARTED, status: 'live' }, error: null, status: 200 }) };

test('G13 Startwurf: nach RPC genau ein roll-Ereignis seq 1, payload.kind start', async () => {
  const { sb, t, store } = await setup({ rpc: startRpc });
  const id = await store.startGame(startInput({ startRoll: { values: [3, 5, 6, 2], winnerSeat: 2 } }));
  assert.equal(id, 'g-new');
  await t.advance(300);
  const order = sb.calls.filter((c) => c.op === 'insert' || c.op === 'rpc').map((c) => c.op);
  assert.deepEqual(order, ['rpc', 'insert']);
  assert.equal(sb.upserts().length, 1);
  const rows = sb.upserts()[0].rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[0].type, 'roll');
  assert.equal(rows[0].game_id, 'g-new');
  assert.equal(rows[0].round, 1);
  assert.equal(rows[0].payload.kind, 'start');
  assert.deepEqual(rows[0].payload.values, [3, 5, 6, 2]);
  assert.equal(rows[0].payload.winner_seat, 2);
  assert.deepEqual(sb.tables.game_events.map((e) => e.seq), [1]);
});

test('G13b Start ohne Wurf: kein Ereignis; Parameterform; playedOn Standard = lokales Datum', async () => {
  const { sb, t, store } = await setup({ rpc: startRpc });
  const { playedOn, ...rest } = startInput();
  void playedOn;
  await store.startGame(rest);
  await t.advance(1000);
  assert.equal(sb.upserts().length, 0);
  const p = sb.rpcs('start_game')[0].params;
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(p.p_played_on, local);
  assert.deepEqual(p.p_players, PLAYERS.map((x) => ({ member_id: x.id, deck_id: x.deck, seat: x.seat })));
  assert.equal(p.p_first_seat, 2);
});

test('G13c Startfehler ⇒ wirft mit Meldung', async () => {
  const { store } = await setup({ rpc: { start_game: () => ({ data: null, error: { code: 'P0001', message: 'Deck nicht verfügbar' }, status: 400 }) } });
  await assert.rejects(store.startGame(startInput()), /Deck nicht verfügbar/);
});

// ---------------------------------------------------------------------------
// storage kaputt

test('G14 storage kaputt: setItem wirft ⇒ push funktioniert, kein Fehler nach außen', async () => {
  const { sb, t, store } = await setup({ storage: memStorage({ throws: true }) });
  const rec = store.recorder(GAME);
  assert.doesNotThrow(() => rec.push(play(lifeTaps(3)).events));
  assert.equal(rec.status.pending, 3);
  await t.advance(300);
  assert.deepEqual(seqs(sb.upserts()[0]), [1, 2, 3]);
  assert.equal(rec.status.state, 'saved');
});

test('G14b storage-Zugriff wirft schon beim Lesen / Inhalt kaputt ⇒ leere Warteschlange', async () => {
  const bad = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  const { store } = await setup({ db: serverDb(), storage: bad });
  const { state } = await store.loadGame(GAME);
  assert.equal(state.events.length, 0);
  const s2 = memStorage(); s2.setItem(`ttg.queue.${GAME}`, '{kaputt');
  const b = await setup({ db: serverDb(), storage: s2 });
  assert.equal((await b.store.loadGame(GAME)).state.events.length, 0);
});

// ---------------------------------------------------------------------------
// Anzeigetafel, Deck-Vorlieben

test('liveGames: nur live der Gruppe, jüngstes zuerst, Spieler nach Sitz mit Deck', async () => {
  const db = serverDb();
  db.games.push({ ...db.games[0], id: 'g2', started_at: '2026-11-09T21:00:00.000Z' });
  db.games.push({ ...db.games[0], id: 'g3', status: 'finished' });
  db.games.push({ ...db.games[0], id: 'g4', playgroup_id: 'andere' });
  db.game_players.push({ game_id: 'g2', member_id: 'B', deck_id: 'dB', seat: 1 }, { game_id: 'g2', member_id: 'A', deck_id: 'dA', seat: 0 });
  const { store } = await setup({ db });
  const list = await store.liveGames('grp');
  assert.deepEqual(list.map((g) => g.id), ['g2', GAME]);
  assert.ok('live_state' in list[0]);
  assert.deepEqual(list[0].players.map((p) => [p.name, p.seat]), [['Anna', 0], ['Ben', 1]]);
  assert.deepEqual(list[0].players[0].deck, { id: 'dA', image_url: 'https://img/A', color_identity: ['G'], short_name: 'KA' });
});

test('Deck-Vorlieben: set_deck_field_color(p_deck, p_mode, p_color) und set_deck_counter_pins', async () => {
  const { sb, store } = await setup();
  await store.setFieldColor('dA', 'color', '#AA3355');
  await store.setFieldColor('dA', 'art');
  await store.setCounterPins('dA', ['poison', 'energy']);
  assert.deepEqual(sb.rpcs().map((c) => [c.name, c.params]), [
    ['set_deck_field_color', { p_deck: 'dA', p_mode: 'color', p_color: '#AA3355' }],
    ['set_deck_field_color', { p_deck: 'dA', p_mode: 'art', p_color: null }],
    ['set_deck_counter_pins', { p_deck: 'dA', p_pins: ['poison', 'energy'] }],
  ]);
});

// ---------------------------------------------------------------------------
// Kriterium 4: RPC- und Parameternamen aus der Migration (nicht abgeschrieben)

const SQL = fs.readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261111000000_spielen.sql', import.meta.url)), 'utf8');
function sqlParams(fn) {
  const m = SQL.match(new RegExp(`create or replace function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, 'i'));
  assert.ok(m, `Funktion ${fn} in der Migration`);
  return m[1].split(',').map((p) => p.trim().split(/\s+/)[0]);
}

test('K4 Aufrufformen passen zur Migration (start_game, finish_game, set_deck_field_color, set_deck_counter_pins)', async () => {
  const { sb, store } = await setup({ rpc: startRpc });
  await store.startGame(startInput());
  await store.finishGame('g-new', e15().state, 'finished');
  await store.setFieldColor('dA', 'commander', null);
  await store.setCounterPins('dA', []);
  for (const fn of ['start_game', 'finish_game', 'set_deck_field_color', 'set_deck_counter_pins']) {
    const calls = sb.rpcs(fn);
    assert.equal(calls.length, 1, `RPC ${fn} aufgerufen`);
    assert.deepEqual(Object.keys(calls[0].params), sqlParams(fn), `Parameter von ${fn}`);
  }
  assert.deepEqual(sqlParams('start_game'), ['p_group', 'p_layout', 'p_starting_life', 'p_first_seat', 'p_players', 'p_played_on']);
  assert.deepEqual(sqlParams('finish_game'), ['p_game', 'p_status', 'p_round', 'p_results']);
});

test('K2 game-store.js importiert nur ../game/engine.js', async () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../../src/lib/game-store.js', import.meta.url)), 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../game/engine.js']);
  assert.ok(!/import\(/.test(src), 'kein dynamischer Import');
});

// ---------------------------------------------------------------------------
// Spec P3 (Welle ttg-features, Entscheid 1 b): Merker „dieses Gerät hat das Spiel gestartet“ —
// modulweit (setup.js und life.js haben verschiedene Store-Instanzen), einmal verbraucht, nur nach Erfolg.
// Tabelle „Spec-Tests · takeFreshStart“.
test('P3 takeFreshStart: nach Erfolg Zeitstempel, einmal verbraucht, fremde ID null', async () => {
  const { takeFreshStart } = await load();
  const { store } = await setup({ rpc: startRpc });
  const id = await store.startGame(startInput());
  const x = takeFreshStart(id);
  assert.equal(typeof x, 'number');
  assert.ok(Math.abs(Date.now() - x) < 1000, `Zeitstempel ${x}`);
  assert.equal(takeFreshStart(id), null, 'einmal verbraucht');
  assert.equal(takeFreshStart('andere'), null, 'fremde ID');
});

test('P3 takeFreshStart: zwei Store-Instanzen — Instanz 1 startet, Modul-Export liest (wie setup.js → life.js)', async () => {
  const { takeFreshStart } = await load();
  const one = await setup({ rpc: { start_game: () => ({ data: { id: 'g-zwei', started_at: STARTED, status: 'live' }, error: null, status: 200 }) } });
  const two = await setup({ rpc: startRpc });
  assert.notEqual(one.store, two.store);
  await one.store.startGame(startInput());
  assert.equal(typeof takeFreshStart('g-zwei'), 'number');
});

test('P3 takeFreshStart: RPC-Fehler ⇒ startGame wirft, kein Merker', async () => {
  const { takeFreshStart } = await load();
  const { store } = await setup({ rpc: { start_game: () => ({ data: null, error: { code: 'P0001', message: 'Deck nicht verfügbar' }, status: 400 }) } });
  await assert.rejects(store.startGame(startInput()), /Deck nicht verfügbar/);
  for (const id of ['g-new', 'g-zwei', 'undefined', 'null']) assert.equal(takeFreshStart(id), null, id);
});
