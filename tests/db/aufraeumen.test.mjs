// DB-Fälle Aufräumen der E2E-Testdaten (Spec P6): Das E2E-Aufräumen (tests/e2e/harness.mjs,
// cleanup()) meldet sich als Testkonto an und löscht die eigene Testgruppe als Admin. Diese Datei
// sichert die Voraussetzung: ein `delete from playgroups` als Admin räumt Mitglieder,
// Platzhalter-Decks, Sessions, Spiele, Spieler und Ereignisse per Kaskade ab; ein Nicht-Admin
// löscht nichts; Konto-Decks überleben die Gruppe und löscht nur ihr Besitzer.
// EIN Szenario auf EINER Datenbank, Fälle laufen in Reihenfolge.
// Aufbau: Gruppe G (A Admin, C Mitglied, Platzhalter Tim mit Deck T1), ein Spiel mit A, C, Tim
// samt Ereignissen; fremde Gruppe H (B, Spiel) als Gegenprobe „nichts anderes gelöscht“.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, tools, U } from './harness.mjs';

const EXPECTED = 5;
let db, as, su, q, err;
let ran = 0;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));

before(async () => {
  db = await freshDb();
  ({ as, su, q, err } = tools(db));
});
after(async () => {
  await db?.close();
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

let g, h, mA, mC, mB, tim, game, gameH;
const D = {};
const START = `select * from start_game($1, $2::table_layout, $3, $4, $5::jsonb, $6::date)`;
const start = (group, players) => q(START, [group, 'seiten', 40, 0, JSON.stringify(players), '2026-11-11']).then((r) => r[0]);
const P = (member_id, deck_id, seat) => ({ member_id, deck_id, seat });
const EV = `insert into game_events (game_id, round, type, actor, source, target, amount, payload, seq)
            values ($1, 1, $2::event_type, $3, $4, $5, $6, '{}'::jsonb, $7)`;

/** Zeilen je Tabelle, die zu Gruppe `group` gehören (als Superuser gezählt, an RLS vorbei). */
async function rest(group) {
  await su();
  const r = await q(`select
    (select count(*) from playgroups where id = $1)::int pg,
    (select count(*) from members where playgroup_id = $1)::int mem,
    (select count(*) from decks d join members m on m.id = d.owner_member_id where m.playgroup_id = $1)::int ph_decks,
    (select count(*) from decks where id = $2)::int t1,
    (select count(*) from sessions where playgroup_id = $1)::int ses,
    (select count(*) from games where playgroup_id = $1)::int ga,
    (select count(*) from game_players where game_id = $3)::int gp,
    (select count(*) from game_events where game_id = $3)::int ge`, [group, D.T1 ?? null, game?.id ?? null]);
  return r[0];
}

check('Aufbau: Gruppe G mit Spiel, Spielern, Ereignissen, Platzhalter-Deck, Session; fremde Gruppe H', async () => {
  await su();
  await db.query(`insert into auth.users (id, email) values ($1,'a@x.de'), ($2,'b@x.de'), ($3,'c@x.de')`, [U.A, U.B, U.C]);
  await as(U.A);
  [g] = await q(`select * from create_playgroup('G')`);
  [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [g.id]);
  mA = (await q(`select my_member_id($1) id`, [g.id]))[0].id;
  const deck = async (col, owner, name) =>
    (await q(`insert into decks (${col}, commander_name, short_name) values ($1, $2, $2) returning id`, [owner, name]))[0].id;
  D.A1 = await deck('owner_profile_id', U.A, 'A1');
  D.T1 = await deck('owner_member_id', tim.id, 'T1');
  await as(U.C);
  [{ id: mC }] = await q(`select * from join_playgroup($1)`, [g.invite_code]);
  D.C1 = await deck('owner_profile_id', U.C, 'C1');
  await as(U.A);
  game = await start(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 1), P(tim.id, D.T1, 2)]);
  await q(EV, [game.id, 'damage', mA, mA, tim.id, 7, 1]);
  await q(EV, [game.id, 'damage', mA, tim.id, mC, 3, 2]);
  await as(U.B);
  [h] = await q(`select * from create_playgroup('H')`);
  mB = (await q(`select my_member_id($1) id`, [h.id]))[0].id;
  D.B1 = await deck('owner_profile_id', U.B, 'B1');
  const [bob] = await q(`select * from create_placeholder($1, 'Bob')`, [h.id]);
  D.O1 = await deck('owner_member_id', bob.id, 'O1');
  gameH = await start(h.id, [P(mB, D.B1, 0), P(bob.id, D.O1, 1)]);
  const r = await rest(g.id);
  ok(JSON.stringify(r) === JSON.stringify({ pg: 1, mem: 3, ph_decks: 1, t1: 1, ses: 1, ga: 1, gp: 3, ge: 2 }), JSON.stringify(r));
  ok(gameH?.id, 'Spiel in H');
});

