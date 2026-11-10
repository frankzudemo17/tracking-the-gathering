// Spec P13 Kriterium 9: gemeinsame Fixture tests/fixtures/gruppe.mjs (Anhang B).
// Sollwerte von Hand aus Anhang B gezählt. import() je Fall ⇒ ohne Fixture rot (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const fx = () => import('../fixtures/gruppe.mjs');
const fmt = () => import('../../src/lib/format.js');

const KEYS = {
  GroupData: ['groupId', 'members', 'decks', 'sessions', 'games', 'players', 'ratings', 'deckSalt', 'potg', 'turns'],
  members: ['id', 'name', 'profileId', 'avatarPath', 'isPlaceholder'],
  decks: ['id', 'shortName', 'commanderName', 'partnerName', 'imageUrl', 'colors', 'bracket', 'ownerProfileId', 'ownerMemberId', 'archived'],
  sessions: ['id', 'playedOn', 'location'],
  games: ['id', 'sessionId', 'status', 'startedAt', 'endedAt', 'round', 'wincon', 'note', 'photoPath', 'startingLife'],
  players: ['gameId', 'memberId', 'deckId', 'seat', 'place', 'eliminatedRound', 'eliminatedBy', 'finalLife'],
  ratings: ['gameId', 'memberId', 'salt', 'fun', 'deckRating'],
  deckSalt: ['gameId', 'raterId', 'deckId', 'salt'],
  potg: ['gameId', 'voterId', 'votedFor', 'text'],
  turns: ['gameId', 'memberId', 'turns', 'totalSec', 'longestSec'],
};
const DAMAGE_KEYS = ['source', 'target', 'damage', 'commanderDamage', 'poison'];
const sorted = (a) => [...a].sort();

test('F1 Konstanten und Form: alle Schlüssel aus Anhang A', async () => {
  const { GROUP_ID, ME_PROFILE, ME_MEMBER, fixtureGroupData } = await fx();
  assert.equal(GROUP_ID, '22222222-2222-4222-8222-222222222222');
  assert.equal(ME_PROFILE, '11111111-1111-4111-8111-111111111111');
  assert.equal(ME_MEMBER, 'm-F');
  const d = fixtureGroupData();
  assert.deepEqual(sorted(Object.keys(d)), sorted(KEYS.GroupData));
  assert.equal(d.groupId, GROUP_ID);
  for (const [k, keys] of Object.entries(KEYS)) {
    if (k === 'GroupData') continue;
    for (const row of d[k]) assert.deepEqual(sorted(Object.keys(row)), sorted(keys), `${k}: ${JSON.stringify(row)}`);
  }
});

test('F2 Anzahlen (von Hand aus Anhang B)', async () => {
  const { fixtureGroupData, fixtureDamage } = await fx();
  const d = fixtureGroupData();
  assert.equal(d.members.length, 5);
  assert.equal(d.decks.length, 6);
  assert.equal(d.sessions.length, 3);
  assert.equal(d.games.length, 6);
  assert.ok(d.games.every((g) => g.status === 'finished' && g.startingLife === 40));
  assert.equal(d.players.length, 25);
  assert.equal(d.ratings.length, 24);
  assert.equal(d.ratings.filter((r) => r.gameId === 'g6' && r.memberId === 'm-D').length, 0, 'D in g6 ohne Bewertung');
  assert.equal(d.deckSalt.length, 16);
  assert.equal(d.potg.length, 19);
  assert.equal(d.turns.length, 13);
  assert.deepEqual(sorted(new Set(d.turns.map((t) => t.gameId))), ['g1', 'g4', 'g5']);
  const dmg = fixtureDamage('g1');
  assert.equal(dmg.length, 5);
  for (const row of dmg) assert.deepEqual(sorted(Object.keys(row)), sorted(DAMAGE_KEYS));
  assert.deepEqual(fixtureDamage('g2'), []);
  assert.deepEqual(fixtureDamage('x'), []);
});

