// Spec P2: Edge Function `spellbook` (supabase/functions/spellbook/core.js) + Client (src/decks/spellbook.js).
// Ohne Netz: Spellbook wird durch eine fetch-Attrappe mit den Mitschnitten aus tests/unit/fixtures ersetzt.
// Jeder Fall lädt die Module selbst per import() (Gegenprobe wie in bracket.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = () => import('../../supabase/functions/spellbook/core.js');
const bracket = () => import('../../src/decks/bracket.js');
const client = () => import('../../src/decks/spellbook.js');

const fx = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/spellbook-${name}.json`, import.meta.url), 'utf8'));
const EST_LP = fx('estimate-light-paws');
const EST_TO = fx('estimate-thoracle');
const FMC_TO = fx('fmc-thoracle');
const FMC_EMPTY = fx('fmc-leer');
const INPUT_LP = fx('input-light-paws');
const INPUT_TO = {
  commanders: [{ card: "Light-Paws, Emperor's Voice", quantity: 1 }],
  main: [{ card: "Thassa's Oracle", quantity: 1 }, { card: 'Demonic Consultation', quantity: 1 }, { card: 'Sol Ring', quantity: 1 }],
};

const PAGES = 'https://frankzudemo17.github.io';
const URL_FN = 'https://example.supabase.co/functions/v1/spellbook';
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXI`;
const USER = { sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', is_anonymous: false };
const bearer = (p = USER) => `Bearer ${jwt(p)}`;

function post(body, { auth = bearer(), origin = PAGES, raw = false } = {}) {
  /** @type {Record<string,string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  if (origin) headers.Origin = origin;
  return new Request(URL_FN, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) });
}
const preflight = (origin) => new Request(URL_FN, {
  method: 'OPTIONS',
  headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' },
});

/** fetch-Attrappe: antwortet je Pfad mit einem Mitschnitt; zählt Aufrufe, merkt sich Bodies. */
function fakeFetch(map) {
  const calls = [];
  const fn = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(init.body) });
    const r = map[path];
    if (typeof r === 'function') return r(init);
    return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const okFetch = (est = EST_TO, fmc = FMC_TO) => fakeFetch({ '/estimate-bracket': est, '/find-my-combos': fmc });
const quiet = { log: () => {} };
// Zeitgrenzen-Fälle haben ein eigenes Test-Timeout: fehlt die Grenze im Code, wird der Fall rot statt zu hängen.

/** Alle Schlüssel (rekursiv) eines JSON-Werts. */
const allKeys = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); allKeys(x, out); }
  return out;
};

// ---- Krit. 2: Mitschnitte ⇒ Rechner -----------------------------------------------------------

test('Krit. 2: Light-Paws (Tag E, 0 Kombos) + leeres find-my-combos ⇒ floor 1, keine gc/mld/combo-Gründe', async () => {
  const C = await core(); const B = await bracket();
  const t = C.trim(EST_LP, FMC_EMPTY);
  const r = B.bracketFloor(t);
  assert.equal(r.floor, 1);
  assert.equal(r.tag, 'E');
  assert.ok(!r.reasons.some((x) => /^(gc|mld|combo)/.test(x.code)), JSON.stringify(r.reasons));
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(t.combos, []);
  assert.deepEqual(t.almost, []);
});

test('Krit. 2: Light-Paws mit Eingabe ⇒ unknown = 2 (Spellbook kennt nur Vorderseiten-Namen nicht)', async () => {
  const C = await core(); const B = await bracket();
  const t = C.trim(EST_LP, FMC_EMPTY, INPUT_LP);
  assert.deepEqual(t.unknown, { count: 2, cards: ["Michiko's Reign of Truth", 'Sejiri Shelter'] });
  const r = B.bracketFloor(t);
  assert.equal(r.floor, 1);
  assert.deepEqual(r.hints.find((h) => h.code === 'unknown_cards')?.count, 2);
});

