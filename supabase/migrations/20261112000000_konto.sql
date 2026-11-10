-- ============================================================================
-- Tracking the Gathering · Konto löschen (Welle ttg-spielen, Paket P12, spec-p12-konto.md)
-- Stand: 12.11.2026
--
-- 1. my_account_files(): Dateien, die der Client VOR dem Löschen per Storage-API
--    entfernt (eigene Profilbilder; bei Gruppen, die mitgelöscht werden, auch deren
--    Platzhalter-Bilder und Spielfotos). Grund: Supabase verbietet direktes DELETE auf
--    storage.objects per SQL (Trigger storage.protect_delete), und eine gelöschte Zeile
--    würde die Datei im Speicher ohnehin nicht entfernen. Die Storage-Policies erlauben
--    dem Konto genau diese Löschungen, solange es noch Mitglied ist. Fotos von Gruppen,
--    die bestehen bleiben, stehen nie in der Liste.
-- 1b. check_delete_my_account(): Probelauf. Führt delete_my_account() vollständig in
--    einem Savepoint aus und rollt ihn zurück (eigener SQLSTATE TTG01 als Signal, nur
--    dieser wird gefangen). Wirft denselben Fehler, an dem das echte Löschen scheitern
--    würde. Der Client ruft ihn VOR dem Datei-Löschen: scheitert er, wird keine Datei
--    gelöscht (Risiko 1, Befund B2). Reihenfolge im Client: Probelauf → Dateien → RPC.
-- 2. delete_my_account(): kein Parameter, wirkt nur auf auth.uid(); alles in EINER
--    Transaktion (Fehler irgendwo ⇒ nichts geändert):
--    a) je Mitgliedschaft: einziges Konto-Mitglied ⇒ Spiele der Gruppe löschen (sie
--       kaskadieren auf game_players/game_events/Bewertungen), dann die Gruppe.
--       Sonst: letzter Admin ⇒ am längsten dabei befindliches Konto-Mitglied wird Admin
--       („dabei seit“ = coalesce(claimed_at, created_at): bei übernommenen Platzhaltern
--       zählt die Übernahme, nicht das Anlegen des Platzhalters);
--       Mitgliedschaft wird „Ehemaliges Mitglied“ ohne Konto, Bild, Code (Rolle member).
--    b) playgroups.created_by (not null) geht auf den neuen/vorhandenen Admin bzw. ein
--       anderes Konto-Mitglied; hat die Gruppe keins mehr, wird sie mitgelöscht.
--    c) Decks: ohne Verwendung (game_players, deck_salt_ratings) gelöscht; mit Verwendung
--       archiviert, und zwar JE GRUPPE MIT VERWENDUNG GENAU EIN DECK (Spec-Nachtrag 2,
--       Befund B1): das Original geht an die ehemalige Mitgliedschaft in der Gruppe des
--       frühesten Spiels; für jede weitere Gruppe entsteht eine archivierte Kopie bei der
--       ehemaligen Mitgliedschaft dieser Gruppe, und game_players.deck_id sowie
--       deck_salt_ratings.deck_id der Spiele dieser Gruppe zeigen auf die Kopie. Fehlt die
--       Mitgliedschaft dort, entsteht ein Platzhalter „Ehemaliges Mitglied“ (einer je
--       Gruppe). So hängt kein Deck an zwei Gruppen: Mitglieder jeder Gruppe sehen „ihr“
--       Deck weiter (can_see_deck), und ein späteres purge_playgroup einer der Gruppen
--       stößt auf keinen Verweis aus einer anderen Gruppe.
--       Fremdschlüssel auf decks (vollständig aus allen Migrationen erhoben):
--       game_players.deck_id, deck_salt_ratings.deck_id, decks.version_of.
--       version_of: Kopien bekommen null (Versionskette bleibt beim Original);
--       Verweise auf gelöschte Decks werden geleert.
--    d) Fremdschlüssel ohne on delete auf profiles: members.created_by,
--       sessions.created_by, games.created_by ⇒ null (playgroups.created_by s. b).
--       Vollständig erhoben aus allen Migrationen: auf profiles verweisen nur
--       playgroups.created_by, members.profile_id (set null), members.created_by,
--       decks.owner_profile_id (cascade), sessions.created_by, games.created_by.
--    e) code_attempts des Kontos (kein FK, aber personenbezogen) löschen.
--    f) delete from auth.users (Profil fällt per Cascade).
-- 3. Ausführungsrechte: nur authenticated; anonyme Konten in der Funktion abgelehnt.
-- ============================================================================

create or replace function public.my_account_files()
returns table (bucket text, path text)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as id where auth.uid() is not null and not public.is_anon_user()),
  -- Gruppen, die beim Löschen mitgehen: kein anderes Konto-Mitglied
  solo as (
    select m.playgroup_id as gid from members m, me
    where m.profile_id = me.id
      and not exists (select 1 from members o where o.playgroup_id = m.playgroup_id
                      and o.profile_id is not null and o.profile_id <> me.id)
  )
  select o.bucket_id::text, o.name::text from storage.objects o, me
  where o.bucket_id = 'avatars' and o.name like 'profiles/' || me.id::text || '/%'
  union
  select o.bucket_id::text, o.name::text from storage.objects o
  join members x on x.profile_id is null and o.name like 'members/' || x.id::text || '/%'
  join solo s on s.gid = x.playgroup_id
  where o.bucket_id = 'avatars'
  union
  select o.bucket_id::text, o.name::text from storage.objects o
  join solo s on o.name like s.gid::text || '/%'
  where o.bucket_id = 'game-photos'
  order by 1, 2;
$$;

-- Gruppe samt Inhalt löschen. Spiele zuerst: game_players.member_id/deck_id haben
-- keine Kaskade (Absicht: ein entferntes Mitglied darf keine Historie löschen).
-- Nur aus delete_my_account() aufrufbar (kein execute für Client-Rollen).
create or replace function public.purge_playgroup(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from games where playgroup_id = p_group;
  -- Versionsverweise auf Platzhalter-Decks dieser Gruppe lösen (Decks fallen per Kaskade)
  update decks set version_of = null
  where version_of in (select d.id from decks d join members x on x.id = d.owner_member_id where x.playgroup_id = p_group);
  delete from playgroups where id = p_group;
end $$;

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

-- Probelauf (Befund B2): dieselbe Wirkung in einem Savepoint, dann zurückgerollt.
-- Nur das eigene Signal TTG01 wird gefangen; jeder echte Fehler kommt beim Client an.
create or replace function public.check_delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.delete_my_account();
    raise exception using errcode = 'TTG01', message = 'Probelauf ok';
  exception when sqlstate 'TTG01' then
    null;  -- Savepoint zurückgerollt: nichts geändert
  end;
end $$;

revoke execute on function public.my_account_files(), public.delete_my_account(), public.check_delete_my_account() from public, anon;
grant execute on function public.my_account_files(), public.delete_my_account(), public.check_delete_my_account() to authenticated;
-- Hilfe ohne eigene Prüfung: für keine Client-Rolle
revoke execute on function public.purge_playgroup(uuid) from public, anon, authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen, kein Datenverlust):
-- RÜCKWÄRTS-BEGINN
-- drop function public.check_delete_my_account();
-- drop function public.delete_my_account();
-- drop function public.purge_playgroup(uuid);
-- drop function public.my_account_files();
-- RÜCKWÄRTS-ENDE
-- ============================================================================
