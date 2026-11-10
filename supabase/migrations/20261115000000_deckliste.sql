-- ============================================================================
-- Tracking the Gathering · Decks 2 (Welle ttg-live-feinschliff-decks, Paket P1)
-- Deckliste je Deck: Tabelle deck_cards (aus ManaBox-Import, per Scryfall aufgelöst).
--
-- 1. deck_cards: eine Zeile je (Abschnitt, Scryfall-Druck); Kaskade mit dem Deck.
-- 2. RLS: nur Lesen, gleiche Sichtbarkeit wie das Deck (can_see_deck). Kein Insert/
--    Update/Delete/Truncate für Client-Rollen (auch auf Rechte-Ebene entzogen) —
--    geschrieben wird ausschließlich über replace_deck_cards().
-- 3. decks.cards_updated_at (Zeitpunkt des letzten Imports), decks.bracket_check
--    (Ergebnis des Bracket-Rechners, schreibt der Client per decks-Update; Policy
--    decks_update ⇒ nur wer das Deck bearbeiten darf).
-- 4. replace_deck_cards(p_deck, p_cards): prüft alles, dann löschen + schreiben in
--    EINER Transaktion; setzt cards_updated_at = now(), bracket_check = null.
--    Ungültige Eingabe ⇒ Ausnahme, Bestand unverändert.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabelle
-- ---------------------------------------------------------------------------
create table public.deck_cards (
  id               bigint generated always as identity primary key,
  deck_id          uuid not null references public.decks (id) on delete cascade,
  section          text not null check (section in ('commander', 'main')),
  qty              smallint not null check (qty between 1 and 99),
  name             text not null check (length(name) between 1 and 200),
  scryfall_id      uuid not null,
  oracle_id        uuid,
  set_code         text,
  collector_number text,
  type_line        text,
  mana_value       numeric,
  colors           text[] not null default '{}',
  color_identity   text[] not null default '{}',
  image_small      text,
  image_normal     text,
  game_changer     boolean not null default false,
  unique (deck_id, section, scryfall_id)
);
create index if not exists deck_cards_deck_idx on public.deck_cards (deck_id);

-- ---------------------------------------------------------------------------
-- 2. RLS: nur Select, Sichtbarkeit wie das Deck
-- ---------------------------------------------------------------------------
alter table public.deck_cards enable row level security;

create policy deck_cards_select on public.deck_cards for select to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_cards.deck_id and public.can_see_deck(d)));

-- Standardrechte (Supabase: „all“ für anon/authenticated) zurücknehmen; Lesen bleibt,
-- die Policy gilt nur für authenticated ⇒ anon liest 0 Zeilen.
revoke all on public.deck_cards from public, anon, authenticated;
grant select on public.deck_cards to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Spalten am Deck
-- ---------------------------------------------------------------------------
alter table public.decks
  add column if not exists cards_updated_at timestamptz,
  add column if not exists bracket_check jsonb;

