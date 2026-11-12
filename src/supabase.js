import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.startsWith('__');

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
