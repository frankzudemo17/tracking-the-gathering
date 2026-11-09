---
description: "Kritische Klasse fächern: erzeugt Spec-Datei + Bau-Prompt (Opus-Spawn im Worktree) + Review-Prompt (Kettenschritt 2) + fertige Startzeilen. TRIGGER: /faecher, fächern, kritische Klasse delegieren, Spec für Spawn, Rechen-/Mandanten-/Schema-Aufgabe auslagern."
argument-hint: "Backlog-UUID oder Freitext der Aufgabe (optional: 'nur spec' = keine Prompts)"
---

# /faecher — Spec als Produkt, Bau und Review als Kette

**User-Input:** $ARGUMENTS

Erzeuge für eine kritische Aufgabe drei Dateien und die Startzeilen:
Spec · Bau-Prompt · Review-Prompt · `claude-spawn`-Zeile. Gestartet wird hier nichts —
du (Franco) setzt die Zeile selbst ab oder gibst die Welle an `/dirigent`.

**Das Muster:** Session (gern `--fable`) schreibt eine kleine Spec → Bau-Spawn (Opus) baut im
Worktree gegen die Spec → lokales Gate → frischer Review-Spawn (`--fable`) urteilt gegen dieselbe
Spec. Kritisch sind **Entscheid und Review**, nicht die Implementierung — was ein Spec-Test prüfbar
macht, ist Diff-Arbeit.

## Schritt 1 — Gehört das überhaupt in einen Fächer?

**Kritische Klassen:** Rechen-/Norm-Logik · Mandantentrennung/Security · Schema/Migration.
Geld-Pfad (Checkout, Webhooks, Refunds, Abos) ist keine Klasse für dich — er geht als Backlog-Punkt an Jonas. Keine davon ⇒ kein `/faecher`, sondern `/handoff` oder direkt `claude-spawn`.

**Nie gefächert** — ablehnen mit Klasse, was hier in der Session bleibt und was trotzdem fächerbar ist:

| Klasse | Warum |
|---|---|
| Merge nach `main`, Push, Live-Abnahme | Ein Hintergrund-Lauf kann nicht rückfragen; das macht die Session (Merge-Regeln in `/dirigent`). |
| Punkte aus „Was bei Jonas bleibt" (Preise, Zahlungen live, Mailversand, Domains/DNS, Produktiv-Anmeldung, destruktive Migration, Projekte löschen) | Jonas-Entscheid. Fächerbar ist höchstens die Umsetzung eines schon ENTSCHIEDENEN Punkts. |
| Diff < ~300 Zeilen oder kein kritischer Entscheid | Fächer-Schwelle: drei Dateien, zwei Spawns und ein Review kosten mehr als der Diff. Spec-Tests schreiben, direkt in der Session im Worktree bauen (`wt.mjs neu`), Gate, `gegenleser`. |
| UI nach entschiedenem Entwurf ohne Schema-/Rechen-Anteil | Der Entscheid fiel am Bild; direkt bauen, `gegenleser` im selben Turn. |

Steckt Schema/Migration zusammen mit UI in einer Aufgabe: Schema als eigenes Paket VORHER abtrennen.
Ist der Kern ein reiner Entscheid ohne Diff, gibt es nichts zu fächern — entscheiden, festhalten, fertig.

## Schritt 2 — Kern benennen (ein Absatz)

- Welche kritische Klasse, und welche **Entscheide** schreibst du jetzt in die Spec
  (Zuordnung, Grenzwert, Zugriffsgrenze, Reihenfolge)?
- Was ist Implementierung (→ Bau-Spawn), was bleibt fachlich ungetestet (→ Prüfschwerpunkt im Review)?
- **Reichweite:** Wer konsumiert das Ergebnis (zweite Ansicht, zweiter Aufrufer)? Ein Rollout in
  weitere App-Repos ist ein eigener Fächer, nie Anhängsel.

## Schritt 3 — Fakten messen (ein gebündelter Bash-Call)

