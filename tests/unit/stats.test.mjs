// Spec P15: Statistik-Modul src/lib/stats.js — Kriterien 1–12.
// Sollwerte von Hand aus spec-p15-stats.md (Abnahmekriterien), nie aus der Implementierung abgeleitet.
// Fixture: tests/fixtures/gruppe.mjs (spec-p13-naehte.md Anhang B). Module werden je Fall per import()
// geladen ⇒ jeder Fall schlägt am Basis-Stand (P13-Stubs) einzeln fehl (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGroupData } from '../fixtures/gruppe.mjs';

const S = () => import('../../src/lib/stats.js');
const H = () => import('../../src/lib/history-data.js');
const EPS = 1e-9;

/** Zahl mit Toleranz (Brüche wie 8/3); null/undefined exakt. */
function near(actual, expected, msg) {
  if (expected == null) return assert.equal(actual, expected, msg);
  assert.equal(typeof actual, 'number', `${msg}: keine Zahl (${actual})`);
  assert.ok(Math.abs(actual - expected) < EPS, `${msg}: ${actual} ≠ ${expected}`);
}
const nearList = (a, b, msg) => { assert.equal(a.length, b.length, `${msg}: Länge`); b.forEach((x, i) => near(a[i], x, `${msg}[${i}]`)); };
const byId = (rows, key, id) => rows.find((r) => r[key] === id);
const ids = (data) => data.games.map((g) => g.id).sort();

// ---------------------------------------------------------------- 1
test('K1 placePoints: Platz 1 = n, sonst max(0, n − Platz)', async () => {
  const { placePoints } = await S();
  const cases = [[4, 1, 4], [4, 2, 2], [4, 3, 1], [4, 4, 0], [5, 1, 5], [5, 2, 3], [5, 5, 0], [2, 2, 0], [6, 1, 6]];
  for (const [n, p, want] of cases) assert.equal(placePoints(n, p), want, `placePoints(${n}, ${p})`);
  assert.equal(placePoints(4, null), 0, 'ohne Platz ⇒ 0');
});

// ---------------------------------------------------------------- 2
test('K2 playerTable(all): Punkte, Spiele, Siege, Ø-Platz, Wettkampf-Rang, F vor M', async () => {
  const { playerTable } = await S();
  const t = playerTable(fixtureGroupData());
  assert.deepEqual(t.map((r) => r.memberId), ['m-F', 'm-M', 'm-L', 'm-D', 'm-T']);
  const want = {
    'm-F': [15, 6, 2, 2.0, 1], 'm-M': [15, 6, 2, 2.0, 1], 'm-L': [10, 6, 1, 16 / 6, 3],
    'm-D': [5, 6, 1, 3.5, 4], 'm-T': [1, 1, 0, 4.0, 5],
  };
  for (const [id, [points, games, wins, avgPlace, rank]] of Object.entries(want)) {
    const r = byId(t, 'memberId', id);
    assert.equal(r.points, points, `${id} Punkte`);
    assert.equal(r.games, games, `${id} Spiele`);
    assert.equal(r.wins, wins, `${id} Siege`);
    near(r.avgPlace, avgPlace, `${id} Ø-Platz`);
    near(r.winRate, wins / games, `${id} Siegquote`);
    assert.equal(r.rank, rank, `${id} Rang`);
  }
  assert.equal(t.reduce((s, r) => s + r.points, 0), 46, 'Summe Punkte');
});

// ---------------------------------------------------------------- 3
test('K3 deckTable(all): edgar R1 … yuriko R6 (kinnan vor prosper über Ø-Platz)', async () => {
  const { deckTable } = await S();
  const t = deckTable(fixtureGroupData());
  assert.deepEqual(t.map((r) => r.deckId), ['d-edgar', 'd-atraxa', 'd-krenko', 'd-kinnan', 'd-prosper', 'd-yuriko']);
  const want = {
    'd-edgar': [10, 6, 1, 16 / 6, 1], 'd-atraxa': [9, 4, 1, 2.25, 2], 'd-krenko': [8, 3, 1, 2.0, 3],
    'd-kinnan': [7, 3, 1, 2.0, 4], 'd-prosper': [7, 3, 1, 7 / 3, 5], 'd-yuriko': [5, 6, 1, 3.5, 6],
  };
  for (const [id, [points, games, wins, avgPlace, rank]] of Object.entries(want)) {
    const r = byId(t, 'deckId', id);
    assert.equal(r.points, points, `${id} Punkte`);
    assert.equal(r.games, games, `${id} Spiele`);
    assert.equal(r.wins, wins, `${id} Siege`);
    near(r.avgPlace, avgPlace, `${id} Ø-Platz`);
    near(r.winRate, wins / games, `${id} Siegquote`);
    assert.equal(r.rank, rank, `${id} Rang`);
  }
});

