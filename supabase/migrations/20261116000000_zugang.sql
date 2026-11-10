-- ============================================================================
-- Tracking the Gathering · Zugang (Welle ttg-live-feinschliff-decks, Paket P9, spec-p9-zugang.md)
-- Stand: 16.11.2026
--
-- Ziel: die App ist geschlossen. Neue Konten entstehen nur mit dem Einladungscode einer
-- Gruppe, die Zahl der Konten hat einen Deckel, anonyme Konten gibt es nicht; Gruppen
-- anlegen und Admins ernennen darf nur der Superadmin.
--
-- A. Superadmin: profiles.is_superadmin (default false). Gesetzt nur für das bestehende
--    Konto mit der Profil-ID im update unten (keine E-Mail, kein Name im Repo; fehlt die
--    Zeile, passiert nichts). Vom Client nie setzbar: die Spaltenfreigabe aus
--    20261109000000_sicherheit.sql (update display_name, locale, theme, avatar_path; kein
--    insert) bleibt unverändert; Registrierungs-Metadaten haben keine Wirkung.
--    is_superadmin() für Policies und Funktionen. Das Konto des Superadmins ist nicht
--    löschbar: Trigger before delete on profiles wirft superadmin_cannot_delete — greift
--    für delete_my_account(), dessen Probelauf check_delete_my_account() (also bevor der
--    Client Dateien löscht) und für Löschen im Dashboard (Kaskade aus auth.users).
-- B. create_playgroup: nur Superadmin (superadmin_only). set_member_role: zu admin nur
--    Superadmin (Mitgliedschaft in der Gruppe nicht nötig), zu member Gruppen-Admin oder
--    Superadmin. Letzter-Admin-Schutz bleibt; delete_my_account() befördert den Erben
--    weiterhin direkt (ohne set_member_role).
-- C. Einladungscode in eigener Tabelle playgroup_invites (lesen nur Admin der Gruppe oder
--    Superadmin, Nicht-Admins bekommen 0 Zeilen; schreiben nur über Funktionen). Codes 1:1
--    aus playgroups.invite_code umgezogen (bestehende Links bleiben gültig), danach die
--    Spalte entfernt. Neue Gruppen bekommen ihre Zeile per Trigger. renew_invite(p_group):
--    neuer Code, alter sofort ungültig. join_playgroup liest dort (sonst unverändert).
-- D. Registrierungs-Tor: Trigger ttg_signup_gate before insert on auth.users
--    (Funktion signup_gate). Abgelehnt werden anonyme Konten (signup_anonymous_disabled),
--    fehlender Code in raw_user_meta_data ->> 'invite_code' (signup_code_required),
--    unbekannter Code (signup_code_invalid) und voller Deckel (signup_full). Nur der
--    Gruppen-Einladungscode öffnet die Registrierung, Übernahme-Codes nicht.
--    Umwandlung: ein bestehendes anonymes Konto wird nicht zum festen Konto (GoTrue
--    updateUser({ email }) bzw. linkIdentity setzen is_anonymous true → false, ein update,
--    kein insert): Trigger ttg_anonymous_convert before update of is_anonymous on auth.users
--    (Funktion anonymous_convert_guard) wirft signup_anonymous_disabled. Bestehende anonyme
--    Zeilen bleiben (kein Aufräumen); andere Updates an ihnen laufen wie bisher.
--    handle_new_user() legt danach im selben Vorgang die Mitgliedschaft (member) in der
--    Gruppe des Codes an. check_invite(p_code) (auch ohne Anmeldung): ok/invalid/full.
--    Gleichzeitige Registrierungen: pg_advisory_xact_lock erst nach der Code-Prüfung, vor
--    der Zählung; die Sperre hält bis zum Ende der Transaktion von GoTrue.
-- E. Deckel: app_settings (genau eine Zeile, max_accounts, Start 20; kein Client-Zugriff).
--    Gezählt werden nicht-anonyme Zeilen in auth.users einschließlich unbestätigter.
--    set_max_accounts(p_max) (1–1000, nur Superadmin; Senken entfernt niemanden),
--    access_overview() (nur Superadmin): accounts, unconfirmed, max_accounts.
--
-- Fremdschlüssel auf profiles (fortgeschrieben aus 20261112000000_konto.sql 2d, vollständig
-- aus allen Migrationen erhoben): playgroups.created_by, members.profile_id (set null),
-- members.created_by, decks.owner_profile_id (cascade), sessions.created_by,
-- games.created_by; neu: playgroup_invites.renewed_by (set null), app_settings.updated_by
-- (set null) ⇒ delete_my_account() braucht keine Änderung.
--
-- Notfall-Wege (nur per SQL im Dashboard, SQL-Editor):
--  - Tor abschalten, z. B. um ein Konto im Dashboard anzulegen („Add user“ scheitert ohne
--    Code, gewollt):      alter table auth.users disable trigger ttg_signup_gate;
--    danach wieder an:    alter table auth.users enable trigger ttg_signup_gate;
--    (Umwandlung anonym → fest entsprechend: trigger ttg_anonymous_convert)
--    Meldet das „must be owner of table users“ (auth.users gehört supabase_auth_admin):
--    signup_gate() mit „begin return new; end“ ersetzen (gehört postgres) und danach die
--    Fassung aus dieser Datei wieder einspielen.
--  - Deckel ohne App:     update public.app_settings set max_accounts = <n>;
--  - Superadmin lösen (etwa damit sich das Konto löschen lässt) bzw. setzen:
--      update public.profiles set is_superadmin = false where id = '<profil-id>';
--      update public.profiles set is_superadmin = true  where id = '<profil-id>';
--
-- Bestehende Meldungen („Nicht angemeldet“, „Nur Admins dürfen Rollen ändern“ …) bleiben
-- wörtlich und werden zuerst geprüft; neue Meldungen sind Kennwörter, die die Oberfläche
-- übersetzt.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Superadmin
-- ---------------------------------------------------------------------------
alter table public.profiles add column is_superadmin boolean not null default false;
update public.profiles set is_superadmin = true where id = 'cd49f5b1-0272-474d-88ab-13e16ac02a3d';

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_superadmin from profiles p where p.id = auth.uid()), false)
     and not public.is_anon_user();
