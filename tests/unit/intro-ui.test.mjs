// Spec P3 (Welle ttg-features): reine Logik des Spielstart-Intros (src/views/intro-ui.js) — Startbedingung,
// Reihenfolge, Bilanz/Salz, automatische Zeile (Entscheid 9 + Nachtrag 1), Motto vor Auto-Zeile.
// Wörterbücher kommen aus src/i18n/de-intro.js / en-intro.js (nicht im Test nachgebaut).
// Jeder Fall lädt die Module selbst per import() ⇒ ohne die Module rot (Gegenprobe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ui = () => import('../../src/views/intro-ui.js');
const dicts = async () => ({ de: (await import('../../src/i18n/de-intro.js')).default, en: (await import('../../src/i18n/en-intro.js')).default });
const traitsOf = async (rows, deck) => (await import('../../src/decks/cards.js')).deckTraits(rows, deck);

// Decks wörtlich nach der Spec: R(type, qty, mv, {gc}) = main-Zeile, CMD(type) = Commander-Zeile MV 4
const R = (type_line, qty, mana_value, { gc = false } = {}) => ({ section: 'main', qty, type_line, mana_value, game_changer: gc });
const CMD = (type_line) => ({ section: 'commander', qty: 1, type_line, mana_value: 4, game_changer: false });
const each6 = (types, mv) => types.map((x) => R(`Creature — ${x}`, 6, mv));

const DECKS = {
  D1: [{ color_identity: ['G'] }, [CMD('Legendary Creature — Elf Druid'), R('Basic Land — Forest', 30, 0), R('Land', 6, 0), R('Creature — Elf Druid', 20, 2), R('Creature — Elf Warrior', 10, 2), R('Instant', 33, 3)]],
  D2: [{ color_identity: ['W', 'U'], bracket_check: { combos: [{ cards: ['A', 'B'], produces: ['Infinite mana'] }, { cards: ['C', 'D'], produces: ['Win the game'] }] } },
    [R('Land', 37, 0), R('Creature — Human Wizard', 8, 4), R('Instant', 52, 3), R('Instant', 2, 3, { gc: true })]],
  D3: [{ color_identity: ['B'] }, []],
  D4: [{ color_identity: ['R'] }, [CMD('Legendary Creature — Goblin')]],
  D5: [{ color_identity: [] }, [R('Land', 33, 0), R('Artifact Creature — Golem', 10, 6), R('Artifact', 56, 4)]],
  D6: [{ color_identity: ['W', 'U', 'B', 'R', 'G'], bracket_check: { combos: [{ cards: ['X', 'Y'], produces: ['Win the game'] }] } },
    [R('Land', 35, 0), ...each6(['Dragon', 'Angel', 'Demon', 'Hydra', 'Sphinx'], 5), R('Sorcery', 33, 3), R('Sorcery', 1, 3, { gc: true })]],
  D7: [{ color_identity: ['R', 'G'] }, [R('Land', 36, 0), R('Creature — Human // Creature — Werewolf', 9, 3), R('Instant', 54, 2)]],
  D8: [{ color_identity: ['U', 'B', 'R'], bracket_check: { combos: [{ produces: ['Infinite colorless mana', 'Infinite storm count'] }, { produces: ['infinite damage'] }] } },
    [R('Land', 34, 0), R('Creature — Zombie', 12, 3), R('Creature — Zombie Wizard', 4, 3), R('Instant', 44, 3), R('Sorcery', 3, 4, { gc: true }), R('Enchantment', 2, 3, { gc: true })]],
  D9: [{ color_identity: ['W', 'U', 'B', 'G'], bracket_check: { combos: [] } }, [R('Land', 36, 0), ...each6(['Human', 'Elf', 'Bird'], 3), R('Instant', 45, 3)]],
};

