// Spec P19: Teilen-Karte (src/views/recap-card.js) — reine Teile: Umbruch, Kürzen, Layout, Icons, Zeichnen gegen eine
// Attrappe von CanvasRenderingContext2D. Sollwerte von Hand (Messung: 10 px je Zeichen).
// Jeder Fall lädt das Modul selbst per import() ⇒ ohne die Datei rot (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const card = () => import('../../src/views/recap-card.js');
const measure = (s) => s.length * 10;

test('fitText: passt ⇒ unverändert, sonst gekürzt mit „…“', async () => {
  const { fitText } = await card();
  assert.equal(fitText(measure, 'Franco', 60), 'Franco');
  assert.equal(fitText(measure, 'Franco', 50), 'Fran…');
  assert.equal(fitText(measure, '', 50), '');
});

test('wrapLines: Wortumbruch, Rest passt ⇒ kein „…“', async () => {
  const { wrapLines } = await card();
  assert.deepEqual(wrapLines(measure, 'Edgar-Swing mit vierzehn Vampiren.', 200, 4), ['Edgar-Swing mit', 'vierzehn Vampiren.']);
  assert.deepEqual(wrapLines(measure, '  ', 200, 4), []);
});

test('wrapLines: langer POTG-Text (200 Zeichen) ⇒ höchstens 4 Zeilen, letzte endet mit „…“', async () => {
  const { wrapLines } = await card();
  const long = 'Kinnan plus Basalt Monolith und dann noch ein Swing mit vierzehn Vampiren, danach Proliferate auf Gift, '
    + 'und am Ende kam Approach of the Second Sun aus dem Nichts — Marie hat es wieder getan, und alle schauten zu.';
  assert.ok(long.length >= 200);
  const lines = wrapLines(measure, long, 300, 4);
  assert.equal(lines.length, 4);
  assert.ok(lines[3].endsWith('…'), lines[3]);
  for (const l of lines) assert.ok(measure(l) <= 300, `zu breit: ${l}`);
});

test('wrapLines: überlanges Wort wird zeichenweise getrennt', async () => {
  const { wrapLines } = await card();
  assert.deepEqual(wrapLines(measure, 'abcdefghij', 40, 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapLines(measure, 'abcdefghijklmnopq', 40, 2), ['abcd', 'efg…']);
});

test('cardLayout: alle Kacheln untereinander, Paar nebeneinander, nichts über dem Fuß', async () => {
  const { cardLayout, CARD_W, CARD_H, KING_H, PAIR_H } = await card();
  const L = cardLayout({ king: true, salt: true, turn: true, potg: true, quoteLines: 4 });
  assert.ok(L.king.h >= KING_H);
  assert.equal(L.salt.y, L.turn.y);
  assert.equal(L.salt.h, PAIR_H);
  assert.ok(L.turn.x > L.salt.x + L.salt.w, 'Paar nebeneinander');
  assert.equal(L.turn.x + L.turn.w, CARD_W - 72);
  assert.ok(L.potg.y > L.salt.y + L.salt.h);
  assert.ok(L.bottom <= L.foot.y - 28, `Kacheln (${L.bottom}) überlappen den Fuß (${L.foot.y})`);
  assert.ok(L.foot.y + L.foot.h <= CARD_H);
});

test('cardLayout: fehlende Kachel fällt weg, einzelne Halbkachel nimmt die ganze Breite', async () => {
  const { cardLayout, CARD_W, QUOTE_LINE } = await card();
  const L = cardLayout({ king: true, salt: true, turn: false, potg: true, quoteLines: 1 });
  assert.equal(L.turn, null);
  assert.equal(L.salt.w, CARD_W - 2 * 72);
  const none = cardLayout({ king: false, salt: false, turn: false, potg: false });
  assert.equal(none.king, null); assert.equal(none.potg, null); assert.equal(none.salt, null);
  const q1 = cardLayout({ king: true, salt: true, turn: true, potg: true, quoteLines: 1 });
  const q4 = cardLayout({ king: true, salt: true, turn: true, potg: true, quoteLines: 4 });
  assert.equal(q4.potg.h - q1.potg.h, 3 * QUOTE_LINE);
  const q9 = cardLayout({ king: true, salt: true, turn: true, potg: true, quoteLines: 9 });
  assert.equal(q9.potg.h, q4.potg.h, 'höchstens 4 Zeilen');
  // freier Platz geht ans Tageskönig-Bild: kürzeres Zitat ⇒ größeres Bild, Unterkante gleich
  assert.equal(q1.king.h - q4.king.h, 3 * QUOTE_LINE);
  assert.equal(q1.bottom, q4.bottom);
});

test('iconShapes: salt (eigene Zeichnung) = 2 Strich-Pfade + 2 Kreise; Phosphor-Pfad gefüllt', async () => {
  const { iconShapes } = await card();
  const { I } = await import('../../src/lib/icons.js');
  const s = iconShapes(I.salt);
  assert.equal(s.filter((x) => x.kind === 'path' && x.stroke === 16).length, 2);
  assert.equal(s.filter((x) => x.kind === 'circle').length, 2);
  const q = iconShapes(I.quotes);
  assert.equal(q.length, 1);
  assert.equal(q[0].stroke, 0);
});

test('withAlpha + cardFileName', async () => {
  const { withAlpha, cardFileName } = await card();
  assert.equal(withAlpha('#1A2540', 0), 'rgba(26, 37, 64, 0)');
  assert.equal(withAlpha('var(--x)', 0.5), 'var(--x)');
  assert.equal(cardFileName('2026-10-31'), 'ttg-abend-2026-10-31.png');
  assert.equal(cardFileName(''), 'ttg-abend.png');
});

// ---- Zeichnen gegen eine Attrappe
function fakeCtx() {
  const calls = [];
  const grad = () => ({ stops: [], addColorStop(o, c) { this.stops.push([o, c]); } });
  const ctx = new Proxy({ calls, font: '', fillStyle: '', strokeStyle: '', letterSpacing: '0px', globalAlpha: 1, globalCompositeOperation: 'source-over' }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (s) => ({ width: String(s).length * 16 });
      if (key === 'createLinearGradient') return (...a) => { const g = grad(); calls.push(['gradient', a, g]); return g; };
      return (...a) => { calls.push([key, a]); };
    },
    set(target, key, v) { if (key === 'globalAlpha' || key === 'globalCompositeOperation' || key === 'filter') calls.push(['set', key, v]); target[key] = v; return true; },
  });
  return ctx;
}
const THEME = {
  bg: '#0F1729', sf: '#1A2540', sf2: '#24325A', ink: '#F3F6FC', mu: '#94A3C2', ln: '#2A3860', hi: '#E9C46A',
  fDisplay: 'system-ui', fBody: 'system-ui', mana: { W: '#EFE6C4', U: '#2D6DB5', B: '#3A3337', R: '#C4452F', G: '#2E7D50' }, logo: '',
};
const MODEL = {
  brand: 'Tracking the Gathering', tag: '#TTG', title: 'Spieleabend', date: 'Samstag, 31. Oktober 2026', location: 'Lukas WG',
  king: { label: 'Tageskönig', name: 'Franco', initials: 'FR', sub: '1 Sieg · 7 Punkte', deck: 'Atraxa', avatarUrl: null, artUrl: 'x', colors: ['W', 'U', 'B', 'G'] },
  salt: { label: 'Salzigster', name: 'Deniz', sub: 'Ø Salz 3,3 von 5', filled: 3 },
  turn: { label: 'Längster Zug', name: 'Deniz', sub: '10:18 Minuten am Stück' },
  potg: { label: 'Play of the Game', name: 'Luka', sub: '4 Stimmen', quote: 'Edgar-Swing mit vierzehn Vampiren.' },
  foot: '3 Spiele · 2:50 h',
};
globalThis.Path2D ??= class { constructor(d) { this.d = d; } };

