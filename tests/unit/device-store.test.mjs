// Spec P6 Vertrag src/lib/device-store.js: Tabelle D1–D22.
// Hintergrund im Arbeitsspeicher (memoryBackend), `now` eingespritzt, Warteschlange mit flush() abgewartet.
// Modul je Fall per import() ⇒ am Start-main (Datei fehlt) schlägt jeder Fall einzeln fehl.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/lib/device-store.js');
const DAY = 86400000;
function clock(t = Date.UTC(2026, 10, 12, 12)) { const c = { t, now: () => c.t }; return c; }

/** Store mit memoryBackend; Hintergrund-Aufrufe gezählt. */
async function setup(account = 'a', c = clock()) {
  const m = await load();
  const backend = m.memoryBackend();
  const calls = { put: 0, del: 0, get: 0, all: 0, clear: 0 };
  const counted = Object.fromEntries(Object.entries(backend).filter(([k]) => typeof backend[k] === 'function').map(([k, fn]) => [k, (...a) => { calls[k]++; return fn(...a); }]));
  const store = m.createDeviceStore({ backend: /** @type {any} */ (counted), now: c.now });
  if (account) store.setAccount(account);
  return { m, store, backend, calls, c };
}
const riegel = (s) => ({ mark: s.mark(), gen: s.generation() });
const rec = (m, key, account, group, name, extra = {}) => ({ key, account, group, name, fmt: m.STORE_FORMAT, at: 1, value: { v: key }, ...extra });
const keys = async (backend, s) => [...(await backend.all(s))].map((r) => r.key).sort();
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('D1 putData ⇒ hydrate liefert den Eintrag', async () => {
  const { store } = await setup('a');
  const v = { x: 1 };
  store.putData('a|g|group', v, 5, riegel(store));
  await store.flush();
  const h = await store.hydrate('a', { group: 'g' });
  assert.deepEqual(h.entries, [{ key: 'a|g|group', value: v, at: 5 }]);
});

test('D2 hydrate nimmt nur Konto + Gruppe; fremdes Konto und fremde Gruppe werden gekehrt', async () => {
  const { m, store, backend } = await setup('a');
  await backend.put('daten', rec(m, 'a|g|group', 'a', 'g', 'group'));
  await backend.put('daten', rec(m, 'b|g|group', 'b', 'g', 'group'));
  await backend.put('daten', rec(m, 'a|h|group', 'a', 'h', 'group'));
  const h = await store.hydrate('a', { group: 'g' });
  assert.deepEqual(h.entries.map((e) => e.key), ['a|g|group']);
  await store.flush();
  assert.deepEqual(await keys(backend, 'daten'), ['a|g|group']);
});

test('D3 Schlüssel a|g|page:start mit Feld account b ⇒ nicht gelesen, gelöscht', async () => {
  const { m, store, backend } = await setup('a');
  await backend.put('daten', rec(m, 'a|g|page:start', 'b', 'g', 'page:start'));
  const h = await store.hydrate('a', { group: 'g' });
  assert.deepEqual(h.entries, []);
  await store.flush();
  assert.deepEqual(await keys(backend, 'daten'), []);
});

test('D4 Datensatz mit fmt 0 bzw. ohne fmt ⇒ nicht gelesen, gelöscht', async () => {
  const { m, store, backend } = await setup('a');
  await backend.put('daten', rec(m, 'a|g|group', 'a', 'g', 'group', { fmt: 0 }));
  const noFmt = rec(m, 'a|g|page:start', 'a', 'g', 'page:start'); delete noFmt.fmt;
  await backend.put('daten', noFmt);
  await backend.put('daten', { key: 'a|*|me', account: 'a', group: null, name: 'me', fmt: 0, at: 1, value: { profile: { id: 'a' }, memberships: [], groupId: null } });
  const h = await store.hydrate('a', { group: 'g' });
  assert.deepEqual(h.entries, []);
  assert.equal(h.me, null);
  await store.flush();
  assert.deepEqual(await keys(backend, 'daten'), []);
});

test('D5 clearAll ⇒ daten und bilder leer, Generation +1', async () => {
  const { m, store, backend } = await setup('a');
  await backend.put('daten', rec(m, 'a|g|group', 'a', 'g', 'group'));
  await backend.put('bilder', { key: 'a|avatars/p', account: 'a', path: 'p', type: 'image/png', bytes: new ArrayBuffer(4), at: 1, seen: 1, checked: 1, fmt: m.STORE_FORMAT });
  const g = store.generation();
  store.clearAll();
  await store.flush();
  assert.equal(store.generation(), g + 1);
  assert.deepEqual(await keys(backend, 'daten'), []);
  assert.deepEqual(await keys(backend, 'bilder'), []);
});

