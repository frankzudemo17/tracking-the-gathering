// P9 Zugang (spec-p9-zugang.md): Superadmin, Gruppen/Rollen, Einladungscode in playgroup_invites,
// Registrierungs-Tor auf auth.users, Konten-Deckel, Rechte, Bestandsprobe, Rückwärts-Block.
// Haupt-Szenario auf EINER Datenbank (Fälle laufen in Reihenfolge); Deckel (Krit. 9–11) und
// Bestand (Krit. 1, 5, 12) auf eigenen Datenbanken, damit die Zählungen exakt sind.
//
// Gegenproben (Spec „Spec-Tests“):
//   TTG_GEGENPROBE=ohne  ⇒ alle Datenbanken OHNE 20261116000000_zugang.sql  (Datei muss rot sein)
//   TTG_GEGENPROBE=tor   ⇒ Tor im Test abgeschaltet (alter table auth.users disable trigger
//                          ttg_signup_gate) ⇒ die Prüfungen aus Krit. 7–9 müssen rot sein
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshDb, tools, U, MIGRATIONS } from './harness.mjs';

const FILE = '20261116000000_zugang.sql';
const GEGEN = process.env.TTG_GEGENPROBE || '';
// einzige personenbezogene Angabe (Spec A): Profil-ID des bestehenden Superadmin-Kontos
const SA = 'cd49f5b1-0272-474d-88ab-13e16ac02a3d';
const CODE_RE = /^TTG-[A-HJ-NP-Z2-9]{6}$/;

let db, as, su, q, err, seedUser, mkGroup;
const check = (name, fn) => test(name, fn);
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const eq = (a, b, info) => assert.deepEqual(a, b, info);
const n = async (sql, params) => (await q(sql, params))[0].n;
/** SQLSTATE eines Fehlers (oder null) */
const code = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.code; } };
const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

async function open(opts = {}) {
  const d = await freshDb(GEGEN === 'ohne' ? { until: FILE, ...opts } : opts);
  if (GEGEN === 'tor') await d.exec('alter table auth.users disable trigger ttg_signup_gate;');
  return d;
}

before(async () => {
  db = await open();
  ({ as, su, q, err, seedUser, mkGroup } = tools(db));
});
after(async () => { await db?.close(); });

// geteilter Zustand
let X, SG, mB, mC, tim;

// ---------------------------------------------------------------- Aufbau
check('Aufbau: Superadmin S (Flag per SQL), A Admin von X, B und C Mitglieder, D ohne Gruppe', async () => {
  await su();
  ok(await n(`select count(*)::int n from profiles where is_superadmin`) === 0, 'Migration ohne die Profil-Zeile: niemand Superadmin');
  for (const [id, email, meta] of [[SA, 's@example.test', { display_name: 'Sam' }], [U.A, 'a@x.de', {}], [U.B, 'b@x.de', {}],
    [U.C, 'c@x.de', {}], [U.D, 'd@x.de', {}], [U.G, null, {}]]) await seedUser(id, { email, meta });
  await q(`update profiles set is_superadmin = true where id = $1`, [SA]);
  X = await mkGroup(U.A, 'X');
  ok(CODE_RE.test(X.invite_code), X.invite_code);
  await as(U.B);
  [{ id: mB }] = await q(`select * from join_playgroup($1)`, [X.invite_code]);
  await as(U.C);
  [{ id: mC }] = await q(`select * from join_playgroup($1)`, [X.invite_code]);
  await as(U.A);
  [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [X.id]);
  await su();
  ok(await n(`select count(*)::int n from members where playgroup_id = $1`, [X.id]) === 4);
  ok(await n(`select count(*)::int n from profiles where is_superadmin`) === 1, 'mkGroup setzt das Flag zurück');
});

// ---------------------------------------------------------------- Krit. 1: Superadmin-Flag
check('K1 is_superadmin(): S true, A/B false, anonym false', async () => {
  await as(SA);
  ok((await q(`select is_superadmin() x`))[0].x === true);
  for (const u of [U.A, U.B]) { await as(u); ok((await q(`select is_superadmin() x`))[0].x === false, u); }
  await as(U.G, { anonymous: true });
  ok((await q(`select is_superadmin() x`))[0].x === false);
});
check('K1 Flag vom Client nicht setzbar: update ⇒ 42501, insert into profiles ⇒ 42501', async () => {
  await as(U.B);
  eq(await code(`update profiles set is_superadmin = true where id = $1`, [U.B]), '42501');
  eq(await code(`insert into profiles (id, display_name, is_superadmin) values ($1, 'X', true)`, [uid(900)]), '42501');
  eq(await code(`insert into profiles (id, display_name) values ($1, 'X')`, [uid(901)]), '42501');
  await su();
  ok((await q(`select is_superadmin x from profiles where id = $1`, [U.B]))[0].x === false);
  // Spaltenfreigabe aus sicherheit.sql unverändert
  const cols = (await q(`select column_name c from information_schema.column_privileges
                         where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1`)).map((r) => r.c);
  eq(cols, ['avatar_path', 'display_name', 'locale', 'theme']);
});

