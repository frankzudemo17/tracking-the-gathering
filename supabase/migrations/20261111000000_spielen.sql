-- ============================================================================
-- Tracking the Gathering · Etappe 3 „Spielen“
-- Stand: 11.11.2026 · Spec: Welle ttg-spielen, Paket P4 (spec-p4-schema.md)
--
-- 1. game_events.seq (vom Client vergeben, nullable) + unique (game_id, seq):
--    Wiederholung nach Netzfehler legt keine Dublette an (Upsert ignoreDuplicates),
--    Undo kann per seq auf ein Ereignis zeigen, dessen Server-id noch unbekannt ist.
-- 2. v_damage_matrix: Undo per payload.event_id ODER payload.seq.
--    v_turn_times: bekommt denselben Undo-Filter (vorher zählte ein rückgängig
--    gemachtes Zugende mit). Spalten und Namen beider Views unverändert.
-- 3. start_game(...): Spieleabend finden/anlegen, Spiel und alle Spieler in einer
--    Transaktion; prüft Mitgliedschaft, 2–6 Spieler, Sitze, Decks, Startleben.
-- 4. finish_game(...): Spiel werten (finished, Plätze 1..n) oder verwerfen (aborted).
-- 5. set_deck_field_color(...) / set_deck_counter_pins(...): Feldfarbe und Zähler-Pins
--    eines Decks dürfen alle angemeldeten Mitspieler setzen, die das Deck sehen;
--    direktes UPDATE auf decks bleibt Besitzer-only.
-- 6. ev_insert: Quelle/Ziel müssen Spieler DIESES Spiels sein, actor Mitglied der
--    Spielgruppe (vorher reichte irgendein Mitglied irgendeiner Gruppe).
-- 7. gp_valid prüft zusätzlich das Deck (Deck eines Mitglieds der Spielgruppe);
--    neue Signatur mit 4 Argumenten, gp_insert/gp_update neu, alte Funktion weg.
-- 8. Ausführungsrechte der neuen RPCs: nicht für public/anon, nur authenticated.
--
-- Nicht angefasst: direkte insert/update-Rechte auf games, Realtime, Storage.
-- Bestandsdaten: vor Etappe 3 legt kein Client Spiele an; vor dem Push prüfen:
--   select count(*) from games;   -- erwartet 0
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ereignis-Reihenfolge vom Client
-- ---------------------------------------------------------------------------
alter table public.game_events add column seq integer;
-- Kein Partial-Index: nur ein echter unique constraint passt zu
-- PostgREST onConflict 'game_id,seq'. NULLs (Bestand) kollidieren nicht.
alter table public.game_events add constraint game_events_game_seq_key unique (game_id, seq);

-- ---------------------------------------------------------------------------
-- 2. Views mit Undo per seq (security_invoker erneut setzen: create or replace
--    übernimmt die Option sonst nicht verlässlich)
-- ---------------------------------------------------------------------------
create or replace view public.v_turn_times with (security_invoker = true) as
select g.playgroup_id, e.actor as member_id,
       round(avg((e.payload ->> 'seconds')::numeric)) as avg_turn_sec,
       max((e.payload ->> 'seconds')::int)            as longest_turn_sec,
       count(*)::int                                  as turns
from game_events e join games g on g.id = e.game_id
where e.type = 'turn_end' and e.payload ? 'seconds'
  and not exists (select 1 from game_events u where u.game_id = e.game_id and u.type = 'undo'
                  and ((u.payload ->> 'event_id')::bigint = e.id or (u.payload ->> 'seq')::int = e.seq))
group by g.playgroup_id, e.actor;

create or replace view public.v_damage_matrix with (security_invoker = true) as
select e.game_id, e.source, e.target,
       sum(e.amount) filter (where e.type in ('damage', 'cmd_damage'))::int as damage,
       sum(e.amount) filter (where e.type = 'cmd_damage')::int              as commander_damage,
       sum(e.amount) filter (where e.type = 'poison')::int                  as poison
