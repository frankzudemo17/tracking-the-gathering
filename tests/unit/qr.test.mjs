// Spec P9b Krit. 7a: QR-Matrix und SVG mit jsQR zurücklesen; Ruhezone gemessen.
// Gegenprobe (b): ein gekipptes Modul fängt die Fehlerkorrektur ab — deshalb wird zur Gegenprobe ein
// falscher Text kodiert (siehe Bericht), nicht ein Modul gekippt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { qrMatrix, qrSvg, QUIET } from '../../src/zugang/qr.js';

const LINK = 'https://frankzudemo17.github.io/tracking-the-gathering/#/beitreten/TTG-ABCDEF';
const CASES = [
  ['kurz', 'TTG-K7Q2MX'],
  [`echter Link (${LINK.length} Zeichen)`, LINK],
  ['Umlaute', 'Küchentisch Ölmühle — Straße äöüß ÄÖÜ'],
  ['150 Zeichen', `${LINK}?x=`.padEnd(150, 'abcdefghij')],
  ['nur Ziffern', '0123456789012345678901234567890'],
];

/** Matrix (ohne Ruhezone) ⇒ RGBA-Bild mit Ruhezone q, scale px je Modul. */
function raster(m, q = QUIET, scale = 4) {
  const n = m.length + q * 2;
  const w = n * scale;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) {
    if (!m[r][c]) continue;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + q) * scale + y) * w + (c + q) * scale + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  return { px, w };
}

/** SVG-Pfad (M x y h w v1 h-w z) ⇒ Matrix inkl. Ruhezone, plus gemessene Ränder. */
function svgToMatrix(svg) {
  const s = String(svg);
  const n = Number(s.match(/viewBox="0 0 (\d+) \1"/)[1]);
  const m = Array.from({ length: n }, () => Array(n).fill(false));
  let minX = n, minY = n, maxX = 0, maxY = 0;
  for (const [, x, y, w] of s.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    const X = +x, Y = +y, Wd = +w;
    for (let i = 0; i < Wd; i++) m[Y][X + i] = true;
    minX = Math.min(minX, X); minY = Math.min(minY, Y); maxX = Math.max(maxX, X + Wd); maxY = Math.max(maxY, Y + 1);
  }
  return { n, m, quiet: { left: minX, top: minY, right: n - maxX, bottom: n - maxY } };
}

for (const [name, text] of CASES) {
  test(`QR ${name}: Matrix mit jsQR gelesen = Eingabe`, () => {
    const m = qrMatrix(text);
    assert.ok(m.length >= 21 && m.every((r) => r.length === m.length), 'quadratisch, mind. Version 1');
    const { px, w } = raster(m);
    const got = jsQR(px, w, w);
    assert.ok(got, 'jsQR findet den Code');
    assert.equal(Buffer.from(got.binaryData).toString('utf8'), text);
  });
  test(`QR ${name}: SVG — Ruhezone 4 Module gemessen, Bildpunkte gelesen = Eingabe`, () => {
    const svg = String(qrSvg(text, { size: 256, label: 'Einladung' }));
    assert.match(svg, /shape-rendering="crispEdges"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /aria-label="Einladung"/);
    assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/><path fill="#000"/);
    const { n, m, quiet } = svgToMatrix(svg);
    assert.equal(n, qrMatrix(text).length + 2 * QUIET);
    assert.deepEqual(quiet, { left: 4, top: 4, right: 4, bottom: 4 });
    const { px, w } = raster(m, 0);
    const got = jsQR(px, w, w);
    assert.ok(got, 'jsQR findet den Code im SVG');
    assert.equal(Buffer.from(got.binaryData).toString('utf8'), text);
  });
}

test('QR leerer Text ⇒ Fehler', () => {
  assert.throws(() => qrMatrix(''), /leer/);
  assert.throws(() => qrSvg(''), /leer/);
});

test('QR SVG escaped das Label', () => {
  assert.match(String(qrSvg('x', { label: '<b>"Tisch"</b>' })), /aria-label="&lt;b&gt;&quot;Tisch&quot;&lt;\/b&gt;"/);
});
