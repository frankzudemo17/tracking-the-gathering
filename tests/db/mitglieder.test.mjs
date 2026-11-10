// P10 Mitglieder (spec-p10-mitglieder.md, Migration 20261117000000_mitglieder.sql): Spieler ohne Konto
// entfernen (löschen oder markieren), wiederherstellen, Sperre für neue Spiele, eingefrorene Zeilen,
// Superadmin verlässt/betritt Gruppen, Block K (Mitglieder mit Konto). Bestand auf eigener Datenbank
// (Migration erst nach dem Aufbau), Haupt-Szenario auf EINER Datenbank (Fälle laufen in Reihenfolge).
//
// Gegenproben (Spec „Spec-Tests“):
//   GEGENPROBE=1        ⇒ alle Migrationen AUSSER dieser ⇒ die Datei muss rot sein
//   GEGENPROBE=trigger  ⇒ Trigger ttg_gp_member_active im Test abgeschaltet ⇒ Krit. 7 rot
//                         (zeigt: der Trigger sperrt, nicht start_game)
//   GEGENPROBE=detach   ⇒ _member_detach mit dem alten Verhalten (ältere frühere Zeile verliert den
//                         Kontobezug) ⇒ „Frühere Zeilen“ (Spec-Nachtrag B2) rot
//   GEGENPROBE=restore  ⇒ restore_member ohne die had_account-Prüfung ⇒ „Gelöschte Konten“ (a)/(b) rot
//                         (der Check members_had_account_no_code hält den Code dann noch auf, aber mit
//                         anderer Meldung — die Fälle prüfen ausdrücklich member_has_account)
//   GEGENPROBE=check    ⇒ Check members_had_account_no_code abgeschaltet ⇒ „Gelöschte Konten“ (f) rot
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';
import { probeMembers, membersCleanup } from '../e2e/fixture-members.mjs';

const FILE = '20261117000000_mitglieder.sql';
const GEGEN = process.env.GEGENPROBE || '';
const EXPECTED = 25;
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
    // had_account: hier nur Konten und Platzhalter mit Code ⇒ überall false (Bestand gelöschter Konten: eigener Fall „Gelöschte Konten (e)“)
    ok(after0.every((r) => r.had_account === false), 'had_account false');
    // alte Spalten feldgleich
    eq(after0.map(({ removed_at, removed_by, former_profile_id, had_account, ...r }) => J(r)), membersBefore, 'Bestandsspalten unverändert');

    // Client (Gruppen-Admin) setzt keine der neuen Spalten — Spaltenfreigabe nur display_name, avatar_path
    await as(U.A);
    for (const col of [`removed_at = now()`, `removed_by = '${U.A}'`, `former_profile_id = '${U.B}'`, `had_account = true`]) {
      const e = await err(`update members set ${col} where id = $1`, [tim.id]);
      ok(/permission denied/.test(e || ''), `${col}: ${e}`);
    }
    // Superuser: removed_at auf einer Zeile mit Konto ⇒ Check-Verletzung
    await su();
    ok(/members_removed_no_account/.test(await err(`update members set removed_at = now() where id = $1`, [mB]) || ''), 'Check removed_at ⇒ kein Konto');
    ok(/members_former_no_account/.test(await err(`update members set former_profile_id = $2 where id = $1`, [mB, U.C]) || ''), 'Check former ⇒ kein Konto');
    // Index für can_see_deck
    ok((await q(`select count(*)::int n from pg_indexes where tablename = 'game_players' and indexdef like '%(deck_id)%'`))[0].n === 1, 'Index game_players(deck_id)');
    // Spec-Nachtrag „Frühere Zeilen“: (playgroup_id, former_profile_id) mit Index, aber NICHT eindeutig
    const fi = await q(`select indexname, indexdef from pg_indexes where tablename = 'members' and indexdef like '%former_profile_id%'`);
    ok(fi.length === 1 && fi[0].indexname === 'members_group_former_profile_idx' && !/UNIQUE/i.test(fi[0].indexdef), J(fi));
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
  if (GEGEN === 'trigger') await db.exec('alter table public.game_players disable trigger ttg_gp_member_active;');
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
    // Konto-Ziel. Basis: alle drei member_has_account (Ausgabe am Basis-Commit 85d2879 aufbewahrt).
    // Block K (E-K = ja) ersetzt das für Probelauf/Entfernen: sich selbst ⇒ member_is_self, Admin ⇒
    // member_is_admin (Reihenfolge selbst → Superadmin → Admin); Wiederherstellen bleibt gesperrt (K4).
    const want = fn === 'restore_member'
      ? [[U.A, mB, 'member_has_account'], [U.A, mA, 'member_has_account'], [SAU, mA, 'member_has_account']]
      : [[U.A, mA, 'member_is_self'], [SAU, mA, 'member_is_admin']];
    for (const [who, target, msg] of want) {
      await as(who);
      eq(await rpcErr(fn, ...args(target)), msg, `${fn} Konto-Ziel`);
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

// ================================================================ Krit. 7: Neue Spiele gesperrt, laufende nicht
check('K7 Neue Spiele: markiertes Mitglied ⇒ member_removed, Deck eines Markierten ⇒ „Deck nicht verfügbar“; laufendes Spiel läuft weiter', async () => {
  const c0 = await counts();
  await as(U.A);
  eq(await err(START, [X.id, J([P(mA, dk.A, 0), P(ph.c.id, dk.c, 1)])]), 'member_removed');
  eq(await err(START, [X.id, J([P(mA, dk.d, 0), P(mB, dk.B, 1)])]), 'Deck nicht verfügbar');
  eq(await counts(), c0, '0 neue Zeilen');
  // nur Aktive ⇒ gelingt
  const [g] = await q(START, [X.id, J([P(mA, dk.A, 0), P(mB, dk.B, 1)])]);
  await q(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g.id, J([R(mA, 1), R(mB, 2, mA)])]);
  // laufendes Spiel mit dem (danach markierten) c: Ereignis schreiben und beenden gelingt
  await as(U.B);
  await q(`insert into game_events (game_id, round, type, actor, source, target, amount, seq) values ($1, 1, 'life', $2, $2, $3, -3, 1)`, [gLive.id, mB, ph.c.id]);
  await q(`select * from finish_game($1, 'finished', 4, $2::jsonb)`, [gLive.id, J([R(mB, 1), R(ph.c.id, 2, mB)])]);
  await su();
  eq(await q(`select member_id, place from game_players where game_id = $1 order by seat`, [gLive.id]), [{ member_id: mB, place: 1 }, { member_id: ph.c.id, place: 2 }]);
  eq((await q(`select status from games where id = $1`, [gLive.id]))[0].status, 'finished');
});

// ================================================================ Krit. 9: Eingefroren
check('K9 Eingefroren: markierte Zeile als Admin und Mitglied nicht umbenennbar, kein Bild, Deck nicht änderbar; nach restore wieder', async () => {
  const tryAll = async (who, tag) => {
    await as(who);
    const upd = (await q(`update members set display_name = $2 where id = $1 returning id`, [ph.d.id, 'Neu' + tag])).length;
    const obj = await err(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`members/${ph.d.id}/${tag}.jpg`]);
    const dck = (await q(`update decks set short_name = $2 where id = $1 returning id`, [dk.d, 'D' + tag])).length;
    return { upd, obj: obj === null ? 'ok' : (/row-level security/.test(obj) ? 'rls' : obj), dck };
  };
  eq(await tryAll(U.A, 'a'), { upd: 0, obj: 'rls', dck: 0 }, 'Admin');
  eq(await tryAll(U.B, 'b'), { upd: 0, obj: 'rls', dck: 0 }, 'Mitglied');
  await as(U.A);
  await q(`select * from restore_member($1)`, [ph.d.id]);
  eq(await tryAll(U.A, 'c'), { upd: 1, obj: 'ok', dck: 1 }, 'Admin nach restore');
  eq(await tryAll(U.B, 'e'), { upd: 1, obj: 'ok', dck: 1 }, 'Mitglied nach restore');
  // Decks bleiben lesbar
  await as(U.B);
  ok((await q(`select id from decks where id = $1`, [dk.c])).length === 1, 'Deck eines Markierten lesbar');
});