check('Nicht-Admin C löscht Testgruppe G ⇒ 0 Zeilen gelöscht, alles noch da', async () => {
  const before = await rest(g.id);
  await as(U.C);
  const del = await q(`delete from playgroups where id = $1 returning id`, [g.id]);
  ok(del.length === 0, `gelöscht: ${JSON.stringify(del)}`);
  const after = await rest(g.id);
  ok(JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
});

// Befund P6: Ein einzelnes `delete from playgroups` scheitert, sobald die Gruppe ein Spiel hat —
// game_players.member_id (und .deck_id) verweisen ohne `on delete cascade` auf members/decks
// (init.sql, Tabelle game_players), die Prüfung schlägt an, bevor die Kaskade über games die
// Spieler abräumt. Behebung braucht eine Migration (außerhalb des P6-Write-Sets) ⇒ hier als todo,
// läuft in einer Transaktion mit Rollback (verändert den Zustand nicht) und wird grün, sobald
// eine Migration die Kaskade nachzieht. cleanup() löscht darum erst die Spiele, dann die Gruppe.
test('Einschritt: Admin löscht Gruppe mit Spiel direkt (ohne vorher Spiele zu löschen)', {
  todo: 'Befund P6: FK game_players_member_id_fkey ohne Kaskade — Migration nötig',
}, async () => {
  await as(U.A);
  await db.exec('begin');
  try {
    const e = await err(`delete from playgroups where id = '${g.id}'`);
    ok(e === null, `Fehler: ${e}`);
  } finally { await db.exec('rollback'); }
});

check('Admin A löscht Testgruppe G (erst Spiele, dann Gruppe — Reihenfolge wie cleanup()) ⇒ Erfolg, keine Reste in members/decks(Platzhalter)/sessions/games/game_players/game_events', async () => {
  await as(U.A);
  const e1 = await err(`delete from games where playgroup_id = '${g.id}'`);
  ok(e1 === null, `Fehler Spiele: ${e1}`);
  const e = await err(`delete from playgroups where id = '${g.id}'`);
  ok(e === null, `Fehler: ${e}`);
  const r = await rest(g.id);
  ok(JSON.stringify(r) === JSON.stringify({ pg: 0, mem: 0, ph_decks: 0, t1: 0, ses: 0, ga: 0, gp: 0, ge: 0 }), JSON.stringify(r));
  // fremde Gruppe H unberührt
  await su();
  const hr = await q(`select (select count(*) from playgroups where id = $1)::int pg,
    (select count(*) from games where id = $2)::int ga, (select count(*) from game_players where game_id = $2)::int gp`, [h.id, gameH.id]);
  ok(hr[0].pg === 1 && hr[0].ga === 1 && hr[0].gp >= 1, JSON.stringify(hr[0]));
});

check('Konto-Deck A1 bleibt nach Gruppenlöschung; Besitzer A löscht es (fremdes Konto-Deck C1 nicht)', async () => {
  await su();
  ok((await q(`select count(*)::int n from decks where id = any($1)`, [[D.A1, D.C1]]))[0].n === 2, 'A1/C1 nach Gruppenlöschung vorhanden');
  await as(U.A);
  const foreign = await q(`delete from decks where id = $1 returning id`, [D.C1]);
  ok(foreign.length === 0, `fremdes Deck gelöscht: ${JSON.stringify(foreign)}`);
  const own = await q(`delete from decks where id = $1 returning id`, [D.A1]);
  ok(own.length === 1, `eigenes Deck: ${JSON.stringify(own)}`);
  await su();
  ok((await q(`select count(*)::int n from decks where id = $1`, [D.A1]))[0].n === 0);
  ok((await q(`select count(*)::int n from decks where id = $1`, [D.C1]))[0].n === 1);
});

check('Nach dem Aufräumen sieht Testkonto A keine Gruppe mehr (Abfrage wie cleanup(): count(*) = 0)', async () => {
  await as(U.A);
  ok((await q(`select count(*)::int n from playgroups`))[0].n === 0);
  await as(U.B);
  ok((await q(`select count(*)::int n from playgroups`))[0].n === 1, 'B sieht H weiterhin');
});
