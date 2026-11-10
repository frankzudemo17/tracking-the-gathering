// Spec P17: Rangliste — reine Hilfen (src/views/board-ui.js) und die Sollwerte der Abnahmekriterien 1–4
// (Fixture tests/fixtures/gruppe.mjs, Rechnung nur in stats.js; Podest/Liste über board-ui).
// Jeder Fall lädt board-ui.js selbst per import() ⇒ ohne die Datei rot (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGroupData } from '../fixtures/gruppe.mjs';
import { inRange, playerTable, deckTable, deckSaltTable } from '../../src/lib/stats.js';
import { fmtAvg } from '../../src/lib/format.js';

const ui = () => import('../../src/views/board-ui.js');
const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m };
};

test('Wahl merken: Standard Spieler · Gesamt, kaputte Werte fallen zurück, Rundreise', async () => {
  const { readPrefs, writePrefs, PREF_KEY } = await ui();
  assert.deepEqual(readPrefs(null), { mode: 'players', range: 'all' });
  assert.deepEqual(readPrefs(memStore({ [PREF_KEY]: '{kaputt' })), { mode: 'players', range: 'all' });
  assert.deepEqual(readPrefs(memStore({ [PREF_KEY]: '{"mode":"x","range":"30d"}' })), { mode: 'players', range: '30d' });
  const s = memStore();
  writePrefs(s, { mode: 'salt', range: 'year' });
  assert.deepEqual(readPrefs(s), { mode: 'salt', range: 'year' });
  const throwing = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('gesperrt'); } };
  assert.deepEqual(readPrefs(throwing), { mode: 'players', range: 'all' });
  assert.doesNotThrow(() => writePrefs(throwing, { mode: 'decks', range: 'all' }));
});

test('Testhaken __ttgNow wirkt nur auf localhost', async () => {
  const { pickNow } = await ui();
  const real = new Date('2030-01-01T00:00:00Z');
  const clock = () => real;
  const hook = '2026-11-20T12:00:00+01:00';
  assert.equal(pickNow('localhost', hook, clock).toISOString(), '2026-11-20T11:00:00.000Z');
  assert.equal(pickNow('frankzudemo17.github.io', hook, clock), real);
  assert.equal(pickNow('ttg.local', hook, clock), real);
  assert.equal(pickNow(undefined, hook, clock), real);
  assert.equal(pickNow('localhost', undefined, clock), real);
  assert.equal(pickNow('localhost', 'kein Datum', clock), real);
});

test('Podest: erste drei Einträge, Rest in die Liste; weniger als drei ⇒ nur vorhandene', async () => {
  const { splitPodium, stepOf } = await ui();
  const rows = [1, 1, 3, 4, 5].map((rank, i) => ({ id: i, rank }));
  const { podium, rest } = splitPodium(rows);
  assert.deepEqual(podium.map((r) => r.rank), [1, 1, 3]);
  assert.deepEqual(rest.map((r) => r.rank), [4, 5]);
  assert.deepEqual(splitPodium(rows.slice(0, 2)), { podium: rows.slice(0, 2), rest: [] });
  assert.deepEqual(splitPodium([]), { podium: [], rest: [] });
  assert.deepEqual([1, 2, 3, 7].map(stepOf), [1, 2, 3, 3]);
});

test('Salz-Icons: anteilig gefüllt, fehlender Wert ⇒ leer', async () => {
  const { saltFill } = await ui();
  assert.deepEqual(saltFill(4), [1, 1, 1, 1, 0]);
  assert.deepEqual(saltFill(0), [0, 0, 0, 0, 0]);
  assert.deepEqual(saltFill(null), [0, 0, 0, 0, 0]);
  const f = saltFill(2.5);
  assert.deepEqual(f, [1, 1, 0.5, 0, 0]);
});

test('Leerzustand je Lage', async () => {
  const { emptyKind } = await ui();
  assert.equal(emptyKind({ allGames: 0, rangeGames: 0, rows: 0 }), 'none');
  assert.equal(emptyKind({ allGames: 6, rangeGames: 0, rows: 0 }), 'range');
  assert.equal(emptyKind({ allGames: 6, rangeGames: 1, rows: 0 }), 'salt');
  assert.equal(emptyKind({ allGames: 6, rangeGames: 6, rows: 4 }), null);
});