test('F3 Stichproben gegen Anhang B', async () => {
  const { fixtureGroupData, fixtureDamage, GROUP_ID } = await fx();
  const d = fixtureGroupData();
  const tim = d.members.find((m) => m.id === 'm-T');
  assert.deepEqual(tim, { id: 'm-T', name: 'Tim', profileId: null, avatarPath: null, isPlaceholder: true });
  const atraxa = d.decks.find((x) => x.id === 'd-atraxa');
  assert.equal(atraxa.commanderName, "Atraxa, Praetors' Voice");
  assert.equal(atraxa.shortName, 'Atraxa');
  assert.deepEqual(atraxa.colors, ['W', 'U', 'B', 'G']);
  assert.equal(atraxa.ownerProfileId, '11111111-1111-4111-8111-111111111111');
  assert.equal(atraxa.ownerMemberId, null);
  assert.equal(d.decks.find((x) => x.id === 'd-prosper').imageUrl, null);
  assert.deepEqual(d.sessions.find((s) => s.id === 's1'), { id: 's1', playedOn: '2026-10-31', location: 'Lukas WG' });
  const g1 = d.games.find((g) => g.id === 'g1');
  assert.equal(g1.note, "Marie hat's wieder getan.");
  assert.equal(g1.photoPath, `${GROUP_ID}/g1.jpg`);
  assert.equal(g1.wincon, 'kombo');
  assert.equal(g1.sessionId, 's0');
  // g5: Tim auf Sitz 4 (Reihenfolge F, L, M, D, T), D Platz 5, von F raus in Runde 5
  const g5 = d.players.filter((p) => p.gameId === 'g5');
  assert.equal(g5.length, 5);
  assert.deepEqual(g5.find((p) => p.memberId === 'm-T'), { gameId: 'g5', memberId: 'm-T', deckId: 'd-prosper', seat: 4, place: 4, eliminatedRound: 7, eliminatedBy: 'm-L', finalLife: 0 });
  assert.deepEqual(g5.find((p) => p.memberId === 'm-D'), { gameId: 'g5', memberId: 'm-D', deckId: 'd-yuriko', seat: 3, place: 5, eliminatedRound: 5, eliminatedBy: 'm-F', finalLife: 0 });
  // g1: Sieger Marie, Kinnan, 12 Leben, kein Ausscheiden
  assert.deepEqual(d.players.find((p) => p.gameId === 'g1' && p.place === 1), { gameId: 'g1', memberId: 'm-M', deckId: 'd-kinnan', seat: 2, place: 1, eliminatedRound: null, eliminatedBy: null, finalLife: 12 });
  // Sitze je Spiel lückenlos ab 0 in der Reihenfolge F, L, M, D, T
  const ORDER = ['m-F', 'm-L', 'm-M', 'm-D', 'm-T'];
  for (const g of d.games) {
    const ps = d.players.filter((p) => p.gameId === g.id).sort((a, b) => a.seat - b.seat);
    assert.deepEqual(ps.map((p) => p.seat), ps.map((_, i) => i), `Sitze ${g.id}`);
    assert.deepEqual(ps.map((p) => p.memberId), ORDER.filter((m) => ps.some((p) => p.memberId === m)), `Reihenfolge ${g.id}`);
  }
  assert.deepEqual(d.ratings.find((r) => r.gameId === 'g4' && r.memberId === 'm-F'), { gameId: 'g4', memberId: 'm-F', salt: 5, fun: 2, deckRating: 2 });
  assert.deepEqual(d.deckSalt.filter((r) => r.gameId === 'g1' && r.raterId === 'm-F').map((r) => [r.deckId, r.salt]), [['d-kinnan', 5], ['d-yuriko', 2], ['d-edgar', 1]]);
  assert.equal(d.potg.find((p) => p.gameId === 'g2' && p.voterId === 'm-F').text, 'Proliferate hat Luka von 4 auf 10 Gift gebracht.');
  assert.equal(d.potg.find((p) => p.gameId === 'g1' && p.voterId === 'm-D').text, null);
  assert.deepEqual(d.turns.find((t) => t.gameId === 'g4' && t.memberId === 'm-D'), { gameId: 'g4', memberId: 'm-D', turns: 6, totalSec: 1800, longestSec: 618 });
  assert.deepEqual(fixtureDamage('g1').find((r) => r.source === 'm-M' && r.target === 'm-F'), { source: 'm-M', target: 'm-F', damage: 25, commanderDamage: 21, poison: 0 });
});

test('F4 Spieldauer: endedAt − startedAt = Minuten-Spalte', async () => {
  const { fixtureGroupData } = await fx();
  const { minutesBetween } = await fmt();
  const MIN = { g6: 49, g5: 84, g4: 41, g3: 58, g2: 71, g1: 52 };
  for (const g of fixtureGroupData().games) assert.equal(minutesBetween(g.startedAt, g.endedAt), MIN[g.id], g.id);
});

test('F5 frisch je Aufruf (Tests dürfen die Daten verändern)', async () => {
  const { fixtureGroupData, fixtureDamage } = await fx();
  const a = fixtureGroupData(); const b = fixtureGroupData();
  a.games.pop(); a.players[0].place = 99; a.decks[0].colors.push('X');
  assert.equal(b.games.length, 6);
  assert.notEqual(b.players[0].place, 99);
  assert.equal(fixtureGroupData().decks[0].colors.includes('X'), false);
  fixtureDamage('g1').pop();
  assert.equal(fixtureDamage('g1').length, 5);
});
