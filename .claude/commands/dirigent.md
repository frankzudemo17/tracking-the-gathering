---
description: "Orchestrator-Session für eine triagierte Welle oder Kette: Gate-Interview vorn (alle Entscheide in EINEM Block mit ⭐-Empfehlung), danach alles Startbare parallel starten, still per Monitor warten, Ketten fortführen, Verdikte ernten, Merge-Zug fahren — zustandslos über WELLE.md, jederzeit restartbar. TRIGGER: /dirigent, Welle dirigieren, Orchestrator-Session, alles starten, Spawns durchorchestrieren, Kette durchziehen."
argument-hint: "<pfad zu WELLE.md> [--weiter] — --weiter = Fortsetzung nach Übergabe (Interview entfällt, Stand aus der Datei)."
---

# /dirigent — die Welle durchdirigieren

**User-Input:** $ARGUMENTS

Du bist die EINE Session, die eine triagierte Welle vom ersten Start bis zum Merge durchzieht.
Alle Rückfragen an den Nutzer (Franco) fallen **vorn** in einem Block; danach fährst du autonom,
so parallel wie die Worktrees es erlauben.

**Kein Urteil, nur Dispatch.** Du liest keine Diffs, keine Transkripte, keine Specs über den Kopf
hinaus; du reviewst nichts und erfindest keinen Entscheid — die Urteile fallen in Triage (Skill
`spec-welle`), Spec (`/faecher`) und Review. **Zustand liegt in `WELLE.md`, nicht im Kontext:** jede
Phase ist aus Datei + `claude-spawn --laufend/--ernte` rekonstruierbar, ein Session-Wechsel ist
eine Etappe, kein Absturz.

Ablage der Welle: `~/jfk-apps-werkstatt/.wellen/<datum>-<thema>/` mit `WELLE.md`, `spec-<paket>.md`,
`prompt-<paket>-bau.md`, `prompt-<paket>-review.md`, `befunde-<paket>.md`.

## Phase 0 — Lage (EIN Bash-Bündel)

`sed -n 1,60p WELLE.md` · `grep -n "^## \|^Dirigent-Stand" WELLE.md` · `claude-spawn --laufend` ·
`claude-spawn --ernte` · `claude-spawn --ernte --wartet` · `wt.mjs liste` ·
je App-Repo `git -C <repo> fetch -q && git -C <repo> rev-parse --short origin/main`.

Dann die Gates, je ein Satz im Report:
1. **Stand `triagiert`** (bei `--weiter`: `läuft`). Sonst Abbruch mit Verweis auf Skill `spec-welle`.
2. **Baseline grün und aktuell:** Baseline-SHA in `WELLE.md` == `origin/main`. Sonst neu messen
   (tsc · lint · test · build per `npm --prefix`) und fortschreiben. Rot ⇒ Abbruch, Baseline-Fix zuerst —
   auf roter Baseline ist kein Bau-Gate deutbar.
3. **Repo-Kollision:** fremder offener Worktree mit Berührung der Paket-Dateien ⇒ Frage ins Interview,
   nie stillschweigend parallel.
4. **Arbeitskopf klein:** `WELLE.md` > ~20 kB ⇒ erst Archiv-Schnitt (siehe Übergabe).
5. **Lebendprobe:** die Session aus der letzten `Dirigent-Stand:`-Zeile gegen `claude-spawn --ernte --lage`
   prüfen. Lebt sie ⇒ nicht dirigieren, nachfragen — zwei Dirigenten starten Zwillinge.

Bei `--weiter` und vorhandenem `## Dirigat`: Phase 1 überspringen, mit der GEMESSENEN Lage weiter
(laufende Jobs aus `--laufend`, nicht aus der Notiz).

## Phase 1 — Gate-Interview (entfällt, wenn `## Dirigat` existiert)

