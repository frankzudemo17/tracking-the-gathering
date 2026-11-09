---
name: spec-welle
description: Backlog-Welle (3–8 Punkte aus /offen) über fünf Stationen abarbeiten - Recon, Triage, Spec, Bau-Spawns, Review/Abschluss - mit WIP-Deckel und Wellen-Statusdatei WELLE.md. TRIGGER - /spec-welle, backlog-welle, welle starten, welle triagieren, welle abschliessen, mehrere backlog-punkte umsetzen. NICHT bei Einzelpunkt kritischer Klasse (/faecher) oder reiner Delegation (/handoff).
---

# Spec-Welle — mehrere Backlog-Punkte über das Fließband

Eine Welle = 3–8 Backlog-Punkte mit klarem Anfang und Ende. Kein Dauer-Modus. Der Skill
liefert die Wellen-Mechanik; Arbeitsweise, Gates und „Was bei Jonas bleibt" stehen in der
Kit-`CLAUDE.md` und gelten vorrangig.

**Abgrenzung:** ein einzelner Punkt kritischer Klasse ⇒ `/faecher`; eine einzelne Aufgabe
auslagern ⇒ `/handoff`; die triagierte Welle parallel starten, warten, ernten, mergen ⇒
`/dirigent` (liest dieselbe `WELLE.md`). Franco startet Spawns und fährt Wellen selbst.

Fünf Stationen, die Session endet jeweils am Ende ihrer Phase (frischer Kontext je Phase):

| Station | Wer | Ergebnis |
|---|---|---|
| 1 Recon | `minimax-task` je Punkt oder Agent `recon` (haiku) | Befund je Punkt mit `datei:zeile`, Write-Set |
| 2 Triage | Session (Fable oder Opus, effort high) | genau eine Spur je Punkt in `WELLE.md` |
| 3 Spec | dieselbe Triage-Session | `spec-<paket>.md` + Prompts je Bau-Paket |
| 4 Bau | `claude-spawn` je Paket im eigenen Worktree | Branch + Schlussbericht in der Inbox |
| 5 Review/Abschluss | Review-Spawn oder `gegenleser`, dann Ernte + Merge-Zug | Abnahme-Tabelle, live, Backlog geschlossen |

Ablage aller Artefakte: `~/jfk-apps-werkstatt/.wellen/<YYYY-MM-DD>-<thema>/` —
`WELLE.md`, `spec-<paket>.md`, `prompt-<paket>-bau.md`, `prompt-<paket>-review.md`,
`befunde-<paket>.md`.

## Station 0 — WIP-Gate (zuerst, in jeder Phase)

```
claude-spawn --ernte --lage     # abholbereite Enden, laufende Spawns
wt.mjs liste                    # offene Worktrees je App-Repo
```

- **Mehr als 4 abholbereite Enden ⇒ keine neue Welle anlegen.** Erst `/ernte` — jede Ernte ist
  ein Verdikt und gehört nicht „nebenbei" in eine Anlage. Triage und Abschluss dürfen trotzdem
  laufen (sie bauen Rückstand ab).
- **WIP-Deckel ~3 offene Branches je App-Repo.** Darüber wird ein Punkt zurückgestellt oder als
  „nacheinander" vermerkt — nie zwei Sessions parallel im selben Tree.
- **Baseline grün ist Startbedingung:** vor den ersten Bau-Spawns `main` des Ziel-Repos messen —
  `npx --prefix <repo> tsc --noEmit` · `npm --prefix <repo> run lint` · `run test` · `run build`.
  Bestands-Rot ⇒ erst ein eigener Mini-Punkt vor der Welle. Grund: sonst kommt jedes Bau-Gate rot
  zurück und muss von Hand gedeutet werden, ohne einen Fehler im Auftragsgebiet.

## Station 1 — Anlage + Recon

1. Punkte ziehen: `/offen` GET über **alle** Status (Dubletten erkennen), Notizen im Volltext —
   Notizen sind append-only, die letzte Zeile kann die erste widerrufen. Sammelpunkte in ihre
   Unterpunkte auflösen, jeder ist ein eigener Messwert. **Maximal 8**, sonst Welle teilen.
