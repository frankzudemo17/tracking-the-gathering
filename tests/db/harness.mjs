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
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
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
 */
export async function freshDb({ migrations = MIGRATIONS } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  const files = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`Keine Migrationen in ${migrations}`);
  for (const f of files) {
    try { await db.exec(fs.readFileSync(path.join(migrations, f), 'utf8')); }
    catch (e) { throw new Error(`Migration ${f} fehlgeschlagen: ${e.message}`); }
  }
  return db;
}

/** Hilfen: as(uid, {anonymous, role}) wechselt Rolle + JWT-Claims, su() = Superuser, q = Zeilen, err = Fehlertext|null. */
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
  return { as, su, q, err };
}
