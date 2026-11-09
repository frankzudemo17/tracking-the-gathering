// Gemeinsame Hilfen der Gate-Skripte. Alle Pfade relativ zur Repo-Wurzel
// (aus import.meta.url), nie zu process.cwd() — das Gate läuft aus jedem Verzeichnis.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Repo-relativer Pfad mit Schrägstrichen (für Ausgaben und SHELL-Vergleiche). */
export const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/** Alle Dateien unter dir (absolut), rekursiv, optional nach Endungen gefiltert. */
export function walk(dir, exts = null) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p, exts));
    else if (!exts || exts.some((e) => ent.name.endsWith(e))) out.push(p);
  }
  return out.sort();
}

/** Zeilennummer (1-basiert) eines Zeichenindex. */
export const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/**
 * Existiert der Pfad mit exakt dieser Groß-/Kleinschreibung? (GitHub Pages ist
 * case-sensitive, Windows nicht — darum jedes Segment gegen readdirSync prüfen.)
 */
export function existsExact(abs) {
  const r = path.relative(ROOT, path.resolve(abs));
  if (r.startsWith('..') || path.isAbsolute(r)) return fs.existsSync(abs); // außerhalb: nur grob
  if (r === '') return true;
  let cur = ROOT;
  for (const seg of r.split(path.sep)) {
    let names;
    try { names = fs.readdirSync(cur); } catch { return false; }
    if (!names.includes(seg)) return false;
    cur = path.join(cur, seg);
  }
  return true;
}

/**
 * Reine Kommentarzeilen ausblenden (Zeilen bleiben erhalten, damit datei:zeile
 * stimmt). Bewusst zeilenbasiert statt Tokenizer: Regex-Literale mit Anführungs-
 * zeichen (z. B. in dom.js) würden einen naiven Tokenizer aus dem Tritt bringen
 * und Treffer verschlucken. Ein Kommentar am Zeilenende bleibt stehen — das
 * macht die Regeln eher strenger, nie blind.
 */
export function stripComments(src) {
  let inBlock = false;
  return src.split('\n').map((line) => {
    const t = line.trim();
    // Code hinter einem schließenden */ bleibt sichtbar (sonst verstummt eine Regel).
    const afterClose = (s) => s.slice(s.indexOf('*/') + 2);
    if (inBlock) {
      if (!line.includes('*/')) return '';
      inBlock = false;
      return ' '.repeat(line.indexOf('*/') + 2) + afterClose(line);
    }
    if (t.startsWith('//')) return '';
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) { inBlock = true; return ''; }
      return ' '.repeat(line.indexOf('*/') + 2) + afterClose(line);
    }
    return line;
  }).join('\n');
}

/** Relative Import-Angaben einer JS-Datei: [{ spec, line }]. */
export function relativeImports(text) {
  const t = stripComments(text);
  const found = [];
  const res = [
    /\bimport\s+[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g,
    /\bexport\s+[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  ];
  for (const re of res) {
    for (const m of t.matchAll(re)) {
      if (m[2].startsWith('./') || m[2].startsWith('../')) found.push({ spec: m[2], line: lineOf(t, m.index) });
    }
  }
  return found;
}
