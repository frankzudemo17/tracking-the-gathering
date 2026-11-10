// npm run e2e — startet tools/serve.mjs (freier Port), führt alle tests/e2e/*.e2e.mjs nacheinander aus,
// stellt vor jeder Datei und am Ende den Grundzustand der festen Fixture her, beendet den Server.
// Exit 0 = alle Prüfungen grün · 1 = mindestens eine Prüfung rot · 2 = Abbruch aus Umgebungsgründen
// (Browser fehlt, Rate-Limit, Scryfall, Zugangsdaten fehlen, Wächter, Sperre) — nie „grün“.
// Ziel (E1 = A, WELLE.md): Prod-Supabase aus src/config.js; feste Testkonten A, B, C in TTG-E2E-Fixture (Spec P9b H).
// Der Lauf löscht nie ein Konto und nie eine Gruppe. Ein Lauf zur Zeit (Sperrdatei im Temp-Ordner).
//   npm run e2e
//   npm run e2e -- --nur tisch,zugang      nur diese Dateien (Teilname genügt; Grundzustand trotzdem davor/danach)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../../tools/serve.mjs';
import { acquireLock } from './fixture-core.mjs';
import * as h from './harness.mjs';

const DIR = path.join(h.ROOT, 'tests', 'e2e');
const argv = process.argv.slice(2);

/** Fundstelle (datei:zeile) eines Fehlers in einer *.e2e.mjs, sonst die erste Stack-Zeile. */
function where(e) {
  const lines = String(e?.stack ?? '').split('\n');
  const hit = lines.find((l) => /\.e2e\.mjs:\d+/.test(l)) ?? lines[1] ?? '';
  const m = hit.match(/([^\\/()\s]+\.m?js):(\d+)/);
  return m ? `tests/e2e/${m[1]}:${m[2]}` : hit.trim();
}

async function main() {
  if (argv.includes('--nur-aufraeumen')) throw new h.Abort('Aufruf', '--nur-aufraeumen entfällt (P9b): der nächste Lauf stellt den Grundzustand her; Zustand: node tests/e2e/fixture.mjs --pruefen');
  const only = argv.includes('--nur') ? argv[argv.indexOf('--nur') + 1]?.split(',').filter(Boolean) : null;
  let files = fs.readdirSync(DIR).filter((f) => f.endsWith('.e2e.mjs')).sort();
  if (only) files = files.filter((f) => only.some((o) => f.includes(o)));
  if (files.length === 0) throw new h.Abort('Aufruf', 'keine tests/e2e/*.e2e.mjs gefunden');

  const lock = await acquireLock({ worktree: h.ROOT, log: (s) => console.log(s) });
  const server = await serve();
  console.log(`e2e: Lauf ${h.RUN} · Server ${server.url} (Port ${server.port}) · Ziel ${h.TARGET.url} · ${files.length} Datei(en): ${files.join(', ')}`);
  if (lock.took) console.log(`Sperre übernommen von ${lock.took}`);
  let browser;
  const broken = [];
  let abort = null;
  let before = null, after = null, endBase = null;
  try {
    console.log(`Zugang-Migration in Prod: ${(await h.zugangLive()) ? 'ja' : 'nein (Tor-Fälle werden übersprungen)'}`);
    before = await h.snapshot();
    console.log(`Fixture vorher: Gruppe ${before.group} · Mitglieder [${before.members.join(', ')}] · ${before.placeholders} Platzhalter · ${before.games} Spiele`);
    browser = await h.launch();
    for (const f of files) {
      console.log(`\n=== ${f}`);
      await h.baseState({ log: (s) => console.log('  ' + s) });
      for (const p of h.opened.splice(0)) await p[1].context().close().catch(() => {});
      try {
        const mod = await import(pathToFileURL(path.join(DIR, f)).href);
        await mod.default({ browser, base: server.url, harness: h });
      } catch (e) {
        if (e instanceof h.Abort) throw e;
        h.counts.fail++;
        const at = where(e);
        broken.push(`${f}: ${at}`);
        const msg = String(e.message).split('\n');
        const waiting = msg.find((l) => /waiting for/.test(l))?.replace(/\x1b\[[0-9;]*m/g, '').trim();
        console.log(`  ✗ ABBRUCH in ${at}: ${msg[0]}${waiting ? ` (${waiting})` : ''}`);
        for (const [n, p] of h.opened) await h.shot(p, `FEHLER-${h.RUN}-${n}`).catch(() => {});
        if (h.env.rateLimited) throw new h.Abort('Rate-Limit', 'Supabase-Auth meldet 429 (zu viele Anmeldungen) — später erneut');
        if (h.env.scryfallDown) throw new h.Abort('übersprungen (Scryfall)', 'Scryfall nicht erreichbar — Deck-Fälle nicht geprüft');
      }
    }
  } catch (e) {
    if (!(e instanceof h.Abort)) throw e;
    abort = e;
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
    // Grundzustand am Ende (Wächter davor) + Nachweis Krit. 11
    try {
      endBase = await h.baseState({ log: (s) => console.log('\nEnde: ' + s) });
      after = await h.snapshot();
    } catch (e) { console.log(`\nGrundzustand am Ende NICHT hergestellt: ${e.message}`); if (!abort && e instanceof h.Abort) abort = e; }
    lock.release();
  }

  console.log(`\n${h.counts.pass} bestanden, ${h.counts.fail} fehlgeschlagen, ${h.counts.skip} übersprungen · Port ${server.port} · Lauf ${h.RUN}`);
  if (h.skipped.length) console.log(`Übersprungen:\n${h.skipped.map((s) => '  – ' + s).join('\n')}`);
  if (broken.length) console.log(`Fundstelle(n): ${broken.join(' · ')}`);
  if (after) {
    const same = before?.group === after.group;
    console.log(`Fixture nachher: Gruppe ${after.group} (${same ? 'gleiche ID wie vorher' : 'ANDERE ID'}) · Mitglieder [${after.members.join(', ')}] · ${after.placeholders} Platzhalter · ${after.games} Spiele`);
    console.log(`Gelöschte Gruppen: ${h.tally.groupsDeleted} · gelöschte Konten: ${h.tally.accountsDeleted}${endBase?.leftovers?.length ? ` · Reste: ${endBase.leftovers.length}` : ''}`);
  }
  if (abort) { console.log(`\nABBRUCH (${abort.reason}): ${abort.message} — Lauf gilt NICHT als grün`); return 2; }
  const baseOk = after && after.members.join() === 'A' && after.adminA && after.placeholders === 0 && after.games === 0 && before?.group === after.group;
  if (!baseOk) { console.log('Grundzustand am Ende nicht erreicht ⇒ rot'); return 1; }
  return h.counts.fail || h.counts.pass === 0 ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  if (e instanceof h.Abort) { console.error(`ABBRUCH (${e.reason}): ${e.message}`); process.exit(2); }
  console.error('ABBRUCH', e?.stack ?? e);
  process.exit(2);
});
