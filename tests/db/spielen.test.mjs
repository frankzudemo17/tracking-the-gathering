// DB-Fälle Etappe 3 „Spielen“ (Migration 20261111000000_spielen.sql) — Spec P4, Tabelle S/U/P/F/D/X.
// EIN Szenario auf EINER Datenbank, Fälle laufen in Reihenfolge (node:test, eine Datei).
// Aufbau: Gruppe G (A Admin, C Mitglied, Platzhalter Tim und Nick), fremde Gruppe H (B, Platzhalter Bob).
// Decks: A1 (A), C1 (C), T1 (Tim), N1 (Nick), B1 (B), O1 (Bob), A2 (A, archiviert).
// Fremde IDs sind absichtlich woanders gültig (B spielt in H, Tim/Nick spielen in anderen G-Spielen),
// damit eine zu schwache Prüfung („existiert irgendwo“) auffällt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261111000000_spielen.sql';
const EXPECTED = 38;
let db, as, su, q, err;
let ran = 0;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const fails = async (sql, params, re) => {
  const e = await err(sql, params);
  ok(e && (!re || re.test(e)), `erwartet Fehler${re ? ' ' + re : ''}, bekam: ${e}`);
  return e;
};
const n = async (sql, params) => (await q(sql, params))[0].n;
const NOBODY = '00000000-0000-4000-8000-0000000000ff';