// ---------------------------------------------------------------- 4
test('K4 inRange: 30 Tage, Jahr, Grenzfall, all', async () => {
  const { inRange, playerTable } = await S();
  const now = new Date('2026-11-20T12:00:00+01:00');
  const d30 = inRange(fixtureGroupData(), '30d', now);
  assert.deepEqual(ids(d30), ['g1', 'g2', 'g3', 'g4']);
  const t = playerTable(d30);
  assert.deepEqual(t.map((r) => [r.memberId, r.points]), [['m-F', 9], ['m-M', 8], ['m-L', 6], ['m-D', 5]]);
  assert.equal(t.reduce((s, r) => s + r.points, 0), 28);
  assert.equal(byId(t, 'memberId', 'm-T'), undefined, 'T fehlt');
  // spielbezogene Listen mitgefiltert, Abende nur mit verbleibenden Spielen, members/decks unverändert
  assert.ok(d30.players.every((p) => p.gameId !== 'g5' && p.gameId !== 'g6'));
  for (const k of ['ratings', 'deckSalt', 'potg', 'turns']) assert.ok(d30[k].every((r) => !['g5', 'g6'].includes(r.gameId)), `${k} gefiltert`);
  assert.deepEqual(d30.sessions.map((s) => s.id).sort(), ['s0', 's1']);
  assert.equal(d30.members.length, 5);
  assert.equal(d30.decks.length, 6);

  assert.equal(inRange(fixtureGroupData(), 'year', now).games.length, 6, "'year' ⇒ alle 6");
  assert.deepEqual(ids(inRange(fixtureGroupData(), '30d', new Date('2026-11-17T18:00:00Z'))), ['g1', 'g2', 'g3', 'g4', 'g5'], 'Grenzfall g5 drin, g6 draußen');
  assert.equal(inRange(fixtureGroupData(), 'all', now).games.length, 6);
  // now als Zahl/String
  assert.deepEqual(ids(inRange(fixtureGroupData(), '30d', Date.parse('2026-11-20T12:00:00+01:00'))), ['g1', 'g2', 'g3', 'g4']);
});

test("K4 inRange 'year': Kalenderjahr in Europe/Berlin (Silvester-Grenze)", async () => {
  const { inRange } = await S();
  // 2026-12-31T23:30Z ist in Berlin bereits 2027-01-01 00:30 ⇒ Jahr 2027 ⇒ kein Fixture-Spiel (alle 2026)
  assert.equal(inRange(fixtureGroupData(), 'year', new Date('2026-12-31T23:30:00Z')).games.length, 0);
  // 2026-12-31T22:30Z ist in Berlin 23:30 am 31.12.2026 ⇒ alle 6
  assert.equal(inRange(fixtureGroupData(), 'year', new Date('2026-12-31T22:30:00Z')).games.length, 6);
  // Spiel 2027-01-01T00:15+01:00 (= 2026-12-31T23:15Z) zählt zu 2027
  const d = fixtureGroupData();
  d.games[0].startedAt = '2027-01-01T00:15:00+01:00';
  const r = inRange(d, 'year', new Date('2027-03-01T12:00:00+01:00'));
  assert.deepEqual(ids(r), [d.games[0].id]);
});

