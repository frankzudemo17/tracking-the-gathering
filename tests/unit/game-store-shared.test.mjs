// P9 Würfel-409: Spielvorbereitung und Lifecounter teilen eine Store-Instanz ⇒ das Wurf-Ereignis geht genau einmal raus.
// Mechanik wie Beleg P6 wuerfel-409-mechanik.mjs: Insert dauert länger, als der Lifecounter zum Öffnen braucht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

function fakeSb(insertMs) {
  const events = []; const log = [];
  const put = (rows) => {
    if (rows.some((r) => events.some((e) => e.game_id === r.game_id && e.seq === r.seq))) return { data: null, error: { code: '23505', message: 'duplicate key' }, status: 409 };
    for (const r of rows) events.push({ ...r }); return { data: null, error: null, status: 201 };
  };
  const from = (table) => {
    const q = { op: 'select', f: [] };
    const b = {
      select() { return b; }, eq(k, v) { q.f.push((r) => r[k] === v); return b; }, gt(k, v) { q.f.push((r) => r[k] > v); return b; },
      not() { return b; }, order() { return b; }, range() { return b; }, single() { q.single = true; return b; },
      insert(rows) { q.op = 'insert'; q.rows = rows; return b; },
      then(ok, ko) {
        const run = async () => {
          if (q.op === 'insert') { await sleep(insertMs); const res = put(q.rows); log.push(res.status); return res; }
          const rows = (table === 'game_events' ? events : []).filter((r) => q.f.every((f) => f(r)));
          return q.single ? { data: rows[0] ?? null, error: rows[0] ? null : { code: 'PGRST116' }, status: rows[0] ? 200 : 406 } : { data: rows, error: null, status: 200 };
        };
        return run().then(ok, ko);
      },
    };
    return b;
  };
  const rt = { channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} };
  return { events, log, from, ...rt, rpc: async (name) => (name === 'start_game' ? { data: { id: 'g1', started_at: '2026-11-12T20:00:00.000Z', status: 'live' }, error: null, status: 200 } : { data: null, error: null, status: 200 }) };
}

const players = ['A', 'B', 'C'].map((id, seat) => ({ memberId: id, deckId: `d${id}`, seat }));
const start = { groupId: 'grp', layout: 'seiten', startingLife: 40, firstSeat: 2, players, playedOn: '2026-11-12', startRoll: { values: [4, 2, 6], winnerSeat: 2 } };

async function scenario(make) {
  const sb = fakeSb(300);
  const opts = { storage: mem(), events: new EventTarget(), realtime: { channel: sb.channel, removeChannel: sb.removeChannel } };
  const [setupStore, lifeStore] = await make(sb, opts);
  await setupStore.startGame(start);
  await sleep(100); // Lifecounter öffnet, bevor die Insert-Antwort da ist
  lifeStore.recorder('g1');
  await sleep(1800);
  return { inserts: sb.log, rolls: sb.events.filter((e) => e.type === 'roll').length };
}

test('W1 Gegenprobe: zwei Instanzen ⇒ zweiter Insert, 409 (alter Zustand)', async () => {
  const { createStore } = await import('../../src/lib/game-store.js');
  const r = await scenario((sb, o) => [createStore(sb, o), createStore(sb, o)]);
  assert.deepEqual(r.inserts, [201, 409]);
  assert.equal(r.rolls, 1);
});

test('W2 sharedStore: dieselbe Instanz ⇒ genau ein Insert, kein 409, ein Wurf', async () => {
  const { sharedStore } = await import('../../src/lib/game-store.js?p9-w2');
  const r = await scenario((sb, o) => { const a = sharedStore(sb, o); const b = sharedStore(sb, o); assert.equal(a, b); return [a, b]; });
  assert.deepEqual(r.inserts, [201]);
  assert.equal(r.rolls, 1);
});

test('W3 Spielvorbereitung und Lifecounter holen den Store über sharedStore', () => {
  const src = (f) => readFileSync(new URL(`../../src/views/${f}`, import.meta.url), 'utf8');
  for (const f of ['setup.js', 'life.js']) {
    assert.match(src(f), /sharedStore\(sb\)/, f);
    assert.doesNotMatch(src(f), /createStore\(/, f);
  }
});
