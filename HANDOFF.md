# Tracking the Gathering – Handoff

Stand: 06.11.2026 · Konzept und klickbares Mockup sind fertig, die echte App wird jetzt gebaut.

Dieses Dokument ist die vollständige Grundlage für die Umsetzung. Es beschreibt, was gebaut wird, wie es aussieht, wie die Daten liegen und in welcher Reihenfolge vorgegangen wird. Alles, was hier steht, ist mit Franco abgestimmt, außer wo ausdrücklich „offen“ steht.

---

## 1. Worum es geht

Ein Tracker für Magic: The Gathering Commander (EDH), gespielt in festen Gruppen am Küchentisch oder im Laden. Vorbild ist playgroup.gg, das aber zu unübersichtlich ist. Tracking the Gathering ist übersichtlicher, schöner und auf eine Gruppe zugeschnitten.

Drei Hauptbereiche:
1. **Spielen** – Lifecounter am Tisch mit allem, was Commander braucht
2. **Historie** – jedes Spiel wird gespeichert, gruppiert nach Spieleabenden
3. **Statistik** – Ranglisten, Profile, Decks, Salt, Tempo

Leitlinien: modern, hochwertig, MTG-Vibe ohne Kitsch. Ingame übersichtlich, nichts zu voll, intuitiv. Ein Spiel soll sich ohne Erklärung bedienen lassen.

---

## 2. Technik (entschieden)

| Thema | Entscheidung |
|---|---|
| Plattform | PWA (installierbar auf dem Handy), läuft im Browser |
| Frontend | **Vanilla JS**, ES-Module, kein Framework, kein Build-Schritt |
| Hosting | GitHub Pages |
| Backend | Supabase (Postgres, Auth, Realtime, Storage) |
| Login | E-Mail + Passwort |
| Gäste | Spieler ohne Konto möglich (Platzhalter), später per Code übernehmbar |
| Gruppen | Mehrere Playgroups pro Person |
| Decks | Commander über die Scryfall-API suchen (inkl. Partner) |
| Sprache | Deutsch und Englisch, umschaltbar (Standard Deutsch) |
| Ranking | Punkte nach Platzierung |

Supabase-JS über ESM-CDN einbinden, z. B. `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'`. Version beim Bauen festpinnen.

---

## 3. Referenzen im Paket

| Datei | Was |
|---|---|
| `mockup/prototyp.html` | Der komplette klickbare Prototyp mit Tour. Im Browser öffnen. **Das ist die Referenz für Aussehen und Verhalten.** |
| `mockup/ko-varianten/*.html` | Die vier K.O.-Screen-Entwürfe (A, B, C werden genutzt, D nicht) |
| `mockup/design-canvas-quellen/` | Quellen der Design-Fläche. `Main.dc.html` enthält die komplette Logik des Prototyps in einer Klasse (`class Component`). Viele Funktionen lassen sich fast 1:1 übernehmen: Lifecounter-Logik, Sitzlayouts (`slotsFor`), Angriff per Ziehen, K.O.-Animation, Statistik-Berechnungen. |
| `supabase/migrations/20261106000000_init.sql` | Komplettes Datenbankschema mit RLS, Funktionen, Views, Storage, Realtime. Getestet mit Postgres 17. |

Online (privat bzw. per Link geteilt):
- Design-Fläche: https://claude.ai/artifact/W3bzLiDQeQnzC28kYYFavz
- Prototyp für Kollegen: https://claude.ai/artifact/2Xub8mhJ1R6EeFUSfMQ7oa

Im Prototyp sind alle Daten Beispieldaten (Franco, Luka, Marie, Deniz, Tim ohne Konto).

---

## 4. Design

> **Neu seit 09.11.2026 (Design-Durchgang mit Franco).** Das Mockup gilt weiter für Funktionen und Abläufe, aber nicht mehr für Farben, Schrift und Icons. Verbindlich sind `src/styles/tokens.css` und die Vorschau https://claude.ai/artifact/JJdCH8yS44WcvddJNGHgTK (Version 4).

### Leitlinie
Modern und vermarktbar, nicht nerdig, kein Fantasy-Look. **Commander-Bilder groß und ungetönt** (nur ein neutraler dunkler Verlauf für Lesbarkeit, nie ein Farbschleier). **Keine Spielerfarben in der Oberfläche** (nur in Diagrammen). Kontrast zwischen Flächen statt Ton-in-Ton.

