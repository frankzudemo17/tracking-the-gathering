---
description: "Aufgabe an eine Hintergrund-Session delegieren (Fall A, Default = Direktstart via claude-spawn) oder laufende Arbeit an eine frische Session übergeben (Fall B, via /stand). Inkl. Spur-Zerlegung, Modell/Effort, Scope-Sperren, Kontext-Budget. TRIGGER: /handoff, delegieren, spawnen, auslagern, übergeben."
argument-hint: "Thema/Aufgabe (optional: 'x3' = parallele Slices; 'weiter' = Fortsetzung; 'copy-paste' = nur Prompt-Block statt Direktstart)"
---

> **Effort: medium** — der Wert liegt in der Verdichtung verifizierter Fakten, der Rest ist Vorlage.

# /handoff — Auftrag für eine neue Session

**User-Input:** $ARGUMENTS

## Fall bestimmen (zuerst)

- **Fall A — Delegation:** Eine (Teil-)Aufgabe geht an eine Hintergrund-Session (`claude-spawn`);
  diese Session arbeitet weiter oder wartet still.
- **Fall B — Fortsetzung:** Die LAUFENDE Arbeit zieht in eine frische Session um (Kontext
  > ~150k, ~150 Requests). Erkennbar an „weiter"/„fortsetzen" oder fehlendem neuem Thema.
  → Kein eigenes Format: **`/stand`** schreiben (`docs/stand/<datum>-<thema>.md` im App-Repo,
  vorher uncommittete eigene Arbeit als WIP-Commit sichern), dann genau EIN Code-Fence ausgeben:

  ```
  claude --model opus
  Lies ~/jfk-apps-werkstatt/<app-repo>/docs/stand/<datum>-<thema>.md und arbeite dort weiter. Erst `git -C <worktree> log -1` + `claude-spawn --laufend` gegen den Stand messen.
  ```

  Danach endet diese Session hart (Abschlussblock mit „Bei dir liegt:", dann Schluss). Das
  Modell der Fortsetzung folgt der RESTarbeit, nicht dieser Session.

Kritische Klassen — **Rechen-/Norm-Logik, Mandantentrennung, Schema/Migration** — gehen nicht über
diesen Command, sondern über **`/faecher`** (Geld-Pfade und Wettbewerbstexte gar nicht: → Jonas): dort ist die Spec das
Produkt, nicht der Prompt. Nie delegierbar: Merge-Entscheid bei Abweichung, Live-Schaltung,
Preise, destruktive Migration (Jonas).

## Kernprinzip

Die neue Session kennt NICHTS aus diesem Gespräch — nur den Prompt und das Repo. Also:
jede Referenz als absoluter Pfad, jeder Fakt mit Mess-Stand (Commit-SHA), jede Vorentscheidung
explizit, Definition of Done statt vager Auftrag. Der Prompt läuft in JEDEM Request der neuen
Session mit: **≤ ~80 Zeilen**. Längeres (Befundlisten, Spec, Recherche) als Datei daneben legen
und nur den Pfad nennen.

**Ablage:** `~/jfk-apps-werkstatt/.wellen/<datum>-<thema>/` — für Einzelaufträge dort
`einzel/prompt-<thema>.md`; gehört der Auftrag zu einer Welle, liegen Prompt, Spec und
Befundliste im Wellen-Ordner neben `WELLE.md`.

## Ablauf

### 1. Aufgabe schärfen
Was genau soll passieren, woran ist es fertig? Mehrere unabhängige Teile („x3") in disjunkte
Slices schneiden, die sich keine Dateien teilen — sonst Merge-Chaos. Scope-Sperren kreuzweise.

### 2. Fakten sammeln — in EINEM Bash-Call
Repo + Branch + `git rev-parse --short HEAD`, betroffene Dateien (`datei:zeile`), Referenz-Commit,
offene Änderungen, laufende Delegationen (`claude-spawn --laufend`, `claude-spawn --ernte`).
Was diese Session schon gemessen hat, nicht neu messen — mit Stand übernehmen. Läuft die Arbeit
bereits oder liegt ein ungeerntetes Ergebnis vor: nicht neu starten, sondern `/ernte`.

### 3. Unknowns kartieren
Je offene Entscheidung festlegen: **selbst entscheiden** (konservative Option, als Abweichung
loggen) oder **stoppen und melden**. Preise, Geld, Live-Schaltung, destruktive Migration,
Domains/DNS sind IMMER Stopp — das entscheidet Jonas. Zentrale Unknowns vor dem
Schreiben klären (max. 3 Fragen, eine nach der anderen).

### 4. Spur-Zerlegung — EINE Zeile, vor dem Prompt
Format: `Spuren: Recon → minimax-task · Bau → claude-spawn · Session → <benannter Grund>`.
- **Recon-Masse** (Inventar, „wo steht X", Scan über > 3 Dateien) → `minimax-task` (read-only,
  Ergebnis ist ein Bericht, Stichprobe durch Claude) oder Agent `recon` (`model: haiku`). Ist die
  GANZE Aufgabe Recon: kein Handoff, direkt den Recon-Auftrag geben.
- **Diff-Arbeit mit Spec + Spec-Tests + Gate** → `claude-spawn` im Worktree (`wt.mjs neu`).
  Prüfbarkeit ist das Kriterium, nicht Komplexität.
- **Session selbst** baut nur mit **benanntem Grund** (z. B. „< 30 Zeilen, Ursache vermessen",
  „braucht Rückfragen mittendrin"). Ohne Grund wird delegiert.
- **Review** → Agent `gegenleser` (`model: opus`) oder Review-Spawn — EIN Prüfer je Stand.

### 5. Modell + Effort (eine Zeile Begründung)
- **Opus + high** ist der Wrapper-Default — für alles ohne Urteils-Kern.
- **`--fable`** nur begründet: Strategie, Design-Urteil, kritisches Review.
- `--model opus --effort medium` für mechanische Arbeit mit starkem Gate (Port nach Referenz).
- `xhigh`/`max` nur für Einzel-Urteile ohne Gate, nie als Default.

### 6. Prompt komponieren
Abschnitte streichen, die nicht zutreffen — kein Boilerplate:

```
# <Aufgabe in einem Satz>

## Kontext (gemessen gegen <repo> <sha>, <datum>)
- Beim Start HEAD neu messen; weicht er ab, sind alle datei:zeile-Angaben ungeprüfte Prämissen.
- <Fakten mit Pfaden, Commits> · Lies zuerst: <Spec/Referenz-Datei, absolut>

## Kontext-Budget
- Dieser Auftrag: <absoluter Pfad> — nach jeder Compaction neu lesen.
- Befunde sofort nach <absoluter Pfad der Notizdatei> schreiben, nicht erst in den Schlussbericht.
- Große Dateien nur ausschnittweise (Read mit offset/limit); Recon > 3 Dateien → minimax-task
  oder Agent recon, nur Fundstellen inline.

## Aufgabe
<Schritte oder Ziel> · Definition of Done: <messbar>

## Scope-Sperren
- NICHT anfassen: <Pfade/Repos, an denen parallel gearbeitet wird>

## Offene Entscheidungen
- Selbst entscheiden (konservativ, unter „Abweichungen" loggen): …
- Stoppen und melden: …

## Regeln
- Rolle: <Bau | Review (nur lesen) | Recon (nur lesen)> · Schreibpfade: <Worktree/Dateien oder „keine"> · Ergebnis: <Commit auf Branch X | Bericht in der Inbox> — gilt genauso für Fork-/Subagent-Aufträge: ein Fork erbt den Kontext der Hauptsession und schreibt nichts, wenn ihm niemand sagt, dass ER die Datei schreibt
- ERSTER Schritt: `wt.mjs neu <app-repo> <branch>` (Haupt-Tree-Guard blockt sonst).
- Gate: `npx --prefix <wt> tsc --noEmit` · `npm --prefix <wt> run lint` · `run test` · `run build`;
  danach `spawn-ledger gate selbst gruen|rot|kein_gate "<Detail>"`.
- Committen im Worktree, NICHT mergen, NICHT pushen.
- <nur aufgabenspezifische Regeln; die Kit-CLAUDE.md lädt ohnehin>

## Report am Ende
Abnahme-Tabelle je Kriterium: erfüllt · nicht erfüllt · nicht geprüft · aus dem Scope genommen,
mit Beleg (Commit, datei:zeile, Gate-Ausgabe). Dazu „Abweichungen" (je 1 Satz Grund) und
`## Weglassungen` (`- keine` oder `- <Gate> · <Grund> · Abschluss blockiert: ja|nein`).
```

Regeln der Kit-`CLAUDE.md` nicht wiederholen — die neue Session lädt sie, sofern sie in
`~/jfk-apps-werkstatt` startet. Keine Secrets in den Prompt, nur Tresor-Namen.

### 7. Starten (Fall A, Default)
Ein nie gestarteter Prompt ist verlorene Arbeit — darum wird Fall A gestartet, nicht ausgegeben.

1. **Eignung prüfen — auf Copy-paste kippen**, wenn Rückfragen/Freigaben mittendrin erwartbar
   sind (eine Hintergrund-Session steht dann stumm), der Auftrag interaktive Browser-/MCP-Schritte
   braucht oder `$ARGUMENTS` „copy-paste"/„nur prompt" sagt. Begründung in einer Zeile.
   Copy-paste = ein Fence, Zeile 1 der Startbefehl (`claude --model opus`), ab Zeile 2 der Prompt;
   anbieten, ihn per `pbcopy` in die Zwischenablage zu legen.
2. **`pwd` prüfen:** der Wrapper vererbt das cwd — Start aus `~/jfk-apps-werkstatt`, sonst lädt
   die Kit-`CLAUDE.md` nicht.
3. **Prompt-Datei per Write** in die Ablage (s. o.); ihren absoluten Pfad selbst in den
   Kontext-Budget-Block eintragen.
4. **Ketten-Frontmatter**, wenn der Schritt Teil einer Folge ist (Bau → Review):
   ```
   ---
   kette: <id>
   schritt: 1/2
   vertrag: 2
   nach: <absoluter Pfad des Vorgänger-Prompts>      # nur ab Schritt 2
   danach: <absoluter Pfad des Folge-Prompts> --review
   ---
   ```
   `vertrag: 2` macht `nacharbeit` belegpflichtig (`--ursache` + `--befunde`) — Standard.
   Der Wrapper blockt einen Folgeschritt, solange der Vorgänger läuft oder `nacharbeit` trägt
   (`--trotzdem` übersteuert bewusst). Kein Auto-Start: bei `ok` legt die Ernte die nächste
   Startzeile in die Zwischenablage. Nachträglich: `claude-spawn --ernte --kette <job> "<pfad> [flags]"`.
5. **Starten:** `claude-spawn <datei>` (Opus + high) bzw. `claude-spawn <datei> --fable` oder
   `--model opus --effort medium`. Rechte: Default ist die Rechte-Umgehung (Deny-Liste und Hooks
   greifen weiter), `--permission-mode acceptEdits` fährt enger. `--dry-run` zeigt vorher, was startet.
6. **Rückmeldung (nichts zu tun):** Der Wrapper schreibt die Adresse dieser Session
   (`uds:$CLAUDE_CODE_MESSAGING_SOCKET`) in den Kind-Prompt; das Kind meldet sich am Ende direkt
   dorthin — kein Anker, kein ListAgents. Nachprüf-Befunde oder eine zweite Runde gehen per
   SendMessage an die Adresse der noch stehenden Spawn-Session statt als neuer Spawn. Stale wird die
   Adresse nur nach einem Neustart dieser Session; dann bleibt die Inbox der Kanal. `--stumm`
   schaltet die Rückmeldung ab; der Schlussbericht in der Inbox kommt trotzdem.
7. **Backlog-Anker (Pflicht):** über `/offen` EIN Punkt `[Spawn] <Etappe> — Review ausstehend`,
   GET vor POST über alle Status; `notes` = Job-ID + Pfad der Prompt-Datei. Dann verknüpfen:
   `claude-spawn --ernte --punkt <job> <uuid>` (oder beim Start `--punkt <uuid>`). Die Ernte hakt
   ihn beim Verdikt selbst ab; in einer Kette erst der letzte Schritt. 403 = Grenze, melden, kein Umweg.
8. **Melden:** Job-ID, Session-ID, `claude attach <id>` / `claude stop <id>`.
   **Meldet der Wrapper `❌ FEHLSTART` (Start-Selbsttest, Exit 3), obwohl etwas für einen Lauf spricht:** weder ignorieren noch blind neu starten. Prüfen: Session-ID in `claude agents --json` (Zustand, `cwd`), Transcript vorhanden, neue dem Auftrag zuordenbare Ergebnisse (Commits NACH der Startzeit auf dem Auftrags-Branch, Inbox-Datei). Ein Branch, der schon vorher existierte, belegt keinen Lauf. Bis zur Klärung weder „läuft" melden noch einen zweiten Lauf starten (Doppel-Spawn im selben Worktree).

### 8. Danach: still warten, dann ernten
- Eine Session mit laufenden eigenen Spawns erklärt sich NICHT für beendet. Sie arbeitet am
  eigenen Ziel weiter oder wartet still — die Rückmeldung weckt sie als neuer Turn.
  **Kein Log-Polling**, kein `--blick`-Kreisen.
- **Primärkanal ist die Inbox** `~/.spawn-ergebnisse/<job>.md` (Schlussbericht mit `status`,
  Abnahme-Tabelle, `## Weglassungen`); SendMessage ist nur der Wecker. Bleibt er aus, zeigt
  `claude-spawn --ernte` alles Unabgeholte.
- Steht ein Spawn in `claude-spawn --laufend` unter **BRAUCHT DICH** (Permission-Prompt):
  mit `claude-spawn --blick <id>` ansehen, freigeben per `claude attach <id>` — nicht parallel
  neu starten.
- Arbeitet der Spawn woanders als im Start-cwd (Worktree), korrigiert er `cwd:`/`branch:` in
  seiner Inbox-Frontmatter — sonst misst das Ernte-Gate das falsche Repo.
- Abholen mit **`/ernte`**: lesen, Stichprobe, Verdikt. Erst das Verdikt macht ein Ergebnis gültig.

### 9. Mehrere parallele Enden
Fächert eine Etappe in ≥ 2 Spawns auf, gehört sie in einen Wellen-Ordner mit `WELLE.md`
(Statusdatei mit Paketliste, Abnahme-Tabelle, nächstem Schritt) — orchestriert über
`/dirigent` bzw. Skill `spec-welle`, nicht über lose Einzel-Handoffs. Sonst sammelt niemand
die Enden ein.

## Regeln

- Prompt auf die Aufgabe zuschneiden: eine reine Analyse braucht kein Commit-Kapitel.
- Worktrees immer als absoluten Pfad nennen, nie als Etikett („mein Worktree") — die neue
  Session rät sonst, welcher gemeint ist.
- Scope-Sperren aktiv ableiten: Was läuft parallel (`claude-spawn --laufend`, `wt.mjs liste`)?
- Recon-Delegation im Detail: Skill `minimax-delegate`. Abschluss-Prüfung: `/done-check`.