- Backlog-UUID ⇒ Punkt über `/offen` lesen. Liegen seit Anlage ≥ ~100 Commits im Repo, ist er ein
  alter Messwert: erst nachmessen; ist die Lücke weg ⇒ `überholt` mit Beleg, nicht bauen.
- Ziel-Repo: `git -C <repo> rev-parse --short HEAD`, `wt.mjs liste`.
- Laufendes: `claude-spawn --laufend` · `claude-spawn --ernte`. Läuft die Arbeit schon oder liegt ein
  ungeerntetes Ergebnis ⇒ einsammeln statt fächern.
- Gate-Stufen aus `package.json` des Repos ABLESEN (tsc · lint · test · build). Fehlt eine, steht das
  in der Spec — die Ernte meldet dann `kein_gate`, nie grün.
- Jede Zahl in der Spec braucht eine Herkunft (Norm-Rechenbeispiel, Handrechnung, `datei:zeile`).

## Schritt 4 — die Spec

Ablage: `~/jfk-apps-werkstatt/.wellen/<JJJJ-MM-TT>-<thema>/spec-<paket>.md` (ASCII, kebab-case).
Sie ist die **einzige fachliche Wahrheit**; beide Prompts nennen nur ihren Pfad.

```markdown
# Spec: <Aufgabe in einem Satz>
Klasse: <Rechnen | Mandanten/Security | Schema> · Backlog: <UUID|—> · gemessen gegen <repo> <sha>

## Entschieden (nicht neu diskutieren)
- <Entscheid> — Grund: <Halbsatz> — Quelle: <datei:zeile / Norm / Handrechnung>

## Auftrag
<3–8 Zeilen, Dateien/Module benennen>

## Abnahmekriterien (je Kriterium der erwartete Beleg)
1. <Kriterium> — Nachweis: <Test/Kommando/Messung + erwartetes Ergebnis>
Endzustand je Kriterium: erfüllt · nicht erfüllt · nicht geprüft · aus dem Scope genommen.
Ohne Beleg gemeldet ⇒ `nicht geprüft`, nie `erfüllt`.

## Risiko-Szenarien (2–5, passend gewählt)
<z. B. fremde Organisation / ID aus fremder Org · Grenzwert 0/negativ/Maximum, Rundung, Einheiten ·
doppelter Klick/Retry/zweiter Webhook · Leerzustand, 375 px · Migration auf vorhandenen Daten>

## Spec-Tests (Teil des Bau-Auftrags)
Datei: <pfad> · | Fall | Eingabe | Sollwert | Quelle |
Gegenprobe Pflicht: jeder Test wird am ALTEN Stand rot.

## Negativraum-Checkliste
<Baustein der Klasse einfügen und kürzen — Nichtzutreffendes streichen>

## Scope-Sperren
- NICHT anfassen: <pfade>

## Stopp-Punkte (Bau hält an und meldet)
- Kein Merge, kein Push nach main. <aufgabenspezifisch>
```

### Negativraum-Bausteine (kürzen, nicht kopieren)

**Immer:** Welche Frage verstummt durch einen frühen `return`/Filter/Default? · Wird etwas still
weggelassen (dann mit Zahl und Grund ausweisen)? · Wird das neue Feld auch **gerendert**? ·
„nicht gemessen" bleibt von `0`/`null` unterscheidbar · zweiter Aufrufer/zweite Ansicht nachgezogen?

**Rechen-/Norm-Logik:** Golden-Test gegen **unabhängige** Referenz (Sollwert aus der eigenen Formel
belegt nichts) · `// Quelle:` + Toleranz je Fixture · pure Engine in `lib/` (kein DB-Zugriff,
kein `new Date()`, kein Mandanten-Kontext) · Verhalten auf der Grenze (`≥`/`>`), Rundung, Einheiten ·
Golden-Werte nie blind nachziehen · fehlende ableitbare Pflicht-Eingaben?

