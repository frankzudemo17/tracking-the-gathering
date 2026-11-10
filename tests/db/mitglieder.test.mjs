// P10 Mitglieder (spec-p10-mitglieder.md, Migration 20261117000000_mitglieder.sql): Spieler ohne Konto
// entfernen (löschen oder markieren), wiederherstellen, Sperre für neue Spiele, eingefrorene Zeilen,
// Superadmin verlässt/betritt Gruppen, Block K (Mitglieder mit Konto). Bestand auf eigener Datenbank
// (Migration erst nach dem Aufbau), Haupt-Szenario auf EINER Datenbank (Fälle laufen in Reihenfolge).
//
// Gegenproben (Spec „Spec-Tests“):
//   GEGENPROBE=1        ⇒ alle Migrationen AUSSER dieser ⇒ die Datei muss rot sein
//   GEGENPROBE=trigger  ⇒ Trigger ttg_gp_member_active im Test abgeschaltet ⇒ Krit. 7 rot
//                         (zeigt: der Trigger sperrt, nicht start_game)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261117000000_mitglieder.sql';
const GEGEN = process.env.GEGENPROBE || '';
const EXPECTED = 10;
let ran = 0;
let gegenDir = null;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const eq = (a, b, info) => assert.deepEqual(a, b, info);
const J = (x) => JSON.stringify(x);
const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** Migrationsordner: normal alle; Gegenprobe (a) alle außer dieser. */
function migrations() {
  if (GEGEN !== '1') return MIGRATIONS;
  if (!gegenDir) {
    gegenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-p10-gegen-'));
    for (const f of fs.readdirSync(MIGRATIONS)) if (f.endsWith('.sql') && f !== FILE) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(gegenDir, f));
  }
  return gegenDir;
}

