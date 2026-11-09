// npm run e2e — startet tools/serve.mjs (freier Port), führt alle tests/e2e/*.e2e.mjs nacheinander
// aus, räumt die Testdaten ab (finally), beendet den Server.
// Exit 0 = alle Prüfungen grün · 1 = mindestens eine Prüfung rot · 2 = Abbruch aus Umgebungsgründen
// (Browser fehlt, Rate-Limit, Scryfall nicht erreichbar, Aufruf) — nie „grün“.
// Ziel (E1 = A, WELLE.md): Prod-Supabase aus src/config.js; Testkonten bleiben, Lösch-Befehl am Ende.
//   npm run e2e
//   npm run e2e -- --nur-aufraeumen <RUN>     Reste eines abgebrochenen Laufs (Konten aus tests/e2e/out/<RUN>.json)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../../tools/serve.mjs';
import * as h from './harness.mjs';

const DIR = path.join(h.ROOT, 'tests', 'e2e');
const argv = process.argv.slice(2);

async function onlyCleanup(run) {
  const list = h.loadRun(run);
  console.log(`Nur aufräumen: Lauf ${run}, ${list.length} Testkonten (${list.join(', ')}) · Ziel ${h.TARGET.url}`);
  const r = await h.cleanup({ run, list });
  console.log('\n' + h.deleteHint(run));
  return r.problems.length || r.groupsLeft ? 1 : 0;
}

/** Fundstelle (datei:zeile) eines Fehlers in einer *.e2e.mjs, sonst die erste Stack-Zeile. */
function where(e) {
  const lines = String(e?.stack ?? '').split('\n');
  const hit = lines.find((l) => /\.e2e\.mjs:\d+/.test(l)) ?? lines[1] ?? '';
  const m = hit.match(/([^\\/()\s]+\.m?js):(\d+)/);
  return m ? `tests/e2e/${m[1]}:${m[2]}` : hit.trim();
}

async function main() {
  const i = argv.indexOf('--nur-aufraeumen');
  if (i >= 0) return onlyCleanup(argv[i + 1]);

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.e2e.mjs')).sort();
  if (files.length === 0) throw new h.Abort('Aufruf', 'keine tests/e2e/*.e2e.mjs gefunden');

  const server = await serve();
  console.log(`e2e: Lauf ${h.RUN} · Server ${server.url} (Port ${server.port}) · Ziel ${h.TARGET.url} · ${files.length} Datei(en): ${files.join(', ')}`);
  let browser;
  const broken = [];
  let abort = null;
  let cleaned = null;
  try {
    browser = await h.launch();
    for (const f of files) {
      console.log(`\n=== ${f}`);
      try {
        const mod = await import(pathToFileURL(path.join(DIR, f)).href);
        await mod.default({ browser, base: server.url, harness: h });
      } catch (e) {
        if (e instanceof h.Abort) throw e;
        h.counts.fail++;
        const at = where(e);
        broken.push(`${f}: ${at}`);
        console.log(`  ✗ ABBRUCH in ${at}: ${String(e.message).split('\n')[0]}`);
        for (const [n, p] of h.opened) await p.screenshot({ path: path.join(h.OUT, `FEHLER-${h.RUN}-${n}.png`) }).catch(() => {});
        if (h.env.rateLimited) throw new h.Abort('Rate-Limit', 'Supabase-Auth meldet 429 (zu viele Registrierungen/Anmeldungen) — später erneut');
        if (h.env.scryfallDown) throw new h.Abort('übersprungen (Scryfall)', 'Scryfall nicht erreichbar — Deck-Fälle nicht geprüft');
      }
    }
  } catch (e) {
    if (!(e instanceof h.Abort)) throw e;
    abort = e;
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
    if (h.accounts.length) cleaned = await h.cleanup();
  }

  console.log(`\n${h.counts.pass} bestanden, ${h.counts.fail} fehlgeschlagen · Port ${server.port} · Lauf ${h.RUN}`);
  if (broken.length) console.log(`Fundstelle(n): ${broken.join(' · ')}`);
  if (h.accounts.length) console.log(`Testkonten: ${h.accounts.join(', ')}\n\n${h.deleteHint()}`);
  if (abort) { console.log(`\nABBRUCH (${abort.reason}): ${abort.message} — Lauf gilt NICHT als grün`); return 2; }
  if (cleaned && (cleaned.groupsLeft || cleaned.problems.length)) { console.log('Aufräumen unvollständig ⇒ rot'); return 1; }
  return h.counts.fail || h.counts.pass === 0 ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  if (e instanceof h.Abort) { console.error(`ABBRUCH (${e.reason}): ${e.message}`); process.exit(2); }
  console.error('ABBRUCH', e?.stack ?? e);
  process.exit(2);
});