test('D6 Generation vor clearAll gemerkt ⇒ putData danach schreibt nicht', async () => {
  const { store, backend } = await setup('a');
  const r = riegel(store);
  store.clearAll();
  store.putData('a|g|group', { v: 1 }, 1, r);
  await store.flush();
  assert.deepEqual(await keys(backend, 'daten'), []);
});

test('D7 Marke vor noteWrite gemerkt ⇒ putData danach schreibt nicht', async () => {
  const { store, backend } = await setup('a');
  const r = riegel(store);
  store.noteWrite();
  store.putData('a|g|group', { v: 1 }, 1, r);
  await store.flush();
  assert.deepEqual(await keys(backend, 'daten'), []);
  assert.equal(store.mark(), r.mark + 1);
});

test('D8 noteWrite löscht group und page:* des Kontos; me und Bilder bleiben', async () => {
  const { m, store, backend } = await setup('a');
  store.putData('a|g|group', { v: 1 }, 1, riegel(store));
  store.putData('a|g|page:start', { v: 2 }, 1, riegel(store));
  store.putMe({ profile: { id: 'a' }, memberships: [{ playgroup_id: 'g' }], groupId: 'g' }, { gen: store.generation() });
  store.putImage('profiles/a/avatar-x.jpg', { type: 'image/png', bytes: new ArrayBuffer(8) }, { gen: store.generation() });
  await store.flush();
  assert.equal((await backend.all('daten')).length, 3);
  store.noteWrite();
  await store.flush();
  assert.deepEqual(await keys(backend, 'daten'), ['a|*|me']);
  assert.deepEqual(await keys(backend, 'bilder'), ['a|avatars/profiles/a/avatar-x.jpg']);
  assert.ok(m.STORE_FORMAT === 1);
});

test('D9 Wert > 2 000 000 Zeichen ⇒ nichts geschrieben, kein Wurf', async () => {
  const { store, backend } = await setup('a');
  await quiet(async () => {
    store.putData('a|g|group', { s: 'x'.repeat(2000001) }, 1, riegel(store));
    await store.flush();
  });
  assert.deepEqual(await keys(backend, 'daten'), []);
});

test('D10 151 Bilder à 10 Bytes, seen aufsteigend ⇒ 150 bleiben, das älteste fehlt', async () => {
  const { store, backend, c } = await setup('a');
  for (let i = 0; i < 151; i++) {
    c.t += 1000;
    store.putImage(`members/m${i}/avatar-1.jpg`, { type: 'image/png', bytes: new ArrayBuffer(10) }, { gen: store.generation() });
    await store.flush();
  }
  const ks = await keys(backend, 'bilder');
  assert.equal(ks.length, 150);
  assert.ok(!ks.includes('a|avatars/members/m0/avatar-1.jpg'), 'ältestes gefallen');
  assert.ok(ks.includes('a|avatars/members/m150/avatar-1.jpg'));
});

test('D11 Bilder à 3 000 000 Bytes × 3 ⇒ Summe ≤ 8 000 000, das älteste fällt', async () => {
  // 3 MB liegen über IMG_MAX_ONE (putImage nimmt sie nicht) ⇒ wie von älterem Stand im Hintergrund vorhanden;
  // die Obergrenze greift beim nächsten putImage.
  const { m, store, backend, c } = await setup('a');
  for (let i = 0; i < 3; i++) {
    await backend.put('bilder', { key: `a|avatars/p${i}`, account: 'a', path: `p${i}`, type: 'image/png', bytes: new ArrayBuffer(3000000), at: c.t + i, seen: c.t + i, checked: c.t + i, fmt: m.STORE_FORMAT });
  }
  c.t += 10;
  store.putImage('p3', { type: 'image/png', bytes: new ArrayBuffer(10) }, { gen: store.generation() });
  await store.flush();
  const all = await backend.all('bilder');
  const sum = all.reduce((s, r) => s + r.bytes.byteLength, 0);
  assert.ok(sum <= m.IMG_MAX_BYTES, `Summe ${sum}`);
  assert.deepEqual(all.map((r) => r.path).sort(), ['p1', 'p2', 'p3']);
});

test('D11b neun Bilder knapp unter 1 MB über putImage ⇒ Summe ≤ 8 000 000, die ältesten fallen', async () => {
  const { m, store, backend, c } = await setup('a');
  for (let i = 0; i < 9; i++) {
    c.t += 1000;
    store.putImage(`p${i}`, { type: 'image/png', bytes: new ArrayBuffer(999999) }, { gen: store.generation() });
    await store.flush();
  }
  const all = await backend.all('bilder');
  assert.ok(all.reduce((s, r) => s + r.bytes.byteLength, 0) <= m.IMG_MAX_BYTES);
  assert.ok(!all.some((r) => r.path === 'p0'));
  assert.ok(all.some((r) => r.path === 'p8'));
});

