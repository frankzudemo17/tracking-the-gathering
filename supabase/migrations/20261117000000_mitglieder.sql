-- ============================================================================
-- Tracking the Gathering · Mitglieder (Welle ttg-live-feinschliff-decks, Paket P10,
-- spec-p10-mitglieder.md) · Stand: 17.11.2026
--
-- A. Schema: members.removed_at, removed_by, former_profile_id. Eine entfernte Zeile hat nie
--    ein Konto (Checks) ⇒ is_group_member/is_group_admin/my_member_id bleiben unverändert und
--    schließen Entfernte von selbst aus. Die Spaltenfreigabe aus 20261109000000_sicherheit.sql
--    (update display_name, avatar_path) bleibt ⇒ die neuen Spalten setzt nur eine Funktion.
--    Index game_players(deck_id) für den neuen Zweig in can_see_deck.
-- B. Regel „löschen oder markieren“: kein einziger Verweis ⇒ Zeile wirklich löschen (samt
--    Decks und deck_cards); irgendein Verweis ⇒ markieren (removed_at), Historie unberührt.
--    Der Modus kommt aus einem Löschversuch im Unterblock (zurückgerollt), nicht aus einer
--    Liste: eine später hinzugefügte Tabelle mit Verweis führt so nie zu einem Löschen mit
--    Historie. Fremdschlüssel auf members (9, alle ohne on delete): game_players.member_id,
--    .eliminated_by, game_events.actor/.source/.target, player_ratings.member_id,
--    deck_salt_ratings.rater_id, potg_votes.voter_id/.voted_for; dazu decks.owner_member_id
--    (cascade). Auf decks (4): deck_cards.deck_id (cascade), game_players.deck_id,
--    deck_salt_ratings.deck_id, decks.version_of. Der DB-Test vergleicht die Liste (Stolperdraht).
-- C. Trigger before insert on game_players: entfernte Mitglieder und Decks entfernter
--    Platzhalter kommen in kein neues Spiel; laufende Spiele bleiben unberührt.
-- D. mem_update, can_write_avatar, can_edit_deck: entfernte Zeilen eingefroren. can_see_deck:
--    in einem Spiel einer meiner Gruppen gespielte Decks bleiben sichtbar.
-- E. member_removal_check, remove_member, restore_member (Gruppen-Admin oder Superadmin).
-- F. leave_playgroup, list_all_playgroups, enter_playgroup; join_playgroup reaktiviert eine
--    frühere Zeile (gleiche ID, Historie hängt wieder am Konto).
-- Block K (E-K = ja, Franco 10.11.): Mitglieder mit Konto entfernen (nicht Admins, nie den
--    Superadmin, nie sich selbst), Austreten für alle (letzter Admin außer Superadmin nicht),
--    Entfernen ist kein Bann (Code bringt das Konto zurück), delete_my_account erbt an frühere
--    Zeilen, direktes delete auf members geschlossen.
-- Fremdschlüssel auf profiles (fortgeschrieben aus 20261112000000_konto.sql 2d und
--    20261116000000_zugang.sql, vollständig aus allen Migrationen erhoben):
--    app_settings.updated_by (set null), decks.owner_profile_id (cascade), games.created_by,
--    members.created_by, members.profile_id (set null), playgroup_invites.renewed_by (set null),
--    playgroups.created_by, sessions.created_by; NEU members.removed_by (set null),
--    members.former_profile_id (set null).
-- Rückwärts-Block (am Ende): stellt mem_update, mem_delete, die vier D-Funktionen,
--    join_playgroup und delete_my_account wortgleich wieder her, entfernt Trigger, Funktionen,
--    Indizes und Spalten. Preis (Risiko 2): Markierungen gehen verloren — markierte Zeilen sind
--    danach wieder aktiv, umgewandelte Zeilen bleiben als Platzhalter ohne Konto zurück.
--    Gefahrlos nur vor dem ersten echten Entfernen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.members
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles (id) on delete set null,
  add column former_profile_id uuid references public.profiles (id) on delete set null;
alter table public.members
  add constraint members_removed_no_account check (removed_at is null or profile_id is null),
  add constraint members_former_no_account check (former_profile_id is null or profile_id is null);
create unique index members_group_former_profile_key on public.members (playgroup_id, former_profile_id)
  where former_profile_id is not null;
create index game_players_deck_id_idx on public.game_players (deck_id);