from game_events e
where e.source is not null and e.target is not null
  and e.type in ('damage', 'cmd_damage', 'poison')
  and not exists (select 1 from game_events u where u.game_id = e.game_id and u.type = 'undo'
                  and ((u.payload ->> 'event_id')::bigint = e.id or (u.payload ->> 'seq')::int = e.seq))
group by e.game_id, e.source, e.target;

-- ---------------------------------------------------------------------------
-- Hilfe: gehört das Deck einem Mitglied der Gruppe? (Konto-Deck: Besitzer ist
-- Mitglied; Platzhalter-Deck: Platzhalter ist Mitglied). Ohne eigene
-- Mitgliedsprüfung ⇒ nur aus Definer-Funktionen nutzbar, kein execute für Rollen.
-- ---------------------------------------------------------------------------
create or replace function public.deck_in_group(p_deck uuid, p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from decks d join members m on m.playgroup_id = p_group
      and ((d.owner_profile_id is not null and m.profile_id = d.owner_profile_id) or m.id = d.owner_member_id)
    where d.id = p_deck);
$$;

-- ---------------------------------------------------------------------------
-- 3. Spiel starten
-- p_players: [{ "member_id": uuid, "deck_id": uuid, "seat": int }, …]
-- ---------------------------------------------------------------------------
create or replace function public.start_game(
  p_group uuid, p_layout public.table_layout, p_starting_life int,
  p_first_seat int, p_players jsonb, p_played_on date)
returns public.games language plpgsql security definer set search_path = public as $$
declare
  n int; ok_n int; sid uuid; g games;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if p_group is null or not public.is_group_member(p_group) then raise exception 'Kein Mitglied dieser Gruppe'; end if;

  if p_players is null or jsonb_typeof(p_players) <> 'array' then raise exception 'Ein Spiel braucht 2 bis 6 Spieler'; end if;
  n := jsonb_array_length(p_players);
  if n not between 2 and 6 then raise exception 'Ein Spiel braucht 2 bis 6 Spieler'; end if;

  -- Sitze 0..n-1 je genau einmal (NULL zählt nicht als gültig)
  select count(distinct s) into ok_n
  from (select (x ->> 'seat')::int s from jsonb_array_elements(p_players) x) t
  where s between 0 and n - 1;
  if ok_n is distinct from n then raise exception 'Jeder Sitzplatz muss genau einmal vergeben sein'; end if;

  -- verschiedene Mitglieder, alle aus p_group
  select count(distinct m.id) into ok_n
  from jsonb_array_elements(p_players) x
  join members m on m.id = (x ->> 'member_id')::uuid and m.playgroup_id = p_group;
  if ok_n is distinct from n then raise exception 'Spieler müssen verschiedene Mitglieder dieser Gruppe sein'; end if;

  -- jeder hat ein Deck …
  if exists (select 1 from jsonb_array_elements(p_players) x where (x ->> 'deck_id') is null) then
    raise exception 'Jeder Spieler braucht ein Deck';
  end if;
  -- … das nicht archiviert ist und einem Mitglied dieser Gruppe gehört (Leihdecks erlaubt)
  select count(*) into ok_n
  from jsonb_array_elements(p_players) x
  join decks d on d.id = (x ->> 'deck_id')::uuid and not d.archived
  where public.deck_in_group(d.id, p_group);
  if ok_n is distinct from n then raise exception 'Deck nicht verfügbar'; end if;

  if p_starting_life is null or p_starting_life not between 5 and 99 then
    raise exception 'Startleben muss zwischen 5 und 99 liegen';
  end if;
  if p_first_seat is null or p_first_seat not between 0 and n - 1 then raise exception 'Ungültiger Startspieler'; end if;
  if p_layout is null then raise exception 'Tischlayout fehlt'; end if;

  -- Spieleabend: jüngste Session DIESER Gruppe, deren jüngstes Spiel vor < 6 h startete
  select s.id into sid
  from sessions s join games x on x.session_id = s.id and x.playgroup_id = p_group
  where s.playgroup_id = p_group
  group by s.id, s.created_at
  having max(x.started_at) > now() - interval '6 hours'
  order by s.created_at desc
  limit 1;
  if sid is null then
    insert into sessions (playgroup_id, played_on, created_by)
    values (p_group, coalesce(p_played_on, current_date), auth.uid()) returning id into sid;
  end if;

  insert into games (playgroup_id, session_id, status, layout, starting_life, first_seat, current_turn, round, created_by)
  values (p_group, sid, 'live', p_layout, p_starting_life, p_first_seat, p_first_seat, 1, auth.uid())
  returning * into g;

  insert into game_players (game_id, member_id, deck_id, seat)
  select g.id, (x ->> 'member_id')::uuid, (x ->> 'deck_id')::uuid, (x ->> 'seat')::int
  from jsonb_array_elements(p_players) x;

  return g;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Spiel beenden