before(async () => {
  db = await freshDb();
  ({ as, su, q, err } = tools(db));
});
after(async () => {
  await db?.close();
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

// geteilter Zustand
let g, h, mA, mB, mC, tim, nick, bob;
const D = {};
let g1, gS2, gS11a, gS11b, gL5, gL99, gH, gD;

const START = `select * from start_game($1, $2::table_layout, $3, $4, $5::jsonb, $6::date)`;
const start = (group, players, { life = 40, first = 0, layout = 'seiten', day = '2026-11-11' } = {}) =>
  q(START, [group, layout, life, first, JSON.stringify(players), day]).then((r) => r[0]);
const startErr = (group, players, { life = 40, first = 0, layout = 'seiten', day = '2026-11-11' } = {}) =>
  err(START, [group, layout, life, first, JSON.stringify(players), day]);
const P = (member_id, deck_id, seat) => ({ member_id, deck_id, seat });
const FINISH = `select * from finish_game($1, $2::game_status, $3, $4::jsonb)`;
const finish = (game, status, round, results) => q(FINISH, [game, status, round, results == null ? null : JSON.stringify(results)]);
const finishErr = (game, status, round, results) => err(FINISH, [game, status, round, results == null ? null : JSON.stringify(results)]);
const EV = `insert into game_events (game_id, round, type, actor, source, target, amount, payload, seq)
            values ($1, 1, $2::event_type, $3, $4, $5, $6, $7::jsonb, $8) returning id`;
const ev = (game, type, { actor = null, source = null, target = null, amount = null, payload = {}, seq = null } = {}) =>
  q(EV, [game, type, actor, source, target, amount, JSON.stringify(payload), seq]);
const evErr = (game, type, { actor = null, source = null, target = null, amount = null, payload = {}, seq = null } = {}) =>
  err(EV, [game, type, actor, source, target, amount, JSON.stringify(payload), seq]);
const counts = async () => {
  await su();
  return q(`select (select count(*) from games)::int ga, (select count(*) from sessions)::int se, (select count(*) from game_players)::int gp`)
    .then((r) => JSON.stringify(r[0]));
};

// ---------------------------------------------------------------- Aufbau
check('Aufbau: Gruppen G/H, Mitglieder, Platzhalter, Decks, Spiel in H', async () => {
  await su();
  await db.query(`insert into auth.users (id, email) values ($1,'a@x.de'), ($2,'b@x.de'), ($3,'c@x.de'), ($4, null)`, [U.A, U.B, U.C, U.G]);
  await as(U.A);
  [g] = await q(`select * from create_playgroup('G')`);
  [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [g.id]);
  [nick] = await q(`select * from create_placeholder($1, 'Nick')`, [g.id]);
  await as(U.C);
  [{ id: mC }] = await q(`select * from join_playgroup($1)`, [g.invite_code]);
  await as(U.A);
  mA = (await q(`select my_member_id($1) id`, [g.id]))[0].id;
  const deck = async (col, owner, name, archived = false) =>
    (await q(`insert into decks (${col}, commander_name, short_name, archived) values ($1, $2, $2, $3) returning id`, [owner, name, archived]))[0].id;
  D.A1 = await deck('owner_profile_id', U.A, 'A1');
  D.A2 = await deck('owner_profile_id', U.A, 'A2', true);
  D.T1 = await deck('owner_member_id', tim.id, 'T1');
  D.N1 = await deck('owner_member_id', nick.id, 'N1');
  await as(U.C);
  D.C1 = await deck('owner_profile_id', U.C, 'C1');
  await as(U.B);
  [h] = await q(`select * from create_playgroup('H')`);
  [bob] = await q(`select * from create_placeholder($1, 'Bob')`, [h.id]);
  mB = (await q(`select my_member_id($1) id`, [h.id]))[0].id;
  D.B1 = await deck('owner_profile_id', U.B, 'B1');
  D.O1 = await deck('owner_member_id', bob.id, 'O1');
  gH = await start(h.id, [P(mB, D.B1, 0), P(bob.id, D.O1, 1)]);
  ok(gH?.id && Object.values(D).length === 7);
});

// ---------------------------------------------------------------- S: start_game
check('S1 Start ok: live, 3 Spieler, current_turn 1, round 1, 1 Session', async () => {
  await as(U.A);
  g1 = await start(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 1), P(tim.id, D.T1, 2)], { first: 1 });
  ok(g1.status === 'live' && g1.current_turn === 1 && g1.first_seat === 1 && g1.round === 1, JSON.stringify(g1));
  ok(g1.starting_life === 40 && g1.layout === 'seiten' && g1.created_by === U.A && g1.playgroup_id === g.id);
  const gp = await q(`select member_id, deck_id, seat from game_players where game_id = $1 order by seat`, [g1.id]);
  ok(JSON.stringify(gp) === JSON.stringify([
    { member_id: mA, deck_id: D.A1, seat: 0 }, { member_id: mC, deck_id: D.C1, seat: 1 }, { member_id: tim.id, deck_id: D.T1, seat: 2 }]),
  JSON.stringify(gp));
  const ses = await q(`select id, to_char(played_on, 'YYYY-MM-DD') d from sessions where playgroup_id = $1`, [g.id]);
  ok(ses.length === 1 && ses[0].id === g1.session_id && ses[0].d === '2026-11-11', JSON.stringify(ses));
});
check('S11 Session-Fenster: Vorgänger vor 1 h ⇒ gleiche Session', async () => {
  await su();
  await q(`update games set started_at = now() - interval '1 hour' where id = $1`, [g1.id]);
  await as(U.A);
  gS11a = await start(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 1), P(tim.id, D.T1, 2)], { day: '2026-11-12' });
  ok(gS11a.session_id === g1.session_id);
  ok(await n(`select count(*)::int n from sessions where playgroup_id = $1`, [g.id]) === 1);
});
check('S11 Session-Fenster: Vorgänger vor 7 h ⇒ neue Session (Session von H bleibt unberührt)', async () => {
  await su();
  await q(`update games set started_at = now() - interval '7 hours' where playgroup_id = $1`, [g.id]);
  await as(U.A);
  gS11b = await start(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 1), P(tim.id, D.T1, 2)], { day: '2026-11-12' });
  ok(gS11b.session_id && gS11b.session_id !== g1.session_id && gS11b.session_id !== gH.session_id);
  await su();
  const s = await q(`select playgroup_id, to_char(played_on, 'YYYY-MM-DD') d from sessions where id = $1`, [gS11b.session_id]);
  ok(s[0].playgroup_id === g.id && s[0].d === '2026-11-12');
  ok(await n(`select count(*)::int n from sessions where playgroup_id = $1`, [g.id]) === 2);
});
check('S2 Leihdeck: C spielt A1 (C ruft auf, A spielt T1)', async () => {
  await as(U.C);
  gS2 = await start(g.id, [P(mC, D.A1, 0), P(mA, D.T1, 1), P(nick.id, D.N1, 2)]);
  ok(gS2?.id && gS2.session_id === gS11b.session_id);
});
check('S3 Ohne Deck ⇒ Fehler, 0 neue Spiele', async () => {
  const before0 = await counts();
  await as(U.A);
  await fails(START, [g.id, 'seiten', 40, 0, JSON.stringify([P(mA, D.A1, 0), { member_id: tim.id, seat: 1 }]), '2026-11-11'], /braucht ein Deck/);
  await fails(START, [g.id, 'seiten', 40, 0, JSON.stringify([P(mA, D.A1, 0), P(tim.id, null, 1)]), '2026-11-11'], /braucht ein Deck/);
  ok(await counts() === before0);
});
check('S4 Fremdes Deck (B1 aus H) ⇒ Fehler, gleiche Meldung wie unbekanntes Deck', async () => {
  const before0 = await counts();
  await as(U.C);
  const e1 = await startErr(g.id, [P(mA, D.A1, 0), P(mC, D.B1, 1)]);
  const e2 = await startErr(g.id, [P(mA, D.A1, 0), P(mC, NOBODY, 1)]);
  ok(e1 && /Deck nicht verfügbar/.test(e1) && e1 === e2, `${e1} | ${e2}`);
  ok(await counts() === before0);
});
check('S5 Archiviertes Deck ⇒ Fehler', async () => {
  await as(U.A);
  ok(/Deck nicht verfügbar/.test(await startErr(g.id, [P(mA, D.A2, 0), P(mC, D.C1, 1)])));
});
check('S6 Fremdes Mitglied (B, spielt in H) als Spieler in G ⇒ Fehler', async () => {
  await as(U.A);
  ok(/verschiedene Mitglieder dieser Gruppe/.test(await startErr(g.id, [P(mA, D.A1, 0), P(mB, D.C1, 1)])));
  ok(/verschiedene Mitglieder/.test(await startErr(g.id, [P(mA, D.A1, 0), P(mA, D.C1, 1)])), 'doppeltes Mitglied');
});
check('S7 Sitze 0,0,1 bzw. 0,2 bzw. ohne Sitz ⇒ Fehler; Startspieler außerhalb ⇒ Fehler', async () => {
  await as(U.A);
  const r = /Sitzplatz/;
  ok(r.test(await startErr(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 0), P(tim.id, D.T1, 1)])));
  ok(r.test(await startErr(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 2)])));
  ok(r.test(await startErr(g.id, [P(mA, D.A1, 0), { member_id: mC, deck_id: D.C1 }])));
  ok(/Startspieler/.test(await startErr(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 1)], { first: 2 })));
  ok(/Startspieler/.test(await startErr(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 1)], { first: -1 })));
});
check('S8 Anzahl 1 bzw. 7 Spieler ⇒ Fehler', async () => {
  await as(U.A);
  ok(/2 bis 6 Spieler/.test(await startErr(g.id, [P(mA, D.A1, 0)])));
  const seven = [0, 1, 2, 3, 4, 5, 6].map((i) => P(mA, D.A1, i));
  ok(/2 bis 6 Spieler/.test(await startErr(g.id, seven)));
  ok(/2 bis 6 Spieler/.test(await err(START, [g.id, 'seiten', 40, 0, null, '2026-11-11'])));
});
check('S9 Startleben 4 bzw. 100 ⇒ Fehler; 5 und 99 ok', async () => {
  await as(U.A);
  const two = [P(mA, D.A1, 0), P(mC, D.C1, 1)];
  ok(/Startleben/.test(await startErr(g.id, two, { life: 4 })));
  ok(/Startleben/.test(await startErr(g.id, two, { life: 100 })));
  gL5 = await start(g.id, two, { life: 5 });
  gL99 = await start(g.id, two, { life: 99 });
  ok(gL5.starting_life === 5 && gL99.starting_life === 99);
});
check('S10 Nicht-Mitglied B ruft start_game(G) ⇒ Fehler (wie unbekannte Gruppe)', async () => {
  const before0 = await counts();
  await as(U.B);
  const e1 = await startErr(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 1)]);
  const e2 = await startErr(NOBODY, [P(mA, D.A1, 0), P(mC, D.C1, 1)]);
  ok(e1 && /Kein Mitglied/.test(e1) && e1 === e2, `${e1} | ${e2}`);
  ok(await counts() === before0);
});
check('S12 Atomar: Fehler beim Einfügen des 3. Spielers ⇒ keine games-, sessions-, game_players-Zeile übrig', async () => {
  await su();
  // Spieleabend-Fenster abgelaufen ⇒ start_game würde eine NEUE Session anlegen
  await q(`update games set started_at = now() - interval '7 hours' where playgroup_id = $1`, [g.id]);
  await db.exec(`create function public.t_fail_seat2() returns trigger language plpgsql as $$
    begin if new.seat = 2 then raise exception 'Testfehler Sitz 2'; end if; return new; end $$;
    create trigger t_fail_seat2 before insert on public.game_players for each row execute function public.t_fail_seat2();`);
  const before0 = await counts();
  await as(U.A);
  const e = await startErr(g.id, [P(mA, D.A1, 0), P(mC, D.C1, 1), P(tim.id, D.T1, 2)]);
  const after0 = await counts();
  await db.exec(`drop trigger t_fail_seat2 on public.game_players; drop function public.t_fail_seat2();`);
  ok(e && /Testfehler Sitz 2/.test(e), e);
  ok(after0 === before0, `${before0} → ${after0}`);
});

