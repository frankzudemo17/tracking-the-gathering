-- ============================================================================
-- Tracking the Gathering · Sicherheits-Nachschärfung zum Grundschema
-- Stand: 09.11.2026
--
-- 1. Mitglieder: nur Anzeigename und Bild direkt änderbar (vorher konnte sich
--    jedes Mitglied selbst zum Admin machen oder einen Platzhalter ohne Code
--    übernehmen; Platzhalter mit role=admin ließen sich anlegen und einlösen).
-- 2. Einladungs- und Übernahme-Codes: 6 Zeichen aus 32 (statt 4 Hex = 65 536
--    Möglichkeiten) plus Versuchsbremse (10 Fehlversuche pro Stunde).
-- 3. Anonyme Konten (Live-Modus) dürfen keine Gruppen anlegen/betreten/übernehmen.
-- 4. Spieler im Spiel müssen Mitglieder der Gruppe des Spiels sein.
-- 5. Spiele löschen nur Admin oder Ersteller.
-- 6. Anzeigename begrenzt (1–40 Zeichen), sonst scheitert create_playgroup.
-- 7. RPCs nicht für anon ausführbar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Hilfen
-- ---------------------------------------------------------------------------
create or replace function public.is_anon_user()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- Codes: Präfix + 6 Zeichen ohne Verwechsler (kein 0/O, 1/I). 32^6 ≈ 1 Mrd.
-- Bytes 0–5 einer v4-UUID sind vollständig zufällig.
create or replace function public.short_code(prefix text)
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid());
  s text := '';
begin
  for i in 0..5 loop
    s := s || substr(alphabet, (get_byte(b, i) & 31) + 1, 1);
  end loop;
  return prefix || '-' || s;
end $$;

-- Versuchsbremse für Code-Eingaben
create table public.code_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  kind    text not null check (kind in ('join', 'claim')),
  at      timestamptz not null default now()
);
create index on public.code_attempts (user_id, at desc);
alter table public.code_attempts enable row level security;  -- keine Policies: nur über Funktionen
revoke all on public.code_attempts from anon, authenticated;

create or replace function public.code_rate_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) < 10 from code_attempts where user_id = auth.uid() and at > now() - interval '1 hour';
$$;

-- ---------------------------------------------------------------------------
-- Profile: Anzeigename begrenzen, Trigger säubert Eingaben
-- ---------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_display_name_len check (length(trim(display_name)) between 1 and 40);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(
    left(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 40),
    left(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 40),
    'Gast'))
  on conflict (id) do nothing;
  return new;
end $$;

-- Nur die eigenen, harmlosen Spalten sind direkt änderbar
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, locale, theme, avatar_path) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Playgroups: direkt nur der Name änderbar (durch Admins, siehe pg_update)
-- ---------------------------------------------------------------------------
revoke insert, update on public.playgroups from anon, authenticated;
grant update (name) on public.playgroups to authenticated;

-- ---------------------------------------------------------------------------
-- Mitglieder: Anlegen nur per RPC, ändern nur Name/Bild, Rolle per RPC
-- ---------------------------------------------------------------------------
drop policy if exists mem_insert on public.members;
revoke insert, update on public.members from anon, authenticated;
grant update (display_name, avatar_path) on public.members to authenticated;

create or replace function public.set_member_role(p_member uuid, p_role public.member_role)
returns public.members language plpgsql security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where id = p_member;
  if m.id is null or not public.is_group_admin(m.playgroup_id) then raise exception 'Nur Admins dürfen Rollen ändern'; end if;
  if m.profile_id is null then raise exception 'Spieler ohne Konto haben keine Rolle'; end if;
  if p_role = 'member' and m.role = 'admin'
     and (select count(*) from members where playgroup_id = m.playgroup_id and role = 'admin') <= 1 then
    raise exception 'Die Gruppe braucht mindestens einen Admin';
  end if;
  update members set role = p_role where id = p_member returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs neu: anonyme Konten aussperren, Eingaben säubern, Versuchsbremse.
-- Bei falschem Code wird NICHT geworfen (sonst rollt der Fehlversuch mit
-- zurück), sondern null zurückgegeben. Der Client prüft data?.id.
-- ---------------------------------------------------------------------------
create or replace function public.create_playgroup(p_name text)
returns public.playgroups language plpgsql security definer set search_path = public as $$
declare g playgroups; dn text; nm text := trim(p_name);
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if nm is null or length(nm) not between 1 and 60 then raise exception 'Name muss 1 bis 60 Zeichen haben'; end if;
  select display_name into dn from profiles where id = auth.uid();
  insert into playgroups (name, created_by) values (nm, auth.uid()) returning * into g;
  insert into members (playgroup_id, profile_id, display_name, role, created_by)
  values (g.id, auth.uid(), left(coalesce(dn, 'Ich'), 40), 'admin', auth.uid());
  return g;
end $$;

create or replace function public.join_playgroup(p_code text)
returns public.members language plpgsql security definer set search_path = public as $$
declare g playgroups; m members; dn text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not public.code_rate_ok() then raise exception 'Zu viele Versuche. Bitte in einer Stunde nochmal.'; end if;
  select * into g from playgroups where invite_code = upper(trim(p_code));
  if g.id is null then
    insert into code_attempts (user_id, kind) values (auth.uid(), 'join');
    return null;
  end if;
  select * into m from members where playgroup_id = g.id and profile_id = auth.uid();
  if m.id is not null then return m; end if;
  select display_name into dn from profiles where id = auth.uid();
  insert into members (playgroup_id, profile_id, display_name, created_by)
  values (g.id, auth.uid(), left(coalesce(dn, 'Neu'), 40), auth.uid()) returning * into m;
  return m;