test('Krit. 2: Thassa\'s Oracle + Demonic Consultation ⇒ floor 4, combo_early mit beiden Namen, tag R', async () => {
  const C = await core(); const B = await bracket();
  const t = C.trim(EST_TO, FMC_TO, INPUT_TO);
  const r = B.bracketFloor(t);
  assert.equal(r.floor, 4);
  assert.equal(r.tag, 'R');
  const early = r.reasons.find((x) => x.code === 'combo_early');
  assert.ok(early, JSON.stringify(r.reasons));
  assert.equal(early.floor, 4);
  assert.deepEqual(early.cards, ['Demonic Consultation', "Thassa's Oracle"]);
  // Game Changer laut Mitschnitt (Spellbook pflegt die Liste; der Rechner zählt, was kommt)
  assert.deepEqual(t.cards.filter((c) => c.gameChanger).map((c) => c.name), ["Thassa's Oracle"]);
  assert.deepEqual(t.unknown, { count: 0, cards: [] });
});

test('trim: Kombo-Felder aus estimate-bracket (Form laut Spec)', async () => {
  const C = await core();
  const [k] = C.trim(EST_TO, FMC_TO).combos;
  assert.deepEqual(k, {
    id: '742-1295',
    cards: ['Demonic Consultation', "Thassa's Oracle"],
    produces: ['Exile your library', 'Win the game'],
    definitelyTwoCard: true,
    arguablyTwoCard: true,
    manaValueNeeded: 3,
    extraTurn: false,
    massLandDenial: false,
    lock: false,
    speed: 5,
    tag: 'R',
  });
});

test('trim: almost aus almostIncluded, höchstens 10, missing = fehlende Karten', async () => {
  const C = await core();
  const t = C.trim(EST_TO, FMC_TO, INPUT_TO);
  assert.equal(FMC_TO.results.almostIncluded.length, 18);
  assert.equal(t.almost.length, 10);
  const first = t.almost[0];
  assert.deepEqual(Object.keys(first).sort(), ['cards', 'id', 'missing', 'produces']);
  assert.deepEqual(first.cards, ['Hullbreaker Horror', 'Sol Ring']);
  assert.deepEqual(first.missing, ['Hullbreaker Horror']);
  for (const a of t.almost) assert.ok(a.missing.length >= 1 && a.missing.length < a.cards.length, JSON.stringify(a));
});

test('trim: cards nur mit mindestens einem true; kaputte Antworten stürzen nicht ab', async () => {
  const C = await core();
  const t = C.trim(EST_LP, FMC_EMPTY);
  assert.deepEqual(t.cards, []);
  for (const x of [null, undefined, {}, { cards: 'x', combos: null }]) {
    const r = C.trim(x, x);
    assert.deepEqual(r, { tag: null, cards: [], combos: [], almost: [] });
  }
});

// ---- Krit. 7: Kürzung -------------------------------------------------------------------------

test('Krit. 7: Antwort ohne imageUri*, prices, legalities (Mitschnitte enthalten sie)', async () => {
  const C = await core();
  const before = allKeys([EST_LP, EST_TO, FMC_TO]);
  assert.ok([...before].some((k) => k.startsWith('imageUri')) && before.has('prices') && before.has('legalities'), 'Mitschnitt nicht gekürzt');
  const h = C.createHandler({ fetch: okFetch(), ...quiet });
  const res = await h(post(INPUT_TO));
  assert.equal(res.status, 200);
  const keys = allKeys(await res.json());
  assert.ok(![...keys].some((k) => /^imageUri/i.test(k)), [...keys].join(','));
  for (const k of ['prices', 'legalities', 'description', 'oracleId', 'typeLine']) assert.ok(!keys.has(k), k);
  for (const t of [C.trim(EST_LP, FMC_EMPTY, INPUT_LP), C.trim(EST_TO, FMC_TO, INPUT_TO)]) {
    const k2 = allKeys(t);
    assert.ok(![...k2].some((k) => /^imageUri/i.test(k)) && !k2.has('prices') && !k2.has('legalities'));
  }
});

// ---- Krit. 3: CORS ----------------------------------------------------------------------------

