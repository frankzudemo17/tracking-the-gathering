// Gate-Stufe „build“: kein Build-Schritt (Vanilla JS, GitHub Pages) — geprüft wird, dass die
// statische Seite so ausgeliefert werden kann (B1–B4, Spec P1). Groß-/Kleinschreibung exakt,
// weil GitHub Pages case-sensitive ist, Windows nicht.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk, rel, lineOf, existsExact, relativeImports, stripComments } from './util.mjs';

const findings = [];
const report = (file, line, rule, msg) => findings.push(`${rel(file)}:${line} [${rule}] ${msg}`);
const summary = [];
const read = (f) => fs.readFileSync(f, 'utf8');
const SRC = path.join(ROOT, 'src');
const isExternal = (u) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
const clean = (u) => u.split('#')[0].split('?')[0];

// ---- B1: relative Imports in src/**/*.js zeigen auf existierende Dateien (exakte Schreibung)
const srcJs = walk(SRC, ['.js', '.mjs']);
if (srcJs.length === 0) report(SRC, 0, 'B1', 'Suchraum src/ ist leer — falscher Pfad?');
let imports = 0;
for (const f of srcJs) {
  for (const { spec, line } of relativeImports(read(f))) {
    imports++;
    const target = path.resolve(path.dirname(f), clean(spec));
    if (!existsExact(target)) report(f, line, 'B1', `Import '${spec}' nicht gefunden (Groß-/Kleinschreibung?)`);
  }
}
summary.push(`B1 relative Imports · Suchraum src/**/*.{js,mjs} · ${srcJs.length} Dateien · ${imports} Imports`);

// ---- B2: jede Route v('<name>') in src/main.js hat src/views/<name>.js
const MAIN = path.join(SRC, 'main.js');
const mainText = fs.existsSync(MAIN) ? stripComments(read(MAIN)) : '';
const routes = [...mainText.matchAll(/\bv\(\s*(['"])([^'"]+)\1\s*\)/g)];
if (routes.length === 0) report(MAIN, 0, 'B2', 'keine Route v(\'…\') gefunden — falscher Pfad?');
const names = new Set();
for (const m of routes) {
  names.add(m[2]);
  if (!existsExact(path.join(SRC, 'views', `${m[2]}.js`))) report(MAIN, lineOf(mainText, m.index), 'B2', `Route v('${m[2]}') ohne src/views/${m[2]}.js`);
}
summary.push(`B2 Routen · src/main.js · ${routes.length} Aufrufe, ${names.size} Namen`);

// ---- B3: href/src in index.html und Icons im Manifest existieren lokal
const INDEX = path.join(ROOT, 'index.html');
const MANIFEST = path.join(ROOT, 'manifest.webmanifest');
let b3 = 0;
if (!fs.existsSync(INDEX)) report(INDEX, 0, 'B3', 'index.html fehlt');
else {
  const html = read(INDEX).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of html.matchAll(/\b(?:href|src)\s*=\s*(["'])([^"']*)\1/gi)) {
    const u = m[2].trim();
    if (!u || isExternal(u)) continue;
    b3++;
    if (!existsExact(path.join(ROOT, clean(u)))) report(INDEX, lineOf(html, m.index), 'B3', `'${u}' existiert nicht`);
  }
}
if (!fs.existsSync(MANIFEST)) report(MANIFEST, 0, 'B3', 'manifest.webmanifest fehlt');
else {
  const text = read(MANIFEST);
  let man = {};
  try { man = JSON.parse(text); } catch (e) { report(MANIFEST, 0, 'B3', `kein gültiges JSON: ${e.message}`); }
  for (const ic of man.icons ?? []) {
    if (!ic.src || isExternal(ic.src)) continue;
    b3++;
    const line = lineOf(text, Math.max(0, text.indexOf(ic.src)));
    if (!existsExact(path.join(path.dirname(MANIFEST), clean(ic.src)))) report(MANIFEST, line, 'B3', `Icon '${ic.src}' existiert nicht`);
  }
}
summary.push(`B3 lokale Verweise · index.html + manifest.webmanifest · ${b3} Verweise`);

// ---- B4: sw.js SHELL — jeder Eintrag existiert, und jede Kerndatei steht drin
const SW = path.join(ROOT, 'sw.js');
const swText = fs.existsSync(SW) ? read(SW) : '';
const shellM = swText.match(/\bconst\s+SHELL\s*=\s*\[([\s\S]*?)\]/);
const shell = new Set();
if (!shellM) report(SW, 0, 'B4', 'const SHELL = [...] nicht gefunden');
else {
  const base = swText.indexOf(shellM[1]);
  for (const m of stripComments(shellM[1]).matchAll(/(['"])([^'"]*)\1/g)) {
    const u = m[2];
    const line = lineOf(swText, base + m.index);
    if (isExternal(u)) continue;
    const p = clean(u).replace(/^\.\//, '');
    shell.add(p);
    const abs = p === '' ? ROOT : path.join(ROOT, p);
    if (!existsExact(abs)) report(SW, line, 'B4', `SHELL-Eintrag '${u}' existiert nicht (cache.addAll scheitert)`);
  }
  const must = [
    ...['lib', 'game', 'i18n', 'styles'].flatMap((d) => walk(path.join(SRC, d))),
    ...fs.readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => path.join(SRC, e.name)),
  ];
  for (const f of must) if (!shell.has(rel(f))) report(SW, lineOf(swText, swText.indexOf(shellM[0])), 'B4', `${rel(f)} fehlt in SHELL`);
  summary.push(`B4 sw.js SHELL · ${shell.size} Einträge · ${must.length} Pflichtdateien (src/lib, src/game, src/i18n, src/styles, src/*.js)`);
}

for (const s of summary) console.log(s);
for (const f of findings) console.error(`✗ ${f}`);
console.log(`build: ${findings.length} Befunde`);
process.exit(findings.length ? 1 : 0);
