-- ============================================================================
-- Tracking the Gathering · Grundschema
-- Stand: 06.11.2026 · aus dem Mockup abgeleitet (siehe HANDOFF.md)
-- Ausführen mit: supabase db push
-- ============================================================================

-- gen_random_uuid() ist ab Postgres 13 eingebaut, keine Extension nötig

-- ---------------------------------------------------------------------------
-- Typen
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'member');
create type public.game_status as enum ('live', 'finished', 'aborted');
create type public.table_layout as enum ('seiten', 'rundum', 'gegenueber', 'unten');
create type public.win_condition as enum ('kampfschaden', 'commander', 'kombo', 'gift', 'alternativ', 'aufgabe');
create type public.event_type as enum (
  'life',          -- Lebensänderung per Tippen (ohne Quelle)
  'damage',        -- Schaden mit Quelle (Angriff per Ziehen)
  'cmd_damage',    -- Commander-Schaden mit Quelle (payload.partner = true für Partner 2)
  'poison',        -- Gift mit Quelle
  'lifelink',      -- Lebensgewinn durch Lifelink
  'counter',       -- sonstige Zähler: energy, exp, tax, tax2, rad, speed, ring, dungeon
  'flag',          -- monarch, initiative, city
  'global',        -- daynight, storm
  'turn_end',      -- payload.seconds = Zugdauer
  'eliminate',     -- target ausgeschieden, source = Verursacher (null = aufgegeben)
  'roll',          -- Würfeltisch: payload = { kind: w6|w6x2|w20|coin|start, values: [...], winner_seat? }
  'undo'           -- macht payload.event_id rückgängig
);

-- ---------------------------------------------------------------------------
-- Profile (1:1 zu auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  locale       text not null default 'de' check (locale in ('de', 'en')),
  theme        text not null default 'schiefer' check (theme in ('schiefer', 'gletscher', 'obsidian')),
  avatar_path  text,  -- Storage-Bucket avatars: profiles/<profile_id>/avatar.jpg
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'Gast'), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Playgroups und Mitglieder
-- Ein Mitglied ohne profile_id ist ein „Spieler ohne Konto“ (Platzhalter).
-- Über claim_code kann sich die Person später registrieren und übernehmen.
-- ---------------------------------------------------------------------------
create or replace function public.short_code(prefix text)
returns text language sql volatile as $$
  select prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
$$;

create table public.playgroups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 60),
  invite_code text not null unique default public.short_code('TTG'),
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

create table public.members (
  id           uuid primary key default gen_random_uuid(),
  playgroup_id uuid not null references public.playgroups (id) on delete cascade,
  profile_id   uuid references public.profiles (id) on delete set null,
  display_name text not null check (length(display_name) between 1 and 40),
  role         public.member_role not null default 'member',
  claim_code   text unique,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  avatar_path  text,  -- nur für Spieler ohne Konto: members/<member_id>/avatar.jpg
  unique (playgroup_id, profile_id)
);
create index on public.members (profile_id);

-- Hilfsfunktionen für RLS (security definer, damit keine Rekursion entsteht)
create or replace function public.is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.playgroup_id = gid and m.profile_id = auth.uid());
$$;

create or replace function public.is_group_admin(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.playgroup_id = gid and m.profile_id = auth.uid() and m.role = 'admin');
$$;