test('Krit. 3: OPTIONS mit Origin Pages ⇒ 204 + ACAO Pages + Methoden/Header', async () => {
  const C = await core();
  const res = await C.handle(preflight(PAGES));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), PAGES);
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(res.headers.get('access-control-allow-headers'), 'authorization, x-client-info, apikey, content-type');
  assert.match(res.headers.get('vary') || '', /Origin/);
});

test('Krit. 3: Origin http://127.0.0.1:5173 und http://localhost ⇒ ACAO gesetzt', async () => {
  const C = await core();
  for (const o of ['http://127.0.0.1:5173', 'http://localhost', 'http://localhost:8080']) {
    const res = await C.handle(preflight(o));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), o);
  }
});

test('Krit. 3: fremde Origins ⇒ kein ACAO', async () => {
  const C = await core();
  for (const o of ['https://evil.example', 'https://frankzudemo17.github.io.evil.example', 'http://localhost.evil.example', 'https://localhost', 'http://127.0.0.1:5173/x', 'null']) {
    const res = await C.handle(preflight(o));
    assert.equal(res.headers.get('access-control-allow-origin'), null, o);
  }
});

test('Krit. 3: POST-Fehlerantworten tragen ACAO (401, 403, 400, 413, 429, 502, 504, 405)', { timeout: 5000 }, async () => {
  const C = await core();
  const acao = (res) => res.headers.get('access-control-allow-origin');
  assert.equal(acao(await C.handle(post(INPUT_TO, { auth: null }))), PAGES);
  assert.equal(acao(await C.handle(post(INPUT_TO, { auth: bearer({ ...USER, is_anonymous: true }) }))), PAGES);
  assert.equal(acao(await C.handle(post({ commanders: [], main: [] }))), PAGES);
  assert.equal(acao(await C.handle(post('x'.repeat(70 * 1024), { raw: true }))), PAGES);
  assert.equal(acao(await C.handle(new Request(URL_FN, { method: 'GET', headers: { Origin: PAGES } }))), PAGES);
  const bad = C.createHandler({ fetch: fakeFetch({ '/estimate-bracket': () => new Response('x', { status: 500 }), '/find-my-combos': FMC_TO }), ...quiet });
  assert.equal(acao(await bad(post(INPUT_TO))), PAGES);
  const slow = C.createHandler({ fetch: () => new Promise(() => {}), timeoutMs: 20, ...quiet });
  assert.equal(acao(await slow(post(INPUT_TO))), PAGES);
  const h = C.createHandler({ fetch: okFetch(), ...quiet });
  let last;
  for (let i = 0; i < 21; i++) last = await h(post(INPUT_TO));
  assert.equal(last.status, 429);
  assert.equal(acao(last), PAGES);
});

// ---- Krit. 4: Auth ----------------------------------------------------------------------------

test('Krit. 4: ohne Authorization ⇒ 401; kaputter Token ⇒ 401', async () => {
  const C = await core();
  const f = okFetch();
  const h = C.createHandler({ fetch: f, ...quiet });
  for (const auth of [null, 'Bearer', 'Bearer abc', 'Basic Zm9vOmJhcg==', 'Bearer a.b', `Bearer x.${Buffer.from('nope').toString('base64url')}.y`]) {
    const res = await h(post(INPUT_TO, { auth }));
    assert.equal(res.status, 401, String(auth));
    assert.equal((await res.json()).error, 'unauthorized');
  }
  assert.equal(f.calls.length, 0);
});

