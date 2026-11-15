// Spec P4 Abzeichen: Regeln src/lib/badges.js — Kriterien 1–7 (Fälle K1, F1–F13, B01–B21, G1–G8, X1–X4, N1–N6, A1–A3, P1).
// Sollwerte von Hand aus spec-p4-abzeichen.md („Spec-Tests“, „Probe-Sollwerte“), nie aus der Implementierung abgeleitet.
// Modul je Fall per import() ⇒ am Start-main (Modul fehlt) schlägt jeder Fall einzeln fehl (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGroupData } from '../fixtures/gruppe.mjs';

const B = () => import('../../src/lib/badges.js');
const S = () => import('../../src/lib/stats.js');
const NOW = '2026-12-01T00:00:00Z';
const HOUR = 3600000;

// ---------------------------------------------------------------------------
// Bausteine für Daten (Notation der Spec: g<n> startet 2026-10-0<n>T18:00Z, endet +1 h, Runde 8, finished, ohne Abend)

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const startOf = (n) => Date.UTC(2026, 9, 1, 18) + (n - 1) * 86400000;
/** @param {number} n @param {Record<string, any>} [x] */
const G = (n, x = {}) => ({
  id: `g${n}`, sessionId: null, status: 'finished', startedAt: iso(startOf(n)), endedAt: iso(startOf(n) + HOUR),
  round: 8, wincon: null, note: null, photoPath: null, startingLife: 40, layout: null, ...x,
});
/** Zeile (Mitglied, Platz, eliminatedBy, finalLife, deckId), Sitz optional */
const P = (gameId, memberId, place, eliminatedBy = null, finalLife = null, deckId = null, seat = 0) => ({
  gameId, memberId, deckId, seat, place, eliminatedRound: null, eliminatedBy, finalLife,
});
const M = (id, x = {}) => ({ id, name: id, profileId: null, avatarPath: null, isPlaceholder: false, removed: false, formerProfileId: null, ...x });
/** GroupData aus Spielen + Zeilen; Mitglieder aus den Zeilen, sofern nicht angegeben. */
function D({ games, players, members, sessions = [], ratings = [], deckSalt = [] }) {
  const ids = [...new Set(players.map((p) => p.memberId))];
  return {
    groupId: 'G', members: members || ids.map((id) => M(id)), decks: [], sessions, games, players,
    ratings, deckSalt, potg: [], turns: [],
  };
}
/** Ereignis `seq:typ quelle→ziel betrag {payload}` */
const ev = (seq, type, source = null, target = null, amount = null, payload = {}) => ({ seq, type, source, target, amount, payload });
const ABC = [{ memberId: 'a', seat: 0 }, { memberId: 'b', seat: 1 }, { memberId: 'c', seat: 2 }];

/** Ein-Spiel-Daten: a gewinnt g1, b und c folgen. */
const oneGame = (x = {}, rows = null) => D({
  games: [G(1, x)],
  players: rows || [P('g1', 'a', 1, null, 10, null, 0), P('g1', 'b', 2, 'a', 0, null, 1), P('g1', 'c', 3, 'a', 0, null, 2)],
});

async function awardsOf(data, facts = {}, now = NOW) {
  const { badgeAwards } = await B();
  return badgeAwards(data, facts, { now }).awards;
}
/** Set „mitglied:abzeichen:spiel(:stufe)“ für kompakte Vergleiche */
const keys = (awards) => awards.map((a) => `${a.memberId}:${a.badgeId}:${a.gameId}${a.tier ? `:${a.tier}` : ''}`);
const has = (awards, m, b, g) => awards.some((a) => a.memberId === m && a.badgeId === b && (g == null || a.gameId === g));
const stateOf = async (data, facts, m, id, now = NOW) => {
  const { memberBadges } = await B();
  return memberBadges(data, facts, m, { now }).find((s) => s.id === id);
};
async function factsFor(evs, { players = ABC, startingLife = 40 } = {}) {
  const { gameFacts } = await B();
  return gameFacts({ players, startingLife, events: evs });
}

// ---------------------------------------------------------------------------
// K · Katalog

test('K1 Katalog: 21 Einträge, ids/Glyphen/Gruppen/Stufen/replay/rare/secret wie Tabelle; Glyphen in I', async () => {
  const { BADGES } = await B();
  const { I } = await import('../../src/lib/icons.js');
  const want = [
    ['erste-runde', 'flag', 'start'], ['erster-sieg', 'trophy', 'start'], ['erstes-blut', 'drop', 'start'],
    ['comeback', 'arrowCounterClockwise', 'play'], ['messers-schneide', 'heart', 'play'], ['unberuehrbar', 'shieldStar', 'play'],
    ['commander-henker', 'skull', 'play'], ['giftmischer', 'radioactive', 'play'], ['doppelschlag', 'lightning', 'play'],
    ['blitzsieg', 'hourglass', 'play'], ['koenigsmoerder', 'crown', 'play'], ['rache', 'crosshair', 'play'], ['lebensquell', 'gauge', 'play'],
    ['stammgast', 'users', 'endure'], ['siegertyp', 'medal', 'endure'], ['serie', 'fire', 'endure'], ['deckbauer', 'coins', 'endure'],
    ['abendkoenig', 'moon', 'endure'], ['salzbergwerk', 'salt', 'rare'], ['nachteule', 'sun', 'rare'], ['gluckspilz', 'smiley', 'rare'],
  ];
  assert.equal(BADGES.length, 21);
  assert.deepEqual(BADGES.map((b) => [b.id, b.icon, b.group]), want);
  const tiers = { stammgast: [10, 50, 100], siegertyp: [5, 25, 50], serie: [3, 5, 10], deckbauer: [3, 5, 10], abendkoenig: [1, 3, 5] };
  const units = { stammgast: 'games', siegertyp: 'wins', serie: 'streak', deckbauer: 'decks', abendkoenig: 'evenings' };
  const replay = ['comeback', 'unberuehrbar', 'commander-henker', 'giftmischer', 'doppelschlag', 'lebensquell', 'gluckspilz'];
  const rare = ['salzbergwerk', 'nachteule', 'gluckspilz'];
  const secret = ['nachteule', 'gluckspilz'];
  for (const b of BADGES) {
    assert.deepEqual(b.tiers, tiers[b.id] || null, `${b.id} tiers`);
    assert.equal(b.unit, units[b.id] || null, `${b.id} unit`);
    assert.equal(b.replay, replay.includes(b.id), `${b.id} replay`);
    assert.equal(b.rare, rare.includes(b.id), `${b.id} rare`);
    assert.equal(b.secret, secret.includes(b.id), `${b.id} secret`);
    assert.ok(typeof I[b.icon] === 'string' && I[b.icon].length > 0, `${b.icon} in I`);
  }
});

// ---------------------------------------------------------------------------
// F · gameFacts