test('D12 Bild > 1 000 000 Bytes ⇒ nicht gespeichert', async () => {
  const { store, backend } = await setup('a');
  store.putImage('p', { type: 'image/png', bytes: new ArrayBuffer(1000001) }, { gen: store.generation() });
  await store.flush();
  assert.deepEqual(await keys(backend, 'bilder'), []);
});

test('D13 isOwnWrite je Zeile', async () => {
  const { isOwnWrite } = await load();
  const rows = [
    ['GET', '/rest/v1/games', false],
    ['HEAD', '/rest/v1/x', false],
    ['POST', '/rest/v1/decks', true],
    ['PATCH', '/rest/v1/profiles?id=eq.1', true],
    ['DELETE', '/rest/v1/decks?id=eq.1', true],
    ['POST', '/rest/v1/rpc/rate_game', true],
    ['POST', '/rest/v1/rpc/check_invite', false],
    ['POST', '/rest/v1/rpc/member_removal_check', false],
    ['POST', '/storage/v1/object/sign/avatars', false],
    ['POST', '/storage/v1/object/avatars/profiles/x/avatar-1.jpg', true],
    ['DELETE', '/storage/v1/object/avatars', true],
    ['POST', '/auth/v1/token?grant_type=refresh_token', false],
    ['POST', '/auth/v1/logout', false],
    ['POST', '/functions/v1/spellbook', true],
    ['GET', '/storage/v1/object/sign/avatars/x?token=1', false],
  ];
  for (const [method, url, want] of rows) {
    assert.equal(isOwnWrite(method, url), want, `${method} ${url}`);
    assert.equal(isOwnWrite(method, `https://projekt.supabase.co${url}`), want, `absolut: ${method} ${url}`);
  }
});

test('D14 putImage eingereiht, danach clearAll eingereiht, dann flush ⇒ bilder leer', async () => {
  const { store, backend } = await setup('a');
  store.putImage('p', { type: 'image/png', bytes: new ArrayBuffer(8) }, { gen: store.generation() });
  store.clearAll();
  await store.flush();
  assert.deepEqual(await keys(backend, 'bilder'), []);
  // auch umgekehrt: Riegel vor clearAll gemerkt, Schreiben danach eingereiht
  const g = store.generation();
  store.clearAll();
  store.putImage('q', { type: 'image/png', bytes: new ArrayBuffer(8) }, { gen: g });
  await store.flush();
  assert.deepEqual(await keys(backend, 'bilder'), []);
});

test('D15 putMe für a; getMe(b) ⇒ null; hydrate(b) kehrt me von a', async () => {
  const { store, backend } = await setup('a');
  store.putMe({ profile: { id: 'a' }, memberships: [{ playgroup_id: 'g' }], groupId: 'g' }, { gen: store.generation() });
  await store.flush();
  assert.equal(await store.getMe('b'), null);
  assert.deepEqual((await store.getMe('a'))?.groupId, 'g');
  store.setAccount('b');
  const h = await store.hydrate('b');
  assert.equal(h.me, null);
  await store.flush();
  assert.deepEqual(await keys(backend, 'daten'), []);
});

test('D16 Hintergrund wirft bei jedem Aufruf ⇒ hydrate leer, Schreiben wirft nicht', async () => {
  const m = await load();
  const boom = () => { throw new Error('kaputt'); };
  const rej = () => Promise.reject(new Error('kaputt'));
  const store = m.createDeviceStore({ backend: { get: boom, put: rej, del: boom, all: rej, clear: boom } });
  store.setAccount('a');
  assert.deepEqual(await store.hydrate('a', { group: 'g' }), { me: null, entries: [], images: [] });
  assert.equal(await store.getMe('a'), null);
  store.putData('a|g|group', { v: 1 }, 1, riegel(store));
  store.putImage('p', { type: 'image/png', bytes: new ArrayBuffer(8) }, { gen: store.generation() });
  store.putMe({ profile: { id: 'a' }, memberships: [], groupId: null }, { gen: store.generation() });
  store.noteWrite(); store.touchImage('p'); store.keepImages([]); store.dropData(['a|g|group']); store.clearAll();
  await store.flush();
});

