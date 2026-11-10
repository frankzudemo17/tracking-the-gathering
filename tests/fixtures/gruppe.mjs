// Gemeinsame Fixture Etappe 4/5 (Naht P13) — wörtlich nach spec-p13-naehte.md Anhang B.
// Reine Daten, keine Importe. Form = GroupData (src/lib/history-data.js, Vertrag Anhang A).
// P15 rechnet seine Sollwerte von Hand hieraus, P16–P20 zeigen sie in der Vorschau (tools/preview/preview.mjs).
// Änderungen nur durch Nacharbeit an P13 (neue Zeilen brechen die Sollwerte in P15).

export const GROUP_ID = '22222222-2222-4222-8222-222222222222';
export const ME_PROFILE = '11111111-1111-4111-8111-111111111111';
export const ME_MEMBER = 'm-F';

const P_LUKA = '33333333-3333-4333-8333-333333333333';
const P_MARIE = '44444444-4444-4444-8444-444444444444';
const P_DENIZ = '55555555-5555-4555-8555-555555555555';

// Scryfall-Art wie im Vorschau-Werkzeug der Welle ttg-spielen (preview-local.js, ARTS)
const art = (p) => `https://cards.scryfall.io/art_crop/front/${p}`;

const MEMBERS = [
  { id: 'm-F', name: 'Franco', profileId: ME_PROFILE, avatarPath: null, isPlaceholder: false },
  { id: 'm-L', name: 'Luka', profileId: P_LUKA, avatarPath: null, isPlaceholder: false },
  { id: 'm-M', name: 'Marie', profileId: P_MARIE, avatarPath: null, isPlaceholder: false },
  { id: 'm-D', name: 'Deniz', profileId: P_DENIZ, avatarPath: null, isPlaceholder: false },
  { id: 'm-T', name: 'Tim', profileId: null, avatarPath: null, isPlaceholder: true },
];

const deck = (id, ownerProfileId, commanderName, shortName, colors, imageUrl) => ({
  id, shortName, commanderName, partnerName: null, imageUrl, colors,
  bracket: 3, ownerProfileId, ownerMemberId: null, archived: false,
});
const DECKS = [
  deck('d-atraxa', ME_PROFILE, "Atraxa, Praetors' Voice", 'Atraxa', ['W', 'U', 'B', 'G'], art('d/0/d0d33d52-3d28-4635-b985-51e126289259.jpg')),
  deck('d-prosper', ME_PROFILE, 'Prosper, Tome-Bound', 'Prosper', ['B', 'R'], null),
  deck('d-edgar', P_LUKA, 'Edgar Markov', 'Edgar', ['R', 'W', 'B'], art('7/6/76f21cbb-6d6e-4cc5-8a9d-9fbc0b7c5ad3.jpg')),
  deck('d-krenko', P_MARIE, 'Krenko, Mob Boss', 'Krenko', ['R'], null),
  deck('d-kinnan', P_MARIE, 'Kinnan, Bonder Prodigy', 'Kinnan', ['G', 'U'], art('6/3/63cda4a0-0dff-4edb-ae67-a2b7e2971350.jpg')),
  deck('d-yuriko', P_DENIZ, "Yuriko, the Tiger's Shadow", 'Yuriko', ['U', 'B'], art('3/b/3bd81ae6-e628-447a-a36b-597e63ede295.jpg')),
];

const SESSIONS = [
  { id: 's2', playedOn: '2026-10-18', location: null },
  { id: 's1', playedOn: '2026-10-31', location: 'Lukas WG' },
  { id: 's0', playedOn: '2026-11-06', location: 'Bei Franco' },
];

