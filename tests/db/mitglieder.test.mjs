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
const EXPECTED = 1;
let ran = 0;
let gegenDir = null;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const eq = (a, b, info) => assert.deepEqual(a, b, info);
const J = (x) => JSON.stringify(x);

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
