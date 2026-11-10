// Spec P1 (Welle ttg-live-feinschliff-decks): ManaBox-Textexport parsen (src/decks/manabox.js).
// Jeder Fall lädt das Modul selbst per import() ⇒ ohne das Modul rot (Gegenprobe).
// Sollwerte aus der Spec-Tabelle „Spec-Tests“; der Export ist der echte (Kopie aus fixtures/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mb = () => import('../../src/decks/manabox.js');
const EXPORT = fs.readFileSync(new URL('./fixtures/manabox-export-light-paws.txt', import.meta.url), 'utf8');
const sum = (list) => list.reduce((s, e) => s + e.qty, 0);
const codes = (r) => r.errors.map((e) => e.code);

test('M1 echter Export: 1 Commander, 68 Einträge, Σ 99, Plains 32 DFT 277, keine Fehler', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox(EXPORT);
  assert.deepEqual(r.commanders, [{ qty: 1, name: "Light-Paws, Emperor's Voice", set: 'NEO', number: '25' }]);
  assert.equal(r.main.length, 68);
  assert.equal(sum(r.main), 99);
  assert.deepEqual(r.main.find((e) => e.name === 'Plains'), { qty: 32, name: 'Plains', set: 'DFT', number: '277' });
  assert.deepEqual(r.errors, []);
});

test('M1b echter Export mit Windows-Zeilenenden und BOM: gleiches Ergebnis', async () => {
  const { parseManaBox } = await mb();
  const crlf = '﻿' + EXPORT.replace(/\n/g, '\r\n');
  assert.deepEqual(parseManaBox(crlf), parseManaBox(EXPORT));
});

test('M2 Split-Karte: „Fire // Ice“ bleibt ein Name, kein Abschnittskopf', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox('1 Fire // Ice (MH2) 290');
  assert.deepEqual(r.main, [{ qty: 1, name: 'Fire // Ice', set: 'MH2', number: '290' }]);
});

test('M3 ohne Set: „2x Island“ ⇒ {qty 2, name Island}; Name ohne Anzahl ⇒ qty 1', async () => {
  const { parseManaBox } = await mb();
  assert.deepEqual(parseManaBox('2x Island').main, [{ qty: 2, name: 'Island' }]);
  assert.deepEqual(parseManaBox('Sol Ring').main, [{ qty: 1, name: 'Sol Ring' }]);
  assert.deepEqual(parseManaBox('3 Swamp').main, [{ qty: 3, name: 'Swamp' }]);
});

test('M4 doppelt mit verschiedenem Druck ⇒ zwei Einträge; gleicher Druck ⇒ Anzahl addiert', async () => {
  const { parseManaBox } = await mb();
  const two = parseManaBox('1 Sol Ring (DRC) 56\n1 Sol Ring (C21) 263');
  assert.deepEqual(two.main, [
    { qty: 1, name: 'Sol Ring', set: 'DRC', number: '56' },
    { qty: 1, name: 'Sol Ring', set: 'C21', number: '263' },
  ]);
  const same = parseManaBox('1 Sol Ring (DRC) 56\n2 Sol Ring (DRC) 56\n1 Island\n1x Island');
  assert.deepEqual(same.main, [{ qty: 3, name: 'Sol Ring', set: 'DRC', number: '56' }, { qty: 2, name: 'Island' }]);
});

test('M5 Abschnitt: angehängtes // SIDEBOARD (2 Zeilen) landet nirgends; Hauptdeck unverändert', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox(EXPORT + '\n// SIDEBOARD\n1 Swords to Plowshares (STA) 10\n1 Path to Exile (2XM) 25\n');
  assert.equal(r.main.length, 68);
  assert.equal(sum(r.main), 99);
  assert.equal(r.commanders.length, 1);
  const all = [...r.commanders, ...r.main].map((e) => e.name);
  assert.ok(!all.includes('Swords to Plowshares') && !all.includes('Path to Exile'));
  assert.deepEqual(r.errors, []);
});

test('M5b weitere Köpfe (MAYBEBOARD, CONSIDERING, TOKENS) werden bis zum nächsten Kopf übersprungen', async () => {
  const { parseManaBox } = await mb();
  const txt = [
    '// COMMANDER', '1 Light-Paws, Emperor\'s Voice (NEO) 25', '',
    '1 Sol Ring (DRC) 56',
    '// MAYBEBOARD', '1 Mox Diamond', '', '1 Mana Crypt',
    '// TOKENS', '1 Spirit',
    '// considering', '1 Grim Monolith',
  ].join('\n');
  const r = parseManaBox(txt);
  assert.deepEqual(r.main, [{ qty: 1, name: 'Sol Ring', set: 'DRC', number: '56' }]);
  assert.deepEqual(r.errors, []);
});

test('M6 Fehler: „abc (“ in Zeile 7 ⇒ errors[0] = {line 7, code syntax}', async () => {
  const { parseManaBox } = await mb();
  const lines = EXPORT.split('\n');
  lines.splice(6, 0, 'abc (');
  const r = parseManaBox(lines.join('\n'));
  assert.equal(r.errors[0].line, 7);
  assert.equal(r.errors[0].code, 'syntax');
  assert.equal(r.errors[0].text, 'abc (');
  assert.equal(r.main.length, 68); // die gültigen Zeilen bleiben
});