-- ---------------------------------------------------------------------------
-- B. Löschen oder markieren. Der Modus kommt aus einem Löschversuch im Unterblock (Muster
-- playgroup_files, 20261115010000_gruppe_loeschen.sql): kein einziger Verweis ⇒ löschen,
-- irgendein Fremdschlüssel ⇒ markieren. Eine später hinzugefügte Tabelle mit Verweis auf
-- members/decks führt so nie zu einem Löschen mit Historie.
-- ---------------------------------------------------------------------------
-- Löschen der Zeile (Decks samt deck_cards per Kaskade). Versionsverweise unter den eigenen
-- Decks vorher lösen. Intern, kein execute für Client-Rollen.
create or replace function public._member_delete(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update decks set version_of = null where owner_member_id = p_member and version_of is not null;
  delete from members where id = p_member;
end $$;

-- Probelauf: _member_delete im Unterblock, danach zurückgerollt (eigener SQLSTATE TTG01 als
-- Signal). true = kein Verweis, false = ein Fremdschlüssel hält die Zeile. Jeder andere Fehler
-- kommt beim Aufrufer an.
create or replace function public._member_deletable(p_member uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public._member_delete(p_member);
    raise exception using errcode = 'TTG01', message = 'Probelauf ok';
  exception
    when sqlstate 'TTG01' then return true;
    when foreign_key_violation then return false;
  end;
end $$;

-- Block K (E-K = ja): Ziel mit Konto. Reihenfolge selbst → Superadmin → Admin (ein Admin, der
-- sich selbst nimmt, hört member_is_self; der Superadmin als Ziel ist immer superadmin_only).
-- Ohne Konto: nichts. Intern.
create or replace function public._member_account_guard(m public.members)
returns void language plpgsql security definer set search_path = public as $$
begin
  if m.profile_id is null then return; end if;
  if m.profile_id = auth.uid() then raise exception 'member_is_self'; end if;
  if exists (select 1 from profiles p where p.id = m.profile_id and p.is_superadmin) then raise exception 'superadmin_only'; end if;
  if m.role = 'admin' then raise exception 'member_is_admin'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- E. Entfernen und Wiederherstellen (Gruppen-Admin des Ziels oder Superadmin, auch ohne
-- Mitgliedschaft). Reihenfolge: Nicht angemeldet · Ziel unbekannt oder nicht berechtigt
-- (gleiche Meldung, kein Existenz-Leck) · Ziel hat ein Konto · Rest.
-- ---------------------------------------------------------------------------
-- Probelauf, ändert nichts.
create or replace function public.member_removal_check(p_member uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m members; mode text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  select * into m from members where id = p_member;
  if m.id is null or not (public.is_group_admin(m.playgroup_id) or public.is_superadmin()) then
    raise exception 'not_group_admin';
  end if;
  perform public._member_account_guard(m);
  mode := case when m.removed_at is not null then 'already'
               when public._member_deletable(m.id) then 'delete' else 'mark' end;
  return jsonb_build_object(
    'mode', mode,
    'games', (select count(distinct gp.game_id) from game_players gp where gp.member_id = m.id),
    'live_games', (select count(distinct gp.game_id) from game_players gp join games g on g.id = gp.game_id
                   where gp.member_id = m.id and g.status = 'live'),
    'decks', (select count(*) from decks d where d.owner_member_id = m.id),
    -- Konten: immer leer (das Profilbild gehört dem Konto, nicht der Gruppe)
    'files', case when m.profile_id is not null then '[]'::jsonb else
             coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                       where o.bucket_id = 'avatars' and o.name like 'members/' || m.id::text || '/%'), '[]'::jsonb) end);
end $$;

-- Entfernen. p_expect = Modus, den der Admin bestätigt hat; weicht der ermittelte ab (auch bei
-- unbekanntem Wert/null) ⇒ member_state_changed, nichts geändert. Modus delete mit Dateien unter
-- members/<id>/ ⇒ member_files_pending (SQL löscht keine Storage-Dateien; der Client löscht sie
-- vorher). Zeilensperre for update: ein gleichzeitiges start_game (Trigger, for share) wartet.
create or replace function public.remove_member(p_member uuid, p_expect text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m members; mode text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  select * into m from members where id = p_member for update;
  if m.id is null or not (public.is_group_admin(m.playgroup_id) or public.is_superadmin()) then
    raise exception 'not_group_admin';
  end if;
  perform public._member_account_guard(m);
  if m.removed_at is not null then return jsonb_build_object('result', 'already'); end if;
  mode := case when public._member_deletable(m.id) then 'delete' else 'mark' end;
  if p_expect is distinct from mode then raise exception 'member_state_changed'; end if;
  -- Block K: Mitglied mit Konto wird wie beim Verlassen gelöscht oder umgewandelt (kein Bann)
  if m.profile_id is not null then
    perform public._member_detach(m.id);
    return jsonb_build_object('result', case mode when 'delete' then 'deleted' else 'marked' end);
  end if;
  if mode = 'delete' then
    if exists (select 1 from storage.objects o
               where o.bucket_id = 'avatars' and o.name like 'members/' || m.id::text || '/%') then
      raise exception 'member_files_pending';
    end if;
    perform public._member_delete(m.id);
    return jsonb_build_object('result', 'deleted');
  end if;
  -- Markieren: Historie bleibt unberührt; Übernahme-Code tot; Bild bleibt, außer die Datei fehlt
  update members set removed_at = now(), removed_by = auth.uid(), claim_code = null,
    avatar_path = case when avatar_path is null
                         or exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = members.avatar_path)
                       then avatar_path end
  where id = m.id;
  return jsonb_build_object('result', 'marked');
end $$;

-- Wiederherstellen: gleiche ID und Historie, neuer Übernahme-Code (Präfix wie create_placeholder).
-- Frühere Konto-Zeilen (former_profile_id) kommen nur über enter_playgroup/join_playgroup zurück.
create or replace function public.restore_member(p_member uuid)
returns public.members language plpgsql security definer set search_path = public as $$
declare m members; prefix text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  select * into m from members where id = p_member for update;
  if m.id is null or not (public.is_group_admin(m.playgroup_id) or public.is_superadmin()) then
    raise exception 'not_group_admin';
  end if;
  if m.profile_id is not null then raise exception 'member_has_account'; end if;
  if m.removed_at is null then return m; end if;
  if m.former_profile_id is not null then raise exception 'member_has_account'; end if;
  prefix := left(regexp_replace(
              replace(replace(replace(replace(upper(m.display_name), 'Ä', 'AE'), 'Ö', 'OE'), 'Ü', 'UE'), 'ß', 'SS'),
              '[^A-Z]', '', 'g'), 4);
  if prefix = '' then prefix := 'GAST'; end if;
  update members set removed_at = null, removed_by = null, claim_code = public.short_code(prefix)
  where id = m.id returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- C. Sperre für neue Spiele: Trigger statt Neuschreiben von start_game/gp_valid/deck_in_group
-- (erfasst jeden heutigen und künftigen Einfügepfad). Nur insert ⇒ laufende Spiele (Leben,
-- K.O., Beenden) bleiben unberührt. for share gegen for update in remove_member: ein
-- gleichzeitiges start_game wartet und sieht danach den neuen Stand.
-- ---------------------------------------------------------------------------
create or replace function public.gp_member_active()
returns trigger language plpgsql security definer set search_path = public as $$
declare rm timestamptz; owner uuid;
begin
  select removed_at into rm from members where id = new.member_id for share;
  if rm is not null then raise exception 'member_removed'; end if;
  if new.deck_id is not null then
    select d.owner_member_id into owner from decks d where d.id = new.deck_id;
    if owner is not null then
      select removed_at into rm from members where id = owner for share;
      if rm is not null then raise exception 'Deck nicht verfügbar'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger ttg_gp_member_active before insert on public.game_players
  for each row execute function public.gp_member_active();

-- ---------------------------------------------------------------------------
-- D. Eingefrorene Zeilen und Sichtbarkeit. Je die jüngste Definition (alle vier aus
-- 20261106000000_init.sql, seither unverändert) fortgeschrieben, nur die eine Bedingung ergänzt.
-- create or replace behält Rechte und Abhängigkeiten.
-- ---------------------------------------------------------------------------
-- mem_update (init.sql:276–278): entfernte Zeilen ändert nur noch ein RPC
alter policy mem_update on public.members using (
  removed_at is null and (
  public.is_group_admin(playgroup_id) or (profile_id is null and public.is_group_member(playgroup_id)) or profile_id = auth.uid()
  )
);

-- can_write_avatar (init.sql:508–518), Zweig members: + m.removed_at is null
create or replace function public.can_write_avatar(obj_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case (storage.foldername(obj_name))[1]
    when 'profiles' then (storage.foldername(obj_name))[2] = auth.uid()::text
    when 'members' then exists (
      select 1 from public.members m
      where m.id::text = (storage.foldername(obj_name))[2]
        and m.profile_id is null
        and m.removed_at is null
        and public.is_group_member(m.playgroup_id))
    else false end
$$;

-- can_edit_deck (init.sql:143–148), Platzhalter-Zweig: + m.removed_at is null
-- (Decks entfernter Platzhalter sind lesbar, nicht änderbar)
create or replace function public.can_edit_deck(d public.decks)
returns boolean language sql stable security definer set search_path = public as $$
  select
    d.owner_profile_id = auth.uid()
    or exists (select 1 from members m where m.id = d.owner_member_id and m.profile_id is null and m.removed_at is null and public.is_group_member(m.playgroup_id));
$$;

-- can_see_deck (init.sql:131–141): + Zweig „in einem Spiel einer meiner Gruppen gespielt“.
-- Nach dem Verlassen hat das Konto-Deck des Gegangenen keinen Besitzer mehr in der Gruppe;
-- ohne den Zweig verlören alte Spiele Name, Bild und Deckliste. Index game_players(deck_id) aus A.
create or replace function public.can_see_deck(d public.decks)
returns boolean language sql stable security definer set search_path = public as $$
  select
    d.owner_profile_id = auth.uid()
    or exists (
      select 1 from members mine join members theirs on theirs.playgroup_id = mine.playgroup_id
      where mine.profile_id = auth.uid()
        and (theirs.profile_id = d.owner_profile_id or theirs.id = d.owner_member_id)
    )
    or exists (
      select 1 from game_players gp join games g on g.id = gp.game_id
      where gp.deck_id = d.id and public.is_group_member(g.playgroup_id)
    );
$$;

-- ---------------------------------------------------------------------------
-- F. Superadmin verlässt und betritt Gruppen
-- ---------------------------------------------------------------------------
-- Eigene Zeile mit Konto löschen (kein Verweis) oder in eine entfernte Zeile ohne Konto umwandeln
-- (former_profile_id merkt sich das Konto, Name bleibt der zuletzt angezeigte). Intern.
-- Hat das Konto in der Gruppe schon eine ältere frühere Zeile (Platzhalter übernommen, nachdem
-- es gegangen war), verliert die ältere den Kontobezug und bleibt entfernt: die eindeutige
-- (playgroup_id, former_profile_id) lässt nur eine zu, die jüngste kommt über Code/Betreten zurück.
create or replace function public._member_detach(p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m members; nm text;
begin
  select * into m from members where id = p_member for update;
  if public._member_deletable(m.id) then
    perform public._member_delete(m.id);
    return 'delete';
  end if;
  select left(coalesce(nullif(p.display_name, ''), m.display_name), 40) into nm from profiles p where p.id = m.profile_id;
  update members set former_profile_id = null
  where playgroup_id = m.playgroup_id and former_profile_id = m.profile_id;
  update members set former_profile_id = m.profile_id, profile_id = null, display_name = coalesce(nm, m.display_name),
    role = 'member', removed_at = now(), removed_by = auth.uid(), claim_code = null
  where id = m.id;
  return 'mark';
end $$;

-- Verlassen. Kein Letzter-Admin-Schutz für den Superadmin: seine Rechte hängen nicht an der
-- Mitgliedschaft (set_member_role, renew_invite, remove_member/restore_member, enter_playgroup).
create or replace function public.leave_playgroup(p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m members; mode text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  select * into m from members where playgroup_id = p_group and profile_id = auth.uid() for update;
  if m.id is null then return jsonb_build_object('result', 'already'); end if;
  -- Block K2: jedes Mitglied darf gehen; der letzte Admin (außer dem Superadmin) erst nach Nachfolge
  if m.role = 'admin' and not public.is_superadmin()
     and not exists (select 1 from members o where o.playgroup_id = p_group and o.id <> m.id
                     and o.role = 'admin' and o.removed_at is null) then
    raise exception 'last_admin';
  end if;
  mode := public._member_detach(m.id);
  return jsonb_build_object('result', 'left', 'mode', mode,
    'admins_left', (select count(*) from members where playgroup_id = p_group and role = 'admin' and removed_at is null));
end $$;

-- Alle Gruppen (nur Superadmin), nach Name; Zählungen nur aktiver Zeilen
create or replace function public.list_all_playgroups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not public.is_superadmin() then raise exception 'superadmin_only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name,
      'members', (select count(*) from members m where m.playgroup_id = g.id and m.removed_at is null),
      'admins', (select count(*) from members m where m.playgroup_id = g.id and m.removed_at is null and m.role = 'admin'),
      'is_member', exists (select 1 from members m where m.playgroup_id = g.id and m.profile_id = auth.uid()))
      order by g.name, g.id)
    from playgroups g), '[]'::jsonb);