// ---------------------------------------------------------------- 5
test('K5 deckSaltTable(all): mit Ersatz-Regel, meist gesalzen, Rang', async () => {
  const { deckSaltTable } = await S();
  const t = deckSaltTable(fixtureGroupData());
  assert.deepEqual(t.map((r) => r.deckId), ['d-kinnan', 'd-yuriko', 'd-atraxa', 'd-krenko', 'd-prosper', 'd-edgar']);
  const want = {
    'd-kinnan': [4.0, 6, 'm-D', 1], 'd-yuriko': [3.25, 4, 'm-F', 2], 'd-atraxa': [2.75, 4, 'm-D', 3],
    'd-krenko': [2.5, 4, 'm-D', 4], 'd-prosper': [2.5, 2, 'm-M', 5], 'd-edgar': [7 / 3, 6, 'm-D', 6],
  };
  for (const [id, [avg, n, most, rank]] of Object.entries(want)) {
    const r = byId(t, 'deckId', id);
    near(r.avgSalt, avg, `${id} Ø-Salz`);
    assert.equal(r.ratings, n, `${id} Stimmen`);
    assert.equal(r.mostSaltedMemberId, most, `${id} meist gesalzen`);
    assert.equal(r.rank, rank, `${id} Rang`);
  }
  assert.ok(Math.abs(byId(t, 'deckId', 'd-kinnan').avgSalt - 4.25) > 0.1, 'Gegenprobe: ohne Ersatz wäre kinnan 4,25');
  assert.deepEqual(deckSaltTable(fixtureGroupData(), { min: 5 }).map((r) => r.deckId), ['d-kinnan', 'd-edgar']);
});

// ---------------------------------------------------------------- 6
test('K6 gameSummary(g1): Kopf, Platzierungen, POTG', async () => {
  const { gameSummary } = await S();
  const g = gameSummary(fixtureGroupData(), 'g1');
  assert.equal(g.gameId, 'g1');
  assert.equal(g.sessionId, 's0');
  assert.equal(g.minutes, 52);
  assert.equal(g.rounds, 7);
  assert.equal(g.wincon, 'kombo');
  assert.equal(g.note, "Marie hat's wieder getan.");
  near(g.avgSalt, 3.25, 'avgSalt');
  near(g.avgFun, 3.25, 'avgFun');
  assert.equal(g.winnerId, 'm-M');
  assert.deepEqual(g.placements.map((p) => p.memberId), ['m-M', 'm-F', 'm-D', 'm-L']);
  nearList(g.placements.map((p) => p.avgTurnSec), [130, 150, 330, 110], 'avgTurnSec');
  assert.deepEqual(g.placements.map((p) => p.points), [4, 2, 1, 0]);
  assert.deepEqual(g.placements.map((p) => p.outcome), ['win', 'out', 'out', 'out']);
  assert.deepEqual(g.potg.winners, ['m-M']);
  assert.deepEqual(g.potg.votes, { 'm-M': 2, 'm-F': 1, 'm-D': 1 });
  assert.equal(g.potg.texts.length, 1);
  assert.deepEqual(g.potg.texts[0], { voterId: 'm-F', votedFor: 'm-M', text: 'Kinnan plus Basalt Monolith, unendlich Mana in Runde 7.' });
});

test('K6 gameSummary: g2 POTG, g6 Ø-Salz, g3 ohne Zeiten, outcome conceded/alive', async () => {
  const { gameSummary } = await S();
  assert.deepEqual(gameSummary(fixtureGroupData(), 'g2').potg.winners, ['m-F']);
  near(gameSummary(fixtureGroupData(), 'g6').avgSalt, 2.0, 'g6 avgSalt');
  assert.equal(gameSummary(fixtureGroupData(), 'g3').placements[0].avgTurnSec, null);

  const d1 = fixtureGroupData();
  d1.players.find((p) => p.gameId === 'g1' && p.memberId === 'm-L').eliminatedBy = null;
  const s1 = gameSummary(d1, 'g1');
  assert.equal(s1.placements.find((p) => p.memberId === 'm-L').outcome, 'conceded');

  const d2 = fixtureGroupData();
  const f = d2.players.find((p) => p.gameId === 'g1' && p.memberId === 'm-F');
  f.eliminatedRound = null; f.eliminatedBy = null;
  assert.equal(gameSummary(d2, 'g1').placements.find((p) => p.memberId === 'm-F').outcome, 'alive');
});

