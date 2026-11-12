// App-Zustand: Sitzung, eigenes Profil, Mitgliedschaften, aktuelle Playgroup
import { sb, must, clearSignedUrls, seedAvatars, clearLocalAvatars } from './supabase.js';
import { pageCache } from './lib/cache.js';
import { deviceStore, HYDRATE_MAX_MS, DECODE_MAX_MS } from './lib/device-store.js';
import { setLang } from './i18n/index.js';

const GROUP_KEY = 'ttg.group';
const PENDING_KEY = 'ttg.pendingCode';
// P6 Entscheid 5: Konto, dessen Stand im Gerätespeicher liegt (gesetzt nach bestätigtem Anmelden/loadMe, weg in clearCaches)
export const KONTO_KEY = 'ttg.konto';

// P6 Entscheid 8: der Zwischenspeicher spiegelt in den Gerätespeicher (Riegel: Generation, Konto, Schreibmarke).
// clear() spiegelt nur das Verwerfen der Gruppen-/Seiten-Stände; das ganze Leeren macht clearCaches() selbst.
pageCache.setStore({
  mark: () => deviceStore.mark(),
  gen: () => deviceStore.generation(),
  put: (key, value, at, riegel) => { deviceStore.putData(key, value, at, riegel); noteFresh(key); },
  del: (keys) => deviceStore.dropData(keys),
  clear: () => deviceStore.dropEntries(),
});

// P6 Entscheid 15: nach einer erfolgreichen frischen Ladung von `group` UND `page:start` derselben Gruppe fallen
// Bilder, deren Pfad in keinem gespeicherten `me`/`page:*`/`group` mehr vorkommt. Nur, wenn beide Datensätze
// tatsächlich im Gerätespeicher liegen (eine Schreibmarke dazwischen ⇒ nicht aufräumen).
/** Gruppe → schon frisch gespiegelte Namen. @type {Map<string, Set<string>>} */
const freshNames = new Map();
/** @param {string} key */
function noteFresh(key) {
  const [a, g, ...rest] = key.split('|');
  const name = rest.join('|');
  if (name !== 'group' && name !== 'page:start') return;
  const s = freshNames.get(g) || new Set();
  s.add(name);
  freshNames.set(g, s);
  if (s.size < 2) return;
  freshNames.delete(g);
  gcImages(a, g, deviceStore.generation()).catch(() => {});
}
/** Alle Profilbild-Pfade in einem gespeicherten Wert (Felder `avatar_path`/`avatarPath`). */
function avatarPaths(/** @type {any} */ v, /** @type {Set<string>} */ out, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 8) return out;
  if (Array.isArray(v)) { for (const x of v) avatarPaths(x, out, depth + 1); return out; }
  for (const [k, x] of Object.entries(v)) {
    if ((k === 'avatar_path' || k === 'avatarPath') && typeof x === 'string' && x) out.add(x);
    else if (x && typeof x === 'object') avatarPaths(x, out, depth + 1);
  }
  return out;
}
/** @param {string} a @param {string} g @param {number} gen */
async function gcImages(a, g, gen) {
  await deviceStore.flush();
  if (deviceStore.account() !== a || deviceStore.generation() !== gen) return;
  const recs = await deviceStore.ownData();
  const here = new Set(recs.filter((r) => r.group === g).map((r) => r.name));
  if (!here.has('group') || !here.has('page:start')) return;
  const keep = new Set();
  for (const r of recs) avatarPaths(r.value, keep);
  if (deviceStore.account() === a && deviceStore.generation() === gen) deviceStore.keepImages(keep);
}
/** Kehrt die Merkliste des Aufräumens (Abmelden/Kontowechsel). */
const resetFresh = () => freshNames.clear();

let groupId = null;

export const state = {
  session: null,
  profile: null,
  memberships: [], // members-Zeilen des eigenen Kontos inkl. playgroups
  // P12 Entscheid 12: die eine Stelle — jede Änderung der aktuellen Gruppe (Wechsel, Löschen, Verlassen,
  // Beitreten, loadMe, Abmelden) verwirft alle gemerkten Einträge der verlassenen Gruppe.
  get groupId() { return groupId; },
  set groupId(id) {
    const old = groupId;
    groupId = id;
    if (old && old !== id) {
      pageCache.drop((p) => p.group === old);
      deviceStore.dropGroup(old); // P6: auch Stände der verlassenen Gruppe, die nur noch im Gerätespeicher liegen
    }
  },
};

/**
 * P12 Entscheid 13: Abmelden, Kontowechsel, Konto löschen — alles Gemerkte weg (Daten + signierte Bild-Adressen).
 * P6 Entscheid 11: dazu der ganze Gerätespeicher (alle Konten), die Marke ttg.konto, lokale Bild-Adressen.
 */
export function clearCaches() {
  deviceStore.clearAll();
  deviceStore.setAccount(null);
  store(KONTO_KEY, null);
  clearLocalAvatars();
  resetFresh();
  pageCache.clear(); clearSignedUrls(); store('ttg.heroArt', null);
}

/**
 * P6: eigenes Profil + Mitgliedschaften + Gruppe als `me` merken (nur, wenn seit `gen` nicht geleert wurde und das
 * Konto noch angemeldet ist) und die Marke ttg.konto setzen.
 * @param {string} uid @param {number} gen
 */
