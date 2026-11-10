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

const EXPECTED = 39;
let db, as, su, q, err, seedUser, mkGroup;
let ran = 0;
const check = (name, fn) => test(name, async () => { ran++; await fn(); });
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
after(async () => {
  await db?.close();
  // Schutz: bricht das Szenario still ab, darf die Zahl nicht schrumpfen und trotzdem grün sein.
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

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

// ---------------------------------------------------------------- Krit. 5: Einladungscode lesen / schreiben / erneuern
const invRows = async (gid) => (await q(`select playgroup_id, code from playgroup_invites where playgroup_id = $1`, [gid])).length;
check('K5 Lesen: Admin 1 · Superadmin (nicht Mitglied) 1 · Mitglied 0 · andere Gruppe 0 · anon 42501', async () => {
  await as(U.A); ok(await invRows(X.id) === 1, 'Admin');
  await as(SA); ok(await invRows(X.id) === 1, 'Superadmin');
  await as(U.C); ok(await invRows(X.id) === 0, 'Mitglied');
  ok(await n(`select count(*)::int n from playgroup_invites`) === 0, 'Mitglied sieht gar keine Zeile, kein Fehler');
  await as(U.D); ok(await invRows(X.id) === 0, 'Konto ohne Gruppe');
  await as(U.G, { anonymous: true }); ok(await invRows(X.id) === 0, 'anonymes Konto');
  await as(null);
  eq(await code(`select * from playgroup_invites`), '42501');
});
check('K5 Schreiben direkt (insert/update/delete) für jede Client-Rolle abgelehnt', async () => {
  for (const who of [U.A, SA, U.C, null]) {
    await as(who);
    eq(await code(`insert into playgroup_invites (playgroup_id, code) values ($1, 'TTG-AAAAAA')`, [SG.id]), '42501', `insert ${who}`);
    eq(await code(`update playgroup_invites set code = 'TTG-AAAAAA' where playgroup_id = $1`, [X.id]), '42501', `update ${who}`);
    eq(await code(`delete from playgroup_invites where playgroup_id = $1`, [X.id]), '42501', `delete ${who}`);
  }
  await su();
  ok((await q(`select code from playgroup_invites where playgroup_id = $1`, [X.id]))[0].code === X.invite_code, 'Code unverändert');
});
let oldX;
check('K5 renew_invite: Admin ⇒ neuer Code, alter ungültig (join ⇒ null); Mitglied/Fremder ⇒ not_group_admin; Superadmin ohne Mitgliedschaft ⇒ geht', async () => {
  oldX = X.invite_code;
  await as(U.C);
  ok(/not_group_admin/.test(await err(`select renew_invite($1)`, [X.id]) || ''), 'Mitglied');
  await as(U.D);
  ok(/not_group_admin/.test(await err(`select renew_invite($1)`, [X.id]) || ''), 'Fremder');
  await as(U.A);
  const [{ c }] = await q(`select renew_invite($1) c`, [X.id]);
  ok(CODE_RE.test(c) && c !== oldX, c);
  await su();
  const [r] = await q(`select code, renewed_by, renewed_at is not null t from playgroup_invites where playgroup_id = $1`, [X.id]);
  eq(r, { code: c, renewed_by: U.A, t: true });
  await as(U.D);
  ok((await q(`select * from join_playgroup($1)`, [oldX]))[0]?.id == null, 'alter Code ⇒ null');
  await as(SA);
  const [{ c: c2 }] = await q(`select renew_invite($1) c`, [X.id]);
  ok(CODE_RE.test(c2) && c2 !== c);
  X.invite_code = c2;
  await as(null);
  eq(await code(`select renew_invite($1)`, [X.id]), '42501');
});

// ---------------------------------------------------------------- Krit. 6: Beitritt bestehender Konten
check('K6 join_playgroup: klein + Leerzeichen ⇒ Mitglied; zweimal ⇒ dieselbe Mitgliedschaft; falsch ⇒ null + 1 code_attempts; 11. ⇒ Drossel', async () => {
  const K = uid(401);
  await seedUser(K, { email: 'k@example.test' });
  await as(K);
  const [m1] = await q(`select * from join_playgroup($1)`, [' ' + X.invite_code.toLowerCase() + ' ']);
  ok(m1?.id && m1.role === 'member' && m1.playgroup_id === X.id);
  const [m2] = await q(`select * from join_playgroup($1)`, [X.invite_code]);
  ok(m2.id === m1.id);
  ok((await q(`select * from join_playgroup('TTG-ZZZZZZ')`))[0]?.id == null);
  await su(); ok(await n(`select count(*)::int n from code_attempts where user_id = $1`, [K]) === 1);
  await as(K);
  for (let i = 0; i < 9; i++) await q(`select * from join_playgroup('TTG-ZZZZZZ')`);
  ok(/Zu viele Versuche/.test(await err(`select * from join_playgroup($1)`, [X.invite_code]) || ''));
});

// ---------------------------------------------------------------- Negativraum: kein anderer Weg zum Code
check('Negativraum: Mitglied bekommt den Code auf keinem Weg (join/create-Rückgabe, members, playgroups); select * auf playgroups ohne Fehler', async () => {
  await as(U.C);
  const [pg] = await q(`select * from playgroups where id = $1`, [X.id]);
  ok(pg && !('invite_code' in pg), JSON.stringify(pg));
  const txt = JSON.stringify([await q(`select * from playgroups`), await q(`select * from members`),
    await q(`select * from join_playgroup($1)`, [X.invite_code])]);
  ok(!txt.includes(X.invite_code.slice(4)), 'Code taucht nirgends auf');
  await as(SA);
  const [g] = await q(`select * from create_playgroup('Leck')`);
  ok(!('invite_code' in g), 'Rückgabe create_playgroup ohne Code');
  await su();
  ok(await n(`select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'playgroups' and column_name = 'invite_code'`) === 0);
  await q(`delete from playgroups where id = $1`, [g.id]);
});
check('Negativraum: delete_playgroup ⇒ playgroup_invites-Zeile fällt per Kaskade', async () => {
  await as(SA);
  const [g] = await q(`select * from create_playgroup('Weg')`);
  await su(); ok(await invRows(g.id) === 1);
  await as(SA);
  ok(await err(`select delete_playgroup($1, 'Weg')`, [g.id]) === null);
  await su(); ok(await invRows(g.id) === 0);
});

// ---------------------------------------------------------------- Bestandsprobe (Krit. 1, 5, 12)
// Zeilenzahl je public-Tabelle als Text „tabelle=n,…“
const PUBLIC_COUNTS = `select string_agg(t || '=' || (xpath('/row/c/text()', query_to_xml('select count(*) c from public.' || quote_ident(t), false, true, '')))[1]::text, ',' order by t) s
  from (select tablename t from pg_tables where schemaname = 'public') x`;
const countMap = (s) => Object.fromEntries(s.split(',').map((x) => x.split('=')));
let bestand;
after(async () => { await bestand?.db.close(); });
check('Bestand: Migration auf alten Stand (2 Gruppen, 25 Konten, 1 anonyme Zeile, Spiel) ⇒ Flag nur für die Profil-ID, Codes umgezogen, nichts gelöscht', async () => {
  const b = await freshDb({ until: FILE });
  bestand = { db: b, ...tools(b) };
  const { q: bq, as: bas, su: bsu, seedUser: bseed, mkGroup: bmk } = bestand;
  await bseed(SA, { email: 's@example.test' });
  for (let i = 1; i <= 24; i++) await bseed(uid(500 + i), { email: `u${i}@example.test`, confirmed: i > 3 });
  await bseed(uid(599), { anonymous: true });
  const G1 = await bmk(uid(501), 'Eins');
  const G2 = await bmk(uid(502), 'Zwei');
  for (let i = 3; i <= 12; i++) { await bas(uid(500 + i)); await bq(`select * from join_playgroup($1)`, [i % 2 ? G1.invite_code : G2.invite_code]); }
  await bsu();
  await bq(`insert into games (playgroup_id, created_by) values ($1, $2)`, [G1.id, uid(501)]);
  const before0 = countMap((await bq(PUBLIC_COUNTS))[0].s);
  ok(before0.games === '1' && before0.playgroups === '2' && before0.members === '12' && before0.profiles === '26', JSON.stringify(before0));
  const users0 = (await bq(`select count(*)::int n from auth.users`))[0].n;
  ok(users0 === 26);
  const codes0 = await bq(`select id, invite_code from playgroups order by id`);
  await b.exec(fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8'));
  // Flag
  eq(await bq(`select id from profiles where is_superadmin`), [{ id: SA }]);
  ok((await bq(`select count(*)::int n from profiles where not is_superadmin`))[0].n === 25);
  // Codes 1:1, Spalte weg
  eq(await bq(`select playgroup_id id, code invite_code from playgroup_invites order by playgroup_id`), codes0);
  ok((await bq(`select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'playgroups' and column_name = 'invite_code'`))[0].n === 0);
  // nichts gelöscht: Zeilenzahlen aller vorher vorhandenen public-Tabellen und auth.users gleich
  const after0 = countMap((await bq(PUBLIC_COUNTS))[0].s);
  for (const k of Object.keys(before0)) eq(after0[k], before0[k], k);
  ok((await bq(`select count(*)::int n from auth.users`))[0].n === users0);
  // bestehende Links bleiben gültig
  await bas(uid(520));
  ok((await bq(`select * from join_playgroup($1)`, [G2.invite_code]))[0]?.playgroup_id === G2.id, 'alter Link gilt weiter');
  bestand.G1 = G1;
});

// ---------------------------------------------------------------- Registrierung wie GoTrue (direkter Insert, nie seedUser)
/** Fehlertext oder null. confirmed: email_confirmed_at beim Insert gesetzt (Autoconfirm). */
async function regOn(t, id, meta, { anonymous = false, confirmed = false, email } = {}) {
  await t.su();
  return t.err(`insert into auth.users (id, email, raw_user_meta_data, is_anonymous, email_confirmed_at)
                values ($1, $2, $3::jsonb, $4, case when $5 then now() end)`,
  [id, anonymous ? null : (email ?? `${id.slice(-4)}@example.test`), meta === undefined ? null : JSON.stringify(meta), anonymous, confirmed]);
}
const reg = (id, meta, o) => regOn({ su, err }, id, meta, o);
const rows3 = async () => { await su(); return (await q(`select (select count(*) from auth.users)::int u, (select count(*) from profiles)::int p, (select count(*) from members)::int m`))[0]; };

// ---------------------------------------------------------------- Krit. 7: Tor
let delCode;
check('K7 Tor lehnt ab: ohne Code / leer / OTP ohne Metadaten ⇒ signup_code_required; Tippfehler, gelöschte Gruppe, erneuerter alter Code, JSON-Objekt, 10 000 Zeichen ⇒ signup_code_invalid; je 0 neue Zeilen', async () => {
  await as(SA);
  const [del] = await q(`select * from create_playgroup('Del')`);
  await su(); delCode = (await q(`select code from playgroup_invites where playgroup_id = $1`, [del.id]))[0].code;
  await as(SA); await q(`select delete_playgroup($1, 'Del')`, [del.id]);
  const c0 = await rows3();
  const cases = [
    [{}, /signup_code_required/, 'ohne Code'],
    [undefined, /signup_code_required/, 'OTP: raw_user_meta_data null'],
    [{ invite_code: '   ' }, /signup_code_required/, 'nur Leerzeichen'],
    [{ invite_code: 'TTG-ZZZZZZ' }, /signup_code_invalid/, 'Tippfehler'],
    [{ invite_code: delCode }, /signup_code_invalid/, 'gelöschte Gruppe'],
    [{ invite_code: oldX }, /signup_code_invalid/, 'erneuerter alter Code'],
    [{ invite_code: { code: X.invite_code } }, /signup_code_invalid/, 'JSON-Objekt'],
    [{ invite_code: 'A'.repeat(10000) }, /signup_code_invalid/, '10 000 Zeichen'],
  ];
  let i = 0;
  for (const [meta, re, info] of cases) {
    const e = await reg(uid(700 + i++), meta);
    ok(e && re.test(e), `${info}: ${e}`);
  }
  eq(await rows3(), c0);
});
check('K7 gültiger Code (klein, mit Leerzeichen) ⇒ 1 Konto, 1 Profil, genau 1 Mitgliedschaft (member, richtige Gruppe, Name aus display_name)', async () => {
  const c0 = await rows3();
  const N = uid(720);
  ok(await reg(N, { invite_code: `  ${X.invite_code.toLowerCase()} `, display_name: 'Neue' }) === null);
  const c1 = await rows3();
  eq(c1, { u: c0.u + 1, p: c0.p + 1, m: c0.m + 1 });
  eq(await q(`select playgroup_id, role::text, display_name from members where profile_id = $1`, [N]),
    [{ playgroup_id: X.id, role: 'member', display_name: 'Neue' }]);
  ok((await q(`select display_name from profiles where id = $1`, [N]))[0].display_name === 'Neue');
  // neues Konto arbeitet normal und sieht die Gruppe, aber nicht den Code
  await as(N);
  ok(await n(`select count(*)::int n from playgroups where id = $1`, [X.id]) === 1);
  ok(await n(`select count(*)::int n from playgroup_invites`) === 0);
});
check('K1 Registrierung mit Metadaten {"is_superadmin":true,"role":"admin"} ⇒ Flag false, Rolle member', async () => {
  const N = uid(721);
  ok(await reg(N, { invite_code: X.invite_code, is_superadmin: true, role: 'admin' }) === null);
  ok((await q(`select is_superadmin x from profiles where id = $1`, [N]))[0].x === false);
  eq(await q(`select role::text from members where profile_id = $1`, [N]), [{ role: 'member' }]);
});

// ---------------------------------------------------------------- Krit. 8: anonym
check('K8 is_anonymous = true (auch mit gültigem Code) ⇒ signup_anonymous_disabled, 0 Zeilen', async () => {
  const c0 = await rows3();
  for (const [i, meta] of [[730, { invite_code: X.invite_code }], [731, {}], [732, undefined]]) {
    const e = await reg(uid(i), meta, { anonymous: true });
    ok(e && /signup_anonymous_disabled/.test(e), e);
  }
  eq(await rows3(), c0);
});

// ---------------------------------------------------------------- Negativraum Tor/Beitritt
check('Negativraum: Metadaten nachträglich ändern (invite_code) ⇒ keine Wirkung', async () => {
  await su();
  const sgCode = (await q(`select code from playgroup_invites where playgroup_id = $1`, [SG.id]))[0].code;
  const m0 = await n(`select count(*)::int n from members where profile_id = $1`, [U.D]);
  await q(`update auth.users set raw_user_meta_data = $2::jsonb where id = $1`, [U.D, JSON.stringify({ invite_code: sgCode })]);
  ok(await n(`select count(*)::int n from members where profile_id = $1`, [U.D]) === m0);
  await as(U.D);
  eq(await code(`update profiles set invite_code = 'x' where id = $1`, [U.D]), '42703');
});
check('Negativraum: Gruppe zwischen Tor und Beitritt gelöscht ⇒ Konto ohne Gruppe, kein Fehler, kein verwaister Verweis', async () => {
  await as(SA);
  const [t] = await q(`select * from create_playgroup('Kurz')`);
  await su();
  const c = (await q(`select code from playgroup_invites where playgroup_id = $1`, [t.id]))[0].code;
  // läuft nach ttg_signup_gate (Trigger feuern in Namensreihenfolge), vor handle_new_user (after insert)
  await db.exec(`create function public.zz_drop_group() returns trigger language plpgsql as $$
    begin delete from public.playgroups where id = '${t.id}'; return new; end $$;
    create trigger zz_drop_group before insert on auth.users for each row execute function public.zz_drop_group();`);
  const N = uid(740);
  try {
    ok(await reg(N, { invite_code: c }) === null);
  } finally {
    await db.exec(`drop trigger zz_drop_group on auth.users; drop function public.zz_drop_group();`);
  }
  ok(await n(`select count(*)::int n from profiles where id = $1`, [N]) === 1);
  ok(await n(`select count(*)::int n from members where profile_id = $1`, [N]) === 0);
  ok(await n(`select count(*)::int n from playgroup_invites where playgroup_id = $1`, [t.id]) === 0);
});
check('K5 check_invite: erneuerter alter Code ⇒ invalid', async () => {
  await as(null);
  eq((await q(`select check_invite($1) r`, [oldX]))[0].r, { status: 'invalid' });
});

// ---------------------------------------------------------------- Krit. 9–11: Deckel, eigene Datenbank
let cap;
after(async () => { await cap?.db.close(); });
const CU = (i) => `cccc0000-0000-4000-8000-${String(i).padStart(12, '0')}`;
check('K9 Deckel: Standard 20; Bestand 19 (3 unbestätigt) + 2 anonym ⇒ Nr. 20 gelingt, Nr. 21 ⇒ signup_full', async () => {
  const c = await open();
  cap = { db: c, ...tools(c) };
  await cap.seedUser(SA, { email: 's@example.test' });
  for (let i = 1; i <= 18; i++) await cap.seedUser(CU(i), { email: `c${i}@example.test`, confirmed: i > 3 });
  for (let i = 91; i <= 92; i++) await cap.seedUser(CU(i), { anonymous: true, confirmed: false });
  await cap.su();
  await cap.q(`update profiles set is_superadmin = true where id = $1`, [SA]);
  cap.X = await cap.mkGroup(SA, 'X');
  eq(await cap.q(`select max_accounts from app_settings`), [{ max_accounts: 20 }]);
  eq(await cap.q(`select (count(*) filter (where not is_anonymous))::int a, (count(*) filter (where not is_anonymous and email_confirmed_at is null))::int u,
                         (count(*) filter (where is_anonymous))::int z from auth.users`), [{ a: 19, u: 3, z: 2 }]);
  ok(await regOn(cap, CU(20), { invite_code: cap.X.invite_code }, { confirmed: true }) === null, 'Nr. 20');
  const e = await regOn(cap, CU(21), { invite_code: cap.X.invite_code }, { confirmed: true });
  ok(e && /signup_full/.test(e), e);
  ok((await cap.q(`select count(*)::int n from auth.users where id = $1`, [CU(21)]))[0].n === 0);
});
check('K9 set_max_accounts: 21 ⇒ Nr. 21 gelingt; 5 bei Bestand 21 ⇒ erlaubt, niemand entfernt, nächste ⇒ signup_full; Bereich/Rechte', async () => {
  await cap.as(SA);
  eq(await cap.q(`select set_max_accounts(21) r`), [{ r: 21 }]);
  ok(await regOn(cap, CU(21), { invite_code: cap.X.invite_code }, { confirmed: true }) === null, 'Nr. 21');
  await cap.as(SA);
  eq(await cap.q(`select set_max_accounts(5) r`), [{ r: 5 }]);
  await cap.su();
  ok((await cap.q(`select count(*)::int n from auth.users where not is_anonymous`))[0].n === 21, 'niemand entfernt');
  const e = await regOn(cap, CU(22), { invite_code: cap.X.invite_code }, { confirmed: true });
  ok(e && /signup_full/.test(e), e);
  await cap.as(SA);
  for (const v of ['0', '-1', '1001', 'null']) ok(/max_accounts_range/.test(await cap.err(`select set_max_accounts(${v}::int)`) || ''), v);
  ok(/permission denied/.test(await cap.err(`select updated_by from app_settings`) || ''), 'app_settings für den Superadmin nicht direkt lesbar');
  await cap.as(CU(5));
  ok(/superadmin_only/.test(await cap.err(`select set_max_accounts(30)`) || ''), 'Nicht-Superadmin');
  await cap.su();
  eq(await cap.q(`select max_accounts, updated_by from app_settings`), [{ max_accounts: 5, updated_by: SA }]);
});
check('K9 access_overview ⇒ exakt {"accounts":21,"unconfirmed":3,"max_accounts":5}; Nicht-Superadmin ⇒ superadmin_only; app_settings direkt ⇒ 42501', async () => {
  await cap.as(SA);
  eq((await cap.q(`select access_overview() r`))[0].r, { accounts: 21, unconfirmed: 3, max_accounts: 5 });
  await cap.as(CU(5));
  ok(/superadmin_only/.test(await cap.err(`select access_overview()`) || ''));
  const sqlstate = async (sql) => { try { await cap.db.query(sql); return null; } catch (x) { return x.code; } };
  for (const [who, o] of [[SA, {}], [CU(5), {}], [CU(91), { anonymous: true }], [null, {}]]) {
    await cap.as(who, o);
    for (const sql of [`select * from app_settings`, `update app_settings set max_accounts = 999`, `insert into app_settings (id) values (true)`, `delete from app_settings`]) {
      eq(await sqlstate(sql), '42501', `${who}: ${sql}`);
    }
  }
  await cap.as(null);
  ok(/permission denied/.test(await cap.err(`select access_overview()`) || ''), 'anon');
  ok(/permission denied/.test(await cap.err(`select set_max_accounts(30)`) || ''), 'anon');
});
check('K11 check_invite (anon): voll ⇒ {"status":"full"} ohne Namen; ungültig bei vollem Deckel ⇒ invalid', async () => {
  await cap.as(null);
  eq((await cap.q(`select check_invite($1) r`, [cap.X.invite_code]))[0].r, { status: 'full' });
  eq((await cap.q(`select check_invite('TTG-ZZZZZZ') r`))[0].r, { status: 'invalid' });
});
check('K10a letzter Platz: Bestand = Deckel − 1, zwei Registrierungen ⇒ genau eine gelingt', async () => {
  await cap.as(SA);
  await cap.q(`select set_max_accounts(22)`);
  const r = [await regOn(cap, CU(30), { invite_code: cap.X.invite_code }, { confirmed: true }),
    await regOn(cap, CU(31), { invite_code: cap.X.invite_code }, { confirmed: true })];
  ok(r[0] === null && /signup_full/.test(r[1] || ''), JSON.stringify(r));
  await cap.su();
  ok((await cap.q(`select count(*)::int n from auth.users where id in ($1, $2)`, [CU(30), CU(31)]))[0].n === 1);
});
check('K11 check_invite (anon und authenticated): gültig ⇒ {"status":"ok","group_name":"X"}; Tippfehler/leer/null ⇒ {"status":"invalid"}', async () => {
  await cap.as(SA);
  await cap.q(`select set_max_accounts(30)`);
  for (const [who, o] of [[null, {}], [CU(5), {}]]) {
    await cap.as(who, o);
    eq((await cap.q(`select check_invite($1) r`, [` ${cap.X.invite_code.toLowerCase()} `]))[0].r, { status: 'ok', group_name: 'X' });
    for (const bad of ['TTG-ZZZZZZ', '', null]) eq((await cap.q(`select check_invite($1) r`, [bad]))[0].r, { status: 'invalid' }, String(bad));
  }
});
check('K10b signup_gate: pg_advisory_xact_lock steht nach der Code-Prüfung und vor der Zählung', async () => {
  await cap.su();
  const def = (await cap.q(`select pg_get_functiondef('public.signup_gate'::regproc) d`))[0].d;
  const at = (s) => def.indexOf(s);
  ok(def.split('pg_advisory_xact_lock').length === 2, 'genau eine Sperre');
  ok(at('signup_code_required') > 0 && at('signup_code_required') < at('signup_code_invalid'), 'Reihenfolge der Code-Prüfung');
  ok(at('signup_code_invalid') < at('pg_advisory_xact_lock'), 'Sperre nach der Code-Prüfung');
  ok(at('pg_advisory_xact_lock') < at('from auth.users'), 'Sperre vor der Zählung');
  ok(at('from auth.users') < at('signup_full'), 'Zählung vor signup_full');
  ok(at('signup_anonymous_disabled') < at('signup_code_required'), 'anonym zuerst');
  ok((await cap.q(`select provolatile v from pg_proc where oid = 'public.signup_gate'::regproc`))[0].v === 'v', 'volatile: jede Abfrage nimmt einen neuen Snapshot');
  ok((await cap.q(`select count(*)::int n from pg_trigger where tgname = 'ttg_signup_gate' and tgrelid = 'auth.users'::regclass
                   and tgtype & 2 = 2 and tgtype & 4 = 4`))[0].n === 1, 'before insert');
});

// ---------------------------------------------------------------- Krit. 12: Bestand über dem Deckel
check('K12 Bestand über dem Deckel (25 Konten): Bestandskonto arbeitet normal, neue Registrierung ⇒ signup_full', async () => {
  const { q: bq, as: bas } = bestand;
  await bas(uid(501));
  const [ph] = await bq(`select * from create_placeholder($1, 'Pia')`, [bestand.G1.id]);
  ok(ph?.id, 'RPC als Bestandskonto');
  const e = await regOn(bestand, uid(598), { invite_code: bestand.G1.invite_code }, { confirmed: true });
  ok(e && /signup_full/.test(e), e);
  await bas(null);
  eq((await bq(`select check_invite($1) r`, [bestand.G1.invite_code]))[0].r, { status: 'full' });
});

// ---------------------------------------------------------------- Negativraum: Konten mit Verweisen löschen sich
check('Negativraum: Konto, das einen Link erneuert bzw. den Deckel gesetzt hat, löscht sich ⇒ delete_my_account läuft durch', async () => {
  await as(U.A);
  await q(`select renew_invite($1)`, [X.id]);
  ok(await err(`select delete_my_account()`) === null, 'A');
  await su();
  ok((await q(`select renewed_by from playgroup_invites where playgroup_id = $1`, [X.id]))[0].renewed_by === null);
  await q(`update profiles set is_superadmin = true where id = $1`, [U.D]);
  await as(U.D);
  await q(`select set_max_accounts(20)`);
  await su();
  ok((await q(`select updated_by from app_settings`))[0].updated_by === U.D);
  await q(`update profiles set is_superadmin = false where id = $1`, [U.D]);
  await as(U.D);
  ok(await err(`select delete_my_account()`) === null, 'D');
  await su();
  eq(await q(`select max_accounts, updated_by from app_settings`), [{ max_accounts: 20, updated_by: null }]);
});

// ---------------------------------------------------------------- Krit. 13: Ausführungsrechte
check('K13 has_function_privilege je Funktion und Rolle', async () => {
  await su();
  const want = {
    'check_invite(text)': [true, true],
    'is_superadmin()': [false, true], 'renew_invite(uuid)': [false, true], 'set_max_accounts(integer)': [false, true],
    'access_overview()': [false, true], 'create_playgroup(text)': [false, true],
    'set_member_role(uuid,member_role)': [false, true], 'join_playgroup(text)': [false, true],
    'signup_gate()': [false, false], 'handle_new_user()': [false, false],
    'superadmin_delete_guard()': [false, false], 'playgroup_invite_create()': [false, false],
  };
  const got = {};
  for (const sig of Object.keys(want)) {
    const [r] = await q(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u`,
      ['public.' + sig.replace(',member_role)', ',public.member_role)')]);
    got[sig] = [r.a, r.u];
  }
  eq(got, want);
  // Trigger-Funktionen der Migration vollständig erfasst
  eq((await q(`select p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
               where not t.tgisinternal and t.tgname in ('ttg_signup_gate', 'ttg_superadmin_no_delete', 'ttg_playgroup_invite') order by 1`)).map((r) => r.proname),
  ['playgroup_invite_create', 'signup_gate', 'superadmin_delete_guard']);
});

// ---------------------------------------------------------------- Rückwärts-Block (Schema-Gleichheit prüft spielen.test.mjs X2)
check('Rückwärts: Block (Marker, jede Zeile „-- “) läuft auf dem Bestand; Codes wandern zurück, Konten/Gruppen bleiben, Tor weg', async () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
  const m = sql.match(/-- RÜCKWÄRTS-BEGINN\r?\n([\s\S]*?)-- RÜCKWÄRTS-ENDE/);
  ok(m, 'Rückwärts-Block nicht gefunden');
  const lines = m[1].split(/\r?\n/).filter((l) => l !== '');
  ok(lines.every((l) => l.startsWith('-- ')), 'jede Zeile beginnt mit „-- “');
  const { db: b, q: bq, su: bsu } = bestand;
  await bsu();
  const codes = await bq(`select playgroup_id id, code invite_code from playgroup_invites order by playgroup_id`);
  const c0 = await bq(`select (select count(*) from auth.users)::int u, (select count(*) from playgroups)::int g, (select count(*) from members)::int m`);
  await b.exec(lines.map((l) => l.slice(3)).join('\n'));
  eq(await bq(`select id, invite_code from playgroups order by id`), codes);
  eq(await bq(`select (select count(*) from auth.users)::int u, (select count(*) from playgroups)::int g, (select count(*) from members)::int m`), c0);
  eq(await bq(`select to_regclass('public.playgroup_invites') a, to_regclass('public.app_settings') b,
                      (select count(*)::int from pg_trigger where tgname = 'ttg_signup_gate') t`), [{ a: null, b: null, t: 0 }]);
});