/// ================================================================ Krit. 10: Superadmin verlässt
const Zs = {}; // Gruppe Z (Superadmin Admin, B Mitglied, Platzhalter pz) und Q (nur Superadmin, ohne Spiel)
check('K10 Verlassen: Superadmin mit Spielen ⇒ umgewandelt (mark), Gruppe ohne Admin; ohne Verweis ⇒ delete; already; Nicht-Superadmin ⇒ superadmin_only', async () => {
  Zs.Z = await mkGroup(SAU, 'Z');
  Zs.Q = await mkGroup(SAU, 'Q');
  await as(U.B);
  Zs.mB = (await q(`select * from join_playgroup($1)`, [Zs.Z.invite_code]))[0].id;
  Zs.dB = (await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'BZ', 'BZ') returning id`, [U.B]))[0].id;
  await as(SAU);
  Zs.mS = (await q(`select my_member_id($1) id`, [Zs.Z.id]))[0].id;
  Zs.dS = (await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'S1', 'S1') returning id`, [SAU]))[0].id;
  Zs.dS2 = (await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'S2', 'S2') returning id`, [SAU]))[0].id;
  [Zs.pz] = await q(`select * from create_placeholder($1, 'Zed')`, [Zs.Z.id]);
  Zs.dz = await mkDeck(Zs.pz.id, 'Z1');
  const [g] = await q(START, [Zs.Z.id, J([P(Zs.mS, Zs.dS, 0), P(Zs.mB, Zs.dB, 1), P(Zs.pz.id, Zs.dz, 2)])]);
  await q(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [g.id, J([R(Zs.mS, 1), R(Zs.mB, 2, Zs.mS), R(Zs.pz.id, 3, Zs.mB)])]);
  await su();
  await CARD(Zs.dS);
  const shown = (await q(`select coalesce(p.display_name, m.display_name) n from members m join profiles p on p.id = m.profile_id where m.id = $1`, [Zs.mS]))[0].n;
  // Nicht-Superadmin. Basis: superadmin_only. Block K2: jeder darf, aber A ist einziger Admin von X ⇒ last_admin
  const c0 = await counts();
  await as(U.A);
  eq(await rpcErr('leave_playgroup', X.id), 'last_admin');
  eq(await counts(), c0);
  ok((await row(mA)).profile_id === U.A, 'A unverändert');
  // Superadmin, hat gespielt, einziger Admin
  await as(SAU);
  eq(await rpc('leave_playgroup', Zs.Z.id), { result: 'left', mode: 'mark', admins_left: 0 });
  const r = await row(Zs.mS);
  ok(r.profile_id === null && r.former_profile_id === SAU && r.role === 'member' && r.removed_at && r.removed_by === SAU && r.claim_code === null, J(r));
  eq(r.display_name, shown, 'Name wie vorher angezeigt');
  await as(SAU);
  ok((await q(`select is_group_member($1) x`, [Zs.Z.id]))[0].x === false);
  eq(await q(`select (select count(*) from games where playgroup_id = $1)::int g, (select count(*) from members where playgroup_id = $1)::int m,
                     (select count(*) from playgroups where id = $1)::int p`, [Zs.Z.id]), [{ g: 0, m: 0, p: 0 }]);
  // verbliebenes Mitglied sieht alles aus der Historie
  await as(U.B);
  ok(await n(`select count(*)::int n from games where playgroup_id = $1`, [Zs.Z.id]) === 1);
  ok(await n(`select count(*)::int n from members where id = $1`, [Zs.mS]) === 1, 'Zeile des Gegangenen sichtbar');
  ok(await n(`select count(*)::int n from decks where id = $1`, [Zs.dS]) === 1, 'dort gespieltes Konto-Deck sichtbar');
  ok(await n(`select count(*)::int n from deck_cards where deck_id = $1`, [Zs.dS]) === 1, 'samt deck_cards');
  ok(await n(`select count(*)::int n from decks where id = $1`, [Zs.dS2]) === 0, 'nie dort gespieltes Deck unsichtbar');
  // ohne Verweis ⇒ delete; danach already
  await as(SAU);
  eq(await rpc('leave_playgroup', Zs.Q.id), { result: 'left', mode: 'delete', admins_left: 0 });
  await su();
  ok(await n(`select count(*)::int n from members where playgroup_id = $1`, [Zs.Q.id]) === 0);
  await as(SAU);
  eq(await rpc('leave_playgroup', Zs.Q.id), { result: 'already' });
  // Superadmin ohne Mitgliedschaft verwaltet weiter
  await as(SAU);
  eq((await q(`select * from set_member_role($1, 'admin')`, [Zs.mB]))[0].role, 'admin');
  const oldCode = Zs.Z.invite_code;
  const nc = (await q(`select renew_invite($1) c`, [Zs.Z.id]))[0].c;
  ok(nc && nc !== oldCode);
  Zs.Z.invite_code = nc;
  eq(await rpc('remove_member', Zs.pz.id, 'mark'), { result: 'marked' });
});

// ================================================================ Krit. 11: Übersicht und Betreten (eigene Datenbank: exakte Liste)
check('K11 Übersicht und Betreten: list_all_playgroups exakt; enter_playgroup gleiche ID / neue Zeile / unverändert / group_not_found; join nach Verlassen gleiche ID', async () => {
  const d = await freshDb({ migrations: migrations() });
  const t = tools(d);
  const tq = t.q;
  const terr = t.err;
  try {
    for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de'], [U.C, 'c@x.de'], [U.D, 'd@x.de']]) await t.seedUser(id, { email });
    await t.su();
    await tq(`update profiles set is_superadmin = true where id = $1`, [SAU]);
    const al = await t.mkGroup(SAU, 'Alpha');
    const be = await t.mkGroup(SAU, 'Beta');
    const ga = await t.mkGroup(U.C, 'Gamma');
    const de = await t.mkGroup(U.C, 'Delta');
    await t.as(U.B);
    await tq(`select * from join_playgroup($1)`, [al.invite_code]);
    const mBb = (await tq(`select * from join_playgroup($1)`, [be.invite_code]))[0].id;
    const dB = (await tq(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'B', 'B') returning id`, [U.B]))[0].id;
    await t.as(SAU);
    await tq(`select * from join_playgroup($1)`, [de.invite_code]);
    const mSb = (await tq(`select my_member_id($1) id`, [be.id]))[0].id;
    const dS = (await tq(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'S', 'S') returning id`, [SAU]))[0].id;
    const [pl] = await tq(`select * from create_placeholder($1, 'Pia')`, [be.id]);
    const [g] = await tq(START, [be.id, J([P(mSb, dS, 0), P(mBb, dB, 1)])]);
    await tq(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g.id, J([R(mSb, 1), R(mBb, 2, mSb)])]);
    eq(await tq(`select leave_playgroup($1) r`, [be.id]).then((r) => r[0].r), { result: 'left', mode: 'mark', admins_left: 0 });
    const list = (await tq(`select list_all_playgroups() r`))[0].r;
    eq(list, [
      { id: al.id, name: 'Alpha', members: 2, admins: 1, is_member: true },
      { id: be.id, name: 'Beta', members: 2, admins: 0, is_member: false },
      { id: de.id, name: 'Delta', members: 2, admins: 1, is_member: true },
      { id: ga.id, name: 'Gamma', members: 1, admins: 1, is_member: false },
    ]);
    ok(pl.id);
    // Nicht-Superadmin
    await t.as(U.C);
    eq(await terr(`select list_all_playgroups()`), 'superadmin_only');
    eq(await terr(`select * from enter_playgroup($1)`, [be.id]), 'superadmin_only');
    await t.as(null);
    ok(/permission denied/.test(await terr(`select list_all_playgroups()`) || ''));
    // Betreten nach Verlassen ⇒ dieselbe ID, Admin, drei Spalten leer, Historie hängt an ihm
    await t.as(SAU);
    const [re] = await tq(`select * from enter_playgroup($1)`, [be.id]);
    ok(re.id === mSb && re.profile_id === SAU && re.role === 'admin' && re.removed_at === null && re.removed_by === null && re.former_profile_id === null, J(re));
    ok((await tq(`select is_group_member($1) x`, [be.id]))[0].x === true);
    eq((await tq(`select member_id from game_players where game_id = $1 and seat = 0`, [g.id]))[0].member_id, mSb);
    // nie Mitglied ⇒ neue Admin-Zeile
    const [nw] = await tq(`select * from enter_playgroup($1)`, [ga.id]);
    ok(nw.profile_id === SAU && nw.role === 'admin' && nw.playgroup_id === ga.id, J(nw));
    // schon Mitglied (Rolle member) ⇒ unverändert
    await t.su();
    const before = (await tq(`select * from members where playgroup_id = $1 and profile_id = $2`, [de.id, SAU]))[0];
    await t.as(SAU);
    eq((await tq(`select * from enter_playgroup($1)`, [de.id]))[0], before);
    eq(before.role, 'member');
    eq(await terr(`select * from enter_playgroup($1)`, ['00000000-0000-4000-8000-00000000beef']), 'group_not_found');
    // join_playgroup nach Verlassen ⇒ dieselbe ID, Rolle member, keine zweite Zeile
    eq((await tq(`select leave_playgroup($1) r`, [be.id]))[0].r, { result: 'left', mode: 'mark', admins_left: 0 });
    const [jo] = await tq(`select * from join_playgroup($1)`, [be.invite_code]);
    ok(jo.id === mSb && jo.role === 'member' && jo.profile_id === SAU && jo.former_profile_id === null && jo.removed_at === null, J(jo));
    await t.su();
    ok((await tq(`select count(*)::int n from members where playgroup_id = $1 and (profile_id = $2 or former_profile_id = $2)`, [be.id, SAU]))[0].n === 1);
    // Kollision (Spec-Lücke): frühere Zeile + übernommener Platzhalter + erneutes Verlassen ⇒ kein 23505
    await t.as(SAU);
    eq((await tq(`select leave_playgroup($1) r`, [be.id]))[0].r.mode, 'mark');
    await t.as(U.B);
    const dPl = (await tq(`insert into decks (owner_member_id, commander_name, short_name) values ($1, 'P', 'P') returning id`, [pl.id]))[0].id;
    const [g2] = await tq(START, [be.id, J([P(mBb, dB, 0), P(pl.id, dPl, 1)])]);
    await tq(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g2.id, J([R(mBb, 1), R(pl.id, 2, mBb)])]);
    await t.as(SAU);
    const [cl] = await tq(`select * from claim_member($1)`, [pl.claim_code]);
    ok(cl.id === pl.id && cl.profile_id === SAU, J(cl));
    eq((await tq(`select leave_playgroup($1) r`, [be.id]))[0].r, { result: 'left', mode: 'mark', admins_left: 0 });
    await t.su();
    eq(await tq(`select id, former_profile_id = $3 f, removed_at is not null r from members where playgroup_id = $1 and id = any($2) order by removed_at`, [be.id, [mSb, pl.id], SAU]),
      [{ id: mSb, f: true, r: true }, { id: pl.id, f: true, r: true }], 'beide früheren Zeilen behalten den Kontobezug (Spec-Nachtrag „Frühere Zeilen“)');
    // Betreten ⇒ genau die zuletzt entfernte (pl) kommt zurück, die ältere bleibt entfernt mit Kontobezug
    await t.as(SAU);
    eq((await tq(`select * from enter_playgroup($1)`, [be.id]))[0].id, pl.id);
    await t.su();
    eq(await tq(`select id, profile_id, former_profile_id, removed_at is not null r from members where playgroup_id = $1 and id = any($2) order by removed_at nulls last`, [be.id, [mSb, pl.id]]),
      [{ id: mSb, profile_id: null, former_profile_id: SAU, r: true }, { id: pl.id, profile_id: SAU, former_profile_id: null, r: false }]);
  } finally {
    await d.close();
  }
});

// ================================================================ Krit. 12: Zusammenspiel
check('K12 Zusammenspiel: playgroup_files/delete_playgroup mit markiertem Platzhalter (Avatar) und umgewandelter Zeile; delete_my_account eines Admins, der entfernt hat', async () => {
  const V = await mkGroup(U.A, 'V');
  await as(SAU);
  const mS = (await q(`select * from join_playgroup($1)`, [V.invite_code]))[0].id;
  const dS = (await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'SV', 'SV') returning id`, [SAU]))[0].id;
  await as(U.A);
  const mAv = (await q(`select my_member_id($1) id`, [V.id]))[0].id;
  const [pv] = await q(`select * from create_placeholder($1, 'Vic')`, [V.id]);
  const dv = await mkDeck(pv.id, 'V1');
  const [g] = await q(START, [V.id, J([P(mAv, dk.A, 0), P(mS, dS, 1), P(pv.id, dv, 2)])]);
  await q(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [g.id, J([R(mAv, 1), R(mS, 2, mAv), R(pv.id, 3, mAv)])]);
  await q(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`members/${pv.id}/avatar.jpg`]);
  await q(`update members set avatar_path = $2 where id = $1`, [pv.id, `members/${pv.id}/avatar.jpg`]);
  eq(await rpc('remove_member', pv.id, 'mark'), { result: 'marked' });
  await as(SAU);
  eq((await rpc('leave_playgroup', V.id)).mode, 'mark');
  await as(U.A);
  const files = await q(`select * from playgroup_files($1)`, [V.id]);
  eq(files, [{ bucket: 'avatars', path: `members/${pv.id}/avatar.jpg` }]);
  await q(`select delete_playgroup($1, 'V')`, [V.id]);
  await su();
  ok(await n(`select count(*)::int n from playgroups where id = $1`, [V.id]) === 0);
  ok(await n(`select count(*)::int n from members where id = any($1)`, [[mS, pv.id]]) === 0);
  // delete_my_account eines Admins, der entfernt hat: C in Y (B tritt bei, damit Y bleibt)
  const Yc = (await q(`select code from playgroup_invites where playgroup_id = $1`, [Y.id]))[0].code;
  await as(U.B);
  const mBy = (await q(`select * from join_playgroup($1)`, [Yc]))[0].id;
  const dBy = (await q(`select id from decks where owner_profile_id = $1 limit 1`, [U.B]))[0].id;
  await as(U.C);
  const [py] = await q(`select * from create_placeholder($1, 'Yan')`, [Y.id]);
  const dy = await mkDeck(py.id, 'Y1');
  const [gy] = await q(START, [Y.id, J([P(mBy, dBy, 0), P(py.id, dy, 1)])]);
  await q(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [gy.id, J([R(mBy, 1), R(py.id, 2, mBy)])]);
  eq(await rpc('remove_member', py.id, 'mark'), { result: 'marked' });
  ok((await row(py.id)).removed_by === U.C);
  await as(U.C);
  await q(`select delete_my_account()`);
  const ry = await row(py.id);
  ok(ry && ry.removed_by === null && ry.removed_at !== null, J(ry));
});

