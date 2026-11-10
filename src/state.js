// App-Zustand: Sitzung, eigenes Profil, Mitgliedschaften, aktuelle Playgroup
import { sb, must } from './supabase.js';
import { setLang } from './i18n/index.js';

const GROUP_KEY = 'ttg.group';
const PENDING_KEY = 'ttg.pendingCode';

export const state = {
  session: null,
  profile: null,
  memberships: [], // members-Zeilen des eigenen Kontos inkl. playgroups
  groupId: null,
};

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
  const [profile, memberships] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).single().then(must),
    sb.from('members').select('*, playgroups(*)').eq('profile_id', uid).order('created_at').then(must),
  ]);
  state.profile = profile;
  state.memberships = memberships;
  const saved = load(GROUP_KEY);
  state.groupId = memberships.some((m) => m.playgroup_id === saved) ? saved : memberships[0]?.playgroup_id || null;
  applyPrefs(profile);
}

export function setGroup(id) { state.groupId = id; store(GROUP_KEY, id); }
export const currentMembership = () => state.memberships.find((m) => m.playgroup_id === state.groupId) || null;
export const currentGroup = () => currentMembership()?.playgroups || null;
export const isAdmin = () => currentMembership()?.role === 'admin';
export const isSuperadmin = () => state.profile?.is_superadmin === true;

export async function updateProfile(patch) {
  const row = await sb.from('profiles').update(patch).eq('id', state.profile.id).select().single().then(must);
  state.profile = row;
  applyPrefs(row);
  return row;
}

// Code aus einem Einladungslink merken, bis der Nutzer angemeldet ist
export const pendingCode = {
  get: () => { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } },
  set: (c) => { try { sessionStorage.setItem(PENDING_KEY, c); } catch { /* egal */ } },
  clear: () => { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* egal */ } },
};
