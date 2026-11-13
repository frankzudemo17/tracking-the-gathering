// P10 Impressum nur für Angemeldete (spec-p10-impressum.md, Migration 20261120000000_app_info.sql): Tabelle
// public.app_info (key/value/updated_at, Checks), Lesen nur für angemeldete, nicht anonyme Konten, Schreiben nur als
// Datenbank-Eigentümer, Migration legt keine Zeile an, Rückwärts-Block ausführbar, Bestand unberührt.
// Testwert ausschließlich die Muster-Anschrift unten — nie echte Angaben.
// Aufbau Rechte: A (Admin der Gruppe G, für „Schreiben“ zusätzlich Superadmin), B (Mitglied in G), Gast G (anonymes
// Konto), Rolle anon (ohne Anmeldung).
//
// Gegenproben (Spec Krit. 7):
//   GEGENPROBE=1       ⇒ alle Migrationen AUSSER dieser ⇒ die Datei muss rot sein
//   GEGENPROBE=policy  ⇒ Policy app_info_select im Test durch „using (true)“ ersetzt ⇒ „Lesen“ (Gast) rot
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261120000000_app_info.sql';
const GEGEN = process.env.GEGENPROBE || '';
const EXPECTED = 6;
const WERT = 'Erika Muster\nTeststraße 1\n00000 Prüfstadt';
let ran = 0;
let gegenDir = null;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const J = (x) => JSON.stringify(x);