end $$;

-- Betreten (nur Superadmin): aktive Zeile unverändert · frühere Zeile reaktiviert (gleiche ID,
-- Rolle admin) · sonst neue Admin-Zeile (Name wie join_playgroup)
create or replace function public.enter_playgroup(p_group uuid)
returns public.members language plpgsql security definer set search_path = public as $$
declare m members; dn text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not public.is_superadmin() then raise exception 'superadmin_only'; end if;
  perform 1 from playgroups where id = p_group;
  if not found then raise exception 'group_not_found'; end if;
  select * into m from members where playgroup_id = p_group and profile_id = auth.uid();
  if m.id is not null then return m; end if;
  update members set profile_id = auth.uid(), former_profile_id = null, removed_at = null, removed_by = null,
    role = 'admin', claim_code = null
  where playgroup_id = p_group and former_profile_id = auth.uid() returning * into m;
  if m.id is not null then return m; end if;
  select display_name into dn from profiles where id = auth.uid();
  insert into members (playgroup_id, profile_id, display_name, role, created_by)
  values (p_group, auth.uid(), left(coalesce(dn, 'Neu'), 40), 'admin', auth.uid()) returning * into m;
  return m;
end $$;

-- join_playgroup (jüngste Definition 20261116000000_zugang.sql:176–193; Signatur, Rückgabe,
-- Normalisierung, Drossel unverändert): nach „schon Mitglied“ frühere Zeile reaktivieren (member)
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
  update members set profile_id = auth.uid(), former_profile_id = null, removed_at = null, removed_by = null,
    role = 'member', claim_code = null
  where playgroup_id = gid and former_profile_id = auth.uid() returning * into m;
  if m.id is not null then return m; end if;
  select display_name into dn from profiles where id = auth.uid();
  insert into members (playgroup_id, profile_id, display_name, created_by)
  values (gid, auth.uid(), left(coalesce(dn, 'Neu'), 40), auth.uid()) returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- Block K5: delete_my_account (jüngste Definition 20261112000000_konto.sql:89–194) bekommt
