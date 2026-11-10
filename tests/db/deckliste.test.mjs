// DB-Fälle Spec P1 Deck-Daten (Migration 20261115000000_deckliste.sql): Tabelle deck_cards, RLS, RPC replace_deck_cards.
// EIN Szenario auf EINER Datenbank, Fälle laufen in Reihenfolge (node:test, eine Datei).
// Aufbau: Gruppe G (A Admin, B Mitglied, Platzhalter Tim), fremde Gruppe H (C), Gast X (anonymes Konto), D (Konto zum Löschen).
// Decks: DA (A), DT (Tim), DC (C), DD (D), DZ (A, zum Löschen).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, tools, U } from './harness.mjs';

const EXPECTED = 17;
let db, as, su, q, err, seedUser, mkGroup;
let ran = 0;
const check = (name, fn) => test(name, async (t) => { ran++; await fn(t); });
const ok = (cond, info = '') => assert.ok(cond, info === '' ? undefined : String(info));
const fails = async (sql, params, re) => {
  const e = await err(sql, params);
  ok(e && (!re || re.test(e)), `erwartet Fehler${re ? ' ' + re : ''}, bekam: ${e}`);
  return e;
};

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Zeile wie aus resolveCards (Spalten der Tabelle). */
const row = (n, extra = {}) => ({
  section: 'main', qty: 1, name: `Karte ${n}`, scryfall_id: uid(n), oracle_id: uid(5000 + n), set_code: 'tst', collector_number: String(n),
  type_line: 'Artifact', mana_value: 1, colors: [], color_identity: [], image_small: `https://cards.scryfall.io/small/${n}.jpg`,
  image_normal: `https://cards.scryfall.io/normal/${n}.jpg`, game_changer: false, ...extra,
});
const REPLACE = `select replace_deck_cards($1, $2::jsonb) n`;
const replace = async (deck, rows) => (await q(REPLACE, [deck, JSON.stringify(rows)]))[0].n;
const replaceErr = (deck, rows) => err(REPLACE, [deck, rows === null ? null : JSON.stringify(rows)]);
/** Zählt als Superuser (unabhängig von RLS). */
const cardsOf = async (deck) => { await su(); return (await q(`select count(*)::int n from deck_cards where deck_id = $1`, [deck]))[0].n; };
const deckMeta = async (deck) => { await su(); return (await q(`select cards_updated_at, bracket_check from decks where id = $1`, [deck]))[0]; };
const visible = async (deck) => (await q(`select count(*)::int n from deck_cards where deck_id = $1`, [deck]))[0].n;

before(async () => {
  db = await freshDb();
  ({ as, su, q, err, seedUser, mkGroup } = tools(db));
});
after(async () => {
  await db?.close();
  assert.equal(ran, EXPECTED, `erwartet ${EXPECTED} Prüfungen, gelaufen ${ran}`);
});

let g, h, tim;
const D = {};

// ---------------------------------------------------------------- Krit. 1
check('K1 Migration geladen: Tabelle, Spalten, RLS an, Funktion vorhanden', async () => {
  await su();
  const cols = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'deck_cards' order by ordinal_position`))
    .map((r) => r.column_name);
  assert.deepEqual(cols, ['id', 'deck_id', 'section', 'qty', 'name', 'scryfall_id', 'oracle_id', 'set_code', 'collector_number', 'type_line',
    'mana_value', 'colors', 'color_identity', 'image_small', 'image_normal', 'game_changer']);
  const deckCols = (await q(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'decks'
    and column_name in ('cards_updated_at', 'bracket_check') order by column_name`)).map((r) => `${r.column_name}:${r.data_type}`);
  assert.deepEqual(deckCols, ['bracket_check:jsonb', 'cards_updated_at:timestamp with time zone']);
  ok((await q(`select relrowsecurity from pg_class where oid = 'public.deck_cards'::regclass`))[0].relrowsecurity, 'RLS aus');
  ok((await q(`select to_regprocedure('public.replace_deck_cards(uuid, jsonb)') is not null x`))[0].x, 'RPC fehlt');
  // Policies: genau eine, nur Select
  assert.deepEqual((await q(`select cmd from pg_policies where tablename = 'deck_cards'`)).map((r) => r.cmd), ['SELECT']);
});

