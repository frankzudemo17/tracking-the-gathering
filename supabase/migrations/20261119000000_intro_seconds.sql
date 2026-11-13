-- ============================================================================
-- Tracking the Gathering · Intro-Dauer je Gruppe (Welle ttg-features, Paket P8, spec-p8-intro2.md)
-- Stand: 19.11.2026
--
-- Zweck: Wie lange jede Commander-Karte im Spielstart-Intro liegen bleibt (Liegezeit nach der
-- Landung; der Anflug von knapp einer Sekunde kommt dazu), stellt die Gruppe ein, nicht das Gerät.
-- Der Wert gilt für alle Geräte der Gruppe ab dem nächsten Spielstart.
--
-- Regel: playgroups.intro_seconds, ganze Sekunden 2–10, Standard 4 (smallint not null default 4,
-- Check playgroups_intro_seconds_check). Bestehende Gruppen bekommen 4; ADD COLUMN mit
-- konstantem Default ist eine reine Metadaten-Änderung, der Check prüft die Tabelle einmal.
--
-- Rechte-Weg: Lesen wie die Gruppe (Tabellenrecht + Policy pg_select = Mitglieder der Gruppe).
-- Schreiben NUR über public.set_intro_seconds(p_group, p_seconds) (security definer):
--   Gruppen-Admin oder Superadmin (auch ohne Mitgliedschaft), sonst not_group_admin;
--   die Rechte werden VOR dem Bereich geprüft (eine fremde Gruppe erfährt nichts über ihn);
--   außerhalb 2–10 ⇒ intro_seconds_range; unbekannte Gruppe ⇒ 'Gruppe nicht gefunden'.
-- Keine neue Policy, keine Änderung an pg_update, kein Spalten-Grant: die Spaltenfreigabe
-- aus 20261109000000_sicherheit.sql (grant update (name)) bleibt die einzige direkte
-- Schreibfreigabe auf playgroups ⇒ ein direktes UPDATE der Spalte scheitert für jede
-- Client-Rolle mit „permission denied“. Ausführen dürfen nur angemeldete Konten.
--
-- Übergang: die App liest die Spalte nur aus select('*') bzw. playgroups(*); fehlt sie
-- (App neu, Datenbank alt), gilt 4 s und die Einstellung ist nicht sichtbar. Alte App +
-- neue Datenbank: die Spalte wird ignoriert.
-- ============================================================================

alter table public.playgroups add column if not exists intro_seconds smallint not null default 4;
alter table public.playgroups add constraint playgroups_intro_seconds_check check (intro_seconds between 2 and 10);

create or replace function public.set_intro_seconds(p_group uuid, p_seconds int)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or public.is_anon_user() then raise exception 'Nicht angemeldet'; end if;
  if not (public.is_group_admin(p_group) or public.is_superadmin()) then raise exception 'not_group_admin'; end if;
  if p_seconds is null or p_seconds not between 2 and 10 then raise exception 'intro_seconds_range'; end if;
  update playgroups set intro_seconds = p_seconds where id = p_group;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Gruppe nicht gefunden'; end if;
  return p_seconds;
end $$;

-- Ausführungsrechte (neue Funktionen bekommen per Default-Privileges anon + authenticated)
revoke execute on function public.set_intro_seconds(uuid, int) from public, anon;
grant execute on function public.set_intro_seconds(uuid, int) to authenticated;

-- ============================================================================
-- Rückwärts (zum Zurücknehmen). Preis: eingestellte Zeiten gehen verloren; die App fällt
-- auf 4 s zurück (ohne Spalte keine Einstellung in der Verwaltung).
-- RÜCKWÄRTS-BEGINN
-- drop function if exists public.set_intro_seconds(uuid, int);
-- alter table public.playgroups drop constraint if exists playgroups_intro_seconds_check;
-- alter table public.playgroups drop column if exists intro_seconds;
-- RÜCKWÄRTS-ENDE
-- ============================================================================