end $$;

create or replace function public.create_placeholder(p_group uuid, p_name text)
returns public.members language plpgsql security definer set search_path = public as $$
declare m members; prefix text; nm text := trim(p_name);
begin
  if public.is_anon_user() or not public.is_group_member(p_group) then raise exception 'Kein Mitglied dieser Gruppe'; end if;
  if nm is null or length(nm) not between 1 and 40 then raise exception 'Name muss 1 bis 40 Zeichen haben'; end if;
  prefix := left(regexp_replace(
              replace(replace(replace(replace(upper(nm), 'Ä', 'AE'), 'Ö', 'OE'), 'Ü', 'UE'), 'ß', 'SS'),
              '[^A-Z]', '', 'g'), 4);
  if prefix = '' then prefix := 'GAST'; end if;
  insert into members (playgroup_id, display_name, claim_code, created_by)
  values (p_group, nm, public.short_code(prefix), auth.uid()) returning * into m;
  return m;
end $$;

create or replace function public.claim_member(p_code text)
returns public.members language plpgsql security definer set search_path = public as $$
declare ph members; me members;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not public.code_rate_ok() then raise exception 'Zu viele Versuche. Bitte in einer Stunde nochmal.'; end if;
  select * into ph from members where claim_code = upper(trim(p_code)) and profile_id is null;
  if ph.id is null then
    insert into code_attempts (user_id, kind) values (auth.uid(), 'claim');
    return null;
  end if;
  update decks set owner_profile_id = auth.uid(), owner_member_id = null where owner_member_id = ph.id;
  update profiles set avatar_path = coalesce(avatar_path, ph.avatar_path) where id = auth.uid();
  select * into me from members where playgroup_id = ph.playgroup_id and profile_id = auth.uid();
  if me.id is null then
    update members set profile_id = auth.uid(), claimed_at = now(), claim_code = null, role = 'member'
    where id = ph.id returning * into me;
    return me;
  end if;
  update game_players      set member_id     = me.id where member_id     = ph.id;
  update game_players      set eliminated_by = me.id where eliminated_by = ph.id;
  update game_events       set actor  = me.id where actor  = ph.id;
  update game_events       set source = me.id where source = ph.id;
  update game_events       set target = me.id where target = ph.id;
  update player_ratings    set member_id = me.id where member_id = ph.id;
  update deck_salt_ratings set rater_id  = me.id where rater_id  = ph.id;
  update potg_votes        set voter_id  = me.id where voter_id  = ph.id;
  update potg_votes        set voted_for = me.id where voted_for = ph.id;
  delete from members where id = ph.id;
  return me;
end $$;

-- ---------------------------------------------------------------------------
-- Spiele: Löschen nur Admin oder Ersteller
-- ---------------------------------------------------------------------------
drop policy if exists games_all on public.games;
create policy games_select on public.games for select using (public.is_group_member(playgroup_id));
create policy games_insert on public.games for insert with check (public.is_group_member(playgroup_id));
create policy games_update on public.games for update
  using (public.is_group_member(playgroup_id)) with check (public.is_group_member(playgroup_id));
create policy games_delete on public.games for delete
  using (public.is_group_admin(playgroup_id) or created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Spieler im Spiel: müssen Mitglieder derselben Gruppe sein
-- ---------------------------------------------------------------------------
create or replace function public.gp_valid(p_game uuid, p_member uuid, p_elim uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g join members m on m.id = p_member and m.playgroup_id = g.playgroup_id
    where g.id = p_game and public.is_group_member(g.playgroup_id))
  and (p_elim is null or exists (
    select 1 from games g join members e on e.id = p_elim and e.playgroup_id = g.playgroup_id
    where g.id = p_game));
$$;

drop policy if exists gp_all on public.game_players;
create policy gp_select on public.game_players for select
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
create policy gp_insert on public.game_players for insert
  with check (public.gp_valid(game_id, member_id, eliminated_by));
create policy gp_update on public.game_players for update
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
  with check (public.gp_valid(game_id, member_id, eliminated_by));
create policy gp_delete on public.game_players for delete
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));

-- ---------------------------------------------------------------------------
-- Ausführungsrechte: schreibende RPCs nicht für anon / PUBLIC.
-- Die RLS-Hilfsfunktionen (is_group_member usw.) bleiben ausführbar, weil
-- Policies sie im Kontext der anfragenden Rolle aufrufen; ohne Login liefern
-- sie ohnehin false.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.create_playgroup(text), public.join_playgroup(text),
  public.create_placeholder(uuid, text), public.claim_member(text),
  public.set_member_role(uuid, public.member_role),
  public.code_rate_ok(), public.handle_new_user()
from public, anon;

grant execute on function
  public.create_playgroup(text), public.join_playgroup(text),
  public.create_placeholder(uuid, text), public.claim_member(text),
  public.set_member_role(uuid, public.member_role),
  public.code_rate_ok()
to authenticated;
