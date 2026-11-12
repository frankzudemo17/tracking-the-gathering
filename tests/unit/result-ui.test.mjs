// Spec P20 Kriterium 3 (+ 7): reine Hilfen des Ergebnis-Screens (src/views/result-ui.js), Sollwerte von Hand.
// Jeder Fall lädt das Modul selbst per import() ⇒ ohne die Datei rot (Gegenprobe am Basis-Stand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGroupData, fixtureDamage, ME_MEMBER } from '../fixtures/gruppe.mjs';

const ui = () => import('../../src/views/result-ui.js');

/** loadGame-Form für g1 aus der Fixture (wie tools/preview/preview.mjs). */
function g1() {
  const d = fixtureGroupData();
  const game = d.games.find((g) => g.id === 'g1');
  const mine = (rows) => rows.filter((r) => r.gameId === 'g1');
  return { ...d, game, games: [game], players: mine(d.players), ratings: mine(d.ratings), deckSalt: mine(d.deckSalt), potg: mine(d.potg), damage: fixtureDamage('g1') };
}

test('K3 unbewertet ⇒ alle RPC-Argumente null (außer p_game)', async () => {
  const { initialForm, rateArgs } = await ui();
  const form = initialForm({ game: { id: 'gx', wincon: null, note: null }, ratings: [], deckSalt: [], potg: [] }, 'm-F');
  assert.deepEqual(rateArgs('gx', form, ['d-a', 'd-b']), {
    p_game: 'gx', p_salt: null, p_fun: null, p_deck_rating: null, p_deck_salt: null, p_potg: null, p_potg_text: null,
  });
});

test('K3 Vorbelegung g1 für Franco: Salz 4 · Spaß 3 · Deck 3 · Deck-Salz Kinnan 5/Yuriko 2/Edgar 1 · POTG Marie mit Text · Kombo · Notiz', async () => {
  const { initialForm, rateArgs } = await ui();
  const form = initialForm(g1(), ME_MEMBER);
  assert.equal(form.salt, 4);
  assert.equal(form.fun, 3);
  assert.equal(form.deckRating, 3);
  assert.deepEqual(form.deckSalt, { 'd-kinnan': 5, 'd-yuriko': 2, 'd-edgar': 1 });
  assert.equal(form.potg, 'm-M');
  assert.equal(form.potgText, 'Kinnan plus Basalt Monolith, unendlich Mana in Runde 7.');
  assert.equal(form.wincon, 'kombo');
  assert.equal(form.note, "Marie hat's wieder getan.");
  assert.equal(form.saltiest, null);
  assert.deepEqual(rateArgs('g1', form, ['d-kinnan', 'd-yuriko', 'd-edgar']), {
    p_game: 'g1', p_salt: 4, p_fun: 3, p_deck_rating: 3, p_deck_salt: { 'd-kinnan': 5, 'd-yuriko': 2, 'd-edgar': 1 },
    p_potg: 'm-M', p_potg_text: 'Kinnan plus Basalt Monolith, unendlich Mana in Runde 7.',
  });
});

test('K3 Schnellwahl Salzigstes Deck: X ⇒ 5 + markiert; Wechsel auf Y ⇒ Y 5 + markiert, X nicht markiert, X bleibt 5', async () => {
  const { initialForm, pickSaltiest, setDeckSalt, rateArgs } = await ui();
  let f = initialForm({ game: { id: 'gx' } }, 'm-F');
  f = setDeckSalt(f, 'd-y', 2);
  f = pickSaltiest(f, 'd-x');
  assert.deepEqual(f.deckSalt, { 'd-y': 2, 'd-x': 5 });
  assert.equal(f.saltiest, 'd-x');
  f = pickSaltiest(f, 'd-y');
  assert.equal(f.saltiest, 'd-y');
  assert.deepEqual(f.deckSalt, { 'd-y': 5, 'd-x': 5 });
  assert.deepEqual(rateArgs('gx', f, ['d-x', 'd-y']).p_deck_salt, { 'd-x': 5, 'd-y': 5 });
  // noch einmal auf Y ⇒ Markierung weg, Wert bleibt
  f = pickSaltiest(f, 'd-y');
  assert.equal(f.saltiest, null);
  assert.equal(f.deckSalt['d-y'], 5);
  // Wert eines markierten Decks ändern ⇒ Markierung weg
  f = pickSaltiest(f, 'd-x');
  f = setDeckSalt(f, 'd-x', 3);
  assert.equal(f.saltiest, null);
  assert.equal(f.deckSalt['d-x'], 3);
});

