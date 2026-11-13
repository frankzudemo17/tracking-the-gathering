import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { deviceStore, isOwnWrite, isLegacyAvatarPath, IMG_MAX_ONE, LEGACY_RECHECK_MS } from './lib/device-store.js';

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
/** Lokaler Eintrag eines Pfads, nur für das Konto des Gerätespeichers. @param {string} path */
const localEntry = (path) => (localAcct && localAcct === deviceStore.account() ? localAv.get(path) : undefined);

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
export function clearLocalAvatars() { revokeLocal(); localAcct = null; dlQueue.length = 0; dlTried.clear(); }
const TTL = 55 * 60 * 1000;

// P12 Nachtrag 1 (B1): Riegel. Eine Signier-Antwort schreibt nur, wenn seit Beginn ihrer Anfrage
// weder geleert (clearSignedUrls) noch ihr Pfad vergessen (forgetAvatar/forgetPhoto) wurde.
let tick = 0;
let clearedAt = 0;
const forgotAt = new Map(); // 'bucket/path' -> tick
const fresh = (bucket, path, t0) => clearedAt <= t0 && !((forgotAt.get(`${bucket}/${path}`) ?? 0) > t0);
const forget = (bucket, path) => { forgotAt.set(`${bucket}/${path}`, ++tick); };

// P6 Entscheid 12: Hintergrund-Download signierter Profilbilder in den Gerätespeicher (höchstens 3 gleichzeitig).
// Schreibt nur, wenn seit dem Signieren weder geleert noch der Pfad vergessen wurde (B1-Riegel) und Konto und
// Generation des Gerätespeichers dieselben sind. Je signierter Adresse höchstens ein Versuch.
const DL_MAX = 3;
/** @type {Array<{ path: string, url: string, t0: number, acct: string, gen: number, legacy: boolean }>} */
const dlQueue = [];
let dlRunning = 0;
/** Pfad → Adresse, die schon geladen wird bzw. wurde. @type {Map<string, string>} */
const dlTried = new Map();
/** @param {string} path @param {string} url @param {number} t0 @param {boolean} [legacy] */
function download(path, url, t0, legacy = false) {
  const acct = deviceStore.account();
  if (!acct || dlTried.get(path) === url) return;
  dlTried.set(path, url);
  dlQueue.push({ path, url, t0, acct, gen: deviceStore.generation(), legacy });
  pump();
}
function pump() {
  while (dlRunning < DL_MAX && dlQueue.length) {
    const job = /** @type {any} */ (dlQueue.shift());
    dlRunning++;
    fetchImage(job).catch(() => {}).finally(() => { dlRunning--; pump(); });
  }
}
/** @param {{ path: string, t0: number, acct: string, gen: number }} job */
const jobOk = (job) => fresh('avatars', job.path, job.t0) && deviceStore.generation() === job.gen && deviceStore.account() === job.acct;
/** @param {{ path: string, url: string, t0: number, acct: string, gen: number, legacy: boolean }} job */
async function fetchImage(job) {
  if (!jobOk(job) || (!job.legacy && localEntry(job.path))) return;
  const res = await globalThis.fetch(job.url);
  if (!res.ok) return;
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!type.startsWith('image/')) return;
  const bytes = await res.arrayBuffer();
  if (!jobOk(job) || !bytes.byteLength || bytes.byteLength > IMG_MAX_ONE) return;
  deviceStore.putImage(job.path, { type, bytes }, { gen: job.gen });
  setLocal(job.path, { type, bytes, checked: Date.now() });
}

/** Altpfad (`avatar.jpg`): höchstens einmal je LEGACY_RECHECK_MS im Hintergrund neu laden und ersetzen. @param {string} path */
async function recheckLegacy(path) {
  const loc = localEntry(path);
  if (!loc || !sb) return;
  loc.checked = Date.now();
  deviceStore.touchChecked(path);
  const t0 = tick;
  try {
    const { data } = await sb.storage.from('avatars').createSignedUrls([path], 3600);
    const row = data?.[0];
    if (row?.signedUrl && !row.error && fresh('avatars', path, t0)) download(path, row.signedUrl, t0, true);
  } catch { /* nächster Versuch nach der Frist */ }
}

