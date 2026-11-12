import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { deviceStore, isOwnWrite } from './lib/device-store.js';

export const configured = !SUPABASE_URL.startsWith('__');

// ---------------- P6 Schreibmarke (spec-p6-kaltstart.md Entscheid 9) ----------------
// Jede Anfrage des Clients läuft über trackedFetch. Ein eigener Schreibvorgang (isOwnWrite) zählt die Marke des
// Gerätespeichers beim Absenden und beim Eintreffen der Antwort (auch bei Fehler) hoch; beim Absenden fallen die
// gespeicherten Gruppen-/Seiten-Stände des Kontos. Abonnenten (src/lib/refill.js) erfahren beides.
/** @type {Set<(phase: 'send'|'done') => void>} */
const writeSubs = new Set();
/** @param {(phase: 'send'|'done') => void} cb @returns {() => void} abbestellen */
export function onWrite(cb) { writeSubs.add(cb); return () => { writeSubs.delete(cb); }; }
/** @param {'send'|'done'} phase */
function noteWrite(phase) {
  deviceStore.noteWrite();
  for (const cb of [...writeSubs]) { try { cb(phase); } catch (e) { console.error(e); } }
}
/** @param {any} input @param {any} [init] */
export function trackedFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const method = init?.method || (input && typeof input === 'object' && 'method' in input ? input.method : 'GET');
  const own = isOwnWrite(method, url);
  if (own) noteWrite('send');
  const p = globalThis.fetch(input, init);
  if (own) p.then(() => noteWrite('done'), () => noteWrite('done'));
  return p;
}

export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // PKCE: Links aus Mails kommen als ?code=… zurück, nicht im #-Teil (der gehört dem Router)
        flowType: 'pkce',
        storageKey: 'ttg-auth',
      },
      global: { fetch: trackedFetch },
    })
  : null;

/** Ergebnis prüfen und Fehler werfen (mit Original-Meldung für die Übersetzung). */
export function must({ data, error }) {
  if (error) throw error;
  return data;
}

/** Basis-URL der App (für Mail-Links und Einladungslinks), funktioniert auch unter /tracking-the-gathering/ */
export function appUrl(hash = '') {
  const u = new URL(location.href);
  u.search = ''; u.hash = hash;
  return u.toString();
}

// ---------------- Profilbilder (privater Bucket → signierte URLs, gecacht) ----------------
const urlCache = new Map(); // path -> { url, until }

// P6 Entscheid 12: Bild-Zuordnung im Arbeitsspeicher für lokal liegende Profilbilder (Lesestelle L4):
// Pfad → { url: blob:…, checked }. Nur für deviceStore.account(); geleert in clearLocalAvatars (clearCaches).
/** @type {Map<string, { url: string, checked: number }>} */
const localAv = new Map();
/** Konto, dem die Zuordnung gehört. @type {string|null} */
let localAcct = null;
/** @param {string} path @param {{ type: string, bytes: ArrayBuffer, checked?: number }} img */
function setLocal(path, img) {
  const acct = deviceStore.account();
  if (!acct) return null;
  if (localAcct !== acct) { revokeLocal(); localAcct = acct; }
  let url;
  try { url = URL.createObjectURL(new Blob([img.bytes], { type: img.type || 'image/jpeg' })); } catch { return null; }
  const old = localAv.get(path);
  if (old) { try { URL.revokeObjectURL(old.url); } catch { /* egal */ } }
  localAv.set(path, { url, checked: img.checked ?? Date.now() });
  return url;
}
function revokeLocal() {
  for (const { url } of localAv.values()) { try { URL.revokeObjectURL(url); } catch { /* egal */ } }
  localAv.clear();
}
/** Lokale Bild-Adresse eines Pfads, nur für das Konto des Gerätespeichers. @param {string} path */
const localUrl = (path) => (localAcct && localAcct === deviceStore.account() ? localAv.get(path)?.url || null : null);

/**
 * P6 Säen: Bilder aus dem Gerätespeicher (hydrate) als Blob-Adressen bereitstellen und bis zu `max` vorab dekodieren
 * (höchstens `capMs`). Nur für das Konto des Gerätespeichers.
 * @param {Array<{ path: string, type: string, bytes: ArrayBuffer, checked: number }>} images
 * @param {{ max?: number, capMs?: number }} [o]
 */
export async function seedAvatars(images, { max = 60, capMs = 150 } = {}) {
  const urls = [];
  for (const img of images || []) { const u = setLocal(img.path, img); if (u) urls.push(u); }
  if (!urls.length || typeof Image === 'undefined') return;
  const decode = Promise.allSettled(urls.slice(0, max).map((u) => { const i = new Image(); i.src = u; return i.decode(); }));
  await Promise.race([decode, new Promise((r) => { setTimeout(r, capMs); })]);
}
/** P6: lokale Bild-Adressen widerrufen und die Zuordnung leeren (clearCaches). */
export function clearLocalAvatars() { revokeLocal(); localAcct = null; }
const TTL = 55 * 60 * 1000;

// P12 Nachtrag 1 (B1): Riegel. Eine Signier-Antwort schreibt nur, wenn seit Beginn ihrer Anfrage
// weder geleert (clearSignedUrls) noch ihr Pfad vergessen (forgetAvatar/forgetPhoto) wurde.
let tick = 0;
let clearedAt = 0;
const forgotAt = new Map(); // 'bucket/path' -> tick
const fresh = (bucket, path, t0) => clearedAt <= t0 && !((forgotAt.get(`${bucket}/${path}`) ?? 0) > t0);
const forget = (bucket, path) => { forgotAt.set(`${bucket}/${path}`, ++tick); };

export async function avatarUrls(paths) {
  const want = [...new Set(paths.filter(Boolean))];
  const now = Date.now();
  const missing = want.filter((p) => !(urlCache.get(p)?.until > now));
  if (missing.length && sb) {
    const t0 = tick;
    const { data } = await sb.storage.from('avatars').createSignedUrls(missing, 3600);
    for (const row of data || []) if (row.signedUrl && !row.error && fresh('avatars', row.path, t0)) urlCache.set(row.path, { url: row.signedUrl, until: now + TTL });
  }
  const out = {};
  for (const p of want) out[p] = urlCache.get(p)?.url || null;
  return out;
}
export const forgetAvatar = (path) => { forget('avatars', path); return urlCache.delete(path); };

// ---------------- Spielfotos (privater Bucket game-photos → signierte URLs, eigener Cache) ----------------
const photoCache = new Map(); // path -> { url, until }

export async function photoUrls(paths) {
  const want = [...new Set(paths.filter(Boolean))];
  const now = Date.now();
  const missing = want.filter((p) => !(photoCache.get(p)?.until > now));
  if (missing.length && sb) {
    const t0 = tick;
    const { data } = await sb.storage.from('game-photos').createSignedUrls(missing, 3600);
    for (const row of data || []) if (row.signedUrl && !row.error && fresh('game-photos', row.path, t0)) photoCache.set(row.path, { url: row.signedUrl, until: now + TTL });
  }
  const out = {};
  for (const p of want) out[p] = photoCache.get(p)?.url || null;
  return out;
}
export const forgetPhoto = (path) => { forget('game-photos', path); return photoCache.delete(path); };

// P12: Abmelden/Kontowechsel — beide Karten der signierten Bild-Adressen leeren (src/state.js clearCaches)
// Ausgeliefert wird nur aus den Karten ⇒ ein Aufrufer, der nach dem Leeren begann, bekommt nie eine Antwort von davor.
export function clearSignedUrls() { clearedAt = ++tick; forgotAt.clear(); urlCache.clear(); photoCache.clear(); }
