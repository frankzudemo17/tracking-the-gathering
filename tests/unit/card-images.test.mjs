// Spec P8 Intro 2.0 (Welle ttg-features), Entscheide 11 und 13: Kartenbild-Quelle (Ableitung art_crop ⇒ normal,
// Kartenzeile, scryfall_ids) und modulweiter Vorlade-Speicher. Tabellen „Spec-Tests · Ableitung / cardImages /
// Vorladen“. Jeder Fall lädt das Modul selbst per import() ⇒ ohne src/lib/card-images.js rot (Gegenprobe).
// Vorlade-Fälle laden je eine frische Modul-Instanz (Abfrageteil an der Adresse), damit der Speicher leer beginnt.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let inst = 0;
const mod = () => import('../../src/lib/card-images.js');
const fresh = () => import(`../../src/lib/card-images.js?fall=${++inst}`);

const ID = 'd0d33d52-3d28-4635-b985-51e126289259';
const ID1 = ID;
const ID2 = '76f21cbb-6d6e-4cc5-8a9d-9fbc0b7c5ad3';
const ID3 = '63cda4a0-0dff-4edb-ae67-a2b7e2971350';
const ART = (id, q = '?1599707796') => `https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg${q}`;
const N = (id, q = '?1599707796') => `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg${q}`;
const CMD = (name, image_normal) => ({ section: 'commander', qty: 1, name, image_normal });

// ---------------------------------------------------------------- Ableitung
test('P8 Ableitung · normalFromArt: art_crop ⇒ normal, Abfrageteil bleibt; sonst null', async () => {
  const { normalFromArt } = await mod();
  assert.equal(normalFromArt(`https://cards.scryfall.io/art_crop/front/d/0/${ID}.jpg?1599707796`), `https://cards.scryfall.io/normal/front/d/0/${ID}.jpg?1599707796`);
  assert.equal(normalFromArt(`https://cards.scryfall.io/art_crop/front/d/0/${ID}.jpg`), `https://cards.scryfall.io/normal/front/d/0/${ID}.jpg`);
  assert.equal(normalFromArt(`https://cards.scryfall.io/art_crop/back/d/0/${ID}.jpg?1`), `https://cards.scryfall.io/normal/back/d/0/${ID}.jpg?1`);
  assert.equal(normalFromArt(`http://cards.scryfall.io/art_crop/front/d/0/${ID}.jpg?1`), null, 'http');
  assert.equal(normalFromArt(`https://c1.scryfall.com/file/scryfall-cards/art_crop/front/d/0/${ID}.jpg`), null, 'alter Host');
  assert.equal(normalFromArt(`https://cards.scryfall.io/art_crop/front/a/0/${ID}.jpg`), null, '<a>/<b> passt nicht');
  assert.equal(normalFromArt(`https://cards.scryfall.io/art_crop/front/d/1/${ID}.jpg`), null, '<b> passt nicht');
  assert.equal(normalFromArt(`https://cards.scryfall.io/art_crop/front/d/0/${ID}.png`), null, '.png');
  assert.equal(normalFromArt(`https://cards.scryfall.io/art_crop/front/d/0/${ID}.jpg?abc`), null, 'Abfrageteil ?abc');
  assert.equal(normalFromArt(`https://cards.scryfall.io/normal/front/d/0/${ID}.jpg`), null, 'kein art_crop');
  for (const v of [null, '', 42, undefined]) assert.equal(normalFromArt(v), null, String(v));
});

test('P8 Ableitung · normalFromId: gültige UUID in Kleinbuchstaben ⇒ normal ohne Abfrageteil; sonst null', async () => {
  const { normalFromId } = await mod();
  assert.equal(normalFromId(ID), `https://cards.scryfall.io/normal/front/d/0/${ID}.jpg`);
  for (const v of [ID.toUpperCase(), 'abc', null, undefined, 42]) assert.equal(normalFromId(v), null, String(v));
});