test('K3 Deck-Salz: derselbe Wert noch einmal ⇒ unbewertet; nicht bewertete und fremde Decks werden nicht gesendet', async () => {
  const { initialForm, setDeckSalt, rateArgs } = await ui();
  let f = initialForm({ game: { id: 'gx' } }, 'm-F');
  f = setDeckSalt(f, 'd-a', 4);
  f = setDeckSalt(f, 'd-b', 1);
  f = setDeckSalt(f, 'd-b', 1);
  f = { ...f, deckSalt: { ...f.deckSalt, 'd-eigen': 3 } };
  assert.deepEqual(rateArgs('gx', f, ['d-a', 'd-b']).p_deck_salt, { 'd-a': 4 });
});

test('K3 Deck-Salz geleert, vorher vorhanden ⇒ {} (eigene Zeilen löschen); vorher keins ⇒ null (unverändert)', async () => {
  const { initialForm, setDeckSalt, rateArgs } = await ui();
  let f = initialForm(g1(), ME_MEMBER);
  for (const [d, n] of Object.entries(f.deckSalt)) f = setDeckSalt(f, d, n);
  assert.deepEqual(f.deckSalt, {});
  assert.deepEqual(rateArgs('g1', f, ['d-kinnan', 'd-yuriko', 'd-edgar']).p_deck_salt, {});
  const fresh = initialForm({ game: { id: 'gx' } }, 'm-F');
  assert.equal(rateArgs('gx', fresh, ['d-a']).p_deck_salt, null);
});

test('K3 POTG-Text getrimmt; 200 ok, 201 Zeichen ⇒ Speichern gesperrt; ohne Stimme kein Text', async () => {
  const { initialForm, pickPotg, rateArgs, formCheck } = await ui();
  let f = pickPotg(initialForm({ game: { id: 'gx' } }, 'm-F'), 'm-B');
  f = { ...f, potgText: '   Doubling Season in Runde 4  ' };
  assert.equal(rateArgs('gx', f, []).p_potg_text, 'Doubling Season in Runde 4');
  assert.equal(formCheck({ ...f, potgText: 'x'.repeat(200) }).ok, true);
  const long = formCheck({ ...f, potgText: 'x'.repeat(201) });
  assert.equal(long.potgTooLong, true);
  assert.equal(long.ok, false);
  assert.equal(formCheck({ ...f, potgText: `  ${'x'.repeat(200)}  ` }).ok, true, 'Leerzeichen am Rand zählen nicht');
  assert.equal(rateArgs('gx', { ...f, potgText: '   ' }, []).p_potg_text, null);
  const off = pickPotg(f, 'm-B');
  assert.equal(off.potg, null);
  assert.equal(rateArgs('gx', off, []).p_potg_text, null);
  assert.equal(formCheck({ ...f, note: 'n'.repeat(501) }).noteTooLong, true);
  assert.equal(formCheck({ ...f, note: 'n'.repeat(500) }).ok, true);
});

