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
-- Ausführungsrechte (neue Funktionen bekommen per Default-Privileges anon + authenticated)
-- ---------------------------------------------------------------------------
revoke execute on function public.is_superadmin(), public.renew_invite(uuid) from public, anon;
grant execute on function public.is_superadmin(), public.renew_invite(uuid) to authenticated;
revoke execute on function public.superadmin_delete_guard(), public.playgroup_invite_create() from public, anon, authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen; Einladungscodes wandern zurück nach playgroups,
-- Konten, Gruppen und Mitgliedschaften bleiben; Deckel-Einstellung geht verloren):
-- RÜCKWÄRTS-BEGINN
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
