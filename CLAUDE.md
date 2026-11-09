# Tracking the Gathering

PWA für Magic: The Gathering Commander. Lifecounter am Tisch, Spielhistorie und Gruppenstatistik.

**Lies zuerst `HANDOFF.md`.** Dort stehen alle Entscheidungen, Funktionen, das Design, das Datenmodell, die Supabase-Einrichtung und die Etappen. `mockup/prototyp.html` ist die verbindliche Referenz für Funktionen und Verhalten. Das Aussehen ist seit dem Design-Durchgang (09.11.2026) neu festgelegt: siehe `HANDOFF.md` Abschnitt 4 und `src/styles/tokens.css`.

## Arbeitsweise
- Sprache mit Franco: Deutsch. UI-Texte Deutsch (Englisch über `src/i18n`).
- Vanilla JS mit ES-Modulen, kein Framework, kein Build-Schritt. Hosting über GitHub Pages.
- Supabase: Schema nur über Migrationen in `supabase/migrations/` ändern, dann `npx supabase db push`.
- Geheimnisse: Franco meldet sich mit `npx supabase login` selbst an und tippt das DB-Passwort selbst ein. Niemals den service_role key ins Frontend oder ins Repo. Der anon key darf in `src/config.js`.
- Arbeite in den Etappen aus `HANDOFF.md` Abschnitt 9. Nach jeder Etappe kurz zusammenfassen, was fertig ist, und auf Rückmeldung warten.
- Logik aus `mockup/design-canvas-quellen/Main.dc.html` übernehmen statt neu erfinden (Lifecounter, Layouts, Angriff, K.O., Statistik).
- Design-Tokens und Schriften wie in `HANDOFF.md` Abschnitt 4. Ingame nichts überladen.

## Erster Start
1. `HANDOFF.md` lesen und `mockup/prototyp.html` ansehen.
2. Git-Repo anlegen bzw. prüfen, Projektstruktur aus Abschnitt 8 anlegen.
3. Supabase nach Abschnitt 7 einrichten (Franco dabei um Login bitten).
4. Mit Etappe 1 beginnen.