// ---------------------------------------------------------------- U: seq und Undo
check('U1 seq eindeutig: zweimal (Spiel, seq 1) mit on conflict do nothing ⇒ 1 Zeile', async () => {
  await as(U.A);
  await ev(gS2.id, 'life', { actor: mA, target: mA, amount: -1, seq: 1 });
  await q(`insert into game_events (game_id, round, type, actor, target, amount, seq) values ($1, 1, 'life', $2, $2, -1, 1)
           on conflict (game_id, seq) do nothing`, [gS2.id, mA]);
  ok(await n(`select count(*)::int n from game_events where game_id = $1 and seq = 1`, [gS2.id]) === 1);
  ok(!!(await evErr(gS2.id, 'life', { actor: mA, target: mA, amount: -1, seq: 1 })), 'ohne on conflict ⇒ Fehler');
  await ev(gS2.id, 'life', { actor: mA, target: mA, amount: -1 });
  await ev(gS2.id, 'life', { actor: mA, target: mA, amount: -1 });
  ok(await n(`select count(*)::int n from game_events where game_id = $1 and seq is null`, [gS2.id]) === 2, 'NULLs kollidieren nicht');
});
check('U2 Undo per seq in v_damage_matrix', async () => {
  await as(U.A);
  await ev(g1.id, 'damage', { actor: mA, source: mA, target: tim.id, amount: 7, seq: 1 });
  await ev(g1.id, 'damage', { actor: mA, source: tim.id, target: mA, amount: 2, seq: 2 });
  await ev(g1.id, 'undo', { actor: mA, payload: { seq: 1 }, seq: 3 });
  const dm = await q(`select source, target, damage from v_damage_matrix where game_id = $1`, [g1.id]);
  ok(dm.length === 1 && dm[0].source === tim.id && dm[0].target === mA && dm[0].damage === 2, JSON.stringify(dm));
});
check('U3 Undo per event_id weiter gültig', async () => {
  await as(U.A);
  const [{ id }] = await ev(g1.id, 'damage', { actor: mA, source: mC, target: mA, amount: 5, seq: 4 });
  ok((await q(`select count(*)::int n from v_damage_matrix where game_id = $1`, [g1.id]))[0].n === 2);
  await ev(g1.id, 'undo', { actor: mA, payload: { event_id: Number(id) }, seq: 5 });
  const dm = await q(`select source, damage from v_damage_matrix where game_id = $1`, [g1.id]);
  ok(dm.length === 1 && dm[0].source === tim.id && dm[0].damage === 2, JSON.stringify(dm));
});
check('U4 Zugdauer ohne Undo: A 60, kein Eintrag für C', async () => {
  await as(U.A);
  await ev(g1.id, 'turn_end', { actor: mA, payload: { seconds: 60 }, seq: 6 });
  await ev(g1.id, 'turn_end', { actor: mC, payload: { seconds: 300 }, seq: 7 });
  await ev(g1.id, 'undo', { actor: mA, payload: { seq: 7 }, seq: 8 });
  const tt = await q(`select member_id, avg_turn_sec::int a, longest_turn_sec l, turns from v_turn_times where playgroup_id = $1`, [g.id]);
  ok(tt.length === 1 && tt[0].member_id === mA && tt[0].a === 60 && tt[0].l === 60 && tt[0].turns === 1, JSON.stringify(tt));
});
check('U5 Views bleiben security_invoker; B sieht nichts aus G', async () => {
  await su();
  const opts = await q(`select relname, reloptions::text o from pg_class where relname in ('v_damage_matrix', 'v_turn_times') order by relname`);
  ok(opts.length === 2 && opts.every((r) => /security_invoker=true/.test(r.o)), JSON.stringify(opts));
  await as(U.B);
  ok(await n(`select count(*)::int n from v_damage_matrix where game_id = $1`, [g1.id]) === 0);
  ok(await n(`select count(*)::int n from v_turn_times where playgroup_id = $1`, [g.id]) === 0);
});