-- p_results (nur bei finished): [{ "member_id", "place", "eliminated_round",
--   "eliminated_by", "final_life" }, …] – jeder Spieler des Spiels genau einmal.
-- ---------------------------------------------------------------------------
create or replace function public.finish_game(
  p_game uuid, p_status public.game_status, p_round int, p_results jsonb)
returns public.games language plpgsql security definer set search_path = public as $$
declare
  g games; n int; ok_n int;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  -- for update: zwei gleichzeitige Aufrufe sehen nicht beide „live“
  select * into g from games where id = p_game for update;
  if g.id is null or not public.is_group_member(g.playgroup_id) then raise exception 'Spiel nicht gefunden'; end if;
  if g.status <> 'live' then raise exception 'Spiel ist bereits beendet'; end if;
  if p_status is null or p_status not in ('finished', 'aborted') then raise exception 'Ungültiger Spielstatus'; end if;
  if p_round is null or p_round not between 1 and 32767 then raise exception 'Ungültige Runde'; end if;

  if p_status = 'finished' then
    select count(*) into n from game_players where game_id = p_game;
    if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) <> n then
      raise exception 'Ergebnis muss jeden Spieler genau einmal enthalten';
    end if;
    select count(distinct gp.member_id) into ok_n
    from jsonb_array_elements(p_results) x
    join game_players gp on gp.game_id = p_game and gp.member_id = (x ->> 'member_id')::uuid;
    if ok_n is distinct from n then raise exception 'Ergebnis muss jeden Spieler genau einmal enthalten'; end if;

    select count(distinct pl) into ok_n
    from (select (x ->> 'place')::int pl from jsonb_array_elements(p_results) x) t
    where pl between 1 and n;
    if ok_n is distinct from n then raise exception 'Plätze müssen 1 bis % je genau einmal sein', n; end if;

    if exists (select 1 from jsonb_array_elements(p_results) x
               where (x ->> 'eliminated_round') is not null and (x ->> 'eliminated_round')::int < 1) then
      raise exception 'Ungültige Ausscheide-Runde';
    end if;
    if exists (select 1 from jsonb_array_elements(p_results) x
               where (x ->> 'eliminated_by') is not null
                 and ((x ->> 'eliminated_by')::uuid = (x ->> 'member_id')::uuid
                      or not exists (select 1 from game_players k
                                     where k.game_id = p_game and k.member_id = (x ->> 'eliminated_by')::uuid))) then
      raise exception 'Ungültiger Verursacher';
    end if;

    update game_players gp set
      place            = (x ->> 'place')::int,
      eliminated_round = (x ->> 'eliminated_round')::int,
      eliminated_by    = (x ->> 'eliminated_by')::uuid,
      final_life       = (x ->> 'final_life')::int
    from jsonb_array_elements(p_results) x
    where gp.game_id = p_game and gp.member_id = (x ->> 'member_id')::uuid;
  end if;

  update games set status = p_status, ended_at = now(), round = p_round
  where id = p_game returning * into g;
  return g;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Feldfarbe und Zähler-Pins eines Decks (HANDOFF 5.4/5.4a: pro Deck gespeichert)
