// Spec P1 (Welle ttg-live-feinschliff-decks): Scryfall-Auflösung, Speichern/Laden, Kennzahlen (src/decks/cards.js).
// Jeder Fall lädt das Modul selbst per import() ⇒ ohne das Modul rot (Gegenprobe).
// Kein echter Netzaufruf: fetch, wait und sb sind Attrappen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const cards = () => import('../../src/decks/cards.js');

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Scryfall-Karte in der Form von /cards/collection (nur die Felder, die cards.js liest). */
function card(n, name, set, number, extra = {}) {
  return {
    object: 'card', id: uid(n), oracle_id: uid(10000 + n), name, set, collector_number: number,
    type_line: 'Artifact', cmc: 1, colors: [], color_identity: [], game_changer: false,
    image_uris: { small: `https://cards.scryfall.io/small/${n}.jpg`, normal: `https://cards.scryfall.io/normal/${n}.jpg` },
    ...extra,
  };
}

/**
 * Attrappe für POST /cards/collection: sucht je Kennung in `db` (Set+Nummer oder Name/Seitenname),
 * liefert Treffer in `data` (optional umgedreht, um Reihenfolge-Abhängigkeit aufzudecken), Rest in `not_found`.
 */
function scryfall(db, { status = 200, reverse = false } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), init, ids: body.identifiers });
    if (status !== 200) return { ok: false, status, json: async () => ({ object: 'error', status, details: 'Too many requests' }) };
    const data = [], not_found = [];
    for (const idf of body.identifiers) {
      const low = (s) => String(s).toLowerCase();
      const c = idf.set
        ? db.find((x) => x.set === low(idf.set) && x.collector_number === idf.collector_number)
        : db.find((x) => low(x.name) === low(idf.name) || x.card_faces?.some((f) => low(f.name) === low(idf.name)));
      if (c) data.push(c); else not_found.push(idf);
    }
    if (reverse) data.reverse();
    return { ok: true, status: 200, json: async () => ({ object: 'list', not_found, data }) };
  };
  return { fetch, calls };
}
const waiter = () => { const waits = []; return { waits, wait: async (ms) => { waits.push(ms); } }; };

test('C1 Batches: 100 Einträge mit Set ⇒ genau 2 Aufrufe (75 + 25), dazwischen ≥ 100 ms, richtige Header', async () => {
  const { resolveCards } = await cards();
  const db = Array.from({ length: 100 }, (_, i) => card(i + 1, `Karte ${i + 1}`, 'tst', String(i + 1)));
  const entries = db.map((c) => ({ qty: 1, name: c.name, set: 'TST', number: c.collector_number }));
  const s = scryfall(db, { reverse: true });
  const w = waiter();
  const r = await resolveCards(entries, { fetch: s.fetch, wait: w.wait });
  assert.deepEqual(s.calls.map((c) => c.ids.length), [75, 25]);
  assert.equal(w.waits.length, 1);
  assert.ok(w.waits[0] >= 100, `Abstand ${w.waits[0]}`);
  for (const c of s.calls) {
    assert.equal(c.url, 'https://api.scryfall.com/cards/collection');
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers.Accept, 'application/json');
    assert.equal(c.init.headers['Content-Type'], 'application/json');
  }
  assert.deepEqual(s.calls[0].ids[0], { set: 'tst', collector_number: '1' });
  assert.equal(r.cards.length, 100);
  assert.deepEqual(r.notFound, []);
  // Zuordnung trotz umgedrehter Antwort richtig
  assert.ok(r.cards.every((row) => row.name === `Karte ${row.collector_number}` && row.scryfall_id === uid(Number(row.collector_number))));
});

