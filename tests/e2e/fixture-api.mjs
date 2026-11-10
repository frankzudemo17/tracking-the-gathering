// E2E-Fixture gegen Prod (Spec P9b H): feste Testkonten A, B, C und die feste Gruppe TTG-E2E-Fixture.
// Alles läuft über die öffentliche REST-API mit anon key + Anmeldung des jeweiligen Kontos (RLS greift).
// Harte Regeln: NIE eine Gruppe löschen, NIE ein Konto löschen; geschrieben wird nur nach dem Wächter
// (checkGuard) und nur in der Fixture-Gruppe bzw. an den drei Testkonten. Adressen und Passwort werden
// nie ausgegeben — in Meldungen heißen die Konten A, B, C.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Abort, FIXTURE_NAME, KEYS, checkGuard, resolveCreds, normCode } from './fixture-core.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import(pathToFileURL(path.join(ROOT, 'src', 'config.js')).href);
export const TARGET = { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
export const IDS_FILE = path.join(ROOT, 'tests', 'e2e', 'fixture-ids.json');
/** Anzeigenamen der Testkonten (Grundzustand); die Prüfungen der E2E-Dateien suchen Mitglieder danach. */
export const NAMES = { a: 'Franco Test', b: 'Luka Test', c: 'Tim Echt' };
export const LABEL = { a: 'A', b: 'B', c: 'C' };

let creds = null;
/** Zugangsdaten (einmal je Prozess); fehlen sie ⇒ Abort Exit 2. */
export const getCreds = () => (creds ??= resolveCreds());
export const email = (k) => getCreds().accounts[k];
export const password = () => getCreds().password;

/** Feste IDs (Gruppe, Profile A/B/C) aus tests/e2e/fixture-ids.json — keine Geheimnisse. */
export function fixtureIds() {
  try { return JSON.parse(fs.readFileSync(IDS_FILE, 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------- REST
/** Zähler für den Lauf-Nachweis (Krit. 11): gelöschte Gruppen und Konten müssen 0 bleiben. */
export const tally = { groupsDeleted: 0, accountsDeleted: 0 };

export async function api(method, url, { token, body, prefer, ok404 = false } = {}) {
  // Harte Sperre: dieser Harness löscht nie eine Gruppe und nie ein Konto
  if (method === 'DELETE' && /\/rest\/v1\/playgroups\b|\/auth\/v1\/(admin\/)?user/.test(url)) throw new Error('Harness: Gruppen/Konten löschen ist verboten');
  const r = await fetch(url, {
    method,
    headers: {
      apikey: TARGET.key,
      Authorization: `Bearer ${token ?? TARGET.key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const e = new Error(`${method} ${url.replace(TARGET.url, '').split('?')[0]} → ${r.status} ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data)?.slice(0, 300)}`);
    e.status = r.status; e.code = data?.code ?? data?.error_code ?? null; e.body = data;
    if (r.status === 429) throw new Abort('Rate-Limit', `Supabase meldet 429 (${method} ${url.replace(TARGET.url, '').split('?')[0]}) — später erneut`);
    throw e;
  }
  return data;
}
export const rest = (p) => `${TARGET.url}/rest/v1/${p}`;
const inList = (ids) => `in.(${ids.join(',')})`;

const sessions = {};
/** Anmeldung per API (einmal je Konto und Lauf, Token wird wiederverwendet). */
export async function signIn(k) {
  if (sessions[k] && sessions[k].until > Date.now()) return sessions[k];
  let a;
  try {
    a = await api('POST', `${TARGET.url}/auth/v1/token?grant_type=password`, { body: { email: email(k), password: password() } });
  } catch (e) {
    if (e instanceof Abort) throw e;
    const err = new Error(`Anmeldung Konto ${LABEL[k]} fehlgeschlagen (${e.status ?? '?'} ${e.code ?? ''})`);
    err.status = e.status; err.code = e.code;
    throw err;
  }
  sessions[k] = { token: a.access_token, uid: a.user.id, until: Date.now() + (a.expires_in - 120) * 1000 };
  return sessions[k];
}
export const rpc = async (k, fn, args = {}) => api('POST', rest(`rpc/${fn}`), { token: (await signIn(k)).token, body: args });
export const get = async (k, p) => api('GET', rest(p), { token: (await signIn(k)).token });

// ---------------------------------------------------------------- Übergang (gleiche Logik wie src/zugang/invite.js)
const isUnknownTable = (e) => e?.code === 'PGRST205' || e?.code === '42P01';
const isUnknownFn = (e) => e?.code === 'PGRST202';

let live = null;
/** Gibt es check_invite in der Ziel-Datenbank (P9-Migration in Prod)? Einmal je Lauf. */
export async function zugangLive() {
  if (live !== null) return live;
  try {
    await api('POST', rest('rpc/check_invite'), { body: { p_code: 'TTG-ZZZZZZ' } });
    live = true;
  } catch (e) {
    if (isUnknownFn(e)) live = false;
    else throw new Abort('Zugang-Probe', `check_invite antwortet unerwartet: ${e.message}`);
  }
  return live;
}

/** Einladungscode der Fixture-Gruppe, gelesen als A (Admin). */
export async function inviteCode(gid = fixtureIds()?.group) {
  try {
    const rows = await get('a', `playgroup_invites?select=code&playgroup_id=eq.${gid}`);
    return rows[0]?.code ?? null;
  } catch (e) {
    if (!isUnknownTable(e)) throw e;
    const rows = await get('a', `playgroups?select=invite_code&id=eq.${gid}`);
    return rows[0]?.invite_code ?? null;
  }
}

// ---------------------------------------------------------------- Wächter + Grundzustand
async function guarded() {
  const fx = fixtureIds();
  if (!fx) throw new Abort('Fixture', 'tests/e2e/fixture-ids.json fehlt — erst node tests/e2e/fixture.mjs --anlegen (vor dem db push) bzw. --pruefen');
  const me = await signIn('a');
  if (me.uid !== fx.a) throw new Abort('Wächter', 'Konto A passt nicht zu fixture-ids.json — nichts gelöscht');
  const groups = await get('a', `playgroups?select=id,name,created_by&id=eq.${fx.group}`);
  const members = await get('a', `members?select=id,profile_id,role,display_name,claim_code,avatar_path&playgroup_id=eq.${fx.group}`);
  checkGuard({ fixture: fx, group: groups[0] ?? null, members });
  return { fx, members };
}

/**
 * Grundzustand der Fixture (vor jeder Testdatei und am Ende des Laufs): Spiele (samt Fotos), Sitzungen,
 * Platzhalter (samt Bild und Decks), Decks und Profilbilder der drei Konten weg; B und C nicht mehr in der
 * Gruppe; Profilfelder zurück. Löscht nie Gruppe oder Konto. Gibt eine Zählung zurück.
 */
export async function baseState({ log = () => {} } = {}) {
  const { fx, members } = await guarded();
  const tokA = (await signIn('a')).token;
  const gid = fx.group;
  const n = { games: 0, photos: 0, sessions: 0, placeholders: 0, decks: 0, avatars: 0, removed: 0, leftovers: [] };

  // Spielfotos (Bucket game-photos, Ordner = Gruppen-ID), dann Spiele (Kaskade: Spieler, Ereignisse, Bewertungen)
  try {
    const objs = await api('POST', `${TARGET.url}/storage/v1/object/list/game-photos`, { token: tokA, body: { prefix: gid, limit: 1000 } });
    const names = (objs || []).filter((o) => o.id).map((o) => `${gid}/${o.name}`);
    if (names.length) {
      const rm = await api('DELETE', `${TARGET.url}/storage/v1/object/game-photos`, { token: tokA, body: { prefixes: names } });
      n.photos += Array.isArray(rm) ? rm.length : 0;
    }
  } catch (e) { n.leftovers.push(`Spielfotos: ${e.message}`); }
  n.games = (await api('DELETE', rest(`games?playgroup_id=eq.${gid}`), { token: tokA, prefer: 'return=representation' })).length;
  try { n.sessions = (await api('DELETE', rest(`sessions?playgroup_id=eq.${gid}`), { token: tokA, prefer: 'return=representation' })).length; } catch (e) { n.leftovers.push(`Sitzungen: ${e.message}`); }

  // Platzhalter: Bild, dann Zeile (Decks fallen per Kaskade)
  const ph = members.filter((m) => !m.profile_id);
  if (ph.length) {
    try {
      const rm = await api('DELETE', `${TARGET.url}/storage/v1/object/avatars`, { token: tokA, body: { prefixes: ph.map((m) => `members/${m.id}/avatar.jpg`) } });
      n.avatars += Array.isArray(rm) ? rm.length : 0;
    } catch (e) { n.leftovers.push(`Platzhalter-Bilder: ${e.message}`); }
    n.placeholders = (await api('DELETE', rest(`members?id=${inList(ph.map((m) => m.id))}`), { token: tokA, prefer: 'return=representation' })).length;
  }

  // Je Konto: eigene Decks, eigenes Profilbild, Profilfelder
  for (const k of KEYS) {
    const s = await signIn(k);
    n.decks += (await api('DELETE', rest(`decks?owner_profile_id=eq.${s.uid}`), { token: s.token, prefer: 'return=representation' })).length;
    try {
      const rm = await api('DELETE', `${TARGET.url}/storage/v1/object/avatars`, { token: s.token, body: { prefixes: [`profiles/${s.uid}/avatar.jpg`] } });
      n.avatars += Array.isArray(rm) ? rm.length : 0;
    } catch (e) { n.leftovers.push(`Profilbild ${LABEL[k]}: ${e.message}`); }
    await api('PATCH', rest(`profiles?id=eq.${s.uid}`), { token: s.token, body: { display_name: NAMES[k], locale: 'de', theme: 'nacht', avatar_path: null } });
  }
  // Übernommene Platzhalter tragen ein Bild unter members/<id>/ — per RLS für niemanden löschbar (Befund P6) ⇒ melden
  for (const m of members.filter((x) => x.profile_id && x.profile_id !== fx.a && x.avatar_path)) n.leftovers.push(`Bild ${m.avatar_path} (übernommener Platzhalter, per RLS nicht löschbar)`);

  // B und C aus der Gruppe nehmen (A als Admin, Policy mem_delete); A bleibt Admin
  const others = members.filter((m) => m.profile_id && m.profile_id !== fx.a);
  if (others.length) n.removed = (await api('DELETE', rest(`members?id=${inList(others.map((m) => m.id))}`), { token: tokA, prefer: 'return=representation' })).length;
  const mineA = members.find((m) => m.profile_id === fx.a);
  await api('PATCH', rest(`members?id=eq.${mineA.id}`), { token: tokA, body: { display_name: NAMES.a, avatar_path: null } });

  log(`Grundzustand: ${n.games} Spiele, ${n.photos} Fotos, ${n.sessions} Sitzungen, ${n.placeholders} Platzhalter, ${n.decks} Decks, ${n.avatars} Bilder gelöscht; ${n.removed} Mitglied(er) entfernt`
    + (n.leftovers.length ? ` · Reste: ${n.leftovers.join(' · ')}` : ''));
  return n;
}

/** Zustand der Fixture lesen (ohne zu ändern): Mitglieder, Spiele, Platzhalter, Decks. */
export async function snapshot() {
  const { fx, members } = await guarded();
  const games = await get('a', `games?select=id&playgroup_id=eq.${fx.group}`);
  return {
    group: fx.group,
    members: members.filter((m) => m.profile_id).map((m) => (m.profile_id === fx.a ? 'A' : m.profile_id === fx.b ? 'B' : 'C')).sort(),
    adminA: members.find((m) => m.profile_id === fx.a)?.role === 'admin',
    placeholders: members.filter((m) => !m.profile_id).length,
    games: games.length,
  };
}

// ---------------------------------------------------------------- Aufbau für einzelne Testdateien
/** Konto k tritt der Fixture bei (RPC join_playgroup mit dem Code, den A liest). Wiederholbar. */
export async function ensureMember(k) {
  const fx = fixtureIds();
  const s = await signIn(k);
  const have = await get(k, `members?select=id&playgroup_id=eq.${fx.group}&profile_id=eq.${s.uid}`);
  if (have.length) return have[0].id;
  const code = await inviteCode(fx.group);
  if (!code) throw new Abort('Fixture', 'kein Einladungscode der Fixture lesbar (A kein Admin?)');
  const m = await rpc(k, 'join_playgroup', { p_code: normCode(code) });
  if (!m?.id) throw new Error(`Beitritt Konto ${LABEL[k]} fehlgeschlagen`);
  return m.id;
}

/** Platzhalter (Spieler ohne Konto) in der Fixture, angelegt von A. Liefert die members-Zeile. */
export async function ensurePlaceholder(name) {
  const fx = fixtureIds();
  const have = await get('a', `members?select=*&playgroup_id=eq.${fx.group}&profile_id=is.null&display_name=eq.${encodeURIComponent(name)}`);
  if (have.length) return have[0];
  return rpc('a', 'create_placeholder', { p_group: fx.group, p_name: name });
}

// Decks wie add-deck.js sie speichert (Kurzname, Bilder aus Scryfall). Scryfall: ≤ 10 Anfragen/s, User-Agent Pflicht.
export const DECKS = {
  tymna: { cards: ['Tymna the Weaver', 'Thrasios, Triton Hero'], bracket: 2, list_url: 'https://moxfield.com/decks/abc123' },
  krenko: { cards: ['Krenko, Mob Boss'], bracket: 3 },
  kinnan: { cards: ['Kinnan, Bonder Prodigy'], bracket: 3 },
};
const cardCache = new Map();
let lastScry = 0;
async function scryfall(name) {
  if (cardCache.has(name)) return cardCache.get(name);
  const wait = lastScry + 120 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastScry = Date.now();
  const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, {
    headers: { 'User-Agent': 'TTG-E2E/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  }).catch((e) => { throw new Abort('übersprungen (Scryfall)', `Scryfall nicht erreichbar: ${e.message}`); });
  if (!r.ok) throw new Abort('übersprungen (Scryfall)', `Scryfall ${r.status} für eine Commander-Karte`);
  const c = await r.json();
  const face = c.image_uris || c.card_faces?.[0]?.image_uris || {};
  const v = { id: c.id, name: c.name, colors: c.color_identity || [], art: face.art_crop || null };
  cardCache.set(name, v);
  return v;
}
const WUBRG = ['W', 'U', 'B', 'R', 'G'];
const shortName = (name) => { const n = name.split(' // ')[0].split(',')[0].trim(); const m = n.match(/^(?!the\s)(\S+)\s+(the|of)\s/i); return m ? m[1] : n; };

/**
 * Deck aus DECKS anlegen (falls es dem Besitzer noch fehlt). owner: 'a'|'b'|'c' (Konto) oder
 * { member } (Platzhalter, angelegt von A). Liefert die Deck-ID.
 */
export async function ensureDeck(owner, key, extra = {}) {
  const spec = DECKS[key];
  const cards = [];
  for (const n of spec.cards) cards.push(await scryfall(n));
  const k = typeof owner === 'string' ? owner : 'a';
  const s = await signIn(k);
  const ownerCol = typeof owner === 'string' ? `owner_profile_id=eq.${s.uid}` : `owner_member_id=eq.${owner.member}`;
  const have = await get(k, `decks?select=id&${ownerCol}&commander_name=eq.${encodeURIComponent(cards[0].name)}&archived=eq.false`);
  if (have.length) return have[0].id;
  const row = {
    owner_profile_id: typeof owner === 'string' ? s.uid : null,
    owner_member_id: typeof owner === 'string' ? null : owner.member,
    commander_name: cards[0].name,
    partner_name: cards[1]?.name ?? null,
    short_name: cards.map((c) => shortName(c.name)).join(' & ').slice(0, 80),
    scryfall_ids: cards.map((c) => c.id),
    image_url: cards[0].art,
    partner_image_url: cards[1]?.art ?? null,
    color_identity: WUBRG.filter((x) => cards.some((c) => c.colors.includes(x))),
    bracket: spec.bracket,
    list_url: spec.list_url ?? null,
    ...extra,
  };
  const d = await api('POST', rest('decks?select=id'), { token: s.token, body: row, prefer: 'return=representation' });
  return d[0].id;
}

/**
 * Vorbedingung einer Testdatei herstellen (nach dem Grundzustand): Mitglieder, Platzhalter, Decks.
 * @param {{ members?: string[], placeholders?: string[], decks?: Array<[string|{placeholder:string}, string]> }} need
 */
export async function prepare(need = {}) {
  const out = { members: {}, placeholders: {}, decks: {} };
  for (const k of need.members ?? []) out.members[k] = await ensureMember(k);
  for (const n of need.placeholders ?? []) out.placeholders[n] = await ensurePlaceholder(n);
  for (const [owner, key] of need.decks ?? []) {
    const o = typeof owner === 'string' ? owner : { member: out.placeholders[owner.placeholder].id };
    out.decks[`${typeof owner === 'string' ? owner : owner.placeholder}:${key}`] = await ensureDeck(o, key);
  }
  return out;
}

export { FIXTURE_NAME };