test('drawCard: Commander-Bild ungetönt (kein Filter/Alpha/Mischmodus), Verlauf in --sf, alle Texte gezeichnet', async () => {
  const { drawCard } = await card();
  const ctx = fakeCtx();
  const art = { naturalWidth: 626, naturalHeight: 457, tag: 'art' };
  drawCard(ctx, MODEL, THEME, { art, logo: null, avatar: null });
  const c = ctx.calls;
  assert.deepEqual(c.filter((x) => x[0] === 'set'), [], 'keine Tönung über globalAlpha/Mischmodus/Filter');
  const artDraws = c.filter((x) => x[0] === 'drawImage' && x[1][0] === art);
  assert.equal(artDraws.length, 1);
  const texts = c.filter((x) => x[0] === 'fillText').map((x) => x[1][0]);
  for (const s of ['Franco', 'Deniz', 'Luka', '3 Spiele · 2:50 h', '1 Sieg · 7 Punkte · Atraxa', 'Samstag, 31. Oktober 2026 · Lukas WG', '#TTG']) {
    assert.ok(texts.includes(s), `Text fehlt: ${s} (da: ${texts.join(' | ')})`);
  }
  const fade = c.filter((x) => x[0] === 'gradient').map((x) => x[2].stops).find((st) => st.length === 3);
  assert.ok(fade, 'Verlauf vorhanden');
  assert.equal(fade[2][1], THEME.sf, 'Verlauf endet in der Fläche');
  assert.equal(fade[0][1], 'rgba(26, 37, 64, 0)', 'oben frei (transparent)');
});

test('drawCard: ohne Bilder ⇒ Initialen + Farbfläche, ohne Kacheln ⇒ kein Wurf', async () => {
  const { drawCard } = await card();
  const ctx = fakeCtx();
  drawCard(ctx, MODEL, THEME, {});
  const texts = ctx.calls.filter((x) => x[0] === 'fillText').map((x) => x[1][0]);
  assert.ok(texts.includes('FR'), 'Initialen statt Avatar');
  assert.equal(ctx.calls.filter((x) => x[0] === 'drawImage').length, 0);
  const bare = fakeCtx();
  drawCard(bare, { ...MODEL, king: null, salt: null, turn: null, potg: null }, THEME, {});
  assert.ok(bare.calls.some((x) => x[0] === 'fillText' && x[1][0] === '3 Spiele · 2:50 h'));
});