// ---------------------------------------------------------------- Krit. 2: Gruppen
check('K2 Superadmin create_playgroup ⇒ Gruppe, Admin-Mitgliedschaft, 1 Zeile playgroup_invites', async () => {
  await as(SA);
  [SG] = await q(`select * from create_playgroup(' SG ')`);
  ok(SG.name === 'SG');
  await su();
  eq(await q(`select profile_id, role::text from members where playgroup_id = $1`, [SG.id]), [{ profile_id: SA, role: 'admin' }]);
  const inv = await q(`select code from playgroup_invites where playgroup_id = $1`, [SG.id]);
  ok(inv.length === 1 && CODE_RE.test(inv[0].code), JSON.stringify(inv));
});
check('K2 Gruppen-Admin und Konto ohne Gruppe ⇒ superadmin_only, 0 neue Zeilen', async () => {
  await su();
  const before0 = await n(`select (select count(*) from playgroups) + (select count(*) from members) + (select count(*) from playgroup_invites) n`);
  for (const u of [U.A, U.D]) {
    await as(u);
    ok(/superadmin_only/.test(await err(`select * from create_playgroup('Neu')`) || ''), u);
  }
  await su();
  ok(await n(`select (select count(*) from playgroups) + (select count(*) from members) + (select count(*) from playgroup_invites) n`) === before0);
});
check('K2 ohne Sitzung / anonym ⇒ unverändert (anonym und authenticated ohne sub: „Nicht angemeldet“, anon: kein Ausführungsrecht)', async () => {
  await as(U.G, { anonymous: true });
  ok(/Nicht angemeldet/.test(await err(`select * from create_playgroup('Anon')`) || ''));
  await as(null);
  eq(await code(`select * from create_playgroup('Niemand')`), '42501');
  // authenticated ohne Benutzer-ID (z. B. abgelaufene Sitzung)
  await su();
  await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{"role":"authenticated"}', false)`);
  await db.exec('set role authenticated;');
  ok(/Nicht angemeldet/.test(await err(`select * from create_playgroup('Niemand')`) || ''));
  await su();
});