// ---------------------------------------------------------------- 7
test('K7 evenings: Filter alle/siege/salt/foto, Tageskönig immer über den ganzen Abend', async () => {
  const { evenings } = await S();
  const shape = (list) => list.map((e) => [e.sessionId, e.gameIds]);
  const alle = evenings(fixtureGroupData(), { filter: 'alle', meMemberId: 'm-F' });
  assert.deepEqual(shape(alle), [['s0', ['g1']], ['s1', ['g2', 'g3', 'g4']], ['s2', ['g5', 'g6']]]);
  assert.deepEqual(shape(evenings(fixtureGroupData())), shape(alle), 'Standard = alle');
  const siege = evenings(fixtureGroupData(), { filter: 'siege', meMemberId: 'm-F' });
  assert.deepEqual(shape(siege), [['s1', ['g2']], ['s2', ['g6']]]);
  assert.deepEqual(shape(evenings(fixtureGroupData(), { filter: 'salt', meMemberId: 'm-F' })), [['s0', ['g1']], ['s1', ['g4']]]);
  assert.deepEqual(shape(evenings(fixtureGroupData(), { filter: 'foto', meMemberId: 'm-F' })), [['s0', ['g1']], ['s2', ['g5']]]);
  assert.deepEqual(alle.map((e) => e.dayWinnerId), ['m-M', 'm-F', 'm-M']);
  assert.deepEqual(siege.map((e) => [e.sessionId, e.dayWinnerId]), [['s1', 'm-F'], ['s2', 'm-M']], 'im Filter siege über alle Spiele');
  const s1 = alle[1];
  assert.equal(s1.playedOn, '2026-10-31');
  assert.equal(s1.location, 'Lukas WG');
});

// ---------------------------------------------------------------- 8
test('K8 recap: s1, s2, s0', async () => {
  const { recap } = await S();
  const want = {
    s1: { day: ['m-F', 1, 7, 'd-atraxa'], salt: ['m-D', 10 / 3, 3], turn: ['m-D', 618, 'g4'], potg: ['m-L', 4, 'Edgar-Swing mit vierzehn Vampiren.'], games: 3, minutes: 170 },
    s2: { day: ['m-M', 1, 7, 'd-krenko'], salt: ['m-D', 4.0, 1], turn: ['m-T', 402, 'g5'], potg: ['m-M', 3, 'Krenko-Kette über drei Runden.'], games: 2, minutes: 133 },
    s0: { day: ['m-M', 1, 4, 'd-kinnan'], salt: ['m-D', 5.0, 1], turn: ['m-D', 462, 'g1'], potg: ['m-M', 2, 'Kinnan plus Basalt Monolith, unendlich Mana in Runde 7.'], games: 1, minutes: 52 },
  };
  for (const [sid, w] of Object.entries(want)) {
    const r = recap(fixtureGroupData(), sid);
    assert.equal(r.sessionId, sid);
    assert.deepEqual(r.dayWinner, { memberId: w.day[0], wins: w.day[1], points: w.day[2], deckId: w.day[3] }, `${sid} dayWinner`);
    assert.equal(r.saltiest.memberId, w.salt[0], `${sid} saltiest`);
    near(r.saltiest.avgSalt, w.salt[1], `${sid} saltiest Ø`);
    assert.equal(r.saltiest.ratings, w.salt[2], `${sid} saltiest Bewertungen`);
    assert.deepEqual(r.longestTurn, { memberId: w.turn[0], seconds: w.turn[1], gameId: w.turn[2] }, `${sid} longestTurn`);
    assert.deepEqual(r.potg, { memberId: w.potg[0], votes: w.potg[1], text: w.potg[2] }, `${sid} potg`);
    assert.equal(r.games, w.games, `${sid} games`);
    assert.equal(r.minutes, w.minutes, `${sid} minutes`);
  }
  const s1 = recap(fixtureGroupData(), 's1');
  assert.equal(s1.playedOn, '2026-10-31');
  assert.equal(s1.location, 'Lukas WG');
});