-- ---------------------------------------------------------------------------
-- 4. Ersetzen der Deckliste
-- ---------------------------------------------------------------------------
-- Prüft ein Element; liefert den Namen des ersten ungültigen Feldes oder null.
-- Fehlende Schlüssel und JSON-null gelten bei optionalen Feldern als „leer“.
create or replace function public.deck_card_invalid(c jsonb)
returns text language sql immutable set search_path = public as $$
  with t as (
    select
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' as uuid_re,
      coalesce(jsonb_typeof(c -> 'section'), 'null') ts, coalesce(jsonb_typeof(c -> 'qty'), 'null') tq,
      coalesce(jsonb_typeof(c -> 'name'), 'null') tn, coalesce(jsonb_typeof(c -> 'scryfall_id'), 'null') tid,
      coalesce(jsonb_typeof(c -> 'oracle_id'), 'null') tor, coalesce(jsonb_typeof(c -> 'set_code'), 'null') tset,
      coalesce(jsonb_typeof(c -> 'collector_number'), 'null') tcn, coalesce(jsonb_typeof(c -> 'type_line'), 'null') ttl,
      coalesce(jsonb_typeof(c -> 'mana_value'), 'null') tmv, coalesce(jsonb_typeof(c -> 'colors'), 'null') tco,
      coalesce(jsonb_typeof(c -> 'color_identity'), 'null') tci, coalesce(jsonb_typeof(c -> 'image_small'), 'null') tis,
      coalesce(jsonb_typeof(c -> 'image_normal'), 'null') tin, coalesce(jsonb_typeof(c -> 'game_changer'), 'null') tgc
  )
  select case
    when jsonb_typeof(c) is distinct from 'object' then 'element'
    when not (ts = 'string' and c ->> 'section' in ('commander', 'main')) then 'section'
    -- Cast erst nach der Musterprüfung (AND garantiert keine Auswertungsreihenfolge)
    when not (case when tq = 'number' and c ->> 'qty' ~ '^[0-9]{1,2}$' then (c ->> 'qty')::int between 1 and 99 else false end) then 'qty'
    when not (tn = 'string' and char_length(c ->> 'name') between 1 and 200 and btrim(c ->> 'name') <> '') then 'name'
    when not (tid = 'string' and c ->> 'scryfall_id' ~ uuid_re) then 'scryfall_id'
    when not (tor = 'null' or (tor = 'string' and c ->> 'oracle_id' ~ uuid_re)) then 'oracle_id'
    when not (tset = 'null' or (tset = 'string' and char_length(c ->> 'set_code') <= 20)) then 'set_code'
    when not (tcn = 'null' or (tcn = 'string' and char_length(c ->> 'collector_number') <= 20)) then 'collector_number'
    when not (ttl = 'null' or (ttl = 'string' and char_length(c ->> 'type_line') <= 300)) then 'type_line'
    when not (tmv = 'null' or (tmv = 'number' and (c ->> 'mana_value')::numeric between 0 and 1000)) then 'mana_value'
    when not (tco = 'null' or (tco = 'array' and jsonb_array_length(c -> 'colors') <= 5 and not exists (
      select 1 from jsonb_array_elements(c -> 'colors') x
      where jsonb_typeof(x) <> 'string' or x #>> '{}' not in ('W', 'U', 'B', 'R', 'G')))) then 'colors'
    when not (tci = 'null' or (tci = 'array' and jsonb_array_length(c -> 'color_identity') <= 5 and not exists (
      select 1 from jsonb_array_elements(c -> 'color_identity') x
      where jsonb_typeof(x) <> 'string' or x #>> '{}' not in ('W', 'U', 'B', 'R', 'G')))) then 'color_identity'
    when not (tis = 'null' or (tis = 'string' and c ->> 'image_small' ~ '^https://' and char_length(c ->> 'image_small') <= 500)) then 'image_small'
    when not (tin = 'null' or (tin = 'string' and c ->> 'image_normal' ~ '^https://' and char_length(c ->> 'image_normal') <= 500)) then 'image_normal'
    when not (tgc in ('null', 'boolean')) then 'game_changer'
  end
  from t;
$$;

-- p_cards: JSON-Liste von Zeilen { section, qty, name, scryfall_id, oracle_id?, set_code?,
-- collector_number?, type_line?, mana_value?, colors?, color_identity?, image_small?,
-- image_normal?, game_changer? }. id/deck_id im Element werden ignoriert (es zählt p_deck).
-- Leere Liste [] leert die Deckliste. Rückgabe: Anzahl geschriebener Zeilen.
create or replace function public.replace_deck_cards(p_deck uuid, p_cards jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  d decks;
  c jsonb;
  i int := 0;
  bad text;
  dup text;
  n int;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  -- Zeilensperre: zwei gleichzeitige Importe desselben Decks laufen nacheinander
  select * into d from decks where id = p_deck for update;
  -- „is not true“: bei Platzhalter-Decks liefert can_edit_deck NULL statt false
  if d.id is null or public.can_edit_deck(d) is not true then raise exception 'Deck nicht gefunden'; end if;
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' then raise exception 'Ungültige Kartenliste'; end if;
  if jsonb_array_length(p_cards) > 250 then raise exception 'Zu viele Karten'; end if;

  for c in select e from jsonb_array_elements(p_cards) e loop
    i := i + 1;
    bad := public.deck_card_invalid(c);
    if bad = 'element' then raise exception 'Ungültige Karte %', i; end if;
    if bad is not null then raise exception 'Ungültige Karte %: %', i, bad; end if;
  end loop;

  if (select count(*) from jsonb_array_elements(p_cards) e where e ->> 'section' = 'commander') > 2 then
    raise exception 'Zu viele Commander';
  end if;
  select min(e ->> 'name') into dup from jsonb_array_elements(p_cards) e
  group by e ->> 'section', lower(e ->> 'scryfall_id') having count(*) > 1 limit 1;
  if dup is not null then raise exception 'Doppelte Karte: %', dup; end if;

  delete from deck_cards where deck_id = p_deck;
  insert into deck_cards (deck_id, section, qty, name, scryfall_id, oracle_id, set_code, collector_number,
                          type_line, mana_value, colors, color_identity, image_small, image_normal, game_changer)
  select p_deck, e ->> 'section', (e ->> 'qty')::smallint, e ->> 'name', (e ->> 'scryfall_id')::uuid,
         (e ->> 'oracle_id')::uuid, e ->> 'set_code', e ->> 'collector_number', e ->> 'type_line',
         (e ->> 'mana_value')::numeric,
         case when jsonb_typeof(e -> 'colors') = 'array' then array(select jsonb_array_elements_text(e -> 'colors')) else '{}' end,
         case when jsonb_typeof(e -> 'color_identity') = 'array' then array(select jsonb_array_elements_text(e -> 'color_identity')) else '{}' end,
         e ->> 'image_small', e ->> 'image_normal', coalesce((e ->> 'game_changer')::boolean, false)
  from jsonb_array_elements(p_cards) with ordinality t(e, o)
  order by o;
  get diagnostics n = row_count;

  -- neue Liste ⇒ alte Bracket-Prüfung veraltet
  update decks set cards_updated_at = now(), bracket_check = null where id = p_deck;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Ausführungsrechte
-- ---------------------------------------------------------------------------
revoke execute on function public.replace_deck_cards(uuid, jsonb) from public, anon;
grant execute on function public.replace_deck_cards(uuid, jsonb) to authenticated;
-- Prüfhilfe nur intern (aus replace_deck_cards)
revoke execute on function public.deck_card_invalid(jsonb) from public, anon, authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen; Zeilen ohne „-- “ ausführen, Reihenfolge einhalten).
-- Datenverlust: alle Decklisten (deck_cards) sowie decks.cards_updated_at/bracket_check.
-- drop function public.replace_deck_cards(uuid, jsonb);
-- drop function public.deck_card_invalid(jsonb);
-- drop table public.deck_cards;
-- alter table public.decks drop column bracket_check, drop column cards_updated_at;
-- ============================================================================
