// Gate B4 (Spec P11 Tempo, E7): die SHELL in sw.js ist vollständig. Reine Funktion ohne
// Dateizugriff — build-check.mjs liest Repo, index.html und Stylesheets und übergibt die Listen;
// tests/unit/shell-check.test.mjs prüft jede Regel mit kleinen Eingaben.
// Seit P11 liefert der Service Worker eigene Dateien NUR aus dem Versions-Cache (cache-zuerst);
// was nicht in der SHELL steht, kommt über das Netz und ist offline nicht da.
import path from 'node:path';

const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
const clean = (u) => u.split('#')[0].split('?')[0];

/** './x' und 'x' sind derselbe Eintrag; './' ist die Wurzel (''). Liefert null für Pfade außerhalb der Wurzel. */
export function normalize(u) {
  const p = path.posix.normalize(clean(u).replace(/^\.\//, '') || '.');
  if (p === '.' || p === './') return '';
  if (p.startsWith('../') || p === '..' || p.startsWith('/')) return null;
  return p.replace(/\/$/, '');
}

/** Lokaler Verweis aus index.html (relativ zur Wurzel) ⇒ Repo-Pfad, sonst null (fremd, data:, #, leer). */
export function indexRef(u) {
  const s = (u ?? '').trim();
  if (!s || s.startsWith('#') || EXTERNAL.test(s)) return null;
  return normalize(s);
}

/** Lokale url(…) aus einer CSS-Datei (Repo-Pfad der CSS-Datei) ⇒ Repo-Pfad, sonst null. */
export function cssRef(from, u) {
  const s = (u ?? '').trim();
  if (!s || s.startsWith('#') || EXTERNAL.test(s)) return null;
  const joined = path.posix.join(path.posix.dirname(from), clean(s));
  return normalize(joined);
}

/** url(…)-Angaben einer Stylesheet-Quelle (Kommentare ausgeblendet). */
export function cssUrls(text) {
  const t = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  return [...t.matchAll(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/gi)].map((m) => m[2]);
}

/**
 * @param {object} a
 * @param {{ value: string, line?: number }[]} a.entries  SHELL-Einträge, wie in sw.js geschrieben
 * @param {string[]} a.files      alle Dateien des Repos, Repo-relativ mit '/', exakte Schreibung
 * @param {string[]} a.indexRefs  href/src-Angaben aus index.html (roh)
 * @param {{ from: string, url: string }[]} a.cssRefs  url(…)-Angaben je Stylesheet (roh)
 * @returns {{ findings: { rule: number, line: number, msg: string }[], counts: object }}
 */
export function checkShell({ entries, files, indexRefs = [], cssRefs = [] }) {
  const findings = [];
  const add = (rule, line, msg) => findings.push({ rule, line: line ?? 0, msg });
  const fileSet = new Set(files);
  const shell = new Set();
  const seen = new Map();

  for (const { value, line } of entries) {
    // Regel 6: verboten — fremde Adressen, Pfade außerhalb der Wurzel, sw.js selbst
    if (EXTERNAL.test(value)) { add(6, line, `SHELL-Eintrag '${value}' ist eine fremde Adresse (verboten)`); continue; }
    const p = normalize(value);
    if (p === null) { add(6, line, `SHELL-Eintrag '${value}' liegt außerhalb der Wurzel (verboten)`); continue; }
    if (p === 'sw.js') { add(6, line, `SHELL-Eintrag '${value}': sw.js selbst gehört nicht in die SHELL`); continue; }
    // Regel 2: doppelt
    if (seen.has(p)) { add(2, line, `SHELL-Eintrag '${value}' doppelt (schon Zeile ${seen.get(p)})`); continue; }
    seen.set(p, line ?? 0);
    shell.add(p);
    // Regel 1: existiert (exakte Schreibung)
    if (p !== '' && !fileSet.has(p)) add(1, line, `SHELL-Eintrag '${value}' existiert nicht (Installation scheitert)`);
  }

  // Regel 3: jede Datei unter src/**
  const src = files.filter((f) => f.startsWith('src/')).sort();
  for (const f of src) if (!shell.has(f)) add(3, 0, `${f} fehlt in SHELL (Pflicht: jede Datei unter src/**)`);

  // Regel 4: jeder lokale Verweis aus index.html
  const idx = [...new Set(indexRefs.map(indexRef).filter((p) => p !== null && p !== ''))].sort();
  for (const p of idx) if (!shell.has(p)) add(4, 0, `${p} fehlt in SHELL (Verweis aus index.html)`);

  // Regel 5: jede lokale url(…) aus den Stylesheets, relativ zur CSS-Datei
  const css = [];
  for (const { from, url } of cssRefs) {
    const p = cssRef(from, url);
    if (p === null) continue;
    if (!css.includes(p)) css.push(p);
  }
  css.sort();
  for (const p of css) if (!shell.has(p)) add(5, 0, `${p} fehlt in SHELL (url() aus ${cssRefs.find((r) => cssRef(r.from, r.url) === p).from})`);

  return { findings, counts: { entries: entries.length, src: src.length, index: idx.length, css: css.length } };
}
