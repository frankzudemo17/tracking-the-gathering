// P3 Spielstart-Intro (spec-p3-intro.md, Migration 20261118000000_deck_motto.sql): Spalte decks.motto
// (≤ 80 Codepunkte, nicht leer, ohne Rand-Leerzeichen, ohne Steuerzeichen), Rechte-Weg über die bestehende
// Policy decks_update (can_edit_deck), Bestand unberührt, Rückwärts-Block ausführbar.
// Bestand auf eigener Datenbank (Migration erst nach dem Aufbau), Form + Rechte auf EINER Datenbank (Reihenfolge).
// Aufbau Rechte (Muster deckliste.test.mjs): Gruppe G mit A Admin, B Mitglied, Platzhalter Tim; Gruppe H mit C;
// Gast X (anonymes Konto); Decks DA (A), DT (Tim), DC (C); Platzhalter Ria in G mit Deck DR, Ria danach entfernt.
//
// Gegenproben (Spec „Spec-Tests“):
//   GEGENPROBE=1      ⇒ alle Migrationen AUSSER dieser ⇒ die Datei muss rot sein
//   GEGENPROBE=check  ⇒ Constraint decks_motto_check im Test entfernt ⇒ „Motto-Form“ rot
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261118000000_deck_motto.sql';
const GEGEN = process.env.GEGENPROBE || '';
const EXPECTED = 7;
let ran = 0;
let gegenDir = null;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const J = (x) => JSON.stringify(x);

/** Migrationsordner: normal alle; Gegenprobe (1) alle außer dieser. */
function migrations() {
  if (GEGEN !== '1') return MIGRATIONS;
  if (!gegenDir) {
    gegenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-p3-gegen-'));
    for (const f of fs.readdirSync(MIGRATIONS)) if (f.endsWith('.sql') && f !== FILE) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(gegenDir, f));
  }
  return gegenDir;
}
const migrationSql = () => fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');

/** Rückwärts-Block der Migration: Zeilen zwischen RÜCKWÄRTS-BEGINN und -ENDE, ohne führendes „-- “. */
function backwardSql() {
  const src = migrationSql();
  const a = src.indexOf('RÜCKWÄRTS-BEGINN');
  const b = src.indexOf('RÜCKWÄRTS-ENDE');
  ok(a > 0 && b > a, 'Rückwärts-Block fehlt');
  return src.slice(a, b).split('\n').slice(1).filter((l) => l.startsWith('-- ')).map((l) => l.slice(3)).join('\n');
}