// ---------------------------------------------------------------- 9
test('K9 memberProfile(F): alle Kennzahlen', async () => {
  const { memberProfile } = await S();
  const p = memberProfile(fixtureGroupData(), 'm-F');
  assert.equal(p.games, 6);
  assert.equal(p.wins, 2);
  assert.equal(p.points, 15);
  near(p.winRate, 1 / 3, 'winRate');
  near(p.avgPlace, 2.0, 'avgPlace');
  near(p.avgSalt, 16 / 6, 'avgSalt');
  near(p.avgFun, 23 / 6, 'avgFun');
  near(p.avgDeckRating, 22 / 6, 'avgDeckRating');
  assert.deepEqual(p.saltTrend, [1, 3, 5, 2, 1, 4]);
  assert.deepEqual(p.pointsSeries, [4, 6, 7, 9, 13, 15]);
  assert.deepEqual(p.placeSeries, [1, 3, 3, 2, 1, 2]);
  near(p.tempo.avgTurnSec, 3290 / 21, 'tempo.avgTurnSec');
  assert.equal(p.tempo.rank, 3);
  assert.equal(p.tempo.of, 5);
  assert.deepEqual(p.tempo.rows.map((r) => r.memberId), ['m-D', 'm-T', 'm-F', 'm-M', 'm-L']);
  nearList(p.tempo.rows.map((r) => r.avgTurnSec), [311.25, 185, 3290 / 21, 130, 110], 'tempo.rows');
  assert.deepEqual(p.nemesis, { memberId: 'm-M', count: 2 });
  assert.deepEqual(p.favoriteDeck, { deckId: 'd-atraxa', games: 4 });
  assert.equal(p.bestDeck.deckId, 'd-atraxa');
  near(p.bestDeck.winRate, 0.25, 'bestDeck.winRate');
  assert.equal(p.bestDeck.games, 4);
  assert.equal(p.longestStreak, 1);
  assert.deepEqual(p.fastestWin, { gameId: 'g6', rounds: 7 });
  // keine Zusatzschlüssel (Vertrag Anhang A)
  assert.deepEqual(Object.keys(p).sort(), ['avgDeckRating', 'avgFun', 'avgPlace', 'avgSalt', 'bestDeck', 'favoriteDeck', 'fastestWin', 'games', 'longestStreak', 'nemesis', 'placeSeries', 'points', 'pointsSeries', 'saltTrend', 'tempo', 'winRate', 'wins'].sort());
});

test('K9 Nemesis D/L/M/T, bestDeck T null', async () => {
  const { memberProfile } = await S();
  assert.deepEqual(memberProfile(fixtureGroupData(), 'm-D').nemesis, { memberId: 'm-M', count: 3 });
  assert.deepEqual(memberProfile(fixtureGroupData(), 'm-L').nemesis, { memberId: 'm-F', count: 2 }, 'Gleichstand F/M, F zuletzt (g2)');
  assert.deepEqual(memberProfile(fixtureGroupData(), 'm-M').nemesis, { memberId: 'm-F', count: 2 });
  assert.equal(memberProfile(fixtureGroupData(), 'm-T').nemesis, null);
  assert.equal(memberProfile(fixtureGroupData(), 'm-T').bestDeck, null);
});

// ---------------------------------------------------------------- 10
test('K10 deckProfile(atraxa)', async () => {
  const { deckProfile } = await S();
  const d = deckProfile(fixtureGroupData(), 'd-atraxa');
  assert.equal(d.games, 4);
  assert.equal(d.wins, 1);
  near(d.winRate, 0.25, 'winRate');
  near(d.avgPlace, 2.25, 'avgPlace');
  assert.equal(d.points, 9);
  near(d.avgOwnRating, 3.25, 'avgOwnRating');
  near(d.avgFun, 3.5, 'avgFun');
  near(d.salt.avgSalt, 2.75, 'salt.avgSalt');
  assert.equal(d.salt.ratings, 4);
  assert.deepEqual(d.recentGameIds, ['g1', 'g2', 'g4', 'g5']);
  assert.deepEqual(Object.keys(d).sort(), ['avgFun', 'avgOwnRating', 'avgPlace', 'games', 'points', 'recentGameIds', 'salt', 'winRate', 'wins'].sort());
});