test('Krit. 4: JWT-Nutzlast is_anonymous: true ⇒ 403, kein Upstream-Aufruf', async () => {
  const C = await core();
  const f = okFetch();
  const h = C.createHandler({ fetch: f, ...quiet });
  const res = await h(post(INPUT_TO, { auth: bearer({ ...USER, is_anonymous: true }) }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'anonymous');
  assert.equal(f.calls.length, 0);
});

test('Krit. 4: Token ohne Nutzer (Rolle anon, kein sub) oder abgelaufen ⇒ 401', async () => {
  const C = await core();
  const now = 1_800_000_000_000;
  const h = C.createHandler({ fetch: okFetch(), now: () => now, ...quiet });
  for (const p of [{ role: 'anon' }, { ...USER, sub: undefined }, { ...USER, role: 'anon' }, { ...USER, exp: now / 1000 - 1 }]) {
    const res = await h(post(INPUT_TO, { auth: bearer(p) }));
    assert.equal(res.status, 401, JSON.stringify(p));
  }
  const ok = await h(post(INPUT_TO, { auth: bearer({ ...USER, exp: now / 1000 + 3600 }) }));
  assert.equal(ok.status, 200);
});

// ---- Krit. 5: Eingabegrenzen ------------------------------------------------------------------

test('Krit. 5: 251 Einträge ⇒ 400 too_many; 250 ⇒ 200', async () => {
  const C = await core();
  const f = okFetch();
  const h = C.createHandler({ fetch: f, ...quiet });
  const many = (n) => ({ commanders: [{ card: 'Cmdr', quantity: 1 }], main: Array.from({ length: n - 1 }, (_, i) => ({ card: `Karte ${i}`, quantity: 1 })) });
  const res = await h(post(many(251)));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'too_many');
  assert.equal(f.calls.length, 0);
  assert.equal((await h(post(many(250)))).status, 200);
});

test('Krit. 5: Body 70 KB ⇒ 413 (auch ohne passendes Content-Length)', async () => {
  const C = await core();
  const f = okFetch();
  const h = C.createHandler({ fetch: f, ...quiet });
  const big = { commanders: [], main: [{ card: 'x'.repeat(70 * 1024), quantity: 1 }] };
  const res = await h(post(big));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'too_large');
  // Strom ohne Content-Length: Grenze greift beim Lesen
  const stream = new ReadableStream({
    start(c) { for (let i = 0; i < 70; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1024))); c.close(); },
  });
  const req = new Request(URL_FN, { method: 'POST', headers: { Authorization: bearer(), Origin: PAGES }, body: stream, duplex: 'half' });
  assert.equal((await h(req)).status, 413);
  assert.equal(f.calls.length, 0);
});

test('Krit. 5: quantity 0 / 100 / 1.5 / "1" ⇒ 400 bad_quantity', async () => {
  const C = await core();
  const h = C.createHandler({ fetch: okFetch(), ...quiet });
  for (const q of [0, 100, 1.5, '1', -1, null]) {
    const res = await h(post({ commanders: [], main: [{ card: 'Sol Ring', quantity: q }] }));
    assert.equal(res.status, 400, String(q));
    assert.equal((await res.json()).error, 'bad_quantity');
  }
});

test('Eingabe: leere Liste ⇒ 400 empty ohne Upstream-Aufruf; Kartenname 0/201 Zeichen ⇒ 400 bad_card; Unsinn ⇒ 400', async () => {
  const C = await core();
  const f = okFetch();
  const h = C.createHandler({ fetch: f, ...quiet });
  const code = async (body, raw) => { const r = await h(post(body, { raw })); assert.equal(r.status, 400); return (await r.json()).error; };
  assert.equal(await code({ commanders: [], main: [] }), 'empty');
  assert.equal(await code({}), 'empty');
  assert.equal(await code({ main: [{ card: '   ', quantity: 1 }] }), 'bad_card');
  assert.equal(await code({ main: [{ card: 'é'.repeat(201), quantity: 1 }] }), 'bad_card');
  assert.equal(await code({ main: [{ card: 5, quantity: 1 }] }), 'bad_card');
  assert.equal(await code({ main: ['Sol Ring'] }), 'bad_entry');
  assert.equal(await code({ main: 'Sol Ring' }), 'bad_body');
  assert.equal(await code([1, 2]), 'bad_body');
  assert.equal(await code('{kaputt', true), 'bad_json');
  assert.equal(f.calls.length, 0);
  // 200 Zeichen (auch Mehrbyte) sind erlaubt
  assert.equal((await h(post({ main: [{ card: 'é'.repeat(200), quantity: 1 }] }))).status, 200);
});