check('Aufbau: Gruppen G/H, Mitglieder, Platzhalter, Gast, Decks', async () => {
  await su();
  for (const [id, email] of [[U.A, 'a@x.de'], [U.B, 'b@x.de'], [U.C, 'c@x.de'], [U.D, 'd@x.de'], [U.G, null]]) await seedUser(id, { email });
  await as(U.A);
  g = await mkGroup(U.A, 'G');
  [tim] = await q(`select * from create_placeholder($1, 'Tim')`, [g.id]);
  await as(U.B);
  await q(`select * from join_playgroup($1)`, [g.invite_code]);
  await as(U.C);
  h = await mkGroup(U.C, 'H');
  const deck = async (col, owner, name) =>
    (await q(`insert into decks (${col}, commander_name, short_name) values ($1, $2, $2) returning id`, [owner, name]))[0].id;
  await as(U.A);
  D.A = await deck('owner_profile_id', U.A, 'DA');
  D.Z = await deck('owner_profile_id', U.A, 'DZ');
  D.T = await deck('owner_member_id', tim.id, 'DT');
  await as(U.C);
  D.C = await deck('owner_profile_id', U.C, 'DC');
  await as(U.D);
  D.D = await deck('owner_profile_id', U.D, 'DD');
  ok(D.A && D.Z && D.T && D.C && D.D && h.id);
});

// ---------------------------------------------------------------- Krit. 3 (Teil: A ersetzt) + 4 (Erfolg setzt Spalten)
check('K3a A ersetzt eigenes Deck ⇒ 3 Zeilen; cards_updated_at gesetzt, bracket_check = null', async () => {
  await as(U.A);
  await q(`update decks set bracket_check = '{"floor": 2}'::jsonb where id = $1`, [D.A]);
  ok((await deckMeta(D.A)).bracket_check?.floor === 2, 'Vorbedingung bracket_check');
  await as(U.A);
  assert.equal(await replace(D.A, [row(1, { section: 'commander' }), row(2), row(3, { qty: 32 })]), 3);
  assert.equal(await cardsOf(D.A), 3);
  const m = await deckMeta(D.A);
  ok(m.cards_updated_at instanceof Date, `cards_updated_at: ${m.cards_updated_at}`);
  assert.equal(m.bracket_check, null);
  // erneutes Ersetzen löscht den alten Bestand vollständig
  await as(U.A);
  assert.equal(await replace(D.A, [row(1, { section: 'commander' }), row(4), row(5)]), 3);
  await su();
  assert.deepEqual((await q(`select name from deck_cards where deck_id = $1 order by name`, [D.A])).map((r) => r.name), ['Karte 1', 'Karte 4', 'Karte 5']);
  const r = (await q(`select * from deck_cards where deck_id = $1 and name = 'Karte 1'`, [D.A]))[0];
  assert.equal(r.section, 'commander');
  assert.equal(r.scryfall_id, uid(1));
  assert.equal(r.image_normal, 'https://cards.scryfall.io/normal/1.jpg');
  assert.equal(Number(r.mana_value), 1);
});

// ---------------------------------------------------------------- Krit. 2
check('K2 Sichtbarkeit wie Deck: A und B sehen 3, C 0, anonym 0, Gast (anonymes Konto) 0', async () => {
  await as(U.A); assert.equal(await visible(D.A), 3);
  await as(U.B); assert.equal(await visible(D.A), 3);
  await as(U.C); assert.equal(await visible(D.A), 0);
  await as(null); assert.equal(await visible(D.A), 0);
  await as(U.G, { anonymous: true }); assert.equal(await visible(D.A), 0);
  // auch ohne Filter: C sieht keine Zeile fremder Decks
  await as(U.C); assert.equal((await q(`select count(*)::int n from deck_cards`))[0].n, 0);
});