// ================================================================ Block K (E-K = ja): Mitglieder mit Konto
const K = {};
check('K-1 Admin entfernt Mitglied mit Konto und Spielen ⇒ umgewandelt; Konto sieht die Gruppe nicht mehr; sein Deck „Deck nicht verfügbar“; Admin/Superadmin/selbst gesperrt', async () => {
  // weitere Admins in X: Superadmin betritt X, E (uid 101) wird Admin
  await as(SAU);
  K.mS = (await q(`select * from enter_playgroup($1)`, [X.id]))[0].id;
  K.mE = (await row(ph.s2.id)).id; // E hat s2 übernommen (Krit. 8)
  await as(SAU);
  await q(`select * from set_member_role($1, 'admin')`, [K.mE]);
  await as(U.A);
  eq(await rpcErr('member_removal_check', K.mS), 'superadmin_only');
  eq(await rpcErr('remove_member', K.mS, 'mark'), 'superadmin_only');
  eq(await rpcErr('member_removal_check', K.mE), 'member_is_admin');
  eq(await rpcErr('remove_member', K.mE, 'mark'), 'member_is_admin');
  eq(await rpcErr('remove_member', mA, 'mark'), 'member_is_self');
  await as(SAU);
  eq(await rpcErr('remove_member', K.mS, 'mark'), 'member_is_self', 'selbst vor Superadmin');
  // B: Mitglied mit Konto und Spielen
  const shown = (await q(`select coalesce(p.display_name, m.display_name) n from members m join profiles p on p.id = m.profile_id where m.id = $1`, [mB]))[0].n;
  const c0 = await counts();
  await as(U.A);
  const chk = await rpc('member_removal_check', mB);
  ok(chk.mode === 'mark' && chk.games >= 3 && chk.live_games === 0 && chk.decks === 0 && J(chk.files) === '[]', J(chk));
  eq(await rpcErr('remove_member', mB, 'delete'), 'member_state_changed');
  eq(await rpc('remove_member', mB, 'mark'), { result: 'marked' });
  eq(await counts(), c0, 'keine Zeile angelegt oder gelöscht');
  const r = await row(mB);
  ok(r.profile_id === null && r.former_profile_id === U.B && r.role === 'member' && r.removed_at && r.removed_by === U.A && r.claim_code === null, J(r));
  eq(r.display_name, shown);
  eq((await row(ph.f.id)).former_profile_id, U.B, 'ältere frühere Zeile von B behält den Kontobezug (Spec-Nachtrag „Frühere Zeilen“)');
  await as(U.B);
  ok((await q(`select is_group_member($1) x`, [X.id]))[0].x === false);
  ok(await n(`select count(*)::int n from games where playgroup_id = $1`, [X.id]) === 0, 'Konto sieht die Gruppe nicht mehr');
  await as(U.A);
  eq(await err(START, [X.id, J([P(mA, dk.A, 0), P(K.mE, dk.B, 1)])]), 'Deck nicht verfügbar');
  await as(U.A);
  eq(await rpc('remove_member', mB, 'mark'), { result: 'already' });
});