test('C2 not_found: 1 Eintrag mit falschem Set ⇒ 2. Aufruf mit {name}, notFound = []', async () => {
  const { resolveCards } = await cards();
  const db = [card(1, 'Sol Ring', 'drc', '56')];
  const s = scryfall(db);
  const w = waiter();
  const r = await resolveCards([{ qty: 1, name: 'Sol Ring', set: 'XXX', number: '999' }], { fetch: s.fetch, wait: w.wait });
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.calls[1].ids, [{ name: 'Sol Ring' }]);
  assert.equal(w.waits.length, 1);
  assert.deepEqual(r.notFound, []);
  assert.equal(r.cards[0].scryfall_id, uid(1));
});

test('C2b not_found (Spec-Wortlaut „3. Aufruf“): 100 Einträge, einer mit falschem Set ⇒ 3. Aufruf mit {name}', async () => {
  const { resolveCards } = await cards();
  const db = Array.from({ length: 100 }, (_, i) => card(i + 1, `Karte ${i + 1}`, 'tst', String(i + 1)));
  const entries = db.map((c) => ({ qty: 1, name: c.name, set: 'TST', number: c.collector_number }));
  entries[40] = { qty: 1, name: 'Karte 41', set: 'BAD', number: '41' };
  const s = scryfall(db);
  const w = waiter();
  const r = await resolveCards(entries, { fetch: s.fetch, wait: w.wait });
  assert.deepEqual(s.calls.map((c) => c.ids.length), [75, 25, 1]);
  assert.deepEqual(s.calls[2].ids, [{ name: 'Karte 41' }]);
  assert.equal(w.waits.length, 2);
  assert.deepEqual(r.notFound, []);
  assert.equal(r.cards.length, 100);
});

test('C3 nicht auffindbar (auch per Name) ⇒ in notFound mit Abschnitt; ohne Set kein zweiter Durchgang', async () => {
  const { resolveCards } = await cards();
  const s = scryfall([card(1, 'Sol Ring', 'drc', '56')]);
  const r = await resolveCards({ commanders: [], main: [
    { qty: 1, name: 'Gibtsnicht', set: 'XXX', number: '1' }, { qty: 2, name: 'Auchnicht' }, { qty: 1, name: 'Sol Ring', set: 'DRC', number: '56' },
  ] }, { fetch: s.fetch, wait: waiter().wait });
  assert.deepEqual(s.calls.map((c) => c.ids), [
    [{ set: 'xxx', collector_number: '1' }, { name: 'Auchnicht' }, { set: 'drc', collector_number: '56' }],
    [{ name: 'Gibtsnicht' }],
  ]);
  assert.deepEqual(r.notFound, [
    { qty: 1, name: 'Gibtsnicht', set: 'XXX', number: '1', section: 'main' },
    { qty: 2, name: 'Auchnicht', section: 'main' },
  ]);
  assert.equal(r.cards.length, 1);
});

test('C4 Doppelt: Sol Ring DRC 56 + C21 263 ⇒ zwei Zeilen (verschiedene scryfall_id), Σ qty 2', async () => {
  const { resolveCards } = await cards();
  const s = scryfall([card(1, 'Sol Ring', 'drc', '56'), card(2, 'Sol Ring', 'c21', '263')]);
  const r = await resolveCards([{ qty: 1, name: 'Sol Ring', set: 'DRC', number: '56' }, { qty: 1, name: 'Sol Ring', set: 'C21', number: '263' }],
    { fetch: s.fetch, wait: waiter().wait });
  assert.equal(r.cards.length, 2);
  assert.notEqual(r.cards[0].scryfall_id, r.cards[1].scryfall_id);
  assert.equal(r.cards.reduce((n, c) => n + c.qty, 0), 2);
});

test('C5 Doppelt gleich: zwei Einträge treffen dieselbe scryfall_id ⇒ eine Zeile, qty 2', async () => {
  const { resolveCards } = await cards();
  const s = scryfall([card(1, 'Sol Ring', 'drc', '56')]);
  const r = await resolveCards([{ qty: 1, name: 'Sol Ring', set: 'DRC', number: '56' }, { qty: 1, name: 'Sol Ring' }],
    { fetch: s.fetch, wait: waiter().wait });
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].qty, 2);
  assert.equal(r.cards[0].section, 'main');
});