/** Zeilenzahlen aller Tabellen in public (als Superuser). */
async function allCounts(d) {
  const t = (await d.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows;
  const out = {};
  for (const { table_name } of t) out[table_name] = (await d.query(`select count(*)::int n from public."${table_name}"`)).rows[0].n;
  return out;
}

const START = `select * from start_game($1, 'seiten', 40, 0, $2::jsonb, '2026-11-17')`;
const P = (member_id, deck_id, seat) => ({ member_id, deck_id, seat });
const R = (member_id, place, eliminated_by = null) => ({ member_id, place, eliminated_round: place === 1 ? null : 2, eliminated_by, final_life: place === 1 ? 12 : 0 });

after(async () => {
  if (gegenDir) fs.rmSync(gegenDir, { recursive: true, force: true });
  // Schutz: bricht ein Szenario still ab, darf die Zahl nicht schrumpfen und trotzdem grün sein.
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

// ================================================================ Krit. 1: Bestand
check('K1 Bestand: Migration löscht und ändert nichts; neue Spalten leer, vom Client nicht setzbar, Check gegen Konto', async () => {
  const d = await freshDb({ migrations: migrations(), until: FILE });
  const { as, su, q, err, seedUser, mkGroup } = tools(d);
  try {
    for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de'], [U.C, 'c@x.de']]) await seedUser(id, { email });
    const x = await mkGroup(U.A, 'X');
    const y = await mkGroup(U.C, 'Y');
    await as(U.B);
    const [{ id: mB }] = await q(`select * from join_playgroup($1)`, [x.invite_code]);
    await as(U.A);
    const mA = (await q(`select my_member_id($1) id`, [x.id]))[0].id;
    const [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [x.id]);
    await as(U.C);
    await q(`select * from create_placeholder($1, 'Ole')`, [y.id]);
    await as(U.A);
    const [{ id: dA }] = await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'A1', 'A1') returning id`, [U.A]);
    const [{ id: dT }] = await q(`insert into decks (owner_member_id, commander_name, short_name) values ($1, 'T1', 'T1') returning id`, [tim.id]);
    await as(U.B);
    const [{ id: dB }] = await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'B1', 'B1') returning id`, [U.B]);
    await as(U.A);
    const [g] = await q(START, [x.id, J([P(mA, dA, 0), P(mB, dB, 1), P(tim.id, dT, 2)])]);
    await q(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [g.id, J([R(mA, 1), R(mB, 2, mA), R(tim.id, 3, mB)])]);

    await su();
    const before0 = await allCounts(d);
    ok(before0.members === 5 && before0.games === 1 && before0.game_players === 3, J(before0));
    const membersBefore = (await q(`select * from members order by id`)).map((r) => J(r));
    if (GEGEN !== '1') await d.exec(fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8'));
    eq(await allCounts(d), before0, 'Zeilenzahlen aller public-Tabellen vor = nach');
    const after0 = await q(`select * from members order by id`);
    ok(after0.every((r) => r.removed_at === null && r.removed_by === null && r.former_profile_id === null), 'drei neue Spalten null');
    // alte Spalten feldgleich
    eq(after0.map(({ removed_at, removed_by, former_profile_id, ...r }) => J(r)), membersBefore, 'Bestandsspalten unverändert');

    // Client (Gruppen-Admin) setzt keine der neuen Spalten — Spaltenfreigabe nur display_name, avatar_path
    await as(U.A);
    for (const col of [`removed_at = now()`, `removed_by = '${U.A}'`, `former_profile_id = '${U.B}'`]) {
      const e = await err(`update members set ${col} where id = $1`, [tim.id]);
      ok(/permission denied/.test(e || ''), `${col}: ${e}`);
    }
    // Superuser: removed_at auf einer Zeile mit Konto ⇒ Check-Verletzung
    await su();
    ok(/members_removed_no_account/.test(await err(`update members set removed_at = now() where id = $1`, [mB]) || ''), 'Check removed_at ⇒ kein Konto');
    ok(/members_former_no_account/.test(await err(`update members set former_profile_id = $2 where id = $1`, [mB, U.C]) || ''), 'Check former ⇒ kein Konto');
    // Index für can_see_deck
    ok((await q(`select count(*)::int n from pg_indexes where tablename = 'game_players' and indexdef like '%(deck_id)%'`))[0].n === 1, 'Index game_players(deck_id)');
  } finally {
    await d.close();
  }
});

// ================================================================ Haupt-Szenario (eine Datenbank)
let db, as, su, q, err, seedUser, mkGroup;
let X, Y, mA, mB; // A Admin X, B Mitglied X, C Admin Y, D Superadmin ohne Gruppe
const ph = {}; // Platzhalter in X
const dk = {}; // Decks
let gLive;
const SAU = U.D;
const n = async (sql, params) => (await q(sql, params))[0].n;
const rpc = (fn, ...args) => q(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then((r) => r[0].r);
const rpcErr = (fn, ...args) => err(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args);
const CARD = (deck) => q(`insert into deck_cards (deck_id, section, qty, name, scryfall_id) values ($1, 'main', 1, 'Sol Ring', gen_random_uuid())`, [deck]);
const mkDeck = async (owner, name) => (await q(`insert into decks (owner_member_id, commander_name, short_name) values ($1, $2, $2) returning id`, [owner, name]))[0].id;
const CODE_RE = /^[A-Z]{1,4}-[A-HJ-NP-Z2-9]{6}$/;
const row = async (id) => { await su(); return (await q(`select * from members where id = $1`, [id]))[0]; };
const counts = async () => { await su(); return allCounts(db); };

before(async () => {
  db = await freshDb({ migrations: migrations() });
  ({ as, su, q, err, seedUser, mkGroup } = tools(db));
});
after(async () => { await db?.close(); });

check('Aufbau: A Admin X, B Mitglied X, C Admin Y, D Superadmin ohne Gruppe; Platzhalter a–d, s1, s2, f in X', async () => {
  for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de'], [U.C, 'c@x.de'], [U.D, 'd@x.de'], [U.G, null]]) await seedUser(id, { email, anonymous: id === U.G });
  X = await mkGroup(U.A, 'X');
  Y = await mkGroup(U.C, 'Y');
  await su();
  await q(`update profiles set is_superadmin = true where id = $1`, [SAU]);
  await as(U.B);
  [{ id: mB }] = await q(`select * from join_playgroup($1)`, [X.invite_code]);
  await as(U.A);
  mA = (await q(`select my_member_id($1) id`, [X.id]))[0].id;
  for (const k of ['a', 'b', 'c', 'd', 's1', 's2', 'f']) [ph[k]] = await q(`select * from create_placeholder($1, $2)`, [X.id, 'Tim' + k]);
  dk.A = (await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'A1', 'A1') returning id`, [U.A]))[0].id;
  dk.s2 = await mkDeck(ph.s2.id, 'S2');
  await as(U.B);
  dk.B = (await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'B1', 'B1') returning id`, [U.B]))[0].id;
  await as(U.A);
  // b: Avatar-Objekt + 2 ungespielte Decks mit Deckliste (eins Version des anderen)
  dk.b1 = await mkDeck(ph.b.id, 'B1');
  dk.b2 = await mkDeck(ph.b.id, 'B2');
  await q(`update decks set version_of = $1 where id = $2`, [dk.b1, dk.b2]);
  await su(); await CARD(dk.b1); await CARD(dk.b2); // Deckliste schreibt sonst nur ein RPC
  await as(U.A);
  await q(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`members/${ph.b.id}/avatar.jpg`]);
  await q(`update members set avatar_path = $2 where id = $1`, [ph.b.id, `members/${ph.b.id}/avatar.jpg`]);
  // c: 1 beendetes + 1 laufendes Spiel; avatar_path ohne Objekt
  dk.c = await mkDeck(ph.c.id, 'C1');
  const [g1] = await q(START, [X.id, J([P(mA, dk.A, 0), P(ph.c.id, dk.c, 1)])]);
  await q(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [g1.id, J([R(mA, 1), R(ph.c.id, 2, mA)])]);
  [gLive] = await q(START, [X.id, J([P(mB, dk.B, 0), P(ph.c.id, dk.c, 1)])]);
  await q(`update members set avatar_path = $2 where id = $1`, [ph.c.id, `members/${ph.c.id}/avatar.jpg`]);
  // d: kein eigenes Spiel, aber sein Deck spielte A; avatar_path mit Objekt
  dk.d = await mkDeck(ph.d.id, 'D1');
  const [g3] = await q(START, [X.id, J([P(mA, dk.d, 0), P(mB, dk.B, 1)])]);
  await q(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [g3.id, J([R(mA, 1), R(mB, 2, mA)])]);
  await q(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`members/${ph.d.id}/avatar.jpg`]);
  await q(`update members set avatar_path = $2 where id = $1`, [ph.d.id, `members/${ph.d.id}/avatar.jpg`]);
  // s2: ein beendetes Spiel (für den Superadmin, Modus mark)
  const [g4] = await q(START, [X.id, J([P(mA, dk.A, 0), P(ph.s2.id, dk.s2, 1)])]);
  await q(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g4.id, J([R(mA, 1), R(ph.s2.id, 2, mA)])]);
  // f: frühere Konto-Zeile (wie nach F/K), per Superuser hergestellt
  await su();
  await q(`update members set removed_at = now(), removed_by = $2, former_profile_id = $2, claim_code = null where id = $1`, [ph.f.id, U.B]);
  ok(await n(`select count(*)::int n from members where playgroup_id = $1`, [X.id]) === 9);
});