// Sollwerte: Tabelle „Spec-Tests · autoLine“. de-Zeilen mit Kreaturentyp nach Nachtrag 1 (deutsche Pluralnamen aus der
// Tabelle in intro-ui.js, unbekannter Typ ⇒ „viele {Typ}-Kreaturen“) — betrifft D1, D5, D7, D8; die Werte der Spec-Tabelle
// vor Nachtrag 1 stehen als Kommentar daneben (Abweichung im Bericht).
const GOLDEN = {
  D1: ['Mono-Grün · Elfen · niedrige Manakurve', 'Mono-green · Elf creatures · low curve'], // Spec vor N1: „Mono-Grün · Elf-Kreaturen · niedrige Manakurve“
  D2: ['Zweifarbig · 1 Endlos-Kombo · 2 Game Changer', 'Two-color · 1 infinite combo · 2 Game Changers'],
  D3: [null, null],
  D4: [null, null],
  D5: ['Farblos · viele Golem-Kreaturen · hohe Manakurve', 'Colorless · Golem creatures · high curve'], // vor N1: „Farblos · Golem-Kreaturen · hohe Manakurve“
  D6: ['Fünffarbig · 1 Game Changer · kreaturenlastig', 'Five-color · 1 Game Changer · creature-heavy · high curve'],
  D7: ['Zweifarbig · Menschen · niedrige Manakurve', 'Two-color · Human creatures · low curve'], // vor N1: „Zweifarbig · Human-Kreaturen · niedrige Manakurve“
  D8: ['Dreifarbig · 2 Endlos-Kombos · 5 Game Changer · Zombies', 'Three-color · 2 infinite combos · 5 Game Changers'], // vor N1: „Dreifarbig · 2 Endlos-Kombos · 5 Game Changer“ (Typ fiel bei 64 > 60, „Zombies“ passt mit 55)
  D9: ['Vierfarbig · mittlere Manakurve', 'Four-color · mid curve'],
};

for (const [name, [de, en]] of Object.entries(GOLDEN)) {
  test(`P3 autoLine ${name}: de und en wortgleich`, async () => {
    const { autoLine } = await ui();
    const L = await dicts();
    const [deck, rows] = DECKS[name];
    const tr = await traitsOf(rows, deck);
    assert.equal(autoLine(tr, L.de, 'de'), de);
    assert.equal(autoLine(tr, L.en, 'en'), en);
  });
}

test('P3 autoLine: höchstens 60 Codepunkte, Farben bleiben immer, gleiche Eingabe ⇒ gleiche Zeile', async () => {
  const { autoLine } = await ui();
  const L = await dicts();
  for (const [deck, rows] of Object.values(DECKS)) {
    const tr = await traitsOf(rows, deck);
    for (const lang of ['de', 'en']) {
      const a = autoLine(tr, L[lang], lang);
      if (a === null) continue;
      assert.ok([...a].length <= 60, `${a} (${[...a].length})`);
      assert.equal(autoLine(tr, L[lang], lang), a);
    }
  }
  // Kappung je Sprache: D2 de hätte mit vier Teilen 61 Codepunkte
  assert.equal([...'Zweifarbig · 1 Endlos-Kombo · 2 Game Changer · kaum Kreaturen'].length, 61);
});

// Nachtrag 1: Kreaturentypen auf Deutsch über eine feste Tabelle; drei Typen aus der Tabelle + ein unbekannter, je de/en
test('P3 autoLine Nachtrag 1: Tabellen-Typen deutsch im Plural, unbekannter Typ ⇒ Rückfall, en bleibt englisch', async () => {
  const { autoLine, TRIBES_DE } = await ui();
  const L = await dicts();
  assert.ok(Object.keys(TRIBES_DE).length >= 40, `Tabelle hat ${Object.keys(TRIBES_DE).length} Einträge`);
  const deck = { color_identity: ['B'] };
  const tribal = (type) => traitsOf([R('Land', 36, 0), R(`Creature — ${type}`, 30, 3), R('Instant', 33, 3)], deck);
  const cases = [['Dragon', 'Mono-Schwarz · Drachen · mittlere Manakurve', 'Mono-black · Dragon creatures · mid curve'],
    ['Wizard', 'Mono-Schwarz · Zauberer · mittlere Manakurve', 'Mono-black · Wizard creatures · mid curve'],
    ['Merfolk', 'Mono-Schwarz · Meervolk · mittlere Manakurve', 'Mono-black · Merfolk creatures · mid curve'],
    ['Ox', 'Mono-Schwarz · viele Ox-Kreaturen · mittlere Manakurve', 'Mono-black · Ox creatures · mid curve']];
  for (const [type, de, en] of cases) {
    const tr = await tribal(type);
    assert.equal(tr.tribe, type);
    assert.equal(autoLine(tr, L.de, 'de'), de);
    assert.equal(autoLine(tr, L.en, 'en'), en);
  }
  assert.equal(TRIBES_DE.Elf, 'Elfen');
  assert.equal(TRIBES_DE.Human, 'Menschen');
  assert.equal(TRIBES_DE.Zombie, 'Zombies');
});

test('P3 autoLine: ohne Fakten (null) ⇒ null', async () => {
  const { autoLine } = await ui();
  const L = await dicts();
  assert.equal(autoLine(null, L.de, 'de'), null);
});