### Looks (im Profil wählbar, `profiles.theme`)
| Look | Hintergrund | Fläche | Hauptknopf | Akzent |
|---|---|---|---|---|
| **Nacht** (Standard) | `#0D1117` | `#171C24` | `#F3F6FA` (weiß) | Gold `#E9C46A` |
| **Arktis** | `#E4EDF6` | `#F6F9FC` | Marine `#0E1A2B` | Blau `#2F6FDE` |
| **Burgund** | `#3A0A18` | `#521226` | Gold `#F0C46A` | Gold `#F0C46A` |

Kein Creme-Weiß. Alle Tokens in `src/styles/tokens.css`. Karten heben sich deutlich vom Hintergrund ab (Franco: „nicht einfarbig, mehr Kontrast“). **Zweiter Akzent `--acc2`** für Links, Symbol-Kacheln, Chips, „Neu“-Knöpfe: Nacht Himmelblau `#6EA8FF`, Arktis Koralle `#E2583F`, Burgund Rosé `#FF8FA3`.

### Spielerfarben (nur für Diagramme)
**Keine Spielerfarbe in der Oberfläche** (Franco, 09.11.2026): keine Rahmen, Ringe, Punkte oder Streifen. Spieler erkennt man an Name, Profilbild und Commander-Bild. Im Lifecounter ist nur „am Zug“ farbig (Bernstein). Die folgenden Farben sind nur für Diagramme (z. B. Schadensbilanz) gedacht und werden dort automatisch vergeben:
W `#D9A93F`, U `#4C7BE0`, B `#8C74D6`, R `#D9614F`, G `#2F9E78`, farblos `#8A94A3`. Mana-Pips bleiben W `#EFE6C4`, U `#2D6DB5`, B `#3A3337`, R `#C4452F`, G `#2E7D50`.

### Schrift und Icons
- **Bricolage Grotesque** für Überschriften und große Zahlen (Lebenspunkte), **Geist** für Text.
- In den K.O.-Screens zusätzlich Bangers, Cinzel, Press Start 2P und Noto Sans JP.
- Icons: **Phosphor** (MIT), regular; aktiver Tab als fill. Eingebettet in `src/lib/icons.js`.

### Startseite
Laufendes Spiel als **kompakte Anzeigetafel** (eine Reihe Sitzfelder mit Commander-Art, Lebenspunkten, Farbstreifen; am Zug = Rahmen, wenig Leben = „kritisch“), ganze Karte antippbar, nicht dominant. Ohne Spiel: Bild-Karte „Bereit für die nächste Runde?“. Untere Leiste **schwebend und beschriftet**, aktiver Bereich als Fläche.

### Regeln
- Mobile first, Touch-Ziele mindestens 44 px.
- Keine Emojis als Icons, sondern Phosphor-Icons (`src/lib/icons.js`).
- Ingame so wenig Text wie möglich, alles Weitere hinter „⋯“ und dem Mittelknopf.

---

## 5. Funktionen im Detail

### 5.1 Konto, Gruppen, Spieler
- Registrieren und Anmelden per E-Mail + Passwort. Profil hat Anzeigename, Sprache und Look.
- Playgroup anlegen (Ersteller ist Admin) oder per Einladungscode `TTG-XXXX` beitreten.
- **Spieler ohne Konto:** Ein Mitglied legt einen Spieler nur mit Namen an. Er bekommt ein Profil, Decks und Statistiken. Im Profil steht sein persönlicher Code (z. B. `TIM-4K9Q`) mit „Link kopieren“. Registriert er sich und gibt den Code ein, übernimmt er Profil und komplette Historie. War er schon Mitglied, wird die Historie zusammengeführt (`claim_member` erledigt beides).
- Anlegen geht an zwei Stellen: Playgroups → „Spieler ohne Konto anlegen“ und im Setup über den Chip „+ Spieler“.
- **Profilbild:** Im eigenen Profil auf das runde Bild tippen (kleines Kamera-Symbol unten rechts). Bottom-Sheet mit „Foto aufnehmen“ (`<input type="file" accept="image/*" capture="user">`), „Aus Galerie wählen“ und „Bild entfernen“. Im Client quadratisch mittig zuschneiden und auf 256×256 JPEG (Qualität ~0,85) verkleinern, dann hochladen. Ohne Bild stehen die Initialen da.
  - Setzen darf man das eigene Bild und das von **Spielern ohne Konto** in der eigenen Gruppe. Fremde Profile mit Konto: nur ansehen.
  - Angezeigt wird es oben rechts auf der Startseite, im Profil und in der Mitgliederliste der Playgroup (später gern auch in Rangliste und Historie).
  - Speicherort: Bucket `avatars`, Pfad `profiles/<profile_id>/avatar.jpg` bzw. `members/<member_id>/avatar.jpg`, Spalte `avatar_path` in `profiles` bzw. `members`. Übernimmt jemand einen Platzhalter per Code, wird dessen Bild übernommen, falls er noch keins hat.

