-- ============================================================================
-- Tracking the Gathering · Deck-Motto (Welle ttg-features, Paket P3 Spielstart-Intro)
-- Zweck: ein optionaler kurzer Satz je Deck, den das Spielstart-Intro unter den Fakten zeigt
-- (ohne Motto zeigt das Intro eine automatische Zeile aus der Deckliste).
--
-- Regel: decks.motto ist null oder 1–80 Unicode-Codepunkte (char_length), ohne Leerzeichen am
-- Rand und ohne Zeilenumbruch/Steuerzeichen. Der Client zählt gleich ([...s].length), trimmt vor
-- dem Speichern und schreibt bei leerer Eingabe null.
--
-- Rechte-Weg: keine neue Policy, keine Spalten-Grants, keine Funktion. Geschrieben wird über die
-- bestehende Policy decks_update (can_edit_deck, jüngste Definition 20261117000000_mitglieder.sql):
-- Konto-Besitzer; bei Platzhalter-Decks jedes Mitglied der Gruppe, solange der Platzhalter nicht
-- entfernt ist. Gelesen wird wie das Deck (decks_select / can_see_deck).
--
-- Übergang: additiv. ADD COLUMN ohne Default ist eine reine Metadaten-Änderung, alle Bestandszeilen
-- haben motto = null (der Check gilt damit für jede Zeile); ADD CONSTRAINT prüft die Tabelle einmal.
-- Die App liest motto nur über select('*') und nennt die Spalte in keiner Spaltenliste ⇒ alte App
-- mit neuer Datenbank und neue App mit alter Datenbank laufen beide.
--
-- Zeilenkopien über den Zeilentyp (20261112000000_konto.sql:171 und 20261117000000_mitglieder.sql:517,
-- „insert into decks select (c).*“): die neue Spalte steht am Ende und wandert mit (Motto bleibt erhalten).
-- ============================================================================

alter table public.decks add column if not exists motto text;

alter table public.decks add constraint decks_motto_check check (
  motto is null or (char_length(motto) between 1 and 80 and motto = btrim(motto) and motto !~ '[[:cntrl:]]')
);

comment on column public.decks.motto is
  'Optionales Motto des Decks (Spielstart-Intro), 1–80 Zeichen, ohne Rand-Leerzeichen und Steuerzeichen; null = automatische Zeile';

-- ============================================================================
-- Rückwärts (zum Zurücknehmen; Zeilen ohne „-- “ ausführen, Reihenfolge einhalten).
-- Preis: alle Mottos gehen verloren.
-- RÜCKWÄRTS-BEGINN
-- alter table public.decks drop constraint decks_motto_check;
-- alter table public.decks drop column motto;
-- RÜCKWÄRTS-ENDE
-- ============================================================================
