---
description: "Spawn-Ergebnisse abholen: Inbox listen, Schlussberichte lesen, Stichprobe gegen echten Code, Verdikt fällen, mit `claude-spawn --ernte <job> <verdikt>` ernten (Gate + Ledger + Backlog-Punkt laufen mit). TRIGGER: /ernte, spawns ernten, inbox abholen, verdikt-rückstand."
argument-hint: "Optional: Job-ID(s); leer = alle abholbereiten"
---

> **Effort: high** — das Verdikt ist die EINZIGE Korrektheitsquelle; ein grünes Gate belegt
> nur Betrieb, nicht Korrektheit.

# /ernte — Spawn-Ergebnisse reviewen und ernten

**User-Input:** $ARGUMENTS

## 1. Bestand
`claude-spawn --ernte` listet: **ABHOLBEREIT** (`fertig`/`blockiert`) = Arbeitsvorrat ·
**BEENDET OHNE BERICHT** = einzeln (Schritt 5) · **OHNE RÜCKMELDUNG** = nicht anfassen, bei
Verdacht `claude-spawn --laufend` / `--blick <id>` · **WARTET** = ungestartete Kettenschritte.
Rückschau: `claude-spawn --ernte --verlauf` (48 h). Nichts abholbereit → eine Zeile, Ende.

## 2. Je Job lesen und prüfen
1. `~/.spawn-ergebnisse/<job>.md` lesen, bei Bedarf die Prompt-Datei (Auftrag, Spec).
2. **Block `## Weglassungen` lesen:** jede ausgelassene Gate-Stufe mit „Abschluss blockiert: ja"
   hält `ok` auf. Fehlt der Block, in der Notiz vermerken.
3. **Stichprobe (Pflicht):** mind. eine zentrale Behauptung gegen Code/Diff prüfen, Beleg
   `datei:zeile`. Kritische Klassen (Rechen-Logik, Mandantentrennung, Schema; ein Diff an Geld-Pfad oder Wettbewerbstexten ist selbst ein Befund):
   gegen Spec + Abnahmekriterien, nicht nur Existenz — dafür Agent `gegenleser` (`model: opus`),
   nur wenn kein Review-Schritt in der Kette liegt — EIN Prüfer je Stand. Bau: Kern-Diff + ein Spec-Test. Recherche: 1–2 Fundstellen.

## 3. Verdikt
- **ok** — Auftrag erfüllt, Stichprobe hält, alle Abnahmekriterien `erfüllt` oder von Jonas
  `aus dem Scope genommen` (Zitat in die Notiz). Mini-Fix < ~5 Zeilen selbst, in der Notiz vermerken.
- **nacharbeit** — etwas Benennbares fehlt; ein Kriterium auf `nicht erfüllt`/`nicht geprüft`
  zählt immer dazu, auch wenn der Bericht dafür einen Backlog-Punkt angelegt hat. Pflicht:
  `--ursache <implementierung|beleg-fehlt|falschmeldung|review-anweisung|kappung|spec|umgebung>`
  + `--befunde <datei.md>` (`befunde-<paket>.md` im Wellen-Ordner). Je Befund `### B<n> — <Titel>`
  mit `anforderung` (oder Ausfallszenario) · `beleg` (`datei:zeile`) · `abschluss` (prüfbar) ·
  `klasse` (K1–K4) · `weg`: `fehler` (Korrektur) · `beleg-fehlt` (erst messen, kein Neubau) ·
  `bericht` (eigene Bewertung korrigieren). Wünsche ohne verletzte Anforderung: EINE Sammelzeile
  unter `## Wünsche`. Vorher: `spawn-ernte-befunde.js pruefe <datei.md>`.
- **verworfen** — unbrauchbar/überholt; Notiz nennt den Grund (`Überholt:` bei toter Prämisse).
  Mit Ursache: `--ursache <umgebung|kappung|doppelt|spec|entscheid|fehlbau>` — Pflicht bei
  `vertrag: 2`, ohne Befundliste. `umgebung` = Fehlstart/Permission/API/Kontingent · `kappung` =
  Guard hat den Lauf beendet · `doppelt` = Doppelstart oder überholt · `spec` = Auftrag falsch ·
  `entscheid` = bewusst gehalten · `fehlbau` = Ergebnis unbrauchbar. Nur `fehlbau` ist ein Urteil
  über den Lauf; alles andere ist Betrieb.
- Braucht es Jonas (Preis, Geld, Live-Schaltung): NICHT ernten, unter „Bei dir liegt:" nennen.

## 4. Ernten
1. „KEIN open_item verknüpft"? Passenden `[Spawn]`-Punkt über `/offen` suchen (GET, alle Status)
   und `claude-spawn --ernte --punkt <job> <uuid>`. Keiner da → ohne ernten, im Bericht nennen.
   403 = Grenze, melden, kein Umweg.
2. `claude-spawn --ernte <job> ok|nacharbeit|verworfen "<Notiz>" [--ursache … --befunde …]`.
   Das fährt das lokale Gate (`tsc · lint · test · build`; fehlt eine Stufe ⇒ `kein_gate`, nie
   grün), schreibt Verdikt in `spawn-ledger`, pflegt den Punkt (ok/verworfen ⇒ erledigt;
   Zwischenschritt einer Kette lässt ihn offen) und beendet die Spawn-Session.
3. **Kette:** bei `ok` liegt die nächste Startzeile in der Zwischenablage — starten ist ein
   eigener Entschluss.
4. **nacharbeit:** Neben der Befundliste liegt der Nachprüf-Prompt — Befundliste +
   Nacharbeits-Diff, kein zweites Vollreview.

## 5. Beendet ohne Bericht
`--blick <id>`, Worktree/`cwd` ansehen. Beurteilbar → normal ernten. Sonst `verworfen`
„ohne Bericht, kein Arbeitsstand" oder Punkt schärfen.

## 6. Bericht
Je Job: Job · Auftrag · **Verdikt** · Gate · Punkt · Stichprobe (`datei:zeile`). Dann
`claude-spawn --ernte --lage` und „Bei dir liegt:" (Pflicht, sonst „nichts").

## Leitplanken
- Merge gehört nicht zur Ernte: er folgt nach `ok` als eigener Zug nach der Kit-`CLAUDE.md`.
- `--ohne-verdikt` ist hier tabu.
- Funde jenseits des Auftrags → `/offen`, nicht mitbauen.
