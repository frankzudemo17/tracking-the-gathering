// Spec P7: Feldfarbe (src/lib/field-color.js) und Zufallsquelle der App (src/lib/rand.js).
// Jeder Fall lädt das Modul selbst per import() ⇒ ohne die Module rot (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const fc = () => import('../../src/lib/field-color.js');
const rnd = () => import('../../src/lib/rand.js');

/** Relative Leuchtdichte (WCAG) einer #RRGGBB-Farbe. */
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

test('F1 Override: eigene Feldfarbe gewinnt vor Commander-Farben (HANDOFF 5.4a)', async () => {
  const { fieldColors } = await fc();
  assert.deepEqual(fieldColors({ field_color: '#1F8A8A', color_identity: ['U', 'G'] }), ['#1F8A8A']);
});

test('F2 Commander-Farben: Mana-Pips in WUBRG-Reihenfolge (WELLE E2 F1: keine Spielerfarben)', async () => {
  const { fieldColors } = await fc();
  assert.deepEqual(fieldColors({ field_color: null, color_identity: ['G', 'W'] }), ['#EFE6C4', '#2E7D50']);
});

test('F3 farblos: #8A94A3 (HANDOFF 4)', async () => {
  const { fieldColors } = await fc();
  assert.deepEqual(fieldColors({ color_identity: [] }), ['#8A94A3']);
  assert.deepEqual(fieldColors(null), ['#8A94A3']);
});

test('F4 Palette: genau die 10 Farben aus HANDOFF 5.4a', async () => {
  const { PALETTE } = await fc();
  assert.equal(PALETTE.length, 10);
  assert.deepEqual(PALETTE, ['#C4452F', '#D9822B', '#C9A45C', '#2E7D50', '#1F8A8A', '#2D6DB5', '#6B4FB8', '#C2457A', '#8A5A3C', '#6B7480']);
});

test('F5 Testhaken nur lokal: __ttgRand wirkt nur auf localhost/127.0.0.1', async () => {
  const { appRand } = await rnd();
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const setHost = (hostname) => Object.defineProperty(globalThis, 'location', { value: { hostname }, configurable: true, writable: true });
  globalThis.__ttgRand = () => 0.123456;
  try {
    setHost('tracking.example');
    for (let i = 0; i < 20; i++) {
      const v = appRand();
      assert.notEqual(v, 0.123456);
      assert.ok(typeof v === 'number' && v >= 0 && v < 1, `Zahl ∈ [0,1): ${v}`);
    }
    setHost('localhost');
    assert.equal(appRand(), 0.123456);
    setHost('127.0.0.1');
    assert.equal(appRand(), 0.123456);
    delete globalThis.__ttgRand;
    const v = appRand();
    assert.ok(v >= 0 && v < 1 && v !== 0.123456, 'ohne Haken echte Quelle');
  } finally {
    delete globalThis.__ttgRand;
    if (had) Object.defineProperty(globalThis, 'location', had); else delete globalThis.location;
  }
});

test('F6 Rahmen dunkler: frameColor senkt die Leuchtdichte (HANDOFF 5.4c)', async () => {
  const { frameColor } = await fc();
  const out = frameColor('#C4452F');
  assert.match(out, /^#[0-9A-F]{6}$/i);
  assert.ok(luminance(out) < luminance('#C4452F'), `${out} nicht dunkler`);
});

test('F7 fieldStyle: Modus art ohne Tönung, color/commander getönt (135°-Streifen bei mehreren Farben)', async () => {
  const { fieldStyle, fieldMode } = await fc();
  const art = fieldStyle(['#2D6DB5'], 'nacht', 'art');
  assert.equal(art['--field-bg'], 'none');
  assert.equal(art['--field-accent'], '#2D6DB5');
  const one = fieldStyle(['#2D6DB5'], 'nacht', 'color');
  assert.match(one['--field-bg'], /^color-mix\(in srgb, #2D6DB5 58%, transparent\)$/);
  const many = fieldStyle(['#EFE6C4', '#2E7D50'], 'arktis', 'commander');
  assert.match(many['--field-bg'], /^linear-gradient\(135deg,/);
  assert.ok(many['--field-bg'].includes('52%'), 'Mischanteil Arktis 52 %');
  assert.equal(fieldMode({ field_mode: 'commander' }), 'commander');
  assert.equal(fieldMode({ field_color: '#1F8A8A' }), 'color');
  assert.equal(fieldMode({}), 'art');
});
