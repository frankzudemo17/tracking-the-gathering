-- ============================================================================
-- Tracking the Gathering · Mitglieder (Welle ttg-live-feinschliff-decks, Paket P10,
-- spec-p10-mitglieder.md) · Stand: 17.11.2026
--
-- A. Schema: members.removed_at, removed_by, former_profile_id. Eine entfernte Zeile hat nie
--    ein Konto (Checks) ⇒ is_group_member/is_group_admin/my_member_id bleiben unverändert und
--    schließen Entfernte von selbst aus. Die Spaltenfreigabe aus 20261109000000_sicherheit.sql
--    (update display_name, avatar_path) bleibt ⇒ die neuen Spalten setzt nur eine Funktion.
--    Index game_players(deck_id) für den neuen Zweig in can_see_deck.
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
  if m.profile_id is not null then raise exception 'member_has_account'; end if;
  mode := case when m.removed_at is not null then 'already'
               when public._member_deletable(m.id) then 'delete' else 'mark' end;
  return jsonb_build_object(
    'mode', mode,
    'games', (select count(distinct gp.game_id) from game_players gp where gp.member_id = m.id),
    'live_games', (select count(distinct gp.game_id) from game_players gp join games g on g.id = gp.game_id
                   where gp.member_id = m.id and g.status = 'live'),
    'decks', (select count(*) from decks d where d.owner_member_id = m.id),
    'files', coalesce((select jsonb_agg(o.name order by o.name) from storage.objects o
                       where o.bucket_id = 'avatars' and o.name like 'members/' || m.id::text || '/%'), '[]'::jsonb));
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
  if m.profile_id is not null then raise exception 'member_has_account'; end if;
  if m.removed_at is not null then return jsonb_build_object('result', 'already'); end if;
  mode := case when public._member_deletable(m.id) then 'delete' else 'mark' end;
  if p_expect is distinct from mode then raise exception 'member_state_changed'; end if;
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
-- Ausführungsrechte (neue Funktionen bekommen per Default-Privileges anon + authenticated)
-- ---------------------------------------------------------------------------
revoke execute on function public.member_removal_check(uuid), public.remove_member(uuid, text),
  public.restore_member(uuid) from public, anon;
grant execute on function public.member_removal_check(uuid), public.remove_member(uuid, text),
  public.restore_member(uuid) to authenticated;
-- interne Hilfen: für keine Client-Rolle
revoke execute on function public._member_delete(uuid), public._member_deletable(uuid), public.gp_member_active()
  from public, anon, authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen):
-- RÜCKWÄRTS-BEGINN
-- drop trigger ttg_gp_member_active on public.game_players;
-- drop function public.gp_member_active();
-- drop function public.restore_member(uuid);
-- drop function public.remove_member(uuid, text);
-- drop function public.member_removal_check(uuid);
-- drop function public._member_deletable(uuid);
-- drop function public._member_delete(uuid);
-- drop index public.game_players_deck_id_idx;
-- drop index public.members_group_former_profile_key;
-- alter table public.members drop constraint members_former_no_account, drop constraint members_removed_no_account;
-- alter table public.members drop column former_profile_id, drop column removed_by, drop column removed_at;
-- RÜCKWÄRTS-ENDE
-- ============================================================================