test('Deck-Besitzer über ownerProfileId, sonst ownerMemberId', async () => {
  const { deckOwnerId } = await ui();
  const d = fixtureGroupData();
  const byDeck = Object.fromEntries(d.decks.map((x) => [x.id, deckOwnerId(x, d.members)]));
  assert.equal(byDeck['d-atraxa'], 'm-F');
  assert.equal(byDeck['d-edgar'], 'm-L');
  assert.equal(byDeck['d-kinnan'], 'm-M');
  assert.equal(byDeck['d-yuriko'], 'm-D');
  assert.equal(deckOwnerId({ ownerProfileId: null, ownerMemberId: 'm-T' }, d.members), 'm-T');
  assert.equal(deckOwnerId(null, d.members), null);
});

test('Commander-Bild: Stil nur mit Adresse, Hochkomma maskiert', async () => {
  const { artStyle } = await ui();
  assert.equal(artStyle(null), '');
  assert.equal(artStyle("https://x/y'z.jpg"), "--art:url('https://x/y%27z.jpg')");
});

// ---- Abnahmekriterien 1–4 (Handwerte aus spec-p17-rangliste.md) ----
const names = { 'm-F': 'Franco', 'm-L': 'Luka', 'm-M': 'Marie', 'm-D': 'Deniz', 'm-T': 'Tim' };

test('K1 Spieler/Gesamt: Podest Franco 1 · Marie 1 (15) · Luka 3 (10); Liste Deniz 4 (5) · Tim 5 (1)', async () => {
  const { splitPodium } = await ui();
  const { podium, rest } = splitPodium(playerTable(fixtureGroupData()));
  const view = (r) => [names[r.memberId], r.rank, r.points];
  assert.deepEqual(podium.map(view), [['Franco', 1, 15], ['Marie', 1, 15], ['Luka', 3, 10]]);
  assert.deepEqual(rest.map(view), [['Deniz', 4, 5], ['Tim', 5, 1]]);
});

test('K2 Spieler/30 Tage mit now = 2026-11-20T12:00+01:00: Franco 9 · Marie 8 · Luka 6 · Deniz 5, ohne Tim', async () => {
  const { pickNow } = await ui();
  const now = pickNow('localhost', '2026-11-20T12:00:00+01:00');
  const rows = playerTable(inRange(fixtureGroupData(), '30d', now));
  assert.deepEqual(rows.map((r) => [names[r.memberId], r.points]), [['Franco', 9], ['Marie', 8], ['Luka', 6], ['Deniz', 5]]);
});

test('K3 Decks/Gesamt: Edgar 10 · Atraxa 9 · Krenko 8 · Kinnan 7 · Prosper 7 · Yuriko 5 (Ränge 1–6)', async () => {
  const d = fixtureGroupData();
  const short = Object.fromEntries(d.decks.map((x) => [x.id, x.shortName]));
  const rows = deckTable(d);
  assert.deepEqual(rows.map((r) => [short[r.deckId], r.points]), [['Edgar', 10], ['Atraxa', 9], ['Krenko', 8], ['Kinnan', 7], ['Prosper', 7], ['Yuriko', 5]]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6]);
});

test('K4 Salz: Kinnan 4,0 (6, Deniz) · Yuriko 3,3 (4, Franco) · Atraxa 2,8 (4, Deniz) · Krenko 2,5 (4) · Prosper 2,5 (2) · Edgar 2,3 (6)', async () => {
  const d = fixtureGroupData();
  const short = Object.fromEntries(d.decks.map((x) => [x.id, x.shortName]));
  const rows = deckSaltTable(d, { min: 2 });
  assert.deepEqual(rows.map((r) => [short[r.deckId], fmtAvg(r.avgSalt), r.ratings]),
    [['Kinnan', '4,0', 6], ['Yuriko', '3,3', 4], ['Atraxa', '2,8', 4], ['Krenko', '2,5', 4], ['Prosper', '2,5', 2], ['Edgar', '2,3', 6]]);
  assert.equal(names[rows[0].mostSaltedMemberId], 'Deniz');
  assert.equal(names[rows[1].mostSaltedMemberId], 'Franco');
  assert.equal(names[rows[2].mostSaltedMemberId], 'Deniz');
});