test('M7 leer: \'\' ⇒ errors = [{code empty}]; nur Leerzeilen/Köpfe ebenso', async () => {
  const { parseManaBox } = await mb();
  for (const txt of ['', '   \n\r\n', '// COMMANDER\n\n']) {
    const r = parseManaBox(txt);
    assert.deepEqual(codes(r), ['empty'], JSON.stringify(txt));
    assert.deepEqual([r.commanders, r.main], [[], []]);
  }
  assert.deepEqual(codes(parseManaBox(undefined)), ['empty']);
});

test('M8 Anzahl 0 oder > 99 ⇒ code qty (Zeile übersprungen); Summe > 99 ebenso', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox('0 Island\n100 Plains\n99 Forest\n1 Forest\n1 Sol Ring');
  assert.deepEqual(r.errors.map((e) => [e.line, e.code]), [[1, 'qty'], [2, 'qty'], [4, 'qty']]);
  assert.deepEqual(r.main, [{ qty: 99, name: 'Forest' }, { qty: 1, name: 'Sol Ring' }]);
});

test('M9 mehr als 250 Kartenzeilen ⇒ code too_many, nichts übernommen', async () => {
  const { parseManaBox } = await mb();
  const txt = Array.from({ length: 251 }, (_, i) => `1 Karte ${i}`).join('\n');
  const r = parseManaBox(txt);
  assert.deepEqual(codes(r), ['too_many']);
  assert.deepEqual([r.commanders, r.main], [[], []]);
  assert.equal(parseManaBox(Array.from({ length: 250 }, (_, i) => `1 Karte ${i}`).join('\n')).main.length, 250);
});

test('M10 ohne Commander-Kopf ⇒ Warnung no_commander, Hauptdeck trotzdem da', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox('1 Sol Ring (DRC) 56\n32 Plains (DFT) 277');
  assert.deepEqual(codes(r), ['no_commander']);
  assert.equal(r.main.length, 2);
  assert.deepEqual(r.commanders, []);
});

test('M11 Negativraum: Name leer / nur Anzahl / nur Set ⇒ syntax, kein Absturz', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox('3\n2x\n1 (DRC) 56\n(DRC) 56\n1 Sol Ring (DRC) 56');
  assert.deepEqual(r.errors.map((e) => [e.line, e.code]), [[1, 'syntax'], [2, 'syntax'], [3, 'syntax'], [4, 'syntax']]);
  assert.deepEqual(r.main, [{ qty: 1, name: 'Sol Ring', set: 'DRC', number: '56' }]);
  // unpaarige Klammern im Namen ⇒ syntax; paarige (B.F.M. (Big Furry Monster)) sind ein gültiger Name
  assert.deepEqual(codes(parseManaBox('1 Sol Ring (DRC')), ['syntax']);
  assert.deepEqual(parseManaBox('1 B.F.M. (Big Furry Monster) (UGL) 28').main,
    [{ qty: 1, name: 'B.F.M. (Big Furry Monster)', set: 'UGL', number: '28' }]);
});

test('M12 Risiko 1: Commander-Kopf mitten im Text (ohne Leerzeile davor) und Partner-Paar', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox('1 Sol Ring (DRC) 56\n// COMMANDER\n1 Tymna the Weaver (C16) 48\n1 Thrasios, Triton Hero (C16) 46\n\n1 Island');
  assert.deepEqual(r.commanders.map((e) => e.name), ['Tymna the Weaver', 'Thrasios, Triton Hero']);
  assert.deepEqual(r.main.map((e) => e.name), ['Sol Ring', 'Island']);
  assert.deepEqual(r.errors, []);
});

test('M13 Risiko 1: Commander ohne Leerzeile danach ⇒ erste Zeile Commander, Rest Hauptdeck (Heuristik)', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox(EXPORT.replace("(NEO) 25\n\n", '(NEO) 25\n'));
  assert.deepEqual(r.commanders, [{ qty: 1, name: "Light-Paws, Emperor's Voice", set: 'NEO', number: '25' }]);
  assert.equal(r.main.length, 68);
  assert.equal(sum(r.main), 99);
  assert.deepEqual(r.errors, []);
});

test('M14 Risiko 2: 30 gleiche Basic Lands in einer Zeile', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox('// COMMANDER\n1 Light-Paws, Emperor\'s Voice (NEO) 25\n\n30 Plains (DFT) 277\n1 Sol Ring (DRC) 56');
  assert.deepEqual(r.main[0], { qty: 30, name: 'Plains', set: 'DFT', number: '277' });
  assert.equal(sum(r.main), 31);
});

test('M15 Sammlernummern mit Buchstaben/Sternchen, kleingeschriebenes Set, Foil-Kennung', async () => {
  const { parseManaBox } = await mb();
  const r = parseManaBox('1 Mox Amber (dom) 224★\n1 Sol Ring (PLST) C21-263\n1 Arcane Signet (PW22) 3 *F*');
  assert.deepEqual(r.main, [
    { qty: 1, name: 'Mox Amber', set: 'DOM', number: '224★' },
    { qty: 1, name: 'Sol Ring', set: 'PLST', number: 'C21-263' },
    { qty: 1, name: 'Arcane Signet', set: 'PW22', number: '3' },
  ]);
});
