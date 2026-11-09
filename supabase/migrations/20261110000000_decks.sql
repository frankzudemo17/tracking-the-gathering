-- ============================================================================
-- Tracking the Gathering · Etappe 2 Decks
-- Bild des Partner-Commanders (Scryfall art_crop), damit Partner-Decks beide
-- Commander zeigen. Das Bild des ersten Commanders steht in image_url.
-- ============================================================================
alter table public.decks add column if not exists partner_image_url text;
alter table public.decks add constraint decks_short_name_len check (length(short_name) between 1 and 80);
alter table public.decks add constraint decks_commander_name_len check (length(commander_name) between 1 and 200);
create index if not exists decks_owner_profile_idx on public.decks (owner_profile_id);
create index if not exists decks_owner_member_idx on public.decks (owner_member_id);