// ---------------------------------------------------------------- Krit. 3: Rollen
const role = async (mid) => { await su(); return (await q(`select role::text r from members where id = $1`, [mid]))[0].r; };
check('K3 Gruppen-Admin befördert ⇒ superadmin_only, Rolle unverändert', async () => {
  await as(U.A);
  ok(/superadmin_only/.test(await err(`select * from set_member_role($1, 'admin')`, [mB]) || ''));
  ok(await role(mB) === 'member');
});
check('K3 Superadmin befördert ohne Mitgliedschaft in der Gruppe ⇒ admin', async () => {
  await su();
  ok(await n(`select count(*)::int n from members where playgroup_id = $1 and profile_id = $2`, [X.id, SA]) === 0, 'S nicht Mitglied von X');
  await as(SA);
  const [r] = await q(`select * from set_member_role($1, 'admin')`, [mB]);
  ok(r.role === 'admin');
});
check('K3 Gruppen-Admin stuft anderen Admin herab ⇒ member', async () => {
  await as(U.A);
  const [r] = await q(`select * from set_member_role($1, 'member')`, [mB]);
  ok(r.role === 'member');
});
check('K3 letzter Admin / Platzhalter / Mitglied ⇒ bestehende Meldungen', async () => {
  await as(U.A);
  const mA = (await q(`select my_member_id($1) id`, [X.id]))[0].id;
  ok(/mindestens einen Admin/.test(await err(`select * from set_member_role($1, 'member')`, [mA]) || ''), 'letzter Admin');
  await as(SA);
  ok(/mindestens einen Admin/.test(await err(`select * from set_member_role($1, 'member')`, [mA]) || ''), 'letzter Admin (Superadmin)');
  ok(/Spieler ohne Konto haben keine Rolle/.test(await err(`select * from set_member_role($1, 'admin')`, [tim.id]) || ''), 'Platzhalter (Superadmin)');
  await as(U.A);
  ok(/Spieler ohne Konto haben keine Rolle/.test(await err(`select * from set_member_role($1, 'member')`, [tim.id]) || ''), 'Platzhalter (Admin)');
  await as(U.C);
  ok(/Nur Admins dürfen Rollen ändern/.test(await err(`select * from set_member_role($1, 'member')`, [mB]) || ''), 'Mitglied herabstufen');
  ok(/Nur Admins dürfen Rollen ändern/.test(await err(`select * from set_member_role($1, 'admin')`, [mC]) || ''), 'Mitglied befördert sich');
  await as(U.D);
  ok(/Nur Admins dürfen Rollen ändern/.test(await err(`select * from set_member_role($1, 'admin')`, [mC]) || ''), 'Fremder');
  ok(await role(mC) === 'member' && await role(mB) === 'member');
});
check('K3 Erbfolge: letzter Admin (kein Superadmin) löscht sein Konto ⇒ ältestes Konto-Mitglied ist admin', async () => {
  const [E1, E2, E3] = [uid(301), uid(302), uid(303)];
  for (const id of [E1, E2, E3]) await seedUser(id, { email: `${id.slice(-3)}@example.test` });
  const Z = await mkGroup(E1, 'Z');
  await as(E2); const [{ id: m2 }] = await q(`select * from join_playgroup($1)`, [Z.invite_code]);
  await as(E3); const [{ id: m3 }] = await q(`select * from join_playgroup($1)`, [Z.invite_code]);
  await su(); await q(`update members set created_at = created_at + interval '1 minute' where id = $1`, [m3]);
  await as(E1);
  ok(await err(`select delete_my_account()`) === null);
  ok(await role(m2) === 'admin' && await role(m3) === 'member');
});
check('Negativraum: Superadmin stuft sich selbst herab ⇒ bleibt Superadmin, befördert sich wieder', async () => {
  await su();
  const sgCode = (await q(`select code from playgroup_invites where playgroup_id = $1`, [SG.id]))[0].code;
  await as(U.A);
  const [{ id: mAS }] = await q(`select * from join_playgroup($1)`, [sgCode]);
  ok(!!mAS);
  await as(SA);
  await q(`select * from set_member_role($1, 'admin')`, [mAS]);
  const mS = (await q(`select my_member_id($1) id`, [SG.id]))[0].id;
  ok((await q(`select * from set_member_role($1, 'member')`, [mS]))[0].role === 'member');
  ok((await q(`select is_superadmin() x`))[0].x === true);
  ok((await q(`select * from set_member_role($1, 'admin')`, [mS]))[0].role === 'admin');
  // von A herabgestuft ⇒ ebenso
  await as(U.A);
  ok((await q(`select * from set_member_role($1, 'member')`, [mS]))[0].role === 'member');
  await as(SA);
  ok((await q(`select is_superadmin() x`))[0].x === true);
  ok((await q(`select * from set_member_role($1, 'admin')`, [mS]))[0].role === 'admin');
});
check('Negativraum: zwei Superadmins (Flag per SQL) ⇒ beide legen Gruppen an', async () => {
  await su();
  await q(`update profiles set is_superadmin = true where id = $1`, [U.D]);
  await as(U.D);
  const [g1] = await q(`select * from create_playgroup('D-Gruppe')`);
  await as(SA);
  const [g2] = await q(`select * from create_playgroup('S-Gruppe 2')`);
  ok(g1?.id && g2?.id);
  await su();
  await q(`update profiles set is_superadmin = false where id = $1`, [U.D]);
  await q(`delete from playgroups where id = any($1)`, [[g1.id, g2.id]]);
});

// ---------------------------------------------------------------- Krit. 4: Superadmin-Konto nicht löschbar
const allCounts = async () => { await su(); return (await q(`select (select count(*) from auth.users)::int u, (select count(*) from profiles)::int p,
  (select count(*) from members)::int m, (select count(*) from playgroups)::int g, (select count(*) from decks)::int d`))[0]; };
check('K4 check_delete_my_account() und delete_my_account() als Superadmin ⇒ superadmin_cannot_delete, nichts geändert', async () => {
  await as(SA);
  await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'S1', 'S1')`, [SA]);
  const c0 = await allCounts();
  await as(SA);
  ok(/superadmin_cannot_delete/.test(await err(`select check_delete_my_account()`) || ''), 'Probelauf');
  ok(/superadmin_cannot_delete/.test(await err(`select delete_my_account()`) || ''), 'Löschen');
  eq(await allCounts(), c0);
  // Löschen im Dashboard (auth.users direkt)
  ok(/superadmin_cannot_delete/.test(await err(`delete from auth.users where id = $1`, [SA]) || ''), 'Dashboard');
  eq(await allCounts(), c0);
});
