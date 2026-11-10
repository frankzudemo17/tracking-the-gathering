// Reine Anzeige-Helfer der K.O.-Screens (src/views/ko.js, Spec P11 Nachtrag 13:45, B1):
// Rundenzahl und anteiliger Lebensbalken des Verursachers (Variante C). Dazu die neuen Textbausteine (de/en).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koRound, koBarSegs, koCardCmd } from '../../src/views/ko.js';
import de from '../../src/i18n/de-ko.js';
import en from '../../src/i18n/en-ko.js';

test('koRound: ganze Zahl ≥ 1, sonst null (alter Aufrufer ohne round)', () => {
  assert.equal(koRound(7), 7);
  assert.equal(koRound(1), 1);
  assert.equal(koRound('3'), 3);
  assert.equal(koRound(undefined), null);
  assert.equal(koRound(null), null);
  assert.equal(koRound(0), null);
  assert.equal(koRound(2.5), null);
  assert.equal(koRound('x'), null);
});

test('koBarSegs: anteilig by/start in 10 Segmenten, begrenzt auf 0–100 %', () => {
  assert.equal(koBarSegs({ victim: -2, by: 24, start: 40 }), 6); // Mockup ko-c-arcade.html: 6 von 10
  assert.equal(koBarSegs({ victim: 0, by: 40, start: 40 }), 10);
  assert.equal(koBarSegs({ victim: 0, by: 55, start: 40 }), 10); // über Startleben ⇒ 100 %
  assert.equal(koBarSegs({ victim: 0, by: 1, start: 40 }), 1); // lebend ⇒ mindestens ein Segment
  assert.equal(koBarSegs({ victim: 0, by: 0, start: 40 }), 0);
  assert.equal(koBarSegs({ victim: 0, by: -3, start: 40 }), 0); // unter 0 ⇒ 0 %
  assert.equal(koBarSegs({ victim: 0, by: 10, start: 20 }), 5);
});

test('koBarSegs: fehlende Angaben ⇒ null (Bild wie vorher)', () => {
  assert.equal(koBarSegs(undefined), null);
  assert.equal(koBarSegs(null), null);
  assert.equal(koBarSegs({ victim: 0, by: null, start: 40 }), null);
  assert.equal(koBarSegs({ victim: 0, by: 20 }), null);
  assert.equal(koBarSegs({ victim: 0, by: 20, start: 0 }), null);
  assert.equal(koBarSegs({ victim: 0, by: 'x', start: 40 }), null);
});

test('Textbausteine B1/B2: Runde in A/B/C, A-Tag „FINISH HIM!“ in de und en', () => {
  const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k]));
  assert.equal(de.aTag, 'FINISH HIM!');
  assert.equal(en.aTag, 'FINISH HIM!');
  assert.equal(fill(de.aRound, { n: 7 }), 'fällt in Runde 7');
  assert.equal(fill(de.bRound, { n: 7 }), 'Runde 7');
  assert.equal(fill(de.bCard, { n: 7, cmd: 'Tymna & Thrasios' }), 'Runde 7 · Tymna & Thrasios');
  assert.equal(fill(de.cRound, { n: 7 }), 'R7');
  for (const k of ['aRound', 'bRound', 'bCard', 'cRound']) assert.match(en[k], /\{n\}/, k);
  assert.notEqual(de.aTag, de.title); // eigener Schlüssel, nicht ko.title
});

test('koCardCmd: volle Commander-Zeile, wenn sie passt, sonst erstes Wort je Commander (Mockup „Tymna & Thrasios“)', () => {
  const tymna = { commander_name: 'Tymna the Weaver', partner_name: 'Thrasios, Triton Hero' };
  assert.equal(koCardCmd(tymna, 30), 'Tymna the Weaver & Thrasios');
  assert.equal(koCardCmd(tymna, 20), 'Tymna & Thrasios');
  assert.equal(koCardCmd({ commander_name: 'Krenko, Mob Boss' }, 20), 'Krenko');
  assert.equal(koCardCmd({ commander_name: 'Kenrith the Returned King' }, 20), 'Kenrith');
  assert.equal(koCardCmd({ commander_name: 'Abcdefghijklmnopqrstuvwxyz' }, 10), 'Abcdefghi…');
  assert.equal(koCardCmd(null, 20), '');
});