test('Partner: zwei Commander-Einträge gehen durch; weitergereicht nur card + quantity (getrimmt)', async () => {
  const C = await core();
  const f = okFetch();
  const h = C.createHandler({ fetch: f, ...quiet });
  const body = {
    commanders: [{ card: ' Tymna the Weaver ', quantity: 1, set: 'C16' }, { card: 'Kraum, Ludevic\'s Opus', quantity: 1 }],
    main: [{ card: 'Sol Ring', quantity: 1, scryfall_id: 'x' }],
    extra: 'weg',
  };
  assert.equal((await h(post(body))).status, 200);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map((c) => c.path).sort(), ['/estimate-bracket', '/find-my-combos']);
  for (const c of f.calls) {
    assert.deepEqual(c.body, {
      commanders: [{ card: 'Tymna the Weaver', quantity: 1 }, { card: "Kraum, Ludevic's Opus", quantity: 1 }],
      main: [{ card: 'Sol Ring', quantity: 1 }],
    });
  }
});

// ---- Krit. 6: Zeitgrenze / Upstream -----------------------------------------------------------

test('Krit. 6: fetch antwortet nie (ignoriert Abbruch) ⇒ 504 nach Grenze (verkürzt auf 30 ms)', { timeout: 5000 }, async () => {
  const C = await core();
  const h = C.createHandler({ fetch: () => new Promise(() => {}), timeoutMs: 30, ...quiet });
  const t0 = Date.now();
  const res = await h(post(INPUT_TO));
  const ms = Date.now() - t0;
  assert.equal(res.status, 504);
  assert.equal((await res.json()).error, 'timeout');
  assert.ok(ms >= 25 && ms < 2000, `${ms} ms`);
});

test('Krit. 6: fetch hält sich an AbortSignal ⇒ 504; nur ein Aufruf langsam ⇒ trotzdem 504', { timeout: 5000 }, async () => {
  const C = await core();
  const abortable = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const h1 = C.createHandler({ fetch: abortable, timeoutMs: 20, ...quiet });
  assert.equal((await h1(post(INPUT_TO))).status, 504);
  const h2 = C.createHandler({ fetch: fakeFetch({ '/estimate-bracket': EST_TO, '/find-my-combos': (init) => abortable('', init) }), timeoutMs: 20, ...quiet });
  assert.equal((await h2(post(INPUT_TO))).status, 504);
});

test('Krit. 6: Body hängt nach dem Kopf ⇒ 504', { timeout: 5000 }, async () => {
  const C = await core();
  const hang = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const h = C.createHandler({ fetch: hang, timeoutMs: 20, ...quiet });
  assert.equal((await h(post(INPUT_TO))).status, 504);
});

test('Krit. 6: Upstream 500 ⇒ 502 mit Status; Netzfehler / kaputtes JSON ⇒ 502', async () => {
  const C = await core();
  const logs = [];
  const h = C.createHandler({
    fetch: fakeFetch({ '/estimate-bracket': () => new Response('{"detail":"x"}', { status: 500 }), '/find-my-combos': FMC_TO }),
    log: (m) => logs.push(m),
  });
  const res = await h(post(INPUT_TO));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'upstream', status: 500 });
  assert.deepEqual(logs, ['spellbook: spellbook status 500']); // kein Kartenname, keine Nutzer-ID
  const net = C.createHandler({ fetch: async () => { throw new TypeError('fetch failed'); }, ...quiet });
  assert.deepEqual(await (await net(post(INPUT_TO))).json(), { error: 'upstream', status: 0 });
  const junk = C.createHandler({ fetch: async () => new Response('<html>', { status: 200 }), ...quiet });
  assert.equal((await junk(post(INPUT_TO))).status, 502);
});

// ---- Zwischenspeicher + Drossel ---------------------------------------------------------------