// ---------------------------------------------------------------- cardLine
test('P3 cardLine: Motto vor Auto-Zeile, Leerraum-Motto ⇒ Auto, Spalte fehlt ⇒ Auto, ohne Karten ⇒ null', async () => {
  const { cardLine } = await ui();
  const L = await dicts();
  const [d1, rows] = DECKS.D1;
  const tr = await traitsOf(rows, d1);
  const auto = GOLDEN.D1[0];
  assert.deepEqual(cardLine({ ...d1, motto: 'Kein Zug ohne Plan.' }, tr, L.de, 'de'), { kind: 'motto', text: 'Kein Zug ohne Plan.' });
  assert.deepEqual(cardLine({ ...d1, motto: '   ' }, tr, L.de, 'de'), { kind: 'auto', text: auto });
  assert.deepEqual(cardLine({ ...d1 }, tr, L.de, 'de'), { kind: 'auto', text: auto });
  assert.equal(cardLine({ ...d1, motto: null }, null, L.de, 'de'), null);
  assert.deepEqual(cardLine({ ...d1, motto: 'x' }, null, L.de, 'de'), { kind: 'motto', text: 'x' });
  assert.deepEqual(cardLine({ ...d1, motto: '  Hallo  ' }, null, L.de, 'de'), { kind: 'motto', text: 'Hallo' });
  assert.equal(cardLine(null, null, L.de, 'de'), null);
});

// ---------------------------------------------------------------- introDue
test('P3 introDue: Startbedingung (Entscheid 1 d–f + Schalter)', async () => {
  const { introDue, INTRO_FRESH_MS } = await ui();
  assert.equal(INTRO_FRESH_MS, 60000);
  const now = 1000000;
  const base = { enabled: true, mark: now - 1000, now, status: 'live', finished: false, events: [] };
  const due = (ch) => introDue({ ...base, ...ch });
  assert.equal(due({}), true, 'Grundfall');
  assert.equal(due({ events: [{ type: 'roll' }] }), true, 'Startwurf');
  assert.equal(due({ enabled: false }), false, 'Schalter aus');
  for (const mark of [null, undefined, NaN]) assert.equal(due({ mark }), false, `kein Merker ${mark}`);
  assert.equal(due({ mark: now - 60000 }), true, 'Grenze 60 000');
  assert.equal(due({ mark: now - 60001 }), false, 'Grenze 60 001');
  assert.equal(due({ mark: now + 1 }), false, 'Zukunft');
  assert.equal(due({ status: 'finished' }), false);
  assert.equal(due({ status: 'aborted' }), false);
  assert.equal(due({ finished: true }), false);
  assert.equal(due({ events: [{ type: 'roll' }, { type: 'life' }] }), false, 'schon gespielt (life)');
  assert.equal(due({ events: [{ type: 'turn_end' }] }), false, 'schon gespielt (turn_end)');
  assert.equal(due({ events: [{ type: 'undo' }] }), false, 'schon gespielt (undo)');
});

// ---------------------------------------------------------------- Reihenfolge / Bilanz / Salz
test('P3 introOrder: Zugreihenfolge ab dem Startspieler', async () => {
  const { introOrder } = await ui();
  const ps = [3, 0, 2, 1].map((seat) => ({ id: `p${seat}`, seat }));
  assert.deepEqual(introOrder(ps, 2).map((p) => p.seat), [2, 3, 0, 1]);
  assert.deepEqual(introOrder([0, 1].map((seat) => ({ id: `p${seat}`, seat })), 0).map((p) => p.seat), [0, 1]);
  assert.deepEqual(introOrder(ps, 9).map((p) => p.seat), [0, 1, 2, 3], 'ohne Treffer ab dem kleinsten Sitz');
  assert.deepEqual(ps.map((p) => p.seat), [3, 0, 2, 1], 'Eingabe unverändert');
});

test('P3 recordText / saltText: Deck-Bilanz und Salz', async () => {
  const { recordText, saltText } = await ui();
  const L = await dicts();
  assert.equal(recordText(null, L.de), null);
  assert.equal(recordText({ games: 0, wins: 0 }, L.de), 'Erstes Spiel');
  assert.equal(recordText({ games: 0, wins: 0 }, L.en), 'First game');
  assert.equal(recordText({ games: 11, wins: 3 }, L.de), '3 von 11 gewonnen');
  assert.equal(recordText({ games: 11, wins: 3 }, L.en), 'Won 3 of 11');
  assert.equal(saltText(null, 'de'), null);
  assert.equal(saltText({ salt: null }, 'de'), null);
  assert.equal(saltText({ salt: { avgSalt: 2.4444 } }, 'de'), '2,4');
  assert.equal(saltText({ salt: { avgSalt: 2.4444 } }, 'en'), '2.4');
});

