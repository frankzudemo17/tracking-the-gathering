-- ============================================================================
-- Tracking the Gathering · Gruppe löschen (Welle ttg-live-feinschliff-decks, Paket P3,
-- spec-p3-gruppe.md Block A) · Stand: 15.11.2026
--
-- Baut auf purge_playgroup(p_group) aus 20261112000000_konto.sql (E3-P12) auf — die
-- Löschreihenfolge (erst Spiele, dann Gruppe; game_players.member_id/deck_id ohne
-- Kaskade) steht dort und wird hier NICHT nachgebaut.
--
-- 1. _playgroup_delete_guard(p_group): gemeinsame Vorprüfung, intern (kein execute für
--    Client-Rollen). Reihenfolge:
--      a) angemeldet und nicht anonym                    ⇒ sonst 'Nicht angemeldet'
--      b) Gruppenzeile FOR UPDATE sperren, Existenz      ⇒ sonst 'Gruppe nicht gefunden'
--         (Doppelklick / zwei Admins gleichzeitig: der zweite Aufruf wartet hier und findet
--         danach keine Zeile mehr. Existenz VOR Admin, sonst käme beim zweiten Aufruf
--         „Nur Admins …“, weil die Mitgliedschaft schon weg ist.)
--      c) Admin der Gruppe                               ⇒ sonst 'Nur Admins dürfen die Gruppe löschen'
--      d) Leihdeck: ein Deck, das einem Mitglied OHNE Konto dieser Gruppe gehört
--         (owner_member_id; fällt mit der Gruppe per Kaskade), wird in einem Spiel einer
--         ANDEREN Gruppe verwendet (game_players.deck_id oder deck_salt_ratings.deck_id —
--         die einzigen Fremdschlüssel auf decks ohne Kaskade außer decks.version_of, den
--         purge_playgroup selbst löst) ⇒ 'deck_used_elsewhere'. Die Historie der anderen
--         Gruppe bleibt geschützt, nichts wird gelöscht.
--         Über start_game ist dieser Zustand heute nicht herstellbar (deck_in_group, seit
--         20261111000000_spielen.sql); Altdaten von vorher oder künftige Pfade fängt die
--         Prüfung als klare Meldung ab statt als Fremdschlüssel-Fehler.
-- 2. playgroup_files(p_group): Dateien, die der Client VOR dem Löschen per Storage-API
--    entfernt (Muster my_account_files, E3-P12: nach dem Löschen greifen die
--    Storage-Policies nicht mehr, SQL darf storage.objects nicht löschen). Gleiche
--    Vorprüfung wie delete_playgroup (ohne Namen) ⇒ ein Abbruch passiert vor dem ersten
--    Storage-Aufruf. Liefert Bilder der Mitglieder ohne Konto (avatars, members/<id>/…)
--    und die Spielfotos (game-photos, <gid>/…).
-- 3. delete_playgroup(p_group, p_name): Vorprüfung, dann Name (getrimmt, Groß-/Klein-
--    schreibung egal; NULL/leer ⇒ Fehler), dann purge_playgroup. Eine Transaktion.
--    Konto-Decks der Mitglieder bleiben (nur ihre Verwendung in Spielen dieser Gruppe
--    entfällt mit den Spielen); Decks der Spieler ohne Konto fallen per Kaskade.
-- 4. Ausführungsrechte: delete_playgroup/playgroup_files nur authenticated, Guard für
--    keine Client-Rolle.
-- ============================================================================

create or replace function public._playgroup_delete_guard(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  perform 1 from playgroups where id = p_group for update;
  if not found then raise exception 'Gruppe nicht gefunden'; end if;
  if not public.is_group_admin(p_group) then raise exception 'Nur Admins dürfen die Gruppe löschen'; end if;
  if exists (
    select 1
    from decks d
    join members x on x.id = d.owner_member_id and x.playgroup_id = p_group
    where exists (select 1 from game_players gp join games g on g.id = gp.game_id
                  where gp.deck_id = d.id and g.playgroup_id <> p_group)
       or exists (select 1 from deck_salt_ratings r join games g on g.id = r.game_id
                  where r.deck_id = d.id and g.playgroup_id <> p_group)
  ) then
    raise exception 'deck_used_elsewhere'
      using hint = 'Ein Deck eines Spielers ohne Konto dieser Gruppe kommt in Spielen einer anderen Gruppe vor.';
  end if;
end $$;

create or replace function public.playgroup_files(p_group uuid)
returns table (bucket text, path text)
language plpgsql security definer set search_path = public as $$
begin
  perform public._playgroup_delete_guard(p_group);
  return query
    select o.bucket_id::text, o.name::text from storage.objects o
    join members x on x.playgroup_id = p_group and x.profile_id is null
                  and o.name like 'members/' || x.id::text || '/%'
    where o.bucket_id = 'avatars'
    union
    select o.bucket_id::text, o.name::text from storage.objects o
    where o.bucket_id = 'game-photos' and o.name like p_group::text || '/%'
    order by 1, 2;
end $$;

create or replace function public.delete_playgroup(p_group uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  nm text;
begin
  perform public._playgroup_delete_guard(p_group);
  select name into nm from playgroups where id = p_group;
  if nullif(lower(btrim(p_name)), '') is distinct from lower(btrim(nm)) then
    raise exception 'Name stimmt nicht';
  end if;
  perform public.purge_playgroup(p_group);
end $$;

revoke execute on function public.delete_playgroup(uuid, text), public.playgroup_files(uuid) from public, anon;
grant execute on function public.delete_playgroup(uuid, text), public.playgroup_files(uuid) to authenticated;
revoke execute on function public._playgroup_delete_guard(uuid) from public, anon, authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen, kein Datenverlust):
-- RÜCKWÄRTS-BEGINN
-- drop function public.delete_playgroup(uuid, text);
-- drop function public.playgroup_files(uuid);
-- drop function public._playgroup_delete_guard(uuid);
-- RÜCKWÄRTS-ENDE
-- ============================================================================
