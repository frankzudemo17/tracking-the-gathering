// P8 Intro 2.0 (spec-p8-intro2.md, Migration 20261119000000_intro_seconds.sql): Spalte playgroups.intro_seconds
// (2–10, Standard 4), Schreiben NUR über set_intro_seconds (Gruppen-Admin oder Superadmin, Rechte vor Bereich),
// kein direkter Schreibweg (kein Spalten-Grant, keine Policy), Bestand unberührt, Rückwärts-Block ausführbar.
// Bestand auf eigener Datenbank (Migration erst nach dem Aufbau), Grenzen + Rechte auf EINER Datenbank (Reihenfolge).
// Aufbau Rechte: Gruppe G mit A Admin, B Mitglied, Platzhalter Tim; Gruppe H mit C Admin; Konto E war Admin von G
// (als Superuser befördert) und hat G über leave_playgroup verlassen; Superadmin S ohne Mitgliedschaft in G;
// Gast X anonymes Konto.
//
// Gegenproben (Spec „Spec-Tests“):
//   GEGENPROBE=1      ⇒ alle Migrationen AUSSER dieser ⇒ die Datei muss rot sein
//   GEGENPROBE=grant  ⇒ zusätzlich grant update (intro_seconds) to authenticated ⇒ Fälle „direkt“ rot
//   GEGENPROBE=offen  ⇒ set_intro_seconds ohne Rechteprüfung (b) ⇒ Fälle B/C/E rot
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261119000000_intro_seconds.sql';
const GEGEN = process.env.GEGENPROBE || '';
const EXPECTED = 7;
const E = 'ffffffff-0000-4000-8000-000000000006';
const S = '99999999-0000-4000-8000-000000000007';
let ran = 0;
let gegenDir = null;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const J = (x) => JSON.stringify(x);