test('C6 Zeile = Tabellenspalten; Abschnitte aus dem Parser-Ergebnis; gleiche Karte als Commander und im Deck bleibt getrennt', async () => {
  const { resolveCards } = await cards();
  const gc = card(3, 'Smothering Tithe', 'rna', '22', { type_line: 'Enchantment', cmc: 4, colors: ['W'], color_identity: ['W'], game_changer: true });
  const lp = card(4, "Light-Paws, Emperor's Voice", 'neo', '25', { type_line: 'Legendary Creature — Fox Advisor', cmc: 2, colors: ['W'], color_identity: ['W'] });
  const s = scryfall([gc, lp]);
  const r = await resolveCards({
    commanders: [{ qty: 1, name: "Light-Paws, Emperor's Voice", set: 'NEO', number: '25' }],
    main: [{ qty: 1, name: 'Smothering Tithe', set: 'RNA', number: '22' }, { qty: 1, name: "Light-Paws, Emperor's Voice" }],
  }, { fetch: s.fetch, wait: waiter().wait });
  assert.deepEqual(r.cards, [
    { section: 'commander', qty: 1, name: "Light-Paws, Emperor's Voice", scryfall_id: uid(4), oracle_id: uid(10004), set_code: 'neo',
      collector_number: '25', type_line: 'Legendary Creature — Fox Advisor', mana_value: 2, colors: ['W'], color_identity: ['W'],
      image_small: 'https://cards.scryfall.io/small/4.jpg', image_normal: 'https://cards.scryfall.io/normal/4.jpg', game_changer: false },
    { section: 'main', qty: 1, name: 'Smothering Tithe', scryfall_id: uid(3), oracle_id: uid(10003), set_code: 'rna',
      collector_number: '22', type_line: 'Enchantment', mana_value: 4, colors: ['W'], color_identity: ['W'],
      image_small: 'https://cards.scryfall.io/small/3.jpg', image_normal: 'https://cards.scryfall.io/normal/3.jpg', game_changer: true },
    { section: 'main', qty: 1, name: "Light-Paws, Emperor's Voice", scryfall_id: uid(4), oracle_id: uid(10004), set_code: 'neo',
      collector_number: '25', type_line: 'Legendary Creature — Fox Advisor', mana_value: 2, colors: ['W'], color_identity: ['W'],
      image_small: 'https://cards.scryfall.io/small/4.jpg', image_normal: 'https://cards.scryfall.io/normal/4.jpg', game_changer: false },
  ]);
});

test('C7 Risiko 4: Doppelkarte (MDFC) ⇒ Bild und Farben von der Vorderseite, Typzeile vollständig', async () => {
  const { resolveCards, deckSummary } = await cards();
  const mdfc = {
    object: 'card', id: uid(5), oracle_id: uid(10005), name: 'Sejiri Shelter // Sejiri Glacier', set: 'znr', collector_number: '37',
    type_line: 'Instant // Land', cmc: 2, color_identity: ['W'], layout: 'modal_dfc',
    card_faces: [
      { name: 'Sejiri Shelter', type_line: 'Instant', colors: ['W'], image_uris: { small: 'https://cards.scryfall.io/small/5a.jpg', normal: 'https://cards.scryfall.io/normal/5a.jpg' } },
      { name: 'Sejiri Glacier', type_line: 'Land', colors: [], image_uris: { small: 'https://cards.scryfall.io/small/5b.jpg', normal: 'https://cards.scryfall.io/normal/5b.jpg' } },
    ],
  };
  const s = scryfall([mdfc]);
  const r = await resolveCards([{ qty: 1, name: 'Sejiri Shelter', set: 'ZNR', number: '37' }], { fetch: s.fetch, wait: waiter().wait });
  const row = r.cards[0];
  assert.equal(row.image_small, 'https://cards.scryfall.io/small/5a.jpg');
  assert.equal(row.image_normal, 'https://cards.scryfall.io/normal/5a.jpg');
  assert.deepEqual(row.colors, ['W']);
  assert.equal(row.type_line, 'Instant // Land');
  assert.equal(row.oracle_id, uid(10005));
  assert.equal(row.game_changer, false);
  const sum = deckSummary(r.cards);
  assert.deepEqual(sum.byType, { instant: 1 });
  assert.equal(sum.lands, 0);
  assert.deepEqual(sum.colors, { W: 1 });
});

