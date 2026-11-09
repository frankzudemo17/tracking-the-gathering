// Gate-Stufe „lint“: Projektregeln L1–L5 (Spec P1). Je Befund `datei:zeile [Regel]`, Exit ≠ 0.
// Kein Suchraum darf leer sein (Schutz gegen falschen Pfad) — außer src/game/ (L3), solange
// der Ordner nicht existiert.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, walk, rel, lineOf, stripComments } from './util.mjs';

const findings = [];
const report = (file, line, rule, msg) => findings.push(`${rel(file)}:${line} [${rule}] ${msg}`);
const summary = [];
const read = (f) => fs.readFileSync(f, 'utf8');

const SRC = path.join(ROOT, 'src');
const srcJs = walk(SRC, ['.js', '.mjs']);
const emptyGuard = (rule, files, space) => {
  if (files.length === 0) report(path.join(ROOT, space), 0, rule, `Suchraum ${space} ist leer — falscher Pfad?`);
};

/** Treffer eines Regex je Zeile melden (auf kommentarbereinigtem Text). */
function scan(file, re, rule, msg, { strip = true } = {}) {
  const text = strip ? stripComments(read(file)) : read(file);
  let n = 0;
  for (const m of text.matchAll(re)) { n++; report(file, lineOf(text, m.index), rule, msg(m)); }
  return n;
}

// ---- L1: kein Math.random in src/ (HANDOFF 5.4b: Zufall über crypto.getRandomValues)
emptyGuard('L1', srcJs, 'src');
for (const f of srcJs) scan(f, /\bMath\s*\.\s*random\b/g, 'L1', () => 'Math.random verboten, Zufall über crypto.getRandomValues');
summary.push(`L1 kein Math.random · Suchraum src/**/*.{js,mjs} · ${srcJs.length} Dateien`);

// ---- L2: innerHTML/outerHTML/insertAdjacentHTML nur in src/lib/dom.js
const DOM = path.join(SRC, 'lib', 'dom.js');
let l2allowed = 0;
emptyGuard('L2', srcJs, 'src');
for (const f of srcJs) {
  const re = /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/g;
  if (f === DOM) { l2allowed += [...stripComments(read(f)).matchAll(re)].length; continue; }
  scan(f, re, 'L2', (m) => `${m[1]} nur in src/lib/dom.js (sonst html\`\`/mount)`);
}
summary.push(`L2 innerHTML & Co. nur in dom.js · Suchraum src/**/*.{js,mjs} · ${srcJs.length} Dateien · erlaubt in dom.js: ${l2allowed}`);

// ---- L3: src/game/ ist reine Logik
const GAME = path.join(SRC, 'game');
const gameJs = walk(GAME, ['.js', '.mjs']);
if (fs.existsSync(GAME)) emptyGuard('L3', walk(GAME), 'src/game');
const FORBIDDEN = /\b(document|window|localStorage|sessionStorage|fetch|navigator|setTimeout|setInterval)\b|\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bperformance\s*\.\s*now\b/g;
for (const f of gameJs) {
  scan(f, FORBIDDEN, 'L3', (m) => `${m[0]} in src/game/ verboten (reine Logik)`);
  const text = read(f);
  // jede Import-Angabe (auch nicht-relative) muss relativ sein und in src/game/ bleiben
  const all = [...stripComments(text).matchAll(/\b(?:import|export)\s+[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*\(?\s*(['"])([^'"]+)\3/g)];
  for (const m of all) {
    const spec = m[2] ?? m[4];
    const line = lineOf(stripComments(text), m.index);
    if (!spec.startsWith('./') && !spec.startsWith('../')) { report(f, line, 'L3', `Import '${spec}' nicht relativ`); continue; }
    const target = path.resolve(path.dirname(f), spec);
    if (path.relative(GAME, target).startsWith('..')) report(f, line, 'L3', `Import '${spec}' verlässt src/game/`);
  }
  if (/\bimport\s*\(\s*[^'"\s]/.test(stripComments(text))) report(f, 0, 'L3', 'dynamischer Import mit berechnetem Pfad in src/game/');
}
summary.push(`L3 src/game rein · Suchraum src/game/**/*.{js,mjs} · ${gameJs.length} Dateien${fs.existsSync(GAME) ? '' : ' (Ordner existiert noch nicht)'}`);

// ---- L4: kein JWT mit role=service_role (Payload dekodieren, kein grep auf das Wort)
const l4files = [...walk(SRC), path.join(ROOT, 'index.html'), path.join(ROOT, 'sw.js')].filter((f) => fs.existsSync(f));
emptyGuard('L4', l4files, 'src');
let tokens = 0;
for (const f of l4files) {
  const text = read(f);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]*\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*/g)) {
    tokens++;
    let payload = '';
    try { payload = Buffer.from(m[1], 'base64url').toString('utf8'); } catch { /* kein Base64 */ }
    let role = null;
    try { role = JSON.parse(payload).role; } catch { /* kein JSON */ }
    if (role === 'service_role' || /"role"\s*:\s*"service_role"/.test(payload)) {
      report(f, lineOf(text, m.index), 'L4', 'JWT mit role=service_role — dieser Schlüssel gehört nie ins Frontend');
    }
  }
}
summary.push(`L4 kein service_role-JWT · Suchraum src/** + index.html + sw.js · ${l4files.length} Dateien · ${tokens} JWT dekodiert`);

// ---- L5: i18n-Parität de.js ↔ en.js (Blattschlüssel)
const leaves = (obj, pre = '') => Object.entries(obj).flatMap(([k, v]) =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? leaves(v, `${pre}${k}.`) : [`${pre}${k}`]);
const DE = path.join(SRC, 'i18n', 'de.js'), EN = path.join(SRC, 'i18n', 'en.js');
let deKeys = [], enKeys = [];
try {
  deKeys = leaves((await import(pathToFileURL(DE).href)).default ?? {});
  enKeys = leaves((await import(pathToFileURL(EN).href)).default ?? {});
} catch (e) { report(DE, 0, 'L5', `i18n nicht ladbar: ${e.message}`); }
if (deKeys.length === 0) report(DE, 0, 'L5', 'keine Schlüssel in de.js — falscher Pfad?');
const keyLine = (file, key) => {
  const last = key.split('.').pop();
  const lines = read(file).split('\n');
  const i = lines.findIndex((l) => new RegExp(`(^|[\\s{,'"])${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*:`).test(l));
  return i + 1;
};
const enSet = new Set(enKeys), deSet = new Set(deKeys);
for (const k of deKeys) if (!enSet.has(k)) report(DE, keyLine(DE, k), 'L5', `Schlüssel '${k}' fehlt in en.js`);
for (const k of enKeys) if (!deSet.has(k)) report(EN, keyLine(EN, k), 'L5', `Schlüssel '${k}' fehlt in de.js`);
summary.push(`L5 i18n-Parität · src/i18n/de.js ↔ en.js · ${deKeys.length}/${enKeys.length} Blattschlüssel`);

// ---- Ausgabe
for (const s of summary) console.log(s);
for (const f of findings) console.error(`✗ ${f}`);
console.log(`lint: ${findings.length} Befunde`);
process.exit(findings.length ? 1 : 0);