### 5.2 Decks
- Profil → Decks → „+ Commander hinzufügen“. Geht für das eigene Profil und für Spieler ohne Konto.
- Suche über Scryfall: `https://api.scryfall.com/cards/search?q=is:commander+<name>`. Ergebnisliste mit Bild, Name, Farben und Partner-Kennzeichen.
- Partner: Hat der Commander „Partner“, erscheint „Partner-Commander hinzufügen“, und die Suche zeigt nur passende Partner.
- Bracket 1–5 (Exhibition, Core, Upgraded, Optimized, cEDH).
- Optional ein Link zur Deckliste. Moxfield und Archidekt werden erkannt, im Deckprofil gibt es „Öffnen“ und „Link ändern“.
- Deckprofil: Commander-Art (von Scryfall), Spiele, Siege, Siegquote, Ø Platz, eigene Bewertung, Spaß, Salt bei Gegnern, letzte Spiele.

### 5.3 Neues Spiel (Setup)
- Spieler wählen (2–6), „+ Spieler“ für neue Spieler ohne Konto.
- **Sitzordnung:** Tischvorlage wählen (Seiten, Rundum, Gegenüber, Alle unten). Eine Mini-Vorschau zeigt, wer wo sitzt; zwei Plätze antippen tauscht sie. Die Geometrie steckt in `slotsFor(n, layout)` in `Main.dc.html`.
- Pro Spieler ein Deck (Tippen wechselt, eigene Decks zuerst). Ohne Deck steht dort „+ Commander“.
- Links neben dem Deck ein Farbkreis: öffnet die **Feldfarbe** (siehe 5.4a).
- **Startspieler auswürfeln:** öffnet den Würfeltisch zum Wischen (siehe 5.4b).
- **Startleben** anpassbar: Schnellwahl 20 / 25 / 30 / 40 und −/+ in 5er-Schritten (5–99). Standard 40, darunter der Hinweis „Commander-Standard“, „Schnelle Runde“ oder „Lange Runde“. Gespeichert in `games.starting_life`.
- Spiel starten geht erst, wenn jeder ein Deck hat.

### 5.4 Lifecounter (Kern der App)
- **Layout:** Standard „Seiten“: Das Handy liegt längs in der Tischmitte, die Spieler an den langen Seiten sehen ihre Felder **seitlich gedreht (±90°)**, nicht kopfüber. Rotation im Feld per `container-type: size` und `width: 100cqh; height: 100cqw`.
- **Feld:** oben Name und Commander, rechts kleine Status-Icons (nur wenn gesetzt) und „⋯“. In der Mitte die große Zahl. Links tippen = −1, rechts = +1. Darüber kurz die Änderung („−3“), die nach 1,8 s verschwindet.
- **Am Zug:** Unter der Zahl steht „Am Zug · 01:24“. Unten rechts im Feld gibt es den einzigen Hauptknopf „Zug beenden →“.
- **Mittelknopf (rund, zeigt Runde):** öffnet das Spielmenü mit drei Tabs:
  - Zug: Runde, Zugzeit, Gesamtzeit, „Zug beenden → Name“, Tag/Nacht (Standard aus), Sturm-Zähler
  - Werkzeuge: Zufallsfeld (W6, 2× W6, W20, Münze, Spieler; antippen), Tisch-Layout, Live-Status
  - Verlauf: alle Aktionen mit Runde, „Letzte Aktion rückgängig“
  - Ganz unten klein „Hauptmenü“ und „Spiel beenden“ (absichtlich klein, damit man nicht versehentlich draufkommt)