test('C8 Scryfall 429/5xx ⇒ Fehler mit Status nach oben, kein Teilergebnis', async () => {
  const { resolveCards } = await cards();
  for (const status of [429, 503]) {
    const s = scryfall([], { status });
    await assert.rejects(resolveCards([{ qty: 1, name: 'Sol Ring' }], { fetch: s.fetch, wait: waiter().wait }),
      (e) => e instanceof Error && e.status === status);
  }
  // Fehler erst im zweiten Block ⇒ trotzdem Ablehnung
  const db = Array.from({ length: 80 }, (_, i) => card(i + 1, `Karte ${i + 1}`, 'tst', String(i + 1)));
  const ok = scryfall(db);
  let n = 0;
  const flaky = async (url, init) => (++n === 2 ? { ok: false, status: 500, json: async () => null } : ok.fetch(url, init));
  await assert.rejects(resolveCards(db.map((c) => ({ qty: 1, name: c.name, set: 'TST', number: c.collector_number })), { fetch: flaky, wait: waiter().wait }),
    (e) => e.status === 500);
});

test('C9 leer ⇒ kein Netzaufruf, leeres Ergebnis; Fortschritt optional per onProgress', async () => {
  const { resolveCards } = await cards();
  const s = scryfall([]);
  assert.deepEqual(await resolveCards([], { fetch: s.fetch, wait: waiter().wait }), { cards: [], notFound: [] });
  assert.deepEqual(await resolveCards({ commanders: [], main: [] }, { fetch: s.fetch, wait: waiter().wait }), { cards: [], notFound: [] });
  assert.equal(s.calls.length, 0);
  const db = Array.from({ length: 100 }, (_, i) => card(i + 1, `Karte ${i + 1}`, 'tst', String(i + 1)));
  const prog = [];
  await resolveCards(db.map((c) => ({ qty: 1, name: c.name, set: 'TST', number: c.collector_number })),
    { fetch: scryfall(db).fetch, wait: waiter().wait, onProgress: (done, total) => prog.push([done, total]) });
  assert.deepEqual(prog, [[75, 100], [100, 100]]);
});

/** sb-Attrappe: zeichnet Aufrufe auf, liefert {data, error}. */
function fakeSb({ data = null, error = null } = {}) {
  const calls = [];
  const chain = {
    select: (...a) => (calls.push(['select', ...a]), chain),
    eq: (...a) => (calls.push(['eq', ...a]), chain),
    order: (...a) => (calls.push(['order', ...a]), chain),
    then: (res, rej) => Promise.resolve({ data, error }).then(res, rej),
  };
  return {
    calls,
    from: (t) => (calls.push(['from', t]), chain),
    rpc: async (fn, args) => (calls.push(['rpc', fn, args]), { data, error }),
  };
}

test('C10 saveDeckCards ⇒ RPC replace_deck_cards nur mit Tabellenspalten; Fehler wird geworfen', async () => {
  const { saveDeckCards } = await cards();
  const row = { section: 'main', qty: 1, name: 'Sol Ring', scryfall_id: uid(1), oracle_id: null, set_code: 'drc', collector_number: '56',
    type_line: 'Artifact', mana_value: 1, colors: [], color_identity: [], image_small: null, image_normal: null, game_changer: false };
  const sb = fakeSb({ data: 1 });
  assert.equal(await saveDeckCards(sb, 'D1', [{ ...row, id: 7, deck_id: 'X', extra: 'weg' }]), 1);
  assert.deepEqual(sb.calls, [['rpc', 'replace_deck_cards', { p_deck: 'D1', p_cards: [row] }]]);
  await assert.rejects(saveDeckCards(fakeSb({ error: { message: 'Deck nicht gefunden' } }), 'D1', [row]), /Deck nicht gefunden/);
});