// ---------------------------------------------------------------- cardImages
test('P8 cardImages E1–E13: Reihenfolge der Quellen, Partner, Rückfall null', async () => {
  const { cardImages, normalFromId } = await mod();
  const base = { commander_name: 'Atraxa', partner_name: null, image_url: null, partner_image_url: null };
  // E1 Quelle 1
  assert.deepEqual(cardImages({ ...base, image_url: ART(ID1) }, null, null), [N(ID1)], 'E1');
  // E2 Partner
  assert.deepEqual(cardImages({ ...base, partner_name: 'P', image_url: ART(ID1), partner_image_url: ART(ID2) }, null, null), [N(ID1), N(ID2)], 'E2');
  // E3 Quelle 2
  const e3 = 'https://cards.scryfall.io/normal/front/d/0/ID1.jpg?7';
  assert.deepEqual(cardImages(base, null, [CMD('Atraxa', e3)]), [e3], 'E3');
  // E4 fremder Host übersprungen ⇒ Quelle 3
  assert.deepEqual(cardImages(base, { scryfall_ids: [ID1] }, [CMD('Atraxa', 'https://example.com/x.jpg')]), [normalFromId(ID1)], 'E4');
  // E5 Quelle 3
  assert.deepEqual(cardImages(base, { scryfall_ids: [ID1] }, null), [normalFromId(ID1)], 'E5');
  // E6 nichts ⇒ Rückfall
  assert.equal(cardImages(base, { scryfall_ids: [] }, []), null, 'E6');
  // E7 Partner unvollständig ⇒ ganze Karte Rückfall
  assert.equal(cardImages({ ...base, partner_name: 'P', image_url: ART(ID1) }, { scryfall_ids: [ID1] }, []), null, 'E7');
  // E8 Vorderseiten-Abgleich
  const esika = { ...base, commander_name: 'Esika, God of the Tree // The Prismatic Bridge' };
  assert.deepEqual(cardImages(esika, null, [CMD('Esika, God of the Tree', N(ID1, '?8'))]), [N(ID1, '?8')], 'E8');
  // E9 Name passt nicht ⇒ Quelle 3
  assert.deepEqual(cardImages(base, { scryfall_ids: [ID1] }, [CMD('Other', N(ID2))]), [normalFromId(ID1)], 'E9');
  // E10 Quelle 1 ungültig ⇒ Zeile
  assert.deepEqual(cardImages({ ...base, image_url: 'https://cards.scryfall.io/art_crop/front/x/y/z.jpg' }, null, [CMD('Atraxa', N(ID2))]), [N(ID2)], 'E10');
  // E11 Vorrang Quelle 1 vor passender Zeile (andere Druckversion)
  assert.deepEqual(cardImages({ ...base, image_url: ART(ID1) }, null, [CMD('Atraxa', N(ID3))]), [N(ID1)], 'E11');
  // E12 scryfall_ids aus deck statt row
  assert.deepEqual(cardImages({ ...base, scryfall_ids: [ID1] }, null, null), [normalFromId(ID1)], 'E12');
  // E13 Partner gilt als vorhanden, wenn partner_name ODER partner_image_url gesetzt ist
  assert.deepEqual(cardImages({ ...base, image_url: ART(ID1), partner_image_url: ART(ID2) }, null, null), [N(ID1), N(ID2)], 'E13');
});

test('P8 cardImages: Groß/Klein und Rand-Leerzeichen im Namen egal; Zeile aus section main zählt nicht; Partner über Zeile', async () => {
  const { cardImages, normalFromId } = await mod();
  const base = { commander_name: 'Tymna the Weaver', partner_name: 'Kraum, Ludevic\'s Opus', image_url: null, partner_image_url: null };
  const rows = [CMD('  tymna the weaver ', N(ID1)), CMD("KRAUM, LUDEVIC'S OPUS", N(ID2))];
  assert.deepEqual(cardImages(base, null, rows), [N(ID1), N(ID2)]);
  assert.deepEqual(cardImages({ ...base, partner_name: null }, { scryfall_ids: [ID3] }, [{ ...CMD('Tymna the Weaver', N(ID1)), section: 'main' }]), [normalFromId(ID3)]);
  assert.equal(cardImages(null, null, null), null, 'ohne Deck');
});