create or replace function public.my_member_id(gid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.id from members m where m.playgroup_id = gid and m.profile_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Decks
-- Gehört entweder einem Konto (owner_profile_id, gilt in allen Gruppen)
-- oder einem Spieler ohne Konto (owner_member_id). Beim Claim wird umgehängt.
-- ---------------------------------------------------------------------------
create table public.decks (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles (id) on delete cascade,
  owner_member_id  uuid references public.members (id) on delete cascade,
  commander_name   text not null,
  partner_name     text,
  short_name       text not null,
  scryfall_ids     text[] not null default '{}',
  image_url        text,
  color_identity   text[] not null default '{}' check (color_identity <@ array['W','U','B','R','G']),
  bracket          smallint not null default 3 check (bracket between 1 and 5),
  list_url         text check (list_url is null or list_url ~ '^https?://'),
  field_color      text check (field_color is null or field_color ~ '^#[0-9A-Fa-f]{6}$'),  -- null = Commander-Farben
  counter_pins     text[] not null default array['poison','tax'],
  version_of       uuid references public.decks (id),
  version_label    text,
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  check ((owner_profile_id is not null) <> (owner_member_id is not null))
);

-- Darf ich dieses Deck sehen? (eigenes, oder Besitzer teilt eine Gruppe mit mir)
create or replace function public.can_see_deck(d public.decks)
returns boolean language sql stable security definer set search_path = public as $$
  select
    d.owner_profile_id = auth.uid()
    or exists (
      select 1 from members mine join members theirs on theirs.playgroup_id = mine.playgroup_id
      where mine.profile_id = auth.uid()
        and (theirs.profile_id = d.owner_profile_id or theirs.id = d.owner_member_id)
    );
$$;

create or replace function public.can_edit_deck(d public.decks)
returns boolean language sql stable security definer set search_path = public as $$
  select
    d.owner_profile_id = auth.uid()
    or exists (select 1 from members m where m.id = d.owner_member_id and m.profile_id is null and public.is_group_member(m.playgroup_id));
$$;

-- ---------------------------------------------------------------------------
-- Spieleabende, Spiele, Spieler im Spiel
-- ---------------------------------------------------------------------------
create table public.sessions (
  id           uuid primary key default gen_random_uuid(),
  playgroup_id uuid not null references public.playgroups (id) on delete cascade,
  played_on    date not null default current_date,
  location     text,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);

create table public.games (
  id             uuid primary key default gen_random_uuid(),
  playgroup_id   uuid not null references public.playgroups (id) on delete cascade,
  session_id     uuid references public.sessions (id) on delete set null,
  status         public.game_status not null default 'live',
  layout         public.table_layout not null default 'seiten',
  starting_life  smallint not null default 40,
  first_seat     smallint not null default 0,
  current_turn   smallint not null default 0,
  round          smallint not null default 1,
  live_state     jsonb not null default '{}'::jsonb,  -- kompletter Lifecounter-Zustand für Live-Sync
  wincon         public.win_condition,
  note           text,
  photo_path     text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  created_by     uuid references public.profiles (id)
);
create index on public.games (playgroup_id, started_at desc);

create table public.game_players (
  game_id          uuid not null references public.games (id) on delete cascade,
  member_id        uuid not null references public.members (id),
  deck_id          uuid references public.decks (id),
  seat             smallint not null,
  place            smallint,
  eliminated_round smallint,
  eliminated_by    uuid references public.members (id),
  final_life       smallint,
  mulligans        smallint,
  primary key (game_id, member_id),
  unique (game_id, seat)
);

-- Jede Aktion am Tisch als Ereignis. Grundlage für Verlauf, Rückgängig,
-- „wer hat wem geschadet“, Zugdauer und Statistiken.
create table public.game_events (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references public.games (id) on delete cascade,
  round      smallint not null,
  type       public.event_type not null,
  actor      uuid references public.members (id),   -- wer hat es eingetragen
  source     uuid references public.members (id),   -- Verursacher (Angreifer)
  target     uuid references public.members (id),   -- Betroffener
  amount     integer,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.game_events (game_id, id);

-- ---------------------------------------------------------------------------
-- Bewertungen am Spielende
-- ---------------------------------------------------------------------------
create table public.player_ratings (
  game_id     uuid not null references public.games (id) on delete cascade,
  member_id   uuid not null references public.members (id),
  salt        smallint check (salt between 1 and 5),
  fun         smallint check (fun between 1 and 5),
  deck_rating smallint check (deck_rating between 1 and 5),
  primary key (game_id, member_id)
);

-- Optionale Bewertung: wie salty hat mich jedes gegnerische Deck gemacht?
create table public.deck_salt_ratings (
  game_id   uuid not null references public.games (id) on delete cascade,
  rater_id  uuid not null references public.members (id),
  deck_id   uuid not null references public.decks (id),
  salt      smallint not null check (salt between 1 and 5),
  primary key (game_id, rater_id, deck_id)
);

-- Play of the Game
create table public.potg_votes (
  game_id    uuid not null references public.games (id) on delete cascade,
  voter_id   uuid not null references public.members (id),
  voted_for  uuid not null references public.members (id),
  text       text check (length(text) <= 200),
  primary key (game_id, voter_id)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.playgroups        enable row level security;
alter table public.members           enable row level security;
alter table public.decks             enable row level security;
alter table public.sessions          enable row level security;
alter table public.games             enable row level security;
alter table public.game_players      enable row level security;
alter table public.game_events       enable row level security;
alter table public.player_ratings    enable row level security;
alter table public.deck_salt_ratings enable row level security;
alter table public.potg_votes        enable row level security;

-- Profile: sich selbst voll, andere nur wenn man eine Gruppe teilt
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from members a join members b on a.playgroup_id = b.playgroup_id
    where a.profile_id = auth.uid() and b.profile_id = profiles.id)
);
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Playgroups
create policy pg_select on public.playgroups for select using (public.is_group_member(id));
create policy pg_update on public.playgroups for update using (public.is_group_admin(id));
create policy pg_delete on public.playgroups for delete using (public.is_group_admin(id));
-- Anlegen nur über rpc create_playgroup

-- Mitglieder
create policy mem_select on public.members for select using (public.is_group_member(playgroup_id));
create policy mem_insert on public.members for insert with check (
  public.is_group_member(playgroup_id) and profile_id is null   -- nur Spieler ohne Konto direkt anlegen
);
create policy mem_update on public.members for update using (
  public.is_group_admin(playgroup_id) or (profile_id is null and public.is_group_member(playgroup_id)) or profile_id = auth.uid()
);
create policy mem_delete on public.members for delete using (public.is_group_admin(playgroup_id));

-- Decks
create policy decks_select on public.decks for select using (public.can_see_deck(decks));
create policy decks_insert on public.decks for insert with check (public.can_edit_deck(decks));
create policy decks_update on public.decks for update using (public.can_edit_deck(decks));
create policy decks_delete on public.decks for delete using (public.can_edit_deck(decks));

-- Alles rund ums Spiel: Mitglieder der Gruppe dürfen lesen und schreiben
create policy ses_all on public.sessions for all
  using (public.is_group_member(playgroup_id)) with check (public.is_group_member(playgroup_id));
create policy games_all on public.games for all
  using (public.is_group_member(playgroup_id)) with check (public.is_group_member(playgroup_id));

create policy gp_all on public.game_players for all
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
  with check (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
create policy ev_select on public.game_events for select
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
create policy ev_insert on public.game_events for insert
  with check (exists (select 1 from games g where g.id = game_id and g.status = 'live' and public.is_group_member(g.playgroup_id)));

create policy pr_all on public.player_ratings for all
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
  with check (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
create policy dsr_all on public.deck_salt_ratings for all
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
  with check (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));
create policy potg_all on public.potg_votes for all
  using (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)))
  with check (exists (select 1 from games g where g.id = game_id and public.is_group_member(g.playgroup_id)));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_playgroup(p_name text)
