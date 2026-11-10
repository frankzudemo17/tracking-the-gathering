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
--         Über start_game ist dieser Zustand nicht herstellbar (deck_in_group, seit
--         20261111000000_spielen.sql). Herstellbar ist er heute aber über die direkten
--         Schreibrechte auf deck_salt_ratings (Policy dsr_all prüft nur die Mitgliedschaft
--         in der Spielgruppe, nicht das Deck) und über Altdaten von vor spielen.sql.
--         20261113000000_ende.sql entzieht die direkten Schreibrechte und geht vor dieser
--         Migration auf Prod.
--      e) Mitglieder: purge_playgroup löscht auch die members von p_group; auf members
--         zeigen Fremdschlüssel OHNE Kaskade (game_players.member_id/eliminated_by,
--         game_events.actor/source/target, player_ratings.member_id,
--         deck_salt_ratings.rater_id, potg_votes.voter_id/voted_for). Steht einer davon in
--         einem Spiel einer ANDEREN Gruppe (Altdaten, direkte Schreibrechte pr_all/potg_all
--         bis ende.sql), scheitert purge_playgroup am Fremdschlüssel. Das prüft NICHT der
--         Guard, sondern der Probelauf in playgroup_files (2.) und meldet es als
--         'member_used_elsewhere'. Der Probelauf fängt so jede Fremdschlüssel-Klasse, auch
--         künftige.
-- 2. playgroup_files(p_group): Dateien, die der Client VOR dem Löschen per Storage-API
--    entfernt (Muster my_account_files, E3-P12: nach dem Löschen greifen die
--    Storage-Policies nicht mehr, SQL darf storage.objects nicht löschen). Gleiche
--    Vorprüfung wie delete_playgroup (ohne Namen), danach ein PROBELAUF: purge_playgroup
--    im Unterblock ausführen und zurückrollen (Muster check_delete_my_account, eigener
--    SQLSTATE TTG01 als Signal). Ein Fremdschlüssel-Fehler daraus ⇒ 'member_used_elsewhere',
--    jeder andere Fehler wird weitergeworfen. So scheitert playgroup_files immer dann, wenn
--    delete_playgroup mit richtigem Namen scheitern würde, und zwar vor dem ersten
--    Storage-Aufruf. Der Probelauf hinterlässt keine Änderung (Unterblock zurückgerollt;
--    die Zeilensperre aus dem Guard liegt davor und bleibt bis zum Ende der Transaktion).
--    Liefert Bilder der Mitglieder ohne Konto (avatars, members/<id>/…) und die
--    Spielfotos (game-photos, <gid>/…).
-- 3. delete_playgroup(p_group, p_name): Vorprüfung, dann Name (getrimmt, Groß-/Klein-
--    schreibung egal; NULL/leer ⇒ Fehler), dann purge_playgroup. Eine Transaktion.
--    Ein Fremdschlüssel-Fehler aus purge_playgroup ⇒ ebenfalls 'member_used_elsewhere'.
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
  -- Probelauf (B1): purge_playgroup ausführen und zurückrollen
  begin
    perform public.purge_playgroup(p_group);
    raise exception using errcode = 'TTG01', message = 'Probelauf ok';
  exception
    when sqlstate 'TTG01' then
      null;  -- Unterblock zurückgerollt: nichts geändert
    when foreign_key_violation then
      raise exception 'member_used_elsewhere'
        using hint = 'Spiele einer anderen Gruppe verweisen auf Mitglieder dieser Gruppe.';
  end;
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
  begin
    perform public.purge_playgroup(p_group);
  exception when foreign_key_violation then
    raise exception 'member_used_elsewhere'
      using hint = 'Spiele einer anderen Gruppe verweisen auf Mitglieder dieser Gruppe.';
  end;
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