/**
 * Profilbild-Adressen (Entscheid 12/13): lokal liegende Pfade sofort als Blob-Adresse (ohne Netz), nur fehlende
 * werden signiert und danach im Hintergrund lokal abgelegt. Lehnt nie ab: Scheitern ⇒ `null` für den Pfad.
 * @param {Array<string|null|undefined>} paths
 * @returns {Promise<Record<string, string|null>>}
 */
export async function avatarUrls(paths) {
  const want = /** @type {string[]} */ ([...new Set((paths || []).filter(Boolean))]);
  const now = Date.now();
  /** @type {Record<string, string|null>} */
  const out = {};
  const missing = [];
  for (const p of want) {
    const loc = localEntry(p);
    if (loc) {
      out[p] = loc.url;
      deviceStore.touchImage(p);
      if (isLegacyAvatarPath(p) && now - loc.checked >= LEGACY_RECHECK_MS) recheckLegacy(p);
    } else if (!(urlCache.get(p)?.until > now)) missing.push(p);
  }
  if (missing.length && sb) {
    const t0 = tick;
    try {
      const { data } = await sb.storage.from('avatars').createSignedUrls(missing, 3600);
      for (const row of data || []) if (row.signedUrl && !row.error && fresh('avatars', row.path, t0)) urlCache.set(row.path, { url: row.signedUrl, until: now + TTL });
    } catch (e) { console.warn('Profilbilder', e); }
  }
  for (const p of want) {
    if (p in out) continue;
    const loc = localEntry(p);
    const signedUrl = urlCache.get(p)?.url || null;
    out[p] = loc?.url || signedUrl;
    if (!loc && signedUrl) download(p, signedUrl, tick);
  }
  return out;
}

/**
 * Synchron (Entscheid 12): Blob-Adressen + noch gültige signierte Adressen, nur für bekannte Pfade —
 * ein fehlender Schlüssel heißt „noch offen“.
 * @param {Array<string|null|undefined>} paths
 * @returns {Record<string, string>}
 */
export function avatarUrlsNow(paths) {
  const now = Date.now();
  /** @type {Record<string, string>} */
  const out = {};
  for (const p of /** @type {string[]} */ ([...new Set((paths || []).filter(Boolean))])) {
    const c = urlCache.get(p);
    const u = localEntry(p)?.url || (c && c.until > now ? c.url : null);
    if (u) out[p] = u;
  }
  return out;
}

/** Pfad vergessen: signierte Adresse und lokale Kopie (Gerätespeicher + Blob-Adresse). @param {string} path */
export const forgetAvatar = (path) => {
  forget('avatars', path);
  const loc = localAv.get(path);
  if (loc) { try { URL.revokeObjectURL(loc.url); } catch { /* egal */ } localAv.delete(path); }
  dlTried.delete(path);
  deviceStore.dropImage(path);
  return urlCache.delete(path);
};

/**
 * Eigenes Bild nach dem Hochladen sofort lokal ablegen (Entscheid 13: kein Download des eigenen neuen Bildes).
 * @param {string} path @param {Blob} blob
 */
export async function rememberAvatar(path, blob) {
  const acct = deviceStore.account();
  const gen = deviceStore.generation();
  if (!acct || !path || !blob) return;
  const bytes = await blob.arrayBuffer();
  if (deviceStore.account() !== acct || deviceStore.generation() !== gen || !bytes.byteLength || bytes.byteLength > IMG_MAX_ONE) return;
  const type = blob.type || 'image/jpeg';
  deviceStore.putImage(path, { type, bytes }, { gen });
  setLocal(path, { type, bytes, checked: Date.now() });
}

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
