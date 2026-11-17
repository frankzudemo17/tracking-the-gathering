// P7 Anleitung „So funktioniert’s“: Vollständigkeit (jeder Eintrag in de/en mit Titel, Unterzeile, Punkten), Symbole
// vorhanden, Route + Einstieg in den Einstellungen, und die Zahlen im Text passen zum Code (Punkte, K.O.-Grenzen, ±5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUIDE, guideHtml } from '../../src/views/guide.js';
import { setLang } from '../../src/i18n/index.js';
import { icon } from '../../src/lib/icons.js';
import { placePoints } from '../../src/lib/stats.js';
import { POISON_MAX, CMD_LETHAL } from '../../src/game/engine.js';
import de from '../../src/i18n/de.js';
import en from '../../src/i18n/en.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const keys = GUIDE.flatMap(([, items]) => items.map(([k]) => k));

test('G1: jeder Eintrag hat in de und en Titel, Unterzeile und mindestens einen Punkt; keine verwaisten Texte', () => {
  for (const [lang, dict] of [['de', de], ['en', en]]) {
    for (const [g] of GUIDE) assert.ok(dict.guide.groups[g], `${lang} Gruppe ${g}`);
    for (const k of keys) {
      const it = dict.guide.items[k];
      assert.ok(it?.title && it?.sub, `${lang} ${k} Titel/Unterzeile`);
      assert.ok(Array.isArray(it.body) && it.body.length > 0 && it.body.every((p) => typeof p === 'string' && p.trim()), `${lang} ${k} Punkte`);
      assert.equal(it.body.length, (lang === 'de' ? en : de).guide.items[k].body.length, `${k}: gleich viele Punkte in de/en`);
    }
    assert.deepEqual(Object.keys(dict.guide.items).sort(), [...keys].sort(), `${lang}: Texte ohne Eintrag oder Eintrag ohne Text`);
  }
});

test('G2: alle Symbole der Anleitung gibt es (kein leeres SVG)', () => {
  for (const [, items] of GUIDE) for (const [k, ic] of items) assert.match(String(icon(ic)), /<path/, `${k}: Symbol ${ic}`);
  assert.doesNotMatch(String(icon('gibtsNicht')), /<path/, 'Gegenprobe: unbekanntes Symbol ist leer');
});

test('G3: Seite zeigt jeden Eintrag einmal, Punkte als Liste, Zurück zu den Einstellungen', () => {
  globalThis.document ??= /** @type {any} */ ({ documentElement: {} }); // setLang setzt <html lang>
  setLang('de');
  const h = String(guideHtml());
  for (const k of keys) assert.equal(h.split(`data-guide="${k}"`).length - 1, 1, k);
  assert.match(h, /href="#\/einstellungen"/);
  assert.ok(h.includes(de.guide.items.points.body[1]), 'Punkt-Text steht drin');
  assert.equal((h.match(/<li>/g) || []).length, keys.reduce((n, k) => n + de.guide.items[k].body.length, 0));
  setLang('en');
  assert.ok(String(guideHtml()).includes(en.guide.title));
  setLang('de');
});

test('G4: Route und Einstieg in den Einstellungen, Dateien im Service Worker', () => {
  assert.match(read('src/main.js'), /route\('\/einstellungen\/anleitung', v\('guide'\)/);
  assert.match(read('src/views/settings.js'), /href="#\/einstellungen\/anleitung"/);
  const sw = read('sw.js');
  for (const f of ['./src/views/guide.js', './src/i18n/de-guide.js', './src/i18n/en-guide.js']) assert.ok(sw.includes(`'${f}'`), f);
});

test('G5: Zahlen im Text passen zum Code — Punkte 4/2/1/0, K.O. bei 10 Gift und 21 Commander-Schaden, Halten = ±5', () => {
  assert.deepEqual([1, 2, 3, 4].map((p) => placePoints(4, p)), [4, 2, 1, 0]);
  for (const dict of [de, en]) {
    assert.match(dict.guide.items.points.body[1], /4, 2, 1 (und|and) 0/);
    assert.ok(dict.guide.items.ko.body[0].includes(`${POISON_MAX} `) && dict.guide.items.ko.body[0].includes(`${CMD_LETHAL} `));
  }
  assert.match(read('src/views/life.js'), /const TAP_STEP = 5;/);
  assert.match(de.guide.items.life.body[0], /Fünferschritten/);
  assert.match(en.guide.items.life.body[0], /steps of five/);
});