// ---------------------------------------------------------------- P: Policies
check('P1 Ereignis mit fremdem Ziel (B, spielt in H) ⇒ Fehler', async () => {
  await as(U.A);
  const c0 = await n(`select count(*)::int n from game_events where game_id = $1`, [g1.id]);
  await fails(EV, [g1.id, 'damage', mA, mA, mB, 3, '{}', null]);
  await fails(EV, [g1.id, 'damage', mA, mB, mA, 3, '{}', null]);
  ok(await n(`select count(*)::int n from game_events where game_id = $1`, [g1.id]) === c0);
});
check('P2 Ereignis mit Nicht-Spieler (Tim, spielt in g1, nicht in gS2) ⇒ Fehler', async () => {
  await as(U.A);
  await fails(EV, [gS2.id, 'damage', mA, mA, tim.id, 3, '{}', null]);
  await fails(EV, [gS2.id, 'damage', mA, tim.id, mA, 3, '{}', null]);
});
check('P3 Ereignis mit fremdem actor (B) ⇒ Fehler; eigene Spieler ok', async () => {
  await as(U.A);
  await fails(EV, [g1.id, 'life', mB, null, mA, -1, '{}', null]);
  ok(!(await evErr(gS2.id, 'damage', { actor: mC, source: nick.id, target: mC, amount: 1 })), 'Kontrolle: gültiges Ereignis');
  await as(U.B);
  await fails(EV, [g1.id, 'life', null, null, null, -1, '{}', null]);
});
check('P5 gp_valid Deck: game_players mit B1 ⇒ Fehler; mit C1 für A ok; Update auf B1 ⇒ Fehler', async () => {
  await as(U.A);
  [gD] = await q(`insert into games (playgroup_id, created_by) values ($1, $2) returning *`, [g.id, U.A]);
  await fails(`insert into game_players (game_id, member_id, deck_id, seat) values ($1, $2, $3, 0)`, [gD.id, mA, D.B1]);
  await fails(`insert into game_players (game_id, member_id, deck_id, seat) values ($1, $2, $3, 0)`, [gD.id, mA, D.O1]);
  ok(!(await err(`insert into game_players (game_id, member_id, deck_id, seat) values ($1, $2, $3, 0)`, [gD.id, mA, D.C1])));
  await fails(`update game_players set deck_id = $3 where game_id = $1 and member_id = $2`, [gD.id, mA, D.B1]);
  ok((await q(`select deck_id from game_players where game_id = $1`, [gD.id]))[0].deck_id === D.C1);
});