test('F1 leer ⇒ { v: 1, ok: false, reason: none }', async () => {
  assert.deepEqual(await factsFor([]), { v: 1, ok: false, reason: 'none' });
});
test('F2 nur Ereignisse ohne seq ⇒ wie F1', async () => {
  assert.deepEqual(await factsFor([ev(null, 'damage', 'b', 'a', 5), ev(null, 'life', null, 'a', 3)]), { v: 1, ok: false, reason: 'none' });
});
const F3 = [ev(1, 'damage', 'b', 'a', 36), ev(2, 'life', null, 'a', 10), ev(3, 'lifelink', 'a', 'a', 25)];
test('F3 Minimum und Gewinn', async () => {
  const f = await factsFor(F3);
  assert.equal(f.ok, true); assert.equal(f.v, 1);
  assert.equal(f.min.a, 4); assert.equal(f.gained.a, 35); assert.equal(f.min.b, 40); assert.equal(f.gained.b, 0);
  assert.equal(f.min.c, 40); assert.equal(f.gained.c, 0);
});
test('F4 Undo: rückgängig gemachte Ereignisse zählen auch für Zwischenwerte nie', async () => {
  const f = await factsFor([ev(1, 'damage', 'b', 'a', 37), ev(2, 'undo', null, null, null, { seq: 1 }), ev(3, 'life', null, 'a', 30), ev(4, 'undo', null, null, null, { seq: 3 })]);
  assert.equal(f.min.a, 40); assert.equal(f.gained.a, 0);
});
test('F5 Commander-K.O.', async () => {
  const f = await factsFor([ev(1, 'cmd_damage', 'a', 'b', 21, { partner: false }), ev(2, 'eliminate', 'a', 'b', null, { place: 3 })]);
  assert.deepEqual(f.kos, [{ target: 'b', source: 'a', turn: 0, cmd21: true, poison10: false }]);
});
test('F6 Partner zählen einzeln (20 + 20 ⇒ nein; 21 Partner ⇒ ja)', async () => {
  const f = await factsFor([ev(1, 'cmd_damage', 'a', 'b', 20, { partner: false }), ev(2, 'cmd_damage', 'a', 'b', 20, { partner: true }),
    ev(3, 'damage', 'c', 'b', 10), ev(4, 'eliminate', 'a', 'b', null, { place: 3 })]);
  assert.equal(f.kos.length, 1); assert.equal(f.kos[0].cmd21, false);
  const f2 = await factsFor([ev(1, 'cmd_damage', 'a', 'b', 21, { partner: true }), ev(2, 'eliminate', 'a', 'b', null, { place: 3 })]);
  assert.equal(f2.kos[0].cmd21, true);
});
test('F7 Gift unabhängig von der Herkunft; 9 Gift + Schaden ⇒ nein', async () => {
  const f = await factsFor([ev(1, 'poison', null, 'b', 10), ev(2, 'eliminate', 'a', 'b', null, { place: 3 })]);
  assert.equal(f.kos[0].poison10, true);
  const f2 = await factsFor([ev(1, 'poison', null, 'b', 9), ev(2, 'damage', 'c', 'b', 40), ev(3, 'eliminate', 'a', 'b', null, { place: 3 })]);
  assert.equal(f2.kos[0].poison10, false);
});
test('F8 Zug = Zahl der wirksamen turn_end davor', async () => {
  const f = await factsFor([ev(1, 'eliminate', 'a', 'b', null, { place: 3 }), ev(2, 'turn_end', null, 'a', null, { seconds: 10, at: 1 }), ev(3, 'eliminate', 'a', 'c', null, { place: 2 })]);
  assert.equal(f.kos[0].turn, 0); assert.equal(f.kos[1].turn, 1);
});
test('F9 rückgängig gemachter K.O. zählt nicht, Schaden bleibt', async () => {
  const f = await factsFor([ev(1, 'damage', 'a', 'b', 40), ev(2, 'eliminate', 'a', 'b', null, { place: 3 }), ev(3, 'undo', null, null, null, { seq: 2 })]);
  assert.deepEqual(f.kos, []); assert.equal(f.min.b, 0);
});
test('F10 Startwurf: Sitz ⇒ Mitglied; andere Wurfarten nicht; kleinste seq gewinnt', async () => {
  assert.equal((await factsFor([ev(1, 'roll', null, null, null, { kind: 'start', values: [3], winner_seat: 1 })])).startWinner, 'b');
  assert.equal((await factsFor([ev(1, 'roll', null, null, null, { kind: 'w6', values: [3] })])).startWinner, null);
  assert.equal((await factsFor([ev(5, 'roll', null, null, null, { kind: 'start', winner_seat: 2 }), ev(1, 'roll', null, null, null, { kind: 'start', winner_seat: 1 })])).startWinner, 'b');
});
test('F11 kaputtes Ereignis (unbekanntes Ziel) ⇒ { v: 1, ok: false, reason: error }, kein Wurf', async () => {
  assert.deepEqual(await factsFor([ev(1, 'damage', 'a', 'z', 5)]), { v: 1, ok: false, reason: 'error' });
  assert.deepEqual(await factsFor([ev(1, 'gibtsnicht', 'a', 'b', 5)]), { v: 1, ok: false, reason: 'error' });
});
test('F12 Reihenfolge der Eingabe egal (F3 umgekehrt)', async () => {
  assert.deepEqual(await factsFor([...F3].reverse()), await factsFor(F3));
});
test('F13 Startleben 20', async () => {
  const f = await factsFor(F3, { startingLife: 20 });
  assert.equal(f.min.a, -16); assert.equal(f.min.b, 20);
});

// ---------------------------------------------------------------------------
// B · Regeln je Abzeichen