- **„⋯“ pro Spieler (Zähler):**
  - Gift (bis 10), Commander-Steuer (bei Partner zwei Zähler), Energie, Erfahrung, Rad, Geschwindigkeit (bis 4), Der Ring (bis 4), Dungeon
  - Status-Chips: Monarch und Initiative (exklusiv), Stadtsegen
  - **Pins pro Deck:** Pin-Symbol vor jedem Zähler. Angepinnte Zähler stehen oben, der Rest liegt unter „Weitere Zähler“ (aufklappbar, Pfeil). Zähler über 0 rutschen automatisch nach oben. Standard für neue Decks: Gift und Steuer.
  - „Ist ausgeschieden“, danach „Wer hat X rausgenommen?“. Die Gegner sind nach verursachtem Schaden sortiert, der Spitzenreiter ist hervorgehoben, dazu „Aufgegeben“.
- **Angriff per Ziehen (wichtig):** Vom Feld des Angreifers auf das Feld des Opfers ziehen. Dabei folgt ein **Zielfernrohr** dem Finger, das über einem Gegner rot einrastet; das Zielfeld bekommt einen roten Rahmen. Ziehen auf den Mittelknopf (zeigt dann „ALLE“) trifft alle Gegner. Danach öffnet sich das Angriffsfenster:
  - Zielchips: „Alle Gegner“ plus einzelne Gegner, frei kombinierbar
  - Art: Schaden, Commander (bei Partner beide Namen einzeln) oder Gift
  - Menge über −/+ und Schnellwahl 5, 10, 15, 20
  - Lifelink-Schalter (Angreifer bekommt Schaden × Anzahl Ziele als Leben)
  - Vorschau-Karte: pro Ziel eine Zeile „alt → neu“, Commander-Schaden mit Balken „/ 21“, Gift „/ 10“, Lifelink-Zeile grün
  - Knopf „3 Schaden eintragen“
- Normales Tippen hat keine Quelle. Nur Angriffe per Ziehen werden mit Verursacher gespeichert.
- **Tödlich:** Bei ≤ 0 Leben, 10 Gift oder 21 Commander-Schaden von einem Commander kommt der **K.O.-Screen**. Danach steht im Feld zusätzlich „Ausgeschieden?“.
- Einmaliger Hinweis-Banner beim ersten Spiel erklärt die Ziehgeste.
- Display bleibt während des Spiels an (Wake Lock), Offline-fähig über Service Worker (siehe Etappe 5).