// endedAt = startedAt + Minuten (g6 49 · g5 84 · g4 41 · g3 58 · g2 71 · g1 52)
const game = (id, sessionId, startedAt, endedAt, round, wincon, note, photoPath) => ({
  id, sessionId, status: 'finished', startedAt, endedAt, round, wincon, note, photoPath, startingLife: 40,
});
const GAMES = [
  game('g6', 's2', '2026-10-18T19:00:00+02:00', '2026-10-18T19:49:00+02:00', 7, 'alternativ', null, null),
  game('g5', 's2', '2026-10-18T20:15:00+02:00', '2026-10-18T21:39:00+02:00', 10, 'kampfschaden', null, `${GROUP_ID}/g5.jpg`),
  game('g4', 's1', '2026-10-31T19:00:00+01:00', '2026-10-31T19:41:00+01:00', 6, 'commander', null, null),
  game('g3', 's1', '2026-10-31T20:00:00+01:00', '2026-10-31T20:58:00+01:00', 8, 'kampfschaden', null, null),
  game('g2', 's1', '2026-10-31T21:10:00+01:00', '2026-10-31T22:21:00+01:00', 9, 'gift', null, null),
  game('g1', 's0', '2026-11-06T19:30:00+01:00', '2026-11-06T20:22:00+01:00', 7, 'kombo', "Marie hat's wieder getan.", `${GROUP_ID}/g1.jpg`),
];

// Sitz = Reihenfolge F, L, M, D, T ab 0 unter den Teilnehmenden; Zeilen hier in Platz-Reihenfolge wie Anhang B
const pl = (gameId, memberId, deckId, seat, place, eliminatedRound, eliminatedBy, finalLife) => ({
  gameId, memberId, deckId, seat, place, eliminatedRound, eliminatedBy, finalLife,
});
const PLAYERS = [
  // g1: M kinnan 1 –/– 12 · F atraxa 2 7/M 0 · D yuriko 3 7/M 0 · L edgar 4 5/D 0
  pl('g1', 'm-M', 'd-kinnan', 2, 1, null, null, 12),
  pl('g1', 'm-F', 'd-atraxa', 0, 2, 7, 'm-M', 0),
  pl('g1', 'm-D', 'd-yuriko', 3, 3, 7, 'm-M', 0),
  pl('g1', 'm-L', 'd-edgar', 1, 4, 5, 'm-D', 0),
  // g2: F atraxa 1 –/– 7 · L edgar 2 9/F 0 · M krenko 3 8/F 0 · D yuriko 4 6/L 0
  pl('g2', 'm-F', 'd-atraxa', 0, 1, null, null, 7),
  pl('g2', 'm-L', 'd-edgar', 1, 2, 9, 'm-F', 0),
  pl('g2', 'm-M', 'd-krenko', 2, 3, 8, 'm-F', 0),
  pl('g2', 'm-D', 'd-yuriko', 3, 4, 6, 'm-L', 0),
  // g3: L edgar 1 –/– 18 · F prosper 2 8/L 0 · M kinnan 3 8/L 0 · D yuriko 4 6/M 0
  pl('g3', 'm-L', 'd-edgar', 1, 1, null, null, 18),
  pl('g3', 'm-F', 'd-prosper', 0, 2, 8, 'm-L', 0),
  pl('g3', 'm-M', 'd-kinnan', 2, 3, 8, 'm-L', 0),
  pl('g3', 'm-D', 'd-yuriko', 3, 4, 6, 'm-M', 0),
  // g4: D yuriko 1 –/– 21 · M kinnan 2 6/D 0 · F atraxa 3 6/D 0 · L edgar 4 4/M 0
  pl('g4', 'm-D', 'd-yuriko', 3, 1, null, null, 21),
  pl('g4', 'm-M', 'd-kinnan', 2, 2, 6, 'm-D', 0),
  pl('g4', 'm-F', 'd-atraxa', 0, 3, 6, 'm-D', 0),
  pl('g4', 'm-L', 'd-edgar', 1, 4, 4, 'm-M', 0),
  // g5: M krenko 1 –/– 9 · L edgar 2 10/M 0 · F atraxa 3 9/M 0 · T prosper 4 7/L 0 · D yuriko 5 5/F 0
  pl('g5', 'm-M', 'd-krenko', 2, 1, null, null, 9),
  pl('g5', 'm-L', 'd-edgar', 1, 2, 10, 'm-M', 0),
  pl('g5', 'm-F', 'd-atraxa', 0, 3, 9, 'm-M', 0),
  pl('g5', 'm-T', 'd-prosper', 4, 4, 7, 'm-L', 0),
  pl('g5', 'm-D', 'd-yuriko', 3, 5, 5, 'm-F', 0),
  // g6: F prosper 1 –/– 26 · M krenko 2 7/F 0 · L edgar 3 7/F 0 · D yuriko 4 5/M 0
  pl('g6', 'm-F', 'd-prosper', 0, 1, null, null, 26),
  pl('g6', 'm-M', 'd-krenko', 2, 2, 7, 'm-F', 0),
  pl('g6', 'm-L', 'd-edgar', 1, 3, 7, 'm-F', 0),
  pl('g6', 'm-D', 'd-yuriko', 3, 4, 5, 'm-M', 0),
];