test('B01 Erste Runde: Partie = Zeile mit Platz', async () => {
  const a1 = await awardsOf(D({ games: [G(1)], players: [P('g1', 'a', 2), P('g1', 'b', 1)] }));
  assert.ok(has(a1, 'a', 'erste-runde', 'g1'));
  const a2 = await awardsOf(D({ games: [G(1)], players: [P('g1', 'a', null), P('g1', 'b', 1)] }));
  assert.ok(!has(a2, 'a', 'erste-runde'));
});
test('B02 Erster Sieg', async () => {
  const a1 = await awardsOf(D({ games: [G(1), G(2)], players: [P('g1', 'a', 2), P('g1', 'b', 1), P('g2', 'a', 1), P('g2', 'b', 2)] }));
  assert.deepEqual(a1.filter((a) => a.memberId === 'a' && a.badgeId === 'erster-sieg').map((a) => a.gameId), ['g2']);
  const a2 = await awardsOf(D({ games: [G(1), G(2)], players: [P('g1', 'a', 2), P('g1', 'b', 1), P('g2', 'a', 3), P('g2', 'b', 1)] }));
  assert.ok(!has(a2, 'a', 'erster-sieg'));
});
test('B03 Erstes Blut: eliminatedBy; Aufgabe (null) schreibt niemandem gut', async () => {
  const a1 = await awardsOf(D({ games: [G(1)], players: [P('g1', 'a', 1), P('g1', 'b', 2, 'a')] }));
  assert.ok(has(a1, 'a', 'erstes-blut', 'g1'));
  const a2 = await awardsOf(D({ games: [G(1)], players: [P('g1', 'a', 1), P('g1', 'b', 2, null)] }));
  assert.equal(a2.filter((a) => a.badgeId === 'erstes-blut').length, 0);
});
test('B04 Comeback: Sieg + Minimum < 5 (wirksam)', async () => {
  const data = oneGame();
  const run = async (evs) => awardsOf(data, { g1: await factsFor(evs) });
  assert.ok(has(await run([ev(1, 'damage', 'b', 'a', 36)]), 'a', 'comeback', 'g1'), 'min 4');
  assert.ok(!has(await run([ev(1, 'damage', 'b', 'a', 35)]), 'a', 'comeback'), 'min 5');
  assert.ok(!has(await run([ev(1, 'damage', 'b', 'a', 37), ev(2, 'undo', null, null, null, { seq: 1 })]), 'a', 'comeback'), 'rückgängig');
});
test('B05 Auf Messers Schneide: Sieg mit finalLife 1', async () => {
  const a1 = await awardsOf(oneGame({}, [P('g1', 'a', 1, null, 1), P('g1', 'b', 2, 'a', 0)]));
  assert.ok(has(a1, 'a', 'messers-schneide', 'g1'));
  const a2 = await awardsOf(oneGame({}, [P('g1', 'a', 1, null, 2), P('g1', 'b', 2, 'a', 0)]));
  assert.ok(!has(a2, 'a', 'messers-schneide'));
  const a3 = await awardsOf(oneGame({}, [P('g1', 'a', 1, null, 5), P('g1', 'b', 2, null, 1)]));
  assert.ok(!has(a3, 'b', 'messers-schneide'));
});
test('B06 Unberührbar: Minimum ≥ ceil(0,75 × Startleben)', async () => {
  const run = async (life, dmg) => {
    const data = oneGame(life === undefined ? { startingLife: undefined } : { startingLife: life });
    return has(await awardsOf(data, { g1: await factsFor([ev(1, 'damage', 'b', 'a', dmg)], { startingLife: life ?? 40 }) }), 'a', 'unberuehrbar');
  };
  assert.equal(await run(40, 10), true, '40/30'); assert.equal(await run(40, 11), false, '40/29');
  assert.equal(await run(30, 7), true, '30/23'); assert.equal(await run(30, 8), false, '30/22');
  assert.equal(await run(20, 5), true, '20/15'); assert.equal(await run(20, 6), false, '20/14');
  assert.equal(await run(undefined, 10), true, 'Startleben fehlt ⇒ 40');
});
test('B07 Commander-Henker: Verursacher = gewählte Quelle, Zustand unmittelbar davor', async () => {
  const data = oneGame();
  const run = async (evs) => awardsOf(data, { g1: await factsFor(evs) });
  assert.ok(has(await run([ev(1, 'cmd_damage', 'a', 'b', 21, { partner: false }), ev(2, 'eliminate', 'a', 'b')]), 'a', 'commander-henker'), 'F5');
  assert.ok(!has(await run([ev(1, 'cmd_damage', 'a', 'b', 20, { partner: false }), ev(2, 'cmd_damage', 'a', 'b', 20, { partner: true }), ev(3, 'damage', 'c', 'b', 10), ev(4, 'eliminate', 'a', 'b')]), 'a', 'commander-henker'), 'F6');
  assert.ok(has(await run([ev(1, 'cmd_damage', 'a', 'b', 21, { partner: true }), ev(2, 'eliminate', 'a', 'b')]), 'a', 'commander-henker'), 'F6-Variante');
  const other = await run([ev(1, 'cmd_damage', 'a', 'b', 21, { partner: false }), ev(2, 'eliminate', 'c', 'b')]);
  assert.equal(other.filter((x) => x.badgeId === 'commander-henker').length, 0, 'src c: weder a noch c');
  assert.ok(!has(await run([ev(1, 'cmd_damage', 'a', 'b', 21, { partner: false }), ev(2, 'undo', null, null, null, { seq: 1 }), ev(3, 'damage', 'a', 'b', 40), ev(4, 'eliminate', 'a', 'b')]), 'a', 'commander-henker'), 'rückgängig');
});
test('B08 Giftmischer', async () => {
  const data = oneGame();
  const run = async (evs) => awardsOf(data, { g1: await factsFor(evs) });
  assert.ok(has(await run([ev(1, 'poison', null, 'b', 10), ev(2, 'eliminate', 'a', 'b')]), 'a', 'giftmischer'), 'F7');
  assert.ok(!has(await run([ev(1, 'poison', null, 'b', 9), ev(2, 'damage', 'c', 'b', 40), ev(3, 'eliminate', 'a', 'b')]), 'a', 'giftmischer'), 'F7-Variante');
  const none = await run([ev(1, 'poison', 'a', 'b', 10), ev(2, 'eliminate', null, 'b')]);
  assert.equal(none.filter((x) => x.badgeId === 'giftmischer').length, 0, 'src null');
});
test('B09 Doppelschlag: zwei K.O. im selben Zug', async () => {
  const data = oneGame();
  const run = async (evs) => awardsOf(data, { g1: await factsFor(evs) });
  const te = (s) => ev(s, 'turn_end', null, 'a', null, { seconds: 1, at: s });
  assert.ok(has(await run([ev(1, 'eliminate', 'a', 'b'), ev(2, 'eliminate', 'a', 'c')]), 'a', 'doppelschlag'));
  assert.ok(!has(await run([ev(1, 'eliminate', 'a', 'b'), te(2), ev(3, 'eliminate', 'a', 'c')]), 'a', 'doppelschlag'));
  assert.ok(!has(await run([ev(1, 'eliminate', 'a', 'b'), ev(2, 'eliminate', 'a', 'c'), ev(3, 'undo', null, null, null, { seq: 2 }), te(4), ev(5, 'eliminate', 'a', 'c')]), 'a', 'doppelschlag'));
});
test('B10 Blitzsieg: Runde 6 ja, 7 nein', async () => {
  assert.ok(has(await awardsOf(oneGame({ round: 6 })), 'a', 'blitzsieg'));
  assert.ok(!has(await awardsOf(oneGame({ round: 7 })), 'a', 'blitzsieg'));
});
test('B11 Königsmörder: Ranglistenerste vor der Partie, entfernte zählen, Gleichstand ⇒ alle Ersten', async () => {
  const two = (rows) => D({ games: [G(1), G(2)], players: rows });
  const base = [P('g1', 'b', 1), P('g1', 'a', 2)];
  assert.ok(has(await awardsOf(two([...base, P('g2', 'a', 1), P('g2', 'b', 2, 'a')])), 'a', 'koenigsmoerder', 'g2'), 'ja (g2)');
  assert.ok(!has(await awardsOf(two([...base, P('g2', 'a', 1), P('g2', 'b', 2), P('g2', 'c', 3, 'a')])), 'a', 'koenigsmoerder'), 'c ist nicht Erster');
  assert.ok(!has(await awardsOf(D({ games: [G(1)], players: [P('g1', 'b', 2, 'a'), P('g1', 'a', 1)] })), 'a', 'koenigsmoerder'), 'in g1 selbst: leere Vorgeschichte');
  const rem = D({ games: [G(1), G(2)], players: [P('g1', 'r', 1), P('g1', 'a', 2), P('g2', 'a', 1), P('g2', 'r', 2, 'a')], members: [M('a'), M('r', { removed: true })] });
  assert.ok(has(await awardsOf(rem), 'a', 'koenigsmoerder', 'g2'), 'entfernt ⇒ ja');
  const tie = D({ games: [G(1), G(2), G(3)], players: [P('g1', 'b', 1), P('g1', 'a', 2), P('g2', 'c', 1), P('g2', 'a', 2), P('g3', 'a', 1), P('g3', 'c', 2, 'a')] });
  assert.ok(has(await awardsOf(tie), 'a', 'koenigsmoerder', 'g3'), 'Gleichstand b/c ⇒ c ist Erster');
});
test('B12 Rache: Erzfeind vor der Partie (≥ 2, Gleichstand ⇒ zuletzt)', async () => {
  const a1 = await awardsOf(D({ games: [G(1), G(2), G(3)], players: [P('g1', 'b', 1), P('g1', 'a', 2, 'b'), P('g2', 'b', 1), P('g2', 'a', 2, 'b'), P('g3', 'a', 1), P('g3', 'b', 2, 'a')] }));
  assert.deepEqual(a1.filter((a) => a.badgeId === 'rache').map((a) => `${a.memberId}:${a.gameId}`), ['a:g3']);
  const a2 = await awardsOf(D({ games: [G(1), G(3)], players: [P('g1', 'b', 1), P('g1', 'a', 2, 'b'), P('g3', 'a', 1), P('g3', 'b', 2, 'a')] }));
  assert.ok(!has(a2, 'a', 'rache'), 'nur einmal ⇒ kein Erzfeind');
  const a3 = await awardsOf(D({ games: [G(1), G(2), G(3), G(4)], players: [
    P('g1', 'b', 1), P('g1', 'a', 2, 'b'), P('g2', 'c', 1), P('g2', 'a', 2, 'c'), P('g3', 'c', 1), P('g3', 'a', 2, 'c'),
    P('g4', 'a', 1), P('g4', 'b', 2, 'a'), P('g4', 'c', 3)] }));
  assert.ok(!has(a3, 'a', 'rache'), 'Erzfeind c, a schaltet b aus ⇒ nein');
});
test('B13 Lebensquell: brutto ≥ 30, wirksam', async () => {
  const data = oneGame();
  const run = async (evs) => has(await awardsOf(data, { g1: await factsFor(evs) }), 'a', 'lebensquell');
  assert.equal(await run([ev(1, 'life', null, 'a', 10), ev(2, 'life', null, 'a', 10), ev(3, 'lifelink', 'a', 'a', 10)]), true);
  assert.equal(await run([ev(1, 'life', null, 'a', 29)]), false);
  assert.equal(await run([ev(1, 'life', null, 'a', 30), ev(2, 'undo', null, null, null, { seq: 1 })]), false);
  assert.equal(await run([ev(1, 'life', null, 'a', 30), ev(2, 'life', null, 'a', -20)]), true);
});