-- EINEN Block vor Schritt a); sonst wortgleich.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  me constant uuid := auth.uid();
  m members;
  d decks;
  heir uuid;
  gid uuid;
  ph uuid;
  c decks;                 -- Kopie eines Decks für eine weitere Gruppe
  used boolean;
  former uuid[] := '{}';   -- umgewandelte Mitgliedschaften (bleiben als Platzhalter)
begin
  if me is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  -- Sperre: ein zweiter, gleichzeitiger Aufruf (Doppelklick) wartet hier und findet
  -- danach kein Profil mehr.
  perform 1 from profiles where id = me for update;
  if not found then raise exception 'Konto nicht gefunden'; end if;

  -- P10 Block K5 (20261117000000_mitglieder.sql): frühere Mitgliedschaften (verlassen/entfernt,
  -- former_profile_id) heißen danach neutral und nehmen in c) die Decks auf, statt dass dort eine
  -- neue aktive Zeile entsteht. Sonst unverändert gegenüber 20261112000000_konto.sql.
  update members set display_name = 'Ehemaliges Mitglied' where former_profile_id = me;
  former := former || array(select x.id from members x where x.former_profile_id = me order by x.created_at, x.id);

  -- a) Mitgliedschaften
  for m in select * from members where profile_id = me order by created_at, id loop
    if not exists (select 1 from members o where o.playgroup_id = m.playgroup_id
                   and o.profile_id is not null and o.profile_id <> me) then
      perform public.purge_playgroup(m.playgroup_id);
    else
      if m.role = 'admin' and not exists (
           select 1 from members o where o.playgroup_id = m.playgroup_id and o.id <> m.id
             and o.profile_id is not null and o.role = 'admin') then
        select o.id into heir from members o
        where o.playgroup_id = m.playgroup_id and o.id <> m.id and o.profile_id is not null
        order by coalesce(o.claimed_at, o.created_at), o.id limit 1;
        update members set role = 'admin' where id = heir;
      end if;
      update members set profile_id = null, display_name = 'Ehemaliges Mitglied', claim_code = null,
                         avatar_path = null, role = 'member', claimed_at = null
      where id = m.id;
      former := former || m.id;
    end if;
  end loop;

  -- b) Ersteller von Gruppen (auch solchen, in denen das Konto nicht mehr Mitglied ist)
  for gid in select id from playgroups where created_by = me loop
    select o.profile_id into heir from members o
    where o.playgroup_id = gid and o.profile_id is not null and o.profile_id <> me
    order by (o.role = 'admin') desc, coalesce(o.claimed_at, o.created_at), o.id limit 1;
    if heir is null then
      perform public.purge_playgroup(gid);
    else
      update playgroups set created_by = heir where id = gid;
    end if;
  end loop;

  -- c) Decks (nach a/b: Spiele mitgelöschter Gruppen zählen nicht mehr als Verwendung)
  for d in select * from decks where owner_profile_id = me order by created_at, id loop
    used := false;
    -- Gruppen mit Verwendung, früheste zuerst
    for gid in
      select g.playgroup_id from (
        select gp.game_id from game_players gp where gp.deck_id = d.id
        union select r.game_id from deck_salt_ratings r where r.deck_id = d.id) u
      join games g on g.id = u.game_id
      group by g.playgroup_id
      order by min(g.started_at), g.playgroup_id
    loop
      ph := null;
      select x.id into ph from members x where x.id = any(former) and x.playgroup_id = gid;
      if ph is null then
        insert into members (playgroup_id, display_name) values (gid, 'Ehemaliges Mitglied') returning id into ph;
        former := former || ph;
      end if;
      if not used then
        -- Original: beide Besitzer-Spalten in EINEM update (check: genau einer gesetzt)
        update decks set owner_profile_id = null, owner_member_id = ph, archived = true where id = d.id;
        used := true;
      else
        -- Kopie aus der Zeile (alle Spalten, auch künftige), neuer Besitzer, archiviert
        c := d;
        c.id := gen_random_uuid();
        c.owner_profile_id := null;
        c.owner_member_id := ph;
        c.archived := true;
        c.version_of := null;
        insert into decks select (c).*;
        update game_players gp set deck_id = c.id
          from games g where g.id = gp.game_id and g.playgroup_id = gid and gp.deck_id = d.id;
        update deck_salt_ratings r set deck_id = c.id
          from games g where g.id = r.game_id and g.playgroup_id = gid and r.deck_id = d.id;
      end if;
    end loop;
    if not used then
      update decks set version_of = null where version_of = d.id;
      delete from decks where id = d.id;
    end if;
  end loop;

  -- d) übrige Verweise auf das Profil
  update members  set created_by = null where created_by = me;
  update sessions set created_by = null where created_by = me;
  update games    set created_by = null where created_by = me;

  -- e) personenbezogene Protokollzeilen
  delete from code_attempts where user_id = me;

  -- f) Konto selbst (profiles fällt per on delete cascade)
  delete from auth.users where id = me;