test('Zwischenspeicher: gleiche Liste (andere Reihenfolge/Schreibweise) ⇒ kein zweiter Upstream-Aufruf; nach 10 min neu', async () => {
  const C = await core();
  let now = 1_000_000;
  const f = okFetch();
  const h = C.createHandler({ fetch: f, now: () => now, ...quiet });
  const r1 = await h(post(INPUT_TO));
  assert.equal(r1.headers.get('x-cache'), 'miss');
  const body1 = await r1.json();
  const shuffled = { commanders: [{ card: "LIGHT-PAWS, EMPEROR'S VOICE", quantity: 1 }], main: [...INPUT_TO.main].reverse() };
  now += 9 * 60_000;
  const r2 = await h(post(shuffled));
  assert.equal(r2.headers.get('x-cache'), 'hit');
  assert.deepEqual(await r2.json(), body1);
  assert.equal(f.calls.length, 2);
  now += 2 * 60_000; // jetzt > 10 min nach dem Eintrag
  assert.equal((await h(post(INPUT_TO))).headers.get('x-cache'), 'miss');
  assert.equal(f.calls.length, 4);
  // andere Menge ⇒ anderer Schlüssel
  const k1 = await C.cacheKey(INPUT_TO);
  assert.match(k1, /^[0-9a-f]{64}$/);
  assert.equal(await C.cacheKey(shuffled), k1);
  assert.notEqual(await C.cacheKey({ ...INPUT_TO, main: [{ card: 'Sol Ring', quantity: 2 }] }), k1);
});

test('Zwischenspeicher: Fehler werden nicht gespeichert', async () => {
  const C = await core();
  let fail = true;
  const f = fakeFetch({
    '/estimate-bracket': () => (fail ? new Response('x', { status: 503 }) : new Response(JSON.stringify(EST_TO), { status: 200 })),
    '/find-my-combos': FMC_TO,
  });
  const h = C.createHandler({ fetch: f, ...quiet });
  assert.equal((await h(post(INPUT_TO))).status, 502);
  fail = false;
  const res = await h(post(INPUT_TO));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-cache'), 'miss');
});

test('Drossel: 21. Anfrage je Nutzer und Minute ⇒ 429 mit Retry-After; anderer Nutzer frei; nach 60 s wieder frei', async () => {
  const C = await core();
  let now = 5_000_000;
  const h = C.createHandler({ fetch: okFetch(), now: () => now, ...quiet });
  for (let i = 0; i < 20; i++) assert.equal((await h(post(INPUT_TO))).status, 200, `#${i + 1}`);
  const r21 = await h(post(INPUT_TO));
  assert.equal(r21.status, 429);
  assert.equal((await r21.json()).error, 'rate_limited');
  assert.equal(r21.headers.get('retry-after'), '60');
  const other = bearer({ ...USER, sub: '00000000-0000-4000-8000-000000000002' });
  assert.equal((await h(post(INPUT_TO, { auth: other }))).status, 200);
  now += 60_001;
  assert.equal((await h(post(INPUT_TO))).status, 200);
});

test('Methode: GET ⇒ 405', async () => {
  const C = await core();
  const res = await C.handle(new Request(URL_FN, { method: 'GET', headers: { Origin: PAGES } }));
  assert.equal(res.status, 405);
});

// ---- Client src/decks/spellbook.js ------------------------------------------------------------

/** sb-Attrappe: functions.invoke leitet an einen core-Handler weiter (wie supabase-js: Fehler als { error.context: Response }). */
function fakeSb(handler, auth = bearer()) {
  const calls = [];
  return {
    calls,
    functions: {
      async invoke(name, { body }) {
        calls.push({ name, body });
        const res = await handler(post(body, { auth }));
        if (!res.ok) return { data: null, error: { name: 'FunctionsHttpError', context: res } };
        return { data: await res.json(), error: null };
      },
    },
  };
}

test('Client toRequest: deck_cards-Zeilen ⇒ commanders/main, gleiche Namen zusammengelegt, Menge ≤ 99', async () => {
  const S = await client();
  const req = S.toRequest([
    { section: 'commander', qty: 1, name: 'Tymna the Weaver' },
    { section: 'commander', qty: 1, name: "Kraum, Ludevic's Opus" },
    { section: 'main', qty: 30, name: 'Plains' },
    { section: 'main', qty: 2, name: 'plains' },
    { section: 'main', qty: 90, name: 'Relentless Rats' },
    { section: 'main', qty: 20, name: 'Relentless Rats' },
    { section: 'side', qty: 1, name: 'Wish Card' },
    { section: 'main', qty: 1, name: '  ' },
  ]);
  assert.deepEqual(req, {
    commanders: [{ card: 'Tymna the Weaver', quantity: 1 }, { card: "Kraum, Ludevic's Opus", quantity: 1 }],
    main: [{ card: 'Plains', quantity: 32 }, { card: 'Relentless Rats', quantity: 99 }],
  });
});

