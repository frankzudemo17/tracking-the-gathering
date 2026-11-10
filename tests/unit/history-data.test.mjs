// Spec P15 Kriterium 13: Datenschicht src/lib/history-data.js gegen ein gefälschtes `sb`
// (zeichnet jeden Aufruf auf, filtert eq/in, schneidet range; kein Netz, kein supabase.js-Import).
// Modul je Fall per import() ⇒ am Basis-Stand (P13-Stub) schlägt jeder Fall einzeln fehl (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/lib/history-data.js');
const GID = 'grp-1';

// ---------------------------------------------------------------------------
// Attrappe

/**
 * @param {Record<string, object[]>} db Tabellen/Views in DB-Spaltenform
 * @param {{ errors?: Record<string, { message: string, code?: string }> }} [opts] Fehler je Tabelle (veränderbar)
 */
function fakeSb(db, { errors = {} } = {}) {
  const calls = [];
  function from(table) {
    const q = { table, select: null, eq: [], in: [], order: [], range: null, single: false };
    calls.push(q);
    const exec = () => Promise.resolve().then(() => {
      if (errors[table]) return { data: null, error: { ...errors[table] }, status: 400 };
      let rows = (db[table] || []).filter((r) => q.eq.every(([c, v]) => r[c] === v) && q.in.every(([c, vs]) => vs.includes(r[c])));
      if (q.single) return { data: rows[0] ? { ...rows[0] } : null, error: null, status: 200 };
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      return { data: rows.map((r) => ({ ...r })), error: null, status: 200 };
    });
    const b = {
      select(c) { q.select = c; return b; },
      eq(c, v) { q.eq.push([c, v]); return b; },
      in(c, vs) { q.in.push([c, [...vs]]); return b; },
      order(c, o) { q.order.push([c, o?.ascending !== false]); return b; },
      range(a, z) { q.range = [a, z]; return exec(); },
      maybeSingle() { q.single = true; return exec(); },
    };
    return b;
  }
  return { from, calls, of: (t) => calls.filter((c) => c.table === t) };
}

const gameRow = (id, extra = {}) => ({
  id, playgroup_id: GID, session_id: null, status: 'finished', started_at: '2026-10-01T19:00:00Z', ended_at: '2026-10-01T20:00:00Z',
  round: 7, wincon: null, note: null, photo_path: null, starting_life: 40, live_state: { gross: true }, ...extra,
});
const manyGames = (n) => Array.from({ length: n }, (_, i) => gameRow(`g${String(i).padStart(4, '0')}`));
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

// ---------------------------------------------------------------------------
// Seitenweise / Stücke

test('K13 1 001 Spiele ⇒ genau 2 range-Aufrufe (0–999, 1000–1999), Filter Gruppe + finished, feste Sortierung', async () => {
  const { createHistoryData } = await load();
  const games = [...manyGames(1001), gameRow('live-1', { status: 'live' }), gameRow('fremd-1', { playgroup_id: 'grp-2' })];
  const sb = fakeSb({ games });
  const data = await createHistoryData(sb).loadGroup(GID);
  assert.equal(data.games.length, 1001);
  const calls = sb.of('games');
  assert.deepEqual(calls.map((c) => c.range), [[0, 999], [1000, 1999]]);
  for (const c of calls) {
    assert.deepEqual(c.eq.sort(), [['playgroup_id', GID], ['status', 'finished']].sort());
    assert.deepEqual(c.order.map(([col]) => col), ['started_at', 'id'], 'Sortierung started_at, id');
    assert.ok(!/live_state|\*/.test(c.select), 'games ohne live_state / *');
  }
  assert.ok(!data.games.some((g) => g.id === 'live-1' || g.id === 'fremd-1'));
});