end $$;

-- ---------------------------------------------------------------------------
-- Block K6: direktes Löschen von members schließen. Entfernen nur über remove_member /
-- leave_playgroup; ganze Gruppen über delete_playgroup/purge_playgroup (security definer).
-- ---------------------------------------------------------------------------
drop policy mem_delete on public.members;
revoke delete on public.members from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ausführungsrechte (neue Funktionen bekommen per Default-Privileges anon + authenticated)
-- ---------------------------------------------------------------------------
revoke execute on function public.member_removal_check(uuid), public.remove_member(uuid, text),
  public.restore_member(uuid) from public, anon;
grant execute on function public.member_removal_check(uuid), public.remove_member(uuid, text),
  public.restore_member(uuid) to authenticated;
-- interne Hilfen: für keine Client-Rolle
revoke execute on function public.leave_playgroup(uuid), public.list_all_playgroups(),
  public.enter_playgroup(uuid) from public, anon;
grant execute on function public.leave_playgroup(uuid), public.list_all_playgroups(),
  public.enter_playgroup(uuid) to authenticated;
revoke execute on function public._member_delete(uuid), public._member_deletable(uuid), public._member_detach(uuid),
  public._member_account_guard(public.members),
  public.gp_member_active() from public, anon, authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen):
-- RÜCKWÄRTS-BEGINN
-- grant delete on public.members to anon, authenticated;
-- create policy mem_delete on public.members for delete using (public.is_group_admin(playgroup_id));
-- create or replace function public.delete_my_account()
-- returns void language plpgsql security definer set search_path = public as $$
-- declare
--   me constant uuid := auth.uid();
--   m members;
--   d decks;
--   heir uuid;
--   gid uuid;
--   ph uuid;
--   c decks;                 -- Kopie eines Decks für eine weitere Gruppe
--   used boolean;
--   former uuid[] := '{}';   -- umgewandelte Mitgliedschaften (bleiben als Platzhalter)
-- begin
--   if me is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
--   -- Sperre: ein zweiter, gleichzeitiger Aufruf (Doppelklick) wartet hier und findet
--   -- danach kein Profil mehr.
--   perform 1 from profiles where id = me for update;
--   if not found then raise exception 'Konto nicht gefunden'; end if;
-- 
--   -- a) Mitgliedschaften
--   for m in select * from members where profile_id = me order by created_at, id loop
--     if not exists (select 1 from members o where o.playgroup_id = m.playgroup_id
--                    and o.profile_id is not null and o.profile_id <> me) then
--       perform public.purge_playgroup(m.playgroup_id);
--     else
--       if m.role = 'admin' and not exists (
--            select 1 from members o where o.playgroup_id = m.playgroup_id and o.id <> m.id
--              and o.profile_id is not null and o.role = 'admin') then
--         select o.id into heir from members o
--         where o.playgroup_id = m.playgroup_id and o.id <> m.id and o.profile_id is not null
--         order by coalesce(o.claimed_at, o.created_at), o.id limit 1;
--         update members set role = 'admin' where id = heir;
--       end if;
--       update members set profile_id = null, display_name = 'Ehemaliges Mitglied', claim_code = null,
--                          avatar_path = null, role = 'member', claimed_at = null
--       where id = m.id;
--       former := former || m.id;
--     end if;
--   end loop;
-- 
--   -- b) Ersteller von Gruppen (auch solchen, in denen das Konto nicht mehr Mitglied ist)
--   for gid in select id from playgroups where created_by = me loop
--     select o.profile_id into heir from members o
--     where o.playgroup_id = gid and o.profile_id is not null and o.profile_id <> me
--     order by (o.role = 'admin') desc, coalesce(o.claimed_at, o.created_at), o.id limit 1;
--     if heir is null then
--       perform public.purge_playgroup(gid);
--     else
--       update playgroups set created_by = heir where id = gid;
--     end if;
--   end loop;
-- 
--   -- c) Decks (nach a/b: Spiele mitgelöschter Gruppen zählen nicht mehr als Verwendung)
--   for d in select * from decks where owner_profile_id = me order by created_at, id loop
--     used := false;
--     -- Gruppen mit Verwendung, früheste zuerst
--     for gid in
--       select g.playgroup_id from (
--         select gp.game_id from game_players gp where gp.deck_id = d.id
--         union select r.game_id from deck_salt_ratings r where r.deck_id = d.id) u
--       join games g on g.id = u.game_id
--       group by g.playgroup_id
--       order by min(g.started_at), g.playgroup_id
--     loop
--       ph := null;
--       select x.id into ph from members x where x.id = any(former) and x.playgroup_id = gid;
--       if ph is null then
--         insert into members (playgroup_id, display_name) values (gid, 'Ehemaliges Mitglied') returning id into ph;
--         former := former || ph;
--       end if;
--       if not used then
--         -- Original: beide Besitzer-Spalten in EINEM update (check: genau einer gesetzt)
--         update decks set owner_profile_id = null, owner_member_id = ph, archived = true where id = d.id;
--         used := true;
--       else
--         -- Kopie aus der Zeile (alle Spalten, auch künftige), neuer Besitzer, archiviert
--         c := d;
--         c.id := gen_random_uuid();
--         c.owner_profile_id := null;
--         c.owner_member_id := ph;
--         c.archived := true;
--         c.version_of := null;
--         insert into decks select (c).*;
--         update game_players gp set deck_id = c.id
--           from games g where g.id = gp.game_id and g.playgroup_id = gid and gp.deck_id = d.id;
--         update deck_salt_ratings r set deck_id = c.id
--           from games g where g.id = r.game_id and g.playgroup_id = gid and r.deck_id = d.id;
--       end if;
--     end loop;
--     if not used then
--       update decks set version_of = null where version_of = d.id;
--       delete from decks where id = d.id;
--     end if;
--   end loop;
-- 
--   -- d) übrige Verweise auf das Profil
--   update members  set created_by = null where created_by = me;
--   update sessions set created_by = null where created_by = me;
--   update games    set created_by = null where created_by = me;
-- 
--   -- e) personenbezogene Protokollzeilen
--   delete from code_attempts where user_id = me;
-- 
--   -- f) Konto selbst (profiles fällt per on delete cascade)
--   delete from auth.users where id = me;
-- end $$;
-- create or replace function public.join_playgroup(p_code text)
-- returns public.members language plpgsql security definer set search_path = public as $$
-- declare gid uuid; m members; dn text;
-- begin
--   if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
--   if not public.code_rate_ok() then raise exception 'Zu viele Versuche. Bitte in einer Stunde nochmal.'; end if;
--   select playgroup_id into gid from playgroup_invites where code = upper(trim(p_code));
--   if gid is null then
--     insert into code_attempts (user_id, kind) values (auth.uid(), 'join');
--     return null;
--   end if;
--   select * into m from members where playgroup_id = gid and profile_id = auth.uid();
--   if m.id is not null then return m; end if;
--   select display_name into dn from profiles where id = auth.uid();
--   insert into members (playgroup_id, profile_id, display_name, created_by)
--   values (gid, auth.uid(), left(coalesce(dn, 'Neu'), 40), auth.uid()) returning * into m;
--   return m;
-- end $$;
-- drop function public.enter_playgroup(uuid);
-- drop function public.list_all_playgroups();
-- drop function public.leave_playgroup(uuid);
-- drop function public._member_detach(uuid);
-- drop function public._member_account_guard(public.members);
-- drop trigger ttg_gp_member_active on public.game_players;
-- drop function public.gp_member_active();
-- drop function public.restore_member(uuid);
-- drop function public.remove_member(uuid, text);
-- drop function public.member_removal_check(uuid);
-- drop function public._member_deletable(uuid);
-- drop function public._member_delete(uuid);
-- create or replace function public.can_see_deck(d public.decks)
-- returns boolean language sql stable security definer set search_path = public as $$
--   select
--     d.owner_profile_id = auth.uid()
--     or exists (
--       select 1 from members mine join members theirs on theirs.playgroup_id = mine.playgroup_id
--       where mine.profile_id = auth.uid()
--         and (theirs.profile_id = d.owner_profile_id or theirs.id = d.owner_member_id)
--     );
-- $$;
-- create or replace function public.can_edit_deck(d public.decks)
-- returns boolean language sql stable security definer set search_path = public as $$
--   select
--     d.owner_profile_id = auth.uid()
--     or exists (select 1 from members m where m.id = d.owner_member_id and m.profile_id is null and public.is_group_member(m.playgroup_id));
-- $$;
-- create or replace function public.can_write_avatar(obj_name text)
-- returns boolean language sql stable security definer set search_path = public as $$
--   select case (storage.foldername(obj_name))[1]
--     when 'profiles' then (storage.foldername(obj_name))[2] = auth.uid()::text
--     when 'members' then exists (
--       select 1 from public.members m
--       where m.id::text = (storage.foldername(obj_name))[2]
--         and m.profile_id is null
--         and public.is_group_member(m.playgroup_id))
--     else false end
-- $$;
-- alter policy mem_update on public.members using (
--   public.is_group_admin(playgroup_id) or (profile_id is null and public.is_group_member(playgroup_id)) or profile_id = auth.uid()
-- );
-- drop index public.game_players_deck_id_idx;
-- drop index public.members_group_former_profile_key;
-- alter table public.members drop constraint members_former_no_account, drop constraint members_removed_no_account;
-- alter table public.members drop column former_profile_id, drop column removed_by, drop column removed_at;
-- RÜCKWÄRTS-ENDE
-- ============================================================================