// ---------------------------------------------------------------- F: finish_game
check('F1 finish ok: finished, ended_at, Plätze; v_game_results Punkte 3/1/0', async () => {
  await as(U.A);
  const [r] = await finish(g1.id, 'finished', 7, [
    { member_id: mA, place: 1, final_life: 12 },
    { member_id: mC, place: 2, eliminated_round: 6, eliminated_by: mA, final_life: 0 },
    { member_id: tim.id, place: 3, eliminated_round: 5, eliminated_by: mC, final_life: -3 }]);
  ok(r.status === 'finished' && r.ended_at && r.round === 7, JSON.stringify(r));
  const gp = await q(`select member_id, place, eliminated_round er, eliminated_by eb, final_life fl from game_players where game_id = $1 order by place`, [g1.id]);
  ok(JSON.stringify(gp) === JSON.stringify([
    { member_id: mA, place: 1, er: null, eb: null, fl: 12 },
    { member_id: mC, place: 2, er: 6, eb: mA, fl: 0 },
    { member_id: tim.id, place: 3, er: 5, eb: mC, fl: -3 }]), JSON.stringify(gp));
  const res = await q(`select member_id, points from v_game_results where game_id = $1 order by place`, [g1.id]);
  ok(JSON.stringify(res.map((x) => x.points)) === '[3,1,0]' && res[0].member_id === mA, JSON.stringify(res));
});
check('P4 Ereignis nach Ende ⇒ Fehler (ev_insert verlangt live)', async () => {
  await as(U.A);
  await fails(EV, [g1.id, 'life', mA, null, mA, -1, '{}', 99]);
});
check('F2 finish unvollständig/ungültig ⇒ Fehler, Spiel bleibt live', async () => {
  await as(U.A);
  const id = gS11b.id;
  const base = () => [{ member_id: mA, place: 1 }, { member_id: mC, place: 2 }, { member_id: tim.id, place: 3 }];
  const bad = [
    ['Spieler fehlt', base().slice(0, 2), /jeden Spieler/],
    ['Spieler doppelt', [base()[0], base()[1], { member_id: mA, place: 3 }], /jeden Spieler/],
    ['fremder Spieler statt Tim', [base()[0], base()[1], { member_id: mB, place: 3 }], /jeden Spieler/],
    ['Platz doppelt', [base()[0], base()[1], { member_id: tim.id, place: 2 }], /Plätze/],
    ['Platz 4', [base()[0], base()[1], { member_id: tim.id, place: 4 }], /Plätze/],
    ['Platz fehlt', [base()[0], base()[1], { member_id: tim.id }], /Plätze/],
    ['eliminated_by fremd (B, spielt in H)', [base()[0], base()[1], { member_id: tim.id, place: 3, eliminated_by: mB }], /Verursacher/],
    ['eliminated_by Nicht-Spieler (Nick, spielt in gS2)', [base()[0], base()[1], { member_id: tim.id, place: 3, eliminated_by: nick.id }], /Verursacher/],
    ['eliminated_by selbst', [base()[0], base()[1], { member_id: tim.id, place: 3, eliminated_by: tim.id }], /Verursacher/],
    ['eliminated_round 0', [base()[0], base()[1], { member_id: tim.id, place: 3, eliminated_round: 0 }], /Ausscheide-Runde/],
  ];
  for (const [name, res, re] of bad) {
    const e = await finishErr(id, 'finished', 4, res);
    ok(e && re.test(e), `${name}: ${e}`);
  }
  ok(/jeden Spieler/.test(await finishErr(id, 'finished', 4, null)), 'ohne Ergebnis');
  ok(/Spielstatus/.test(await finishErr(id, 'live', 4, base())), 'Status live');
  ok(/Runde/.test(await finishErr(id, 'finished', 0, base())), 'Runde 0');
  const st = await q(`select status, ended_at from games where id = $1`, [id]);
  ok(st[0].status === 'live' && st[0].ended_at === null);
  ok(await n(`select count(*)::int n from game_players where game_id = $1 and (place is not null or eliminated_by is not null)`, [id]) === 0);
});
check('F3 abort: aborted, keine Plätze, nicht in v_game_results', async () => {
  await as(U.A);
  const [r] = await finish(gL5.id, 'aborted', 2, null);
  ok(r.status === 'aborted' && r.round === 2 && r.ended_at, JSON.stringify(r));
  ok(await n(`select count(*)::int n from game_players where game_id = $1 and place is not null`, [gL5.id]) === 0);
  ok(await n(`select count(*)::int n from v_game_results where game_id = $1`, [gL5.id]) === 0);
});
check('F4 doppelt beenden ⇒ Fehler', async () => {
  await as(U.A);
  ok(/bereits beendet/.test(await finishErr(g1.id, 'aborted', 8, null)));
  ok(/bereits beendet/.test(await finishErr(gL5.id, 'finished', 3, [{ member_id: mA, place: 1 }, { member_id: mC, place: 2 }])));
  ok((await q(`select status from games where id = $1`, [g1.id]))[0].status === 'finished');
});
check('F5 Fremder B beendet ⇒ Fehler (wie unbekanntes Spiel), Spiel bleibt live', async () => {
  await as(U.B);
  const e1 = await finishErr(gL99.id, 'aborted', 1, null);
  const e2 = await finishErr(NOBODY, 'aborted', 1, null);
  ok(e1 && /nicht gefunden/.test(e1) && e1 === e2, `${e1} | ${e2}`);
  await as(U.A);
  ok((await q(`select status from games where id = $1`, [gL99.id]))[0].status === 'live');
});