**Mandanten/Security:** JEDE Query nach `organizationId` gefiltert — auch Count, Export, Suche,
Einzelabruf per ID · fremde Org ⇒ 404 ohne Leck über Fehlertext · kein PII-Logging, keine Secrets
im Client-Bundle · JSON-Felder per read-modify-write, nie ersetzen.

**Geld-Pfad:** nicht dein Bereich — berührt eine Spec Checkout, Webhooks, Refunds oder Abos, wird
dieser Teil herausgeschnitten und geht als Backlog-Punkt an Jonas. Frist-Anker: nie aus `new Date()`,
immer aus gespeicherten Daten.

**Schema/Migration:** additiv, Rückwärtspfad benannt · Bestandsdaten (NULL, Dubletten) vorher
gemessen · verlustbehaftet ⇒ Jonas, nicht fächerbar.

## Schritt 5 — der Bau-Prompt (`prompt-<paket>-bau.md`, ≤ ~60 Zeilen)

```markdown
---
kette: <thema>-<paket>
schritt: 1/2
danach: <HOME>/jfk-apps-werkstatt/.wellen/<datum>-<thema>/prompt-<paket>-review.md --fable
---
# Bau: <Aufgabe in einem Satz>

## Erstes
1. Spec lesen (<absoluter Pfad>) — bindend, Entscheide nicht neu diskutieren.
2. `wt.mjs neu <app-repo> <branch>` — nur im Worktree arbeiten.
3. HEAD gegen den Spec-<sha> prüfen; weicht er ab, sind alle datei:zeile-Angaben erst nachzumessen.

## Kontext
Nach jeder Compaction diese Datei + Spec neu lesen. Früh und klein committen. Recon über > 3 Dateien
an Agent `recon` (haiku) oder `minimax-task`.

## Auftrag
<3–6 Zeilen, Verweis auf Spec-Abschnitte>. Die Spec-Tests sind Pflicht.

## Gate (vor dem Schlussbericht)
`npm --prefix <wt> run typecheck` (setzt den Node-Heap; `npx --prefix <wt> tsc --noEmit` nur, wo es kein Script gibt) · `npm --prefix <wt> run lint` · `npm --prefix <wt> run test` ·
`npm --prefix <wt> run build`. Rot ⇒ nicht fertig. Bestands-Rot vorher als Baseline messen.

## Grenzen
Kein Merge, kein Push nach main. Nie `cd` in Bash — absolute Pfade, `git -C`, `npm --prefix`.
<Scope-Sperren aus der Spec>

## Offene Entscheidungen
- Selbst (konservativ) + als Abweichung melden: <…>
- Stoppen und melden: <alles aus „Was bei Jonas bleibt" und jede Spec-Lücke>
```

Pfade im Frontmatter absolut ausschreiben (`<HOME>` = dein Home-Verzeichnis), nie `~`.
Gate-Meldung und Schlussbericht-Block hängt `claude-spawn` selbst an — nicht wiederholen.

## Schritt 6 — der Review-Prompt (`prompt-<paket>-review.md`)

Frische Session, kennt den Bau nicht. **Ein Prüfer je Stand:** dieser Review-Spawn ODER
`gegenleser` in der Session — nie beide.

