// Spec P16: reine Hilfen der Historie (src/views/history-ui.js) gegen die Fixture (Anhang B, Sollwerte von Hand).
// Jeder Fall lädt das Modul selbst per import() ⇒ ohne die Datei rot (Gegenprobe am Basis-Stand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGroupData, ME_MEMBER } from '../fixtures/gruppe.mjs';

const ui = () => import('../../src/views/history-ui.js');
const ids = (list) => list.map((e) => [e.sessionId, e.gameIds.join(',')].join(':'));

test('historyEvenings: 3 Abende 06.11. · 31.10. · 18.10., Spiele neueste zuerst, Tageskönig ganzer Abend', async () => {
  const { historyEvenings } = await ui();
  const list = historyEvenings(fixtureGroupData(), { filter: 'alle', meMemberId: ME_MEMBER });
  assert.deepEqual(ids(list), ['s0:g1', 's1:g2,g3,g4', 's2:g5,g6']);
  assert.deepEqual(list.map((e) => e.playedOn), ['2026-11-06', '2026-10-31', '2026-10-18']);
  assert.deepEqual(list.map((e) => e.dayWinnerId), ['m-M', 'm-F', 'm-M']);
});

test('historyEvenings: Filter Siege ⇒ g2, g6 · Salzig ⇒ g1, g4 · Mit Foto ⇒ g1, g5', async () => {
  const { historyEvenings } = await ui();
  const games = (filter) => historyEvenings(fixtureGroupData(), { filter, meMemberId: ME_MEMBER }).flatMap((e) => e.gameIds);
  assert.deepEqual(games('siege'), ['g2', 'g6']);
  assert.deepEqual(games('salt'), ['g1', 'g4']);
  assert.deepEqual(games('foto'), ['g1', 'g5']);
  // Tageskönig bleibt der des ganzen Abends, auch gefiltert (Dirigat D3)
  assert.deepEqual(historyEvenings(fixtureGroupData(), { filter: 'siege', meMemberId: ME_MEMBER }).map((e) => e.dayWinnerId), ['m-F', 'm-M']);
});

test('historyEvenings: Spiele ohne Abend ⇒ eigene Gruppe am Ende, ohne Tageskönig und Ort', async () => {
  const { historyEvenings, NO_SESSION } = await ui();
  const d = fixtureGroupData();
  // g1 (neuestes Spiel) ohne Abend: stünde nach Datum vorn, muss aber ans Ende
  d.games = d.games.map((g) => (g.id === 'g1' ? { ...g, sessionId: null } : g));
  const list = historyEvenings(d, { filter: 'alle', meMemberId: ME_MEMBER });
  assert.deepEqual(ids(list), ['s1:g2,g3,g4', 's2:g5,g6', `${NO_SESSION}:g1`]);
  assert.equal(list[2].dayWinnerId, null);
  assert.equal(list[2].location, null);
  // Eingabe unverändert
  assert.equal(d.games.find((g) => g.id === 'g1').sessionId, null);
  // Filter wirkt auch auf die Gruppe ohne Abend (g1 hat ein Foto, Siegerin Marie)
  assert.deepEqual(ids(historyEvenings(d, { filter: 'foto', meMemberId: ME_MEMBER })), ['s2:g5', `${NO_SESSION}:g1`]);
  assert.deepEqual(ids(historyEvenings(d, { filter: 'siege', meMemberId: ME_MEMBER })), ['s1:g2', 's2:g6']);
});

test('historyEvenings: leere Gruppe ⇒ []', async () => {
  const { historyEvenings } = await ui();
  assert.deepEqual(historyEvenings({ groupId: 'g', members: [], decks: [], sessions: [], games: [], players: [], ratings: [], deckSalt: [], potg: [], turns: [] }), []);
});