// ---------------------------------------------------------------- Krit. 3
check('K3b B (gleiche Gruppe) ersetzt A\'s Deck ⇒ Fehler, Bestand unverändert', async () => {
  const before = await deckMeta(D.A);
  await as(U.B);
  await fails(REPLACE, [D.A, JSON.stringify([row(9)])], /Deck nicht gefunden/);
  assert.equal(await cardsOf(D.A), 3);
  assert.deepEqual(await deckMeta(D.A), before);
  await as(U.C);
  await fails(REPLACE, [D.A, JSON.stringify([row(9)])], /Deck nicht gefunden/);
  assert.equal(await cardsOf(D.A), 3);
});

check('K3c B ersetzt Deck eines Spielers ohne Konto seiner Gruppe ⇒ ok; C (fremde Gruppe) ⇒ Fehler', async () => {
  await as(U.B);
  assert.equal(await replace(D.T, [row(1, { section: 'commander' }), row(2)]), 2);
  assert.equal(await cardsOf(D.T), 2);
  await as(U.C);
  await fails(REPLACE, [D.T, JSON.stringify([row(7)])], /Deck nicht gefunden/);
  assert.equal(await cardsOf(D.T), 2);
  await as(U.A); assert.equal(await visible(D.T), 2);
  await as(U.C); assert.equal(await visible(D.T), 0);
});

check('K3d direktes insert/update/delete/truncate auf deck_cards als A ⇒ Fehler, Bestand unverändert', async () => {
  await as(U.A);
  await fails(`insert into deck_cards (deck_id, section, qty, name, scryfall_id) values ($1, 'main', 1, 'X', $2)`, [D.A, uid(99)], /permission denied|row-level security/);
  await fails(`update deck_cards set qty = 50 where deck_id = $1`, [D.A], /permission denied/);
  await fails(`delete from deck_cards where deck_id = $1`, [D.A], /permission denied/);
  await fails(`truncate deck_cards`, [], /permission denied/);
  assert.equal(await cardsOf(D.A), 3);
  await su();
  assert.deepEqual((await q(`select qty from deck_cards where deck_id = $1 order by name`, [D.A])).map((r) => r.qty), [1, 1, 1]);
});

check('K3e Ausführungsrechte: nur authenticated; anonym ohne Konto ⇒ Rechte-Fehler; Gast (anonymes Konto) ⇒ Nicht angemeldet', async () => {
  await su();
  const p = (role) => q(`select has_function_privilege($1, 'public.replace_deck_cards(uuid, jsonb)', 'execute') x`, [role]).then((r) => r[0].x);
  assert.equal(await p('authenticated'), true);
  assert.equal(await p('anon'), false);
  // Prüfhilfe nur intern: für keine Client-Rolle ausführbar
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await q(`select has_function_privilege($1, 'public.deck_card_invalid(jsonb)', 'execute') x`, [role]))[0].x, false, role);
  }
  await as(null);
  await fails(REPLACE, [D.A, JSON.stringify([row(9)])], /permission denied/);
  await as(U.G, { anonymous: true });
  await fails(REPLACE, [D.A, JSON.stringify([row(9)])], /Nicht angemeldet/);
  assert.equal(await cardsOf(D.A), 3);
  await as(U.A);
  await fails(REPLACE, [uid(424242), JSON.stringify([row(9)])], /Deck nicht gefunden/);
  await fails(REPLACE, [null, JSON.stringify([row(9)])], /Deck nicht gefunden/);
});

// ---------------------------------------------------------------- Krit. 4
/** Ungültige Liste ⇒ Fehler, Bestand von DA (3 Zeilen) und Zeitstempel unverändert. */
async function rejected(rows, re, label) {
  const before = await deckMeta(D.A);
  await as(U.A);
  const e = await replaceErr(D.A, rows);
  ok(e && re.test(e), `${label}: erwartet ${re}, bekam ${e}`);
  assert.equal(await cardsOf(D.A), 3, label);
  assert.deepEqual(await deckMeta(D.A), before, label);
}