check('K-2 Mitglied verlässt ⇒ wie Krit. 10; letzter Admin (kein Superadmin) ⇒ last_admin, nichts geändert', async () => {
  await seedUser(uid(102), { email: 'f@x.de' });
  const Xc = (await (async () => { await su(); return q(`select code from playgroup_invites where playgroup_id = $1`, [X.id]); })())[0].code;
  await as(uid(102));
  K.mF = (await q(`select * from join_playgroup($1)`, [Xc]))[0].id;
  const dF = (await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'F1', 'F1') returning id`, [uid(102)]))[0].id;
  await as(U.A);
  const [g] = await q(START, [X.id, J([P(mA, dk.A, 0), P(K.mF, dF, 1)])]);
  await q(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g.id, J([R(mA, 1), R(K.mF, 2, mA)])]);
  await as(uid(102));
  eq(await rpc('leave_playgroup', X.id), { result: 'left', mode: 'mark', admins_left: 3 });
  const r = await row(K.mF);
  ok(r.profile_id === null && r.former_profile_id === uid(102) && r.role === 'member' && r.removed_at && r.removed_by === uid(102), J(r));
  await as(uid(102));
  ok(await n(`select count(*)::int n from games where playgroup_id = $1`, [X.id]) === 0);
  // letzter Admin einer Gruppe (kein Superadmin)
  const W = await mkGroup(U.A, 'W');
  const c0 = await counts();
  await as(U.A);
  eq(await rpcErr('leave_playgroup', W.id), 'last_admin');
  eq(await counts(), c0);
  ok((await q(`select is_group_member($1) x`, [W.id]))[0].x === true);
  // Mitglied ohne Verweis ⇒ delete
  await seedUser(uid(103), { email: 'g@x.de' });
  await as(uid(103));
  await q(`select * from join_playgroup($1)`, [W.invite_code]);
  eq(await rpc('leave_playgroup', W.id), { result: 'left', mode: 'delete', admins_left: 1 });
});

check('K-3 Entferntes Konto tritt mit gültigem Code bei ⇒ dieselbe ID, aktiv; nach renew_invite mit altem Code ⇒ null', async () => {
  await su();
  const code = (await q(`select code from playgroup_invites where playgroup_id = $1`, [X.id]))[0].code;
  await as(U.B);
  const [j] = await q(`select * from join_playgroup($1)`, [code]);
  ok(j.id === mB && j.profile_id === U.B && j.role === 'member' && j.removed_at === null && j.former_profile_id === null, J(j));
  await as(U.A);
  eq(await rpc('remove_member', mB, 'mark'), { result: 'marked' });
  const nc = (await q(`select renew_invite($1) c`, [X.id]))[0].c;
  ok(nc !== code);
  await as(U.B);
  eq((await q(`select join_playgroup($1) r`, [code]))[0].r, null);
  ok((await row(mB)).profile_id === null, 'bleibt draußen');
});

check('K-4 Entferntes Konto löscht sich ⇒ frühere Zeile „Ehemaliges Mitglied“, keine neue aktive Zeile, Deck an der früheren Zeile', async () => {
  await su();
  const active = async () => n(`select count(*)::int n from members where playgroup_id = $1 and removed_at is null`, [X.id]);
  const a0 = await active();
  const m0 = await n(`select count(*)::int n from members where playgroup_id = $1`, [X.id]);
  ok(await n(`select count(*)::int n from game_players where deck_id = $1`, [dk.B]) > 0, 'Deck von B in X gespielt');
  await as(U.B);
  await q(`select delete_my_account()`);
  await su();
  eq(await active(), a0, 'aktive Mitglieder vor = nach');
  eq(await n(`select count(*)::int n from members where playgroup_id = $1`, [X.id]), m0, 'keine neue Zeile');
  const r = await row(mB);
  ok(r.display_name === 'Ehemaliges Mitglied' && r.former_profile_id === null && r.removed_at !== null && r.profile_id === null, J(r));
  eq((await q(`select owner_member_id, owner_profile_id from decks where id = $1`, [dk.B]))[0], { owner_member_id: mB, owner_profile_id: null });
  // Spec-Nachtrag „Frühere Zeilen“: auch die ältere frühere Zeile (f) heißt neutral; das Deck übernimmt die zuletzt entfernte (mB)
  eq((await row(ph.f.id)).display_name, 'Ehemaliges Mitglied');
});

// ================================================================ Spec-Nachtrag „Frühere Zeilen“ (Befund B2, eigene Datenbank)
// Altes Verhalten von _member_detach (vor dem Nachtrag): nimmt älteren früheren Zeilen den Kontobezug. Nur Gegenprobe.
const OLD_DETACH = `create or replace function public._member_detach(p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m members; nm text;
begin
  select * into m from members where id = p_member for update;
  if public._member_deletable(m.id) then
    perform public._member_delete(m.id);
    return 'delete';
  end if;
  select left(coalesce(nullif(p.display_name, ''), m.display_name), 40) into nm from profiles p where p.id = m.profile_id;
  update members set former_profile_id = null
  where playgroup_id = m.playgroup_id and former_profile_id = m.profile_id;
  update members set former_profile_id = m.profile_id, profile_id = null, display_name = coalesce(nm, m.display_name),
    role = 'member', removed_at = now(), removed_by = auth.uid(), claim_code = null
  where id = m.id;
  return 'mark';
end $$;`;
check('Frühere Zeilen (B2): verlassen → Platzhalter übernehmen → verlassen ⇒ beide behalten den Kontobezug; Code bringt genau die jüngere zurück; Konto löschen benennt beide neutral', async () => {
  const d = await freshDb({ migrations: migrations() });
  const t = tools(d);
  const tq = t.q, terr = t.err;
  const tn = async (sql, p) => (await tq(sql, p))[0].n;
  try {
    if (GEGEN === 'detach') await d.exec(OLD_DETACH);
    if (GEGEN === 'restore') await d.exec(OLD_RESTORE);
    for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de']]) await t.seedUser(id, { email });
    await t.su();
    await tq(`update profiles set display_name = 'Bea Echtname' where id = $1`, [U.B]);
    const Xg = await t.mkGroup(U.A, 'X');
    await t.as(U.A);
    const a = (await tq(`select my_member_id($1) id`, [Xg.id]))[0].id;
    const dA = (await tq(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'A1', 'A1') returning id`, [U.A]))[0].id;
    const [pl] = await tq(`select * from create_placeholder($1, 'Pit')`, [Xg.id]);
    const dP = (await tq(`insert into decks (owner_member_id, commander_name, short_name) values ($1, 'P1', 'P1') returning id`, [pl.id]))[0].id;
    // B tritt bei, spielt mit eigenem Deck, verlässt ⇒ R1 (frühere Zeile)
    await t.as(U.B);
    const r1 = (await tq(`select * from join_playgroup($1)`, [Xg.invite_code]))[0].id;
    const dB = (await tq(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'B1', 'B1') returning id`, [U.B]))[0].id;
    await t.as(U.A);
    const [g1] = await tq(START, [Xg.id, J([P(a, dA, 0), P(r1, dB, 1)])]);
    await tq(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g1.id, J([R(a, 1), R(r1, 2, a)])]);
    const [g2] = await tq(START, [Xg.id, J([P(a, dA, 0), P(pl.id, dP, 1)])]);
    await tq(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g2.id, J([R(a, 1), R(pl.id, 2, a)])]);
    await t.as(U.B);
    eq((await tq(`select leave_playgroup($1) r`, [Xg.id]))[0].r, { result: 'left', mode: 'mark', admins_left: 1 });
    // B übernimmt den Platzhalter Pit (R2) und verlässt wieder
    const [cl] = await tq(`select * from claim_member($1)`, [pl.claim_code]);
    ok(cl.id === pl.id && cl.profile_id === U.B, J(cl));
    eq((await tq(`select leave_playgroup($1) r`, [Xg.id]))[0].r, { result: 'left', mode: 'mark', admins_left: 1 });
    await t.su();
    const rows = async () => tq(`select id, profile_id, former_profile_id, removed_at, display_name, claim_code from members where id = any($1) order by removed_at`, [[r1, pl.id]]);
    // (a) beide Zeilen tragen former_profile_id
    const s0 = await rows();
    eq(s0.map((r) => [r.id, r.profile_id, r.former_profile_id, !!r.removed_at]), [[r1, null, U.B, true], [pl.id, null, U.B, true]], '(a) beide frühere Zeilen von B');
    // Spec-Nachtrag „Gelöschte Konten“ (d): auch der übernommene Platzhalter (Pit, nie zuvor Konto) trägt nach dem Verlassen had_account
    eq((await tq(`select id, had_account from members where id = any($1) order by removed_at`, [[r1, pl.id]])).map((r) => [r.id, r.had_account]),
      [[r1, true], [pl.id, true]], 'Gelöschte Konten (d): beide had_account');
    // (b) restore_member auf beide ⇒ member_has_account, nichts geändert
    await t.as(U.A);
    for (const id of [r1, pl.id]) ok(/member_has_account/.test(await terr(`select * from restore_member($1)`, [id]) || ''), `(b) ${id}`);
    await t.su();
    eq(await rows(), s0, '(b) nichts geändert');
    // (c) Wiederbeitritt per Code ⇒ genau die jüngere Zeile (R2 = Pit) aktiv, gleiche ID; ältere unverändert entfernt
    await t.as(U.B);
    const [j] = await tq(`select * from join_playgroup($1)`, [Xg.invite_code]);
    ok(j.id === pl.id && j.profile_id === U.B && j.role === 'member' && j.removed_at === null && j.former_profile_id === null, J(j));
    ok(j.had_account === true, 'had_account wird nie wieder false (auch aktiv mit Konto)');
    await t.su();
    eq((await rows())[0], s0[0], '(c) ältere Zeile R1 unverändert');
    eq(await tn(`select count(*)::int n from members where playgroup_id = $1 and profile_id = $2`, [Xg.id, U.B]), 1, '(c) genau eine aktive Zeile');
    // erneuter Code-Aufruf ⇒ dieselbe aktive Zeile, keine zweite
    await t.as(U.B);
    eq((await tq(`select * from join_playgroup($1)`, [Xg.invite_code]))[0].id, pl.id);
    // (d) erneut verlassen, dann Konto löschen
    eq((await tq(`select leave_playgroup($1) r`, [Xg.id]))[0].r.mode, 'mark');
    await t.su();
    const HIST = ['games', 'game_players', 'game_events', 'player_ratings', 'deck_salt_ratings', 'potg_votes'];
    const hist = async () => { const o = {}; for (const tb of HIST) o[tb] = await tn(`select count(*)::int n from public.${tb}`); return o; };
    const h0 = await hist();
    const m0 = await tn(`select count(*)::int n from members where playgroup_id = $1`, [Xg.id]);
    await t.as(U.B);
    eq(await terr(`select delete_my_account()`), null);
    await t.su();
    eq(await tn(`select count(*)::int n from members where display_name = 'Bea Echtname'`), 0, '(d) keine Zeile trägt den Profilnamen');
    eq((await rows()).map((r) => [r.id, r.display_name, r.profile_id, !!r.removed_at]),
      [[r1, 'Ehemaliges Mitglied', null, true], [pl.id, 'Ehemaliges Mitglied', null, true]], '(d) beide neutral, beide entfernt');
    eq(await hist(), h0, '(d) Historie zeilengleich');
    eq(await tn(`select count(*)::int n from members where playgroup_id = $1`, [Xg.id]), m0, '(d) keine neue Zeile');
    // Deck-Übernahme in c) fest bestimmt: die zuletzt entfernte frühere Zeile (Pit) übernimmt Bs gespieltes Deck
    eq((await tq(`select owner_member_id, owner_profile_id from decks where id = $1`, [dB]))[0], { owner_member_id: pl.id, owner_profile_id: null });
    // Spec-Nachtrag „Gelöschte Konten“ (a): former_profile_id ist jetzt leer (Fremdschlüssel set null) — trotzdem
    // lehnt restore_member beide Zeilen ab; keine Zeile trägt je einen Code
    const s1 = await tq(`select id, former_profile_id, had_account, claim_code from members where id = any($1) order by id`, [[r1, pl.id]]);
    ok(s1.every((r) => r.former_profile_id === null && r.had_account === true && r.claim_code === null), `Gelöschte Konten (a) vorher: ${J(s1)}`);
    await t.as(U.A);
    for (const id of [r1, pl.id]) {
      const e = await terr(`select * from restore_member($1)`, [id]);
      ok(/member_has_account/.test(e || ''), `Gelöschte Konten (a) ${id}: ${e}`);
    }
    await t.su();
    eq(await tq(`select id, former_profile_id, had_account, claim_code from members where id = any($1) order by id`, [[r1, pl.id]]), s1, 'Gelöschte Konten (a): nichts geändert');
    eq(await tn(`select count(*)::int n from members where playgroup_id = $1 and had_account and profile_id is null and claim_code is not null`, [Xg.id]), 0);
  } finally {
    await d.close();
  }
});

// ================================================================ Spec-Nachtrag „Gelöschte Konten“ (eigene Datenbanken)
// restore_member ohne die had_account-Prüfung (Schritt 4) — aus der Migration geschnitten, nur Gegenprobe.
const OLD_RESTORE = (() => {
  const src = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  const fn = src.match(/create or replace function public\.restore_member\([\s\S]*?\nend \$\$;/)[0];
  const old = fn.replace(/\r?\n[^\n]*if m\.had_account then raise exception 'member_has_account'; end if;/, '');
  assert.notEqual(old, fn, 'had_account-Prüfung in restore_member nicht gefunden');
  return old;
})();
check('Gelöschte Konten (b)(c)(f): beim Löschen aktive Zeile ⇒ had_account, entfernen ⇒ wiederherstellen abgelehnt; Platzhalter ohne Konto wie bisher; Check hält Code ab', async () => {
  const d = await freshDb({ migrations: migrations() });
  const t = tools(d);
  const tq = t.q, terr = t.err;
  try {
    if (GEGEN === 'restore') await d.exec(OLD_RESTORE);
    if (GEGEN === 'check') await d.exec('alter table public.members drop constraint members_had_account_no_code;');
    for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de']]) await t.seedUser(id, { email });
    const Xg = await t.mkGroup(U.A, 'X');
    await t.as(U.A);
    const a = (await tq(`select my_member_id($1) id`, [Xg.id]))[0].id;
    const dA = (await tq(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'A1', 'A1') returning id`, [U.A]))[0].id;
    const [pl] = await tq(`select * from create_placeholder($1, 'Pit')`, [Xg.id]);
    const dP = (await tq(`insert into decks (owner_member_id, commander_name, short_name) values ($1, 'P1', 'P1') returning id`, [pl.id]))[0].id;
    await t.as(U.B);
    const mB = (await tq(`select * from join_playgroup($1)`, [Xg.invite_code]))[0].id;
    const dB = (await tq(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'B1', 'B1') returning id`, [U.B]))[0].id;
    await t.as(U.A);
    const [g1] = await tq(START, [Xg.id, J([P(a, dA, 0), P(mB, dB, 1), P(pl.id, dP, 2)])]);
    await tq(`select * from finish_game($1, 'finished', 3, $2::jsonb)`, [g1.id, J([R(a, 1), R(mB, 2, a), R(pl.id, 3, mB)])]);
    // (b) B löscht sein Konto, während die Zeile aktiv ist ⇒ „Ehemaliges Mitglied“, had_account
    await t.as(U.B);
    eq(await terr(`select delete_my_account()`), null);
    await t.su();
    const rb = (await tq(`select * from members where id = $1`, [mB]))[0];
    ok(rb.profile_id === null && rb.former_profile_id === null && rb.removed_at === null && rb.claim_code === null
       && rb.had_account === true && rb.display_name === 'Ehemaliges Mitglied', `(b) nach Löschen: ${J(rb)}`);
    // Admin entfernt (Modus mark: Spiel verweist), dann wiederherstellen ⇒ member_has_account, Zeile unverändert
    await t.as(U.A);
    eq((await tq(`select remove_member($1, 'mark') r`, [mB]))[0].r, { result: 'marked' });
    await t.su();
    const rb2 = (await tq(`select * from members where id = $1`, [mB]))[0];
    ok(rb2.removed_at !== null && rb2.had_account === true && rb2.claim_code === null, `(b) markiert: ${J(rb2)}`);
    await t.as(U.A);
    const eb = await terr(`select * from restore_member($1)`, [mB]);
    ok(/member_has_account/.test(eb || ''), `(b) restore_member: ${eb}`);
    await t.su();
    eq((await tq(`select * from members where id = $1`, [mB]))[0], rb2, '(b) nichts geändert');
    // (c) gewöhnlicher Platzhalter (nie Konto): entfernen (mark) ⇒ wiederherstellen ⇒ neuer Code, had_account false
    await t.as(U.A);
    eq((await tq(`select remove_member($1, 'mark') r`, [pl.id]))[0].r, { result: 'marked' });
    const [rp] = await tq(`select * from restore_member($1)`, [pl.id]);
    ok(rp.id === pl.id && rp.removed_at === null && rp.profile_id === null && rp.had_account === false
       && CODE_RE.test(rp.claim_code || '') && rp.claim_code !== pl.claim_code, `(c) ${J(rp)}`);
    // (f) Stolperdraht: als Tabellen-Eigentümer einer had_account-Zeile ohne Konto einen Code geben ⇒ abgelehnt
    await t.su();
    const ef = await terr(`update members set claim_code = 'EHEM-ABCDEF' where id = $1`, [mB]);
    ok(/members_had_account_no_code/.test(ef || ''), `(f) Check: ${ef}`);
    eq((await tq(`select claim_code from members where id = $1`, [mB]))[0].claim_code, null, '(f) kein Code');
    // Gegenstück: der übernehmbare Platzhalter (had_account false) darf seinen Code behalten
    eq(await terr(`update members set claim_code = 'PIT-ABCDEF' where id = $1`, [pl.id]), null, '(f) Platzhalter ohne Konto: Code erlaubt');
  } finally {
    await d.close();
  }
});

check('Gelöschte Konten (e) Bestand: Zeilen gelöschter Konten (vor P10) ⇒ had_account true; Platzhalter mit Code und Konten ⇒ false', async () => {
  const d = await freshDb({ migrations: migrations(), until: FILE });
  const t = tools(d);
  const tq = t.q;
  try {
    for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de']]) await t.seedUser(id, { email });
    const Xg = await t.mkGroup(U.A, 'X');
    await t.as(U.A);
    const a = (await tq(`select my_member_id($1) id`, [Xg.id]))[0].id;
    const dA = (await tq(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'A1', 'A1') returning id`, [U.A]))[0].id;
    const [tim] = await tq(`select * from create_placeholder($1, 'Tim')`, [Xg.id]);
    await t.as(U.B);
    const mB = (await tq(`select * from join_playgroup($1)`, [Xg.invite_code]))[0].id;
    const dB = (await tq(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'B1', 'B1') returning id`, [U.B]))[0].id;
    await t.as(U.A);
    const [g1] = await tq(START, [Xg.id, J([P(a, dA, 0), P(mB, dB, 1)])]);
    await tq(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g1.id, J([R(a, 1), R(mB, 2, a)])]);
    // Form a) aus 20261112000000_konto.sql:122: das echte delete_my_account vor P10 wandelt Bs Zeile um
    await t.as(U.B);
    await tq(`select delete_my_account()`);
    // Form c) aus 20261112000000_konto.sql:156 (Deck-Erb-Zeile in einer Gruppe ohne Zeile des Kontos), wortgleich eingefügt
    await t.su();
    const [{ id: heir }] = await tq(`insert into members (playgroup_id, display_name) values ($1, 'Ehemaliges Mitglied') returning id`, [Xg.id]);
    const pre = await tq(`select id, profile_id, claim_code from members where playgroup_id = $1 order by id`, [Xg.id]);
    eq(pre.filter((r) => r.profile_id === null && r.claim_code === null).map((r) => r.id).sort(), [mB, heir].sort(), 'vorher: genau die zwei Zeilen ohne Konto und Code');
    if (GEGEN !== '1') await d.exec(fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8'));
    const got = Object.fromEntries((await tq(`select id, had_account from members where playgroup_id = $1`, [Xg.id])).map((r) => [r.id, r.had_account]));
    eq(got, { [a]: false, [tim.id]: false, [mB]: true, [heir]: true }, '(e) had_account nach der Migration');
    // und die Folge: Bs umgewandelte Zeile ist nach entfernen nicht wiederherstellbar
    await t.as(U.A);
    eq((await tq(`select remove_member($1, 'mark') r`, [mB]))[0].r, { result: 'marked' });
    ok(/member_has_account/.test(await t.err(`select * from restore_member($1)`, [mB]) || ''), '(e) restore_member abgelehnt');
  } finally {
    await d.close();
  }
});

// ================================================================ Übergang 2: E2E-Grundzustand (tests/e2e/fixture-members.mjs)
// Gleiche Aufruffolge wie harness.mjs baseState, hier gegen PGlite mit RLS als A (B/C nur beim Beitritt per Code).
// io wie in Prod: members = select als A, deleteGames = delete games als A (Kaskade), rejoin = join_playgroup(Code)
// als B/C, rpc = Funktionsaufruf als A (fehlt die Funktion ⇒ code PGRST202 wie PostgREST), removeFiles = delete
// storage.objects als A. Danach die Teile von fixture-api.mjs baseState/snapshot, die members betreffen.
const rpc2 = async (t, fn, ...args) => (await t.q(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args))[0].r;
const n2 = async (t, sql, p) => (await t.q(sql, p))[0].n;
function pgliteIo(t, fx) {
  const log = [];
  const callAs = async (uid, fn, args) => {
    await t.as(uid);
    const ks = Object.keys(args);
    try {
      return (await t.q(`select public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`, ks.map((k) => args[k])))[0].r;
    } catch (e) {
      if (e.code === '42883') { const x = new Error(`PGRST202 ${fn}`); /** @type {any} */ (x).code = 'PGRST202'; throw x; }
      throw e;
    }
  };
  return {
    log,
    io: {
      members: async () => { log.push('members'); await t.as(fx.a); return t.q(`select * from members where playgroup_id = $1`, [fx.group]); },
      deleteGames: async () => { log.push('deleteGames'); await t.as(fx.a); return (await t.q(`delete from games where playgroup_id = $1 returning id`, [fx.group])).length; },
      rejoin: async (k) => {
        log.push(`rejoin:${k}`);
        await t.as(fx[k]);
        const have = await t.q(`select id from members where playgroup_id = $1 and profile_id = $2`, [fx.group, fx[k]]);
        if (have.length) return have[0].id;
        await t.as(fx.a);
        const code = (await t.q(`select code from playgroup_invites where playgroup_id = $1`, [fx.group]))[0].code;
        await t.as(fx[k]);
        return (await t.q(`select * from join_playgroup($1)`, [code]))[0].id;
      },
      rpc: (fn, args) => { log.push(fn); return callAs(fx.a, fn, args); },
      removeFiles: async (names) => { log.push('removeFiles'); await t.as(fx.a); return (await t.q(`delete from storage.objects where bucket_id = 'avatars' and name = any($1) returning name`, [names])).length; },
    },
  };
}
check('Übergang 2: Grundzustand über die P10-Funktionen ⇒ Mitglieder [A], 0 Platzhalter, 0 Spiele, keine Zeile mit removed_at; vor der Migration PGRST202 ⇒ alter Weg', async () => {
  // (1) vor dem db push: Probe meldet „fehlt“, der alte REST-Weg (delete members als A) geht
  {
    const d = await freshDb({ migrations: migrations(), until: FILE });
    const t = tools(d);
    try {
      for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de']]) await t.seedUser(id, { email });
      const G = await t.mkGroup(U.A, 'TTG-E2E-Fixture');
      const { io } = pgliteIo(t, { group: G.id, a: U.A, b: U.B, c: U.C });
      eq(await probeMembers(io.rpc), false, 'Probe vor der Migration ⇒ alter Weg');
      await t.as(U.A);
      const [ph0] = await t.q(`select * from create_placeholder($1, 'Alt')`, [G.id]);
      eq((await t.q(`delete from members where id = $1 returning id`, [ph0.id])).length, 1, 'alter Weg: delete members als A');
    } finally { await d.close(); }
  }
  if (GEGEN === '1') return; // Gegenprobe (a): ohne die Migration gibt es den neuen Weg nicht (die übrigen Fälle sind rot)
  // (2) nach dem db push: Zustände, die die E2E-Dateien (auch abgebrochen) hinterlassen
  const d = await freshDb({ migrations: migrations() });
  const t = tools(d);
  try {
    for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de'], [U.C, 'c@x.de']]) await t.seedUser(id, { email });
    const G = await t.mkGroup(U.A, 'TTG-E2E-Fixture');
    const fx = { group: G.id, a: U.A, b: U.B, c: U.C };
    const { io, log } = pgliteIo(t, fx);
    await t.as(U.A);
    const aRow = (await t.q(`select my_member_id($1) id`, [G.id]))[0].id;
    const dA = (await t.q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'A1', 'A1') returning id`, [U.A]))[0].id;
    const play = async (mid, deck) => {
      await t.as(U.A);
      const [g] = await t.q(START, [G.id, J([P(aRow, dA, 0), P(mid, deck, 1)])]);
      await t.q(`select * from finish_game($1, 'finished', 2, $2::jsonb)`, [g.id, J([R(aRow, 1), R(mid, 2, aRow)])]);
    };
    const mkPh = async (name) => { await t.as(U.A); return (await t.q(`select * from create_placeholder($1, $2)`, [G.id, name]))[0]; };
    const mkPhDeck = async (ph, name) => { await t.as(U.A); return (await t.q(`insert into decks (owner_member_id, commander_name, short_name) values ($1, $2, $2) returning id`, [ph.id, name]))[0].id; };
    // K17 echt (mitglieder.e2e.mjs): „Weg Test“ gelöscht; „Mo Test“ mit Spiel ⇒ markiert ⇒ wiederhergestellt
    const weg = await mkPh('Weg Test');
    eq(await rpc2(t, 'remove_member', weg.id, 'delete'), { result: 'deleted' });
    const mo = await mkPh('Mo Test');
    await play(mo.id, await mkPhDeck(mo, 'Krenko'));
    eq(await rpc2(t, 'remove_member', mo.id, 'mark'), { result: 'marked' });
    await t.q(`select * from restore_member($1)`, [mo.id]);
    // abgebrochen nach dem Markieren (nicht wiederhergestellt), mit Bild
    const ab = await mkPh('Abbruch');
    await play(ab.id, await mkPhDeck(ab, 'Kinnan'));
    await t.q(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`members/${ab.id}/avatar.jpg`]);
    await t.q(`update members set avatar_path = $2 where id = $1`, [ab.id, `members/${ab.id}/avatar.jpg`]);
    eq(await rpc2(t, 'remove_member', ab.id, 'mark'), { result: 'marked' });
    // B: verlässt → übernimmt einen Platzhalter → verlässt wieder (zwei frühere Zeilen, Spec-Nachtrag B2)
    const code = (await t.q(`select code from playgroup_invites where playgroup_id = $1`, [G.id]))[0].code;
    await t.as(U.B);
    const b1 = (await t.q(`select * from join_playgroup($1)`, [code]))[0].id;
    const dB = (await t.q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'B1', 'B1') returning id`, [U.B]))[0].id;
    await play(b1, dB);
    await t.as(U.B);
    eq((await t.q(`select leave_playgroup($1) r`, [G.id]))[0].r.mode, 'mark');
    const pit = await mkPh('Pit');
    await play(pit.id, await mkPhDeck(pit, 'Pit1'));
    await t.as(U.B);
    await t.q(`select * from claim_member($1)`, [pit.claim_code]);
    eq((await t.q(`select leave_playgroup($1) r`, [G.id]))[0].r.mode, 'mark');
    // C: Mitglied mit Spiel, von A entfernt ⇒ frühere Zeile
    await t.as(U.C);
    const c1 = (await t.q(`select * from join_playgroup($1)`, [code]))[0].id;
    const dC = (await t.q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'C1', 'C1') returning id`, [U.C]))[0].id;
    await play(c1, dC);
    eq(await rpc2(t, 'remove_member', c1, 'mark'), { result: 'marked' });
    // dazu ein aktiver Platzhalter und B wieder aktiv (der Code holt die zuletzt entfernte Zeile: Pit)
    await mkPh('Frisch');
    await t.as(U.B);
    const b3 = (await t.q(`select * from join_playgroup($1)`, [code]))[0].id;
    ok(b3 === pit.id, 'Code holt die zuletzt entfernte Zeile von B (Pit)');
    await t.su();
    const before = (await t.q(`select count(*) filter (where removed_at is not null)::int r, count(*) filter (where former_profile_id is not null)::int f from members where playgroup_id = $1`, [G.id]))[0];
    eq(before, { r: 3, f: 2 }, 'vorher: Abbruch markiert, b1 frühere Zeile von B, c1 frühere Zeile von C');

    eq(await probeMembers(io.rpc), true, 'Probe nach der Migration ⇒ neuer Weg');
    const n1 = await membersCleanup(io, fx);
    ok(n1.games === 5 && n1.files === 1 && n1.restored === 1 && n1.rejoined === 2, J(n1));
    // Teile von fixture-api.mjs baseState, die members betreffen: nichts mehr per REST zu löschen
    await t.as(U.A);
    const ms = await t.q(`select * from members where playgroup_id = $1`, [G.id]);
    eq(ms.filter((m) => !m.profile_id).length, 0, 'baseState: keine Zeile ohne Konto ⇒ kein REST-delete auf members');
    eq(ms.filter((m) => m.profile_id && m.profile_id !== U.A).length, 0, 'baseState: kein B/C ⇒ kein REST-delete auf members');
    // snapshot (fixture.mjs --pruefen): Mitglieder [A], A Admin, 0 Platzhalter, 0 Spiele
    eq(ms.map((m) => [m.profile_id, m.role]), [[U.A, 'admin']]);
    await t.su();
    eq(await n2(t, `select count(*)::int n from members where playgroup_id = $1 and removed_at is not null`, [G.id]), 0, 'keine Zeile mit removed_at');
    eq(await n2(t, `select count(*)::int n from games where playgroup_id = $1`, [G.id]), 0, '0 Spiele');
    eq(await n2(t, `select count(*)::int n from storage.objects where bucket_id = 'avatars' and name like 'members/%'`), 0, 'keine Platzhalter-Bilder');
    // ein späterer Lauf: nichts mehr zu tun, scheitert nicht
    log.length = 0;
    eq(await membersCleanup(io, fx), { games: 0, rejoined: 0, restored: 0, deleted: 0, files: 0, rounds: 0 });
    eq(log, ['deleteGames', 'members']);
    // nächste E2E-Datei: B tritt wieder bei (neue Zeile), spielt; Grundzustand ⇒ wieder nur A
    await t.as(U.B);
    const b4 = (await t.q(`select * from join_playgroup($1)`, [code]))[0].id;
    ok(![b1, pit.id].includes(b4), 'neue Zeile, keine frühere mehr da');
    await play(b4, dB);
    await membersCleanup(io, fx);
    await t.su();
    eq(await n2(t, `select count(*)::int n from members where playgroup_id = $1`, [G.id]), 1);
  } finally {
    await d.close();
  }
});