/** Zeilenzahlen aller Tabellen in public (als Superuser). */
async function allCounts(d) {
  const t = (await d.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows;
  const out = {};
  for (const { table_name } of t) out[table_name] = (await d.query(`select count(*)::int n from public."${table_name}"`)).rows[0].n;
  return out;
}
const deckCols = async (d) => (await d.query(`select column_name, data_type, is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'decks' order by ordinal_position`)).rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`);
const policies = async (d) => (await d.query(`select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'decks' order by policyname`)).rows;
const hasCheck = async (d) => (await d.query(`select count(*)::int n from pg_constraint where conname = 'decks_motto_check' and conrelid = 'public.decks'::regclass`)).rows[0].n === 1;

/** Aufbau: zwei Gruppen, Konto-Decks, Platzhalter-Deck, archiviertes Deck, Deck mit bracket_check. */
async function seed(d) {
  const { as, q, seedUser, mkGroup } = tools(d);
  for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de'], [U.C, 'c@x.de']]) await seedUser(id, { email });
  await seedUser(U.G, { anonymous: true });
  const g = await mkGroup(U.A, 'G');
  const h = await mkGroup(U.C, 'H');
  await as(U.B);
  await q(`select * from join_playgroup($1)`, [g.invite_code]);
  await as(U.A);
  const [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [g.id]);
  const [ria] = await q(`select * from create_placeholder($1, 'Ria')`, [g.id]);
  const deck = async (col, owner, name, extra = '') =>
    (await q(`insert into decks (${col}, commander_name, short_name${extra ? ', archived' : ''}) values ($1, $2, $2${extra ? ', true' : ''}) returning id`, [owner, name]))[0].id;
  const D = {};
  D.A = await deck('owner_profile_id', U.A, 'DA');
  D.Arch = await deck('owner_profile_id', U.A, 'DArch', 'archived');
  D.T = await deck('owner_member_id', tim.id, 'DT');
  D.R = await deck('owner_member_id', ria.id, 'DR');
  await q(`update decks set bracket_check = $2::jsonb where id = $1`, [D.A, J({ floor: 2, combos: [{ cards: ['X', 'Y'], produces: ['Infinite mana'] }] })]);
  await as(U.C);
  D.C = await deck('owner_profile_id', U.C, 'DC');
  return { g, h, tim, ria, D };
}

/** Fehlercode und Text einer Anweisung (null = kein Fehler). */
async function fault(d, sql, params) {
  try { await d.query(sql, params); return null; } catch (e) { return { code: e.code ?? null, message: String(e.message) }; }
}

after(async () => {
  if (gegenDir) fs.rmSync(gegenDir, { recursive: true, force: true });
  // Schutz: bricht ein Szenario still ab, darf die Zahl nicht schrumpfen und trotzdem grün sein.
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

// ================================================================ Krit. 8 + 11: Bestand und Rückwärts
check('K8 Bestand: Migration auf vorhandenen Daten — Zeilenzahlen gleich, motto null, Spalte zuletzt, Check da, Policies gleich', async () => {
  const d = await freshDb({ migrations: migrations(), until: FILE });
  const { su, q } = tools(d);
  try {
    await seed(d);
    await su();
    const counts0 = await allCounts(d);
    ok(counts0.decks === 5 && counts0.playgroups === 2, J(counts0));
    const cols0 = await deckCols(d);
    const pol0 = await policies(d);
    const decks0 = (await q(`select * from decks order by id`)).map((r) => J(r));
    if (GEGEN !== '1') await d.exec(migrationSql());
    assert.deepEqual(await allCounts(d), counts0, 'Zeilenzahlen aller public-Tabellen vor = nach');
    const after0 = await q(`select * from decks order by id`);
    ok(after0.every((r) => Object.hasOwn(r, 'motto') && r.motto === null), 'jede Zeile motto = null');
    assert.deepEqual(after0.map(({ motto, ...r }) => J(r)), decks0, 'Bestandsspalten unverändert');
    assert.deepEqual(await deckCols(d), [...cols0, 'motto:text:YES'], 'Spaltenliste = vorher + motto (zuletzt, text, nullable)');
    ok(await hasCheck(d), 'Constraint decks_motto_check');
    assert.deepEqual(await policies(d), pol0, 'pg_policies decks vor = nach');
  } finally { await d.close(); }
});

check('K11 Rückwärts-Block: Spaltenliste wie vorher, Constraint weg; danach frische Datenbank wieder grün', async () => {
  const d = await freshDb({ migrations: migrations(), until: FILE });
  try {
    const cols0 = await deckCols(d);
    if (GEGEN !== '1') await d.exec(migrationSql());
    ok(await hasCheck(d), 'Constraint nach der Migration');
    await d.exec(backwardSql());
    assert.deepEqual(await deckCols(d), cols0, 'Spaltenliste = Stand vor der Migration');
    ok(!(await hasCheck(d)), 'Constraint entfernt');
  } finally { await d.close(); }
  const e = await freshDb({ migrations: migrations() });
  try { ok((await deckCols(e)).includes('motto:text:YES'), 'frische Datenbank mit allen Migrationen hat motto'); } finally { await e.close(); }
});

// ================================================================ Krit. 9 + 10: Form und Rechte (eine Datenbank)
let db, as, su, q, S;
before(async () => {
  db = await freshDb({ migrations: migrations() });
  ({ as, su, q } = tools(db));
  await su();
  if (GEGEN === 'check') await db.exec('alter table public.decks drop constraint if exists decks_motto_check;');
  S = await seed(db);
  await su();
  // Ria entfernen (P10: Decks entfernter Platzhalter sind lesbar, nicht änderbar)
  await q(`update members set removed_at = now() where id = $1`, [S.ria.id]);
});
after(async () => { await db?.close(); });

/** Als `who` setzen; liefert geänderte Zeilen oder { code, message } bei Fehler. */
async function setMotto(who, deck, value, opts) {
  await as(who, opts);
  try { return (await db.query(`update decks set motto = $2 where id = $1 returning id`, [deck, value])).rows.length; }
  catch (e) { return { code: e.code ?? null, message: String(e.message) }; }
}
const mottoOf = async (deck) => { await su(); return (await q(`select motto from decks where id = $1`, [deck]))[0].motto; };
const isCheckError = (r) => r && typeof r === 'object' && (r.code === '23514' || /decks_motto_check/.test(r.message));

check('K9 Motto-Form: ≤ 80 Codepunkte, nicht leer, ohne Rand, ohne Steuerzeichen; Umlaut ok; leeren erlaubt', async () => {
  const D = S.D;
  assert.equal(await setMotto(U.A, D.A, 'x'.repeat(80)), 1, '80 Zeichen');
  const r81 = await setMotto(U.A, D.A, 'x'.repeat(81));
  ok(isCheckError(r81) && r81.code === '23514' && /decks_motto_check/.test(r81.message), `81: ${J(r81)}`);
  assert.equal(await setMotto(U.A, D.A, '🐉'.repeat(80)), 1, '80 Emoji');
  ok(isCheckError(await setMotto(U.A, D.A, '🐉'.repeat(81))), '81 Emoji');
  for (const bad of ['', ' Hallo', 'Hallo ', 'a\nb', 'a\tb']) ok(isCheckError(await setMotto(U.A, D.A, bad)), `Fehler erwartet für ${J(bad)}`);
  assert.equal(await setMotto(U.A, D.A, 'Grüße aus der Gruft'), 1, 'Umlaut');
  assert.equal(await mottoOf(D.A), 'Grüße aus der Gruft');
  assert.equal(await setMotto(U.A, D.A, null), 1, 'leeren');
  assert.equal(await mottoOf(D.A), null);
});

check('K10 Motto-Rechte: Besitzer, Platzhalter-Deck für Gruppenmitglieder, nicht fremd/entfernt/anonym/Gast', async () => {
  const D = S.D;
  assert.equal(await setMotto(U.A, D.A, 'Von A'), 1, 'A ⇒ DA');
  assert.equal(await mottoOf(D.A), 'Von A');
  assert.equal(await setMotto(U.B, D.A, 'Von B'), 0, 'B ⇒ DA (Konto-Deck von A)');
  assert.equal(await mottoOf(D.A), 'Von A', 'Motto unverändert');
  assert.equal(await setMotto(U.B, D.T, 'Tim von B'), 1, 'B ⇒ DT (Platzhalter in G)');
  assert.equal(await mottoOf(D.T), 'Tim von B');
  assert.equal(await setMotto(U.A, D.T, 'Tim von A'), 1, 'A ⇒ DT');
  assert.equal(await mottoOf(D.T), 'Tim von A');
  assert.equal(await setMotto(U.C, D.T, 'Tim von C'), 0, 'C ⇒ DT');
  assert.equal(await setMotto(U.C, D.A, 'A von C'), 0, 'C ⇒ DA');
  assert.equal(await mottoOf(D.T), 'Tim von A');
  assert.equal(await setMotto(U.B, D.R, 'Ria'), 0, 'B ⇒ DR (entfernter Platzhalter)');
  assert.equal(await mottoOf(D.R), null);
  const anon = await setMotto(null, D.A, 'anonym');
  ok(anon === 0 || (anon && typeof anon === 'object' && /permission denied/.test(anon.message)), `anonym: ${J(anon)}`);
  assert.equal(await setMotto(U.G, D.A, 'Gast', { anonymous: true }), 0, 'Gast (anonymes Konto) ⇒ DA');
  assert.equal(await mottoOf(D.A), 'Von A', 'Motto nach allen Versuchen unverändert');
});

check('K10 Motto lesen: B (gleiche Gruppe) sieht das Motto von DA, C (fremde Gruppe) nicht', async () => {
  await as(U.B);
  assert.deepEqual(await q(`select motto from decks where id = $1`, [S.D.A]), [{ motto: 'Von A' }]);
  await as(U.C);
  assert.deepEqual(await q(`select motto from decks where id = $1`, [S.D.A]), []);
});

check('K10 Grants: authenticated darf motto per Tabellenrecht ändern (Rechte-Weg ist die Policy)', async () => {
  await su();
  assert.equal((await q(`select has_column_privilege('authenticated', 'public.decks', 'motto', 'UPDATE') x`))[0].x, true);
  // keine neue Policy: weiterhin genau die vier aus init.sql
  assert.deepEqual((await q(`select policyname from pg_policies where tablename = 'decks' order by 1`)).map((r) => r.policyname),
    ['decks_delete', 'decks_insert', 'decks_select', 'decks_update']);
});

check('K12 Zeilenkopie über den Zeilentyp (konto.sql/mitglieder.sql: insert into decks select (c).*): Motto wandert mit', async () => {
  await su();
  // Kopie wie in den Migrationen: kompletter Zeilentyp in neue Zeile (andere id) — motto ist die letzte Spalte und kommt mit
  await q(`create temp table c_copy as select * from decks where id = $1`, [S.D.A]);
  await q(`update c_copy set id = gen_random_uuid()`);
  const [copy] = await q(`with c as (select t as c from c_copy t) insert into decks select (c).* from c returning motto`);
  assert.equal(copy.motto, 'Von A');
  await q(`drop table c_copy`);
});