// ---------------------------------------------------------------- 11
test('K11 leere Gruppe ⇒ leere Formen, kein Wurf; unbekannt ⇒ null; Spiel ohne Bewertungen ⇒ avgSalt null', async () => {
  const s = await S();
  const { emptyGroupData } = await H();
  const e = () => emptyGroupData('g');
  assert.equal(s.inRange(e(), '30d', new Date('2026-11-10T12:00:00Z')).games.length, 0);
  assert.equal(s.inRange(e(), 'year', new Date('2026-11-10T12:00:00Z')).games.length, 0);
  assert.deepEqual(s.playerTable(e()), []);
  assert.deepEqual(s.deckTable(e()), []);
  assert.deepEqual(s.deckSaltTable(e()), []);
  assert.deepEqual(s.evenings(e(), { filter: 'siege', meMemberId: 'm-F' }), []);
  assert.equal(s.gameSummary(e(), 'x'), null);
  assert.equal(s.recap(e(), 'x'), null);
  assert.equal(s.gameSummary(fixtureGroupData(), 'x'), null, 'unbekanntes Spiel');
  assert.equal(s.recap(fixtureGroupData(), 'x'), null, 'unbekannter Abend');
  assert.deepEqual(s.memberProfile(e(), 'm-x'), {
    games: 0, wins: 0, points: 0, winRate: null, avgPlace: null, avgSalt: null, avgFun: null, avgDeckRating: null,
    saltTrend: [], pointsSeries: [], placeSeries: [], tempo: { avgTurnSec: null, rank: null, of: 0, rows: [] },
    nemesis: null, favoriteDeck: null, bestDeck: null, longestStreak: 0, fastestWin: null,
  });
  assert.deepEqual(s.deckProfile(e(), 'd-x'), { games: 0, wins: 0, winRate: null, avgPlace: null, points: 0, avgOwnRating: null, avgFun: null, salt: null, recentGameIds: [] });

  const d = fixtureGroupData();
  d.ratings = d.ratings.filter((r) => r.gameId !== 'g3');
  const g3 = s.gameSummary(d, 'g3');
  assert.equal(g3.avgSalt, null);
  assert.equal(g3.avgFun, null);
  // Mitglied ohne Spiele in der Fixture-Gruppe ⇒ leere Form, kein Wurf
  const x = s.memberProfile(fixtureGroupData(), 'm-x');
  assert.equal(x.games, 0);
  assert.equal(x.tempo.of, 5, 'Tempo-Liste der Gruppe bleibt sichtbar');
  assert.equal(x.tempo.rank, null);
});

test('K11 Negativraum: Platz null zählt nicht, unbekannte Decks/Mitglieder/Abend werfen nicht', async () => {
  const s = await S();
  const d = fixtureGroupData();
  d.players.find((p) => p.gameId === 'g1' && p.memberId === 'm-L').place = null;
  const t = s.playerTable(d);
  const L = t.find((r) => r.memberId === 'm-L');
  assert.equal(L.games, 5, 'g1 zählt für L nicht');
  assert.ok(t.every((r) => Number.isFinite(r.points) && Number.isFinite(r.avgPlace)), 'kein NaN');

  const d2 = fixtureGroupData();
  d2.decks = d2.decks.filter((x) => x.id !== 'd-atraxa'); // RLS kann Decks verbergen
  d2.members = d2.members.filter((m) => m.id !== 'm-T');
  d2.games[0].sessionId = null;
  d2.sessions = [];
  assert.doesNotThrow(() => {
    s.playerTable(d2); s.deckTable(d2); s.deckSaltTable(d2); s.evenings(d2, { filter: 'alle' });
    s.memberProfile(d2, 'm-F'); s.deckProfile(d2, 'd-atraxa'); s.gameSummary(d2, 'g6'); s.recap(d2, 's1');
  });
});

// ---------------------------------------------------------------- 12
test('K12 Unveränderlichkeit: Eingabe nach jedem Aufruf tief gleich', async () => {
  const s = await S();
  const data = fixtureGroupData();
  const before = structuredClone(data);
  const now = new Date('2026-11-20T12:00:00+01:00');
  s.inRange(data, '30d', now); s.inRange(data, 'year', now); s.inRange(data, 'all', now);
  s.playerTable(data); s.deckTable(data); s.deckSaltTable(data); s.deckSaltTable(data, { min: 1 });
  for (const g of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']) s.gameSummary(data, g);
  for (const f of ['alle', 'siege', 'salt', 'foto']) s.evenings(data, { filter: f, meMemberId: 'm-F' });
  for (const sid of ['s0', 's1', 's2']) s.recap(data, sid);
  for (const m of ['m-F', 'm-L', 'm-M', 'm-D', 'm-T']) s.memberProfile(data, m);
  for (const dk of ['d-atraxa', 'd-prosper', 'd-edgar', 'd-krenko', 'd-kinnan', 'd-yuriko']) s.deckProfile(data, dk);
  assert.deepStrictEqual(data, before);
});