function rememberMe(uid, gen) {
  if (deviceStore.generation() !== gen || state.session?.user?.id !== uid || state.profile?.id !== uid) return;
  deviceStore.setAccount(uid);
  deviceStore.putMe({ profile: state.profile, memberships: state.memberships, groupId: state.groupId }, { gen });
  store(KONTO_KEY, uid);
}

function store(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* privat */ } }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

export function applyPrefs(p) {
  const LOOKS = ['nacht', 'arktis', 'lachs'];
  const saved = load('ttg.theme');
  const theme = LOOKS.includes(p?.theme) ? p.theme : LOOKS.includes(saved) ? saved : 'nacht';
  document.documentElement.dataset.theme = theme;
  store('ttg.theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0D1117';
  setLang(p?.locale || load('ttg.lang') || 'de');
  if (p?.locale) store('ttg.lang', p.locale);
}

export async function loadMe() {
  const uid = state.session?.user?.id;
  if (!uid) { state.profile = null; state.memberships = []; return; }
  deviceStore.setAccount(uid);
  const gen = deviceStore.generation();
  const [profile, memberships] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).single().then(must),
    sb.from('members').select('*, playgroups(*)').eq('profile_id', uid).order('created_at').then(must),
  ]);
  state.profile = profile;
  state.memberships = memberships;
  const saved = load(GROUP_KEY);
  state.groupId = memberships.some((m) => m.playgroup_id === saved) ? saved : memberships[0]?.playgroup_id || null;
  applyPrefs(profile);
  rememberMe(uid, gen);
}

export function setGroup(id) {
  state.groupId = id; store(GROUP_KEY, id);
  const uid = state.session?.user?.id;
  if (uid) rememberMe(uid, deviceStore.generation()); // P6: gemerkte Gruppe für den nächsten Kaltstart
}
export const currentMembership = () => state.memberships.find((m) => m.playgroup_id === state.groupId) || null;
export const currentGroup = () => currentMembership()?.playgroups || null;
export const isAdmin = () => currentMembership()?.role === 'admin';
export const isSuperadmin = () => state.profile?.is_superadmin === true;

export async function updateProfile(patch) {
  const gen = deviceStore.generation();
  const row = await sb.from('profiles').update(patch).eq('id', state.profile.id).select().single().then(must);
  state.profile = row;
  applyPrefs(row);
  rememberMe(row.id, gen);
  return row;
}

// ---------------------------------------------------------------------------
// P6 Kaltstart (spec-p6-kaltstart.md Entscheide 5/6)

/** Gespeicherte Sitzung aus ttg-auth, nur mit user.id und refresh_token (Bedingung a). */
export function storedSession() {
  try {
    const s = JSON.parse(localStorage.getItem('ttg-auth') || 'null');
    return s && typeof s === 'object' && s.user?.id && s.refresh_token ? s : null;
  } catch { return null; }
}

/** Vorstart-Kandidat (Lesestelle L5): Sitzung (a) und Marke ttg.konto = genau diese Konto-ID (b). */
export function prestartSession() {
  const s = storedSession();
  return s && load(KONTO_KEY) === s.user.id ? s : null;
}

/**
 * Gerätespeicher lesen, höchstens HYDRATE_MAX_MS; später ⇒ null (Ergebnis verworfen). Leeren dazwischen ⇒ null.
 * @param {string} uid @param {{ group?: string|null }} [o]
 */
export async function hydrateCapped(uid, o = {}) {
  const gen = deviceStore.generation();
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(null), HYDRATE_MAX_MS); });
  const res = await Promise.race([deviceStore.hydrate(uid, o).catch(() => null), late]);
  clearTimeout(timer);
  return res && deviceStore.generation() === gen && deviceStore.account() === uid ? res : null;
}

/**
 * Säen (Lesestelle L6): nur Einträge `konto|aktuelle Gruppe|…`, nur wo der Zwischenspeicher nichts hat;
 * Profilbilder als Blob-Adressen (+ Vorab-Dekodieren mit Deckel).
 * @param {string} uid @param {{ entries: Array<{ key: string, value: any, at: number }>, images: any[] }} res
 */
export async function seedFrom(uid, res) {
  if (state.session?.user?.id !== uid || deviceStore.account() !== uid) return;
  const pre = `${uid}|${state.groupId}|`;
  if (state.groupId) for (const e of res.entries) if (e.key.startsWith(pre)) pageCache.seed(e.key, e.value, e.at);
  await seedAvatars(res.images, { capMs: DECODE_MAX_MS });
}

/**
 * Vorstart (Entscheid 5): Zustand aus dem Gerätespeicher setzen, bevor die Sitzung über das Netz bestätigt ist.
 * Bedingung (c): `me` dieses Kontos in der aktuellen Format-Version. Liefert false ⇒ heutiger Weg.
 * @param {any} stored gespeicherte Sitzung (prestartSession)
 */
export async function bootState(stored) {
  const uid = stored.user.id;
  deviceStore.setAccount(uid);
  const res = await hydrateCapped(uid);
  if (!res?.me || res.me.profile?.id !== uid || state.session?.user?.id !== uid) return false;
  state.profile = res.me.profile;
  state.memberships = res.me.memberships;
  state.groupId = res.me.groupId;
  applyPrefs(state.profile);
  await seedFrom(uid, res);
  return state.session?.user?.id === uid;
}

// Code aus einem Einladungslink merken, bis der Nutzer angemeldet ist
export const pendingCode = {
  get: () => { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } },
  set: (c) => { try { sessionStorage.setItem(PENDING_KEY, c); } catch { /* egal */ } },
  clear: () => { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* egal */ } },
};