test('Filter merken: gültige Werte, Unsinn ⇒ alle, gesperrter Speicher wirft nie', async () => {
  const { readFilter, writeFilter, validFilter, FILTER_KEY, FILTERS } = await ui();
  assert.deepEqual([...FILTERS], ['alle', 'siege', 'salt', 'foto']);
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(readFilter(store), 'alle');
  writeFilter(store, 'foto');
  assert.equal(mem.get(FILTER_KEY), 'foto');
  assert.equal(readFilter(store), 'foto');
  writeFilter(store, 'quatsch');
  assert.equal(readFilter(store), 'alle');
  assert.equal(validFilter(null), 'alle');
  const broken = { getItem() { throw new Error('privat'); }, setItem() { throw new Error('privat'); } };
  assert.equal(readFilter(broken), 'alle');
  assert.doesNotThrow(() => writeFilter(broken, 'siege'));
  assert.equal(readFilter(null), 'alle');
});

test('deckArt: Bild ungetönt als --art, ohne Bild Farbfläche aus Mana-Token, nie leer', async () => {
  const { deckArt } = await ui();
  const d = fixtureGroupData().decks;
  const atraxa = d.find((x) => x.id === 'd-atraxa');
  assert.equal(deckArt(atraxa), `--art:url('${atraxa.imageUrl}');--art-fb:linear-gradient(135deg, var(--mana-W), var(--mana-U), var(--mana-B), var(--mana-G))`);
  assert.equal(deckArt(d.find((x) => x.id === 'd-prosper')), '--art:linear-gradient(135deg, var(--mana-B), var(--mana-R))');
  assert.equal(deckArt(d.find((x) => x.id === 'd-krenko')), '--art:linear-gradient(135deg, var(--mana-R), color-mix(in srgb, var(--mana-R) 40%, var(--sf2)))');
  assert.equal(deckArt(null), '--art:linear-gradient(135deg, var(--p-c), color-mix(in srgb, var(--p-c) 40%, var(--sf2)))');
  assert.match(deckArt({ imageUrl: "https://x/it's.jpg" }), /^--art:url\('https:\/\/x\/it%27s\.jpg'\);--art-fb:linear-gradient/);
});

test('damageGrid: 5 Zellen aus g1, Nachschlagen Quelle→Ziel, leer ohne Ereignisse', async () => {
  const { damageGrid } = await ui();
  const { fixtureDamage } = await import('../fixtures/gruppe.mjs');
  const g = damageGrid(['m-M', 'm-F', 'm-D', 'm-L'], fixtureDamage('g1'));
  assert.equal(g.empty, false);
  assert.deepEqual(g.cell('m-D', 'm-L'), { source: 'm-D', target: 'm-L', damage: 30, commanderDamage: 9, poison: 0 });
  assert.equal(g.cell('m-M', 'm-F').commanderDamage, 21);
  assert.equal(g.cell('m-F', 'm-D').poison, 3);
  assert.equal(g.cell('m-L', 'm-D'), null);
  const all = ['m-M', 'm-F', 'm-D', 'm-L'].flatMap((s) => ['m-M', 'm-F', 'm-D', 'm-L'].map((t) => g.cell(s, t))).filter(Boolean);
  assert.equal(all.length, 5);
  assert.equal(damageGrid(['m-F'], []).empty, true);
  assert.equal(damageGrid(['m-F'], null).empty, true);
});

test('Format: Datum lang de/en (UTC-Datum), Datum+Uhrzeit, fehlende Werte ⇒ –', async () => {
  const { fmtDayLong, fmtDateTime, num, colorDeck } = await ui();
  assert.equal(fmtDayLong('2026-11-06', 'de'), 'Freitag, 6. November 2026');
  assert.equal(fmtDayLong('2026-10-18', 'en'), 'Sunday, 18 October 2026');
  assert.equal(fmtDayLong(null), '–');
  assert.equal(fmtDayLong('kaputt'), '–');
  assert.equal(fmtDateTime(null), '–');
  assert.match(fmtDateTime('2026-11-06T19:30:00+01:00', 'de'), /^\d{1,2}\. November 2026, \d{2}:\d{2}$/);
  assert.equal(num(7), '7');
  assert.equal(num(null), '–');
  assert.equal(num(NaN), '–');
  assert.deepEqual(colorDeck({ colors: ['B', 'R'] }), { color_identity: ['B', 'R'] });
  assert.deepEqual(colorDeck(null), { color_identity: [] });
});
