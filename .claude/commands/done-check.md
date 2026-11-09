---
description: Abschluss-Ritual einer Session — prüfen, ob „fertig" wirklich fertig ist
---

# /done-check — fertig heißt verifiziert, nicht behauptet

Fertig ist eine Kette, kein Zustand:
**tsc + lint grün → committed → gepusht → deployed → Live-URL geprüft → Backlog gepflegt.**
Ein lokaler grüner Lauf ist nie „fertig". „Deployt" ist nicht „live".

## 1 — Git-Zustand

```bash
git -C <repo> status --short
git -C <repo> log --oneline -5
git -C <repo> rev-list --left-right --count main...origin/main
```

Uncommittetes und Ungepushtes werden benannt, nicht stillschweigend übergangen.
Zwei Zahlen lesen: `0 voraus / N zurück` heißt, dass ein Merge Live-Stände zurückrollen würde.

## 2 — Repo-Konsistenz

Gehört die Änderung ins Repo, in dem sie liegt? Keine Datei aus einem Nachbar-Repo mitgeschleppt,
keine `.env*`, keine Datei aus `node_modules/` oder `.next/` gestaget.

## 3 — Deploy ist live

Domain **aus `project-meta.json`** ziehen, nie tippen:

```bash
DOMAIN="$(jq -r '.domain' <repo>/project-meta.json)"
curl -s -o /dev/null -w '%{http_code}\n' "https://app.$DOMAIN/"
```

Erwartet: `200` oder `307` (Redirect auf die Anmeldung). Alles andere ist ein Befund, kein Rundungsfehler.
Direkt nach einem Push baut die Plattform noch — auf den neuen Build warten, sonst misst du den alten.

## 4 — Backlog gepflegt

- Neue Funde, die das Session-Ziel nicht blockierten, sind als Punkte geschrieben (`/offen`).
- Behobene Fehler sind selbst geschlossen — Statuspflege gehört zum Fix.
- Punkte, die sich durch die Arbeit erledigt haben, sind als `Überholt:` geschlossen.

## 5 — Compounding

Ist in dieser Session eine Regel entstanden (ein Fehler erkannt und behoben)?
Dann gehört sie **neben den Code**: Modul-Regel in die `CLAUDE.md` des Modul-Verzeichnisses,
app-weite Regel in die App-`CLAUDE.md`. Vorfallsgeschichte und Messwerte gehören nicht dorthin.
Die `CLAUDE.md` bleibt unter ~200 Zeilen / ~25 kB.

## Report

| Repo | Uncommitted | Ungepusht | Branch | Deploy | Live-Check |
|---|---|---|---|---|---|
| app-… | 0 | 0 | main | READY | 200 |

Danach in dieser Reihenfolge:

- **Sofort erledigt:** was in dieser Session noch abgeräumt wurde.
- **CLAUDE.md-Größe:** Zeilen / kB der geänderten Dateien.
- **Ins Backlog geschrieben:** Titel der neuen Punkte.
- **Bei dir liegt:** alles, was nur Jonas entscheiden/tun kann — je ein Halbsatz mit Anker
  (Branch, Datei, Vorlage). Steht nichts aus, ist **„nichts"** der Pflichtwert; die Zeile fehlt nie.

**Session abgeschlossen.**