/** n Partien von a (Platz nach `places`), Gegner b; Decks optional */
function series(places, { decks = null, extraNull = 0 } = {}) {
  const games = []; const players = [];
  places.forEach((pl, i) => {
    const g = G(i + 1); games.push(g);
    players.push(P(g.id, 'a', pl, null, null, decks ? decks[i] : null, 0));
    players.push(P(g.id, 'b', pl === 1 ? 2 : 1, null, null, null, 1));
  });
  for (let k = 0; k < extraNull; k++) {
    const g = G(places.length + k + 1); games.push(g);
    players.push(P(g.id, 'a', null), P(g.id, 'b', 1, null, null, null, 1));
  }
  return D({ games, players });
}
test('B14 Stammgast: 9 ⇒ 0 (9/10) · 10 ⇒ I in der 10. · 50 ⇒ II · 100 ⇒ III, next null · Platz null zählt nicht', async () => {
  let s = await stateOf(series(Array(9).fill(2)), {}, 'a', 'stammgast');
  assert.equal(s.tier, 0); assert.equal(s.value, 9); assert.equal(s.next, 10); assert.equal(s.earned, false);
  s = await stateOf(series(Array(9).fill(2), { extraNull: 3 }), {}, 'a', 'stammgast');
  assert.equal(s.value, 9, 'Platz null zählt nicht');
  s = await stateOf(series(Array(10).fill(2)), {}, 'a', 'stammgast');
  assert.equal(s.tier, 1); assert.equal(s.tierGames[0], 'g10'); assert.equal(s.next, 50); assert.equal(s.earned, true);
  s = await stateOf(series(Array(50).fill(2)), {}, 'a', 'stammgast');
  assert.equal(s.tier, 2); assert.equal(s.tierGames[1], 'g50'); assert.equal(s.next, 100);
  s = await stateOf(series(Array(100).fill(2)), {}, 'a', 'stammgast');
  assert.equal(s.tier, 3); assert.equal(s.tierGames[2], 'g100'); assert.equal(s.next, null); assert.equal(s.value, 100);
});
test('B15 Siegertyp: 4 ⇒ 0 · 5 ⇒ I in der Partie des 5. Sieges', async () => {
  let s = await stateOf(series([1, 2, 1, 1, 1]), {}, 'a', 'siegertyp');
  assert.equal(s.tier, 0); assert.equal(s.value, 4);
  s = await stateOf(series([1, 2, 1, 1, 2, 1, 1]), {}, 'a', 'siegertyp');
  assert.equal(s.tier, 1); assert.equal(s.tierGames[0], 'g7');
});
test('B16 Siegesserie: S S N S S S ⇒ I in der 6. · S S N S S ⇒ 0, value 2', async () => {
  let s = await stateOf(series([1, 1, 2, 1, 1, 1]), {}, 'a', 'serie');
  assert.equal(s.tier, 1); assert.equal(s.tierGames[0], 'g6');
  s = await stateOf(series([1, 1, 2, 1, 1]), {}, 'a', 'serie');
  assert.equal(s.tier, 0); assert.equal(s.value, 2);
});
test('B17 Deckbauer: d1 d2 d2 d3 ⇒ I in der 4. · d1 d1 null d2 ⇒ 0, value 2', async () => {
  let s = await stateOf(series([2, 2, 2, 2], { decks: ['d1', 'd2', 'd2', 'd3'] }), {}, 'a', 'deckbauer');
  assert.equal(s.tier, 1); assert.equal(s.tierGames[0], 'g4');
  s = await stateOf(series([2, 2, 2, 2], { decks: ['d1', 'd1', null, 'd2'] }), {}, 'a', 'deckbauer');
  assert.equal(s.tier, 0); assert.equal(s.value, 2);
});

