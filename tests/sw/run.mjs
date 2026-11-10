// npm run sw — Service-Worker-Messungen im Browser (Spec P11 Tempo, Kriterien 19–27).
// Lokal gegen tools/serve.mjs, Wegwerf-Stände im Temp-Ordner des Systems (am Ende gelöscht), keine Anfrage an Prod.
//   node tests/sw/run.mjs                 alle Szenarien S1–S8
//   node tests/sw/run.mjs S3 S4           nur diese
//   node tests/sw/run.mjs T               Zeitmessung (informativ, nicht im Standardlauf)
//   TTG_SW_GEGENPROBE=G2|G3|G6            Gegenprobe: S3 | S4 | S1 MUSS rot bzw. „untauglich“ werden
// Exit: 0 grün · 1 rot · 2 Abbruch (Messgerät untauglich, Browser fehlt)
import { Abort, cleanup, prod, TMP } from './helpers.mjs';
import * as S from './scenarios.mjs';

const ALL = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
const want = process.argv.slice(2).filter((a) => /^(S[1-8]|T)$/.test(a));
const list = want.length ? want : ALL;
const t0 = Date.now();
let pass = 0;
let fail = 0;
let code = 0;
const lines = [];
console.log(`sw: Szenarien ${list.join(' ')}${process.env.TTG_SW_GEGENPROBE ? ` · Gegenprobe ${process.env.TTG_SW_GEGENPROBE}` : ''} · Temp ${TMP}`);
try {
  for (const name of list) {
    const t1 = Date.now();
    console.log(`\n${name}`);
    try {
      const r = await S[name]();
      for (const ch of r.checks) {
        if (ch.ok) pass++; else fail++;
        console.log(`  ${ch.ok ? '✓' : '✗'} ${ch.name}${ch.ok ? '' : ` — ${ch.info}`}`);
      }
      lines.push(r.line);
      console.log(`  ${r.line} (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
    } catch (e) {
      if (e instanceof Abort) { console.error(`  ABBRUCH ${e.message}`); code = 2; break; }
      fail++;
      console.error(`  ✗ ${name} Fehler: ${e.stack || e.message}`);
    }
  }
} finally {
  cleanup();
}
const prodOk = prod.requests === 0;
if (!prodOk) fail++;
console.log(`\n${prodOk ? '✓' : '✗'} K27 Anfragen an *.supabase.co über alle Läufe: ${prod.requests}${prod.hosts.size ? ` (${[...prod.hosts].join(', ')})` : ''}`);
console.log('\nMesszeilen:');
for (const l of lines) console.log(`  ${l}`);
console.log(`sw: ${pass} bestanden, ${fail} rot${code === 2 ? ', ABBRUCH' : ''} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(code || (fail ? 1 : 0));