test('D17 putData v1 bei at 10, dann v0 bei at 5 ⇒ v1 bleibt', async () => {
  const { store } = await setup('a');
  store.putData('a|g|group', { v: 1 }, 10, riegel(store));
  store.putData('a|g|group', { v: 0 }, 5, riegel(store));
  await store.flush();
  const h = await store.hydrate('a', { group: 'g' });
  assert.deepEqual(h.entries, [{ key: 'a|g|group', value: { v: 1 }, at: 10 }]);
});

test('D18 keepImages([p1]) bei p1, p2 ⇒ nur p1 bleibt', async () => {
  const { store, backend } = await setup('a');
  for (const p of ['p1', 'p2']) store.putImage(p, { type: 'image/png', bytes: new ArrayBuffer(8) }, { gen: store.generation() });
  await store.flush();
  store.keepImages(['p1']);
  await store.flush();
  assert.deepEqual(await keys(backend, 'bilder'), ['a|avatars/p1']);
});

test('D19 avatarFileName, isLegacyAvatarPath, sameFolder', async () => {
  const { avatarFileName, isLegacyAvatarPath, sameFolder } = await load();
  assert.equal(avatarFileName(1731400000000, 'a1b2'), 'avatar-m3e6uu4ga1b2.jpg');
  assert.equal(isLegacyAvatarPath('profiles/x/avatar.jpg'), true);
  assert.equal(isLegacyAvatarPath('profiles/x/avatar-k1.jpg'), false);
  assert.equal(sameFolder('profiles/x/a.jpg', 'profiles/x/b.jpg'), true);
  assert.equal(sameFolder('members/y/a.jpg', 'profiles/x/b.jpg'), false);
});

// D20 Formwächter: Form der Gruppen-Daten für STORE_FORMAT = 1 (Start-main nach P2: games mit layout).
// Gepinnt sind Schlüssel je Zeilenart UND die abgefragten Spalten je Tabelle — eine neue Spalte in history-data.js
// macht den Test rot, bis STORE_FORMAT hochgezählt und der Abdruck nachgezogen ist (Regel im Kopf von device-store.js).
const PRINT_V1 = {
  format: 1,
  keys: {
    groupId: 'string',
    members: 'avatarPath,formerProfileId,id,isPlaceholder,name,profileId,removed',
    decks: 'archived,bracket,colors,commanderName,id,imageUrl,ownerMemberId,ownerProfileId,partnerName,shortName',
    sessions: 'id,location,playedOn',
    games: 'endedAt,id,layout,note,photoPath,round,sessionId,startedAt,startingLife,status,wincon',
    players: 'deckId,eliminatedBy,eliminatedRound,finalLife,gameId,memberId,place,seat',
    ratings: 'deckRating,fun,gameId,memberId,salt',
    deckSalt: 'deckId,gameId,raterId,salt',
    potg: 'gameId,text,votedFor,voterId',
    turns: 'gameId,longestSec,memberId,totalSec,turns',
  },
  select: {
    members: '*, profiles!members_profile_id_fkey(display_name, avatar_path)',
    games: 'id, playgroup_id, session_id, status, started_at, ended_at, round, wincon, note, photo_path, starting_life, layout',
    game_players: 'game_id, member_id, deck_id, seat, place, eliminated_round, eliminated_by, final_life',
    player_ratings: 'game_id, member_id, salt, fun, deck_rating',
    deck_salt_ratings: 'game_id, rater_id, deck_id, salt',
    potg_votes: 'game_id, voter_id, voted_for, text',
    v_game_turn_times: 'game_id, member_id, turns, total_sec, longest_sec',
    sessions: 'id, played_on, location',
    decks: 'id, short_name, commander_name, partner_name, image_url, color_identity, bracket, owner_profile_id, owner_member_id, archived',
  },
};

/** Attrappe wie tests/unit/history-data.test.mjs (zeichnet select je Tabelle auf). */
function fakeSb(db) {
  const calls = [];
  function from(table) {
    const q = { table, select: null, eq: [], in: [] };
    calls.push(q);
    const exec = () => Promise.resolve().then(() => ({
      data: (db[table] || []).filter((r) => q.eq.every(([c, v]) => r[c] === v) && q.in.every(([c, vs]) => vs.includes(r[c]))).map((r) => ({ ...r })),
      error: null, status: 200,
    }));
    const b = {
      select(c) { q.select = c; return b; }, eq(c, v) { q.eq.push([c, v]); return b; }, in(c, vs) { q.in.push([c, [...vs]]); return b; },
      order() { return b; }, range() { return exec(); }, maybeSingle() { return exec(); },
    };
    return b;
  }
  return { from, calls };
}

