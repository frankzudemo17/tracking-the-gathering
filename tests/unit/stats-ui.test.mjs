// Bausteine der Profil-/Deck-Statistik (src/views/stats-ui.js, Spec P18): Diagramm-Geometrie,
// Ausblenden ohne Werte, keine NaN/Division durch 0, Endwert-Beschriftung, Datumsanzeige.
// Imports dynamisch im Test (Baseline-Regel: am Basis-Stand fehlt die Datei ⇒ Test rot, nicht Lauf-Abbruch).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ui = () => import('../../src/views/stats-ui.js');
const fx = () => import('../fixtures/gruppe.mjs');
const st = () => import('../../src/lib/stats.js');

test('linePoints: < 2 Werte ⇒ null; Linie von links unten nach rechts oben', async () => {
  const { linePoints, LINE_BOX: b } = await ui();
  assert.equal(linePoints([]), null);
  assert.equal(linePoints([4]), null);
  const g = linePoints([4, 6, 7, 9, 13, 15]);
  assert.equal(g.pts.length, 6);
  assert.equal(g.last, 15);
  assert.equal(g.max, 15);
  assert.deepEqual(g.pts[0], [b.padL, b.padT + (1 - 4 / 15) * (b.h - b.padT - b.padB)]);
  assert.deepEqual(g.pts[5], [b.w - b.padR, b.padT]); // größter Wert = oberer Rand
});

test('linePoints: nur Nullen ⇒ Grundlinie, keine NaN', async () => {
  const { linePoints, LINE_BOX: b } = await ui();
  const g = linePoints([0, 0, 0]);
  for (const [x, y] of g.pts) { assert.ok(Number.isFinite(x)); assert.equal(y, b.h - b.padB); }
});

test('pointsLine: Fixture Franco endet bei 15, ein SVG mit viewBox; < 2 Spiele ⇒ leer', async () => {
  const { pointsLine } = await ui();
  const { memberProfile } = await st();
  const { fixtureGroupData } = await fx();
  const s = String(pointsLine(memberProfile(fixtureGroupData(), 'm-F').pointsSeries));
  assert.match(s, /<svg viewBox="0 0 320 120"/);
  assert.match(s, /<text class="st-end"[^>]*>15<\/text>/);
  assert.equal((s.match(/<polyline/g) || []).length, 1);
  assert.doesNotMatch(s, /NaN|playerColor|--p-/);
  assert.equal(String(pointsLine([3])), '');
});

test('saltBars: ein Balken je Wert (Franco [1,3,5,2,1,4]); leer ⇒ ausgeblendet; ein Wert geht', async () => {
  const { saltBars } = await ui();
  const { memberProfile } = await st();
  const { fixtureGroupData } = await fx();
  const trend = memberProfile(fixtureGroupData(), 'm-F').saltTrend;
  assert.deepEqual(trend, [1, 3, 5, 2, 1, 4]);
  const s = String(saltBars(trend));
  assert.deepEqual([...s.matchAll(/style="--v:(\d)"/g)].map((m) => Number(m[1])), [1, 3, 5, 2, 1, 4]);
  assert.equal(String(saltBars([])), '');
  assert.equal([...String(saltBars([2])).matchAll(/--v:2/g)].length, 1);
});

test('kpis: fünf Kacheln in .stats.st-5, Werte escaped', async () => {
  const { kpis } = await ui();
  const s = String(kpis([{ v: 6, l: 'Spiele' }, { v: 2, l: 'Siege' }, { v: 15, l: 'Punkte' }, { v: '2,0', l: 'Ø Platz' }, { v: '<b>', l: 'x' }]));
  assert.equal((s.match(/class="stat"/g) || []).length, 5);
  assert.match(s, /class="stats st-5"/);
  assert.match(s, /&lt;b&gt;/);
});

test('iconScale: --v = Wert, fehlend ⇒ 0; Sterne unten leer, oben gefüllt', async () => {
  const { iconScale } = await ui();
  const s = String(iconScale(3.25, 'star', 'de'));
  assert.match(s, /--v:3\.25/);
  assert.match(s, /aria-label="3,3 von 5"/);
  assert.equal((s.match(/<svg/g) || []).length, 10);
  const n = String(iconScale(null, 'salt', 'de'));
  assert.match(n, /--v:0/);
  assert.match(n, /aria-label="– von 5"/);
});

test('fmtDay: Spieltag in Berlin-Zeit, Unsinn ⇒ –', async () => {
  const { fmtDay } = await ui();
  assert.equal(fmtDay('2026-11-06T19:30:00+01:00', 'de'), '6. Nov. 2026');
  assert.equal(fmtDay('2026-10-31T23:30:00Z', 'de'), '1. Nov. 2026');
  assert.equal(fmtDay(null, 'de'), '–');
  assert.equal(fmtDay('x', 'en'), '–');
});