$$;

create or replace function public.superadmin_delete_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'superadmin_cannot_delete';
end $$;

create trigger ttg_superadmin_no_delete
  before delete on public.profiles
  for each row when (old.is_superadmin)
  execute function public.superadmin_delete_guard();

-- ---------------------------------------------------------------------------
-- B. Gruppen und Rollen
-- ---------------------------------------------------------------------------
create or replace function public.create_playgroup(p_name text)
returns public.playgroups language plpgsql security definer set search_path = public as $$
declare g playgroups; dn text; nm text := trim(p_name);
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not public.is_superadmin() then raise exception 'superadmin_only'; end if;
  if nm is null or length(nm) not between 1 and 60 then raise exception 'Name muss 1 bis 60 Zeichen haben'; end if;
  select display_name into dn from profiles where id = auth.uid();
  insert into playgroups (name, created_by) values (nm, auth.uid()) returning * into g;
  insert into members (playgroup_id, profile_id, display_name, role, created_by)
  values (g.id, auth.uid(), left(coalesce(dn, 'Ich'), 40), 'admin', auth.uid());
  return g;
end $$;

create or replace function public.set_member_role(p_member uuid, p_role public.member_role)
returns public.members language plpgsql security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where id = p_member;
  if m.id is null or not (public.is_group_admin(m.playgroup_id) or public.is_superadmin()) then
    raise exception 'Nur Admins dürfen Rollen ändern';
  end if;
  if m.profile_id is null then raise exception 'Spieler ohne Konto haben keine Rolle'; end if;
  if p_role = 'admin' and not public.is_superadmin() then raise exception 'superadmin_only'; end if;
  if p_role = 'member' and m.role = 'admin'
     and (select count(*) from members where playgroup_id = m.playgroup_id and role = 'admin') <= 1 then
    raise exception 'Die Gruppe braucht mindestens einen Admin';
  end if;
  update members set role = p_role where id = p_member returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- C. Einladungscode in eigener Tabelle (vorher las jedes Mitglied playgroups.invite_code).
