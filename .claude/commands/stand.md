---
description: Arbeitsstand so festhalten, dass eine frische Session ohne Rückfragen weiterarbeiten kann
---

# /stand — Übergabe an die nächste Session

Zweck: Eine Session hat ein Ziel und endet. Ist die Arbeit mehrstufig (Etappe folgt, eine Freigabe
steht aus), wird der Stand als Datei persistiert — nicht im Chatverlauf gelassen. Die nächste Session
zieht sich den Stand selbst aus dieser Datei.

Ablage: `docs/stand/<datum>-<thema>.md` im betroffenen Repo.
Umfangs-Deckel: **~5 kB**. Was länger wird, gehört in den Code oder in einen Backlog-Punkt.

## Vorlage

```markdown
## Arbeitsstand
- Repo / Branch: app-… · feature/…
- Committed: <sha> „<Betreff>"
- Letzte grüne Verifikation: tsc ✓ · lint ✓ · test ✓ (<datum>, <sha>)
- Erledigt: …
- In Arbeit: …
- Offen: …
- Zwischenentscheidungen: <Entscheid> — <Grund in einem Halbsatz>

## Aufgabe
Ein Absatz: Ziel + Ergebnisform. Was am Ende messbar anders ist.

## Scope-Sperren
Was NICHT angefasst wird — je eine Zeile, mit Pfad. Sperren sind bindend, auch wenn eine
Änderung dort „schnell ginge".

## Offene Entscheidungen
Getrennt in zwei Listen:
- **Selbst entscheiden** (konservativ wählen, Entscheid als Abweichung protokollieren): …
- **Stoppen und melden** (Arbeit ruht, bis Jonas antwortet): …

## Regeln
Die Handvoll Regeln, die für genau diese Aufgabe zusätzlich gelten (z. B. „Datei X nur additiv
ändern", „keine Migration ohne Rückwärtspfad").

## Freigaben (GO-Gates)
Was ohne ausdrückliche Freigabe von Jonas nicht passiert: Merge nach `main`, Live-Schaltung,
Preise, destruktive Migrationen, Löschungen.

## Report am Ende
Tabelle mit Belegen (Datei · Änderung · Nachweis) plus ein Abschnitt **Abweichungen**:
jede Stelle, an der von der Vorgabe abgewichen wurde, mit Grund.
```

## Regeln für den Inhalt

- **Belege statt Behauptungen:** Commit-SHA, `datei:zeile`, HTTP-Status. „Läuft" ist kein Beleg.
- **Ein Punkt ist ein Messwert mit Datum.** Ein Stand von vorgestern wird vor der Weiterarbeit
  gegen den echten Code geprüft, nicht geglaubt.
- **„Bei dir liegt:"** wandert unverändert in den Stand — die Liste dessen, was nur Jonas tun kann.
  Steht nichts aus, ist „nichts" der Pflichtwert.
