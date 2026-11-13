-- ============================================================================
-- Tracking the Gathering · App-Angaben nur für Angemeldete (Welle ttg-features, Paket P10 Impressum)
-- Zweck: Texte, die nicht im öffentlichen Repo und nicht im öffentlichen App-Code stehen sollen, liegen in der
-- Datenbank. Heute genau ein Schlüssel: „impressum“ (mehrzeiliger Text für die Abschnitte „Impressum“ und
-- „Verantwortlich“). Die Migration legt keine Zeile an; die Zeile trägt der Betreiber nach dem db push selbst ein.
--
-- Regel: Lesen nur für angemeldete, nicht anonyme Konten (Policy app_info_select, to authenticated,
-- not public.is_anon_user()). Rolle anon hat kein Recht auf die Tabelle. Schreiben (insert/update/delete) nur
-- als Datenbank-Eigentümer: keine Schreib-Policy und kein Schreib-Grant für anon/authenticated, daher nie aus der App.
--
-- Übergang: additiv (neue Tabelle, nichts an Bestandstabellen). Die App liest app_info mit maybeSingle();
-- vor dem db push antwortet die Schnittstelle 404 und die App zeigt den neutralen Satz.
-- ============================================================================

create table public.app_info (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  value text not null check (char_length(value) between 1 and 2000),
  updated_at timestamptz not null default now()
);

alter table public.app_info enable row level security;

revoke all on public.app_info from anon, authenticated;
grant select on public.app_info to authenticated;

create policy app_info_select on public.app_info
  for select to authenticated
  using (not public.is_anon_user());

-- ============================================================================
-- Rückwärts (zum Zurücknehmen; Zeilen ohne „-- “ ausführen).
-- Preis: der Impressum-Text geht verloren; die App zeigt danach den neutralen Satz.
-- RÜCKWÄRTS-BEGINN
-- drop table public.app_info;
-- RÜCKWÄRTS-ENDE
-- ============================================================================
