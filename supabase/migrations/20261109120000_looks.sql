-- ============================================================================
-- Tracking the Gathering · Looks umbenannt (Design-Durchgang 09.11.2026)
-- Schiefer/Gletscher/Obsidian → Nacht/Arktis/Burgund. Standard: Nacht.
-- ============================================================================
alter table public.profiles drop constraint if exists profiles_theme_check;
update public.profiles set theme = case theme
  when 'schiefer' then 'nacht' when 'obsidian' then 'nacht' when 'gletscher' then 'arktis' else theme end;
alter table public.profiles alter column theme set default 'nacht';
alter table public.profiles add constraint profiles_theme_check check (theme in ('nacht', 'arktis', 'burgund'));