test('K13 Stück deck_salt_ratings mit 1 000 Zeilen auf der ersten Seite ⇒ zweite Seite für dasselbe Stück', async () => {
  const { createHistoryData } = await load();
  const salt = Array.from({ length: 1003 }, (_, i) => ({ game_id: 'g1', rater_id: `m${i}`, deck_id: 'd1', salt: 3 }));
  const sb = fakeSb({ games: [gameRow('g1')], deck_salt_ratings: salt });
  const data = await createHistoryData(sb).loadGroup(GID);
  const calls = sb.of('deck_salt_ratings');
  assert.deepEqual(calls.map((c) => c.range), [[0, 999], [1000, 1999]]);
  assert.deepEqual(calls.map((c) => c.in), [[['game_id', ['g1']]], [['game_id', ['g1']]]], 'gleiches Stück');
  assert.equal(data.deckSalt.length, 1003, 'Zeilen beider Seiten');
  assert.equal(data.deckSalt[1002].raterId, 'm1002');
  for (const c of calls) assert.ok(c.order.length > 0, 'feste Sortierung');
});

test('K13 v_game_turn_times mit 1 000 + 5 Zeilen ⇒ 2 Aufrufe, nur geladene Spiele behalten', async () => {
  const { createHistoryData } = await load();
  const rows = Array.from({ length: 1005 }, (_, i) => ({ playgroup_id: GID, game_id: 'g1', member_id: `m${i}`, turns: 2, total_sec: 100, longest_sec: 60 }));
  rows.push({ playgroup_id: GID, game_id: 'live-1', member_id: 'mx', turns: 1, total_sec: 1, longest_sec: 1 });
  const sb = fakeSb({ games: [gameRow('g1')], v_game_turn_times: rows });
  const data = await createHistoryData(sb).loadGroup(GID);
  const calls = sb.of('v_game_turn_times');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.range), [[0, 999], [1000, 1999]]);
  for (const c of calls) assert.deepEqual(c.eq, [['playgroup_id', GID]]);
  assert.equal(data.turns.length, 1005);
  assert.ok(data.turns.every((t) => t.gameId === 'g1'));
});

test('K13 450 Spiel-IDs ⇒ je Tabelle 3 in-Aufrufe (200/200/50)', async () => {
  const { createHistoryData } = await load();
  const games = manyGames(450);
  const sb = fakeSb({ games });
  await createHistoryData(sb).loadGroup(GID);
  const all = new Set();
  for (const t of ['game_players', 'player_ratings', 'deck_salt_ratings', 'potg_votes']) {
    const calls = sb.of(t);
    assert.equal(calls.length, 3, `${t}: 3 Aufrufe`);
    assert.deepEqual(calls.map((c) => c.in[0][1].length).sort((a, b) => b - a), [200, 200, 50], `${t}: Stückgrößen`);
    for (const c of calls) { assert.equal(c.in[0][0], 'game_id'); c.in[0][1].forEach((id) => all.add(`${t}|${id}`)); }
  }
  assert.equal(all.size, 4 * 450, 'jede ID genau in einem Stück');
});

// ---------------------------------------------------------------------------
// Abbildung