const rt = (gameId, memberId, salt, fun, deckRating) => ({ gameId, memberId, salt, fun, deckRating });
const RATINGS = [
  // g1: M 1,4,5 · F 4,3,3 · D 5,2,2 · L 3,4,3
  rt('g1', 'm-M', 1, 4, 5), rt('g1', 'm-F', 4, 3, 3), rt('g1', 'm-D', 5, 2, 2), rt('g1', 'm-L', 3, 4, 3),
  // g2: F 1,5,5 · L 3,4,3 · M 2,4,3 · D 5,3,2
  rt('g2', 'm-F', 1, 5, 5), rt('g2', 'm-L', 3, 4, 3), rt('g2', 'm-M', 2, 4, 3), rt('g2', 'm-D', 5, 3, 2),
  // g3: L 1,5,5 · M 2,4,3 · F 2,4,4 · D 4,3,2
  rt('g3', 'm-L', 1, 5, 5), rt('g3', 'm-M', 2, 4, 3), rt('g3', 'm-F', 2, 4, 4), rt('g3', 'm-D', 4, 3, 2),
  // g4: D 1,5,5 · M 3,3,3 · F 5,2,2 · L 3,4,3
  rt('g4', 'm-D', 1, 5, 5), rt('g4', 'm-M', 3, 3, 3), rt('g4', 'm-F', 5, 2, 2), rt('g4', 'm-L', 3, 4, 3),
  // g5: M 1,5,5 · L 2,4,4 · F 3,4,3 · T 2,5,3 · D 4,3,2
  rt('g5', 'm-M', 1, 5, 5), rt('g5', 'm-L', 2, 4, 4), rt('g5', 'm-F', 3, 4, 3), rt('g5', 'm-T', 2, 5, 3), rt('g5', 'm-D', 4, 3, 2),
  // g6: F 1,5,5 · M 3,4,3 · L 2,4,3 · D keine Zeile
  rt('g6', 'm-F', 1, 5, 5), rt('g6', 'm-M', 3, 4, 3), rt('g6', 'm-L', 2, 4, 3),
];

const ds = (gameId, raterId, deckId, salt) => ({ gameId, raterId, deckId, salt });
const DECK_SALT = [
  // g1 F{kinnan 5, yuriko 2, edgar 1} · D{kinnan 5, atraxa 2} · L{kinnan 4, yuriko 3}
  ds('g1', 'm-F', 'd-kinnan', 5), ds('g1', 'm-F', 'd-yuriko', 2), ds('g1', 'm-F', 'd-edgar', 1),
  ds('g1', 'm-D', 'd-kinnan', 5), ds('g1', 'm-D', 'd-atraxa', 2),
  ds('g1', 'm-L', 'd-kinnan', 4), ds('g1', 'm-L', 'd-yuriko', 3),
  // g2 L{atraxa 4, krenko 1} · M{atraxa 3, edgar 2}
  ds('g2', 'm-L', 'd-atraxa', 4), ds('g2', 'm-L', 'd-krenko', 1),
  ds('g2', 'm-M', 'd-atraxa', 3), ds('g2', 'm-M', 'd-edgar', 2),
  // g4 F{yuriko 5, kinnan 3} · M{yuriko 3}
  ds('g4', 'm-F', 'd-yuriko', 5), ds('g4', 'm-F', 'd-kinnan', 3),
  ds('g4', 'm-M', 'd-yuriko', 3),
  // g5 D{krenko 4, atraxa 2}
  ds('g5', 'm-D', 'd-krenko', 4), ds('g5', 'm-D', 'd-atraxa', 2),
];

