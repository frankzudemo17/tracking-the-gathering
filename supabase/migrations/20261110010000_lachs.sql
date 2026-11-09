-- ============================================================================
-- Tracking the Gathering · Look „Burgund“ durch „Lachs“ ersetzt (Franco, 09.11.2026)
-- ============================================================================
alter table public.profiles drop constraint if exists profiles_theme_check;
update public.profiles set theme = 'lachs' where theme = 'burgund';
alter table public.profiles add constraint profiles_theme_check check (theme in ('nacht', 'arktis', 'lachs'));