test('K13 Abbildung snake ⇒ camel an einer Zeile je Tabelle', async () => {
  const { createHistoryData } = await load();
  const db = {
    members: [
      { id: 'm1', playgroup_id: GID, profile_id: 'p1', display_name: 'Alt', avatar_path: 'members/m1/alt.jpg', created_at: '2026-01-01', profiles: { display_name: 'Franco', avatar_path: 'p1/avatar.jpg' } },
      { id: 'm2', playgroup_id: GID, profile_id: null, display_name: 'Tim', avatar_path: 'members/m2/avatar.jpg', created_at: '2026-01-02', profiles: null },
    ],
    games: [gameRow('g1', { session_id: 's1', wincon: 'kombo', note: 'n', photo_path: `${GID}/g1.jpg` })],
    sessions: [{ id: 's1', playgroup_id: GID, played_on: '2026-10-01', location: 'WG' }],
    game_players: [{ game_id: 'g1', member_id: 'm1', deck_id: 'd1', seat: 0, place: 1, eliminated_round: null, eliminated_by: null, final_life: 12, mulligans: 1 },
      { game_id: 'g1', member_id: 'm2', deck_id: null, seat: 1, place: 2, eliminated_round: 5, eliminated_by: 'm1', final_life: 0 }],
    player_ratings: [{ game_id: 'g1', member_id: 'm1', salt: 2, fun: 4, deck_rating: 5 }],
    deck_salt_ratings: [{ game_id: 'g1', rater_id: 'm2', deck_id: 'd1', salt: 4 }],
    potg_votes: [{ game_id: 'g1', voter_id: 'm2', voted_for: 'm1', text: 'Stark.' }],
    v_game_turn_times: [{ playgroup_id: GID, game_id: 'g1', member_id: 'm1', turns: 7, total_sec: 910, longest_sec: 180 }],
    decks: [{ id: 'd1', short_name: 'Atraxa', commander_name: "Atraxa, Praetors' Voice", partner_name: null, image_url: 'https://x/a.jpg', color_identity: ['W', 'U', 'B', 'G'], bracket: 3, owner_profile_id: 'p1', owner_member_id: null, archived: true }],
  };
  const sb = fakeSb(db);
  const data = await createHistoryData(sb).loadGroup(GID);
  assert.equal(data.groupId, GID);
  assert.deepEqual(data.members, [
    // P10 Krit. 15: zwei neue Felder (ohne die neuen Spalten ⇒ false/null)
    { id: 'm1', name: 'Franco', profileId: 'p1', avatarPath: 'p1/avatar.jpg', isPlaceholder: false, removed: false, formerProfileId: null },
    { id: 'm2', name: 'Tim', profileId: null, avatarPath: 'members/m2/avatar.jpg', isPlaceholder: true, removed: false, formerProfileId: null },
  ]);
  assert.deepEqual(data.games, [{ id: 'g1', sessionId: 's1', status: 'finished', startedAt: '2026-10-01T19:00:00Z', endedAt: '2026-10-01T20:00:00Z', round: 7, wincon: 'kombo', note: 'n', photoPath: `${GID}/g1.jpg`, startingLife: 40 }]);
  assert.deepEqual(data.sessions, [{ id: 's1', playedOn: '2026-10-01', location: 'WG' }]);
  assert.deepEqual(data.players[1], { gameId: 'g1', memberId: 'm2', deckId: null, seat: 1, place: 2, eliminatedRound: 5, eliminatedBy: 'm1', finalLife: 0 });
  assert.deepEqual(data.ratings, [{ gameId: 'g1', memberId: 'm1', salt: 2, fun: 4, deckRating: 5 }]);
  assert.deepEqual(data.deckSalt, [{ gameId: 'g1', raterId: 'm2', deckId: 'd1', salt: 4 }]);
  assert.deepEqual(data.potg, [{ gameId: 'g1', voterId: 'm2', votedFor: 'm1', text: 'Stark.' }]);
  assert.deepEqual(data.turns, [{ gameId: 'g1', memberId: 'm1', turns: 7, totalSec: 910, longestSec: 180 }]);
  assert.deepEqual(data.decks, [{ id: 'd1', shortName: 'Atraxa', commanderName: "Atraxa, Praetors' Voice", partnerName: null, imageUrl: 'https://x/a.jpg', colors: ['W', 'U', 'B', 'G'], bracket: 3, ownerProfileId: 'p1', ownerMemberId: null, archived: true }]);
  // Mitglieder: Muster-Select mit Profil-Einbettung, nur diese Gruppe; Decks/Abende per in(id)
  const mc = sb.of('members')[0];
  assert.equal(mc.select, '*, profiles!members_profile_id_fkey(display_name, avatar_path)');
  assert.deepEqual(mc.eq, [['playgroup_id', GID]]);
  assert.deepEqual(sb.of('decks')[0].in, [['id', ['d1']]]);
  assert.deepEqual(sb.of('sessions')[0].in, [['id', ['s1']]]);
});

// ---------------------------------------------------------------------------
// Fehler, Rückfall