```markdown
---
kette: <thema>-<paket>
schritt: 2/2
nach: <HOME>/jfk-apps-werkstatt/.wellen/<datum>-<thema>/prompt-<paket>-bau.md
---
# Review: <Aufgabe in einem Satz>
Ein grünes Gate beweist, dass es baut — nicht, dass es richtig ist. Dein Verdikt ist die
einzige Korrektheitsquelle.

## Erstes
1. Spec lesen. 2. `claude-spawn --ernte` → Inbox des Bau-Jobs (Worktree, Branch, Gate).
3. Umfang messen: `git -C <wt> log --oneline main..HEAD`, `git -C <wt> diff --stat main...HEAD`,
   dann je Datei gezielt. 4. Befunde laufend in `befunde-<paket>.md` notieren (übersteht Compaction).

## Urteilen
- Jedes Abnahmekriterium einzeln: erfüllt · nicht erfüllt · nicht geprüft · aus dem Scope genommen —
  je mit Beleg (`datei:zeile`, Testausgabe). `nicht erfüllt`/`nicht geprüft` ⇒ `nacharbeit`;
  ein neuer Backlog-Punkt ersetzt nie ein verfehltes Kriterium.
- Negativraum-Checkliste abfahren; mindestens EINEN Sollwert bzw. eine Zugriffsgrenze selbst prüfen.
- Tests: wären sie am alten Stand rot gewesen?
- **Runde ≥ 2 ist eine Nachprüfung:** nur Befundliste + Nacharbeits-Diff; unberührte, schon erfüllte
  Kriterien mit Herkunftsvermerk übernehmen.

## Handeln
- Kleines selbst fixen (im selben Worktree), Gate erneut, Fix im Bericht ausweisen.
- Strukturelles: Befundliste — je Befund `### B<n>` mit `anforderung` (oder Ausfallszenario) ·
  `beleg` · `abschluss` · `klasse` (K1–K4) · `weg` (`fehler`|`beleg-fehlt`|`bericht`).
  Wünsche als EINE Sammelzeile. Prüfen: `spawn-ernte-befunde.js pruefe <datei>`.
- Verdikt: `claude-spawn --ernte <job> ok|verworfen "<Notiz>"` bzw.
  `claude-spawn --ernte <job> nacharbeit --ursache <implementierung|beleg-fehlt|falschmeldung|review-anweisung|kappung|spec|umgebung> --befunde <datei> "<Notiz>"`.
- Meldet das Review „entspricht der Spec, keine Abweichung", schreib genau diesen Satz in den Bericht
  (er ist bei kritischen Klassen die Merge-Voraussetzung).
- Kein Merge, kein Push.

## Report
Tabelle Kriterium | Zustand | Beleg | selbst gefixt? · Verdikt · offene Punkte.
```

## Schritt 7 — Startzeile + Backlog-Anker

```
! claude-spawn ~/jfk-apps-werkstatt/.wellen/<datum>-<thema>/prompt-<paket>-bau.md
```

Den Review startest du nicht von Hand vorab: der Wrapper blockt ihn, solange der Bau läuft;
`claude-spawn --ernte --wartet` zeigt ihn als startbar, die Ernte mit `ok` legt die Zeile
(`… prompt-<paket>-review.md --fable`) in die Zwischenablage. Kein Auto-Start.
Bau = Opus + high (Default, kein Flag); Review = `--fable`, weil dort geurteilt wird.

**Anker:** EIN Punkt über `/offen` (GET vor POST gegen Dubletten): Titel
`[Spawn] <Etappe> — Review ausstehend`, `notes` = Pfade der drei Dateien + Ursprungs-UUID.
Nach dem Start mit `claude-spawn --ernte --punkt <job> <uuid>` verknüpfen. Den Ursprungspunkt
nicht abhaken — das macht das Review-Verdikt.

## Schritt 8 — Ausgabe
1. Eine Zeile: Klasse · Kern · was gefächert wird. 2. Die drei Pfade. 3. Startzeile als ein
Code-Fence. 4. Backlog-Anker (Titel + UUID). 5. „Bei dir liegt:" (Jonas-Punkte oder „nichts").

## Regeln
- Die Spec ist das Produkt; wer den Prompt fachlich auflädt, erzeugt zwei Wahrheiten.
- Keine Secrets in Spec oder Prompt — nur Tresor-Schlüsselnamen.
- Worktrees nur als absoluter Pfad. Eine Bau-Session je Worktree; mehrere Pakete im selben Repo
  bekommen je einen eigenen Worktree oder laufen nacheinander.
- Ab 2 parallelen Paketen: Statusdatei `WELLE.md` im selben Ordner anlegen und `/dirigent` fahren.