2. `WELLE.md` aus der Vorlage unten anlegen (Station `recon`).
3. Recon **parallel**, nicht seriell: je Punkt ein eigener `minimax-task` im Hintergrund mit
   eigener `-o`-Datei im Wellen-Ordner, oder ein `recon`-Agent (`model: haiku`). Skill
   `minimax-delegate` für den Auftragstext. Der Auftrag verlangt je Punkt:
   - Ist die Prämisse noch wahr? Verdikt mit `datei:zeile`, gemessen gegen `origin/main`
     (nie gegen einen Haupt-Tree auf altem Branch).
   - **Drift:** Wie viele Commits seit Anlage des Punkts? Ab ~100 Commits gilt der Punkt erst
     nach frischer Messung als gültig.
   - **Write-Set:** welche Dateien der Punkt anfassen wird.
   - Fundstellen, keine Empfehlungen; jede Negativaussage mit Positivprobe.
4. Recon-Ergebnisse lesen, **Stichprobe gegen echten Code** (Recon-Befunde sind unverifiziert),
   Verdikt mit `minimax-task --verdict <sid> ok|nacharbeit|verworfen` nachtragen.

## Station 2 — Triage (genau eine Spur je Punkt)

| Spur | Kriterium | Ergebnis |
|---|---|---|
| `bau-spawn` | Diff-Arbeit, per Spec + Spec-Tests prüfbar | Spec + `claude-spawn` im Worktree |
| `session` | klein (≲ 1 h, < ~30 Zeilen Diff, keine kritische Klasse) | direkt in der laufenden Session im Worktree |
| `entscheid` | braucht Jonas (Preise, Geld, Live-Schaltung, destruktive Migration, finale Wettbewerbs-Texte …) | ruht; eine Zeile unter „Bei dir liegt:" |
| `kundenfrage` | Zuschnitt hängt an einer Antwort von Kunde/Anwender | ruht; Frage als Textblock im Report |
| `überholt` | Recon widerlegt die Prämisse | mit Beleg schließen (`/offen` PATCH, Notiz „Überholt: …") |

- `entscheid`/`kundenfrage` verlassen das Band und tauchen in keinem Spawn-Prompt auf. „Konservativ
  bauen und die Abweichung loggen" ist kein Ausweg — die Spur heißt Vorlage, nicht Bau.
- **Write-Set-Clustering vor der Spur:** Punkte mit überlappendem Write-Set werden **ein** Bau-Paket
  mit einem Owner — ein Worktree, eine Spec (mehrere Abnahme-Blöcke), ein Review, ein Merge.
  Grund: Parallelität in derselben Datei verschiebt die Arbeit nur in Konflikte und Doppel-Reviews.
  Disjunkte Pakete laufen parallel.
- **Kritische Klasse** (Rechen-/Normlogik, Mandantentrennung/Security, Lead-/DOI-Pfad,
  Schema/Migration) macht das ganze Paket zu `bau-spawn` mit Pflicht-Review — oder wird als eigenes
  Paket herausgeschnitten, wenn ihr Write-Set disjunkt ist.
- **Neues oder geändertes Mess-Gate** (Test-Script, Detektor), auf das andere Pakete ihre Abnahme
  stützen, ist ein eigenes Paket vor allen anderen. Seine Abnahme ist die beidseitige Probe: Verstoß
  einbauen ⇒ rot, zurücknehmen ⇒ grün. Ein Gate, das nie rot war, ist kein Gate.
- Paket-IDs `P1, P2, …` in Spalte 1 der Pakete-Tabelle.

**Review-Tiefe folgt der Spur:**

| Fall | Review |
|---|---|
| `bau-spawn` mit kritischer Klasse | Review-Spawn `--fable` oder `gegenleser` — Pflicht |
| `bau-spawn` ohne kritische Klasse | Review-Spawn (Opus) oder `gegenleser` gegen die Spec |
| `session`, Mini-Diff ohne Schema | Stichprobe beim Merge durch die Session selbst |

Ganz ohne Review geht keine Spur — `nacharbeit`-Fälle hatten fast immer ein grünes Gate.
**Ein Prüfer je Stand** (Review-Spawn ODER `gegenleser`, nie beide). Die Triage- und
Abschluss-Session reviewen Bau-Pakete nicht selbst, sie dispatchen und lesen Verdikte.

## Station 3 — Spec je Bau-Paket

Alle Specs in derselben Triage-Session. Aufbau (Schablone und Bau-/Review-Prompts: `/faecher` —
dort nachschlagen, nicht hierher kopieren):

- **Entscheide** — was fest ist, mit Quelle; offene Entscheide gehören nicht in eine Spec.
- **Nicht-Ziele** und **Write-Set** (Dateien, die der Bau anfassen darf).
- **Abnahmekriterien**, nummeriert, je Kriterium der erwartete **Beleg** (Test, `datei:zeile`,
  HTTP-Status, Bild bei 375 px). Verlangt ein Kriterium eine Messung am laufenden System, nennt die
  Spec vorab Org, Rolle, Datensätze und Zähleinheit — fehlen sie am Abnahmeort, endet das Kriterium
  als `nicht geprüft`.
- **Spec-Tests** mit Sollwert und Quelle (bei Rechnen: unabhängige Referenz, nie die eigene Formel)
  plus Gegenprobe. Tests für Exporte, die es auf der Baseline noch nicht gibt, per dynamischem
  Import im `it` laden — sonst ist die Baseline schon rot (`tsc` sieht Testdateien).
- **Negativraum** — was fehlen könnte: Pflicht-Inputs, Leerzustand, Mandanten-Filter je Query,
  Fehlerpfade, zweite Schreibquelle desselben Felds.
- **Risiko-Szenarien (2–5)** passend zum Anteil (Zustand/Autosave · Rechnen · Mandanten · UI ·
  Ausgabe).
- **Gate-Block** mit den wörtlichen Kommandos: `tsc --noEmit` · `lint` · `test` · `build`
  (`tsc` fehlt nie — `build` und `test` ignorieren Typfehler in Testdateien).
- grep-Kriterien „= 0" immer mit `--exclude-dir=__tests__` und vorher einmal über die ganzen
  Verzeichnisse gefahren — ein Treffer außerhalb des Write-Sets macht das Kriterium unerfüllbar.

Danach je Paket `prompt-<paket>-bau.md` und `prompt-<paket>-review.md` mit Ketten-Frontmatter:

```yaml
kette: <thema>-<paket>
schritt: 1/2            # Review: 2/2
nach: <absoluter Pfad des Bau-Prompts>      # nur im Review-Prompt
danach: "<absoluter Pfad des Review-Prompts> --fable"   # nur im Bau-Prompt
```

Der Wrapper blockt den Review, solange der Bau läuft oder `nacharbeit` trägt; die Ernte legt bei
`ok` die nächste Startzeile in die Zwischenablage. Kein Auto-Start.

## Station 4 — Bau-Spawns

Je Paket:

```
wt.mjs neu <app-repo> <branch>                       # ein Worktree je Paket
claude-spawn <wellen-ordner>/prompt-P1-bau.md --punkt <uuid>
```

- Parallel nur bei disjunkten Repos oder disjunkten Write-Sets, WIP-Deckel beachten.
- Station in `WELLE.md` auf `bau läuft` + Job-ID + Worktree-Pfad.
- Nach dem Start still warten — kein Log-Polling. Blick bei Bedarf: `claude-spawn --blick <job>`,
  Übersicht `claude-spawn --laufend`.
- `session`-Pakete baut die Session selbst im Worktree, mit denselben vier Gate-Stufen.

## Station 5 — Review, Abschluss, Merge

1. **Ernten:** `claude-spawn --ernte` listet die Inbox. Schlussbericht lesen (inkl.
   `## Weglassungen`), Stichprobe gegen den Code, dann den Review-Schritt der Kette starten
   (oder `gegenleser` mit Spec + Diff).
2. **Verdikt:** `claude-spawn --ernte <job> ok|nacharbeit|verworfen ["Notiz"]`. `nacharbeit` braucht
   `--ursache <implementierung|beleg-fehlt|falschmeldung|review-anweisung|kappung|spec|umgebung>`
   und `--befunde befunde-<paket>.md`; die Befundliste vorher mit
   `spawn-ernte-befunde.js pruefe <datei>` prüfen (je blockierender Befund: Anforderung oder
   Ausfallszenario · Beleg `datei:zeile` · prüfbares Abschlusskriterium · Klasse · `weg`).
   **Runde ≥ 2 ist eine Nachprüfung** über Befundliste + Nacharbeits-Diff; Kriterien, die im
   Erstreview erfüllt waren und vom Diff unberührt sind, werden mit Herkunftsvermerk übernommen.
3. **Abnahme-Tabelle** in `WELLE.md` (kein Script): genau eine Zeile je Abnahmekriterium jeder
   Paket-Spec, Zustand ∈ `erfüllt` · `nicht erfüllt` · `nicht geprüft` · `aus dem Scope genommen`,
   Beleg je Zeile. Der Review prüft die Tabelle.
   - Paket ist nur `ok`, wenn alle Kriterien `erfüllt` oder von Jonas `aus dem Scope genommen`
     (Zitat im Beleg) sind — sonst `nacharbeit` oder eine sichtbare `GO-Vorbehalt`-Zeile.
   - „Nicht messbar, kein Befund" ist `nicht geprüft`, kein Grün.
   - **Ein neuer Backlog-Punkt ersetzt nie ein verfehltes Kriterium** — der Ursprungspunkt bleibt offen.
   - Findet der Abschluss einen vom Review übersehenen Mangel, ist das Verdikt falsch: auf
     `nacharbeit` setzen, nicht als Backlog-Notiz neben ein grünes Verdikt legen.
4. **Merge-Zug** — Franco merged selbst, sofort, sobald: Gate grün (alle vier Stufen), Review-Verdikt
   `ok`, nichts aus „Was bei Jonas bleibt" im Diff. Bei Schema/Migration, Rechnen, Mandanten
   nur, wenn das Review „entspricht der Spec, keine Abweichung" meldet — sonst Rückfrage mit Befund.
   Je Paket in der Reihenfolge von `WELLE.md`: merge nach `main` → hat der Merge Dateien gelöscht,
   `rm -rf .next` → vier Gate-Stufen im Haupt-Tree → Push `main`. Rot nach einem Merge ⇒ diesen
   Merge zurücknehmen (nichts gepusht), Paket auf `nacharbeit`, mit dem Rest weiter.
5. **Live-Abnahme** mit Agent `live-verify` (HTTP-Status, gerendertes Bild, 375 px) je betroffener
   Route — erst danach Station `fertig`. Dann `wt.mjs fertig`.
6. **Backlog schließen:** je erledigtem Punkt `/offen` PATCH selbst (Statuspflege gehört zum Fix).
   Randfunde ohne Bezug zum Wellenziel still als neue Punkte anlegen (GET vor POST).
7. `WELLE.md` finalisieren: jede Zeile `fertig`, `bei Jonas` oder `überholt`; Kopf auf
   `Stand: abgeschlossen`.

Funde in der Abschluss-Session werden Backlog-Punkte oder Verdikt-Korrekturen — kein Mitbau.

## Vorlage `WELLE.md`

```markdown
# Welle: <thema> · angelegt <datum> · Stand: <recon|triagiert|läuft|abgeschlossen>
Baseline: <repo> main `<sha>` tsc ✓ lint ✓ test ✓ build ✓ (gemessen <datum hh:mm>)
Recon: <sid/job> · <verdikt> · Befunde: <pfad>

## Pakete
| Paket | Punkt (uuid8) | Repo | Spur | Station | Job · Worktree | Verdikt |
|---|---|---|---|---|---|---|
| P1 | <kurztitel> (<uuid8>) | app-regalscan | bau-spawn | bau läuft | <job> · <wt-pfad> | – |
| P2 | <kurztitel> (<uuid8>) | app-regalscan | session | fertig | <commit> | ok |
| P3 | <kurztitel> (<uuid8>) | – | entscheid | bei Jonas | – | – |

## Abnahme
GO-Vorbehalt <Paket>: <nur wenn nötig — was fehlt, was Jonas entscheidet>
| Paket | Krit. | Zustand | Beleg |
|---|---|---|---|
| P1 | 1 | erfüllt | `src/lib/x.ts:12` · Test `x.spec.ts` grün |
| P1 | 2 | nicht geprüft | Test-Org ohne Datensätze — Messung offen |

## Bei dir liegt:
- <Halbsatz mit Anker (Paket, Datei)> — oder: nichts
```

Stationen: `recon` → `triagiert` → `spec` → `bau läuft` → `review läuft` → `fertig`; Sonderwege
`bei Jonas` · `überholt`. Jede Session, die die Welle berührt, schreibt ihre Zeilen **sofort**
fort — `WELLE.md` ist die einzige Gesamtsicht, die Inbox ist nur Transport. Sie ist ein
Arbeitskopf, kein Journal: alte Zwischenstände fliegen raus.

## Rote Flaggen

- „Den Rückstand ernte ich in der Anlage schnell mit" → Abbruch, `/ernte`.
- „Die Punkte sind frisch, Recon sparen wir uns" → nie Spec vor Recon-Ergebnis.
- „Die drei Reviews mache ich effizient in einer Session" → je Paket ein eigener Prüfer.
- „main ist rot, aber nur Bestand" → erst Baseline grün, dann Welle.
- „Zwei Punkte teilen sich eine Datei, aber je ein Worktree geht schneller" → ein Paket, ein Owner.
- „Das Gate baue ich im ersten Paket mit" → Gate ist ein eigenes Paket mit beidseitiger Probe.
- „Gate grün, das reicht" → ohne Review-Verdikt kein Merge.
- „Kriterium verfehlt, ich lege einen neuen Punkt an und melde ok" → Ursprungspunkt bleibt offen.