test('K13 error ⇒ Wurf mit der Meldung', async () => {
  const { createHistoryData } = await load();
  const sb = fakeSb({ games: [gameRow('g1')] }, { errors: { player_ratings: { message: 'Bewertungen kaputt', code: 'XX000' } } });
  await assert.rejects(createHistoryData(sb).loadGroup(GID), /Bewertungen kaputt/);
  const sb2 = fakeSb({}, { errors: { games: { message: 'Spiele kaputt' } } });
  await assert.rejects(createHistoryData(sb2).loadGroup(GID), /Spiele kaputt/);
  const sb3 = fakeSb({ games: [gameRow('g1')] }, { errors: { v_game_turn_times: { message: 'Zeiten kaputt', code: '42501' } } });
  await assert.rejects(createHistoryData(sb3).loadGroup(GID), /Zeiten kaputt/, 'anderer Fehler der View wirft');
});

test('K13 v_game_turn_times fehlt (42P01 / PGRST205) ⇒ turns: [] statt Wurf', async () => {
  const { createHistoryData } = await load();
  for (const code of ['42P01', 'PGRST205']) {
    const sb = fakeSb({ games: [gameRow('g1')], game_players: [{ game_id: 'g1', member_id: 'm1', deck_id: null, seat: 0, place: 1 }] },
      { errors: { v_game_turn_times: { message: 'relation does not exist', code } } });
    const data = await quiet(() => createHistoryData(sb).loadGroup(GID));
    assert.deepEqual(data.turns, [], code);
    assert.equal(data.players.length, 1, `${code}: Rest geladen`);
    const one = await quiet(() => createHistoryData(sb).loadGame('g1'));
    assert.deepEqual(one.turns, [], `${code}: loadGame`);
  }
});

// ---------------------------------------------------------------------------
// Zwischenspeicher

test('K13 zwei parallele loadGroup ⇒ eine Ladung; invalidate/force ⇒ neue Ladung', async () => {
  const { createHistoryData } = await load();
  const sb = fakeSb({ games: [gameRow('g1')] });
  const api = createHistoryData(sb);
  const [a, b] = await Promise.all([api.loadGroup(GID), api.loadGroup(GID)]);
  assert.equal(sb.of('games').length, 1, 'eine Ladung');
  assert.equal(a, b);
  await api.loadGroup(GID);
  assert.equal(sb.of('games').length, 1, 'aus dem Zwischenspeicher');
  api.invalidate(GID);
  await api.loadGroup(GID);
  assert.equal(sb.of('games').length, 2, 'nach invalidate neu');
  await api.loadGroup(GID, { force: true });
  assert.equal(sb.of('games').length, 3, 'force neu');
  await api.loadGroup('grp-2');
  assert.equal(sb.of('games').length, 4, 'je Gruppe eigener Eintrag');
});

test('K13 fehlgeschlagene Ladung wird nicht gespeichert', async () => {
  const { createHistoryData } = await load();
  const errors = { games: { message: 'Netz weg' } };
  const sb = fakeSb({ games: [gameRow('g1')] }, { errors });
  const api = createHistoryData(sb);
  await assert.rejects(api.loadGroup(GID), /Netz weg/);
  delete errors.games;
  const data = await api.loadGroup(GID);
  assert.equal(data.games.length, 1, 'zweiter Versuch lädt neu');
  assert.equal(sb.of('games').length, 2);
});

// ---------------------------------------------------------------------------
// loadGame

