// Spec P13: Format-Helfer (src/lib/format.js). Sollwerte von Hand aus der Spec-Tabelle.
// Jeder Fall lädt das Modul selbst per import() ⇒ ohne die Datei rot (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const fmt = () => import('../../src/lib/format.js');
const DASH = '–'; // „–“ für fehlende Werte
const NNBSP = ' '; // schmales geschütztes Leerzeichen vor „%“ (de)

test('fmtAvg: eine Nachkommastelle, kaufmännisch, de mit Komma', async () => {
  const { fmtAvg } = await fmt();
  assert.equal(fmtAvg(3.25), '3,3');
  assert.equal(fmtAvg(2.75), '2,8');
  assert.equal(fmtAvg(7 / 3), '2,3');
  assert.equal(fmtAvg(4), '4,0');
  assert.equal(fmtAvg(3.25, 'de'), '3,3');
});

test('fmtAvg: en mit Punkt, fehlende Werte ⇒ –', async () => {
  const { fmtAvg } = await fmt();
  assert.equal(fmtAvg(3.25, 'en'), '3.3');
  assert.equal(fmtAvg(4, 'en'), '4.0');
  assert.equal(fmtAvg(null), DASH);
  assert.equal(fmtAvg(undefined), DASH);
  assert.equal(fmtAvg(NaN), DASH);
});

test('fmtAvg: Hälfte von null weg, auch negativ', async () => {
  const { fmtAvg } = await fmt();
  assert.equal(fmtAvg(-0.25), '-0,3');
  assert.equal(fmtAvg(0), '0,0');
});

test('fmtPct: ganze Prozent kaufmännisch, de mit U+202F, en ohne Abstand', async () => {
  const { fmtPct } = await fmt();
  assert.equal(fmtPct(1 / 3), `33${NNBSP}%`);
  assert.equal(fmtPct(1 / 6), `17${NNBSP}%`);
  assert.equal(fmtPct(0), `0${NNBSP}%`);
  assert.equal(fmtPct(1), `100${NNBSP}%`);
  assert.equal(fmtPct(1 / 3, 'en'), '33%');
  assert.equal(fmtPct(0.125, 'en'), '13%');
  assert.equal(fmtPct(null), DASH);
  assert.equal(fmtPct(undefined, 'en'), DASH);
});

test('fmtMmss: m:ss, Sekunden vorher kaufmännisch gerundet', async () => {
  const { fmtMmss } = await fmt();
  assert.equal(fmtMmss(156.67), '2:37');
  assert.equal(fmtMmss(618), '10:18');
  assert.equal(fmtMmss(59.5), '1:00');
  assert.equal(fmtMmss(0), '0:00');
  assert.equal(fmtMmss(null), DASH);
});

test('fmtHm: h:mm h', async () => {
  const { fmtHm } = await fmt();
  assert.equal(fmtHm(170), '2:50 h');
  assert.equal(fmtHm(52), '0:52 h');
  assert.equal(fmtHm(null), DASH);
});

test('minutesBetween: ganze Minuten kaufmännisch, null bei fehlendem Wert', async () => {
  const { minutesBetween } = await fmt();
  assert.equal(minutesBetween('2026-10-31T19:00:00+01:00', '2026-10-31T19:41:00+01:00'), 41);
  assert.equal(minutesBetween('2026-10-31T19:00:00+01:00', '2026-10-31T19:41:30+01:00'), 42);
  assert.equal(minutesBetween('2026-10-31T19:00:00+01:00', null), null);
  assert.equal(minutesBetween(null, '2026-10-31T19:41:00+01:00'), null);
});