/** Abende: je Abend k Partien, Start 18:00/19:00/20:00 am Tag `day`; `wins[i]` = gewinnt a die i-te Partie */
function eveningsData(list) {
  const games = []; const players = []; const sessions = [];
  list.forEach(({ wins, sessionId = `s${sessions.length + 1}`, skipA = [] }, e) => {
    if (sessionId) sessions.push({ id: sessionId, playedOn: `2026-10-${String(e + 1).padStart(2, '0')}`, location: null });
    wins.forEach((w, i) => {
      const t = Date.UTC(2026, 9, 1 + e, 18 + i);
      const g = { ...G(1), id: `e${e + 1}g${i + 1}`, sessionId, startedAt: iso(t), endedAt: iso(t + 0.5 * HOUR) };
      games.push(g);
      if (!skipA.includes(i)) players.push(P(g.id, 'a', w ? 1 : 2, null, null, null, 0));
      players.push(P(g.id, 'b', w && !skipA.includes(i) ? 2 : 1, null, null, null, 1));
    });
  });
  return D({ games, players, sessions, members: [M('a'), M('b')] });
}
test('B18 Abendkönig: alle Partien (≥ 2), nur abgeschlossene Abende (6 h nach dem letzten Start)', async () => {
  const two = eveningsData([{ wins: [true, true] }]);
  const g2Start = Date.UTC(2026, 9, 1, 19);
  assert.ok(has(await awardsOf(two, {}, iso(g2Start + 6 * HOUR)), 'a', 'abendkoenig', 'e1g2'), '6 h ⇒ ja in g2');
  assert.ok(!has(await awardsOf(two, {}, iso(g2Start + 6 * HOUR - 60000)), 'a', 'abendkoenig'), '5 h 59 ⇒ nein');
  assert.ok(!has(await awardsOf(eveningsData([{ wins: [true] }])), 'a', 'abendkoenig'), 'nur eine Partie');
  assert.ok(!has(await awardsOf(eveningsData([{ wins: [true, true, false] }])), 'a', 'abendkoenig'), '2 von 3');
  assert.ok(!has(await awardsOf(eveningsData([{ wins: [true, true, true], skipA: [2] }])), 'a', 'abendkoenig'), 'g3 nicht mitgespielt');
  assert.ok(!has(await awardsOf(eveningsData([{ wins: [true, true], sessionId: null }])), 'a', 'abendkoenig'), 'ohne Abend');
  const three = eveningsData([{ wins: [true, true] }, { wins: [true, false] }, { wins: [true, true] }, { wins: [true, true, true] }]);
  const s = await stateOf(three, {}, 'a', 'abendkoenig');
  assert.equal(s.tier, 2); assert.equal(s.tierGames[1], 'e4g3'); assert.equal(s.tierGames[0], 'e1g2');
});
test('B19 Salzbergwerk: ≥ 2 bewertete Decks, Deck des Siegers allein vorn', async () => {
  const rows = [P('g1', 'a', 1, null, 5, 'da', 0), P('g1', 'b', 2, null, 0, 'db', 1), P('g1', 'c', 3, null, 0, 'dc', 2)];
  const mk = (deckSalt, x = {}) => D({ games: [G(1)], players: x.rows || rows, deckSalt, ratings: x.ratings || [] });
  const dsr = (rater, deck, salt) => ({ gameId: 'g1', raterId: rater, deckId: deck, salt });
  assert.ok(has(await awardsOf(mk([dsr('b', 'da', 5), dsr('b', 'db', 2)])), 'a', 'salzbergwerk', 'g1'), 'ja');
  assert.ok(!has(await awardsOf(mk([dsr('b', 'da', 4), dsr('b', 'db', 4)])), 'a', 'salzbergwerk'), 'geteilt');
  assert.ok(!has(await awardsOf(mk([dsr('b', 'da', 5)])), 'a', 'salzbergwerk'), 'nur ein Deck');
  const cWins = [P('g1', 'a', 2, null, 0, 'da', 0), P('g1', 'b', 3, null, 0, 'db', 1), P('g1', 'c', 1, null, 5, 'dc', 2)];
  assert.ok(!has(await awardsOf(mk([dsr('b', 'da', 5), dsr('b', 'db', 2)], { rows: cWins })), 'a', 'salzbergwerk'), 'c gewinnt');
  const sub = [P('g1', 'a', 1, null, 5, 'da', 0), P('g1', 'b', 3, 'a', 0, 'db', 1), P('g1', 'c', 2, null, 0, 'dc', 2)];
  const ratings = [{ gameId: 'g1', memberId: 'b', salt: 5, fun: null, deckRating: null }];
  assert.ok(has(await awardsOf(mk([dsr('c', 'db', 2)], { rows: sub, ratings })), 'a', 'salzbergwerk'), 'Ersatzstimme');
});
test('B20 Nachteule: Ende in Berlin in [02:00, 06:00), Sommer- und Winterzeit, jeder Teilnehmer', async () => {
  const run = async (endedAt) => awardsOf(oneGame({ endedAt }));
  const all = (aw) => ['a', 'b', 'c'].every((m) => has(aw, m, 'nachteule', 'g1'));
  const none = (aw) => !aw.some((x) => x.badgeId === 'nachteule');
  assert.ok(all(await run('2026-11-07T01:30:00Z')), '02:30 MEZ');
  assert.ok(none(await run('2026-11-07T00:59:00Z')), '01:59 MEZ');
  assert.ok(all(await run('2026-07-04T00:30:00Z')), '02:30 MESZ');
  assert.ok(none(await run('2026-11-07T05:00:00Z')), '06:00 MEZ');
  assert.ok(none(await run(null)), 'endedAt null');
});
test('B21 Glückspilz: dreimal in Folge Startwurf; ohne Wurf überspringen, unbekannt/Fehler setzt zurück', async () => {
  const data = (n) => D({ games: Array.from({ length: n }, (_, i) => G(i + 1)), players: Array.from({ length: n }, (_, i) => [P(`g${i + 1}`, 'a', 1, null, null, null, 0), P(`g${i + 1}`, 'b', 2, null, null, null, 1)]).flat() });
  const roll = (seat) => factsFor([ev(1, 'roll', null, null, null, { kind: 'start', winner_seat: seat })], { players: [{ memberId: 'a', seat: 0 }, { memberId: 'b', seat: 1 }] });
  const noRoll = () => factsFor([ev(1, 'life', null, 'a', 1)], { players: [{ memberId: 'a', seat: 0 }, { memberId: 'b', seat: 1 }] });
  const A = await roll(0); const Bb = await roll(1); const N = await noRoll();
  const NONE = { v: 1, ok: false, reason: 'none' }; const ERR = { v: 1, ok: false, reason: 'error' };
  assert.ok(has(await awardsOf(data(3), { g1: A, g2: A, g3: A }), 'a', 'gluckspilz', 'g3'), 'drei in Folge');
  assert.ok(has(await awardsOf(data(4), { g1: A, g2: N, g3: A, g4: A }), 'a', 'gluckspilz', 'g4'), 'ohne Startwurf übersprungen');
  assert.ok(has(await awardsOf(data(4), { g1: A, g2: NONE, g3: A, g4: A }), 'a', 'gluckspilz', 'g4'), 'none übersprungen');
  assert.ok(!has(await awardsOf(data(4), { g1: A, g2: Bb, g3: A, g4: A }), 'a', 'gluckspilz'), 'b dazwischen');
  assert.ok(!has(await awardsOf(data(4), { g1: A, g3: A, g4: A }), 'a', 'gluckspilz'), 'Fakten fehlen');
  assert.ok(!has(await awardsOf(data(4), { g1: A, g2: ERR, g3: A, g4: A }), 'a', 'gluckspilz'), 'error');
});

