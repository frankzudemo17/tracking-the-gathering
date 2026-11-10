// ManaBox-Textexport („Deck → Teilen → Als Text exportieren“) in Einträge zerlegen.
// Rein: kein DOM, kein Netz, keine Importe — Node-testbar. Texte für Fehler liefert die UI
// (hier nur Codes: empty · syntax · too_many · no_commander · qty).
//
// Format (echter Export, NOTIZEN.md):
//   // COMMANDER
//   1 Light-Paws, Emperor's Voice (NEO) 25
//   <Leerzeile beendet den Commander-Abschnitt>
//   1 Sol Ring (DRC) 56            ← Rest ohne Kopf = Hauptdeck
//   32 Plains (DFT) 277
// Toleriert: „1x Name“, „Name“ ohne Anzahl (= 1), Zeilen ohne „(SET) Nr“, Split-/Doppelkarten
// mit „ // “ im Namen, Windows-Zeilenenden, BOM, Foil-Kennung „*F*“ am Zeilenende.
// Andere Köpfe (// SIDEBOARD, // MAYBEBOARD, // CONSIDERING, // TOKENS, unbekannte) ⇒ bis zum
// nächsten Kopf überspringen. // MAIN, // MAINBOARD, // DECK ⇒ Hauptdeck.

/** Höchstens so viele Kartenzeilen (Commander + Hauptdeck); die RPC nimmt höchstens 250 Zeilen. */
export const MAX_LINES = 250;
/** Größere Eingaben gelten ohne Zerlegen als zu lang (≈ 250 Zeilen × 400 Zeichen). */
const MAX_CHARS = 100_000;
const MAX_QTY = 99;

const HEADER = /^\/\/\s*(.*?)\s*$/;
const MAIN_HEADERS = new Set(['MAIN', 'MAINBOARD', 'DECK']);
// „(SET) Nummer“ am Zeilenende; Nummer optional, darf Buchstaben/★/Bindestrich enthalten
const SET_TAIL = /\s*\(([A-Za-z0-9]{2,8})\)(?:\s+(\S+))?$/;
const FOIL_TAIL = /\s+\*[A-Za-z]{1,3}\*$/;
const QTY_HEAD = /^(\d+)\s*[xX]?(?:\s+|$)/;
const LETTER = /\p{L}/u;

/** @typedef {{ qty: number, name: string, set?: string, number?: string }} Entry */
/** @typedef {{ line: number, text: string, code: string }} ParseError */

/** Runde Klammern im Namen paarig? (z. B. „B.F.M. (Big Furry Monster)“ ja, „abc (“ nein) */
function balanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Eine Kartenzeile zerlegen.
 * @returns {{ entry: Entry } | { code: 'syntax' | 'qty' }}
 */
function parseLine(raw) {
  let s = raw.replace(FOIL_TAIL, '');
  let set, number;
  const tail = s.match(SET_TAIL);
  if (tail) {
    set = tail[1].toUpperCase();
    number = tail[2];
    s = s.slice(0, tail.index);
  }
  let qty = 1;
  const head = s.match(QTY_HEAD);
  if (head) {
    qty = Number(head[1]);
    s = s.slice(head[0].length);
  }
  const name = s.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 200 || !LETTER.test(name) || !balanced(name)) return { code: 'syntax' };
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { code: 'qty' };
  /** @type {Entry} */
  const entry = { qty, name };
  if (set) entry.set = set;
  if (set && number) entry.number = number;
  return { entry };
}

/**
 * ManaBox-Text zerlegen.
 * - Gleiche Karte (gleicher Abschnitt, Name, Set, Nummer) mehrfach ⇒ Anzahl addiert; verschiedene Drucke bleiben getrennt.
 * - Fehlerhafte Zeilen landen in `errors` (mit Zeilennummer ab 1) und werden übersprungen; der Rest bleibt gültig.
 * - `no_commander` ist eine Warnung (Hauptdeck bleibt); `empty` und `too_many` liefern leere Listen.
 * - Commander-Abschnitt ohne abschließende Leerzeile (mehr als 2 Zeilen bis Abschnittsende): nur die erste
 *   Zeile gilt als Commander, die übrigen als Hauptdeck (Heuristik, Spec-Risiko 1).
 * @param {string} text
 * @returns {{ commanders: Entry[], main: Entry[], errors: ParseError[] }}
 */
export function parseManaBox(text) {
  const src = typeof text === 'string' ? text.replace(/^﻿/, '') : '';
  const fileError = (code) => ({ commanders: [], main: [], errors: [{ line: 0, text: '', code }] });
  if (src.length > MAX_CHARS) return fileError('too_many');

  /** @type {{ sec: 'commander' | 'main', entry: Entry, line: number, text: string }[]} */
  const recs = [];
  /** @type {ParseError[]} */
  const errors = [];
  let mode = 'main'; // 'commander' | 'main' | 'skip'
  let cmdRun = [];   // Einträge des laufenden Commander-Abschnitts
  let counted = 0;   // Kartenzeilen außerhalb übersprungener Abschnitte

  const closeCommander = () => {
    if (cmdRun.length > 2) for (const r of cmdRun.slice(1)) r.sec = 'main';
    cmdRun = [];
  };

  src.split(/\r\n|\r|\n/).forEach((rawLine, i) => {
    const line = i + 1;
    const t = rawLine.trim();
    if (!t) {
      if (mode === 'commander') { closeCommander(); mode = 'main'; }
      return;
    }
    const h = t.match(HEADER);
    if (h) {
      closeCommander();
      const name = h[1].toUpperCase();
      mode = name.startsWith('COMMANDER') ? 'commander' : MAIN_HEADERS.has(name) ? 'main' : 'skip';
      return;
    }
    if (mode === 'skip') return;
    counted++;
    const r = parseLine(t);
    if ('code' in r) { errors.push({ line, text: t, code: r.code }); return; }
    const rec = { sec: /** @type {'commander' | 'main'} */ (mode), entry: r.entry, line, text: t };
    recs.push(rec);
    if (mode === 'commander') cmdRun.push(rec);
  });
  closeCommander();

  if (counted > MAX_LINES) return fileError('too_many');
  if (counted === 0) return fileError('empty');

  // gleiche Karte im gleichen Abschnitt zusammenlegen (Reihenfolge des ersten Auftretens)
  const commanders = [], main = [];
  const seen = new Map();
  for (const { sec, entry, line, text: t } of recs) {
    const key = [sec, entry.name.toLowerCase(), entry.set || '', entry.number || ''].join('|');
    const prev = seen.get(key);
    if (prev) {
      if (prev.qty + entry.qty > MAX_QTY) errors.push({ line, text: t, code: 'qty' });
      else prev.qty += entry.qty;
      continue;
    }
    const copy = { ...entry };
    seen.set(key, copy);
    (sec === 'commander' ? commanders : main).push(copy);
  }
  errors.sort((a, b) => a.line - b.line);
  if (!commanders.length && main.length) errors.push({ line: 0, text: '', code: 'no_commander' });
  return { commanders, main, errors };
}
