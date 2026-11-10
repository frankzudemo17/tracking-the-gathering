// DB-Harness: Migrationen gegen PGlite (Postgres 17, in-memory, kein Netz) mit Supabase-Attrappe.
// Übernommen aus test-entwurf/dbtest.mjs (Welle ttg-spielen). Nutzung in einer Testdatei:
//   const db = await freshDb();               // eine Instanz je Datei, nicht je Fall
//   const { as, su, q, err } = tools(db);
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

/** Supabase-Attrappe: Rollen, auth.uid()/auth.jwt(), storage, Publication, Default-Grants. */
export const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage; create schema extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean not null default false, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create publication supabase_realtime;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

/** Feste Test-Konten (A, B, C, D, G = Gast/anonym). */
export const U = {
  A: 'aaaaaaaa-0000-4000-8000-000000000001', B: 'bbbbbbbb-0000-4000-8000-000000000002', C: 'cccccccc-0000-4000-8000-000000000003',
  D: 'dddddddd-0000-4000-8000-000000000004', G: 'eeeeeeee-0000-4000-8000-000000000005',
};

/**
 * Frische PGlite-Instanz mit Attrappe und allen Migrationen (sortiert nach Dateiname).
 * Eine fehlerhafte Migration wirft (⇒ Testdatei rot), statt still weiterzulaufen.
 * `until`: nur Migrationen, deren Dateiname VOR dieser Datei liegt (Bestandsprobe:
 * Daten auf dem alten Stand anlegen, dann die Migration selbst ausführen).
 * Standard ohne `until` = alle Migrationen, also prod-gleich (Registrierungs-Tor aktiv).
 */
export async function freshDb({ migrations = MIGRATIONS, until } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  const files = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql') && (!until || f < until)).sort();
  if (files.length === 0) throw new Error(`Keine Migrationen in ${migrations}`);
  for (const f of files) {
    try { await db.exec(fs.readFileSync(path.join(migrations, f), 'utf8')); }
    catch (e) { throw new Error(`Migration ${f} fehlgeschlagen: ${e.message}`); }
  }
  return db;
}

/**
 * Hilfen: as(uid, {anonymous, role}) wechselt Rolle + JWT-Claims, su() = Superuser, q = Zeilen, err = Fehlertext|null.
 * seedUser(id, {email, meta, anonymous, confirmed}) legt ein BESTANDSKONTO in auth.users an:
 *   das Registrierungs-Tor (Trigger ttg_signup_gate, 20261116000000_zugang.sql) ist ausdrücklich
 *   NUR für genau diesen einen Insert abgeschaltet (in einer Transaktion; schlägt der Insert fehl,
 *   rollt auch das Abschalten zurück). handle_new_user läuft normal. Registrierungen, die das Tor
 *   prüfen sollen, fügen direkt in auth.users ein (wie GoTrue), nie über seedUser.
 * mkGroup(owner, name) legt die Gruppe über create_playgroup an; der Besitzer ist NUR für diesen
 *   Aufruf Superadmin (Flag danach wieder wie vorher). Liefert die Zeile plus invite_code
 *   (aus playgroup_invites; auf einem Stand vor der Migration aus playgroups.invite_code).
 * Beide Helfer stellen Rolle und JWT-Claims danach so her, wie sie vorher waren.
 */
export function tools(db) {
  async function as(uid, { anonymous = false, role = 'authenticated' } = {}) {
    await db.exec(`reset role;`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
      [uid || '', JSON.stringify(uid ? { sub: uid, is_anonymous: anonymous, role } : { role: 'anon' })]);
    await db.exec(`set role ${uid ? role : 'anon'};`);
  }
  async function su() { await db.exec('reset role;'); }
  async function q(sql, params) { return (await db.query(sql, params)).rows; }
  async function err(sql, params) { try { await db.query(sql, params); return null; } catch (e) { return e.message; } }

  // Sitzungszustand (Rolle + Claims) sichern und wiederherstellen
  async function save() {
    return (await db.query(`select current_user::text r, current_setting('request.jwt.claim.sub', true) s,
                                   current_setting('request.jwt.claims', true) c`)).rows[0];
  }
  async function restore(st) {
    await db.exec('reset role;');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [st.s ?? '', st.c ?? '']);
    if (st.r !== 'postgres') await db.exec(`set role ${st.r};`);
  }
  async function has(sql) { return (await db.query(sql)).rows[0].x; }

  async function seedUser(id, { email = null, meta = {}, anonymous = false, confirmed = true } = {}) {
    const st = await save();
    await db.exec('reset role;');
    // nur ein AKTIVES Tor ab- und danach wieder anschalten (ein vorher abgeschaltetes bleibt aus)
    const gate = await has(`select exists (select 1 from pg_trigger where tgname = 'ttg_signup_gate' and tgrelid = 'auth.users'::regclass
                              and tgenabled <> 'D') x`);
    await db.exec('begin;');
    try {
      if (gate) await db.exec('alter table auth.users disable trigger ttg_signup_gate;');
      await db.query(`insert into auth.users (id, email, raw_user_meta_data, is_anonymous, email_confirmed_at)
                      values ($1, $2, $3::jsonb, $4, case when $5 then now() end)`, [id, email, JSON.stringify(meta), anonymous, confirmed]);
      if (gate) await db.exec('alter table auth.users enable trigger ttg_signup_gate;');
      await db.exec('commit;');
    } catch (e) {
      await db.exec('rollback;');
      throw e;
    } finally {
      await restore(st);
    }
  }

  async function mkGroup(owner, name) {
    const st = await save();
    await db.exec('reset role;');
    const flag = await has(`select exists (select 1 from information_schema.columns
                              where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_superadmin') x`);
    let prev = false, g;
    try {
      if (flag) {
        prev = (await db.query(`select is_superadmin x from profiles where id = $1`, [owner])).rows[0]?.x ?? false;
        await db.query(`update profiles set is_superadmin = true where id = $1`, [owner]);
      }
      await as(owner);
      [g] = (await db.query(`select * from create_playgroup($1)`, [name])).rows;
    } finally {
      await db.exec('reset role;');
      if (flag) await db.query(`update profiles set is_superadmin = $2 where id = $1`, [owner, prev]);
      if (!g) await restore(st);
    }
    const inv = await has(`select to_regclass('public.playgroup_invites') is not null x`);
    const invite_code = inv ? (await db.query(`select code from playgroup_invites where playgroup_id = $1`, [g.id])).rows[0]?.code : g.invite_code;
    await restore(st);
    return { ...g, invite_code };
  }
  return { as, su, q, err, seedUser, mkGroup };
}