### 5.4a Feldfarbe
- Jedes Spielerfeld hat eine Farbe. Standard sind die **Commander-Farben**: eine Farbe = getöntes Feld, mehrere Farben = diagonal geteiltes Feld mit harten Streifen (135°). Farben aus `MA` (Mana-Farben) in `Main.dc.html`.
- Alternativ eine **eigene Farbe** aus der Palette (10 Farben: Rot #C4452F, Orange #D9822B, Gold #C9A45C, Grün #2E7D50, Türkis #1F8A8A, Blau #2D6DB5, Violett #6B4FB8, Pink #C2457A, Braun #8A5A3C, Grau #6B7480).
- Gilt **pro Deck** und wird gespeichert (`decks.field_color`, `null` = Commander-Farben).
- Ändern: im Setup über den Farbkreis, im Spiel über „⋯“ → „Feldfarbe“. Bottom-Sheet mit Vorschau, Auswahl sofort sichtbar, „Fertig“ schließt.
- Umsetzung: `fieldCols(deckId)` und `fieldBg(cols, pct)` in `Main.dc.html` (einzelne Farbe per `color-mix`, mehrere per `linear-gradient`). Die Tönung hängt vom Look ab (`t.mix`, `t.mixPct`), damit die Zahl immer lesbar bleibt.

### 5.4b Würfeln und Zufall
**Im Spiel (Mittelknopf → Werkzeuge): einfacher Randomizer, keine Würfel-Animation.**
- Oben Segmente: W6, 2× W6, W20, Münze, Spieler.
- Darunter ein großes Feld mit „Würfeln“ (bzw. „Münze werfen“, „Spieler ziehen“). Antippen = Ergebnis. Kurzes Durchflackern der Werte (~0,5 s), dann groß das Ergebnis mit Zusatz: „5 und 2“, „Pasch!“, „Natürliche 20!“, „Autsch. Eine 1.“, „Kopf/Zahl“. Darunter „Nochmal tippen“.
- Vorlage: `rollOnce` und `rollTool` in `Main.dc.html`. Zufall in der echten App über `crypto.getRandomValues`.

**Startspieler beim neuen Spiel: Würfeltisch zum Wischen (wie Monopoly am Handy).**
- „Auswürfeln“ im Setup öffnet ein Vollbild mit grünem Filz. Jeder Spieler hat einen W6 mit Namensschild.
- Würfel antippen und mit Schwung über den Tisch wischen. Gedrückt halten schüttelt leicht, einfaches Tippen wirft auch.
- Physik: eigene kleine Simulation (`simDice`): Reibung, Abprallen an Wänden, Würfel stoßen sich ab. Bahn vorab berechnen, dann mit der Web Animations API abspielen (`throwDice`). Wurfgeschwindigkeit aus den Zeigerbewegungen der letzten ~90 ms.
- 3D-Würfel in CSS (6 Flächen, `preserve-3d`). Ergebnis steht vorher fest, Endrotation zeigt die richtige Fläche: 1:(0,0) 2:(0,−90) 3:(−90,0) 4:(90,0) 5:(0,90) 6:(0,180) als rotateX/rotateY, Reihenfolge `rotateZ rotateX rotateY`.
- Höchster Wurf beginnt. Bei Gleichstand würfeln nur die Gleichstehenden nochmal (die anderen ausgegraut). „Deniz beginnt · übernehmen“ setzt den Startspieler.
- Vibration beim Aufprall über `navigator.vibrate` (nur Android).
- Während eines Wurfs nicht neu rendern, sonst sind die animierten Elemente weg. Erst am Ende Endzustand setzen, Animationen abbrechen, dann Zustand aktualisieren.
- `prefers-reduced-motion` beachten: ohne Flug, Ergebnis direkt einblenden (im Prototyp noch nicht drin).
- Würfe als Ereignis `roll` speichern.

### 5.4c Feldrahmen
- Jedes Spielerfeld hat einen Rahmen (3 px innen) in einer dunkleren Variante seiner Feldfarbe, damit die Felder klar voneinander getrennt sind.
- Wer am Zug ist, bekommt einen deutlich anderen Rahmen: Bernstein (#E8A317, im Look Obsidian #F2C14E), 4 px innen plus 2 px außen und ein leichter Schein.

### 5.5 K.O.-Screen
Zufällig eine von drei Varianten, jeweils animiert (Stufen 0–9 über ca. 700 ms, siehe `startKO()` in `Main.dc.html`):
- **A · Anime:** weißer Blitz, Speedlines, roter Burst mit „K.O.!“, Wackeln, „ドォン!!“ und „ゴゴゴ“, Manga-Panel mit Name und Spruch.
- **B · Reich der Schatten:** Beschwörungskreis, Spielerkarte mit Goldrahmen in Commander-Farben, Risse, Scherben fliegen in den Wirbel. Titel „X wurde ins Reich der Schatten geschickt“, Knopf „Verbannen“.
- **C · Arcade:** Synthwave-Hintergrund, Lebensbalken, 3D-„K.O.“, „LUKA WINS“, Dialogfenster, „CONTINUE? 9“.

Knöpfe: „Doch nicht“ schließt den Screen; „Ausscheiden“ trägt den Spieler mit dem Angreifer als Verursacher aus. Ohne bekannten Angreifer heißt der Knopf „Wer war es?“ und öffnet die Auswahl.

Sprüche, zufällig (bei Variante B nie der erste):
1. Du wurdest ins Reich der Schatten verbannt.
2. Das Herz der Karten hat dich wohl verlassen.
3. Fatality.
4. Wasted.
5. Deine Lebenspunkte sind auf null. Du rennst zum nächsten Pokémon-Center.
6. Dein Commander braucht jetzt erst mal Steuer für die Therapie.
7. Gönn dir die Zuschauerrolle. Snacks sind in der Küche.
8. Du hattest einen guten Lauf. Er war nur sehr kurz.

### 5.6 Live auf mehreren Handys
Ein Handy liegt in der Mitte und ist der „Host“. Andere können über „Spiel beitreten“ mit Code live mitsehen und mitzählen. Umsetzung: Supabase Realtime auf `games` (Feld `live_state`) und `game_events`. Für Mitspieler ohne Konto: Supabase **Anonymous Sign-ins** aktivieren.

### 5.7 Spielende
- Sieger mit Krone, Platzierungen mit „Raus in Runde X durch Y“ und „Ø Zug m:ss“.
- „Wer hat wem geschadet“: Schadensbilanz zwischen allen Spielern (View `v_damage_matrix`).
- Siegbedingung: Kampfschaden, Commander-Schaden, Kombo, Gift, Alternativsieg, Aufgabe.
- **Play of the Game:** Jeder stimmt auf seinem Handy für einen Spieler ab, optional mit Text.
- **Deine Bewertung:**
  - Salt 1–5 („Tiefenentspannt“ bis „Komplett versalzen“)
  - Spaß 1–5 („Zäh“ bis „Legendär“)
  - eigenes Deck mit 1–5 Sternen („Lief gar nicht“ bis „Hat alles gemacht“)
- **Decks bewerten (optional, aufklappbar):** pro gegnerischem Deck 5 Salzstreuer, oder als Abkürzung „Salzigstes Deck dieser Runde“ (zählt wie eine 5).
- Notiz, Foto vom Tisch (Storage-Bucket `game-photos`).

### 5.8 Historie
Nach Spieleabenden gruppiert, mit Filtern (Alle, Meine Siege, Hoher Salt, Mit Foto). Jeder Abend hat einen „Karte“-Knopf. Spieldetail mit Platzierungen, Kennzahlen, Notiz und Foto.

### 5.9 Statistik
- **Punkte pro Spiel:** 1. Platz bekommt so viele Punkte, wie Spieler am Tisch sitzen; Platz k (ab 2) bekommt n − k; der Letzte 0. Bei 4 Spielern also 4/2/1/0, bei 5 Spielern 5/3/2/1/0, bei 6 Spielern 6/4/3/2/1/0. Funktion `place_points`. **Mit Franco noch bestätigen.**
- **Rangliste**, drei Tabs:
  - Spieler: Punkte, Spiele, Siegquote
  - Decks: Punkte, Spiele, Siegquote
  - **Salt:** Ø Salt pro Deck; das Deck kommt ab 2 Bewertungen in die Liste, angezeigt mit „am meisten gesalzen: Name“
- **Salt-Berechnung pro Deck** (View `v_deck_salt`): Direkte Deck-Bewertungen zählen. Hat ein Spieler keine Deck-Bewertung abgegeben, geht sein eigener Salt-Wert an das Deck, das ihn rausgenommen hat.
- **Profil:**
  - Spiele, Siege, Punkte, Ø Platz
  - Stimmung (Ø Salt, Ø Spaß, Ø Deck-Bewertung) und Salt-Verlauf der letzten 8 Spiele
  - **Tempo:** Ø Zugdauer mit Balkenvergleich der ganzen Gruppe, „Langsamster am Tisch“ (aus `turn_end`-Ereignissen)
  - Nemesis („X hat dich 7× rausgenommen“) und Decks
- **Spieleabend-Karte zum Teilen:**
  - Tagessieger (meiste Siege, bei Gleichstand Punkte) mit Deck
  - Salzigster Spieler (Ø Salt)
  - Längster Zug
  - Play of the Game (meiste Stimmen) mit Spruch
  - Spielanzahl und Stunden am Tisch
  - Teilen als Bild: per Canvas rendern und mit der Web Share API (`navigator.share({ files })`) direkt an WhatsApp schicken; Fallback ist ein Download.

### 5.10 Einstellungen
Sprache DE/EN, Erscheinungsbild (Schiefer, Gletscher, Obsidian), Playgroups verwalten, Abmelden.

---

## 6. Datenmodell (Kurzfassung)

Ausführlich in der Migration. Wichtigste Idee: **Jede Aktion am Tisch ist ein Ereignis** in `game_events`. Daraus entstehen Verlauf, Rückgängig, Schadensbilanz, Zugdauer und ein Teil der Statistik. `games.live_state` hält zusätzlich den aktuellen Zustand für den schnellen Live-Sync.

| Tabelle | Inhalt |
|---|---|
| `profiles` | Konto: Anzeigename, Sprache, Look, Profilbild |
| `playgroups` | Gruppe mit Einladungscode |
| `members` | Mitgliedschaft; `profile_id = null` = Spieler ohne Konto mit `claim_code` (und eigenem Profilbild) |
| `decks` | Commander, Partner, Farben, Feldfarbe, Bracket, Deck-Link, Zähler-Pins, Versionen |
| `sessions` | Spieleabend (Datum, Ort) |
| `games` | Spiel: Layout, Status, Runde, `live_state`, Siegbedingung, Notiz, Foto |
| `game_players` | Sitzplatz, Deck, Platz, ausgeschieden in Runde, durch wen |
| `game_events` | life, damage, cmd_damage, poison, lifelink, counter, flag, global, turn_end, eliminate, roll, undo |
| `player_ratings` | Salt, Spaß, eigene Deck-Bewertung pro Spieler und Spiel |
| `deck_salt_ratings` | optionale Salt-Bewertung gegnerischer Decks |
| `potg_votes` | Play-of-the-Game-Stimmen |

RPCs: `create_playgroup`, `join_playgroup`, `create_placeholder`, `claim_member`.
Views: `v_game_results`, `v_member_stats`, `v_deck_stats`, `v_turn_times`, `v_deck_salt`, `v_damage_matrix`.

**Hinweis für Aufrufe:** RPCs immer mit `supabase.rpc('name', {...})` aufrufen, in SQL mit `select * from fn(...)`, nicht `(fn(...)).*` (sonst läuft die Funktion mehrfach).

---

## 7. Supabase einrichten (macht Claude Code im Terminal)

Franco gibt keinen Schlüssel in den Chat, sondern meldet sich selbst an. Ablauf:

1. **CLI holen und anmelden**
   ```bash
   npx supabase@latest --version
   npx supabase login          # öffnet den Browser, Franco meldet sich an
   ```
2. **Projekt anlegen oder verknüpfen**
   ```bash
   npx supabase projects list
   # neu:  npx supabase projects create tracking-the-gathering --region eu-central-1
   npx supabase init            # falls noch kein supabase/config.toml existiert
   npx supabase link --project-ref <ref>    # fragt nach dem DB-Passwort, Franco tippt es selbst ein
   ```
3. **Schema einspielen**
   ```bash
   npx supabase db push
   ```
4. **Auth-Einstellungen** (Dashboard → Authentication, oder `supabase/config.toml` + `npx supabase config push`):
   - E-Mail-Login an, Bestätigungsmail an
   - Site URL und Redirect-URLs: `https://<github-user>.github.io/<repo>/`, zusätzlich `http://localhost:5173` für lokal
   - **Anonymous Sign-ins an** (für Mitspieler ohne Konto im Live-Modus)
   - E-Mail-Vorlagen auf Deutsch anpassen
5. **Frontend-Konfiguration:** URL und **anon key** (öffentlich, darf ins Repo) holen:
   ```bash
   npx supabase projects api-keys --project-ref <ref>
   ```
   In `src/config.js` eintragen. Den **service_role key nie** ins Frontend oder Repo.
6. **Prüfen:** zwei Testkonten anlegen und RLS testen. Kann A Gruppen von B sehen, in denen A nicht Mitglied ist? Erwartet: nein. Danach Platzhalter anlegen, Code einlösen und prüfen, ob die Historie übergeht.

---

## 8. Vorgeschlagene Projektstruktur

```
/
├── index.html              # App-Shell, lädt src/main.js
├── manifest.webmanifest    # PWA: Name, Icons, theme_color #2F3A46
├── sw.js                   # Service Worker: Offline-Cache, Warteschlange für Ereignisse
├── assets/icons/           # App-Icons 192/512, maskable
├── src/
│   ├── config.js           # SUPABASE_URL, SUPABASE_ANON_KEY
│   ├── main.js             # Start, Router, Auth-Status
│   ├── supabase.js         # Client + Hilfsfunktionen
│   ├── router.js           # Hash-Router: #/start, #/spiel, #/historie …
│   ├── i18n/de.js, en.js
│   ├── styles/tokens.css, base.css, components.css
│   ├── lib/                # scryfall.js, points.js, salt.js, time.js, share-card.js
│   ├── game/               # engine.js (Zustand + Ereignisse), layouts.js (slotsFor), attack.js, ko.js, dice.js
│   └── views/              # login, start, setup, life, result, history, detail,
│                           # board, profile, deck, add-deck, add-player, groups, recap
└── supabase/migrations/
```

`game/engine.js` sollte reine Logik ohne DOM sein: Zustand plus Ereignis ergibt neuen Zustand. Damit funktionieren Rückgängig, Live-Sync und Tests sauber. Die Methoden aus `Main.dc.html` (`life`, `applyAttack`, `cmd`, `cnt`, `flag`, `advance`, `endTurn`, `eliminate`, `commit`, `undoLast`, `isLethal`) sind die Vorlage.

---

## 9. Etappen

1. ✅ **Fundament** (09.11.2026): Repo, PWA-Grundgerüst, Design-Tokens, Supabase verbunden, Login/Registrierung, Profil mit Profilbild, Playgroups (anlegen, beitreten, Einladungscode), Spieler ohne Konto anlegen und per Code übernehmen. Dazu Sicherheits-Migration und Design-Durchgang (Abschnitt 4).
2. ✅ **Decks** (09.11.2026): Scryfall-Suche inkl. Partner (Partner, Partner with, Friends forever, Background, Doctor/Companion), Bracket, Deck-Link, Deckprofil-Grundgerüst, Spielerfarbe aus dem Commander.
3. **Spielen:** Setup mit Sitzordnung und Layouts, Feldfarben, Lifecounter komplett (Tippen, Zähler, Pins, Mittelknopf, Verlauf, Rückgängig), Angriff per Ziehen mit Zielfernrohr, Würfeltisch, Ereignisse speichern, K.O.-Screens.
4. **Spielende und Historie:** Ergebnis, Bewertungen, Deck-Salt, Play of the Game, Foto, Historie nach Abenden, Spieldetail.
5. **Statistik:** Rangliste (Spieler, Decks, Salt), Profile mit Tempo und Nemesis, Deckprofile, Spieleabend-Karte zum Teilen.
6. **Live und Feinschliff:** Realtime auf mehreren Handys, Offline-Warteschlange, Wake Lock, Englisch fertig übersetzen, Barrierefreiheit prüfen, Bestätigungsmail bei Registrierung wieder einschalten (in der Testphase aus).

Nach jeder Etappe kurz mit Franco abstimmen und auf GitHub Pages veröffentlichen.

---

## 10. Noch offen oder später

- **Für Etappe 3 zu klären:** `decks.field_color` und `counter_pins` darf laut RLS nur der Deck-Besitzer ändern. Am Tisch setzt aber oft der Host die Feldfarbe für alle. Lösung vorschlagen (z. B. RPC, die das für Decks der eigenen Gruppe erlaubt).
- **Deckliste in der App + Bracket-Rechner + ManaBox-Import** (Wunsch von Franco, nach Etappe 2 je nach Aufwand): Text-/CSV-Export aus ManaBox einlesen, über Scryfall `/cards/collection` auflösen, Game Changers zählen. Vorher echten ManaBox-Export von Franco holen.

- **Token-Druck** (ausdrücklich später, wenn alles andere fertig ist): Token eintippen oder per Sprache eingeben, wird auf einen Bon-Thermodrucker gedruckt. Gedruckt wird ein eigenes Layout, kein offizielles Kartendesign; Daten von Scryfall, Symbole z. B. von game-icons.net. Druckwege:
  - BLE-Drucker per Web Bluetooth (Android direkt, iPhone über den Bluefy-Browser)
  - Cloud-Druck (Star CloudPRNT oder Epson, Auftrag über Supabase, geht mit jedem Handy)
  - später eine App-Hülle mit Capacitor

  AirPrint ist eher ungeeignet.
- **Team-Modus** (2 gegen 2, Two-Headed Giant): vorerst ausdrücklich nicht. Nicht einbauen, aber das Datenmodell auch nicht verbauen.
- **Punkteschema** bei 3, 5 und 6 Spielern bestätigen.
- K.O.-Variante D (Friedhof) ist entworfen, wird aber aktuell nicht genutzt.
- Weitere Ideen aus der Liste, nicht beauftragt: Mulligans erfassen, Bracket-Check vor dem Start, Ø Siegrunde pro Deck, Kingmaker-Wertung, Deck-Matchups, Deck-Versionen, Jahresrückblick, Spieleabend planen, Tisch-Aufteilung bei vielen Spielern.
- Bewusst nicht: Erfolge/Badges, Import aus playgroup.gg.
