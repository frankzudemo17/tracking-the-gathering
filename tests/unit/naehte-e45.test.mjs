// Spec P13: Nähte Etappe 4/5 — Routen (Kriterium 1), Daten-Vertrag (Kriterium 2), Icons (Kriterium 6).
// Module werden je Fall per import() geladen bzw. Dateien gelesen ⇒ am Basis-Stand rot (Gegenprobe).
// Geprüft wird nur, was auch nach P15 (echte Rechnung) und P20 (alte Routenzeilen weg) gilt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stats = () => import('../../src/lib/stats.js');
const hist = () => import('../../src/lib/history-data.js');

/** Routen aus src/main.js in Reihenfolge: { pattern, view, opts, rx } (Regex wie src/router.js:7). */
function routes() {
  const text = read('src/main.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...text.matchAll(/route\(\s*'([^']+)'\s*,\s*v\(\s*'([^']+)'\s*\)\s*(?:,\s*(\{[^}]*\}))?\s*\)/g)].map((m) => ({
    pattern: m[1], view: m[2], opts: m[3] ?? null,
    rx: new RegExp('^' + m[1].replace(/:(\w+)/g, () => '([^/]+)') + '/?$'),
  }));
}
const firstHit = (list, p) => list.find((r) => r.rx.test(p));

test('K1 Router-Regel: Muster-Regex in src/router.js wie hier nachgebaut', () => {
  const src = read('src/router.js');
  assert.ok(src.includes(`new RegExp('^' + pattern.replace(/:(\\w+)/g`), 'router.js baut die Regex anders — Test nachziehen');
  assert.ok(src.includes(`'([^/]+)'`) && src.includes(`'/?$'`));
  assert.ok(/for \(const r of routes\)[\s\S]*?if \(m\)[\s\S]*?return/.test(src), 'Router nimmt nicht den ersten Treffer');
});

test('K1 Naht-Block: fünf Routen mit Muster, View und Optionen wie in der Spec', () => {
  const list = routes();
  const want = [
    ['/historie', 'history', "{ nav: 'history', group: true, arg: 'history' }"],
    ['/rangliste', 'board', "{ nav: 'board', group: true, arg: 'board' }"],
    ['/partie/:id', 'game-detail', "{ nav: 'history', group: true, arg: 'history' }"],
    ['/abend/:id', 'recap', "{ nav: 'history', group: true, arg: 'history' }"],
    ['/spiel/:id/ende', 'result', "{ group: true, arg: 'history' }"],
  ];
  for (const [pattern, view, opts] of want) {
    const r = list.find((x) => x.pattern === pattern && x.view === view);
    assert.ok(r, `route('${pattern}', v('${view}')) fehlt`);
    assert.equal(r.opts, opts, `Optionen von ${pattern}`);
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'views', `${view}.js`)), `src/views/${view}.js fehlt`);
  }
});

test('K1 erster Treffer: Historie/Rangliste/Partie/Abend/Ende landen im neuen View, /spiel/x bleibt life', () => {
  const list = routes();
  const cases = {
    '/historie': 'history', '/rangliste': 'board', '/partie/x': 'game-detail', '/abend/x': 'recap',
    '/spiel/x/ende': 'result', '/spiel/x': 'life', '/start': 'start', '/profil': 'profile', '/deck/x': 'deck',
  };
  for (const [p, view] of Object.entries(cases)) assert.equal(firstHit(list, p)?.view, view, `erster Treffer für ${p}`);
  const spiel = list.find((r) => r.pattern === '/spiel/:id');
  assert.ok(spiel, '/spiel/:id fehlt');
  assert.equal(spiel.rx.test('/spiel/x/ende'), false, '/spiel/:id darf /spiel/x/ende nicht fangen');
});

// ---------- Kriterium 2: Vertrag Anhang A ----------
const GROUP_KEYS = ['groupId', 'members', 'decks', 'sessions', 'games', 'players', 'ratings', 'deckSalt', 'potg', 'turns'];
const STATS_FNS = ['placePoints', 'inRange', 'playerTable', 'deckTable', 'deckSaltTable', 'gameSummary', 'evenings', 'recap', 'memberProfile', 'deckProfile'];
const EMPTY_MEMBER = {
  games: 0, wins: 0, points: 0, winRate: null, avgPlace: null, avgSalt: null, avgFun: null, avgDeckRating: null,
  saltTrend: [], pointsSeries: [], placeSeries: [], tempo: { avgTurnSec: null, rank: null, of: 0, rows: [] },
  nemesis: null, favoriteDeck: null, bestDeck: null, longestStreak: 0, fastestWin: null,
};
const EMPTY_DECK = { games: 0, wins: 0, winRate: null, avgPlace: null, points: 0, avgOwnRating: null, avgFun: null, salt: null, recentGameIds: [] };