// ---------------------------------------------------------------------------
// G · Grenzfälle

test('G1 zwei Erste ⇒ beide Erster Sieg', async () => {
  const aw = await awardsOf(D({ games: [G(1)], players: [P('g1', 'a', 1), P('g1', 'b', 1)] }));
  assert.ok(has(aw, 'a', 'erster-sieg') && has(aw, 'b', 'erster-sieg'));
});
test('G2 Platzhalter wie jedes Mitglied', async () => {
  const aw = await awardsOf(D({ games: [G(1)], players: [P('g1', 'x', 1), P('g1', 'a', 2)], members: [M('x', { isPlaceholder: true }), M('a')] }));
  assert.ok(has(aw, 'x', 'erster-sieg', 'g1'));
});
test('G3 entfernt: Abzeichen wie zuvor, 21 Zustände', async () => {
  const { memberBadges } = await B();
  const data = D({ games: [G(1)], players: [P('g1', 'r', 1), P('g1', 'a', 2)], members: [M('r', { removed: true }), M('a')] });
  const st = memberBadges(data, {}, 'r', { now: NOW });
  assert.equal(st.length, 21);
  assert.ok(st.find((s) => s.id === 'erster-sieg').earned);
});
test('G4 Replay ohne Fakten: Comeback nicht, Erster Sieg ja', async () => {
  const aw = await awardsOf(oneGame(), {});
  assert.ok(!has(aw, 'a', 'comeback')); assert.ok(has(aw, 'a', 'erster-sieg'));
});
test('G5 laufendes Spiel zählt nicht', async () => {
  const aw = await awardsOf(D({ games: [G(1, { status: 'live' })], players: [P('g1', 'a', 1), P('g1', 'b', 2)] }));
  assert.deepEqual(aw, []);
});
test('G6 unbekanntes Mitglied ⇒ 21 offene Zustände, kein Wurf', async () => {
  const { memberBadges } = await B();
  const st = memberBadges(fixtureGroupData(), {}, 'zz', { now: NOW });
  assert.equal(st.length, 21); assert.ok(st.every((s) => !s.earned && s.tier === 0));
});
test('G7 leere Gruppe ⇒ awards []', async () => {
  const { badgeAwards } = await B();
  const { emptyGroupData } = await import('../../src/lib/history-data.js');
  assert.deepEqual(badgeAwards(emptyGroupData('G'), {}, { now: NOW }).awards, []);
});
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
test('G8 Eingabe unberührt: tief eingefroren, kein Wurf, JSON vorher = nachher', async () => {
  const { badgeAwards, memberBadges, gameBadges, sessionBadges, gameFacts } = await B();
  const data = fixtureGroupData();
  const facts = { g1: await factsFor(PROBE_EVENTS, { players: G1_SEATS }) };
  const before = JSON.stringify([data, facts]);
  deepFreeze(data); deepFreeze(facts);
  const evs = deepFreeze(PROBE_EVENTS.map((e) => ({ ...e, payload: { ...e.payload } })));
  assert.doesNotThrow(() => {
    gameFacts({ players: deepFreeze(G1_SEATS.map((p) => ({ ...p }))), startingLife: 40, events: evs });
    badgeAwards(data, facts, { now: NOW });
    memberBadges(data, facts, 'm-M', { now: NOW });
    gameBadges(data, facts, 'g1', { now: NOW });
    sessionBadges(data, facts, 's2', { now: NOW });
  });
  assert.equal(JSON.stringify([data, facts]), before);
});

// ---------------------------------------------------------------------------
// X · Gleichheit mit stats.js (Fixture ohne Fakten; Sollwerte von Hand, „Probe-Sollwerte“)

test('X1 Königsmörder: genau F g2, M g5, D g4, L g3', async () => {
  const aw = await awardsOf(fixtureGroupData());
  assert.deepEqual(aw.filter((a) => a.badgeId === 'koenigsmoerder').map((a) => `${a.memberId}:${a.gameId}`).sort(), ['m-D:g4', 'm-F:g2', 'm-L:g3', 'm-M:g5']);
});
test('X2 Rache: genau L g3, M g1', async () => {
  const aw = await awardsOf(fixtureGroupData());
  assert.deepEqual(aw.filter((a) => a.badgeId === 'rache').map((a) => `${a.memberId}:${a.gameId}`).sort(), ['m-L:g3', 'm-M:g1']);
});
test('X3 Salzbergwerk: genau M g5, D g4', async () => {
  const aw = await awardsOf(fixtureGroupData());
  assert.deepEqual(aw.filter((a) => a.badgeId === 'salzbergwerk').map((a) => `${a.memberId}:${a.gameId}`).sort(), ['m-D:g4', 'm-M:g5']);
});
test('X4 Zählwerte = memberProfile (games/wins/longestStreak) und Handwerte', async () => {
  const { badgeAwards } = await B();
  const { memberProfile } = await S();
  const data = fixtureGroupData();
  const { progress } = badgeAwards(data, {}, { now: NOW });
  const hand = { 'm-F': [6, 2, 1], 'm-M': [6, 2, 1], 'm-L': [6, 1, 1], 'm-D': [6, 1, 1], 'm-T': [1, 0, 0] };
  for (const [m, [g, w, s]] of Object.entries(hand)) {
    const mp = memberProfile(data, m);
    assert.deepEqual([progress[m].games, progress[m].wins, progress[m].streak], [mp.games, mp.wins, mp.longestStreak], `${m} = memberProfile`);
    assert.deepEqual([progress[m].games, progress[m].wins, progress[m].streak], [g, w, s], `${m} Hand`);
  }
});

