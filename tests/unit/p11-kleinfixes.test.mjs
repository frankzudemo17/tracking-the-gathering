// P11 Kleinfixes: Einzahl „1 Runde“, Hinweis „beim nächsten Öffnen ergänzt“ (Grenze 200), Linkfarbe helle Looks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.document ??= /** @type {any} */ ({ documentElement: {} });
const L = () => import('../../src/i18n/index.js');

test('K1 Einzahl für eine Runde (de/en), Mehrzahl unverändert', async () => {
  const { setLang, t } = await L();
  setLang('de');
  assert.equal(t('history.roundsOne'), '1 Runde');
  assert.equal(t('history.rounds', { n: 7 }), '7 Runden');
  assert.equal(t('result.metaOne', { min: 12 }), '1 Runde · 12 Min');
  assert.equal(t('stats.roundsOne'), '1 Runde');
  assert.equal(t('stats.inRoundsOne'), 'in 1 Runde');
  setLang('en');
  assert.equal(t('history.roundsOne'), '1 round');
  assert.equal(t('result.metaOne', { min: 12 }), '1 round · 12 min');
  assert.equal(t('stats.inRoundsOne'), 'in 1 round');
  setLang('de');
});

test('K2 jede Aufrufstelle wählt bei 1 die Einzahl', () => {
  const src = (f) => readFileSync(new URL(`../../src/views/${f}`, import.meta.url), 'utf8');
  assert.match(src('result.js'), /s\.rounds === 1 \? 'result\.metaOne' : 'result\.meta'/);
  assert.match(src('history.js'), /s\.rounds === 1 \? 'history\.roundsOne' : 'history\.rounds'/);
  assert.match(src('deck.js'), /g\.rounds === 1 \? 'stats\.roundsOne' : 'stats\.rounds'/);
  assert.match(src('profile.js'), /fastestWin\.rounds === 1 \? 'stats\.inRoundsOne' : 'stats\.inRounds'/);
});

test('K3 Abzeichen: partial "rest" zeigt „beim nächsten Öffnen ergänzt“, true den Fehlertext, false nichts', async () => {
  const { setLang } = await L(); setLang('de');
  const { badgeGrid } = await import('../../src/views/badges-ui.js');
  const s = (h) => String(h);
  const rest = s(badgeGrid({ states: [], open: true, partial: 'rest' }));
  assert.ok(rest.includes('Ältere Partien werden beim nächsten Öffnen ergänzt'));
  assert.ok(!rest.includes('nicht geladen werden konnte'));
  const fail = s(badgeGrid({ states: [], open: true, partial: true }));
  assert.ok(fail.includes('nicht geladen werden konnte'));
  const none = s(badgeGrid({ states: [], open: true, partial: false }));
  assert.ok(!none.includes('nicht geladen werden konnte') && !none.includes('beim nächsten Öffnen'));
});

test('K4 Linkfarbe Arktis/Lachs: Akzent mit Schrift gemischt (Kontrast ≥ 4,5 auf --bg und --sf)', () => {
  const css = readFileSync(new URL('../../src/styles/components.css', import.meta.url), 'utf8');
  assert.match(css, /:root\[data-theme="arktis"\] \.link:not\(\.muted\)/);
  assert.match(css, /:root\[data-theme="lachs"\] \.link:not\(\.muted\)/);
  assert.match(css, /color: color-mix\(in srgb, var\(--acc2\) 60%, var\(--ink\)\)/);
  const tok = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
  const look = (n) => { const b = tok.slice(tok.indexOf(`:root[data-theme="${n}"]`)); const g = (k) => b.match(new RegExp(`--${k}: (#[0-9A-Fa-f]{6})`))[1]; return { acc2: g('acc2'), ink: g('ink'), bg: g('bg'), sf: g('sf') }; };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (c) => { const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const n of ['arktis', 'lachs']) {
    const t = look(n);
    const mix = rgb(t.acc2).map((v, i) => v * 0.6 + rgb(t.ink)[i] * 0.4);
    assert.ok(ratio(rgb(t.acc2), rgb(t.bg)) < 4.5, `${n}: vorher zu blass (Gegenprobe)`);
    assert.ok(ratio(mix, rgb(t.bg)) >= 4.5, `${n} auf --bg: ${ratio(mix, rgb(t.bg)).toFixed(2)}`);
    assert.ok(ratio(mix, rgb(t.sf)) >= 4.5, `${n} auf --sf: ${ratio(mix, rgb(t.sf)).toFixed(2)}`);
  }
});