check('K4a qty 0 in einem Element ⇒ Fehler, vorherige 3 Zeilen unverändert', async () => {
  await rejected([row(1, { section: 'commander' }), row(2), row(3, { qty: 0 })], /Ungültige Karte 3: qty/, 'qty 0');
});

check('K4b 251 Elemente ⇒ Fehler; 250 ⇒ ok', async () => {
  await rejected(Array.from({ length: 251 }, (_, i) => row(100 + i)), /Zu viele Karten/, '251');
  await as(U.A);
  assert.equal(await replace(D.Z, Array.from({ length: 250 }, (_, i) => row(100 + i))), 250);
  assert.equal(await cardsOf(D.Z), 250);
});

check('K4c 3 Commander ⇒ Fehler; 2 und 0 Commander ⇒ ok', async () => {
  await rejected([row(1, { section: 'commander' }), row(2, { section: 'commander' }), row(3, { section: 'commander' })], /Zu viele Commander/, '3 Cmd');
  await as(U.A);
  assert.equal(await replace(D.Z, [row(1, { section: 'commander' }), row(2, { section: 'commander' }), row(3)]), 3);
  assert.equal(await replace(D.Z, [row(1), row(2)]), 2);
  assert.equal(await cardsOf(D.Z), 2);
  assert.equal(await replace(D.Z, []), 0); // leere Liste leert die Deckliste
  assert.equal(await cardsOf(D.Z), 0);
});

check('K4d Negativraum: Pflichtfelder, Typen, Wertebereiche, Dubletten, keine Liste', async () => {
  const bad = [
    [[row(1, { scryfall_id: null })], /Ungültige Karte 1: scryfall_id/, 'scryfall_id null'],
    [[row(1, { scryfall_id: 'kein-uuid' })], /Ungültige Karte 1: scryfall_id/, 'scryfall_id Text'],
    [[row(1, { name: '' })], /Ungültige Karte 1: name/, 'name leer'],
    [[row(1, { name: 'x'.repeat(201) })], /Ungültige Karte 1: name/, 'name 201'],
    [[(({ name, ...r }) => r)(row(1))], /Ungültige Karte 1: name/, 'name fehlt'],
    [[(({ qty, ...r }) => r)(row(1))], /Ungültige Karte 1: qty/, 'qty fehlt'],
    [[row(1, { qty: 100 })], /Ungültige Karte 1: qty/, 'qty 100'],
    [[row(1, { qty: '1' })], /Ungültige Karte 1: qty/, 'qty Text'],
    [[row(1, { qty: 1.5 })], /Ungültige Karte 1: qty/, 'qty 1.5'],
    [[row(1, { section: 'sideboard' })], /Ungültige Karte 1: section/, 'section'],
    [[row(1), row(2, { oracle_id: 'x' })], /Ungültige Karte 2: oracle_id/, 'oracle_id'],
    [[row(1, { colors: ['W', 'X'] })], /Ungültige Karte 1: colors/, 'colors'],
    [[row(1, { color_identity: 'W' })], /Ungültige Karte 1: color_identity/, 'color_identity'],
    [[row(1, { mana_value: -1 })], /Ungültige Karte 1: mana_value/, 'mana_value'],
    [[row(1, { game_changer: 'ja' })], /Ungültige Karte 1: game_changer/, 'game_changer'],
    [[row(1, { image_normal: 'javascript:alert(1)' })], /Ungültige Karte 1: image_normal/, 'image_normal'],
    [[row(1, { set_code: 'x'.repeat(21) })], /Ungültige Karte 1: set_code/, 'set_code'],
    [[row(1), 'kein Objekt'], /Ungültige Karte 2/, 'Element Text'],
    [[row(1), row(1)], /Doppelte Karte/, 'Dublette'],
    [{ cards: [row(1)] }, /Ungültige Kartenliste/, 'Objekt statt Liste'],
    [null, /Ungültige Kartenliste/, 'null'],
  ];
  for (const [rows, re, label] of bad) await rejected(rows, re, label);
  // gleiche Karte als Commander und im Hauptdeck ist keine Dublette
  await as(U.A);
  assert.equal(await replace(D.Z, [row(1, { section: 'commander' }), row(1)]), 2);
});