// ================================================================ Krit. 2: Probelauf
check('K2 Probelauf: exakte Rückgabe (a) frisch, (b) Avatar + 2 Decks, (c) beendet + laufend, (d) nur Deck gespielt; ändert nichts', async () => {
  const c0 = await counts();
  await as(U.A);
  eq(await rpc('member_removal_check', ph.a.id), { mode: 'delete', games: 0, live_games: 0, decks: 0, files: [] });
  eq(await rpc('member_removal_check', ph.b.id), { mode: 'delete', games: 0, live_games: 0, decks: 2, files: [`members/${ph.b.id}/avatar.jpg`] });
  eq(await rpc('member_removal_check', ph.c.id), { mode: 'mark', games: 2, live_games: 1, decks: 1, files: [] });
  eq(await rpc('member_removal_check', ph.d.id), { mode: 'mark', games: 0, live_games: 0, decks: 1, files: [`members/${ph.d.id}/avatar.jpg`] });
  eq(await counts(), c0, 'Zeilenzahlen unverändert');
  ok(await n(`select count(*)::int n from members where removed_at is not null`) === 1, 'nur f entfernt');
  eq((await q(`select version_of from decks where id = $1`, [dk.b2]))[0].version_of, dk.b1, 'Versionsverweis zurückgerollt');
});

// ================================================================ Krit. 5: Erwartung
check('K5 Erwartung: falscher, unbekannter, leerer Modus ⇒ member_state_changed, nichts geändert', async () => {
  const c0 = await counts();
  await as(U.A);
  for (const [id, exp] of [[ph.c.id, 'delete'], [ph.a.id, 'mark'], [ph.a.id, 'x'], [ph.a.id, null]]) {
    eq(await rpcErr('remove_member', id, exp), 'member_state_changed', `${exp}`);
  }
  eq(await counts(), c0);
  ok(await n(`select count(*)::int n from members where removed_at is not null`) === 1);
});