-- Tabelle statt Spaltenrechten: Spaltenrechte bräuchten revoke select auf ganz playgroups,
-- jedes select('*') der Clients bräche dann mit 42501.
-- ---------------------------------------------------------------------------
create table public.playgroup_invites (
  playgroup_id uuid primary key references public.playgroups (id) on delete cascade,
  code         text not null unique default public.short_code('TTG'),
  renewed_at   timestamptz,
  renewed_by   uuid references public.profiles (id) on delete set null
);
alter table public.playgroup_invites enable row level security;
revoke all on public.playgroup_invites from anon, authenticated;
grant select on public.playgroup_invites to authenticated;
create policy pi_select on public.playgroup_invites for select
  using (public.is_group_admin(playgroup_id) or public.is_superadmin());
-- keine Schreib-Policy: geschrieben wird nur über Funktionen (security definer)

-- Umzug: jede Gruppe behält ihren Code, bestehende Links bleiben gültig
insert into public.playgroup_invites (playgroup_id, code)
select id, invite_code from public.playgroups;

-- jede neue Gruppe bekommt ihre Zeile (deckt jeden Einfügepfad)
create or replace function public.playgroup_invite_create()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into playgroup_invites (playgroup_id) values (new.id) on conflict (playgroup_id) do nothing;
  return new;
end $$;

create trigger ttg_playgroup_invite
  after insert on public.playgroups
  for each row execute function public.playgroup_invite_create();

-- Neuer Code, alter sofort ungültig. Gruppen-Admin oder Superadmin (ohne Mitgliedschaft).
create or replace function public.renew_invite(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not (public.is_group_admin(p_group) or public.is_superadmin()) then raise exception 'not_group_admin'; end if;
  update playgroup_invites set code = public.short_code('TTG'), renewed_at = now(), renewed_by = auth.uid()
  where playgroup_id = p_group returning code into c;
  if c is null then raise exception 'Gruppe nicht gefunden'; end if;
  return c;
end $$;

-- Signatur, Rückgabe, Normalisierung und Drossel unverändert; liest aus playgroup_invites
create or replace function public.join_playgroup(p_code text)
returns public.members language plpgsql security definer set search_path = public as $$
declare gid uuid; m members; dn text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not public.code_rate_ok() then raise exception 'Zu viele Versuche. Bitte in einer Stunde nochmal.'; end if;
  select playgroup_id into gid from playgroup_invites where code = upper(trim(p_code));
  if gid is null then
    insert into code_attempts (user_id, kind) values (auth.uid(), 'join');
    return null;
  end if;
  select * into m from members where playgroup_id = gid and profile_id = auth.uid();
  if m.id is not null then return m; end if;
  select display_name into dn from profiles where id = auth.uid();
  insert into members (playgroup_id, profile_id, display_name, created_by)
  values (gid, auth.uid(), left(coalesce(dn, 'Neu'), 40), auth.uid()) returning * into m;
  return m;
end $$;

-- erst nach dem Umzug: Spalte entfernen
alter table public.playgroups drop column invite_code;

-- ---------------------------------------------------------------------------
-- E. Deckel (eine Zeile; kein Client-Zugriff, nur über Funktionen)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id           boolean primary key default true check (id),
  max_accounts int not null default 20 check (max_accounts between 1 and 1000),
  updated_at   timestamptz,
  updated_by   uuid references public.profiles (id) on delete set null
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;  -- keine Policy
revoke all on public.app_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. Registrierungs-Tor: before insert on auth.users. Trigger statt Auth-Hook: kommt mit
-- db push, ist ohne Projekt-Konfiguration aktiv und erfasst jeden Weg, der eine Zeile
-- anlegt (Formular, direkte API, OTP, anonym, Dashboard). GoTrue meldet einen Fehler hier
-- nur als 500 „Database error saving new user“ — die Oberfläche fragt check_invite.
-- Reihenfolge: anonym · Code vorhanden · Code gültig · erst dann Sperre · Zählung.
-- volatile (Standard): jede Abfrage nach der Sperre sieht den neuesten Stand.
-- ---------------------------------------------------------------------------
create or replace function public.signup_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c text := case when jsonb_typeof(new.raw_user_meta_data) = 'object'
                 then upper(trim(new.raw_user_meta_data ->> 'invite_code')) end;
begin
  if coalesce(new.is_anonymous, false) then raise exception 'signup_anonymous_disabled'; end if;
  if c is null or c = '' then raise exception 'signup_code_required'; end if;
  if not exists (select 1 from playgroup_invites i where i.code = c) then raise exception 'signup_code_invalid'; end if;
  perform pg_advisory_xact_lock(hashtext('ttg.signup'));
  if (select count(*) from auth.users u where not u.is_anonymous)
     >= coalesce((select s.max_accounts from app_settings s), 20) then
    raise exception 'signup_full';
  end if;
  return new;
end $$;

create trigger ttg_signup_gate
  before insert on auth.users
  for each row execute function public.signup_gate();

-- Umwandlung anonym → fest (Spec-Nachtrag Krit. 16): sonst ohne Code und am Deckel vorbei.
create or replace function public.anonymous_convert_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'signup_anonymous_disabled';
end $$;

create trigger ttg_anonymous_convert
  before update of is_anonymous on auth.users
  for each row when (old.is_anonymous and not new.is_anonymous)
  execute function public.anonymous_convert_guard();

-- Profil wie bisher; danach Beitritt zur Gruppe des Codes im selben Vorgang (Rolle member).
-- Unbestätigte Konten stehen damit schon als Mitglied in der Gruppe (gewollt).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare gid uuid; dn text;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(
    left(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 40),
    left(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 40),
    'Gast'))
  on conflict (id) do nothing;
  if not coalesce(new.is_anonymous, false) and jsonb_typeof(new.raw_user_meta_data) = 'object' then
    select i.playgroup_id into gid from public.playgroup_invites i
    where i.code = upper(trim(new.raw_user_meta_data ->> 'invite_code'));
    if gid is not null then
      select p.display_name into dn from public.profiles p where p.id = new.id;
      insert into public.members (playgroup_id, profile_id, display_name, role, created_by)
      values (gid, new.id, left(coalesce(dn, 'Neu'), 40), 'member', new.id)
      on conflict (playgroup_id, profile_id) do nothing;
    end if;
  end if;
  return new;