test('K3 Bild-Verkleinerung: 4000 × 3000 ⇒ 1600 × 1200, 1200 × 1600 bleibt, 3000 × 4000 ⇒ 1200 × 1600', async () => {
  const { fitSize } = await ui();
  assert.deepEqual(fitSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitSize(1200, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitSize(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(0, 600), { width: 0, height: 0 });
});

test('K7 Fehlerabbildung: rate_game-Meldungen ⇒ eigener Text, offline ⇒ offline, Unbekanntes ⇒ null', async () => {
  const { saveErrorKey } = await ui();
  assert.equal(saveErrorKey(new Error('Spiel ist nicht gewertet')), 'notFinished');
  assert.equal(saveErrorKey({ message: 'Nur Mitspieler können bewerten' }), 'notPlayer');
  assert.equal(saveErrorKey({ message: 'Eigenes Deck nicht salzen' }), 'deck');
  assert.equal(saveErrorKey({ message: 'Deck nicht in diesem Spiel' }), 'deck');
  assert.equal(saveErrorKey({ message: 'Spieler nicht in diesem Spiel' }), 'potg');
  assert.equal(saveErrorKey({ message: 'Text zu lang' }), 'tooLong');
  assert.equal(saveErrorKey({ message: 'new row for relation "games" violates check constraint "games_note_len"' }), 'noteTooLong');
  assert.equal(saveErrorKey(new TypeError('Failed to fetch')), 'offline');
  assert.equal(saveErrorKey(new Error('egal'), false), 'offline');
  assert.equal(saveErrorKey(new Error('irgendwas anderes')), null);
});

test('K7 i18n: jeder Fehlerschlüssel hat Text in de und en', async () => {
  const de = (await import('../../src/i18n/de-result.js')).default;
  const en = (await import('../../src/i18n/en-result.js')).default;
  for (const k of ['offline', 'notFinished', 'notPlayer', 'auth', 'range', 'deck', 'potg', 'tooLong', 'noteTooLong']) {
    assert.ok(de.err[k] && en.err[k], `result.err.${k}`);
  }
  assert.deepEqual(Object.values(de.saltWords), ['Tiefenentspannt', 'Leicht gereizt', 'Angesalzen', 'Salzig', 'Komplett versalzen']);
  assert.deepEqual(Object.values(de.funWords), ['Zäh', 'Ganz okay', 'Gut', 'Sehr gut', 'Legendär']);
  assert.deepEqual(Object.values(de.deckWords), ['Lief gar nicht', 'Holprig', 'Solide', 'Stark', 'Hat alles gemacht']);
});

test('saltDecks: nur Decks der anderen, je Deck einmal, ohne eigenes Deck und ohne Spieler ohne Deck', async () => {
  const { saltDecks } = await ui();
  const pl = [
    { memberId: 'A', deckId: 'tymna' }, { memberId: 'B', deckId: 'krenko' }, { memberId: 'J', deckId: 'krenko' },
    { memberId: 'C', deckId: 'tymna' }, { memberId: 'D', deckId: null },
  ];
  assert.deepEqual(saltDecks(pl, 'A'), [{ deckId: 'krenko', memberIds: ['B', 'J'] }]);
  assert.deepEqual(saltDecks(pl, 'B'), [{ deckId: 'tymna', memberIds: ['A', 'C'] }]);
  // 2 Spieler ⇒ genau ein Deck (Negativraum)
  assert.deepEqual(saltDecks([{ memberId: 'A', deckId: 'x' }, { memberId: 'B', deckId: 'y' }], 'A'), [{ deckId: 'y', memberIds: ['B'] }]);
  // g1: Franco salzt Marie/Kinnan, Deniz/Yuriko, Luka/Edgar (Platzierung)
  const d = g1();
  const order = ['m-M', 'm-F', 'm-D', 'm-L'].map((m) => d.players.find((p) => p.memberId === m));
  assert.deepEqual(saltDecks(order, ME_MEMBER).map((x) => x.deckId), ['d-kinnan', 'd-yuriko', 'd-edgar']);
});

test('damageTop: g1 ⇒ 5 Zeilen, D→L 30 (9 Commander) zuerst; höchstens 6', async () => {
  const { damageTop } = await ui();
  const top = damageTop(fixtureDamage('g1'));
  assert.deepEqual(top.map((r) => `${r.source}>${r.target}:${r.damage}/${r.commanderDamage}`),
    ['m-D>m-L:30/9', 'm-M>m-F:25/21', 'm-M>m-D:18/0', 'm-F>m-D:12/0', 'm-L>m-M:6/0']);
  const many = Array.from({ length: 9 }, (_, i) => ({ source: `s${i}`, target: 't', damage: i + 1, commanderDamage: 0, poison: 0 }));
  assert.equal(damageTop(many).length, 6);
  assert.equal(damageTop(many)[0].damage, 9);
  assert.deepEqual(damageTop([{ source: 'a', target: 'b', damage: 0, commanderDamage: 0, poison: 0 }]), []);
});

test('Wincon und Skalen: einfach wählbar, noch einmal ⇒ leer; gamePatch trimmt, leere Notiz ⇒ null', async () => {
  const { initialForm, pickWincon, toggleScore, gamePatch } = await ui();
  let f = initialForm({ game: { id: 'gx' } }, 'm-F');
  f = pickWincon(f, 'kombo');
  assert.equal(f.wincon, 'kombo');
  f = pickWincon(f, 'gift');
  assert.equal(f.wincon, 'gift');
  assert.equal(pickWincon(f, 'gift').wincon, null);
  assert.equal(pickWincon(f, 'quatsch').wincon, null);
  assert.equal(toggleScore(null, 3), 3);
  assert.equal(toggleScore(3, 3), null);
  assert.equal(toggleScore(3, 5), 5);
  assert.deepEqual(gamePatch({ ...f, note: '  Hallo  ' }), { wincon: 'gift', note: 'Hallo' });
  assert.deepEqual(gamePatch({ ...f, wincon: null, note: '   ' }), { wincon: null, note: null });
});

test('Startseite: letzte 3 gewertete Spiele der Fixture g1, g2, g3 (neueste zuerst)', async () => {
  const { recentGames } = await ui();
  assert.deepEqual(recentGames(fixtureGroupData().games).map((g) => g.id), ['g1', 'g2', 'g3']);
  assert.deepEqual(recentGames([{ id: 'a', status: 'live', startedAt: '2026-01-02T00:00:00Z' }]), []);
});

// ---------------------------------------------------------------------------
// P2 Revanche (Welle ttg-features, spec-p2-revanche.md Entscheid 9): formDirty — hat sich am Formular etwas geändert?

test('P2 D1 gleiche Form ⇒ nicht geändert', async () => {
  const { initialForm, formDirty } = await ui();
  const i = initialForm(null, null);
  assert.equal(formDirty(i, i), false);
  assert.equal(formDirty(i, { ...i }), false);
  assert.equal(formDirty(i, { ...i, deckSalt: { ...i.deckSalt } }), false);
});

test('P2 D2 Salz gesetzt ⇒ geändert', async () => {
  const { initialForm, formDirty } = await ui();
  const i = initialForm(null, null);
  assert.equal(formDirty(i, { ...i, salt: 3 }), true);
  assert.equal(formDirty(i, { ...i, fun: 2 }), true);
  assert.equal(formDirty(i, { ...i, deckRating: 5 }), true);
});

test('P2 D3 Notiz nur Leerzeichen ⇒ nicht geändert; Text ⇒ geändert', async () => {
  const { initialForm, formDirty } = await ui();
  const i = initialForm(null, null);
  assert.equal(formDirty(i, { ...i, note: '   ' }), false);
  assert.equal(formDirty(i, { ...i, note: 'x' }), true);
});

test('P2 D4 POTG-Text nur Leerzeichen ⇒ nicht geändert', async () => {
  const { initialForm, formDirty } = await ui();
  const i = initialForm(null, null);
  assert.equal(formDirty(i, { ...i, potgText: '  ' }), false);
  assert.equal(formDirty(i, { ...i, potgText: 'Stark' }), true);
});

test('P2 D5 Deck-Salz setzen ⇒ geändert; derselbe Wert noch einmal (abgewählt) ⇒ nicht geändert', async () => {
  const { initialForm, formDirty, setDeckSalt } = await ui();
  const i = initialForm(null, null);
  const a = setDeckSalt(i, 'd1', 3);
  assert.equal(formDirty(i, a), true);
  assert.equal(formDirty(i, setDeckSalt(a, 'd1', 3)), false);
});

test('P2 D6 Salzigstes Deck ⇒ geändert', async () => {
  const { initialForm, formDirty, pickSaltiest } = await ui();
  const i = initialForm(null, null);
  assert.equal(formDirty(i, pickSaltiest(i, 'd1')), true);
});

test('P2 D7 gespeicherte Bewertung: gleich ⇒ nicht geändert; Salz abgewählt ⇒ geändert', async () => {
  const { initialForm, formDirty, toggleScore } = await ui();
  const data = { game: { id: 'gx', wincon: 'kombo', note: 'Notiz' }, ratings: [{ gameId: 'gx', memberId: 'm-F', salt: 4, fun: 3, deckRating: 2 }],
    deckSalt: [{ gameId: 'gx', raterId: 'm-F', deckId: 'd1', salt: 5 }], potg: [{ gameId: 'gx', voterId: 'm-F', votedFor: 'm-M', text: 'Gut' }] };
  const i = initialForm(data, 'm-F');
  assert.equal(formDirty(i, { ...i, salt: 4 }), false);
  assert.equal(formDirty(i, initialForm(data, 'm-F')), false, 'frisch berechnet ⇒ gleich');
  assert.equal(formDirty(i, { ...i, salt: toggleScore(i.salt, 4) }), true);
  assert.equal(formDirty(i, { ...i, deckSalt: { d1: 5 } }), false, 'Menge gleich');
  assert.equal(formDirty(i, { ...i, deckSalt: {} }), true, 'Deck-Salz entfernt');
  assert.equal(formDirty(i, { ...i, potg: null }), true);
});

test('P2 D8 Siegbedingung gewählt ⇒ geändert', async () => {
  const { initialForm, formDirty, pickWincon } = await ui();
  const i = initialForm(null, null);
  assert.equal(formDirty(i, pickWincon(i, 'kombo')), true);
});

test('P2 D9 nur hadRating/hadDeckSalt anders ⇒ nicht geändert; fehlende Felder werfen nicht', async () => {
  const { initialForm, formDirty } = await ui();
  const i = initialForm(null, null);
  assert.equal(formDirty(i, { ...i, hadRating: !i.hadRating, hadDeckSalt: !i.hadDeckSalt }), false);
  assert.doesNotThrow(() => formDirty(/** @type {any} */ (null), /** @type {any} */ (undefined)));
  assert.equal(formDirty(/** @type {any} */ ({}), /** @type {any} */ ({})), false);
});