/** Migrationsordner: normal alle; Gegenprobe (1) alle außer dieser. */
function migrations() {
  if (GEGEN !== '1') return MIGRATIONS;
  if (!gegenDir) {
    gegenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-p10-gegen-'));
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
const without = (o, k) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
const exists = async (d) => (await d.query(`select to_regclass('public.app_info') is not null x`)).rows[0].x;

/** Aufbau: drei Konten, ein Gast, eine Gruppe mit A (Admin) und B. */
async function seed(d) {
  const { as, q, seedUser, mkGroup } = tools(d);
  for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de'], [U.C, 'c@x.de']]) await seedUser(id, { email });
  await seedUser(U.G, { anonymous: true });
  const g = await mkGroup(U.A, 'G');
  await as(U.B);
  await q(`select * from join_playgroup($1)`, [g.invite_code]);
  return { g };
}

after(async () => {
  if (gegenDir) fs.rmSync(gegenDir, { recursive: true, force: true });
  // Schutz: bricht ein Szenario still ab, darf die Zahl nicht schrumpfen und trotzdem grün sein.
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

// ================================================================ Krit. 6: Rückwärts und Bestand (eigene Datenbanken)
check('Rückwärts/Bestand: Migration auf vorhandenen Daten — Zeilenzahlen gleich, 0 Zeilen app_info; Rückwärts-Block entfernt die Tabelle; frische Datenbank wieder grün', async () => {
  const d = await freshDb({ migrations: migrations(), until: FILE });
  const { su } = tools(d);
  try {
    await seed(d);
    await su();
    const counts0 = await allCounts(d);
    ok(counts0.playgroups === 1 && counts0.members === 2 && counts0.profiles >= 3, J(counts0));
    ok(!(await exists(d)), 'vor der Migration keine Tabelle app_info');
    if (GEGEN !== '1') await d.exec(migrationSql());
    const counts1 = await allCounts(d);
    assert.equal(counts1.app_info, 0, 'Migration legt keine Zeile an');
    assert.deepEqual(without(counts1, 'app_info'), counts0, 'Zeilenzahlen aller anderen public-Tabellen vor = nach der Migration');
    await d.exec(backwardSql());
    ok(!(await exists(d)), 'Rückwärts-Block: Tabelle app_info entfernt');
    assert.deepEqual(await allCounts(d), counts0, 'Zeilenzahlen nach dem Rückwärts-Block = Stand vor der Migration');
  } finally { await d.close(); }
  const e = await freshDb({ migrations: migrations() });
  try {
    ok(await exists(e), 'frische Datenbank mit allen Migrationen hat app_info');
    assert.equal((await e.query(`select count(*)::int n from public.app_info`)).rows[0].n, 0, 'frisch: 0 Zeilen');
  } finally { await e.close(); }
});

// ================================================================ Krit. 1–5: eine Datenbank, Reihenfolge
let db, as, su, q;
before(async () => {
  db = await freshDb({ migrations: migrations() });
  ({ as, su, q } = tools(db));
  await su();
  if (GEGEN === 'policy') {
    await db.exec(`drop policy if exists app_info_select on public.app_info;
      create policy app_info_select on public.app_info for select to authenticated using (true);`);
  }
  await seed(db);
  await su();
});
after(async () => { await db?.close(); });

/** Als `who` eine Anweisung ausführen; liefert { rows, n } oder { code, message } bei Fehler. Danach Superuser. */
async function run(who, sql, params, opts) {
  await as(who, opts);
  try { const r = await db.query(sql, params); return { rows: r.rows, n: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { code: e.code ?? null, message: String(e.message) }; }
  finally { await su(); }
}
const content = async () => { await su(); return (await q(`select key, value from public.app_info order by key`)); };

check('Form: Spalten, Typen, Default, Primärschlüssel, RLS an, 0 Zeilen nach der Migration', async () => {
  await su();
  const cols = (await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'app_info' order by ordinal_position`)).map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}:${r.column_default ?? ''}`);
  assert.deepEqual(cols, ['key:text:NO:', 'value:text:NO:', 'updated_at:timestamp with time zone:NO:now()']);
  const pk = (await q(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.app_info'::regclass and i.indisprimary`)).map((r) => r.attname);
  assert.deepEqual(pk, ['key'], 'Primärschlüssel key');
  const checks = (await q(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.app_info'::regclass and contype = 'c' order by conname`)).map((r) => r.d);
  assert.equal(checks.length, 2, J(checks));
  ok(checks.some((c) => c.includes("'^[a-z][a-z0-9_]{0,39}$'")), `Check key: ${J(checks)}`);
  ok(checks.some((c) => /char_length\(value\)/.test(c) && /1/.test(c) && /2000/.test(c)), `Check value: ${J(checks)}`);
  assert.equal((await q(`select relrowsecurity x from pg_class where oid = 'public.app_info'::regclass`))[0].x, true, 'RLS an');
  assert.equal((await q(`select count(*)::int n from public.app_info`))[0].n, 0, 'keine Zeile');
});

check('Policies/Grants: genau app_info_select (SELECT, authenticated); anon ohne Leserecht; kein Schreibrecht', async () => {
  await su();
  const pol = await q(`select policyname, cmd, roles::text r, permissive from pg_policies where schemaname = 'public' and tablename = 'app_info' order by policyname`);
  assert.deepEqual(pol, [{ policyname: 'app_info_select', cmd: 'SELECT', r: '{authenticated}', permissive: 'PERMISSIVE' }]);
  const priv = async (role, p) => (await q(`select has_table_privilege($1, 'public.app_info', $2) x`, [role, p]))[0].x;
  assert.equal(await priv('anon', 'SELECT'), false, 'anon SELECT');
  assert.equal(await priv('authenticated', 'SELECT'), true, 'authenticated SELECT');
  for (const role of ['anon', 'authenticated']) {
    for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) assert.equal(await priv(role, p), false, `${role} ${p}`);
  }
});

check('Grenzen: key-Muster und value-Länge (23514), 2000 Zeichen ok', async () => {
  await su();
  const ins = async (k, v) => { try { await db.query(`insert into public.app_info (key, value) values ($1, $2)`, [k, v]); return null; } catch (e) { return e.code ?? String(e.message); } };
  assert.equal(await ins('Impressum', 'x'), '23514', 'key mit Großbuchstaben');
  assert.equal(await ins('', 'x'), '23514', 'key leer');
  assert.equal(await ins('a'.repeat(41), 'x'), '23514', 'key 41 Zeichen');
  assert.equal(await ins('grenze', ''), '23514', 'value leer');
  assert.equal(await ins('grenze', 'x'.repeat(2001)), '23514', 'value 2001 Zeichen');
  assert.equal(await ins('a'.repeat(40), 'x'), null, 'key 40 Zeichen ok');
  assert.equal(await ins('grenze', 'ü'.repeat(2000)), null, 'value 2000 Zeichen (Codepunkte) ok');
  assert.equal((await q(`select char_length(value)::int n from public.app_info where key = 'grenze'`))[0].n, 2000);
  await q(`delete from public.app_info where key in ('grenze', $1)`, ['a'.repeat(40)]);
  assert.deepEqual(await content(), []);
});

check('Lesen: A und B lesen die Zeile, Gast (anonym) 0 Zeilen, Rolle anon kein Wert', async () => {
  await su();
  await q(`insert into public.app_info (key, value) values ('impressum', $1)`, [WERT]);
  const sel = `select value from public.app_info where key = 'impressum'`;
  const a = await run(U.A, sel);
  assert.deepEqual(a.rows, [{ value: WERT }], `A: ${J(a)}`);
  const b = await run(U.B, sel);
  assert.deepEqual(b.rows, [{ value: WERT }], `B: ${J(b)}`);
  const g = await run(U.G, sel, [], { anonymous: true });
  assert.deepEqual(g.rows, [], `Gast: ${J(g)}`);
  const n = await run(null, sel);
  // Ist-Wert (Spec Krit. 2: 42501 oder 0 Zeilen zulässig): ohne Grant ⇒ 42501 permission denied
  console.log(`  Ist-Wert Rolle anon: ${n.code ? `Fehler ${n.code}` : `${n.rows.length} Zeile(n)`}`);
  ok(n.code === '42501' || (Array.isArray(n.rows) && n.rows.length === 0), `anon: ${J(n)}`);
  ok(!J(n).includes('Teststraße'), 'anon sieht keinen Wert');
});

check('Schreiben: insert/update/delete als A (auch als Superadmin), B, Gast und anon abgewiesen; Inhalt unverändert', async () => {
  await su();
  const before0 = await content();
  assert.deepEqual(before0, [{ key: 'impressum', value: WERT }]);
  const denied = (r) => r.code === '42501' || r.n === 0;
  const tries = [
    [`insert into public.app_info (key, value) values ('neu', 'x')`],
    [`update public.app_info set value = 'geändert' where key = 'impressum'`],
    [`update public.app_info set value = 'geändert'`],
    [`delete from public.app_info where key = 'impressum'`],
    [`delete from public.app_info`],
    [`insert into public.app_info (key, value) values ('impressum', 'x') on conflict (key) do update set value = excluded.value`],
  ];
  const who = [['A', U.A, {}], ['B', U.B, {}], ['Gast', U.G, { anonymous: true }], ['anon', null, {}]];
  const codes = new Set();
  for (const superadmin of [false, true]) {
    await q(`update profiles set is_superadmin = $2 where id = $1`, [U.A, superadmin]);
    for (const [name, uid, opts] of who) {
      for (const [sql] of tries) {
        const r = await run(uid, sql, [], opts);
        codes.add(r.code ?? `n=${r.n}`);
        ok(denied(r), `${name}${superadmin ? ' (Superadmin)' : ''}: ${sql} ⇒ ${J(r)}`);
        assert.deepEqual(await content(), before0, `Inhalt unverändert nach ${name}: ${sql}`);
      }
    }
  }
  await q(`update profiles set is_superadmin = false where id = $1`, [U.A]);
  console.log(`  Ist-Werte Schreiben: ${[...codes].join(', ')}`);
});