test('C11 loadDeckCards ⇒ deck_cards gefiltert nach deck_id; leer ⇒ []; Fehler wird geworfen', async () => {
  const { loadDeckCards } = await cards();
  const sb = fakeSb({ data: null });
  assert.deepEqual(await loadDeckCards(sb, 'D1'), []);
  assert.deepEqual(sb.calls.slice(0, 3), [['from', 'deck_cards'], ['select', '*'], ['eq', 'deck_id', 'D1']]);
  assert.deepEqual(await loadDeckCards(fakeSb({ data: [{ id: 1 }] }), 'D1'), [{ id: 1 }]);
  await assert.rejects(loadDeckCards(fakeSb({ error: { message: 'kaputt' } }), 'D1'), /kaputt/);
});

const R = (section, qty, name, type_line, mana_value, colors = []) => ({ section, qty, name, type_line, mana_value, colors });

test('K1 Kennzahlen: Hand-Datensatz der Spec', async () => {
  const { deckSummary } = await cards();
  const rows = [
    R('commander', 1, 'Commander', 'Legendary Creature — Elf Druid', 3, ['G']),
    R('main', 1, 'Llanowar Elves', 'Creature — Elf Druid', 1, ['G']),
    R('main', 1, 'Sol Ring', 'Artifact', 1, []),
    R('main', 1, 'Dryad Arbor', 'Land Creature — Forest Dryad', 0, ['G']),
    R('main', 10, 'Forest', 'Basic Land — Forest', 0, []),
    R('main', 1, 'Craterhoof Behemoth', 'Creature — Beast', 8, ['G']),
    R('main', 2, 'Swords to Plowshares', 'Instant', 1, ['W']),
  ];
  assert.deepEqual(deckSummary(rows), {
    total: 16, commanders: 1,
    byType: { creature: 2, artifact: 1, land: 11, instant: 2 },
    curve: { 1: 4, '7+': 1 },
    colors: { G: 2, W: 2, C: 1 },
    lands: 11,
  });
});

test('K2 Kennzahlen: leeres Deck ⇒ Nullen; Typ-Reihenfolge und Sonstige; Mehrfarbig zählt je Farbe', async () => {
  const { deckSummary } = await cards();
  assert.deepEqual(deckSummary([]), { total: 0, commanders: 0, byType: {}, curve: {}, colors: {}, lands: 0 });
  assert.deepEqual(deckSummary(undefined), { total: 0, commanders: 0, byType: {}, curve: {}, colors: {}, lands: 0 });
  const s = deckSummary([
    R('main', 1, 'Steel Overseer', 'Artifact Creature — Construct', 2),
    R('main', 1, 'Karn', 'Legendary Planeswalker — Karn', 4),
    R('main', 1, 'Invasion of Ikoria', 'Battle — Siege', 7, ['G']),
    R('main', 1, 'Fire // Ice', 'Instant // Instant', 2, ['U', 'R']),
    R('main', 1, 'Aura', 'Enchantment — Aura', 0, ['W']),
    R('main', 1, 'Seltsam', 'Conspiracy', null),
    R('main', 1, 'Ohne Typ', null, null),
    R('commander', 2, 'Partner', 'Legendary Creature — Human', 2, ['B']),
  ]);
  assert.deepEqual(s.byType, { creature: 1, planeswalker: 1, battle: 1, instant: 1, enchantment: 1, other: 2 });
  assert.deepEqual(s.curve, { 0: 3, 2: 2, 4: 1, '7+': 1 });
  assert.deepEqual(s.colors, { C: 4, G: 1, U: 1, R: 1, W: 1 });
  assert.equal(s.commanders, 2);
  assert.equal(s.total, 7);
});