test('K13 loadGame: jeder Status, nur dieses Spiel, damage gemappt (null ⇒ 0), unbekannt ⇒ null', async () => {
  const { createHistoryData } = await load();
  const db = {
    members: [{ id: 'm1', playgroup_id: GID, profile_id: null, display_name: 'Tim', avatar_path: null, profiles: null }],
    games: [gameRow('live-1', { status: 'live', session_id: 's1' }), gameRow('g2')],
    sessions: [{ id: 's1', played_on: '2026-10-01', location: null }],
    game_players: [{ game_id: 'live-1', member_id: 'm1', deck_id: 'd1', seat: 0, place: null }, { game_id: 'g2', member_id: 'm1', deck_id: 'd2', seat: 0, place: 1 }],
    player_ratings: [{ game_id: 'g2', member_id: 'm1', salt: 1, fun: 1, deck_rating: 1 }],
    decks: [{ id: 'd1', short_name: 'A', commander_name: 'A', color_identity: [], bracket: 3, owner_profile_id: null, owner_member_id: 'm1', archived: false },
      { id: 'd2', short_name: 'B', commander_name: 'B', color_identity: [], bracket: 3, owner_profile_id: null, owner_member_id: 'm1', archived: false }],
    v_damage_matrix: [{ game_id: 'live-1', source: 'm1', target: 'm2', damage: 30, commander_damage: null, poison: null },
      { game_id: 'g2', source: 'm1', target: 'm2', damage: 1, commander_damage: 1, poison: 1 }],
  };
  const sb = fakeSb(db);
  const api = createHistoryData(sb);
  const g = await api.loadGame('live-1');
  assert.equal(g.game.id, 'live-1');
  assert.equal(g.game.status, 'live');
  assert.equal(g.groupId, GID);
  assert.deepEqual(g.games.map((x) => x.id), ['live-1']);
  assert.deepEqual(g.players.map((p) => p.gameId), ['live-1']);
  assert.deepEqual(g.ratings, []);
  assert.deepEqual(g.damage, [{ source: 'm1', target: 'm2', damage: 30, commanderDamage: 0, poison: 0 }]);
  assert.deepEqual(g.decks.map((d) => d.id), ['d1']);
  assert.deepEqual(g.sessions, [{ id: 's1', playedOn: '2026-10-01', location: null }]);
  assert.equal(g.members[0].name, 'Tim');
  assert.deepEqual(sb.of('games')[0].eq, [['id', 'live-1']], 'kein status-Filter');
  assert.deepEqual(sb.of('v_damage_matrix')[0].eq, [['game_id', 'live-1']]);
  assert.equal(await api.loadGame('gibt-es-nicht'), null);
  // nicht zwischengespeichert
  const before = sb.of('games').length;
  await api.loadGame('live-1');
  assert.equal(sb.of('games').length, before + 1);
});

test('K13 loadGroup ohne Spiele ⇒ leere Listen, keine in-Aufrufe', async () => {
  const { createHistoryData, emptyGroupData } = await load();
  const sb = fakeSb({});
  const data = await createHistoryData(sb).loadGroup(GID);
  assert.deepEqual(data, emptyGroupData(GID));
  assert.equal(sb.calls.filter((c) => c.in.length).length, 0);
});

// ---------------------------------------------------------------------------
// Spec P10 Krit. 15/19: toMember liefert removed/formerProfileId — auch ohne die neuen Spalten (vor db push)

test('P10 toMember: removed/formerProfileId aus removed_at/former_profile_id; fehlende Spalten ⇒ false/null', async () => {
  const { createHistoryData } = await load();
  const db = {
    members: [
      { id: 'm1', playgroup_id: GID, profile_id: null, display_name: 'Ex', avatar_path: null, removed_at: '2026-11-10T10:00:00Z', removed_by: 'p9', former_profile_id: 'p7', profiles: null },
      { id: 'm2', playgroup_id: GID, profile_id: null, display_name: 'Tim', avatar_path: null, removed_at: '2026-11-10T10:00:00Z', removed_by: 'p9', former_profile_id: null, profiles: null },
      { id: 'm3', playgroup_id: GID, profile_id: 'p3', display_name: 'Alt', avatar_path: null, removed_at: null, removed_by: null, former_profile_id: null, profiles: { display_name: 'Lu', avatar_path: null } },
      { id: 'm4', playgroup_id: GID, profile_id: null, display_name: 'Ohne', avatar_path: null, profiles: null },
    ],
  };
  const data = await createHistoryData(fakeSb(db)).loadGroup(GID);
  assert.deepEqual(data.members.map((m) => [m.id, m.removed, m.formerProfileId]), [
    ['m1', true, 'p7'], ['m2', true, null], ['m3', false, null], ['m4', false, null],
  ]);
});
