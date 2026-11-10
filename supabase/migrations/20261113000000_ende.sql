-- ============================================================================
-- Tracking the Gathering · Etappe 4 „Spielende“
-- Stand: 13.11.2026 · Spec: Welle ttg-ende-statistik, Paket P14 (spec-p14-schema.md)
--
-- 1. rate_game(p_game, p_salt, p_fun, p_deck_rating, p_deck_salt, p_potg, p_potg_text):
--    einziger Schreibweg für Bewertungen. Nur angemeldete Konten (nicht anonym),
--    nur gewertete Spiele (finished), nur die EIGENE Bewertung, nur wer in diesem
--    Spiel saß. Kein p_member: niemand bewertet für andere, auch nicht für
--    Platzhalter (Entscheid E-A). Wiederholbar: ein zweiter Aufruf überschreibt.
-- 2. player_ratings / deck_salt_ratings / potg_votes: Policies pr_all/dsr_all/
--    potg_all weg, direkte insert/update/delete-Rechte für anon + authenticated weg;
--    Lesen unverändert (pr_select/dsr_select/potg_select, alle Mitglieder der
--    Gruppe sehen alle Bewertungen ihrer Gruppe).
-- 3. Ausführungsrechte rate_game: nicht für public/anon, nur authenticated.
-- 4. v_game_turn_times (security_invoker): Zugzeiten je Spiel und Spieler, nur
--    gewertete Spiele, Undo-Filter wie v_turn_times. Den seq-Wert des Zugende-
--    Ereignisses liest die View über die ganze Zeile (to_jsonb(e) ->> 'seq')
--    statt über die Spalte e.seq: gleiches Ergebnis (fehlt seq ⇒ NULL), aber die
--    View hängt nicht an der Spalte game_events.seq — der Rückwärts-Block von
--    20261111000000_spielen.sql (drop column seq) bleibt ausführbar und diese
--    Migration läuft auch auf einem Stand ohne spielen.sql (DB-Test D10/X2 dort).
--    v_turn_times bleibt unverändert.
-- 5. Storage game-photos: Policy photos_update (Foto ersetzen, upsert: true).
-- 6. games.note höchstens 500 Zeichen (games_note_len).
--
-- Nicht angefasst: finish_game, start_game, v_turn_times, v_deck_salt,
-- v_member_stats, v_deck_stats, direkte update-Rechte auf games/game_players
-- (wincon/note/photo_path schreibt der Client weiter direkt; Spalten-Grants =
-- eigenes späteres Härtungspaket). Definer-Funktionen (claim_member,
-- delete_my_account aus P12) schreiben die Bewertungstabellen weiter als Besitzer.
-- Bestandsdaten: bisher schreibt kein Client die drei Tabellen
-- (grep -rn "player_ratings\|deck_salt_ratings\|potg_votes" src = 0 Treffer);
-- die Migration löscht keine Zeilen. Vor dem Push prüfen:
--   select count(*) from player_ratings;                       -- erwartet 0
--   select count(*) from deck_salt_ratings;                    -- erwartet 0
--   select count(*) from potg_votes;                           -- erwartet 0
--   select count(*) from games where char_length(note) > 500;  -- erwartet 0
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bewerten
-- p_salt, p_fun, p_deck_rating: je null oder 1–5; alle drei null ⇒ eigene
--   Bewertung löschen, sonst genau diese Werte speichern (null überschreibt).
-- p_deck_salt: null ⇒ unverändert; sonst { "<deck_id>": 1..5, … } für Decks der
--   ANDEREN Spieler dieses Spiels; ersetzt alle eigenen Deck-Salz-Zeilen des
--   Spiels ({} ⇒ alle eigenen löschen).
-- p_potg: null ⇒ eigene Stimme löschen (Text wird ignoriert); sonst ein Spieler
--   dieses Spiels (Selbstwahl erlaubt). p_potg_text getrimmt, leer ⇒ null, ≤ 200.
-- ---------------------------------------------------------------------------
create or replace function public.rate_game(
  p_game uuid, p_salt int, p_fun int, p_deck_rating int,
  p_deck_salt jsonb, p_potg uuid, p_potg_text text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g games; me uuid; my_deck uuid; r record; d uuid; txt text;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;

  select * into g from games where id = p_game;
  if g.id is null then raise exception 'Spiel ist nicht gewertet'; end if;
  -- eigenes Mitglied in GENAU der Gruppe dieses Spiels (Konto in mehreren Gruppen);
  -- vor der Statusprüfung, damit Fremde den Status eines Spiels nicht erfahren
  select m.id into me from members m where m.playgroup_id = g.playgroup_id and m.profile_id = auth.uid();
  if me is null then raise exception 'Nur Mitspieler können bewerten'; end if;
  if g.status <> 'finished' then raise exception 'Spiel ist nicht gewertet'; end if;
  -- Spieler dieses Spiels; for update: zwei gleichzeitige Aufrufe desselben
  -- Bewerters laufen nacheinander (delete + insert beim Deck-Salz)
  select gp.deck_id into my_deck from game_players gp where gp.game_id = p_game and gp.member_id = me for update;
  if not found then raise exception 'Nur Mitspieler können bewerten'; end if;

  if (p_salt is not null and p_salt not between 1 and 5)
     or (p_fun is not null and p_fun not between 1 and 5)
     or (p_deck_rating is not null and p_deck_rating not between 1 and 5) then
    raise exception 'Bewertung muss zwischen 1 und 5 liegen';
  end if;

  if p_deck_salt is not null then
    if jsonb_typeof(p_deck_salt) <> 'object' then raise exception 'Deck-Salz ungültig'; end if;
    for r in select key, value from jsonb_each(p_deck_salt) loop
      if r.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Deck nicht in diesem Spiel';
      end if;
      d := r.key::uuid;
      if d = my_deck then raise exception 'Eigenes Deck nicht salzen'; end if;
      if not exists (select 1 from game_players gp where gp.game_id = p_game and gp.member_id <> me and gp.deck_id = d) then
        raise exception 'Deck nicht in diesem Spiel';
      end if;
      if jsonb_typeof(r.value) <> 'number' then raise exception 'Bewertung muss zwischen 1 und 5 liegen'; end if;
      if r.value::numeric not in (1, 2, 3, 4, 5) then raise exception 'Bewertung muss zwischen 1 und 5 liegen'; end if;
    end loop;
  end if;

  if p_potg is not null then
    if not exists (select 1 from game_players gp where gp.game_id = p_game and gp.member_id = p_potg) then
      raise exception 'Spieler nicht in diesem Spiel';
    end if;
    txt := nullif(regexp_replace(coalesce(p_potg_text, ''), '^\s+|\s+$', '', 'g'), '');
    if char_length(txt) > 200 then raise exception 'Text zu lang'; end if;
  end if;

  -- Schreiben (alles geprüft; ein Fehler oben rollt den ganzen Aufruf zurück)
  if p_salt is null and p_fun is null and p_deck_rating is null then
    delete from player_ratings where game_id = p_game and member_id = me;
  else
    insert into player_ratings (game_id, member_id, salt, fun, deck_rating)
    values (p_game, me, p_salt, p_fun, p_deck_rating)
    on conflict (game_id, member_id) do update
      set salt = excluded.salt, fun = excluded.fun, deck_rating = excluded.deck_rating;
  end if;

  if p_deck_salt is not null then
    delete from deck_salt_ratings where game_id = p_game and rater_id = me;
    insert into deck_salt_ratings (game_id, rater_id, deck_id, salt)
    select p_game, me, x.key::uuid, x.value::numeric::smallint from jsonb_each(p_deck_salt) x;
  end if;

  if p_potg is null then
    delete from potg_votes where game_id = p_game and voter_id = me;
  else
    insert into potg_votes (game_id, voter_id, voted_for, text)
    values (p_game, me, p_potg, txt)
    on conflict (game_id, voter_id) do update set voted_for = excluded.voted_for, text = excluded.text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Direkte Schreibwege zu, Lesen wie bisher
-- ---------------------------------------------------------------------------
drop policy if exists pr_all   on public.player_ratings;
drop policy if exists dsr_all  on public.deck_salt_ratings;
drop policy if exists potg_all on public.potg_votes;

revoke insert, update, delete on public.player_ratings, public.deck_salt_ratings, public.potg_votes
from anon, authenticated;

create policy pr_select on public.player_ratings for select
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
create policy dsr_select on public.deck_salt_ratings for select
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
create policy potg_select on public.potg_votes for select
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));