// ================================================================ Krit. 3: Wirklich löschen
check('K3 Löschen: (a) deleted; (b) member_files_pending solange das Objekt liegt, danach Zeile + Decks + deck_cards weg', async () => {
  const c0 = await counts();
  await as(U.A);
  eq(await rpc('remove_member', ph.a.id, 'delete'), { result: 'deleted' });
  ok(await n(`select count(*)::int n from members where id = $1`, [ph.a.id]) === 0);
  eq(await counts(), { ...c0, members: c0.members - 1 });
  const rb = await row(ph.b.id);
  await as(U.A);
  eq(await rpcErr('remove_member', ph.b.id, 'delete'), 'member_files_pending');
  eq(await row(ph.b.id), rb, 'Zeile unverändert');
  eq(await counts(), { ...c0, members: c0.members - 1 }, 'Decks unverändert');
  await as(U.A);
  await q(`delete from storage.objects where name = $1`, [`members/${ph.b.id}/avatar.jpg`]);
  eq(await rpc('remove_member', ph.b.id, 'delete'), { result: 'deleted' });
  eq(await counts(), { ...c0, members: c0.members - 2, decks: c0.decks - 2, deck_cards: c0.deck_cards - 2 });
});

// ================================================================ Krit. 4: Markieren
check('K4 Markieren: (c) marked, Historie zeilengleich, Code tot; avatar_path ohne Objekt geleert, mit Objekt (d) unverändert', async () => {
  const c0 = await counts();
  const code = (await row(ph.c.id)).claim_code;
  ok(CODE_RE.test(code), code);
  await as(U.A);
  eq(await rpc('remove_member', ph.c.id, 'mark'), { result: 'marked' });
  eq(await rpc('remove_member', ph.d.id, 'mark'), { result: 'marked' });
  eq(await counts(), c0, 'keine Zeile angelegt oder gelöscht');
  const rc = await row(ph.c.id);
  ok(rc.removed_at && rc.removed_by === U.A && rc.claim_code === null && rc.profile_id === null, J(rc));
  ok(rc.avatar_path === null, 'Pfad ohne Objekt geleert');
  eq((await row(ph.d.id)).avatar_path, `members/${ph.d.id}/avatar.jpg`, 'Pfad mit Objekt bleibt');
  // Übernahme mit altem Code: wie unbekannter Code
  await as(U.C);
  const viaOld = await q(`select claim_member($1) r`, [code]);
  const viaUnknown = await q(`select claim_member('TIMC-ZZZZZZ') r`);
  eq(viaOld, viaUnknown);
  ok(viaOld[0].r === null);
  ok((await row(ph.c.id)).profile_id === null);
  // zweiter Aufruf
  await as(U.A);
  eq(await rpc('remove_member', ph.c.id, 'mark'), { result: 'already' });
  eq(await rpc('remove_member', ph.c.id, 'delete'), { result: 'already' }, 'already vor dem Moduscheck (zweites Gerät)');
  const rc2 = await row(ph.c.id);
  eq(rc2.removed_at, rc.removed_at, 'removed_at unverändert');
  await as(U.A);
  eq((await rpc('member_removal_check', ph.c.id)).mode, 'already');
});

// ================================================================ Krit. 6: Rechte
check('K6 Rechte je Funktion: ohne Sitzung/anonym, Mitglied, fremder Admin, unbekannt, Konto-Ziel; Superadmin ohne Mitgliedschaft gelingt', async () => {
  const FN = [['member_removal_check', (id) => [id]], ['remove_member', (id) => [id, 'mark']], ['restore_member', (id) => [id]]];
  const c0 = await counts();
  const rs = await q(`select * from members order by id`);
  for (const [fn, args] of FN) {
    await as(null);
    ok(/permission denied/.test(await rpcErr(fn, ...args(ph.s2.id)) || ''), `anon ohne execute: ${fn}`);
    await as(null);
    await db.exec('reset role; set role authenticated;'); // Rolle ohne Sitzung (auth.uid() leer)
    eq(await rpcErr(fn, ...args(ph.s2.id)), 'Nicht angemeldet', `ohne Sitzung ${fn}`);
    await as(U.G, { anonymous: true });
    eq(await rpcErr(fn, ...args(ph.s2.id)), 'Nicht angemeldet', `anonym ${fn}`);
    for (const [who, target] of [[U.B, ph.s2.id], [U.C, ph.s2.id], [U.A, '00000000-0000-4000-8000-00000000dead']]) {
      await as(who);
      eq(await rpcErr(fn, ...args(target)), 'not_group_admin', `${fn} ${who}`);
    }
    for (const [who, target] of [[U.A, mB], [U.A, mA], [SAU, mA]]) {
      await as(who);
      eq(await rpcErr(fn, ...args(target)), 'member_has_account', `${fn} Konto-Ziel`);
    }
  }
  eq(await counts(), c0);
  eq(await q(`select * from members order by id`), rs, 'nichts geändert');
  // Superadmin ohne Mitgliedschaft: delete (ohne Datei) und mark
  await as(SAU);
  ok((await q(`select is_group_member($1) x`, [X.id]))[0].x === false);
  eq((await rpc('member_removal_check', ph.s1.id)).mode, 'delete');
  eq(await rpc('remove_member', ph.s1.id, 'delete'), { result: 'deleted' });
  eq(await rpc('remove_member', ph.s2.id, 'mark'), { result: 'marked' });
  ok((await row(ph.s2.id)).removed_by === SAU);
});