returns public.playgroups language plpgsql security definer set search_path = public as $$
declare g playgroups; dn text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select display_name into dn from profiles where id = auth.uid();
  insert into playgroups (name, created_by) values (p_name, auth.uid()) returning * into g;
  insert into members (playgroup_id, profile_id, display_name, role, created_by)
  values (g.id, auth.uid(), coalesce(dn, 'Ich'), 'admin', auth.uid());
  return g;
end $$;

create or replace function public.join_playgroup(p_code text)
returns public.members language plpgsql security definer set search_path = public as $$
declare g playgroups; m members; dn text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into g from playgroups where invite_code = upper(trim(p_code));
  if g.id is null then raise exception 'Code nicht gefunden'; end if;
  select * into m from members where playgroup_id = g.id and profile_id = auth.uid();
  if m.id is not null then return m; end if;
  select display_name into dn from profiles where id = auth.uid();
  insert into members (playgroup_id, profile_id, display_name, created_by)
  values (g.id, auth.uid(), coalesce(dn, 'Neu'), auth.uid()) returning * into m;
  return m;
end $$;

-- Spieler ohne Konto anlegen (mit eigenem Übernahme-Code)
create or replace function public.create_placeholder(p_group uuid, p_name text)
returns public.members language plpgsql security definer set search_path = public as $$
declare m members; prefix text;
begin
  if not public.is_group_member(p_group) then raise exception 'Kein Mitglied dieser Gruppe'; end if;
  prefix := upper(left(regexp_replace(p_name, '[^A-Za-zÄÖÜäöü]', '', 'g'), 4));
  if prefix = '' then prefix := 'GAST'; end if;
  insert into members (playgroup_id, display_name, claim_code, created_by)
  values (p_group, p_name, public.short_code(prefix), auth.uid()) returning * into m;
  return m;