// ---------------------------------------------------------------- Vorladen (Image-Attrappe)
let made = [];
let saved;
class FakeImage {
  constructor() {
    made.push(this);
    this.complete = false; this.naturalWidth = 0; this._src = '';
    this.onload = null; this.onerror = null;
    this._p = new Promise((res, rej) => { this.ok = () => { this.complete = true; this.naturalWidth = 488; res(); }; this.fail = () => { this.complete = true; rej(new Error('decode')); }; });
    this._p.catch(() => {});
  }
  set src(v) { this._src = v; }
  get src() { return this._src; }
  decode() { return this._p; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { made = []; saved = globalThis.Image; globalThis.Image = FakeImage; });
afterEach(() => { if (saved === undefined) delete globalThis.Image; else globalThis.Image = saved; });

test('P8 Vorladen · neu, doppelt, fertig, Fehler', async () => {
  const { preloadCardImages, imageState } = await fresh();
  const u1 = N(ID1), u2 = N(ID2);
  assert.equal(imageState(u1), null, 'unbekannt ⇒ null');
  preloadCardImages([u1]);
  assert.equal(imageState(u1), 'loading', 'neu');
  assert.equal(made.length, 1, '1 Instanz');
  assert.equal(made[0].src, u1);
  preloadCardImages([u1]);
  assert.equal(made.length, 1, 'doppelt ⇒ weiter 1 Instanz');
  made[0].ok(); await tick();
  assert.equal(imageState(u1), 'ok', 'fertig');
  preloadCardImages([u2]);
  made[1].fail(); await tick();
  assert.equal(imageState(u2), 'err', 'Fehler');
});

test('P8 Vorladen · Grenze 24 Adressen, älteste fällt heraus', async () => {
  const { preloadCardImages, imageState } = await fresh();
  const urls = Array.from({ length: 25 }, (_, i) => `https://cards.scryfall.io/normal/front/a/b/x${i}.jpg`);
  for (const u of urls) preloadCardImages([u]);
  assert.equal(made.length, 25);
  assert.equal(imageState(urls[0]), null, 'erste heraus');
  assert.notEqual(imageState(urls[24]), null, '25. da');
  assert.notEqual(imageState(urls[1]), null, 'zweite noch da');
});

test('P8 Vorladen · whenReady: ok ⇒ true, Fehler ⇒ false vor der Frist, Frist ⇒ false', async () => {
  const { preloadCardImages, whenReady } = await fresh();
  const u1 = N(ID1), u2 = N(ID2), u3 = N(ID3);
  preloadCardImages([u1, u2]);
  setTimeout(() => { made[0].ok(); made[1].ok(); }, 5);
  assert.equal(await whenReady([u1, u2], 20), true, 'alle ok innerhalb 20 ms');
  preloadCardImages([u3]);
  const t0 = Date.now();
  setTimeout(() => made[2].fail(), 5);
  assert.equal(await whenReady([u1, u3], 1000), false, 'eine err');
  assert.ok(Date.now() - t0 < 500, `vor Ablauf der Frist (${Date.now() - t0} ms)`);
  const u4 = 'https://cards.scryfall.io/normal/front/a/b/frist.jpg';
  preloadCardImages([u4]);
  const t1 = Date.now();
  assert.equal(await whenReady([u4], 30), false, 'bleibt loading ⇒ false');
  const dt = Date.now() - t1;
  assert.ok(dt >= 25 && dt < 400, `nach ≈ 30 ms (${dt} ms)`);
  assert.equal(await whenReady([], 30), true, 'leere Liste ⇒ true');
});

test('P8 Vorladen · ohne Image (Node) still nichts; ungültige Adressen ⇒ keine Instanz', async () => {
  const { preloadCardImages, imageState, whenReady } = await fresh();
  preloadCardImages([null, '', 42, undefined]);
  assert.equal(made.length, 0, 'ungültig ⇒ keine Instanz');
  delete globalThis.Image;
  const u = N(ID1);
  assert.doesNotThrow(() => preloadCardImages([u]));
  assert.equal(imageState(u), null);
  assert.equal(await whenReady([u], 10), false);
  assert.doesNotThrow(() => preloadCardImages('kein Array'));
});

test('P8 Vorladen · decode verworfen, Bild aber geladen ⇒ ok (Rückfall über complete/naturalWidth)', async () => {
  const { preloadCardImages, imageState } = await fresh();
  const u = N(ID1);
  preloadCardImages([u]);
  made[0].naturalWidth = 488; made[0].fail(); made[0].naturalWidth = 488; await tick();
  assert.equal(imageState(u), 'ok');
});