// ---------------------------------------------------------------- D: Feldfarbe und Pins
const deckRow = async (id) => { await su(); return (await q(`select * from decks where id = $1`, [id]))[0]; };
check('D1 Feldfarbe fremdes Konto-Deck: C setzt A1 ⇒ ok, nur field_color geändert', async () => {
  const before0 = await deckRow(D.A1);
  await as(U.C);
  const [r] = await q(`select * from set_deck_field_color($1, '#2D6DB5')`, [D.A1]);
  const after0 = await deckRow(D.A1);
  ok(r.field_color === '#2D6DB5' && after0.field_color === '#2D6DB5');
  ok(JSON.stringify({ ...before0, field_color: null }) === JSON.stringify({ ...after0, field_color: null }));
});
check('D2 Feldfarbe zurück auf null', async () => {
  await as(U.C);
  await q(`select * from set_deck_field_color($1, null)`, [D.A1]);
  ok((await deckRow(D.A1)).field_color === null);
});
check('D3 ungültige Farbe ⇒ Fehler', async () => {
  await as(U.C);
  for (const c of ['red', '#12345', '#GGGGGG', '#2D6DB5 ', '']) ok(/Ungültige Farbe/.test(await err(`select * from set_deck_field_color($1, $2)`, [D.A1, c])), c);
  ok((await deckRow(D.A1)).field_color === null);
});
check('D4 Fremder B setzt A1 ⇒ Fehler (wie unbekanntes Deck)', async () => {
  await as(U.B);
  const e1 = await err(`select * from set_deck_field_color($1, '#000000')`, [D.A1]);
  const e2 = await err(`select * from set_deck_field_color($1, '#000000')`, [NOBODY]);
  const e3 = await err(`select * from set_deck_counter_pins($1, array['speed'])`, [D.A1]);
  ok(e1 && /nicht gefunden/.test(e1) && e1 === e2 && e3 === e1, `${e1} | ${e2} | ${e3}`);
  const r = await deckRow(D.A1);
  ok(r.field_color === null && JSON.stringify(r.counter_pins) === '["poison","tax"]');
});
check('D5 Pins: [poison, tax, poison, speed] ⇒ [poison, tax, speed]; leer erlaubt; Platzhalter-Deck ok', async () => {
  await as(U.C);
  const [r] = await q(`select * from set_deck_counter_pins($1, array['poison','tax','poison','speed'])`, [D.A1]);
  ok(JSON.stringify(r.counter_pins) === '["poison","tax","speed"]', JSON.stringify(r.counter_pins));
  ok(JSON.stringify((await deckRow(D.A1)).counter_pins) === '["poison","tax","speed"]');
  await as(U.C);
  ok(JSON.stringify((await q(`select * from set_deck_counter_pins($1, '{}'::text[])`, [D.T1]))[0].counter_pins) === '[]');
  ok(!(await err(`select * from set_deck_field_color($1, '#aabbcc')`, [D.T1])));
});
check('D6 Pins ungültig ⇒ Fehler', async () => {
  await as(U.C);
  ok(/Ungültiger Zähler/.test(await err(`select * from set_deck_counter_pins($1, array['poison','life'])`, [D.A1])));
  ok(/Ungültiger Zähler/.test(await err(`select * from set_deck_counter_pins($1, array['poison', null])`, [D.A1])));
  ok(/Ungültiger Zähler/.test(await err(`select * from set_deck_counter_pins($1, null)`, [D.A1])));
  ok(JSON.stringify((await deckRow(D.A1)).counter_pins) === '["poison","tax","speed"]');
});
check('D7 direktes UPDATE bleibt gesperrt: 0 Zeilen', async () => {
  await as(U.C);
  const upd = await q(`update decks set field_color = '#000000' where id = $1 returning id`, [D.A1]);
  ok(upd.length === 0 && (await deckRow(D.A1)).field_color === null);
});