end $$;

-- Platzhalter übernehmen: Profil verknüpfen, Decks aufs Konto umhängen.
-- Ist die Person schon Mitglied der Gruppe (z. B. per Einladungscode beigetreten),
-- wird die komplette Historie des Platzhalters auf ihre Mitgliedschaft übertragen.
create or replace function public.claim_member(p_code text)
returns public.members language plpgsql security definer set search_path = public as $$
declare ph members; me members;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into ph from members where claim_code = upper(trim(p_code)) and profile_id is null;
  if ph.id is null then raise exception 'Code ungültig oder schon benutzt'; end if;
  update decks set owner_profile_id = auth.uid(), owner_member_id = null where owner_member_id = ph.id;
  update profiles set avatar_path = coalesce(avatar_path, ph.avatar_path) where id = auth.uid();  -- Bild vom Platzhalter übernehmen
  select * into me from members where playgroup_id = ph.playgroup_id and profile_id = auth.uid();
  if me.id is null then
    update members set profile_id = auth.uid(), claimed_at = now(), claim_code = null where id = ph.id returning * into me;
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

grant execute on function public.create_playgroup(text), public.join_playgroup(text),
  public.create_placeholder(uuid, text), public.claim_member(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Punkte und Statistik-Views (security_invoker: RLS gilt auch hier)
-- Punkte: 4 Spieler 4/2/1/0 · 5 Spieler 5/3/2/1/0 · 6 Spieler 6/4/3/2/1/0
-- (bei 3 Spielern 3/1/0, bei 2 Spielern 2/0) – noch mit Franco bestätigen
-- ---------------------------------------------------------------------------
create or replace function public.place_points(n int, place int)
returns int language sql immutable as $$
  select case
    when place is null then 0
    when place = 1 then n
    else greatest(0, n - place)
  end;
$$;

create view public.v_game_results with (security_invoker = true) as
select gp.*, g.playgroup_id, g.session_id, g.started_at, g.ended_at, g.wincon,
       (select count(*) from game_players x where x.game_id = gp.game_id)::int as n_players,
       public.place_points((select count(*) from game_players x where x.game_id = gp.game_id)::int, gp.place) as points
from game_players gp join games g on g.id = gp.game_id
where g.status = 'finished';

create view public.v_member_stats with (security_invoker = true) as
select r.playgroup_id, r.member_id,
       count(*)::int                          as games,
       count(*) filter (where r.place = 1)::int as wins,
       sum(r.points)::int                     as points,
       round(avg(r.place), 2)                 as avg_place,
       round(avg(pr.salt), 2)                 as avg_salt,
       round(avg(pr.fun), 2)                  as avg_fun,
       round(avg(pr.deck_rating), 2)          as avg_deck_rating
from v_game_results r
left join player_ratings pr on pr.game_id = r.game_id and pr.member_id = r.member_id
group by r.playgroup_id, r.member_id;

create view public.v_deck_stats with (security_invoker = true) as
select r.playgroup_id, r.deck_id,
       count(*)::int                            as games,
       count(*) filter (where r.place = 1)::int as wins,
       sum(r.points)::int                       as points,
       round(avg(r.place), 2)                   as avg_place,
       round(avg(pr.deck_rating), 2)            as avg_own_rating,
       round(avg(pr.fun), 2)                    as avg_fun
from v_game_results r
left join player_ratings pr on pr.game_id = r.game_id and pr.member_id = r.member_id
where r.deck_id is not null
group by r.playgroup_id, r.deck_id;

-- Zugdauer pro Spieler aus den turn_end-Ereignissen
create view public.v_turn_times with (security_invoker = true) as
select g.playgroup_id, e.actor as member_id,
       round(avg((e.payload ->> 'seconds')::numeric)) as avg_turn_sec,
       max((e.payload ->> 'seconds')::int)            as longest_turn_sec,
       count(*)::int                                  as turns
from game_events e join games g on g.id = e.game_id
where e.type = 'turn_end' and e.payload ? 'seconds'
group by g.playgroup_id, e.actor;

-- Salzigste Decks:
-- 1) direkte Deck-Bewertungen zählen
-- 2) hat ein Spieler in einem Spiel KEINE Deck-Bewertung abgegeben, geht sein
--    eigener Salt-Wert an das Deck des Spielers, der ihn rausgenommen hat
create view public.v_deck_salt with (security_invoker = true) as
with direct as (
  select g.playgroup_id, d.deck_id, d.salt, d.rater_id
  from deck_salt_ratings d join games g on g.id = d.game_id
),
fallback as (
  select g.playgroup_id, killer.deck_id, pr.salt, victim.member_id as rater_id
  from game_players victim
  join games g on g.id = victim.game_id and g.status = 'finished'
  join game_players killer on killer.game_id = victim.game_id and killer.member_id = victim.eliminated_by
  join player_ratings pr on pr.game_id = victim.game_id and pr.member_id = victim.member_id and pr.salt is not null
  where not exists (select 1 from deck_salt_ratings d where d.game_id = victim.game_id and d.rater_id = victim.member_id)
    and killer.deck_id is not null
),
alls as (select * from direct union all select * from fallback)
select playgroup_id, deck_id, round(avg(salt), 2) as avg_salt, count(*)::int as ratings,
       (select a2.rater_id from alls a2 where a2.deck_id = alls.deck_id and a2.playgroup_id = alls.playgroup_id
        group by a2.rater_id order by sum(a2.salt) desc limit 1) as most_salted_member