test('D20 Formwächter: Gruppen-Daten haben die gepinnte Form für STORE_FORMAT', async () => {
  const { STORE_FORMAT } = await load();
  const { createHistoryData } = await import('../../src/lib/history-data.js');
  const G = 'g';
  const sb = fakeSb({
    members: [{ id: 'm1', playgroup_id: G, profile_id: null, display_name: 'X', avatar_path: null }],
    games: [{ id: 'x1', playgroup_id: G, session_id: 's1', status: 'finished' }],
    game_players: [{ game_id: 'x1', member_id: 'm1', deck_id: 'd1' }],
    player_ratings: [{ game_id: 'x1', member_id: 'm1' }],
    deck_salt_ratings: [{ game_id: 'x1', rater_id: 'm1', deck_id: 'd1', salt: 1 }],
    potg_votes: [{ game_id: 'x1', voter_id: 'm1', voted_for: 'm1' }],
    v_game_turn_times: [{ game_id: 'x1', member_id: 'm1', playgroup_id: G }],
    sessions: [{ id: 's1' }],
    decks: [{ id: 'd1' }],
  });
  const data = await createHistoryData(sb).loadGroup(G);
  const keysOf = {};
  for (const [k, v] of Object.entries(data)) keysOf[k] = Array.isArray(v) ? (v[0] ? Object.keys(v[0]).sort().join(',') : 'LEER') : typeof v;
  const select = {};
  for (const c of sb.calls) select[c.table] = c.select;
  assert.deepEqual({ format: STORE_FORMAT, keys: keysOf, select }, PRINT_V1,
    'Form der Gruppen-Daten geändert ⇒ STORE_FORMAT hochzählen und Abdruck nachziehen (src/lib/device-store.js)');
});

test('D21 touchImage zweimal am selben Tag ⇒ ein Schreibvorgang', async () => {
  const { store, calls, c } = await setup('a');
  store.putImage('p', { type: 'image/png', bytes: new ArrayBuffer(8) }, { gen: store.generation() });
  await store.flush();
  c.t += DAY;
  const before = calls.put;
  store.touchImage('p'); await store.flush();
  c.t += 60000;
  store.touchImage('p'); await store.flush();
  assert.equal(calls.put - before, 1);
});

test('D22 Bild mit seen vor 31 Tagen ⇒ hydrate löscht es', async () => {
  const { m, store, backend, c } = await setup('a');
  await backend.put('bilder', { key: 'a|avatars/alt', account: 'a', path: 'alt', type: 'image/png', bytes: new ArrayBuffer(4), at: c.t - 31 * DAY, seen: c.t - 31 * DAY, checked: c.t - 31 * DAY, fmt: m.STORE_FORMAT });
  await backend.put('bilder', { key: 'a|avatars/neu', account: 'a', path: 'neu', type: 'image/png', bytes: new ArrayBuffer(4), at: c.t - DAY, seen: c.t - DAY, checked: c.t - DAY, fmt: m.STORE_FORMAT });
  const h = await store.hydrate('a', { group: 'g' });
  assert.deepEqual(h.images.map((i) => i.path), ['neu']);
  await store.flush();
  assert.deepEqual(await keys(backend, 'bilder'), ['a|avatars/neu']);
});

test('D23 (Zusatz L3) Bild unter Schlüssel von a mit Feld account b ⇒ nicht gelesen, gelöscht; me mit fremder Gruppe ⇒ erste Mitgliedschaft', async () => {
  const { m, store, backend } = await setup('a');
  await backend.put('bilder', { key: 'a|avatars/x', account: 'b', path: 'x', type: 'image/png', bytes: new ArrayBuffer(4), at: 1, seen: Date.UTC(2026, 10, 12), checked: 1, fmt: m.STORE_FORMAT });
  await backend.put('daten', { key: 'a|*|me', account: 'a', group: null, name: 'me', fmt: m.STORE_FORMAT, at: 1, value: { profile: { id: 'a' }, memberships: [{ playgroup_id: 'g1' }, { playgroup_id: 'g2' }], groupId: 'weg' } });
  const h = await store.hydrate('a');
  assert.deepEqual(h.images, []);
  assert.equal(h.me?.groupId, 'g1');
  await store.flush();
  assert.deepEqual(await keys(backend, 'bilder'), []);
});

test('D24 (Zusatz) putData/putMe mit Konto-Präfix ≠ account() ⇒ nichts geschrieben', async () => {
  const { store, backend } = await setup('a');
  store.putData('b|g|group', { v: 1 }, 1, riegel(store));
  store.putMe({ profile: { id: 'b' }, memberships: [], groupId: null }, { gen: store.generation() });
  await store.flush();
  assert.deepEqual(await keys(backend, 'daten'), []);
});