// ---------------------------------------------------------------- X: Rechte, Rückwärts
const RPCS = [
  ['start_game', `select * from start_game($1, 'seiten', 40, 0, $2::jsonb, '2026-11-11')`, () => [g.id, JSON.stringify([P(mA, D.A1, 0), P(mC, D.C1, 1)])]],
  ['finish_game', `select * from finish_game($1, 'aborted', 1, null)`, () => [gL99.id]],
  ['set_deck_field_color', `select * from set_deck_field_color($1, '#000000')`, () => [D.G1]],
  ['set_deck_counter_pins', `select * from set_deck_counter_pins($1, array['speed'])`, () => [D.G1]],
];
check('X1 anon und anonymes Konto: jede neue RPC ⇒ Fehler (auch auf eigenem Deck)', async () => {
  await as(U.G, { anonymous: true });
  D.G1 = (await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'G1', 'G1') returning id`, [U.G]))[0].id;
  const before0 = await counts();
  for (const [name, sql, args] of RPCS) {
    await as(U.G, { anonymous: true });
    ok(/Nicht angemeldet/.test(await err(sql, args())), `anonym ${name}`);
    await as(null);
    ok(/permission denied/.test(await err(sql, args())), `anon ${name}`);
  }
  ok(await counts() === before0);
  const r = await deckRow(D.G1);
  ok(r.field_color === null && JSON.stringify(r.counter_pins) === '["poison","tax"]');
  ok((await q(`select status from games where id = $1`, [gL99.id]))[0].status === 'live');
  const priv = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
                        from pg_proc p where p.pronamespace = 'public'::regnamespace
                          and p.proname in ('start_game','finish_game','set_deck_field_color','set_deck_counter_pins','deck_in_group') order by 1`);
  ok(priv.length === 5 && priv.every((p) => !p.a && p.u === (p.proname !== 'deck_in_group')), JSON.stringify(priv));
  await as(U.C);
  ok(/permission denied/.test(await err(`select deck_in_group($1, $2)`, [D.B1, h.id])), 'Hilfe nicht per RPC');
});