check('K-5 Direktes Löschen geschlossen: delete from members als Admin ⇒ 42501; Policy mem_delete fehlt', async () => {
  await as(U.A);
  const [p] = await q(`select * from create_placeholder($1, 'Del')`, [X.id]);
  let codeErr = null;
  try { await db.query(`delete from members where id = $1`, [p.id]); } catch (e) { codeErr = e.code; }
  eq(codeErr, '42501');
  ok((await row(p.id)) !== undefined, 'Zeile da');
  await su();
  ok(await n(`select count(*)::int n from pg_policies where tablename = 'members' and policyname = 'mem_delete'`) === 0);
  ok(await n(`select count(*)::int n from information_schema.role_table_grants where table_name = 'members' and privilege_type = 'DELETE' and grantee in ('anon', 'authenticated')`) === 0);
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
    'leave_playgroup(uuid)': [false, true], 'list_all_playgroups()': [false, true], 'enter_playgroup(uuid)': [false, true], 'join_playgroup(text)': [false, true],
    '_member_delete(uuid)': [false, false], '_member_deletable(uuid)': [false, false], 'gp_member_active()': [false, false], '_member_detach(uuid)': [false, false], '_member_account_guard(public.members)': [false, false],
  };
  const got = {};
  for (const sig of Object.keys(want)) {
    const [r] = await q(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u`, ['public.' + sig]);
    got[sig] = [r.a, r.u];
  }
  eq(got, want);
  const sd = await q(`select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1) order by 1`, [Object.keys(want).map((s) => s.split('(')[0])]);
  ok(sd.length === Object.keys(want).length && sd.every((p) => p.prosecdef && J(p.proconfig) === '["search_path=public"]'), J(sd));
});

// ================================================================ Krit. 12: Rückwärts-Block (zuletzt: verändert das Schema der Haupt-Datenbank)
const CATALOG = `select json_build_object(
  'functions', (select json_agg(x order by x) from (select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
      || md5(p.prosrc) || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') || '|' || coalesce(p.proacl::text, '') x
      from pg_proc p where p.pronamespace = 'public'::regnamespace) f),
  'policies', (select json_agg(x order by x) from (select tablename || '.' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') x
      from pg_policies where schemaname = 'public') f),
  'columns', (select json_agg(x order by x) from (select table_name || '.' || column_name || '|' || data_type || '|' || is_nullable x
      from information_schema.columns where table_schema = 'public') f),
  'constraints', (select json_agg(x order by x) from (select conrelid::regclass::text || '.' || conname || '|' || pg_get_constraintdef(oid) x
      from pg_constraint where connamespace = 'public'::regnamespace) f),
  'indexes', (select json_agg(x order by x) from (select indexname || '|' || indexdef x from pg_indexes where schemaname = 'public') f),
  'triggers', (select json_agg(x order by x) from (select tgrelid::regclass::text || '.' || tgname x from pg_trigger where not tgisinternal) f)
)::text j`;
check('K12 Rückwärts: Block (jede Zeile „-- “) läuft auf dem Bestand mit markierten Zeilen; Schema = Stand ohne die Migration', async () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  const m = sql.match(/-- RÜCKWÄRTS-BEGINN\r?\n([\s\S]*?)-- RÜCKWÄRTS-ENDE/);
  ok(m, 'Rückwärts-Block nicht gefunden');
  const lines = m[1].split(/\r?\n/).filter((l) => l !== '');
  ok(lines.every((l) => l.startsWith('-- ')), 'jede Zeile beginnt mit „-- “');
  const ref = await freshDb({ migrations: migrations(), until: FILE });
  try {
    const want = (await ref.query(CATALOG)).rows[0].j;
    await su();
    ok(await n(`select count(*)::int n from members where removed_at is not null`) > 0, 'Bestand hat markierte Zeilen');
    const m0 = await n(`select count(*)::int n from members`);
    await db.exec(lines.map((l) => l.slice(3)).join('\n'));
    const got = (await q(CATALOG))[0].j;
    if (got !== want) {
      const a = JSON.parse(got), b = JSON.parse(want);
      const diff = Object.keys(b).map((k) => [k, (a[k] || []).filter((x) => !(b[k] || []).includes(x)), (b[k] || []).filter((x) => !(a[k] || []).includes(x))])
        .filter(([, x, y]) => x.length || y.length);
      assert.fail(`Schema nach Rückwärts ≠ Stand ohne Migration: ${JSON.stringify(diff).slice(0, 2000)}`);
    }
    ok(await n(`select count(*)::int n from members`) === m0, 'Zeilen bleiben (Preis: Markierungen sind weg, Risiko 2)');
  } finally {
    await ref.close();
  }
});