end $$;

-- Vorab-Prüfung für die Oberfläche (auch ohne Anmeldung). Erst gültig?, dann voll?;
-- der Gruppenname nur bei ok. Keine Drossel (Begründung: spec-p9-zugang.md D).
create or replace function public.check_invite(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare nm text;
begin
  select g.name into nm from playgroup_invites i join playgroups g on g.id = i.playgroup_id
  where i.code = upper(trim(p_code));
  if nm is null then return jsonb_build_object('status', 'invalid'); end if;
  if (select count(*) from auth.users u where not u.is_anonymous)
     >= coalesce((select s.max_accounts from app_settings s), 20) then
    return jsonb_build_object('status', 'full');
  end if;
  return jsonb_build_object('status', 'ok', 'group_name', nm);
end $$;

-- Deckel setzen (nur Superadmin). Senken unter den Bestand erlaubt: niemand wird entfernt.
create or replace function public.set_max_accounts(p_max int)
returns int language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not public.is_superadmin() then raise exception 'superadmin_only'; end if;
  if p_max is null or p_max not between 1 and 1000 then raise exception 'max_accounts_range'; end if;
  update app_settings set max_accounts = p_max, updated_at = now(), updated_by = auth.uid() where id;
  return p_max;
end $$;

-- Übersicht für den Superadmin. Gezählt: nicht-anonyme Konten (unbestätigte eingeschlossen).
create or replace function public.access_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not public.is_superadmin() then raise exception 'superadmin_only'; end if;
  return jsonb_build_object(
    'accounts', (select count(*) from auth.users u where not u.is_anonymous),
    'unconfirmed', (select count(*) from auth.users u where not u.is_anonymous and u.email_confirmed_at is null),
    'max_accounts', (select s.max_accounts from app_settings s));
end $$;

-- ---------------------------------------------------------------------------
-- Ausführungsrechte (neue Funktionen bekommen per Default-Privileges anon + authenticated)
-- ---------------------------------------------------------------------------
revoke execute on function public.is_superadmin(), public.renew_invite(uuid),
  public.set_max_accounts(int), public.access_overview() from public, anon;
grant execute on function public.is_superadmin(), public.renew_invite(uuid),
  public.set_max_accounts(int), public.access_overview() to authenticated;
revoke execute on function public.check_invite(text) from public;
grant execute on function public.check_invite(text) to anon, authenticated;
-- Trigger-Funktionen: für keine Client-Rolle (handle_new_user hatte noch authenticated)
revoke execute on function public.superadmin_delete_guard(), public.playgroup_invite_create(),
  public.signup_gate(), public.anonymous_convert_guard(), public.handle_new_user() from public, anon, authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen; Einladungscodes wandern zurück nach playgroups,
-- Konten, Gruppen und Mitgliedschaften bleiben; Deckel-Einstellung geht verloren):
-- RÜCKWÄRTS-BEGINN
-- drop trigger ttg_anonymous_convert on auth.users;
-- drop function public.anonymous_convert_guard();
-- drop trigger ttg_signup_gate on auth.users;
-- drop function public.signup_gate();
-- drop function public.access_overview();
-- drop function public.set_max_accounts(int);
-- drop function public.check_invite(text);
-- drop table public.app_settings;
-- create or replace function public.handle_new_user()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   insert into public.profiles (id, display_name)
--   values (new.id, coalesce(
--     left(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 40),
--     left(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 40),
--     'Gast'))
--   on conflict (id) do nothing;
--   return new;
-- end $$;
-- revoke execute on function public.handle_new_user() from authenticated, service_role;
-- grant execute on function public.handle_new_user() to authenticated, service_role;
-- alter table public.playgroups add column invite_code text unique default public.short_code('TTG');
-- update public.playgroups g set invite_code = i.code from public.playgroup_invites i where i.playgroup_id = g.id;
-- alter table public.playgroups alter column invite_code set not null;
-- create or replace function public.join_playgroup(p_code text)
-- returns public.members language plpgsql security definer set search_path = public as $$
-- declare g playgroups; m members; dn text;
-- begin
--   if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
--   if not public.code_rate_ok() then raise exception 'Zu viele Versuche. Bitte in einer Stunde nochmal.'; end if;
--   select * into g from playgroups where invite_code = upper(trim(p_code));
--   if g.id is null then
--     insert into code_attempts (user_id, kind) values (auth.uid(), 'join');
--     return null;
--   end if;
--   select * into m from members where playgroup_id = g.id and profile_id = auth.uid();
--   if m.id is not null then return m; end if;
--   select display_name into dn from profiles where id = auth.uid();
--   insert into members (playgroup_id, profile_id, display_name, created_by)
--   values (g.id, auth.uid(), left(coalesce(dn, 'Neu'), 40), auth.uid()) returning * into m;
--   return m;
-- end $$;
-- drop function public.renew_invite(uuid);
-- drop trigger ttg_playgroup_invite on public.playgroups;
-- drop function public.playgroup_invite_create();
-- drop table public.playgroup_invites;
-- create or replace function public.set_member_role(p_member uuid, p_role public.member_role)
-- returns public.members language plpgsql security definer set search_path = public as $$
-- declare m members;
-- begin
--   select * into m from members where id = p_member;
--   if m.id is null or not public.is_group_admin(m.playgroup_id) then raise exception 'Nur Admins dürfen Rollen ändern'; end if;
--   if m.profile_id is null then raise exception 'Spieler ohne Konto haben keine Rolle'; end if;
--   if p_role = 'member' and m.role = 'admin'
--      and (select count(*) from members where playgroup_id = m.playgroup_id and role = 'admin') <= 1 then
--     raise exception 'Die Gruppe braucht mindestens einen Admin';
--   end if;
--   update members set role = p_role where id = p_member returning * into m;
--   return m;
-- end $$;
-- create or replace function public.create_playgroup(p_name text)
-- returns public.playgroups language plpgsql security definer set search_path = public as $$
-- declare g playgroups; dn text; nm text := trim(p_name);
-- begin
--   if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
--   if nm is null or length(nm) not between 1 and 60 then raise exception 'Name muss 1 bis 60 Zeichen haben'; end if;
--   select display_name into dn from profiles where id = auth.uid();
--   insert into playgroups (name, created_by) values (nm, auth.uid()) returning * into g;
--   insert into members (playgroup_id, profile_id, display_name, role, created_by)
--   values (g.id, auth.uid(), left(coalesce(dn, 'Ich'), 40), 'admin', auth.uid());
--   return g;
-- end $$;
-- drop trigger ttg_superadmin_no_delete on public.profiles;
-- drop function public.superadmin_delete_guard();
-- drop function public.is_superadmin();
-- alter table public.profiles drop column is_superadmin;
-- RÜCKWÄRTS-ENDE
-- ============================================================================