// ================================================================ Krit. 8: Wiederherstellen
check('K8 Wiederherstellen: aktiv, neuer Code im Format, Spiel startbar, Übernahme gelingt; aktive Zeile unverändert; frühere Konto-Zeile gesperrt', async () => {
  const old = await row(ph.s2.id);
  await as(U.A);
  const [r] = await q(`select * from restore_member($1)`, [ph.s2.id]);
  ok(r.removed_at === null && r.removed_by === null && r.profile_id === null, J(r));
  ok(CODE_RE.test(r.claim_code) && r.claim_code.startsWith('TIMS-') && r.claim_code !== old.claim_code, r.claim_code);
  ok(r.id === ph.s2.id && r.display_name === old.display_name);
  eq((await q(`select * from restore_member($1)`, [ph.s2.id]))[0], r, 'aktive Zeile unverändert');
  eq(await rpcErr('restore_member', ph.f.id), 'member_has_account');
  const [g] = await q(START, [X.id, J([P(mA, dk.A, 0), P(ph.s2.id, dk.s2, 1)])]);
  await q(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g.id, J([R(mA, 1), R(ph.s2.id, 2, mA)])]);
  await seedUser(uid(101), { email: 'e@x.de' });
  await as(uid(101));
  const [cl] = await q(`select * from claim_member($1)`, [r.claim_code]);
  ok(cl.id === ph.s2.id && cl.profile_id === uid(101), J(cl));
});

// ================================================================ Krit. 13: Rechte und Stolperdraht
check('K13 Stolperdraht: Fremdschlüssel auf members und decks = feste Liste aus B', async () => {
  await su();
  const fk = await q(`select c.conrelid::regclass::text || '.' || a.attname || ' -> ' || c.confrelid::regclass::text || ' ' || c.confdeltype::text x
                      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                      where c.contype = 'f' and c.confrelid in ('public.members'::regclass, 'public.decks'::regclass) order by 1`);
  eq(fk.map((r) => r.x), [
    'deck_cards.deck_id -> decks c',
    'deck_salt_ratings.deck_id -> decks a',
    'deck_salt_ratings.rater_id -> members a',
    'decks.owner_member_id -> members c',
    'decks.version_of -> decks a',
    'game_events.actor -> members a',
    'game_events.source -> members a',
    'game_events.target -> members a',
    'game_players.deck_id -> decks a',
    'game_players.eliminated_by -> members a',
    'game_players.member_id -> members a',
    'player_ratings.member_id -> members a',
    'potg_votes.voted_for -> members a',
    'potg_votes.voter_id -> members a',
  ]);
});

check('K13 Ausführungsrechte: RPCs nur authenticated, interne Hilfen für keine Client-Rolle', async () => {
  await su();
  const want = {
    'member_removal_check(uuid)': [false, true], 'remove_member(uuid,text)': [false, true], 'restore_member(uuid)': [false, true],
    '_member_delete(uuid)': [false, false], '_member_deletable(uuid)': [false, false],
  };
  const got = {};
  for (const sig of Object.keys(want)) {
    const [r] = await q(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u`, ['public.' + sig]);
    got[sig] = [r.a, r.u];
  }
  eq(got, want);
  const sd = await q(`select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1) order by 1`, [Object.keys(want).map((s) => s.split('(')[0])]);
  ok(sd.length === 5 && sd.every((p) => p.prosecdef && J(p.proconfig) === '["search_path=public"]'), J(sd));
});
