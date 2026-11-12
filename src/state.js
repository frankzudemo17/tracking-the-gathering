// App-Zustand: Sitzung, eigenes Profil, Mitgliedschaften, aktuelle Playgroup
import { sb, must, clearSignedUrls } from './supabase.js';
import { pageCache } from './lib/cache.js';
import { deviceStore } from './lib/device-store.js';
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
  put: (key, value, at, riegel) => deviceStore.putData(key, value, at, riegel),
  del: (keys) => deviceStore.dropData(keys),
  clear: () => deviceStore.dropEntries(),
});

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

// Code aus einem Einladungslink merken, bis der Nutzer angemeldet ist
export const pendingCode = {
  get: () => { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } },
  set: (c) => { try { sessionStorage.setItem(PENDING_KEY, c); } catch { /* egal */ } },
  clear: () => { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* egal */ } },
};