test('Client checkDeck: gekürzte Antwort ⇒ bracketFloor; leere Liste ⇒ empty ohne Aufruf', async () => {
  const S = await client(); const C = await core(); const B = await bracket();
  const sb = fakeSb(C.createHandler({ fetch: okFetch(), ...quiet }));
  const rows = [
    { section: 'commander', qty: 1, name: "Light-Paws, Emperor's Voice" },
    { section: 'main', qty: 1, name: "Thassa's Oracle" },
    { section: 'main', qty: 1, name: 'Demonic Consultation' },
    { section: 'main', qty: 1, name: 'Sol Ring' },
  ];
  const data = await S.checkDeck(sb, rows);
  assert.equal(sb.calls[0].name, 'spellbook');
  assert.equal(B.bracketFloor(data).floor, 4);
  await assert.rejects(S.checkDeck(sb, []), (e) => e.code === 'empty' && e.status === 0);
  assert.equal(sb.calls.length, 1);
});

test('Client checkDeck: Fehlercodes 429 / 504 / 502 / 403 / 400 / Netz unterscheidbar', { timeout: 5000 }, async () => {
  const S = await client(); const C = await core();
  const rows = [{ section: 'main', qty: 1, name: 'Sol Ring' }];
  const expectCode = async (sb, code, status) => {
    await assert.rejects(S.checkDeck(sb, rows), (e) => {
      assert.ok(e instanceof S.SpellbookError);
      assert.equal(e.code, code);
      assert.equal(e.status, status);
      return true;
    });
  };
  const ok = C.createHandler({ fetch: okFetch(), ...quiet });
  const sbRate = fakeSb(ok);
  for (let i = 0; i < 20; i++) await S.checkDeck(sbRate, rows);
  await assert.rejects(S.checkDeck(sbRate, rows), (e) => e.code === 'rate_limited' && e.status === 429 && e.retryAfter === 60 && e.serverCode === 'rate_limited');
  await expectCode(fakeSb(C.createHandler({ fetch: () => new Promise(() => {}), timeoutMs: 10, ...quiet })), 'timeout', 504);
  await expectCode(fakeSb(C.createHandler({ fetch: async () => new Response('', { status: 500 }), ...quiet })), 'unavailable', 502);
  await expectCode(fakeSb(ok, bearer({ ...USER, is_anonymous: true })), 'auth', 403);
  await expectCode(fakeSb(ok, null), 'auth', 401);
  const sbBig = { functions: { invoke: async () => ({ data: null, error: { context: new Response('{"error":"too_many"}', { status: 400 }) } }) } };
  await assert.rejects(S.checkDeck(sbBig, rows), (e) => e.code === 'bad_input' && e.serverCode === 'too_many');
  const sbNet = { functions: { invoke: async () => ({ data: null, error: { name: 'FunctionsFetchError', context: new TypeError('Failed to fetch') } }) } };
  await expectCode(sbNet, 'network', 0);
  const sbThrow = { functions: { invoke: async () => { throw new TypeError('Failed to fetch'); } } };
  await expectCode(sbThrow, 'network', 0);
  const sbJunk = { functions: { invoke: async () => ({ data: 'hallo', error: null }) } };
  await expectCode(sbJunk, 'bad_response', 200);
});

test('Client importiert src/supabase.js nicht', async () => {
  const src = fs.readFileSync(new URL('../../src/decks/spellbook.js', import.meta.url), 'utf8');
  assert.ok(!/from\s+['"][^'"]*supabase\.js['"]/.test(src));
  assert.ok(!/import\s*\(/.test(src));
});