test('P8 Konstanten: Anflug 900 ms, Wartezeit 1200 ms, Dauer 2–10 s (Standard 4), Überblenden 200 ms, INTRO_CARD_MS entfällt', async () => {
  const m = await ui();
  assert.equal(m.INTRO_FLY_MS, 900);
  assert.equal(m.INTRO_WAIT_MS, 1200);
  assert.equal(m.INTRO_SECONDS_DEFAULT, 4);
  assert.equal(m.INTRO_SECONDS_MIN, 2);
  assert.equal(m.INTRO_SECONDS_MAX, 10);
  assert.equal(m.INTRO_FADE_MS, 200);
  assert.equal(m.INTRO_FRESH_MS, 60000);
  assert.equal(m.INTRO_CARD_MS, undefined);
});

test('P3 Wörterbücher: de und en haben dieselben Blätter', async () => {
  const L = await dicts();
  const leaves = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(leaves(L.de), leaves(L.en));
});

// ---------------------------------------------------------------- P8 Intro 2.0 (spec-p8-intro2.md, Entscheide 1, 9, 12)
test('P8 introSeconds: ganze Zahl 2–10, sonst 4 (keine Umwandlung)', async () => {
  const { introSeconds } = await ui();
  for (const v of [4, 2, 10]) assert.equal(introSeconds(v), v, String(v));
  for (const v of [1, 11, 0, -3, 4.5, '6', null, undefined, NaN, Infinity, '4', [4], {}]) assert.equal(introSeconds(v), 4, String(v));
});

test('P8 introTiming: Liegezeit + Anflug, Weniger Bewegung ohne Anflug', async () => {
  const { introTiming } = await ui();
  assert.deepEqual(introTiming(4, false), { flyMs: 900, lieMs: 4000, cardMs: 4900 });
  assert.deepEqual(introTiming(4, true), { flyMs: 0, lieMs: 4000, cardMs: 4000 });
  assert.deepEqual(introTiming(10, false), { flyMs: 900, lieMs: 10000, cardMs: 10900 });
  assert.deepEqual(introTiming(2, true), { flyMs: 0, lieMs: 2000, cardMs: 2000 });
  assert.deepEqual(introTiming(99, false), { flyMs: 900, lieMs: 4000, cardMs: 4900 });
});

test('P8 flightFrom: Richtung zum Spielerfeld, Länge = Bildschirmdiagonale, < 1 px ⇒ unten', async () => {
  const { flightFrom } = await ui();
  const R = (left, top, width, height) => ({ left, top, width, height });
  const f = (r, vw = 400, vh = 800) => flightFrom(r, vw, vh);
  assert.deepEqual(f(R(0, 300, 100, 200)), { x: -894, y: 0, dir: -1 }, 'links');
  assert.deepEqual(f(R(300, 300, 100, 200)), { x: 894, y: 0, dir: 1 }, 'rechts');
  assert.deepEqual(f(R(100, 0, 200, 100)), { x: 0, y: -894, dir: 1 }, 'oben');
  assert.deepEqual(f(R(100, 700, 200, 100)), { x: 0, y: 894, dir: 1 }, 'unten');
  assert.deepEqual(f(R(0, 0, 100, 100)), { x: -352, y: -822, dir: -1 }, 'schräg');
  assert.deepEqual(f(null), { x: 0, y: 894, dir: 1 }, 'kein Feld');
  assert.deepEqual(f(R(150, 350, 100, 100)), { x: 0, y: 894, dir: 1 }, 'mittig');
  assert.deepEqual(f(R(150.5, 350, 100, 100)), { x: 0, y: 894, dir: 1 }, 'Grenze < 1 px');
  assert.deepEqual(f(R(151, 350, 100, 100)), { x: 894, y: 0, dir: 1 }, 'Grenze = 1 px');
  assert.deepEqual(f(R(0, 0, 187.5, 406), 375, 812), { x: -375, y: -812, dir: -1 }, '375 × 812 Ecke');
  for (const r of [R(100, 0, 200, 100), R(150.5, 350, 100, 100)]) {
    const v = f(r);
    assert.ok(!Object.is(v.x, -0) && !Object.is(v.y, -0), 'kein −0');
  }
});

test('P8 tiltFor: fest je Sitz, |w| ≤ 3, ganze oder halbe Grad, Periode 6, nicht alle gleich', async () => {
  const { tiltFor } = await ui();
  const ws = Array.from({ length: 12 }, (_, s) => tiltFor(s));
  for (const w of ws) {
    assert.ok(Math.abs(w) <= 3, String(w));
    assert.ok(Number.isInteger(w * 2), `ganz oder halb: ${w}`);
  }
  for (let s = 0; s < 6; s++) assert.equal(tiltFor(s), tiltFor(s + 6), `Sitz ${s}`);
  assert.ok(new Set(ws).size > 1, 'nicht alle gleich');
  assert.equal(tiltFor(3), tiltFor(3), 'kein Zufall');
});
