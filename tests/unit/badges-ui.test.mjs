// Spec P4 Abzeichen: Bausteine src/views/badges-ui.js — Kriterium 14 (Fälle U1–U10), am HTML-Text.
// Sollwerte von Hand aus spec-p4-abzeichen.md („Anzeige“, „Texte“). Modul je Fall per import().
import { test } from 'node:test';
import assert from 'node:assert/strict';

const UI = () => import('../../src/views/badges-ui.js');
const B = () => import('../../src/lib/badges.js');
const L = () => import('../../src/i18n/index.js');
const NOW = '2026-12-01T00:00:00Z';
globalThis.document ??= /** @type {any} */ ({ documentElement: {} }); // setLang setzt html[lang] (Muster zugang-ui.test.mjs)

async function de() { const { setLang } = await L(); setLang('de'); }
const def = async (id) => (await B()).BADGES.find((b) => b.id === id);
/** Zustand wie memberBadges ihn liefert */
const st = (id, x = {}) => ({ id, earned: false, tier: 0, gameId: null, at: null, tierGames: [], value: null, next: null, hidden: false, ...x });
const s = (h) => String(h);
const count = (hay, needle) => hay.split(needle).length - 1;

test('U1 verdient: Marker verdient, Pfad der Glyphe aus I, kein #/rgb( im Markup', async () => {
  await de();
  const { shield } = await UI(); const { I } = await import('../../src/lib/icons.js');
  const d = await def('erster-sieg');
  const h = s(shield(st('erster-sieg', { earned: true, gameId: 'g1' }), d, { size: 56 }));
  assert.match(h, /class="shd is-earned"/);
  assert.ok(h.includes(I.trophy), 'Glyphe trophy aus I');
  assert.ok(!h.includes('#') && !/rgb\(|hsl\(/.test(h), 'keine Farbwerte');
  assert.match(h, /aria-hidden="true"/);
  assert.match(h, /width="56"/);
});

test('U2 offen: Marker offen; Stufen-Abzeichen mit Fortschrittsbalken (aria-hidden), Einzel-Abzeichen ohne', async () => {
  await de();
  const { shield, badgeGrid } = await UI();
  const h = s(shield(st('comeback'), await def('comeback')));
  assert.match(h, /class="shd is-open"/);
  const { memberBadges } = await B(); const { fixtureGroupData } = await import('../fixtures/gruppe.mjs');
  const grid = s(badgeGrid({ states: memberBadges(fixtureGroupData(), {}, 'm-F', { now: NOW }), open: true }));
  const cellOf = (id) => grid.slice(grid.indexOf(`data-badge="${id}"`), grid.indexOf('</button>', grid.indexOf(`data-badge="${id}"`)));
  assert.match(cellOf('stammgast'), /<span class="bdg-prog" aria-hidden="true"><i style="width:60%"><\/i><\/span>/);
  assert.ok(!cellOf('comeback').includes('bdg-prog'));
  assert.ok(!cellOf('erster-sieg').includes('bdg-prog'));
});

test('U3 geheim offen: „?“, Name „Geheim“, Regeltext fehlt; geheim verdient: echter Name', async () => {
  await de();
  const { shield, badgeGrid } = await UI(); const { t } = await L();
  const d = await def('nachteule');
  const h = s(shield(st('nachteule', { hidden: true }), d));
  assert.match(h, />\?<\/text>/); assert.ok(!h.includes('shd-glyph'));
  const { BADGES } = await B();
  const grid = s(badgeGrid({ states: BADGES.map((b) => st(b.id, { hidden: b.secret })), open: true }));
  assert.equal(count(grid, 'aria-label="Geheim: offen"'), 2);
  assert.ok(!grid.includes('Nachteule') && !grid.includes('Glückspilz'));
  assert.ok(!grid.includes(t('badges.list.nachteule.rule')) && !grid.includes(t('badges.list.gluckspilz.rule')));
  const won = s(badgeGrid({ states: BADGES.map((b) => st(b.id, b.id === 'nachteule' ? { earned: true, gameId: 'g1' } : { hidden: b.secret })), open: true }));
  assert.ok(won.includes('aria-label="Nachteule: verdient"'));
  assert.ok(!s(shield(st('nachteule', { earned: true }), d)).includes('>?<'));
});

test('U4 selten: Marker selten (gestrichelter Innenrand per CSS); Glanz nur bei verdient', async () => {
  await de();
  const { shield } = await UI();
  const d = await def('salzbergwerk');
  const open = s(shield(st('salzbergwerk'), d)); const won = s(shield(st('salzbergwerk', { earned: true }), d));
  assert.match(open, /class="shd is-open is-rare"/); assert.match(won, /class="shd is-earned is-rare"/);
  assert.ok(!open.includes('shd-glint')); assert.ok(won.includes('class="shd-glint"'));
  assert.ok(!s(shield(st('erster-sieg', { earned: true }), await def('erster-sieg'))).includes('shd-glint'), 'nicht selten ⇒ kein Glanz');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../src/styles/badges.css', import.meta.url), 'utf8');
  assert.match(css, /\.shd\.is-rare \.shd-in \{[^}]*stroke-dasharray/);
});

test('U5 Stufen: drei Balken, n gefüllt', async () => {
  await de();
  const { shield } = await UI();
  const d = await def('siegertyp');
  for (const n of [0, 1, 2, 3]) {
    const h = s(shield(st('siegertyp', { earned: n > 0, tier: n }), d));
    assert.equal(count(h, 'class="shd-bar'), 3, `Stufe ${n}`);
    assert.equal(count(h, 'class="shd-bar on"'), n, `Stufe ${n} gefüllt`);
  }
  assert.equal(count(s(shield(st('comeback'), await def('comeback'))), 'shd-bar'), 0);
});

test('U6 Raster: 21 Knöpfe in Katalog-Reihenfolge, 4 h4, aria-label exakt', async () => {
  await de();
  const { badgeGrid } = await UI(); const { BADGES, memberBadges } = await B(); const { fixtureGroupData } = await import('../fixtures/gruppe.mjs');
  const grid = s(badgeGrid({ states: memberBadges(fixtureGroupData(), {}, 'm-F', { now: NOW }), open: true }));
  assert.deepEqual([...grid.matchAll(/data-badge="([^"]+)"/g)].map((m) => m[1]), BADGES.map((b) => b.id));
  assert.equal(count(grid, '<button type="button" class="bdg '), 21);
  assert.equal(count(grid, '<h4 '), 4);
  assert.equal(count(grid, '<h3 '), 1);
  for (const label of ['Erste Runde: verdient', 'Stammgast: offen, 6 von 10 Partien', 'Geheim: offen', 'Comeback: offen', 'Siegertyp: offen, 2 von 5 Siege']) {
    assert.ok(grid.includes(`aria-label="${label}"`), label);
  }
  assert.match(grid, /data-act="toggle-badges" aria-expanded="true" aria-controls="prof-badges"/);
  assert.match(grid, />4 von 21 verdient</);
  assert.match(grid, /aria-live="polite"/);
  const shut = s(badgeGrid({ states: memberBadges(fixtureGroupData(), {}, 'm-F', { now: NOW }), open: false }));
  assert.match(shut, /aria-expanded="false"/); assert.match(shut, /id="prof-badges" class="bdg-body" hidden/);
  const tiered = s(badgeGrid({ states: [st('stammgast', { earned: true, tier: 1, value: 12, next: 50, tierGames: ['g10', null, null] })], open: true }));
  assert.ok(tiered.includes('aria-label="Stammgast: Stufe 1 von 3 verdient, 12 von 50 Partien"'));
  const loading = s(badgeGrid({ states: [], open: true, loading: { n: 10, of: 25 }, partial: true }));
  assert.ok(loading.includes('Abzeichen aus dem Spielverlauf werden berechnet … (10 von 25 Partien)'));
  assert.ok(loading.includes('Einige Abzeichen fehlen noch'));
  assert.ok(loading.includes('Noch keine Abzeichen'), 'ohne Partien');
});

const items = (n) => [
  { memberId: 'm-M', badgeId: 'comeback', tier: null }, { memberId: 'm-M', badgeId: 'koenigsmoerder', tier: null },
  { memberId: 'm-F', badgeId: 'stammgast', tier: 2 }, { memberId: 'm-L', badgeId: 'rache', tier: null },
  { memberId: 'm-D', badgeId: 'erstes-blut', tier: null }, { memberId: 'm-D', badgeId: 'erste-runde', tier: null },
  { memberId: 'm-T', badgeId: 'erste-runde', tier: null }, { memberId: 'm-F', badgeId: 'nachteule', tier: null },
].slice(0, n).map((x, i) => ({ ...x, gameId: `g${i + 1}` }));
const who = { 'm-F': 'Franco', 'm-M': 'Marie', 'm-L': 'Luka', 'm-D': 'Deniz', 'm-T': 'Tim' };

test('U7 Neu-Block: 1 ⇒ „Neues Abzeichen!“ ohne Knopf; 5 ⇒ „Neue Abzeichen!“, 3 sichtbar, „und 2 weitere“; 0 ⇒ leer', async () => {
  await de();
  const { newBadges } = await UI();
  const one = s(newBadges({ items: items(1), who }));
  assert.match(one, />Neues Abzeichen!</); assert.ok(!one.includes('<button')); assert.ok(!one.includes('<a '), 'keine Links');
  const five = s(newBadges({ items: items(5), who }));
  assert.match(five, />Neue Abzeichen!</);
  assert.equal(count(five, '<li class="bdg-item" >'), 3);
  assert.equal(count(five, '<li class="bdg-item" hidden>'), 2);
  assert.match(five, /<button type="button" class="bdg-more" data-act="badges-more" aria-expanded="false" aria-controls="bdg-new-list"[^>]*>und 2 weitere<\/button>/);
  assert.ok(five.includes('Stammgast · Stufe II'), 'Stufe als „· Stufe II“');
  assert.ok(five.includes('<small class="muted">Marie</small>'));
  assert.ok(!five.includes('<a '));
  assert.equal(s(newBadges({ items: [], who })), '');
});

test('U8 Abend-Block: 8 ⇒ 6 sichtbar + „und 2 weitere“, Links #/profil/<id>', async () => {
  await de();
  const { eveningBadges } = await UI();
  const h = s(eveningBadges({ items: items(8), who }));
  assert.match(h, />Abzeichen des Abends</);
  assert.equal(count(h, '<li class="bdg-item" >'), 6); assert.equal(count(h, '<li class="bdg-item" hidden>'), 2);
  assert.match(h, />und 2 weitere</);
  assert.equal(count(h, '<a class="bdg-row" href="#/profil/'), 8);
  assert.ok(h.includes('href="#/profil/m-M"'));
  assert.ok(h.includes('Nachteule'), 'verdient ⇒ echter Name');
  assert.equal(s(eveningBadges({ items: [], who })), '');
});

test('U9 Sheet: verdient mit „Verdient am“ und #/partie/<id>; Stufen mit drei Zeilen; geheim offen ohne Regel', async () => {
  await de();
  const { badgeSheet } = await UI(); const { t } = await L();
  const k = s(badgeSheet({ def: await def('koenigsmoerder'), state: st('koenigsmoerder', { earned: true, gameId: 'g2', at: '2026-10-31T21:10:00+01:00' }), lang: 'de' }));
  assert.ok(k.includes('Verdient am')); assert.ok(k.includes('href="#/partie/g2"')); assert.ok(k.includes('Zur Partie'));
  assert.ok(k.includes(t('badges.list.koenigsmoerder.rule')));
  assert.match(k, /width="96"/);
  const tier = s(badgeSheet({ def: await def('stammgast'), state: st('stammgast', { earned: true, tier: 1, value: 12, next: 50, gameId: 'g10', at: '2026-10-10T18:00:00Z' }), lang: 'de' }));
  assert.equal(count(tier, '<li class="bdg-tier'), 3); assert.equal(count(tier, '<li class="bdg-tier is-on">'), 1);
  assert.ok(tier.includes('Stufe I · 10 Partien')); assert.ok(tier.includes('Stufe III · 100 Partien'));
  const sec = s(badgeSheet({ def: await def('gluckspilz'), state: st('gluckspilz', { hidden: true }), lang: 'de' }));
  assert.ok(!sec.includes(t('badges.list.gluckspilz.rule'))); assert.ok(sec.includes(t('badges.secretRule')));
  assert.ok(sec.includes('>Geheim<')); assert.ok(!sec.includes('Verdient am'));
  const open = s(badgeSheet({ def: await def('comeback'), state: st('comeback'), lang: 'de' }));
  assert.ok(!open.includes('Verdient am') && !open.includes('#/partie/'));
});

test('U10 Englisch: „New badges!“, „Kingslayer“', async () => {
  const { setLang } = await L(); setLang('en');
  try {
    const { newBadges, badgeGrid } = await UI();
    const h = s(newBadges({ items: items(2), who }));
    assert.match(h, />New badges!</); assert.ok(h.includes('Kingslayer'));
    const g = s(badgeGrid({ states: [st('koenigsmoerder', { earned: true, gameId: 'g2' })], open: true }));
    assert.ok(g.includes('aria-label="Kingslayer: earned"')); assert.ok(g.includes('>Badges <'));
  } finally { setLang('de'); }
});