/** Migrationsordner: normal alle; Gegenprobe (1) alle außer dieser. */
function migrations() {
  if (GEGEN !== '1') return MIGRATIONS;
  if (!gegenDir) {
    gegenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-p8-gegen-'));
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
const pgCols = async (d) => (await d.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'playgroups' order by ordinal_position`)).rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}:${r.column_default ?? ''}`);
const policies = async (d) => (await d.query(`select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'playgroups' order by policyname`)).rows;
const funcs = async (d) => (await d.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' f from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).rows.map((r) => r.f);
const hasCheck = async (d) => (await d.query(`select count(*)::int n from pg_constraint where conname = 'playgroups_intro_seconds_check' and conrelid = 'public.playgroups'::regclass`)).rows[0].n === 1;

/** Aufbau: G (A Admin, B Mitglied, Platzhalter Tim, ein Spiel), H (C Admin). */
async function seed(d) {
  const { as, q, seedUser, mkGroup } = tools(d);
  for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de'], [U.C, 'c@x.de']]) await seedUser(id, { email });
  const g = await mkGroup(U.A, 'G');
  const h = await mkGroup(U.C, 'H');
  await as(U.B);
  const [mB] = await q(`select * from join_playgroup($1)`, [g.invite_code]);
  await as(U.A);
  const [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [g.id]);
  const [mA] = await q(`select * from members where playgroup_id = $1 and profile_id = $2`, [g.id, U.A]);
  const [dA] = await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'Atraxa', 'Atraxa') returning id`, [U.A]);
  const [dT] = await q(`insert into decks (owner_member_id, commander_name, short_name) values ($1, 'Krenko', 'Krenko') returning id`, [tim.id]);
  const players = [{ member_id: mA.id, deck_id: dA.id, seat: 0 }, { member_id: tim.id, deck_id: dT.id, seat: 1 }];
  const [game] = await q(`select * from start_game($1, 'seiten', 40, 0, $2::jsonb, '2026-11-19')`, [g.id, J(players)]);
  return { g, h, mB, tim, game };
}

after(async () => {
  if (gegenDir) fs.rmSync(gegenDir, { recursive: true, force: true });
  // Schutz: bricht ein Szenario still ab, darf die Zahl nicht schrumpfen und trotzdem grün sein.
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

// ================================================================ Krit. 8 + 11: Bestand und Rückwärts
check('K8 Bestand: Migration auf vorhandenen Daten — Zeilenzahlen gleich, 4 s überall, Spalte zuletzt, Check, Policies, Rechte, Funktion', async () => {
  const d = await freshDb({ migrations: migrations(), until: FILE });
  const { su, q } = tools(d);
  try {
    const S0 = await seed(d);
    await su();
    const counts0 = await allCounts(d);
    ok(counts0.playgroups === 2 && counts0.games === 1 && counts0.members >= 4, J(counts0));
    const cols0 = await pgCols(d);
    const pol0 = await policies(d);
    const rows0 = (await q(`select * from playgroups order by id`)).map((r) => J(r));
    if (GEGEN !== '1') await d.exec(migrationSql());
    assert.deepEqual(await allCounts(d), counts0, 'Zeilenzahlen aller public-Tabellen vor = nach');
    const after0 = await q(`select * from playgroups order by id`);
    ok(after0.length === 2 && after0.every((r) => r.intro_seconds === 4), `jede Zeile intro_seconds = 4: ${J(after0.map((r) => r.intro_seconds))}`);
    assert.deepEqual(after0.map(({ intro_seconds, ...r }) => J(r)), rows0, 'Bestandsspalten unverändert');
    assert.deepEqual(await pgCols(d), [...cols0, 'intro_seconds:smallint:NO:4'], 'Spaltenliste = vorher + intro_seconds (zuletzt, smallint, NOT NULL, Default 4)');
    ok(await hasCheck(d), 'Constraint playgroups_intro_seconds_check');
    assert.deepEqual(await policies(d), pol0, 'pg_policies playgroups vor = nach');
    const priv = async (col, p) => (await q(`select has_column_privilege('authenticated', 'public.playgroups', $1, $2) x`, [col, p]))[0].x;
    assert.equal(await priv('intro_seconds', 'UPDATE'), false, 'authenticated darf intro_seconds nicht direkt ändern');
    assert.equal(await priv('intro_seconds', 'SELECT'), true, 'authenticated darf intro_seconds lesen');
    assert.equal(await priv('name', 'UPDATE'), true, 'Bestand: name bleibt änderbar');
    const [fn] = await q(`select prosecdef, proconfig from pg_proc where oid = 'public.set_intro_seconds(uuid, int)'::regprocedure`);
    ok(fn?.prosecdef === true && (fn.proconfig || []).includes('search_path=public'), J(fn));
    const exec = async (role) => (await q(`select has_function_privilege($1, 'public.set_intro_seconds(uuid, int)', 'EXECUTE') x`, [role]))[0].x;
    assert.equal(await exec('anon'), false, 'anon darf nicht ausführen');
    assert.equal(await exec('authenticated'), true, 'authenticated darf ausführen');
    ok(S0.game?.id, 'Spiel im Bestand');
  } finally { await d.close(); }
});

check('K11 Rückwärts-Block: Spaltenliste, Policies, Funktionen wie vorher; danach frische Datenbank wieder grün', async () => {
  const d = await freshDb({ migrations: migrations(), until: FILE });
  try {
    const cols0 = await pgCols(d);
    const pol0 = await policies(d);
    const fn0 = await funcs(d);
    if (GEGEN !== '1') await d.exec(migrationSql());
    ok(await hasCheck(d), 'Constraint nach der Migration');
    ok((await funcs(d)).includes('set_intro_seconds(p_group uuid, p_seconds integer)'), 'Funktion nach der Migration');
    await d.exec(backwardSql());
    assert.deepEqual(await pgCols(d), cols0, 'Spaltenliste = Stand vor der Migration');
    assert.deepEqual(await policies(d), pol0, 'Policies = Stand vor der Migration');
    assert.deepEqual(await funcs(d), fn0, 'Funktionsliste = Stand vor der Migration');
    ok(!(await hasCheck(d)), 'Constraint entfernt');
  } finally { await d.close(); }
  const e = await freshDb({ migrations: migrations() });
  try { ok((await pgCols(e)).includes('intro_seconds:smallint:NO:4'), 'frische Datenbank mit allen Migrationen hat intro_seconds'); } finally { await e.close(); }
});

// ================================================================ Krit. 9 + 10: Grenzen und Rechte (eine Datenbank)
let db, as, su, q, W;
before(async () => {
  db = await freshDb({ migrations: migrations() });
  ({ as, su, q } = tools(db));
  const { seedUser } = tools(db);
  await su();
  if (GEGEN === 'grant') await db.exec('grant update (intro_seconds) on public.playgroups to authenticated;');
  if (GEGEN === 'offen') {
    await db.exec(`create or replace function public.set_intro_seconds(p_group uuid, p_seconds int)
      returns int language plpgsql security definer set search_path = public as $$
      begin
        if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
        if p_seconds is null or p_seconds not between 2 and 10 then raise exception 'intro_seconds_range'; end if;
        update playgroups set intro_seconds = p_seconds where id = p_group;
        if not found then raise exception 'Gruppe nicht gefunden'; end if;
        return p_seconds;
      end $$;`);
  }
  W = await seed(db);
  await seedUser(E, { email: 'e@x.de' });
  await seedUser(S, { email: 's@x.de' });
  await seedUser(U.G, { anonymous: true });
  await su();
  await q(`update profiles set is_superadmin = true where id = $1`, [S]);
  // E tritt G bei, wird (als Superuser) Admin und verlässt G wieder
  await as(E);
  await q(`select * from join_playgroup($1)`, [W.g.invite_code]);
  await su();
  await q(`update members set role = 'admin' where playgroup_id = $1 and profile_id = $2`, [W.g.id, E]);
  await as(E);
  const [left] = await q(`select leave_playgroup($1) r`, [W.g.id]);
  ok(left.r?.result === 'left', J(left));
  await su();
});
after(async () => { await db?.close(); });

/** set_intro_seconds als `who`; liefert den Rückgabewert oder { code, message }. */
async function setSec(who, group, value, opts) {
  await as(who, opts);
  try { return (await db.query(`select set_intro_seconds($1, $2) v`, [group, value])).rows[0].v; }
  catch (e) { return { code: e.code ?? null, message: String(e.message) }; }
}
/** direktes UPDATE als `who`; liefert geänderte Zeilen oder { code, message }. */
async function direct(who, group, sql = 'update playgroups set intro_seconds = $2 where id = $1 returning id', value = 5) {
  await as(who);
  try { return (await db.query(sql, [group, value])).rows.length; }
  catch (e) { return { code: e.code ?? null, message: String(e.message) }; }
}
const secOf = async (group) => { await su(); return (await q(`select intro_seconds from playgroups where id = $1`, [group]))[0]?.intro_seconds; };
const isErr = (r, re) => !!r && typeof r === 'object' && re.test(r.message);

check('K9 Grenzen: 2 und 10 gehen; 1, 11, 0, −1, null ⇒ intro_seconds_range; Check direkt 23514; neue Gruppe 4; unbekannte Gruppe', async () => {
  const G = W.g.id;
  assert.equal(await setSec(U.A, G, 2), 2, 'Untergrenze');
  assert.equal(await secOf(G), 2);
  assert.equal(await setSec(U.A, G, 10), 10, 'Obergrenze');
  assert.equal(await secOf(G), 10);
  for (const v of [1, 11, 0, -1, null]) {
    const r = await setSec(U.A, G, v);
    ok(isErr(r, /intro_seconds_range/), `${v}: ${J(r)}`);
    assert.equal(await secOf(G), 10, `Spalte unverändert nach ${v}`);
  }
  await su();
  let c = null;
  try { await db.query(`update playgroups set intro_seconds = 11 where id = $1`, [G]); } catch (e) { c = { code: e.code, message: String(e.message) }; }
  ok(c && c.code === '23514' && /playgroups_intro_seconds_check/.test(c.message), `Constraint direkt: ${J(c)}`);
  const { mkGroup } = tools(db);
  const n = await mkGroup(U.C, 'Neu');
  await su();
  assert.equal(await secOf(n.id), 4, 'neue Gruppe (create_playgroup) ⇒ 4');
  const r = await setSec(S, '00000000-0000-4000-8000-0000000000ff', 5);
  ok(isErr(r, /Gruppe nicht gefunden/), `unbekannte Gruppe: ${J(r)}`);
});

check('K10 Rechte über set_intro_seconds: A ja, B/C/E nein, A nicht in H, S ja, Rechte vor Bereich, anon/Gast nein', async () => {
  const G = W.g.id, H = W.h.id;
  assert.equal(await setSec(U.A, G, 6), 6, 'A ⇒ 6');
  assert.equal(await secOf(G), 6);
  ok(isErr(await setSec(U.B, G, 7), /not_group_admin/), 'B (Mitglied) ⇒ not_group_admin');
  assert.equal(await secOf(G), 6);
  ok(isErr(await setSec(U.C, G, 7), /not_group_admin/), 'C (Admin von H) ⇒ not_group_admin');
  assert.equal(await secOf(G), 6);
  ok(isErr(await setSec(U.A, H, 7), /not_group_admin/), 'A ⇒ H');
  assert.equal(await secOf(H), 4, 'H unverändert');
  ok(isErr(await setSec(E, G, 7), /not_group_admin/), 'E (ausgetretener Admin)');
  assert.equal(await secOf(G), 6);
  assert.equal(await setSec(S, G, 8), 8, 'S (Superadmin ohne Mitgliedschaft) ⇒ 8');
  assert.equal(await secOf(G), 8);
  const b99 = await setSec(U.B, G, 99);
  ok(isErr(b99, /not_group_admin/) && !isErr(b99, /intro_seconds_range/), `Rechte vor Bereich: ${J(b99)}`);
  const anon = await setSec(null, G, 5);
  ok(isErr(anon, /permission denied for function/), `anon: ${J(anon)}`);
  ok(isErr(await setSec(U.G, G, 5, { anonymous: true }), /Nicht angemeldet/), 'Gast X (anonymes Konto)');
  assert.equal(await secOf(G), 8, 'Wert nach allen Versuchen 8');
});

check('K10 kein direkter Schreibweg: UPDATE intro_seconds als A und B ⇒ permission denied (42501); name bleibt für A änderbar', async () => {
  const G = W.g.id;
  const a = await direct(U.A, G);
  ok(a && a.code === '42501' && /permission denied/.test(a.message), `A direkt: ${J(a)}`);
  const b = await direct(U.B, G);
  ok(b && b.code === '42501' && /permission denied/.test(b.message), `B direkt: ${J(b)}`);
  assert.equal(await secOf(G), 8, 'Spalte unverändert');
  assert.equal(await direct(U.A, G, 'update playgroups set name = $2 where id = $1 returning id', 'G2'), 1, 'A ⇒ name (Bestand)');
});

check('K10 Lesen: B (Mitglied) sieht den Wert, C (fremd) 0 Zeilen, anon 0 Zeilen oder Rechtefehler', async () => {
  const G = W.g.id;
  await as(U.B);
  assert.deepEqual(await q(`select intro_seconds from playgroups where id = $1`, [G]), [{ intro_seconds: 8 }]);
  await as(U.C);
  assert.deepEqual(await q(`select intro_seconds from playgroups where id = $1`, [G]), []);
  await as(null);
  let rows = null, msg = '';
  try { rows = await q(`select intro_seconds from playgroups where id = $1`, [G]); } catch (e) { msg = String(e.message); }
  ok((Array.isArray(rows) && rows.length === 0) || /permission denied/.test(msg), `anon: ${J(rows)} ${msg}`);
  await su();
});

check('K8 Policies playgroups: weiterhin genau die Bestands-Policies, keine für intro_seconds', async () => {
  await su();
  const p = (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'playgroups' order by policyname`)).map((r) => `${r.policyname}:${r.cmd}`);
  ok(!p.some((x) => /intro/i.test(x)), J(p));
  ok(p.includes('pg_update:UPDATE') && p.includes('pg_select:SELECT'), J(p));
});
