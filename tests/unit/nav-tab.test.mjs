// P13: welcher Reiter der Leiste ist hell? Fremdes Profil darf nicht „Profil“ markieren.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/lib/nav-tab.js');
const r = (path, nav, params = {}) => ({ path, params, opts: { nav } });
const MINE = ['m-ich-a', 'm-ich-b'];

test('N1 normale Reiter-Routen: Routen-Wert unverändert', async () => {
  const { activeTab } = await load();
  assert.equal(activeTab(r('/rangliste', 'board'), MINE, 'start'), 'board');
  assert.equal(activeTab(r('/start', 'start'), MINE, null), 'start');
  assert.equal(activeTab(r('/profil', 'me'), MINE, 'board'), 'me');
  assert.equal(activeTab(r('/einstellungen', 'me'), MINE, 'board'), 'me');
});

test('N2 eigenes Profil per Id (jede eigene Mitgliedschaft) ⇒ „Profil“, egal woher', async () => {
  const { activeTab } = await load();
  assert.equal(activeTab(r('/profil/m-ich-a', 'me', { memberId: 'm-ich-a' }), MINE, 'board'), 'me');
  assert.equal(activeTab(r('/profil/m-ich-b', 'me', { memberId: 'm-ich-b' }), MINE, 'start'), 'me');
});

test('N3 fremdes Profil ⇒ Herkunfts-Reiter bleibt hell', async () => {
  const { activeTab } = await load();
  const p = r('/profil/m-du', 'me', { memberId: 'm-du' });
  assert.equal(activeTab(p, MINE, 'board'), 'board');
  assert.equal(activeTab(p, MINE, 'start'), 'start');
  assert.equal(activeTab(p, MINE, 'history'), 'history');
});

test('N4 fremdes Profil von „Profil“ aus oder per Direktlink ⇒ kein Reiter hell', async () => {
  const { activeTab } = await load();
  const p = r('/profil/m-du', 'me', { memberId: 'm-du' });
  assert.equal(activeTab(p, MINE, 'me'), null);
  assert.equal(activeTab(p, MINE, null), null);
  assert.equal(activeTab(p, [], 'board'), 'board', 'ohne eigene Mitgliedschaften gilt jedes Profil als fremd');
});

test('N5 Deck folgt dem Herkunfts-Reiter; Direktlink ⇒ Routen-Wert', async () => {
  const { activeTab } = await load();
  const d = r('/deck/d1', 'me', { id: 'd1' });
  assert.equal(activeTab(d, MINE, 'board'), 'board');
  assert.equal(activeTab(d, MINE, 'me'), 'me');
  assert.equal(activeTab(d, MINE, null), 'me');
});

test('N6 Route ohne Leiste bleibt ohne Reiter', async () => {
  const { activeTab } = await load();
  assert.equal(activeTab(r('/spiel/x', undefined, { id: 'x' }), MINE, 'board'), null);
});