-- Erlaubt: wer das Deck bearbeiten darf ODER (angemeldet, nicht anonym, und das
-- Deck sehen darf = teilt eine Gruppe mit dem Besitzer). Anonyme Konten nie
-- (Abnahme X1). Ändert nur die eine Spalte.
-- ---------------------------------------------------------------------------
create or replace function public.set_deck_field_color(p_deck uuid, p_color text)
returns public.decks language plpgsql security definer set search_path = public as $$
declare d decks;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  select * into d from decks where id = p_deck;
  if d.id is null or not (public.can_edit_deck(d) or public.can_see_deck(d)) then raise exception 'Deck nicht gefunden'; end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Ungültige Farbe'; end if;
  update decks set field_color = p_color where id = p_deck returning * into d;
  return d;
end $$;

create or replace function public.set_deck_counter_pins(p_deck uuid, p_pins text[])
returns public.decks language plpgsql security definer set search_path = public as $$
declare d decks; clean text[];
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  select * into d from decks where id = p_deck;
  if d.id is null or not (public.can_edit_deck(d) or public.can_see_deck(d)) then raise exception 'Deck nicht gefunden'; end if;
  if p_pins is null then raise exception 'Ungültiger Zähler'; end if;
  -- positiv geprüft: NULL-Einträge gelten als ungültig
  if exists (select 1 from unnest(p_pins) p
             where p is null or p not in ('poison', 'tax', 'tax2', 'energy', 'exp', 'rad', 'speed', 'ring', 'dungeon')) then
    raise exception 'Ungültiger Zähler';
  end if;
  -- Dubletten entfernen, erste Position zählt
  select coalesce(array_agg(p order by o), '{}') into clean
  from (select p, min(o) o from unnest(p_pins) with ordinality t(p, o) group by p) u;
  update decks set counter_pins = clean where id = p_deck returning * into d;
  return d;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Ereignisse: nur in laufende Spiele der eigenen Gruppe, Quelle/Ziel Spieler
--    dieses Spiels, actor Mitglied der Spielgruppe
-- ---------------------------------------------------------------------------
create or replace function public.ev_valid(p_game uuid, p_actor uuid, p_source uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g
    where g.id = p_game and g.status = 'live' and public.is_group_member(g.playgroup_id)
      and (p_source is null or exists (select 1 from game_players s where s.game_id = g.id and s.member_id = p_source))
      and (p_target is null or exists (select 1 from game_players t where t.game_id = g.id and t.member_id = p_target))
      and (p_actor  is null or exists (select 1 from members a where a.id = p_actor and a.playgroup_id = g.playgroup_id)));
$$;

drop policy if exists ev_insert on public.game_events;
create policy ev_insert on public.game_events for insert
  with check (public.ev_valid(game_id, actor, source, target));

-- ---------------------------------------------------------------------------
-- 7. Spieler im Spiel: zusätzlich Deck prüfen
-- ---------------------------------------------------------------------------
create or replace function public.gp_valid(p_game uuid, p_member uuid, p_elim uuid, p_deck uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g join members m on m.id = p_member and m.playgroup_id = g.playgroup_id
    where g.id = p_game and public.is_group_member(g.playgroup_id))
  and (p_elim is null or exists (
    select 1 from games g join members e on e.id = p_elim and e.playgroup_id = g.playgroup_id
    where g.id = p_game))
  and (p_deck is null or exists (
    select 1 from games g where g.id = p_game and public.deck_in_group(p_deck, g.playgroup_id)));
$$;

drop policy if exists gp_insert on public.game_players;
drop policy if exists gp_update on public.game_players;
create policy gp_insert on public.game_players for insert
  with check (public.gp_valid(game_id, member_id, eliminated_by, deck_id));
create policy gp_update on public.game_players for update
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
  with check (public.gp_valid(game_id, member_id, eliminated_by, deck_id));
drop function public.gp_valid(uuid, uuid, uuid);