-- ---------------------------------------------------------------------------
-- 3. Ausführungsrechte
-- ---------------------------------------------------------------------------
revoke execute on function public.rate_game(uuid, int, int, int, jsonb, uuid, text) from public, anon;
grant execute on function public.rate_game(uuid, int, int, int, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Zugzeiten je Spiel (nur gewertete Spiele, rückgängig gemachte Zugenden zählen nicht)
-- ---------------------------------------------------------------------------
create or replace view public.v_game_turn_times with (security_invoker = true) as
select g.playgroup_id, e.game_id, e.actor as member_id,
       count(*)::int                                  as turns,
       sum((e.payload ->> 'seconds')::int)::int       as total_sec,
       max((e.payload ->> 'seconds')::int)            as longest_sec
from game_events e join games g on g.id = e.game_id
where g.status = 'finished' and e.type = 'turn_end' and e.payload ? 'seconds'
  and not exists (select 1 from game_events u where u.game_id = e.game_id and u.type = 'undo'
                  and ((u.payload ->> 'event_id')::bigint = e.id or (u.payload ->> 'seq')::int = (to_jsonb(e) ->> 'seq')::int))
group by g.playgroup_id, e.game_id, e.actor;

-- ---------------------------------------------------------------------------
-- 5. Foto ersetzen (upsert: true braucht update)
-- ---------------------------------------------------------------------------
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update
  using (bucket_id = 'game-photos' and public.is_group_member((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'game-photos' and public.is_group_member((storage.foldername(name))[1]::uuid));

-- ---------------------------------------------------------------------------
-- 6. Notiz-Länge
-- ---------------------------------------------------------------------------
alter table public.games add constraint games_note_len check (note is null or char_length(note) <= 500);

-- ============================================================================
-- Rückwärts (zum Zurücknehmen; Zeilen ohne „-- “ ausführen, Reihenfolge einhalten).
-- Kein Datenverlust (Bewertungen bleiben, nur die Schreibwege öffnen sich wieder).
-- Der DB-Test R1 (tests/db/ende.test.mjs) führt genau diesen Block aus.
-- RÜCKWÄRTS-BEGINN
-- alter table public.games drop constraint games_note_len;
-- drop policy photos_update on storage.objects;
-- drop view public.v_game_turn_times;
-- drop policy pr_select on public.player_ratings;
-- drop policy dsr_select on public.deck_salt_ratings;
-- drop policy potg_select on public.potg_votes;
-- grant insert, update, delete on public.player_ratings, public.deck_salt_ratings, public.potg_votes to anon, authenticated;
-- create policy pr_all on public.player_ratings for all
--   using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
--   with check (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
-- create policy dsr_all on public.deck_salt_ratings for all
--   using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
--   with check (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
-- create policy potg_all on public.potg_votes for all
--   using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
--   with check (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
-- drop function public.rate_game(uuid, int, int, int, jsonb, uuid, text);
-- RÜCKWÄRTS-ENDE
-- ============================================================================