const pv = (gameId, voterId, votedFor, text = null) => ({ gameId, voterId, votedFor, text });
const POTG = [
  // g1: F→M „…“ · D→M · L→F · M→D
  pv('g1', 'm-F', 'm-M', 'Kinnan plus Basalt Monolith, unendlich Mana in Runde 7.'), pv('g1', 'm-D', 'm-M'), pv('g1', 'm-L', 'm-F'), pv('g1', 'm-M', 'm-D'),
  // g2: F→F „…“ · L→F · M→L
  pv('g2', 'm-F', 'm-F', 'Proliferate hat Luka von 4 auf 10 Gift gebracht.'), pv('g2', 'm-L', 'm-F'), pv('g2', 'm-M', 'm-L'),
  // g3: L→L „…“ · F→L · M→L · D→M
  pv('g3', 'm-L', 'm-L', 'Edgar-Swing mit vierzehn Vampiren.'), pv('g3', 'm-F', 'm-L'), pv('g3', 'm-M', 'm-L'), pv('g3', 'm-D', 'm-M'),
  // g4: D→D „…“ · M→D
  pv('g4', 'm-D', 'm-D', 'Yuriko trifft Franco mit genau 21.'), pv('g4', 'm-M', 'm-D'),
  // g5: M→M „…“ · L→M · F→L · T→M
  pv('g5', 'm-M', 'm-M', 'Krenko-Kette über drei Runden.'), pv('g5', 'm-L', 'm-M'), pv('g5', 'm-F', 'm-L'), pv('g5', 'm-T', 'm-M'),
  // g6: F→F „…“ · M→F
  pv('g6', 'm-F', 'm-F', 'Approach of the Second Sun aus dem Nichts.'), pv('g6', 'm-M', 'm-F'),
];

const tu = (gameId, memberId, turns, totalSec, longestSec) => ({ gameId, memberId, turns, totalSec, longestSec });
const TURNS = [
  // g1: F 7/1050/200 · M 7/910/180 · D 6/1980/462 · L 4/440/130
  tu('g1', 'm-F', 7, 1050, 200), tu('g1', 'm-M', 7, 910, 180), tu('g1', 'm-D', 6, 1980, 462), tu('g1', 'm-L', 4, 440, 130),
  // g4: D 6/1800/618 · M 6/780/150 · F 5/800/190 · L 3/330/120
  tu('g4', 'm-D', 6, 1800, 618), tu('g4', 'm-M', 6, 780, 150), tu('g4', 'm-F', 5, 800, 190), tu('g4', 'm-L', 3, 330, 120),
  // g5: M 10/1300/160 · L 9/990/140 · F 9/1440/210 · T 6/1110/402 · D 4/1200/380
  tu('g5', 'm-M', 10, 1300, 160), tu('g5', 'm-L', 9, 990, 140), tu('g5', 'm-F', 9, 1440, 210), tu('g5', 'm-T', 6, 1110, 402), tu('g5', 'm-D', 4, 1200, 380),
];

const dm = (source, target, damage, commanderDamage, poison) => ({ source, target, damage, commanderDamage, poison });
const DAMAGE = {
  // D→L 30/9/0 · M→F 25/21/0 · M→D 18/0/0 · F→D 12/0/3 · L→M 6/0/0
  g1: [dm('m-D', 'm-L', 30, 9, 0), dm('m-M', 'm-F', 25, 21, 0), dm('m-M', 'm-D', 18, 0, 0), dm('m-F', 'm-D', 12, 0, 3), dm('m-L', 'm-M', 6, 0, 0)],
};

/** Tiefe Kopie (reine Daten) ⇒ jeder Aufruf liefert frische Objekte. */
const copy = (x) => JSON.parse(JSON.stringify(x));

/** @returns {import('../../src/lib/history-data.js').GroupData} */
export function fixtureGroupData() {
  return copy({
    groupId: GROUP_ID, members: MEMBERS, decks: DECKS, sessions: SESSIONS, games: GAMES,
    players: PLAYERS, ratings: RATINGS, deckSalt: DECK_SALT, potg: POTG, turns: TURNS,
  });
}

/**
 * @param {string} gameId
 * @returns {import('../../src/lib/history-data.js').DamageRow[]}
 */
export function fixtureDamage(gameId) {
  return copy(DAMAGE[gameId] || []);
}
