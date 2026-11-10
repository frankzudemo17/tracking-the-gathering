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

-- ============================================================================
-- Rückwärts (zum Zurücknehmen):
-- RÜCKWÄRTS-BEGINN
-- drop index public.game_players_deck_id_idx;
-- drop index public.members_group_former_profile_key;
-- alter table public.members drop constraint members_former_no_account, drop constraint members_removed_no_account;
-- alter table public.members drop column former_profile_id, drop column removed_by, drop column removed_at;
-- RÜCKWÄRTS-ENDE
-- ============================================================================