from alls
group by playgroup_id, deck_id;

-- Wer hat wem wie viel Schaden gemacht (für Spielende und Head-to-Head)
create view public.v_damage_matrix with (security_invoker = true) as
select e.game_id, e.source, e.target,
       sum(e.amount) filter (where e.type in ('damage', 'cmd_damage'))::int as damage,
       sum(e.amount) filter (where e.type = 'cmd_damage')::int              as commander_damage,
       sum(e.amount) filter (where e.type = 'poison')::int                  as poison
from game_events e
where e.source is not null and e.target is not null
  and e.type in ('damage', 'cmd_damage', 'poison')
  and not exists (select 1 from game_events u where u.game_id = e.game_id and u.type = 'undo' and (u.payload ->> 'event_id')::bigint = e.id)
group by e.game_id, e.source, e.target;

-- ---------------------------------------------------------------------------
-- Realtime (Live-Sync am Tisch)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.games, public.game_events;

-- ---------------------------------------------------------------------------
-- Storage: Fotos vom Spieltisch, Pfad = <playgroup_id>/<game_id>.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('game-photos', 'game-photos', false)
on conflict (id) do nothing;

create policy photos_read on storage.objects for select
  using (bucket_id = 'game-photos' and public.is_group_member((storage.foldername(name))[1]::uuid));
create policy photos_write on storage.objects for insert
  with check (bucket_id = 'game-photos' and public.is_group_member((storage.foldername(name))[1]::uuid));
create policy photos_delete on storage.objects for delete
  using (bucket_id = 'game-photos' and public.is_group_member((storage.foldername(name))[1]::uuid));

-- ---------------------------------------------------------------------------
-- Storage: Profilbilder (256x256 JPEG, rund zugeschnitten im Client)
--   profiles/<profile_id>/avatar.jpg  -> nur der Besitzer schreibt
--   members/<member_id>/avatar.jpg    -> Spieler ohne Konto: jedes Gruppenmitglied darf setzen
-- Lesen: alle angemeldeten Nutzer (Bilder sind nicht geheim, Pfade nicht erratbar)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create or replace function public.can_write_avatar(obj_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case (storage.foldername(obj_name))[1]
    when 'profiles' then (storage.foldername(obj_name))[2] = auth.uid()::text
    when 'members' then exists (
      select 1 from public.members m
      where m.id::text = (storage.foldername(obj_name))[2]
        and m.profile_id is null
        and public.is_group_member(m.playgroup_id))
    else false end
$$;

create policy avatars_read on storage.objects for select
  using (bucket_id = 'avatars' and auth.uid() is not null);
create policy avatars_insert on storage.objects for insert
  with check (bucket_id = 'avatars' and public.can_write_avatar(name));
create policy avatars_update on storage.objects for update
  using (bucket_id = 'avatars' and public.can_write_avatar(name));
create policy avatars_delete on storage.objects for delete
  using (bucket_id = 'avatars' and public.can_write_avatar(name));