Alles Offene in EINEN nummerierten Block, Antwort als Kurz-Zuruf („1b 2a 3 ok"):
1. **Entscheide** — je Zeile: Nummer · Frage in fünf Worten · Optionen · ⭐ mit Grund.
2. **Spec-Annahmen bestätigen** — je Spec eine Zeile mit den gesetzten Parametern.
3. **Betrieb** — Merge inline am Ende (⭐ ja, solange die Session frisch ist) oder Übergabe.

Keine Frage ohne ⭐. Fehlt die Empfehlung in Datei und Spec: Frage trotzdem stellen, Triage-Mangel
als Satz melden.

**Punkte aus „Was bei Jonas bleibt" werden NICHT erfragt.** Sie gehen als Paket mit Spur `entscheid`
in `WELLE.md` (eine Zeile unter „Bei dir liegt:"), das Paket ruht; der Rest der Welle läuft.

**Nach der Antwort, vor dem ersten Start:**
- `## Dirigat` schreiben (Format unten): gewählte Option je Entscheid, wörtlich mit Datum.
- Folgen sofort ausführen: Backlog-Pflege über `/offen` (`geparkt`, `[Entschieden]`, `Überholt:`).
- Weicht eine Wahl vom ⭐ ab und die Spec trägt den ⭐-Wortlaut: Paket NICHT starten, als
  „braucht Spec-Revision" melden — der Dirigent schreibt keine Specs.
- Startbedingungen in `WELLE.md` gegen die Antworten auflösen ⇒ Startbar-Liste.

## Phase 2 — Takt (bis alle Pakete `fertig` / `entscheid` / `kundenfrage` / `überholt`)

### 2a Startbar ermitteln
Vereinigung aus: Startzeilen in `WELLE.md` mit erfüllter Bedingung · `claude-spawn --ernte --wartet`
(✅ startbar) · Zwischenablage nach einer `ok`-Ernte (dieselbe Zeile, nicht doppelt starten).
**Alles Startbare startet in DIESEM Takt**, nie „erst A, dann schauen". Grenzen:
- **WIP-Deckel ~3 offene Branches je App-Repo**; zwei Pakete im selben Worktree nie parallel.
- **Zwilling-Check gatet den Start**, er druckt nicht nur:
  `[ -z "$(grep -l "^prompt_datei: .*<prompt-basename>" ~/.spawn-ergebnisse/<YYYYMMDD>-*.md /dev/null)" ] && claude-spawn …`
  (mit `^prompt_datei:`-Anker, sonst trifft die `danach:`-Zeile des Bau-Jobs). Inbox-Dateien heißen
  `<YYYYMMDD>-HHMMSS-PID.md` (Datum ohne Bindestriche); `/dev/null` ist Pflicht-Argument — trifft das
  Glob keine Datei, liest `grep` sonst stdin, der Bash-Call hängt still und der Spawn startet nie. Nach einem
  abgebrochenen Start-Call ist dieser Check Pflicht — der Spawn läuft oft trotzdem.
- **Ernte und Start nie in einer Kette:** die Ernte fährt das Gate und dauert Minuten.

### 2b Starten
- Alle Starts eines Takts in EINEM Bash-Call; danach einmal `claude-spawn --laufend` — eine Startzeile
  ohne Prozess ist kein Lauf. Job-ID + Session-ID sofort in `WELLE.md` (Station, Zeitlinie).
- Bau: `claude-spawn <prompt-bau.md>` (Opus + high ist Default). Worktree legt der Prompt an (`wt.mjs neu`).
- Review-Folgeschritt: Flags aus der `danach:`-Zeile übernehmen, nie raten. Exit 2 (Vorgänger läuft
  oder trägt `nacharbeit`) ⇒ nicht `--trotzdem`, Takt beenden — der Ledger hat recht, nicht die Inbox.
- **Ein Prüfer je Paket und Stand:** Review-Spawn ODER `gegenleser`, nie beide.
- **Weisungen leben nur im `## Dirigat`.** Prompts verweisen darauf („bindend ist `## Dirigat` in
  <WELLE.md>"); kommt eine neue Weisung, alle ungestarteten Prompts nachziehen und laufenden
  Spawns die Korrektur per SendMessage zustellen, soweit erreichbar.

### 2c Warten — EIN persistenter Monitor, kein Polling im Kontext
Weck-Kanal ist die Statuszeile der Inbox. Nimm das `Monitor`-Werkzeug (`persistent: true`), keinen
Bash-Hintergrund-Warter mit `sleep` — solche Warter werden still beendet und sehen dann aus wie
„läuft noch". Ein Monitor für die ganze Welle, gefiltert auf die eigene Session:

```bash
setopt NULL_GLOB                     # Pflicht: ohne stirbt die Schleife, sobald alles geerntet ist
MEINE="<eigene-session-id>"          # nach Restart: |<vorgaenger-id> anhängen
typeset -A seen; init=1
while true; do
  for f in ~/.spawn-ergebnisse/*.md; do
    [ -f "$f" ] || continue
    j=$(basename "$f" .md)
    pid=$(grep -m1 '^parent_session_id:' "$f" | awk '{print $2}')
    [ -n "$pid" ] && [[ ! "$pid" =~ ^($MEINE) ]] && continue   # Präfix-Match, kein $-Anker
    s=$(grep -m1 '^status:' "$f" | awk '{print $2}'); [ -z "$s" ] && continue
    if [ "${seen[$j]}" != "$s" ]; then
      [ -z "$init" ] && [ "$s" != "laeuft" ] && echo "JOB $j -> $s"; seen[$j]=$s
    fi
  done
  init=""; sleep 45
done
```
- **Fail-open:** übersprungen wird nur eine FREMDE ID; fehlt das Feld, weckt der Job mit.
- **Positivprobe vor dem Aufsetzen:** `grep -lE "^parent_session_id: ($MEINE)" ~/.spawn-ergebnisse/*.md /dev/null`
  muss die eigenen Jobs nennen — 0 Treffer heißt „Filter falsch", nicht „keine Jobs".
- **Stillstand meldet sich nicht über die Statuszeile.** Je Takt für eigene `laeuft`-Jobs den
  `--laufend`-Block per **Session-ID** (nicht Prompt-Name) prüfen: `permission prompt|dialog open` ⇒
  Hang; `API Error|Connection lost` oder Prozess verschwunden ⇒ tot. Reaktion: `--blick <sid>`,
  Worktree-Commits messen, `--ernte <job> verworfen "<Befund>"`, Prompt-Kopf „Worktree existiert —
  dort weiterarbeiten" (bei Hang zusätzlich „nie `cd` in Bash"), EIN Neustart.
  **Eine idle-Kopfzeile allein belegt „tot" nicht:** ein Spawn mitten in einer langen Messung (Tests, Browser, Build) zeigt
  kurz idle, obwohl er arbeitet. „Tot" erst, wenn zusätzlich `--blick` keine Bewegung zeigt und seit ≥ 5 min kein
  frischer Commit liegt (`API Error|Connection lost` gelten sofort). Fenster um die Job-Zeile eng halten (`-B2 -A2`).
- Kommt eine `killed`-Meldung des Monitors: erst `--laufend` messen (die Spawns leben fast sicher),
  nur den Monitor neu aufsetzen. Beim Start eines Kettenfolgeschritts die Prozess-Probe auf die neue
  Session-ID umstellen. Am Etappenende `TaskStop`.
- Deploy-Status wird im nächsten Takt GEMESSEN (`live-verify`), nicht bewacht.

### 2d Wake verarbeiten (Ereignis ⇒ Reaktion, ohne Deutung)
Verdikt-Handwerk (Stichprobe, Befundliste, Ernte-Form): `/ernte`. Inbox nur bis Frontmatter + ~30 Zeilen lesen (`sed -n 1,45p`), nie Transkript oder Diff.

| Ereignis | Reaktion |
|---|---|
| Bau `fertig` | Review-Folgeschritt starten (2a/2b). Gate-Meldung nur in die Zeitlinie — darüber urteilt das Review. |
| Bau `blockiert` | Offene Punkte lesen. Beantwortet das Dirigat die Frage ⇒ Antwort oben in den Prompt, EIN Neustart. Liegt sie bei Jonas ⇒ Paket `entscheid`; braucht sie eine Kundenantwort ⇒ `kundenfrage`, Paket ruht. Sonst Rückfrage mit ⭐. |
| Review `ok` | Bau-Job ernten, falls noch in der Inbox (`claude-spawn --ernte <bau-job> ok "Review <job>: ok"`), dann den Review-Job. Paket ⇒ `fertig — wartet Merge`. Worktree stehen lassen (das Ernte-Gate misst dort). |
| Review `nacharbeit` | EINE Runde: Nacharbeit-Prompt (2e) starten, danach Nachprüfung. Zweite `nacharbeit` ⇒ Rückfrage mit Befundliste. |
| Review `verworfen` / Vorbehalt | Paket aus dem Merge nehmen, Rückfrage. |
| Inbox-Datei weg | Jemand hat geerntet: `claude-spawn --ernte --verlauf 6` liefert das Verdikt. |
| Antwort im Chat | Wörtlich mit Datum ins `## Dirigat` — ein Entscheid nur im Chat ist beim `--weiter` weg. |

Nach jeder Reaktion: Paketzeile + Zeitlinie in `WELLE.md`, dann **sofort 2a**, erst dann warten.

### 2e Nacharbeit-Prompt (`prompt-<paket>-nacharbeit.md`)
```
---
kette: <kette>
schritt: 3/4
nach: <abs. pfad review-prompt>
danach: <abs. pfad review-prompt> <review-flags>
---
# Nacharbeit: <Paket> — Befunde aus Review <job>
Worktree <pfad>, Branch <branch>. Lies befunde-<paket>.md und die Spec. Behebe GENAU die blockierenden
Befunde, nichts weiter. Gate: tsc · lint · test · build per npm --prefix. Kein Merge, kein Push.
```
Vor dem Start des Folge-Reviews dessen Frontmatter umhängen (`schritt: 4/4`, `nach: <nacharbeit.md>`),
sonst blockt der Wrapper am alten Vorgänger. Das Folge-Review ist eine **Nachprüfung** über
Befundliste + Nacharbeits-Diff, kein Vollreview.

## Phase 3 — Merge-Zug

Ein Paket wird gemergt, wenn: **Gate grün (4 Stufen) · Review-Verdikt `ok` · kein Punkt aus „Was bei
Jonas bleibt" im Diff.** Bei Schema-/Migrations-, Rechen- oder Mandanten-Pfaden zusätzlich:
das Review meldet „entspricht der Spec, keine Abweichung" — sonst Rückfrage mit Befund, nie nur „GO?".
Destruktive Migration, Geld-Pfad oder Live-Schaltung ⇒ Paket `entscheid`, Jonas.

Ablauf je App-Repo: je Paket `git -C <repo> merge --no-ff <branch>` in Reihenfolge der `WELLE.md`
(Konflikt ⇒ Paket zurück auf `nacharbeit`, Rest weiter) · wurden Dateien gelöscht, einmal
`rm -rf <repo>/.next` · EIN Gate (tsc · lint · test · build) · EIN Push `main` · Live-Abnahme mit Agent
`live-verify` (HTTP-Status + Bild, 375 px) · `wt.mjs fertig`. Rot nach dem Merge ⇒ Merge zurücknehmen,
Paket `nacharbeit`.
Inline nur, solange die Session frisch ist (< ~120 Requests); sonst Übergabe — der Merge-Zug ist die
kontextteuerste Etappe.

**Abnahme vierwertig in `WELLE.md`:** je Kriterium erfüllt · nicht erfüllt · nicht geprüft · aus dem
Scope genommen, mit Beleg. „Nicht messbar" ist `nicht geprüft`. Ein neuer Backlog-Punkt ersetzt nie
ein verfehltes Kriterium — das Paket bleibt offen.

Abschluss-Block: Ergebnis mit Belegen (Commit, HTTP-Status, URL) · „Ins Backlog geschrieben:" ·
„**Bei dir liegt:**" (Jonas-Punkte mit Anker, sonst „nichts").

## Kontext-Diät
- Nie: Transkript, Worktree-Diff, Spec-Volltext, Build-Logs; `--blick` nur bei Hang/Tod.
- `WELLE.md` nach Phase 0 nur noch schreiben (Edit mit eindeutigem Anker), nicht neu lesen.
- Messungen eines Takts in EINEM Call, Starts in EINEM Call, dann warten.
- **Kappung bei ~120 Requests oder ~200k Kontext:** Übergabe statt Durchziehen.

## Übergabe (`--weiter`)
1. **Archiv-Schnitt:** alles außer Kopf, Pakete-Tabelle, `## Dirigat`, Zeitlinie und neuer
   `Dirigent-Stand:` wandert nach `WELLE-archiv.md` (Ziel ≤ ~20 kB; das Archiv liest niemand mehr).
2. `Dirigent-Stand:`-Zeile schreiben — die einzige Quelle des Nachfolgers.
3. Monitor mit `TaskStop` beenden; der Nachfolger setzt ihn in Phase 0 neu auf.
4. Startzeile als Code-Fence: `/dirigent <pfad>/WELLE.md --weiter`.

## Rote Flaggen (STOPP)
- „Ich schaue kurz in den Diff, ob das Review recht hat" → du liest Verdikte, du fällst keine.
- „Ich starte A jetzt und B, wenn A läuft" → alles Startbare in einem Takt.
- „`--trotzdem`, die Inbox sagt doch fertig" → der Ledger schlägt die Inbox.
- „Die zwei Zeilen Nacharbeit baue ich schnell selbst" → Nacharbeit-Prompt, Kette, Nachprüfung.
- „Das ist fast ein Preis-/Live-Thema, ich erledige es mit" → `entscheid`, Jonas.
- „Der Monitor schweigt, also passiert nichts" → Positivprobe und `--laufend` messen.

## Formate in `WELLE.md`
```markdown
Dirigent-Stand: <session-kurz-id> · seit <datum hh:mm> · Wakes <n> · gestartet: <paket>=<job|sid> … ·
  wartet auf: <jobs> · erledigt: <pakete> · bei Jonas: <liste>

## Dirigat (Interview <datum hh:mm>, Antwort wörtlich: „…")
- Entscheid 1 (<kurz>): <Option> ⇒ <Aktion, z. B. Punkt geparkt>
- Spec <paket> Annahmen: bestätigt | korrigiert: <was>
- Merge: inline | Übergabe
- entscheid (Jonas): <paket> — <Punkt aus „Was bei Jonas bleibt">
```
Zeitlinie: je Start, Gate, Verdikt, Merge eine Zeile.