// ---------------------------------------------------------------------------
// N · „Neu“ (gameBadges) und A · Abend (sessionBadges)

// Probe-Ereignisse g1 (Sitze F0, L1, M2, D3)
const G1_SEATS = [{ memberId: 'm-F', seat: 0 }, { memberId: 'm-L', seat: 1 }, { memberId: 'm-M', seat: 2 }, { memberId: 'm-D', seat: 3 }];
const PROBE_EVENTS = [
  ev(1, 'roll', null, null, null, { kind: 'start', values: [], winner_seat: 2 }),
  ev(2, 'damage', 'm-F', 'm-M', 37), ev(3, 'lifelink', 'm-M', 'm-M', 30), ev(4, 'damage', 'm-D', 'm-L', 40),
  ev(5, 'eliminate', 'm-D', 'm-L', null, { place: 4 }), ev(6, 'turn_end', null, 'm-M', null, { seconds: 30, at: 1 }),
  ev(7, 'cmd_damage', 'm-M', 'm-F', 21, { partner: false }), ev(8, 'eliminate', 'm-M', 'm-F', null, { place: 3 }),
  ev(9, 'poison', 'm-M', 'm-D', 10), ev(10, 'eliminate', 'm-M', 'm-D', null, { place: 2 }),
];
async function probeFacts({ without = [] } = {}) {
  const NONE = { v: 1, ok: false, reason: 'none' };
  const f = { g1: await factsFor(PROBE_EVENTS, { players: G1_SEATS }), g2: NONE, g3: NONE, g4: NONE, g5: NONE, g6: NONE };
  for (const g of without) delete f[g];
  return f;
}
const short = (items) => items.map((x) => `${x.memberId}:${x.badgeId}${x.tier ? `:${x.tier}` : ''}`);

test('Probe-Fakten g1 = Handrechnung (M min 3, gained 30, drei K.O.)', async () => {
  const f = await factsFor(PROBE_EVENTS, { players: G1_SEATS });
  assert.equal(f.min['m-M'], 3); assert.equal(f.gained['m-M'], 30); assert.equal(f.startWinner, 'm-M');
  assert.deepEqual(f.kos, [
    { target: 'm-L', source: 'm-D', turn: 0, cmd21: false, poison10: false },
    { target: 'm-F', source: 'm-M', turn: 1, cmd21: true, poison10: false },
    { target: 'm-D', source: 'm-M', turn: 1, cmd21: false, poison10: true },
  ]);
});
test('N1 Fixture g1 ohne Fakten ⇒ [M rache]', async () => {
  const { gameBadges } = await B();
  assert.deepEqual(gameBadges(fixtureGroupData(), {}, 'g1', { now: NOW }), [{ memberId: 'm-M', badgeId: 'rache', tier: null }]);
});
test('N2 Fixture g6 ohne Fakten (Reihenfolge Platz, Katalog)', async () => {
  const { gameBadges } = await B();
  assert.deepEqual(short(gameBadges(fixtureGroupData(), {}, 'g6', { now: NOW })), [
    'm-F:erste-runde', 'm-F:erster-sieg', 'm-F:erstes-blut', 'm-M:erste-runde', 'm-M:erstes-blut', 'm-L:erste-runde', 'm-D:erste-runde']);
});
test('N3 Fixture g1 mit Probe-Fakten ⇒ M comeback, commander-henker, giftmischer, doppelschlag, rache, lebensquell', async () => {
  const { gameBadges } = await B();
  assert.deepEqual(short(gameBadges(fixtureGroupData(), await probeFacts(), 'g1', { now: NOW })), [
    'm-M:comeback', 'm-M:commander-henker', 'm-M:giftmischer', 'm-M:doppelschlag', 'm-M:rache', 'm-M:lebensquell']);
});
test('N4 Vollständigkeit: Fakten von g5 fehlen ⇒ M nur rache', async () => {
  const { gameBadges } = await B();
  assert.deepEqual(short(gameBadges(fixtureGroupData(), await probeFacts({ without: ['g5'] }), 'g1', { now: NOW })), ['m-M:rache']);
});
test('N5 stabil: späteres Spiel ändert „Neu“ von g1 nicht', async () => {
  const { gameBadges } = await B();
  const data = fixtureGroupData();
  data.games.push({ ...data.games.find((g) => g.id === 'g1'), id: 'g0', sessionId: null, startedAt: '2026-11-08T19:30:00+01:00', endedAt: '2026-11-08T20:30:00+01:00' });
  data.players.push(P('g0', 'm-F', 1, null, 5, 'd-atraxa', 0), P('g0', 'm-M', 2, 'm-F', 0, 'd-kinnan', 1));
  assert.deepEqual(gameBadges(data, {}, 'g1', { now: NOW }), [{ memberId: 'm-M', badgeId: 'rache', tier: null }]);
});
test('N6 Abend offen: ohne abendkoenig bis 6 h nach dem letzten Start', async () => {
  const { gameBadges } = await B();
  const data = eveningsData([{ wins: [true, true] }]);
  const g2 = Date.UTC(2026, 9, 1, 19);
  assert.ok(!gameBadges(data, {}, 'e1g2', { now: g2 + HOUR }).some((x) => x.badgeId === 'abendkoenig'));
  assert.ok(gameBadges(data, {}, 'e1g2', { now: g2 + 7 * HOUR }).some((x) => x.badgeId === 'abendkoenig' && x.memberId === 'a' && x.tier === 1));
});
test('A1 s1 ohne Fakten ⇒ 9 Einträge', async () => {
  const { sessionBadges } = await B();
  const got = sessionBadges(fixtureGroupData(), {}, 's1', { now: NOW });
  assert.deepEqual(got.map((x) => `${x.gameId}:${x.memberId}:${x.badgeId}`), [
    'g4:m-D:erster-sieg', 'g4:m-D:erstes-blut', 'g4:m-D:blitzsieg', 'g4:m-D:koenigsmoerder', 'g4:m-D:salzbergwerk',
    'g3:m-L:erster-sieg', 'g3:m-L:koenigsmoerder', 'g3:m-L:rache', 'g2:m-F:koenigsmoerder']);
});
test('A2 s2 ohne Fakten ⇒ 12 Einträge', async () => {
  const { sessionBadges } = await B();
  const got = sessionBadges(fixtureGroupData(), {}, 's2', { now: NOW });
  assert.deepEqual(got.map((x) => `${x.gameId}:${x.memberId}:${x.badgeId}`), [
    'g6:m-F:erste-runde', 'g6:m-F:erster-sieg', 'g6:m-F:erstes-blut', 'g6:m-M:erste-runde', 'g6:m-M:erstes-blut', 'g6:m-L:erste-runde', 'g6:m-D:erste-runde',
    'g5:m-M:erster-sieg', 'g5:m-M:koenigsmoerder', 'g5:m-M:salzbergwerk', 'g5:m-L:erstes-blut', 'g5:m-T:erste-runde']);
});
test('A3 s0 mit Probe-Fakten ⇒ die 6 Einträge aus N3', async () => {
  const { sessionBadges } = await B();
  const got = sessionBadges(fixtureGroupData(), await probeFacts(), 's0', { now: NOW });
  assert.deepEqual(got.map((x) => `${x.gameId}:${x.memberId}:${x.badgeId}`), [
    'g1:m-M:comeback', 'g1:m-M:commander-henker', 'g1:m-M:giftmischer', 'g1:m-M:doppelschlag', 'g1:m-M:rache', 'g1:m-M:lebensquell']);
});
test('Profil-Sollwerte PR1–PR3 (memberBadges, Probe-Fakten)', async () => {
  const { memberBadges } = await B();
  const data = fixtureGroupData(); const facts = await probeFacts();
  const earned = (m) => memberBadges(data, facts, m, { now: NOW }).filter((s) => s.earned).map((s) => `${s.id}:${s.gameId}`);
  assert.deepEqual(earned('m-F'), ['erste-runde:g6', 'erster-sieg:g6', 'erstes-blut:g6', 'koenigsmoerder:g2']);
  assert.deepEqual(earned('m-M').sort(), ['erste-runde:g6', 'erstes-blut:g6', 'erster-sieg:g5', 'koenigsmoerder:g5', 'salzbergwerk:g5',
    'rache:g1', 'comeback:g1', 'commander-henker:g1', 'giftmischer:g1', 'doppelschlag:g1', 'lebensquell:g1'].sort());
  assert.deepEqual(earned('m-D').sort(), ['erste-runde:g6', 'erster-sieg:g4', 'erstes-blut:g4', 'blitzsieg:g4', 'koenigsmoerder:g4', 'salzbergwerk:g4'].sort());
  assert.deepEqual(earned('m-T'), ['erste-runde:g5']);
  const f = memberBadges(data, facts, 'm-F', { now: NOW });
  const prog = (id) => { const s = f.find((x) => x.id === id); return `${s.value}/${s.next}`; };
  assert.deepEqual(['stammgast', 'siegertyp', 'serie', 'deckbauer', 'abendkoenig'].map(prog), ['6/10', '2/5', '1/3', '2/3', '0/1']);
  assert.ok(f.find((x) => x.id === 'nachteule').hidden && f.find((x) => x.id === 'gluckspilz').hidden);
  const k = f.find((x) => x.id === 'koenigsmoerder');
  assert.equal(k.at, '2026-10-31T21:10:00+01:00');
});