-- ---------------------------------------------------------------------------
-- 8. Ausführungsrechte
-- ---------------------------------------------------------------------------
revoke execute on function
  public.start_game(uuid, public.table_layout, int, int, jsonb, date),
  public.finish_game(uuid, public.game_status, int, jsonb),
  public.set_deck_field_color(uuid, text),
  public.set_deck_counter_pins(uuid, text[])
from public, anon;

grant execute on function
  public.start_game(uuid, public.table_layout, int, int, jsonb, date),
  public.finish_game(uuid, public.game_status, int, jsonb),
  public.set_deck_field_color(uuid, text),
  public.set_deck_counter_pins(uuid, text[])
to authenticated;

-- Hilfe ohne eigene Mitgliedsprüfung: für keine Client-Rolle ausführbar
revoke execute on function public.deck_in_group(uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen; Zeilen ohne „-- “ ausführen, Reihenfolge einhalten).
-- Datenverlust: nur die Spalte game_events.seq (Inhalt geht verloren).
-- Der DB-Test X2 führt genau diesen Block aus.
-- RÜCKWÄRTS-BEGINN
-- create or replace function public.gp_valid(p_game uuid, p_member uuid, p_elim uuid)
-- returns boolean language sql stable security definer set search_path = public as $$
--   select exists (
--     select 1 from games g join members m on m.id = p_member and m.playgroup_id = g.playgroup_id
--     where g.id = p_game and public.is_group_member(g.playgroup_id))
--   and (p_elim is null or exists (
--     select 1 from games g join members e on e.id = p_elim and e.playgroup_id = g.playgroup_id
--     where g.id = p_game));
-- $$;
-- drop policy if exists gp_insert on public.game_players;
-- drop policy if exists gp_update on public.game_players;
-- create policy gp_insert on public.game_players for insert
--   with check (public.gp_valid(game_id, member_id, eliminated_by));
-- create policy gp_update on public.game_players for update
--   using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
--   with check (public.gp_valid(game_id, member_id, eliminated_by));
-- drop function public.gp_valid(uuid, uuid, uuid, uuid);
-- drop policy if exists ev_insert on public.game_events;
-- create policy ev_insert on public.game_events for insert
--   with check (exists (select 1 from games g where g.id = game_id and g.status = 'live' and public.is_group_member(g.playgroup_id)));
-- drop function public.ev_valid(uuid, uuid, uuid, uuid);
-- drop function public.set_deck_counter_pins(uuid, text[]);
-- drop function public.set_deck_field_color(uuid, text);
-- drop function public.finish_game(uuid, public.game_status, int, jsonb);
-- drop function public.start_game(uuid, public.table_layout, int, int, jsonb, date);
-- drop function public.deck_in_group(uuid, uuid);
-- create or replace view public.v_turn_times with (security_invoker = true) as
-- select g.playgroup_id, e.actor as member_id,
--        round(avg((e.payload ->> 'seconds')::numeric)) as avg_turn_sec,
--        max((e.payload ->> 'seconds')::int)            as longest_turn_sec,
--        count(*)::int                                  as turns
-- from game_events e join games g on g.id = e.game_id
-- where e.type = 'turn_end' and e.payload ? 'seconds'
-- group by g.playgroup_id, e.actor;
-- create or replace view public.v_damage_matrix with (security_invoker = true) as
-- select e.game_id, e.source, e.target,
--        sum(e.amount) filter (where e.type in ('damage', 'cmd_damage'))::int as damage,
--        sum(e.amount) filter (where e.type = 'cmd_damage')::int              as commander_damage,
--        sum(e.amount) filter (where e.type = 'poison')::int                  as poison
-- from game_events e
-- where e.source is not null and e.target is not null
--   and e.type in ('damage', 'cmd_damage', 'poison')
--   and not exists (select 1 from game_events u where u.game_id = e.game_id and u.type = 'undo' and (u.payload ->> 'event_id')::bigint = e.id)
-- group by e.game_id, e.source, e.target;
-- alter table public.game_events drop constraint game_events_game_seq_key;
-- alter table public.game_events drop column seq;  -- Datenverlust: seq-Werte
-- RÜCKWÄRTS-ENDE
-- ============================================================================