test('K2 history-data.js: createHistoryData + emptyGroupData (frisch je Aufruf)', async () => {
  const { createHistoryData, emptyGroupData } = await hist();
  assert.equal(typeof createHistoryData, 'function');
  assert.equal(typeof emptyGroupData, 'function');
  const e = emptyGroupData('g');
  assert.deepEqual(Object.keys(e).sort(), [...GROUP_KEYS].sort());
  assert.equal(e.groupId, 'g');
  for (const k of GROUP_KEYS.slice(1)) assert.deepEqual(e[k], [], `${k} leer`);
  const f = emptyGroupData('g');
  assert.notEqual(e, f); assert.notEqual(e.games, f.games);
  const api = createHistoryData(null);
  for (const k of ['loadGroup', 'loadGame', 'invalidate']) assert.equal(typeof api[k], 'function', `${k} fehlt`);
});

test('K2 stats.js: jeder Name aus Anhang A ist eine Funktion', async () => {
  const s = await stats();
  for (const k of STATS_FNS) assert.equal(typeof s[k], 'function', `${k} fehlt`);
});

test('K2 stats.js: leere Formen bei leerer Gruppe', async () => {
  const s = await stats();
  const { emptyGroupData } = await hist();
  const e = () => emptyGroupData('g');
  assert.equal(typeof s.placePoints(4, 2), 'number');
  const r = s.inRange(e(), 'all', new Date('2026-11-10T12:00:00Z'));
  assert.deepEqual(Object.keys(r).sort(), [...GROUP_KEYS].sort());
  assert.equal(r.games.length, 0);
  assert.deepEqual(s.playerTable(e()), []);
  assert.deepEqual(s.deckTable(e()), []);
  assert.deepEqual(s.deckSaltTable(e()), []);
  assert.deepEqual(s.deckSaltTable(e(), { min: 1 }), []);
  assert.equal(s.gameSummary(e(), 'x'), null);
  assert.deepEqual(s.evenings(e()), []);
  assert.deepEqual(s.evenings(e(), { filter: 'alle', meMemberId: 'm-F' }), []);
  assert.equal(s.recap(e(), 'x'), null);
  assert.deepEqual(s.memberProfile(e(), 'm-x'), EMPTY_MEMBER);
  assert.deepEqual(s.deckProfile(e(), 'd-x'), EMPTY_DECK);
  // frische Objekte je Aufruf (keine geteilten Listen)
  const a = s.memberProfile(e(), 'm-x'); const b = s.memberProfile(e(), 'm-x');
  assert.notEqual(a.saltTrend, b.saltTrend); assert.notEqual(a.tempo, b.tempo);
});

// ---------- Kriterium 6: Icons ----------
const NEW_ICONS = ['salt', 'starFill', 'smiley', 'medal', 'fire', 'quotes', 'shareNetwork', 'downloadSimple', 'notePencil', 'mapPin', 'calendarBlank', 'funnel'];

test('K6 icons.js: die 12 neuen Schlüssel, je genau einmal, salt im Kopf als eigene Zeichnung', async () => {
  const { I } = await import('../../src/lib/icons.js');
  const keys = Object.keys(I);
  for (const k of NEW_ICONS) {
    assert.ok(keys.includes(k), `Icon ${k} fehlt`);
    assert.equal(typeof I[k], 'string');
    assert.ok(/^<(path|circle|rect|line|polyline|polygon|g)\b/.test(I[k]), `${k}: innere SVG-Elemente erwartet`);
  }
  const src = read('src/lib/icons.js');
  for (const k of [...NEW_ICONS, 'star', 'trophyFill']) assert.equal(src.match(new RegExp(`^  ${k}:`, 'gm'))?.length, 1, `${k} doppelt oder fehlt`);
  const head = src.split('export const I')[0];
  assert.ok(/salt/.test(head) && /eigene Zeichnung/.test(head), 'Dateikopf nennt salt nicht als eigene Zeichnung');
});