// ---------------------------------------------------------------------------
// P · Rechenzeit

/** Fester Startwert (kein Math.random): LCG */
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function syntheticGroup(nGames = 300, seed = 42) {
  const r = lcg(seed);
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const decks = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12'];
  const games = []; const players = []; const sessions = []; const ratings = []; const deckSalt = []; const facts = {};
  for (let i = 0; i < nGames; i++) {
    const t = Date.UTC(2025, 0, 1, 18) + Math.floor(i / 3) * 86400000 + (i % 3) * HOUR;
    const sid = `s${Math.floor(i / 3)}`;
    if (i % 3 === 0) sessions.push({ id: sid, playedOn: iso(t).slice(0, 10), location: null });
    const id = `x${i}`;
    games.push({ id, sessionId: sid, status: 'finished', startedAt: iso(t), endedAt: iso(t + HOUR + Math.floor(r() * 9) * HOUR), round: 3 + Math.floor(r() * 8), wincon: null, note: null, photoPath: null, startingLife: 40, layout: null });
    const n = 4 + Math.floor(r() * 3);
    const pool = ids.slice(); const seated = [];
    for (let k = 0; k < n; k++) seated.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    const order = seated.slice().sort(() => r() - 0.5);
    const evs = []; let seq = 1;
    evs.push({ seq: seq++, type: 'roll', source: null, target: null, amount: null, payload: { kind: 'start', values: [], winner_seat: Math.floor(r() * n) } });
    const winner = order[0];
    order.forEach((m, place0) => {
      const place = place0 + 1;
      const killer = place === 1 ? null : order[Math.floor(r() * place0)] ?? null;
      players.push({ gameId: id, memberId: m, deckId: decks[Math.floor(r() * decks.length)], seat: seated.indexOf(m), place, eliminatedRound: null, eliminatedBy: killer, finalLife: place === 1 ? 1 + Math.floor(r() * 30) : 0 });
      ratings.push({ gameId: id, memberId: m, salt: 1 + Math.floor(r() * 5), fun: 3, deckRating: 3 });
    });
    for (let k = 0; k < 40; k++) {
      const a = order[Math.floor(r() * n)]; const b = order[Math.floor(r() * n)];
      evs.push({ seq: seq++, type: k % 7 === 0 ? 'turn_end' : 'damage', source: a, target: b, amount: 1 + Math.floor(r() * 4), payload: k % 7 === 0 ? { seconds: 30, at: k } : {} });
    }
    for (let place = n; place >= 2; place--) {
      const m = order[place - 1];
      evs.push({ seq: seq++, type: 'eliminate', source: order[Math.floor(r() * (place - 1))], target: m, amount: null, payload: { place } });
    }
    facts[id] = { pending: evs, seats: seated.map((m, s) => ({ memberId: m, seat: s })) };
    for (const m of order) if (r() < 0.5) deckSalt.push({ gameId: id, raterId: m, deckId: players[players.length - 1 - Math.floor(r() * n)].deckId, salt: 1 + Math.floor(r() * 5) });
    void winner;
  }
  return { data: { groupId: 'SYN', members: ids.map((x) => M(x)), decks: [], sessions, games, players, ratings, deckSalt, potg: [], turns: [] }, facts };
}
test('P1 300 Partien × 6 Mitglieder, alle Fakten ⇒ badgeAwards < 3000 ms', async () => {
  const { badgeAwards, gameFacts } = await B();
  const { data, facts: raw } = syntheticGroup();
  const facts = {};
  for (const [g, { pending, seats }] of Object.entries(raw)) facts[g] = gameFacts({ players: seats, startingLife: 40, events: pending });
  assert.ok(Object.values(facts).every((f) => f.ok), 'alle Fakten ok');
  badgeAwards(data, facts, { now: NOW }); // Aufwärmen (JIT), Schutz gegen Ausreißer
  const runs = [];
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); badgeAwards(data, facts, { now: NOW }); runs.push(performance.now() - t0); }
  const best = Math.min(...runs);
  console.log(`P1 badgeAwards 300 Partien: bestes ${best.toFixed(1)} ms, Läufe ${runs.map((x) => x.toFixed(1)).join(' / ')}`);
  assert.ok(best < 3000, `${best} ms`);
});