const CATALOG = `select json_build_object(
  'functions', (select json_agg(x order by x) from (select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
      || md5(p.prosrc) || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') || '|' || coalesce(p.proacl::text, '') x
      from pg_proc p where p.pronamespace = 'public'::regnamespace) f),
  'policies', (select json_agg(x order by x) from (select tablename || '.' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') x
      from pg_policies where schemaname = 'public') f),
  'views', (select json_agg(x order by x) from (select c.relname || '|' || pg_get_viewdef(c.oid) || '|' || coalesce(c.reloptions::text, '') x
      from pg_class c where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace) f),
  'columns', (select json_agg(x order by x) from (select table_name || '.' || column_name || '|' || data_type || '|' || is_nullable x
      from information_schema.columns where table_schema = 'public') f),
  'constraints', (select json_agg(x order by x) from (select conrelid::regclass::text || '.' || conname || '|' || pg_get_constraintdef(oid) x
      from pg_constraint where connamespace = 'public'::regnamespace) f)
)::text j`;
check('X2 Rückwärts-Block: neue Objekte weg, Schema gleich dem Stand ohne die Migration', async () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  const m = sql.match(/-- RÜCKWÄRTS-BEGINN\r?\n([\s\S]*?)-- RÜCKWÄRTS-ENDE/);
  ok(m, 'Rückwärts-Block nicht gefunden');
  const lines = m[1].split(/\r?\n/).filter((l) => l !== '');
  ok(lines.every((l) => l.startsWith('-- ')), 'jede Zeile beginnt mit „-- “');
  const back = lines.map((l) => l.slice(3)).join('\n');
  // Vergleichs-DB: alle Migrationen außer dieser
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-p4-'));
  let ref;
  try {
    for (const f of fs.readdirSync(MIGRATIONS)) if (f.endsWith('.sql') && f !== FILE) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
    ref = await freshDb({ migrations: dir });
    const want = (await ref.query(CATALOG)).rows[0].j;
    await su();
    const pre = (await q(CATALOG))[0].j;
    ok(pre !== want, 'vor dem Rückwärts-Block unterscheiden sich die Schemata');
    await db.exec(back);
    const got = (await q(CATALOG))[0].j;
    if (got !== want) {
      const a = JSON.parse(got), b = JSON.parse(want);
      const diff = Object.keys(b).map((k) => [k, (a[k] || []).filter((x) => !(b[k] || []).includes(x)), (b[k] || []).filter((x) => !(a[k] || []).includes(x))])
        .filter(([, x, y]) => x.length || y.length);
      assert.fail(`Schema nach Rückwärts ≠ Stand ohne Migration: ${JSON.stringify(diff).slice(0, 2000)}`);
    }
    // Daten bleiben: Spiele und Ereignisse überleben den Rückwärtsweg
    ok(await n(`select count(*)::int n from game_events where game_id = $1`, [g1.id]) > 0);
    ok(await n(`select count(*)::int n from v_damage_matrix`) >= 1);
  } finally {
    await ref?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