check('K4e Elemente können kein fremdes Deck/keine id setzen; fehlende optionale Felder ⇒ Standardwerte', async () => {
  await as(U.A);
  assert.equal(await replace(D.Z, [{ ...row(1), deck_id: D.C, id: 1 }, { section: 'main', qty: 2, name: 'Nackt', scryfall_id: uid(2) }]), 2);
  assert.equal(await cardsOf(D.C), 0);
  assert.equal(await cardsOf(D.Z), 2);
  await su();
  const r = (await q(`select * from deck_cards where deck_id = $1 and name = 'Nackt'`, [D.Z]))[0];
  assert.deepEqual([r.colors, r.color_identity, r.game_changer, r.oracle_id, r.mana_value, r.image_small], [[], [], false, null, null, null]);
});

// ---------------------------------------------------------------- Zweite Schreibquelle bracket_check
check('bracket_check: Besitzer darf per decks-Update setzen, B (gleiche Gruppe) nicht; RPC setzt null', async () => {
  await as(U.A);
  assert.equal((await q(`update decks set bracket_check = '{"floor": 3}'::jsonb where id = $1 returning id`, [D.A])).length, 1);
  await as(U.B);
  assert.equal((await q(`update decks set bracket_check = '{"floor": 1}'::jsonb where id = $1 returning id`, [D.A])).length, 0);
  ok((await deckMeta(D.A)).bracket_check.floor === 3, 'B hat bracket_check geändert');
  await as(U.A);
  await replace(D.A, [row(1, { section: 'commander' }), row(4), row(5)]);
  assert.equal((await deckMeta(D.A)).bracket_check, null);
});

// ---------------------------------------------------------------- Krit. 5
check('K5a Kaskade: Deck löschen ⇒ 0 deck_cards', async () => {
  await as(U.A);
  assert.equal(await replace(D.Z, [row(1), row(2), row(3)]), 3);
  assert.equal((await q(`delete from decks where id = $1 returning id`, [D.Z])).length, 1);
  assert.equal(await cardsOf(D.Z), 0);
});

check('K5b Kaskade: Konto (auth.users) löschen ⇒ Profil, ungespieltes Deck und Karten weg', async () => {
  await as(U.D);
  assert.equal(await replace(D.D, [row(1, { section: 'commander' }), row(2)]), 2);
  await su();
  await q(`delete from auth.users where id = $1`, [U.D]);
  assert.equal((await q(`select count(*)::int n from decks where id = $1`, [D.D]))[0].n, 0);
  assert.equal(await cardsOf(D.D), 0);
});

check('K5c delete_my_account (E3-P12) ⇒ ungespieltes Deck samt Karten weg', async (t) => {
  await su();
  const has = (await q(`select to_regprocedure('public.delete_my_account()') is not null x`))[0].x;
  // auf diesem Stand evtl. nicht vorhanden (E3-P12 noch nicht gemergt) ⇒ sichtbar übersprungen, im Bericht „nicht geprüft“
  if (!has) { t.skip('delete_my_account() fehlt auf diesem Stand (E3-P12 nicht gemergt)'); return; }
  const E = 'ffffffff-0000-4000-8000-000000000006'; // eigenes Konto ohne Gruppe, damit Gruppenregeln nicht greifen
  await seedUser(E, { email: 'e@x.de' });
  await as(E);
  const [{ id }] = await q(`insert into decks (owner_profile_id, commander_name, short_name) values ($1, 'DE', 'DE') returning id`, [E]);
  assert.equal(await replace(id, [row(1, { section: 'commander' }), row(2)]), 2);
  await as(E);
  await q(`select public.delete_my_account()`);
  assert.equal(await cardsOf(id), 0);
  assert.equal((await q(`select count(*)::int n from decks where id = $1`, [id]))[0].n, 0);
});
